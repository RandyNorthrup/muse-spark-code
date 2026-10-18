/** Baseline-then-busiest finish shared by the per-OS disk deltas. Counters
 * arrive in milliseconds of busy time; the busiest whole device wins, capped
 * at 100. A missing baseline, still or reversed time, a changed device set
 * or a regressed counter stores the new baseline and reads unknown. */
export interface DiskDeltaBaseline {
  readonly atMs: number
  readonly counters: ReadonlyMap<string, number>
}

export function finishDiskDelta(
  before: DiskDeltaBaseline | undefined,
  atMs: number,
  counters: Map<string, number>,
): { readonly store: DiskDeltaBaseline | undefined; readonly busy: number | null } {
  if (counters.size === 0) return { store: undefined, busy: null }
  const store = { atMs, counters }
  if (before === undefined || atMs <= before.atMs || before.counters.size !== counters.size)
    return { store, busy: null }
  let busiest = 0
  for (const [identity, current] of counters) {
    const old = before.counters.get(identity)
    if (old === undefined || current < old) return { store, busy: null }
    busiest = Math.max(busiest, ((current - old) / (atMs - before.atMs)) * 100)
  }
  return { store, busy: Math.min(100, busiest) }
}
