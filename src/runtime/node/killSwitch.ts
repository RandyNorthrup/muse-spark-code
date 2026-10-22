import { NODE_STOP_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'

export interface NodeStopPort {
  /** Must abort requests and terminate descendants, not merely dispose handles. */
  stop(reason: 'stopped' | 'locked', signal: AbortSignal): Promise<void>
}

/** Starts every cleanup even when one fails; lock seals before awaiting anything. */
export class NodeKillSwitch {
  private pending: Promise<void> | undefined
  private readonly controller = new AbortController()

  constructor(
    private readonly ports: readonly NodeStopPort[],
    private readonly seal: () => void,
    private readonly endSessions: () => void,
  ) {}

  private async cleanup(reason: 'stopped' | 'locked'): Promise<void> {
    const timeout = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timeout.abort()
        reject(new Error(UI_TEXT.nodeErrors.unavailable))
      }, NODE_STOP_TIMEOUT_MS)
    })
    const stops = this.ports.map(async (port) => {
      await port.stop(reason, timeout.signal)
    })
    try {
      const results = await Promise.race([Promise.allSettled(stops), deadline])
      if (results.some((result) => result.status === 'rejected')) {
        throw new Error(UI_TEXT.nodeErrors.unavailable)
      }
    } finally {
      clearTimeout(timer)
    }
  }
  get signal(): AbortSignal {
    return this.controller.signal
  }

  stop(reason: 'stopped' | 'locked'): Promise<void> {
    this.controller.abort(reason)
    if (reason === 'locked') {
      this.seal()
      this.endSessions()
    }
    this.pending ??= this.cleanup(reason)
    return this.pending
  }
}
