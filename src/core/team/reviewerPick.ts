// The reviewer's pick (M96 lane I, PLAN.md D75): `merge` of a writing task
// is refused until a `code-review` task has reviewed the branch's current
// head. The runner chooses the first entry with headroom whose model
// differs from every model that wrote the change: each entry that worked on
// the branch (through `continue` or continue on next), and the
// orchestrator's model for edits it made itself.
//
// Two models are the same when lane R's `sameModel` says so (injected: the
// registry's model id, whatever provider serves them). An external agent's
// model is the one it reports, or else its vendor: that shaping is lane A /
// lane R data, arriving here as plain model ids. Pure: no git, no `vscode`.

/** A reviewer entry lane A reports: its model and whether it has headroom. */
export interface ReviewCandidate {
  readonly entryId: string
  readonly modelId: string
  readonly hasHeadroom: boolean
}

/** The chosen reviewer: `sameModel` marks the fallback the map shows. */
export interface ReviewPick {
  readonly entryId: string
  readonly modelId: string
  readonly sameModel: boolean
}

/**
 * The first entry with headroom whose model differs from every author, or
 * — when every reviewer with headroom shares an author's model — the first
 * entry with headroom, marked `sameModel`. No reviewer with headroom (or
 * none staffed) is `undefined`: the merge then goes ahead marked "not
 * reviewed" (reviewGate.ts).
 */
export function pickReviewer(
  authors: readonly string[],
  candidates: readonly ReviewCandidate[],
  isSameModel: (left: string, right: string) => boolean,
): ReviewPick | undefined {
  const ready = candidates.filter((candidate) => candidate.hasHeadroom)
  const other = ready.find((candidate) =>
    authors.every((author) => !isSameModel(candidate.modelId, author)),
  )
  if (other !== undefined) {
    return { entryId: other.entryId, modelId: other.modelId, sameModel: false }
  }
  const first = ready[0]
  return first === undefined
    ? undefined
    : { entryId: first.entryId, modelId: first.modelId, sameModel: true }
}
