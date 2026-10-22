// M96d review carry-over: a review carries a change to its branch only
// for files whose exact delta (path, mode, and the bytes before and
// after, bound by git blob oids) is unchanged since the review read
// them. Changed files are reviewed again. A patch ID may hint which
// files to compare, and is never the acceptance key: it ignores
// whitespace, even inside strings. A change in the integration context
// around an unchanged delta is reviewed again when it touches a file
// the change reads; an unknown context carries nothing.

export interface CarryFileDelta {
  readonly path: string
  readonly baseOid: string
  readonly baseMode: string
  readonly headOid: string
  readonly headMode: string
}

export interface CarryFileVerdict<TFinding> {
  readonly delta: CarryFileDelta
  readonly verdict: 'clean' | 'findings'
  readonly findings: readonly TFinding[]
}

export interface CarryPatchHints {
  readonly before: ReadonlyMap<string, string>
  readonly after: ReadonlyMap<string, string>
}

export interface CarryContext {
  /** Patch-ID hints narrowing the comparison; never the acceptance key. */
  readonly patchHints?: CarryPatchHints
  /** Files the integration changed between the heads; unknown carries nothing. */
  readonly integrationChanged?: readonly string[]
  /** What each changed file reads; unknown carries nothing. */
  readonly readSets?: ReadonlyMap<string, readonly string[]>
}

export interface CarryDecision<TFinding> {
  readonly carried: CarryFileVerdict<TFinding>[]
  readonly reReview: string[]
}

function isSameDelta(left: CarryFileDelta, right: CarryFileDelta): boolean {
  return (
    left.path === right.path &&
    left.baseOid === right.baseOid &&
    left.baseMode === right.baseMode &&
    left.headOid === right.headOid &&
    left.headMode === right.headMode
  )
}

/**
Partition paths by patch-ID hint: a changed patch ID proves the file
changed, so it skips the byte comparison straight to re-review. An
unchanged or missing hint proves nothing and the file is compared.
*/
export function selectChangedByPatchId(
  paths: readonly string[],
  hints: CarryPatchHints | undefined,
): { definitelyChanged: string[]; needsCompare: string[] } {
  const definitelyChanged: string[] = []
  const needsCompare: string[] = []
  for (const path of paths) {
    const before = hints?.before.get(path)
    const after = hints?.after.get(path)
    if (before !== undefined && after !== undefined && before !== after)
      definitelyChanged.push(path)
    else needsCompare.push(path)
  }
  return { definitelyChanged, needsCompare }
}

/**
Carry the prior per-file verdicts over the current deltas. A file
carries only when its exact delta is unchanged and the integration
context provably left everything it reads alone; anything else,
including any unknown, is reviewed again.
*/
export function decideReviewCarryOver<TFinding>(
  prior: readonly CarryFileVerdict<TFinding>[],
  current: readonly CarryFileDelta[],
  context?: CarryContext,
): CarryDecision<TFinding> {
  const priorByPath = new Map(prior.map((verdict) => [verdict.delta.path, verdict]))
  const currentByPath = new Map(current.map((delta) => [delta.path, delta]))
  const { definitelyChanged, needsCompare } = selectChangedByPatchId(
    current.map((delta) => delta.path),
    context?.patchHints,
  )
  const reReview = new Set(definitelyChanged)
  const carried: CarryFileVerdict<TFinding>[] = []
  const changed = context?.integrationChanged
  const readSets = context?.readSets
  for (const path of needsCompare) {
    const delta = currentByPath.get(path)
    const previous = priorByPath.get(path)
    if (delta === undefined || previous === undefined || !isSameDelta(previous.delta, delta)) {
      reReview.add(path)
      continue
    }
    // An unknown integration context carries nothing: only a provable
    // miss lets an unchanged delta keep its verdict.
    if (changed === undefined || readSets === undefined) {
      reReview.add(path)
      continue
    }
    const reads = readSets.get(path) ?? []
    if (reads.some((read) => changed.includes(read))) reReview.add(path)
    else carried.push(previous)
  }
  return { carried, reReview: [...reReview] }
}
