import { describe, expect, it } from 'vitest'
import {
  PLAYBOOK_FINDING_CLASSES,
  REVIEW_FINDINGS_EXAMPLE,
  REVIEW_FINDINGS_EMPTY,
  REVIEW_FINDINGS_MAX,
  REVIEW_FINDING_TEXT_MAX_CHARS,
} from '../../src/shared/constants'
import {
  parseReviewBlock,
  parseReviewFindings,
  type ReviewResolution,
} from '../../src/shared/reviewFindings'

const oldFinding = { file: 'src/a.ts', line: 1, title: 'Racy claim' }
describe('M116 additive review block', () => {
  it('keeps old blocks and M70 prompt examples valid, without adding metadata', () => {
    expect(parseReviewBlock(JSON.stringify({ findings: [oldFinding] }))).toEqual({
      findings: [oldFinding],
    })
    expect(parseReviewFindings(REVIEW_FINDINGS_EXAMPLE)).toHaveLength(1)
    expect(parseReviewFindings(REVIEW_FINDINGS_EMPTY)).toEqual([])
  })
  it.each(['impossible', 'caught', 'remains'] as const)(
    'retains coverage, class and %s resolution for the prior host id',
    (outcome) => {
      const resolution: ReviewResolution = {
        findingId: 'store-claim',
        outcome,
        reason: 'One atomic claim.',
      }
      const review = {
        findings: [{ ...oldFinding, class: 'concurrency' }],
        coverage: [...PLAYBOOK_FINDING_CLASSES],
        resolution: [resolution],
      }
      expect(parseReviewBlock(JSON.stringify(review))).toEqual(review)
      expect(parseReviewFindings(JSON.stringify(review))).toEqual(review.findings)
    },
  )
  it('preserves unknown classes and coverage so the policy can report incomplete reviews', () => {
    const review = {
      findings: [{ ...oldFinding, class: 'future-class' }],
      coverage: ['future-class'],
    }
    expect(parseReviewBlock(JSON.stringify(review))).toEqual(review)
    expect(parseReviewBlock('not json')).toBeUndefined()
  })
  it.each([
    { findings: [{ ...oldFinding, class: '' }] },
    { findings: [{ ...oldFinding, class: 1 }] },
    { findings: [oldFinding], coverage: 'security' },
    { findings: [oldFinding], coverage: [''] },
    {
      findings: [oldFinding],
      coverage: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => 'docs'),
    },
    { findings: [oldFinding], resolution: [{ findingId: 'a', outcome: 'fixed', reason: 'r' }] },
    { findings: [oldFinding], resolution: [{ findingId: '', outcome: 'impossible', reason: 'r' }] },
    {
      findings: [oldFinding],
      resolution: [{ findingId: 'a', outcome: 'impossible', reason: ' ' }],
    },
    {
      findings: [oldFinding],
      resolution: [
        {
          findingId: 'a',
          outcome: 'impossible',
          reason: 'r'.repeat(REVIEW_FINDING_TEXT_MAX_CHARS + 1),
        },
      ],
    },
    {
      findings: [oldFinding],
      resolution: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => ({
        findingId: 'a',
        outcome: 'caught',
        reason: 'r',
      })),
    },
  ])('rejects malformed or unbounded metadata: %j', (review) => {
    expect(parseReviewBlock(JSON.stringify(review))).toBeUndefined()
    expect(parseReviewFindings(JSON.stringify(review))).toBeUndefined()
  })
})
