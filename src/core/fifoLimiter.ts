// At most a fixed number of tasks at once, the others in arrival order (CLI
// recovery, 2026-10-03): after a resume every open edit row of the owner's
// conversation read its stored diff at the same instant, 26 `item/readOutput`
// calls on a Muse Code already minutes behind, and each one timed out.

export class FifoLimiter {
  private running = 0
  /** The tasks waiting for a slot, oldest first: each is handed one as it frees. */
  private readonly waiting: (() => void)[] = []

  public constructor(private readonly limit: number) {}

  /** A slot freed: the oldest waiting task takes it, or it is counted free. */
  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) {
      this.running -= 1
      return
    }
    next()
  }

  /**
   * Runs `task` once a slot is free, in the order `run` was called. When its
   * turn comes, a task no longer wanted (`isWanted` says so) is not run at
   * all: `run` rejects with `dropped()` and the slot goes to the next.
   */
  public async run<T>(
    task: () => Promise<T>,
    isWanted: () => boolean,
    dropped: () => Error,
  ): Promise<T> {
    if (this.running < this.limit) {
      this.running += 1
    } else {
      // The slot is handed over by `release`, already counted.
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve)
      })
    }
    try {
      if (!isWanted()) {
        throw dropped()
      }
      return await task()
    } finally {
      this.release()
    }
  }
}
