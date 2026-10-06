/** Keeps each broker/log transaction ordered; a caller's failure never poisons the next request. */
export class VaultBrokerQueue {
  private tail: Promise<unknown> = Promise.resolve()
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
