// The surfaces one MHP connection carries (M104 lane B, D226): which views a
// host has opened, their lifecycle (opened, ready, reloaded, hidden, closed),
// and the panel envelopes between each view and its webview, numbered per
// surface and admitted by the frozen contract (`parseMhpPanelEnvelope`)
// before any listener sees them. A surface only ever shows a view the
// runtime already holds: the lookup answers by the binding's session.
import * as z from 'zod/mini'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { CoreLogger } from '../../core/logging'
import { MHP_PANEL } from '../../shared/constants'
import {
  panelLifecycleSchema,
  parseMhpPanelEnvelope,
  parseMhpSurfaceNotification,
  type MhpPanelBinding,
  type panelToHostPayloadSchema,
  type panelToPanelPayloadSchema,
} from '../../shared/hostApi/panel'
import { MhpPanelError } from '../../shared/hostApi/panelError'
import { type PanelDelivery } from './delivery'

type ToHost = z.infer<typeof panelToHostPayloadSchema>
type ToPanel = z.infer<typeof panelToPanelPayloadSchema>

/** What a surface shows: it takes the webview's messages and publishes the panel's. */
export interface PanelView {
  /** A message from the webview; `null` is a fresh render request (What's New). */
  handle(message: ToHost | null): Promise<void> | void
  subscribe(listener: (message: ToPanel) => void): () => void
}

interface Incoming {
  readonly message: ToHost | null
  readonly complete: () => void
}

interface Surface {
  readonly binding: MhpPanelBinding
  readonly view: PanelView
  readonly incoming: Incoming[]
  unsubscribe: (() => void) | undefined
  inputSeq: number
  outputSeq: number
  ready: boolean
  dispatching: boolean
  /** The state request the webview sent when it reloaded, replayed once it is ready again. */
  replay: ToHost | null | undefined
}

function bindingOf(frame: MhpPanelBinding): MhpPanelBinding {
  return { surface: frame.surface, sessionId: frame.sessionId, surfaceKind: frame.surfaceKind }
}

export class PanelSurfaces {
  private readonly surfaces = new Map<string, Surface>()
  /** Ids a host closed: a host mints each id once, so an id is never opened again. */
  private readonly retired = new Set<string>()
  /** Surfaces the runtime retired and waits for the host to confirm closed. */
  private readonly closing = new Map<string, MhpPanelBinding>()
  private isClosed = false

  public constructor(
    private readonly delivery: PanelDelivery,
    private readonly lookup: (binding: MhpPanelBinding) => PanelView | undefined,
    private readonly log: CoreLogger,
    /** The connection cannot go on (a view or the output failed). */
    private readonly fatal: () => void,
    private readonly onClosed?: (binding: MhpPanelBinding) => void,
  ) {}

  private error(
    code: MhpPanelError['frame']['code'],
    surface: string | null,
    seq: number | null = null,
  ): never {
    throw new MhpPanelError({ mhp: MHP_PANEL.wireVersion, kind: 'panelError', surface, seq, code })
  }

  private dispatch(surface: Surface): void {
    if (surface.dispatching || !surface.ready) return
    surface.dispatching = true
    void (async () => {
      try {
        while (surface.ready && this.surfaces.get(surface.binding.surface) === surface) {
          const job = surface.incoming.shift()
          if (job === undefined) break
          // Admission has reached the bound listener; it is no longer queued.
          job.complete()
          await surface.view.handle(job.message)
        }
      } catch (error: unknown) {
        // REPORTED: a view that failed on a message leaves the connection unable to trust its state.
        this.log.error(`MHP_PANEL_DISPATCH_FAILED: ${failureForLog(error)}`)
        this.fatal()
      } finally {
        surface.dispatching = false
      }
    })()
  }

  private output(surface: Surface, payload: ToPanel): void {
    if (this.surfaces.get(surface.binding.surface) !== surface) return
    const frame = parseMhpPanelEnvelope(
      {
        mhp: MHP_PANEL.wireVersion,
        kind: 'panel',
        surface: surface.binding.surface,
        seq: surface.outputSeq,
        direction: 'toPanel',
        payload,
      },
      {
        binding: surface.binding,
        expectedSeq: surface.outputSeq,
        ready: true,
        direction: 'toPanel',
      },
    )
    this.delivery.post(frame, frame.surface)
    surface.outputSeq += 1
  }

  private remove(surface: Surface): number {
    const id = surface.binding.surface
    this.surfaces.delete(id)
    this.retired.add(id)
    try {
      surface.unsubscribe?.()
    } catch (error: unknown) {
      // REPORTED: a listener that cannot detach is logged; the surface is gone either way.
      this.log.warn(`MHP_SURFACE_UNSUBSCRIBE_FAILED: ${failureForLog(error)}`)
    }
    const dropped = surface.incoming.length + this.delivery.drop(id)
    for (const job of surface.incoming.splice(0)) job.complete()
    if (dropped > 0) this.log.warn(`MHP_PANEL_DROPPED ${String(dropped)}`)
    return dropped
  }

