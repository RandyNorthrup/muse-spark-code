/** Serialize private writes/control changes without poisoning later requests
 * after a refusal. The caller still receives the original failure. */
export class NodeTransactions {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail
    const result = (async () => {
      await previous
      return await work()
    })()
    this.tail = (async () => {
      try {
        await result
      } catch {
        /* Only the queue consumes the rejection; result remains rejected. */
      }
    })()
    return result
  }
}
