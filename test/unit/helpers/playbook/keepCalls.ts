// A function wrapper for the playbook suites' scripted ports: runs its
// implementation and keeps the calls it saw, in order. Shared so the
// suites cannot drift apart.
export function keepCalls<T extends unknown[], R>(
  impl: (...args: T) => R,
): ((...args: T) => R) & {
  calls: T[]
} {
  const calls: T[] = []
  const fn = (...args: T): R => {
    calls.push(args)
    return impl(...args)
  }
  return Object.assign(fn, { calls })
}
