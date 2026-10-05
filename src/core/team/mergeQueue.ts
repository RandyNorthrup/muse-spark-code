import {
  TEAM_BLAST_WEIGHTS,
  TEAM_MERGE_BATCH_MAX,
  TEAM_MERGE_BATCH_SMALL_LINES,
  TEAM_MERGE_FLAKE_RETRIES,
  TEAM_PRIORITY_WEIGHTS,
} from '../../shared/constants'
import type { TeamSchedulerFields } from '../../shared/team'

export interface MergeCandidate {
  readonly id: string
  /** Only `merged` edges belong here; `done` edges do not order landings. */
  readonly dependsOn: readonly string[]
  readonly priority: TeamSchedulerFields['priority']
  readonly inheritedPriority?: TeamSchedulerFields['priority']
  readonly conflictsWith: readonly string[]
  readonly changedLines: number
  readonly files: readonly { readonly shared: boolean; readonly protected: boolean }[]
  readonly finishedAt: number
  readonly onConflict: 'rework' | 'markers'
}

function weight(candidate: MergeCandidate): number {
  return Math.max(
    TEAM_PRIORITY_WEIGHTS[candidate.priority],
    TEAM_PRIORITY_WEIGHTS[candidate.inheritedPriority ?? candidate.priority],
  )
}

function blast(candidate: MergeCandidate): number {
  return (
    candidate.changedLines +
    candidate.files.reduce(
      (sum, file) =>
        sum +
        TEAM_BLAST_WEIGHTS.file +
        (file.shared ? TEAM_BLAST_WEIGHTS.sharedFile : 0) +
        (file.protected ? TEAM_BLAST_WEIGHTS.protectedPath : 0),
      0,
    )
  )
}

/** Topological order, then inherited priority, conflicts, blast radius and finish. */
export function orderMergeQueue(
  candidates: readonly MergeCandidate[],
  merged: ReadonlySet<string>,
): { readonly ordered: readonly MergeCandidate[]; readonly held: readonly MergeCandidate[] } {
  const pending = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  if (pending.size !== candidates.length) throw new Error('duplicate merge candidate')
  const priorities = new Map(candidates.map((candidate) => [candidate.id, weight(candidate)]))
  // Bounded relaxation passes propagate waiters' priorities through the DAG.
  for (const _pass of candidates) {
    for (const candidate of candidates) {
      for (const dependency of candidate.dependsOn) {
        const current = priorities.get(dependency)
        if (current !== undefined) {
          priorities.set(dependency, Math.max(current, priorities.get(candidate.id) ?? 0))
        }
      }
    }
  }
  const ordered: MergeCandidate[] = []
  const landed = new Set(merged)
  while (pending.size > 0) {
    const ready = candidates.filter(
      (candidate) => pending.has(candidate.id) && candidate.dependsOn.every((id) => landed.has(id)),
    )
    ready.sort(
      (left, right) =>
        (priorities.get(right.id) ?? 0) - (priorities.get(left.id) ?? 0) ||
        left.conflictsWith.filter((id) => pending.has(id)).length -
          right.conflictsWith.filter((id) => pending.has(id)).length ||
        blast(left) - blast(right) ||
        left.finishedAt - right.finishedAt ||
        left.id.localeCompare(right.id),
    )
    const next = ready[0]
    if (next === undefined) break
    ordered.push(next)
    landed.add(next.id)
    pending.delete(next.id)
  }
  return { ordered, held: candidates.filter((candidate) => pending.has(candidate.id)) }
}

/** Consecutive small candidates; every prerequisite is landed or in this batch. */
export function nextMergeBatch(
  ordered: readonly MergeCandidate[],
  merged: ReadonlySet<string>,
): readonly MergeCandidate[] {
  const batch: MergeCandidate[] = []
  const available = new Set(merged)
  for (const candidate of ordered) {
    if (
      batch.length >= TEAM_MERGE_BATCH_MAX ||
      candidate.dependsOn.some((id) => !available.has(id))
    )
      break
    if (
      batch.length > 0 &&
      (candidate.changedLines >= TEAM_MERGE_BATCH_SMALL_LINES ||
        batch.some(
          (other) =>
            other.changedLines >= TEAM_MERGE_BATCH_SMALL_LINES ||
            candidate.conflictsWith.includes(other.id) ||
            other.conflictsWith.includes(candidate.id),
        ))
    )
      break
    batch.push(candidate)
    available.add(candidate.id)
    if (candidate.changedLines >= TEAM_MERGE_BATCH_SMALL_LINES) break
  }
  return batch
}