  /** A panel envelope from the host's webview, admitted for its surface or refused. */
  public message(value: unknown): void {
    const header = z.object({ surface: z.string() }).safeParse(value)
    const surface = header.success ? this.surfaces.get(header.data.surface) : undefined
    const frame = parseMhpPanelEnvelope(value, {
      binding: surface?.binding,
      expectedSeq: surface?.inputSeq ?? 1,
      ready: surface?.ready === true,
      direction: 'toHost',
    })
    if (surface === undefined || frame.direction !== 'toHost')
      return this.error('MHP_PANEL_UNKNOWN_SURFACE', frame.surface)
    const complete = this.delivery.reserve(
      new TextEncoder().encode(JSON.stringify(value)).byteLength,
      frame.surface,
      frame.seq,
    )
    surface.incoming.push({ message: frame.payload, complete })
    surface.inputSeq += 1
    this.dispatch(surface)
  }

  /** A surface lifecycle notification from the host. */
  public lifecycle(value: unknown): void {
    const parsed = panelLifecycleSchema.safeParse(value)
    if (!parsed.success) return this.error('MHP_PANEL_INVALID_LIFECYCLE', null)
    const frame = parseMhpSurfaceNotification(
      value,
      this.surfaces.get(parsed.data.surface)?.binding ?? this.closing.get(parsed.data.surface),
    )
    if (this.isClosed) return this.error('MHP_PANEL_UNKNOWN_SURFACE', frame.surface)
    if (frame.event === 'closed' && this.closing.delete(frame.surface)) {
      this.onClosed?.(bindingOf(frame))
      return
    }
    if (frame.event === 'opened') {
      if (this.retired.has(frame.surface))
        return this.error('MHP_PANEL_INVALID_LIFECYCLE', frame.surface)
      const binding = bindingOf(frame)
      const view = this.lookup(binding)
      if (view === undefined) return this.error('MHP_PANEL_UNKNOWN_SURFACE', frame.surface)
      this.delivery.ready(frame.surface, false)
      // Published before subscribing: a view may synchronously send its state.
      const surface: Surface = {
        binding,
        view,
        incoming: [],
        unsubscribe: undefined,
        inputSeq: 1,
        outputSeq: 1,
        ready: false,
        dispatching: false,
        replay: undefined,
      }
      this.surfaces.set(frame.surface, surface)
      try {
        surface.unsubscribe = view.subscribe((message) => {
          try {
            this.output(surface, message)
          } catch (error: unknown) {
            // REPORTED: output the contract refuses, or a host that stopped reading, ends the connection.
            this.log.error(`MHP_PANEL_OUTPUT_FAILED: ${failureForLog(error)}`)
            this.fatal()
          }
        })
        if (!this.surfaces.has(frame.surface)) surface.unsubscribe()
      } catch (error: unknown) {
        // REPORTED: a view that cannot be subscribed to is removed, and the host is told.
        this.remove(surface)
        throw error
      }
      return
    }
    const surface = this.surfaces.get(frame.surface)
    if (surface === undefined) return this.error('MHP_PANEL_UNKNOWN_SURFACE', frame.surface)
    switch (frame.event) {
      case 'ready': {
        surface.ready = true
        this.delivery.ready(frame.surface, true)
        if (surface.replay !== undefined) {
          const complete = this.delivery.reserve(
            new TextEncoder().encode(JSON.stringify(surface.replay)).byteLength,
            frame.surface,
          )
          surface.incoming.push({ message: surface.replay, complete })
          surface.replay = undefined
        }
        this.dispatch(surface)
        break
      }
      case 'reloaded': {
        surface.ready = false
        surface.replay = frame.stateRequest
        this.delivery.ready(frame.surface, false)
        break
      }
      case 'closed': {
        this.remove(surface)
        this.onClosed?.(surface.binding)
        break
      }
      case 'hidden': {
        break
      }
    }
  }

  /** The ids of the open surfaces of `kind` bound to `sessionId`. */
  public idsOf(sessionId: string, kind: MhpPanelBinding['surfaceKind']): readonly string[] {
    const found: string[] = []
    for (const surface of this.surfaces.values())
      if (surface.binding.sessionId === sessionId && surface.binding.surfaceKind === kind)
        found.push(surface.binding.surface)
    return found
  }

  /** Detaches every view; the connection ended or its host stopped. */
  public detach(): void {
    for (const surface of this.surfaces.values()) this.remove(surface)
  }

  /**
  A session's surfaces end here, before its replacement is shown: an old id
  stays a tombstone, and the host confirms each with `closed`. A session
  change always needs fresh ids and sequences.
  */
  public retireSession(sessionId: string): readonly MhpPanelBinding[] {
    const retired: MhpPanelBinding[] = []
    for (const surface of this.surfaces.values()) {
      if (surface.binding.sessionId !== sessionId) continue
      retired.push(surface.binding)
      this.closing.set(surface.binding.surface, surface.binding)
      this.remove(surface)
    }
    return retired
  }

  public close(): void {
    this.isClosed = true
    this.detach()
  }
}
