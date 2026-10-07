import type { QuestionClock } from '../../../../src/shared/questions'

interface Timer {
  readonly id: number
  readonly at: number
  readonly callback: () => void
}

/** Deterministic clock: advances through deadlines, including timers created by a callback. */
export class FakeQuestionClock implements QuestionClock {
  private current = 1000
  private sequence = 0
  private readonly timers = new Map<number, Timer>()
  /** A test may make the clock lie; lane Q's deadline test must then fail. */
  public firesTimers = true

  public now(): number {
    return this.current
  }

  public setTimer(delayMs: number, callback: () => void): () => void {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error('invalid fake timer delay')
    }
    this.sequence += 1
    const id = this.sequence
    this.timers.set(id, { id, at: this.current + delayMs, callback })
    return () => {
      this.timers.delete(id)
    }
  }

  public advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error('fake clock cannot move backwards')
    }
    const target = this.current + milliseconds
    if (this.firesTimers) {
      for (;;) {
        let next: Timer | undefined
        for (const timer of this.timers.values()) {
          if (
            timer.at <= target &&
            (next === undefined ||
              timer.at < next.at ||
              (timer.at === next.at && timer.id < next.id))
          ) {
            next = timer
          }
        }
        if (next === undefined) {
          break
        }
        this.current = next.at
        this.timers.delete(next.id)
        next.callback()
      }
    }
    this.current = target
  }

  public get pendingTimers(): number {
    return this.timers.size
  }
}