export interface CheckFailure {
  readonly id: string
  readonly output: string
}
export type MergeTrial<T> =
  | { readonly status: 'merged'; readonly tree: T }
  | {
      readonly status: 'conflict'
      readonly kind: 'text' | 'json-table' | 'changelog'
      readonly tree?: T
      readonly output: string
    }
  | { readonly status: 'refused'; readonly output: string }

export interface MergeAdmissionDeps<T> {
  /** Each trial returns an independent tree: a rejected trial cannot mutate the prior tree. */
  readonly merge: (tree: T, candidate: MergeCandidate) => Promise<MergeTrial<T>>
  /** `only` reruns exactly the failed checks on the same tree. */
  readonly check: (tree: T, only?: readonly string[]) => Promise<readonly CheckFailure[]>
  /** Rework in the task copy, then full review; never write the user's tree. */
  readonly rework: (candidate: MergeCandidate, failures: readonly CheckFailure[]) => Promise<void>
}

export interface MergeAdmission<T> {
  readonly tree: T
  readonly admitted: readonly string[]
  readonly returned: readonly string[]
  readonly held: readonly string[]
  readonly flaky: readonly string[]
  readonly checkRuns: number
}

/** A failed batch gets one rerun, then cumulative serial admission, never bisection. */
export async function admitMergeBatch<T>(
  initial: T,
  candidates: readonly MergeCandidate[],
  merged: ReadonlySet<string>,
  deps: MergeAdmissionDeps<T>,
): Promise<MergeAdmission<T>> {
  if (candidates.length > TEAM_MERGE_BATCH_MAX) throw new Error('merge batch exceeds cap')
  let checkRuns = 0
  const returned: string[] = []
  const held: string[] = []
  const flaky: string[] = []
  const admitted: string[] = []
  const available = new Set(merged)
  const survivors: MergeCandidate[] = []
  const trial = async (tree: T, candidate: MergeCandidate): Promise<T | undefined> => {
    const result = await deps.merge(tree, candidate)
    if (result.status === 'merged') return result.tree
    if (
      result.status === 'conflict' &&
      result.kind === 'text' &&
      candidate.onConflict === 'markers' &&
      result.tree !== undefined
    )
      return result.tree
    returned.push(candidate.id)
    await deps.rework(candidate, [{ id: 'merge', output: result.output }])
    return undefined
  }
  let batchTree = initial
  for (const candidate of candidates) {
    if (candidate.dependsOn.some((id) => !available.has(id))) {
      held.push(candidate.id)
      continue
    }
    const next = await trial(batchTree, candidate)
    if (next === undefined) continue
    batchTree = next
    survivors.push(candidate)
    available.add(candidate.id)
  }
  if (survivors.length === 0) return { tree: initial, admitted, returned, held, flaky, checkRuns }
  let failures = await deps.check(batchTree)
  checkRuns += 1
  for (let retry = 0; failures.length > 0 && retry < TEAM_MERGE_FLAKE_RETRIES; retry += 1) {
    const previous = failures
    failures = await deps.check(
      batchTree,
      previous.map((failure) => failure.id),
    )
    checkRuns += 1
    if (failures.length === 0) flaky.push(...previous.map((failure) => failure.id))
  }
  if (failures.length === 0)
    return {
      tree: batchTree,
      admitted: survivors.map((candidate) => candidate.id),
      returned,
      held,
      flaky,
      checkRuns,
    }
  available.clear()
  for (const id of merged) available.add(id)
  let tree = initial
  for (const candidate of survivors) {
    if (candidate.dependsOn.some((id) => !available.has(id))) {
      held.push(candidate.id)
      continue
    }
    const next = await trial(tree, candidate)
    if (next === undefined) continue
    const result = await deps.check(next)
    checkRuns += 1
    if (result.length > 0) {
      returned.push(candidate.id)
      await deps.rework(candidate, result)
    } else {
      tree = next
      admitted.push(candidate.id)
      available.add(candidate.id)
    }
  }
  return { tree, admitted, returned, held, flaky, checkRuns }
}
