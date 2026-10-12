// Budgets for synchronous work are checked against the fastest of a few timed
// runs. A busy hosted runner's scheduling only ever adds time to a run; work
// that is really too slow (a rescan, a quadratic walk) misses the budget in
// every run (CIFIX017: 245 ms against 200, 82 ms against 50, on idle-fast code).
const RUNS = 3

/** Milliseconds of the fastest of three synchronous runs of `work`. */
export function fastestRun(work: () => unknown): number {
  let fastest = Infinity
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now()
    work()
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}

/** Milliseconds of the fastest of three awaited runs of `work`. */
export async function fastestAwaitedRun(work: () => Promise<unknown>): Promise<number> {
  let fastest = Infinity
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now()
    await work()
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}
