/** One portable feature owner: cancellation starts immediately and release drains accepted work. */
export function runtimeFeatureLifetime(assertCurrent: () => void, cancelPrompts?: () => void) {
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  function check(): void {
    ending.signal.throwIfAborted()
    assertCurrent()
  }
  return {
    signal: ending.signal,
    check,
    track: async <T>(work: () => Promise<T>): Promise<T> => {
      check()
      const operation = work()
      pending.add(operation)
      try {
        const result = await operation
        check()
        return result
      } finally {
        pending.delete(operation)
      }
    },
    dispose: (): Promise<void> => {
      ending.abort()
      closing ??= (async () => {
        try {
          cancelPrompts?.()
        } finally {
          await Promise.allSettled(pending)
        }
      })()
      return closing
    },
  }
}
