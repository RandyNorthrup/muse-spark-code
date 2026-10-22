// Tab's scheduler (M94, PLAN.md D73): the debounce and the replacement of
// a waiting trigger by a newer one. A cancelled token before sending sends
// nothing; once a request is sent it runs to its end even when its token
// is cancelled — the scheduler never aborts it, so its usage is always
// counted. Acceptance 9: no count of ours paces requests; pacing is the
// debounce plus the shared client's provider-driven pacing (its rate-limit
// bucket and Retry-After waits), so ready work always sends at once.
// Pure: no `vscode` import. Tests use real timers.

import { TAB_DEBOUNCE_MS } from '../../shared/constants'

/** Read at fire time: cancelling before the send sends nothing. */
export interface TabScheduleToken {
  readonly cancelled: boolean
}

export interface TabScheduledWork {
  readonly token: TabScheduleToken
  /** Runs to its end once sent; the scheduler never aborts it. */
  readonly run: () => Promise<void>
}

export interface TabTriggerOptions {
  /** Invoke skips the debounce wait; Automatic waits it out. */
  readonly immediate?: boolean
}

export class TabScheduler {
  private pending: TabScheduledWork | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  private clearTimer(): void {
    if (this.timer === undefined) {
      return
    }
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Send the waiting trigger at once; a cancelled one sends nothing. */
  private flush(): void {
    this.clearTimer()
    const work = this.pending
    this.pending = undefined
    if (work === undefined || work.token.cancelled) {
      return
    }
    // No slot, no per-minute count: ready work sends.
    void work.run().catch(() => {
      // The work reports its own failure; the scheduler only ever starts it.
    })
  }

  /**
  Queue work: Automatic waits out the debounce, Invoke fires at once.
  Either replaces a waiting trigger, which is then never sent.
  */
  public trigger(work: TabScheduledWork, options?: TabTriggerOptions): void {
    this.clearTimer()
    this.pending = work
    if (options?.immediate === true) {
      this.flush()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, TAB_DEBOUNCE_MS)
  }

  /** Drop a waiting trigger, unsent; a sent request runs on. */
  public cancelPending(): void {
    this.clearTimer()
    this.pending = undefined
  }

  public get hasPending(): boolean {
    return this.pending !== undefined
  }
}
