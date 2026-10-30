// What the runtime panel writes to its MHP host, in order (M104 lane B).
// One admission budget covers every frame written and not yet taken by the
// transport, and the work admitted behind it: MHP's frozen queue bounds
// (MHP_PANEL), the protocol's own safety limits, never a limit on the
// person's work. A host that stops reading is told no more and the
// connection ends, instead of the runtime buffering without end. A frame for
// a surface that is not ready waits for it (MHP's readiness rule) and is
// dropped, counted, when the surface closes.
import { Buffer } from 'node:buffer'
import type { Writable } from 'node:stream'
import { MHP_PANEL } from '../../shared/constants'
import { MhpPanelError } from '../../shared/hostApi/panelError'

type Completion = () => void

/** Writes one line; false asks the delivery to wait for `resume` (a full stream). */
export type PanelWrite = (line: string, complete: Completion) => boolean

interface PendingFrame {
  readonly line: string
  readonly surface: string | null
  readonly complete: Completion
}

/** A frame that passes MHP's queue or envelope bounds is refused with the contract's own code. */
function refusal(
  code: 'MHP_PANEL_BACKPRESSURE' | 'MHP_PANEL_TOO_LARGE',
  surface: string | null,
  seq: number | null,
): MhpPanelError {
  return new MhpPanelError({
    mhp: MHP_PANEL.wireVersion,
    kind: 'panelError',
    surface,
    seq,
    code,
  })
}

/** Whether `error` is the delivery's refusal for a host that stopped reading. */
export function isDeliveryRefusal(error: unknown): boolean {
  return (
    error instanceof MhpPanelError &&
    (error.frame.code === 'MHP_PANEL_BACKPRESSURE' || error.frame.code === 'MHP_PANEL_TOO_LARGE')
  )
}

export class PanelDelivery {
  private bytes = 0
  private messages = 0
  private readonly pending: PendingFrame[] = []
  private readonly writing = new Set<PendingFrame>()
  private readonly unready = new Set<string>()
  private write: PanelWrite | undefined
  private isBlocked = false
  private isClosed = false

  /** A delivery under `shared` also counts against its budget (one process, several windows). */
  public constructor(private readonly shared?: PanelDelivery) {}

  private drain(): void {
    if (this.isClosed || this.isBlocked || this.write === undefined) return
    for (;;) {
      const index = this.pending.findIndex(
        (frame) => frame.surface === null || !this.unready.has(frame.surface),
      )
      if (index === -1) return
      const [frame] = this.pending.splice(index, 1)
      if (frame === undefined) return
      this.writing.add(frame)
      const isAccepted = this.write(frame.line, () => {
        // A frame already dropped with its surface completed then.
        if (this.writing.delete(frame)) frame.complete()
      })
      if (!isAccepted) {
        this.isBlocked = true
        return
      }
    }
  }

  /** Holds `bytes` of the budget until the returned release runs (once). */
  public reserve(
    bytes: number,
    surface: string | null = null,
    seq: number | null = null,
  ): Completion {
    if (
      this.isClosed ||
      this.bytes + bytes > MHP_PANEL.maximumQueuedBytes ||
      this.messages + 1 > MHP_PANEL.maximumQueuedMessages
    )
      throw refusal('MHP_PANEL_BACKPRESSURE', surface, seq)
    const sharedRelease = this.shared?.reserve(bytes, surface, seq)
    this.bytes += bytes
    this.messages += 1
    let isHeld = true
    return () => {
      if (!isHeld) return
      isHeld = false
      this.bytes -= bytes
      this.messages -= 1
      sharedRelease?.()
    }
  }

  /** Queues one frame as one line; `onComplete` runs once the transport took it (or it was dropped). */
  public post(frame: unknown, surface: string | null = null, onComplete?: Completion): void {
    const line = `${JSON.stringify(frame)}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes - 1 > MHP_PANEL.maximumEnvelopeBytes)
      throw refusal('MHP_PANEL_TOO_LARGE', surface, null)
    const release = this.reserve(bytes, surface)
    this.pending.push({
      line,
      surface,
      complete: () => {
        release()
        onComplete?.()
      },
    })
    this.drain()
  }

  /** Writes through `write`, now and as it frees; undefined stops writing. */
  public connect(write: PanelWrite | undefined): void {
    this.write = write
    this.isBlocked = false
    this.drain()
  }

  /** A surface's frames wait while it is not ready. */
  public ready(surface: string, isReady: boolean): void {
    if (isReady) this.unready.delete(surface)
    else this.unready.add(surface)
    this.drain()
  }

  /** The transport can take more after a write it refused. */
  public resume(): void {
    this.isBlocked = false
    this.drain()
  }

  /** Frames for a closed surface are dropped; the count is what the host never received. */
  public drop(surface: string): number {
    let dropped = 0
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const frame = this.pending[index]
      if (frame?.surface !== surface) continue
      this.pending.splice(index, 1)
      frame.complete()
      dropped += 1
    }
    for (const frame of this.writing) {
      if (frame.surface !== surface) continue
      this.writing.delete(frame)
      frame.complete()
      dropped += 1
    }
    this.unready.delete(surface)
    return dropped
  }

  public close(): void {
    this.isClosed = true
    for (const frame of [...this.pending.splice(0), ...this.writing]) frame.complete()
    this.writing.clear()
    this.write = undefined
  }
}

/** The writer for a Node stream: a full stream pauses the delivery until its `drain`. */
export function streamWriter(
  delivery: PanelDelivery,
  stream: Pick<Writable, 'write' | 'on'>,
): PanelWrite {
  stream.on('drain', () => {
    delivery.resume()
  })
  return (line, complete) => stream.write(line, complete)
}
