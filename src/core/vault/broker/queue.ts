/** Keeps each broker/log transaction ordered; a caller's failure never poisons the next request. */
export class VaultBrokerQueue {
  private tail: Promise<unknown> = Promise.resolve()
  private currentGeneration = 0
  get generation(): number {
    return this.currentGeneration
  }
  /** JS transitions are synchronous. Safety barriers preempt a suspended transaction,
   * so an awaited store/presence/termination cannot delay invalidation. */
  invalidate<T>(operation: () => T, shouldAdvance = false): T {
    if (shouldAdvance) {
      this.currentGeneration += 1
      // New generations must not wait behind an invalidated operation's external I/O.
      this.tail = Promise.resolve()
    }
    return operation()
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail
    const result = (async () => {
      try {
        await previous
      } catch {
        /* The previous caller owns its rejection. */
      }
      return await operation()
    })()
    this.tail = result
    return await result
  }
}
