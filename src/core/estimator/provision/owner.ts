/** House concurrency pattern: claim the tail synchronously, await the
 * previous operation inside an IIFE, and return the actual outcome to its
 * caller. A rejected operation must not poison future cleanup/admission.
 */
export class EstimateSerialOwner {
  private tail: Promise<void> = Promise.resolve()

  run<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.tail
    const result = (async () => {
      await previous
      return await action()
    })()
    this.tail = (async () => {
      try {
        await result
      } catch {
        // The caller owns this rejection; serialization alone consumes it.
      }
    })()
    return result
  }
}
