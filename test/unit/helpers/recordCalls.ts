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

// A hand-written collaborator double: records every call, runs queued
// one-shot behaviors first, else the current default. The unit under test
// stays real; only the outside-world boundary answers from the script.
export interface Scripted<Args extends unknown[], Result> {
  (...args: Args): Result
  readonly calls: Args[]
  /** Run once before the default, in queue order. */
  once(behavior: (...args: Args) => Result): void
  /** Replace the default behavior (queued one-shots still run first). */
  use(behavior: (...args: Args) => Result): void
  /** Clear calls and queue; restore the built-in default (or set a new one). */
  reset(behavior?: (...args: Args) => Result): void
}
export function scripted<Args extends unknown[], Result>(
  defaultBehavior: (...args: Args) => Result,
): Scripted<Args, Result> {
  let behavior = defaultBehavior
  const queue: ((...args: Args) => Result)[] = []
  const calls: Args[] = []
  const fn = (...args: Args): Result => {
    calls.push(args)
    const next = queue.shift() ?? behavior
    return next(...args)
  }
  return Object.assign(fn, {
    calls,
    once: (next: (...args: Args) => Result): void => {
      queue.push(next)
    },
    use: (next: (...args: Args) => Result): void => {
      behavior = next
    },
    reset: (next: (...args: Args) => Result = defaultBehavior): void => {
      queue.length = 0
      calls.length = 0
      behavior = next
    },
  })
}
