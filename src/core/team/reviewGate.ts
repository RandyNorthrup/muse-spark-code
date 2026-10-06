// Review before merge (M96 lane I, PLAN.md D75): with a reviewer that has
// headroom, `merge` is refused until the branch's current head has been
// reviewed. With no reviewer (none staffed, or none with headroom) the
// merge is marked "not reviewed" and asks in every mode that allows one.
// `.muse/team.json` can require a different model, in which case a
// same-model review is refused instead of marked. Pure: no git, no
// `vscode`.

import type { ReviewPick } from './reviewerPick'

export interface ReviewGateState {
  /** The branch head a review already covered, if any. */
  readonly reviewedHead: string | undefined
  /** Provenance of the completed review, never the next available reviewer. */
  readonly reviewedBy?: (ReviewPick & { readonly head: string }) | undefined
  /** The branch's current head. */
  readonly branchHead: string
  /** The pick for this branch, if any reviewer has headroom. */
  readonly reviewer: ReviewPick | undefined
  /** `.muse/team.json` requires a reviewer of a different model. */
  readonly requireDifferentModel: boolean
}

export type ReviewGateVerdict =
  /** The current head was reviewed: merge may proceed. */
  | { readonly ok: true; readonly review: 'current' }
  /** No reviewer to ask: the merge is marked "not reviewed" by its card. */
  | { readonly ok: true; readonly review: 'notReviewed' }
  /** The branch moved since (or never had) a review: review it first. */
  | {
      readonly ok: false
      readonly reason: 'needsReview'
      readonly entryId: string
      readonly sameModel: boolean
    }
  /** Same-model review, but the repository requires a different model. */
  | { readonly ok: false; readonly reason: 'sameModelRefused' }

export function reviewGate(state: ReviewGateState): ReviewGateVerdict {
  if (state.reviewedHead !== undefined && state.reviewedHead === state.branchHead) {
    const reviewedBy = state.reviewedBy?.head === state.reviewedHead ? state.reviewedBy : undefined
    if (!state.requireDifferentModel || reviewedBy?.sameModel === false) {
      return { ok: true, review: 'current' }
    }
    if (reviewedBy?.sameModel === true) {
      return { ok: false, reason: 'sameModelRefused' }
    }
  }
  const reviewer = state.reviewer
  if (reviewer === undefined) {
    return { ok: true, review: 'notReviewed' }
  }
  if (reviewer.sameModel && state.requireDifferentModel) {
    return { ok: false, reason: 'sameModelRefused' }
  }
  return {
    ok: false,
    reason: 'needsReview',
    entryId: reviewer.entryId,
    sameModel: reviewer.sameModel,
  }
}
