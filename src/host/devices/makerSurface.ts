// RLF-DEVICES: the Devices-panel side of the exact-payload approval.
// One dialog at a time: asks queue behind the active prompt, the panel
// state carries the active prompt, and the document's answer settles
// it. Closing, aborting or disposing answers reject. The surface stays
// in dist/devices.js beside the panel; the executors it asks for load
// with dist/maker.js on the first maker execution.
import type { MakerApprovalAnswer, MakerApprovalPrompt } from '../../shared/maker'
import type { DeviceWebviewRequest } from '../../shared/devicesPanel'

export type MakerPanelAnswer = Extract<
  DeviceWebviewRequest['action'],
  { kind: 'answerMakerApproval' }
>

export interface PanelMakerSurfaceDeps {
  /** Push a fresh observation; the snapshot carries the active prompt. */
  readonly publish: () => void
  /** Open or reveal the Devices panel for the waiting prompt. */
  readonly reveal: () => void
}

interface PendingAsk {
  readonly prompt: MakerApprovalPrompt
  readonly signal: AbortSignal
  readonly settle: (answer: MakerApprovalAnswer | null) => void
}

/**
The panel asker: prompts queue, the head shows in the Devices panel,
and the document's echoed answer settles it. The surface passes the
answer through; the engine verifies id, digest and expiry.
*/
export class PanelMakerSurface {
  private readonly queue: PendingAsk[] = []
  private active: PendingAsk | undefined
  private isDisposed = false
  public constructor(private readonly deps: PanelMakerSurfaceDeps) {}

  private pump(): void {
    if (this.isDisposed || this.active !== undefined) return
    const next = this.queue.shift()
    if (next === undefined) return
    if (next.signal.aborted) {
      next.settle(null)
      this.pump()
      return
    }
    this.active = next
    const onAbort = (): void => {
      if (this.active === next) this.settleActive(null)
    }
    next.signal.addEventListener('abort', onAbort, { once: true })
    this.deps.reveal()
    this.deps.publish()
  }

  private settleActive(answer: MakerApprovalAnswer | null): void {
    const active = this.active
    if (active === undefined) return
    this.active = undefined
    this.deps.publish()
    active.settle(answer)
    this.pump()
  }

  /** The prompt the panel snapshot carries, while one waits. */
  public pendingPrompt(): MakerApprovalPrompt | undefined {
    return this.active?.prompt
  }

  public ask(
    prompt: MakerApprovalPrompt,
    signal: AbortSignal,
  ): Promise<MakerApprovalAnswer | null> {
    if (this.isDisposed || signal.aborted) return Promise.resolve(null)
    return new Promise<MakerApprovalAnswer | null>((settle) => {
      this.queue.push({ prompt, signal, settle })
      this.pump()
    })
  }

  /** Routes the document's answer to the waiting prompt, when it matches. */
  public answer(action: MakerPanelAnswer): void {
    if (action.requestId !== this.active?.prompt.requestId) return
    this.settleActive({
      requestId: action.requestId,
      decision: action.decision,
      digest: action.digest,
    })
  }

  public dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    const active = this.active
    this.active = undefined
    active?.settle(null)
    for (const ask of this.queue.splice(0)) ask.settle(null)
  }
}
