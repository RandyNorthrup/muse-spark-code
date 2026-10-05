// Lane I's review gate (PLAN.md D75, M96 acceptance 19 and the review's
// fixes): review before merge, and the reviewer pick that differs from every
// author. Pure: no git, no fs.

import { describe, expect, it } from 'vitest'
import { reviewGate, type ReviewGateState } from '../../src/core/team/reviewGate'
import { pickReviewer } from '../../src/core/team/reviewerPick'

/** Model sameness by id, as lane R's `sameModel` reports it here. */
const isSameModel = (left: string, right: string): boolean => left === right

function state(overrides: Partial<ReviewGateState>): ReviewGateState {
  return {
    reviewedHead: undefined,
    branchHead: 'head-2',
    reviewer: undefined,
    requireDifferentModel: false,
    ...overrides,
  }
}

describe('reviewGate', () => {
  it('merges a reviewed current head', () => {
    expect(
      reviewGate(
        state({
          reviewedHead: 'head-2',
          reviewer: { entryId: 'r1', modelId: 'm-b', sameModel: false },
        }),
      ),
    ).toEqual({ ok: true, review: 'current' })
  })

  it('refuses an unreviewed branch while a reviewer has headroom', () => {
    expect(
      reviewGate(state({ reviewer: { entryId: 'r1', modelId: 'm-b', sameModel: false } })),
    ).toEqual({ ok: false, reason: 'needsReview', entryId: 'r1', sameModel: false })
  })

  it('refuses a stale review after the branch moved', () => {
    expect(
      reviewGate(
        state({
          reviewedHead: 'head-1',
          reviewer: { entryId: 'r1', modelId: 'm-b', sameModel: false },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'needsReview' })
  })

  it('marks not reviewed when no reviewer has headroom', () => {
    expect(reviewGate(state({}))).toEqual({ ok: true, review: 'notReviewed' })
  })

  it('marks a same-model review instead of refusing it', () => {
    expect(
      reviewGate(state({ reviewer: { entryId: 'r1', modelId: 'm-a', sameModel: true } })),
    ).toEqual({ ok: false, reason: 'needsReview', entryId: 'r1', sameModel: true })
  })

  it('refuses a same-model review the repository forbids', () => {
    expect(
      reviewGate(
        state({
          reviewer: { entryId: 'r1', modelId: 'm-a', sameModel: true },
          requireDifferentModel: true,
        }),
      ),
    ).toEqual({ ok: false, reason: 'sameModelRefused' })
  })
})

describe('pickReviewer', () => {
  const candidates = [
    { entryId: 'r1', modelId: 'm-a', hasHeadroom: true },
    { entryId: 'r2', modelId: 'm-b', hasHeadroom: true },
  ]

  it('picks the first entry whose model differs from every author', () => {
    expect(pickReviewer(['m-a'], candidates, isSameModel)).toEqual({
      entryId: 'r2',
      modelId: 'm-b',
      sameModel: false,
    })
  })

  it('skips entries without headroom', () => {
    expect(
      pickReviewer(
        ['m-b'],
        [
          { entryId: 'r1', modelId: 'm-b', hasHeadroom: false },
          { entryId: 'r2', modelId: 'm-a', hasHeadroom: true },
        ],
        isSameModel,
      ),
    ).toEqual({ entryId: 'r2', modelId: 'm-a', sameModel: false })
  })

  it('differs from every author across a continued branch', () => {
    // Continued from entry A to entry B: reviewed by neither model.
    expect(pickReviewer(['m-a', 'm-b'], candidates, isSameModel)?.sameModel).toBe(true)
    expect(
      pickReviewer(
        ['m-a', 'm-b'],
        [...candidates, { entryId: 'r3', modelId: 'm-c', hasHeadroom: true }],
        isSameModel,
      ),
    ).toEqual({ entryId: 'r3', modelId: 'm-c', sameModel: false })
  })

  it('counts the orchestrator’s own edits as authorship', () => {
    expect(pickReviewer(['m-orch', 'm-a'], candidates, isSameModel)).toEqual({
      entryId: 'r2',
      modelId: 'm-b',
      sameModel: false,
    })
    expect(pickReviewer(['m-orch', 'm-a', 'm-b'], candidates, isSameModel)).toMatchObject({
      sameModel: true,
    })
  })

  it('marks same model when every ready reviewer shares an author’s model', () => {
    expect(pickReviewer(['m-a', 'm-b'], candidates, isSameModel)).toEqual({
      entryId: 'r1',
      modelId: 'm-a',
      sameModel: true,
    })
  })

  it('picks nothing when no reviewer has headroom', () => {
    expect(
      pickReviewer(
        ['m-a'],
        candidates.map((candidate) => ({ ...candidate, hasHeadroom: false })),
        isSameModel,
      ),
    ).toBeUndefined()
  })
})
