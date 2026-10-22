/** Serialize private writes/control changes without poisoning later requests
after a refusal. The caller still receives the original failure, and report
sees it too, so journal failures reach the operator. Each owner filters its
own routine refusals before reporting. */
export class NodeTransactions {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly report: (error: unknown) => void) {}

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail
    const result = (async () => {
      await previous
      return await work()
    })()
    this.tail = (async () => {
      try {
        await result
      } catch (error: unknown) {
        // The caller owns the failure; the report keeps the journal observable.
        this.report(error)
      }
    })()
    return result
  }
}
