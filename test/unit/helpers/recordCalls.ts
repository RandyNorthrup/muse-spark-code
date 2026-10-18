/** Records every call's arguments, so tests assert what the real code posted. */
export function recordCalls<Args extends unknown[]>(): {
  calls: Args[]
  fn: (...args: Args) => void
} {
  const calls: Args[] = []
  const fn = (...args: Args): void => {
    calls.push(args)
  }
  return { calls, fn }
}
