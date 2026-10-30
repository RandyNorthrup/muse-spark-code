// The editor's chat surfaces in a runtime panel suite (M104 lane B): it
// answers the runtime's `surfaces/open` with a fresh opaque id, opens the
// surface the way an editor's webview does (the lifecycle `opened` and
// `ready`, then the webview's own `ready` message), and speaks and hears the
// webview's messages inside the panel envelopes the frozen contract defines.
import { MHP_PANEL } from '../../../src/shared/constants'
import type { MhpWire } from './mhpHost'

/** One chat surface of the editor. */
export interface ChatSurface {
  readonly surface: string
  readonly sessionId: string
  /** The webview says something. */
  say(payload: unknown): void
  /** The next thing the panel shows this surface that is `type` (and, if given, satisfies `isWanted`). */
  shown(
    type: string,
    isWanted?: (payload: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>>
  /** The lifecycle events an editor sends for this surface. */
  lifecycle(event: 'hidden' | 'closed' | 'reloaded' | 'ready', extra?: object): void
}

export interface PanelEditor {
  /**
  The next surface the runtime asks the editor to open, opened and ready: its
  webview says `hello` (a chat's `ready`; another page says its own).
  */
  nextSurface(hello?: object): Promise<ChatSurface>
  /** The surfaces the runtime asked the editor to close, by id. */
  readonly closed: readonly string[]
  /** Every `surfaces/open` the runtime made so far. */
  readonly opened: readonly {
    readonly kind: unknown
    readonly placement: unknown
    readonly sessionId: string
  }[]
}

interface OpenRequest {
  readonly kind: unknown
  readonly placement: unknown
  readonly sessionId: string
}

export function panelEditor(wire: MhpWire): PanelEditor {
  const waiting: ((request: OpenRequest & { readonly surface: string }) => void)[] = []
  const pending: (OpenRequest & { readonly surface: string })[] = []
  const closed: string[] = []
  const opened: OpenRequest[] = []
  let issued = 0
  wire.serve('surfaces/open', (params) => {
    const requested = params as OpenRequest
    opened.push(requested)
    issued += 1
    const request = { ...requested, surface: `surface-${String(issued)}` }
    const taker = waiting.shift()
    if (taker === undefined) pending.push(request)
    else taker(request)
    return { surfaceId: request.surface }
  })
  wire.serve('surfaces/close', (params) => {
    closed.push((params as { surfaceId: string }).surfaceId)
    return null
  })
  return {
    closed,
    opened,
    nextSurface: async (hello?: object) => {
      const request =
        pending.shift() ??
        (await new Promise<OpenRequest & { readonly surface: string }>((resolve) => {
          waiting.push(resolve)
        }))
      const binding = {
        surface: request.surface,
        sessionId: request.sessionId,
        surfaceKind: request.kind,
      }
      const frame = { mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding }
      wire.send({ ...frame, event: 'opened' })
      wire.send({ ...frame, event: 'ready' })
      let seq = 1
      const surface: ChatSurface = {
        surface: request.surface,
        sessionId: request.sessionId,
        say: (payload) => {
          wire.send({
            mhp: MHP_PANEL.wireVersion,
            kind: 'panel',
            surface: request.surface,
            seq: seq++,
            direction: 'toHost',
            payload,
          })
        },
        shown: async (type, isWanted = () => true) => {
          const found = await wire.next((candidate) => {
            const payload = candidate['payload']
            return (
              candidate['kind'] === 'panel' &&
              candidate['surface'] === request.surface &&
              typeof payload === 'object' &&
              payload !== null &&
              'type' in payload &&
              payload.type === type &&
              isWanted(payload)
            )
          })
          return found['payload'] as Record<string, unknown>
        },
        lifecycle: (event, extra = {}) => {
          wire.send({ ...frame, event, ...extra })
        },
      }
      surface.say(hello ?? { type: 'ready' })
      return surface
    },
  }
}
