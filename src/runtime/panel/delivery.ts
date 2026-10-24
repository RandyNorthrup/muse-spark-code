// What the runtime panel writes to its MHP host, in order (M104 lane B).
// One admission budget covers every frame written and not yet taken by the
// transport: MHP's frozen queue bounds (MHP_PANEL), the protocol's own
// safety limits, never a limit on the person's work. A host that stops
// reading is told no more and the connection ends, instead of the runtime
// buffering without end.
import { Buffer } from 'node:buffer'
import type { Writable } from 'node:stream'
import { MHP_PANEL } from '../../shared/constants'

interface PendingFrame {
  readonly line: string
  readonly complete: () => void
}

/** Thrown when a frame would pass MHP's queue or envelope bounds. */
export class PanelBackpressureError extends Error {
  public constructor(public readonly code: 'MHP_PANEL_BACKPRESSURE' | 'MHP_PANEL_TOO_LARGE') {
    super(code)
    this.name = 'PanelBackpressureError'
  }
}

export class PanelDelivery {
  private bytes = 0
  private messages = 0
  private readonly pending: PendingFrame[] = []
  private readonly writing = new Set<PendingFrame>()
  private stream: Pick<Writable, 'write'> | undefined
  private isBlocked = false
  private isClosed = false

  private drain(): void {
    const stream = this.stream
    if (stream === undefined || this.isClosed || this.isBlocked) return
    for (let frame = this.pending.shift(); frame !== undefined; frame = this.pending.shift()) {
      const taken = frame
      this.writing.add(taken)
      const isAccepted = stream.write(taken.line, () => {
        this.writing.delete(taken)
        taken.complete()
      })
      if (!isAccepted) {
        this.isBlocked = true
        return
      }
    }
  }

  /** Holds `bytes` of the budget until the returned release runs (once). */
  public reserve(bytes: number): () => void {
    if (
      this.isClosed ||
      this.bytes + bytes > MHP_PANEL.maximumQueuedBytes ||
      this.messages + 1 > MHP_PANEL.maximumQueuedMessages
    ) {
      throw new PanelBackpressureError('MHP_PANEL_BACKPRESSURE')
    }
    this.bytes += bytes
    this.messages += 1
    let isHeld = true
    return () => {
      if (!isHeld) return
      isHeld = false
      this.bytes -= bytes
      this.messages -= 1
    }
  }

  /** Queues one frame as one line; `onComplete` runs once the transport took it. */
  public post(frame: unknown, onComplete?: () => void): void {
    const line = `${JSON.stringify(frame)}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes - 1 > MHP_PANEL.maximumEnvelopeBytes)
      throw new PanelBackpressureError('MHP_PANEL_TOO_LARGE')
    const release = this.reserve(bytes)
    this.pending.push({
      line,
      complete: () => {
        release()
        onComplete?.()
      },
    })
    this.drain()
  }

  /** Writes to `stream`; a write it refuses waits for the stream's `drain`. */
  public connect(stream: Pick<Writable, 'write' | 'on'>): void {
    this.stream = stream
    this.isBlocked = false
    stream.on('drain', () => {
      this.isBlocked = false
      this.drain()
    })
    this.drain()
  }

  public close(): void {
    this.isClosed = true
    for (const frame of [...this.pending.splice(0), ...this.writing]) frame.complete()
    this.writing.clear()
    this.stream = undefined
  }
}
