import { Buffer } from 'node:buffer'
import { MHP_PANEL } from '../../shared/constants'
import { MhpPanelError } from '../../shared/hostApi/panel'

type Completion = () => void
export type PanelWrite = (line: string, complete: Completion) => boolean
interface PendingFrame {
  readonly line: string
  readonly surface: string | undefined
  readonly complete: Completion
}

/** One admission budget includes service traffic, dispatch work and buffered writes. */
export class PanelDelivery {
  private changed: (() => void) | undefined
  private bytes = 0
  private messages = 0
  private readonly pending: PendingFrame[] = []
  private readonly writing = new Set<PendingFrame>()
  private readonly unready = new Set<string>()
  private write: PanelWrite | undefined
  private isBlocked = false
  private isClosed = false

  public constructor(private readonly shared?: PanelDelivery) {}

  public reserve(bytes: number, surface?: string, seq?: number): Completion {
    if (
      this.isClosed ||
      this.bytes + bytes > MHP_PANEL.maximumQueuedBytes ||
      this.messages + 1 > MHP_PANEL.maximumQueuedMessages
    ) {
      throw new MhpPanelError({
        mhp: MHP_PANEL.wireVersion,
        kind: 'panelError',
        surface: surface ?? null,
        seq: seq ?? null,
        code: 'MHP_PANEL_BACKPRESSURE',
      })
    }
    const sharedRelease = this.shared?.reserve(bytes, surface, seq)
    this.bytes += bytes
    this.messages += 1
    this.changed?.()
    let isHeld = true
    return () => {
      if (!isHeld) return
      isHeld = false
      this.bytes -= bytes
      this.messages -= 1
      sharedRelease?.()
      this.changed?.()
    }
  }

  public post(frame: unknown, surface?: string, onComplete?: Completion): void {
    const line = `${JSON.stringify(frame)}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes - 1 > MHP_PANEL.maximumEnvelopeBytes)
      throw new MhpPanelError({
        mhp: MHP_PANEL.wireVersion,
        kind: 'panelError',
        surface: surface ?? null,
        seq: null,
        code: 'MHP_PANEL_TOO_LARGE',
      })
    const release = this.reserve(bytes, surface)
    const complete = () => {
      release()
      onComplete?.()
    }
    this.pending.push({ line, surface, complete })
    this.drain()
  }

  public onCapacityChanged(changed: () => void): void {
    this.changed = changed
  }

  public connect(write: PanelWrite | undefined): void {
    this.write = write
    this.isBlocked = false
    this.drain()
  }

  public ready(surface: string, isReady: boolean): void {
    if (isReady) this.unready.delete(surface)
    else this.unready.add(surface)
    this.drain()
  }

  public drain(): void {
    if (this.isClosed || this.isBlocked || this.write === undefined) return
    for (;;) {
      const index = this.pending.findIndex(
        (frame) => frame.surface === undefined || !this.unready.has(frame.surface),
      )
      if (index === -1) return
      const frame = this.pending.splice(index, 1)[0]
      if (frame === undefined) return
      this.writing.add(frame)
      try {
        const isAccepted = this.write(frame.line, () => {
          this.writing.delete(frame)
          frame.complete()
        })
        if (!isAccepted) {
          this.isBlocked = true
          return
        }
      } catch (error: unknown) {
        this.writing.delete(frame)
        frame.complete()
        throw error
      }
    }
  }

  public resume(): void {
    this.isBlocked = false
    this.drain()
  }

  /** A write callback is the transport completion boundary, not proof of rendering. */
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

  public get totals(): { readonly bytes: number; readonly messages: number } {
    return { bytes: this.bytes, messages: this.messages }
  }
}
