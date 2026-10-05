// Tab's scheduler (M94, PLAN.md D73): the debounce, the in-flight cap and
// the per-minute cap. A cancelled token before sending sends nothing; once
// a request is sent it runs to its end even when its token is cancelled —
// the scheduler never aborts it, so its usage is always counted. A trigger
// that finds no slot waits; a newer trigger replaces a waiting one, unsent.
// Pure: no `vscode` import. The clock is injected; the timers are the
// globals, so fake timers drive them in tests.

import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  TAB_DEBOUNCE_MS,
  TAB_MAX_IN_FLIGHT,
  TAB_MAX_REQUESTS_PER_MINUTE,
} from '../../shared/constants'

/** Read at fire time: cancelling before the send sends nothing. */
export interface TabScheduleToken {
  readonly cancelled: boolean
}

export interface TabScheduledWork {
  readonly token: TabScheduleToken
  /** Runs to its end once sent; the scheduler never aborts it. */
  readonly run: () => Promise<void>
}

export interface TabSchedulerDeps {
  readonly now?: () => number
}

export interface TabTriggerOptions {
  /** Invoke skips the debounce wait; Automatic waits it out. */
  readonly immediate?: boolean
}

/** The starts kept for the per-minute cap: one minute, from constants. */
const START_WINDOW_MS = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND

export class TabScheduler {
  private pending: TabScheduledWork | undefined
  /**
   * The waiting work is ready: its debounce has elapsed, or it was an
   * Invoke. Only ready work waits for capacity, so a settle never sends
   * work whose debounce is still running.
   */
  private pendingReady = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = 0
  private readonly starts: number[] = []

  public constructor(private readonly deps: TabSchedulerDeps = {}) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private clearTimer(): void {
    if (this.timer === undefined) {
      return
    }
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Forget the starts that left the minute window. */
  private prune(): void {
    const since = this.now() - START_WINDOW_MS
    const kept = this.starts.findIndex((start) => start > since)
    this.starts.splice(0, kept === -1 ? this.starts.length : kept)
  }

  /** Send the waiting trigger when a slot is free, else keep waiting. */
  private flush(): void {
    this.clearTimer()
    const work = this.pending
    this.pending = undefined
    this.pendingReady = false
    if (work === undefined) {
      return
    }
    this.attempt(work)
  }

  private attempt(work: TabScheduledWork): void {
    this.prune()
    if (work.token.cancelled) {
      return
    }
    if (this.running >= TAB_MAX_IN_FLIGHT || this.starts.length >= TAB_MAX_REQUESTS_PER_MINUTE) {
      this.park(work)
      return
    }
    this.starts.push(this.now())
    this.running += 1
    void this.runToEnd(work)
  }

  /**
   * Sent work runs to its end; its outcome is the work's own to report.
   * Its slot then frees for work already waiting for one, and only that:
   * a debounce still running keeps its timer and its cancellation window.
   */
  private async runToEnd(work: TabScheduledWork): Promise<void> {
    try {
      await work.run()
    } catch {
      // The work reports its own failure; the scheduler only frees the slot.
    } finally {
      this.running -= 1
      if (this.pendingReady) {
        this.flush()
      }
    }
  }

  /**
   * No slot: wait for one. A settle retries at once; the timer covers a
   * slot freed by time alone (the minute window sliding with every request
   * settled and nothing left running).
   */
  private park(work: TabScheduledWork): void {
    this.pending = work
    this.pendingReady = true
    this.prune()
    const oldest = this.starts[0] ?? this.now()
    const delay = Math.max(oldest + START_WINDOW_MS - this.now(), 0)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, delay)
  }

  /**
   * Queue work: Automatic waits out the debounce, Invoke fires at once.
   * Either replaces a waiting trigger, which is then never sent.
   */
  public trigger(work: TabScheduledWork, options?: TabTriggerOptions): void {
    this.clearTimer()
    this.pending = work
    this.pendingReady = false
    if (options?.immediate === true) {
      this.pendingReady = true
      this.flush()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.pendingReady = true
      this.flush()
    }, TAB_DEBOUNCE_MS)
  }

  /** Drop a waiting trigger, unsent; a sent request runs on. */
  public cancelPending(): void {
    this.clearTimer()
    this.pending = undefined
    this.pendingReady = false
  }

  public get hasPending(): boolean {
    return this.pending !== undefined
  }

  public get inFlightCount(): number {
    return this.running
  }
}
