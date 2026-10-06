import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  commitDraftSchema,
  compactionSummarySchema,
  hookDecisionSchema,
  judgeDistributionAnswerSchema,
  judgeNoulAnswerSchema,
  pullRequestDraftSchema,
  reviewerAnswerSchema,
} from '../../src/shared/sideCallSchemas'
import {
  AUTO_REVIEWER_REASON_MAX_CHARS,
  COMMIT_SUBJECT_MAX_CHARS,
  HOOK_OUTPUT_MAX_BYTES,
} from '../../src/shared/constants'

describe('M106 side-call contracts', () => {
  it('accepts explicit reviewer decisions with bounded, nonblank reasons', () => {
    for (const decision of ['allow', 'ask']) {
      expect(
        reviewerAnswerSchema.safeParse({ decision, reason: 'Read-only request' }).success,
      ).toBe(true)
    }
    for (const answer of [
      { decision: 'allow' },
      { decision: 'deny', reason: 'No' },
      { decision: 'allow', reason: ' \n\t' },
      { decision: 'allow', reason: 'x'.repeat(AUTO_REVIEWER_REASON_MAX_CHARS + 1) },
      { decision: 'allow', reason: 'Yes', permissionDecision: 'allow' },
    ]) {
      expect(reviewerAnswerSchema.safeParse(answer).success).toBe(false)
    }
  })

  it('bounds stated confidence to finite percentage points', () => {
    expect(judgeNoulAnswerSchema.parse({ answer: 'yes', confidence: 100 })).toEqual({
      answer: 'yes',
      confidence: 100,
    })
    expect(judgeNoulAnswerSchema.safeParse({ answer: 'no', confidence: 0 }).success).toBe(true)
    for (const confidence of [-1, 100 + 1, Infinity, NaN, '100', null]) {
      expect(judgeNoulAnswerSchema.safeParse({ answer: 'yes', confidence }).success).toBe(false)
    }
    expect(judgeNoulAnswerSchema.safeParse({ answer: 'maybe', confidence: 100 }).success).toBe(
      false,
    )
    expect(judgeNoulAnswerSchema.safeParse({ answer: 'yes' }).success).toBe(false)
  })

  it('requires exactly the caller’s options and positive distribution mass', () => {
    const schema = judgeDistributionAnswerSchema(2)
    expect(schema.parse({ probabilities: [1, 2] })).toEqual({ probabilities: [1, 2] })
    for (const probabilities of [[], [100], [0, 0], [-1, 100], [1, 100 + 1], [0, 0, 100]]) {
      expect(schema.safeParse({ probabilities }).success).toBe(false)
    }
    for (const count of [0, -1, 1 / 2, Infinity]) {
      expect(() => judgeDistributionAnswerSchema(count)).toThrow(RangeError)
    }
  })

  it('keeps hook decisions unable to grant or rewrite a tool', () => {
    const continued = { decision: 'continue', reason: null, additionalContext: 'Read this first' }
    const blocked = { decision: 'block', reason: 'Unsafe request', additionalContext: null }
    expect(hookDecisionSchema.parse(continued)).toEqual(continued)
    expect(hookDecisionSchema.parse(blocked)).toEqual(blocked)
    for (const answer of [
      { ...continued, decision: 'allow' },
      { ...continued, permissionDecision: 'allow' },
      { ...continued, updatedInput: { command: 'changed' } },
      { ...blocked, reason: null },
      { ...blocked, reason: ' ' },
      { ...continued, reason: 'Misplaced reason' },
      { decision: 'continue' },
      { ...continued, additionalContext: 'x'.repeat(HOOK_OUTPUT_MAX_BYTES + 1) },
    ]) {
      expect(hookDecisionSchema.safeParse(answer).success).toBe(false)
    }
  })

  it('requires usable Git drafts and preserves their text for the caller’s redactor', () => {
    const message = 'Fix the bounds\n\nRetain settlement.'
    expect(commitDraftSchema.parse({ message })).toEqual({ message })
    expect(pullRequestDraftSchema.parse({ title: 'Fix the bounds', body: '' })).toEqual({
      title: 'Fix the bounds',
      body: '',
    })
    expect(commitDraftSchema.safeParse({ message: ' \n' }).success).toBe(false)
    expect(commitDraftSchema.safeParse({ message, push: true }).success).toBe(false)
    for (const draft of [
      { title: ' ', body: 'Description' },
      { title: 'x'.repeat(COMMIT_SUBJECT_MAX_CHARS + 1), body: 'Description' },
      { title: 'Valid title' },
      { title: 'Valid title', body: null },
    ]) {
      expect(pullRequestDraftSchema.safeParse(draft).success).toBe(false)
    }
  })

  it('exports strict JSON Schema objects with every field required', () => {
    for (const schema of [
      reviewerAnswerSchema,
      judgeNoulAnswerSchema,
      judgeDistributionAnswerSchema(2),
      hookDecisionSchema,
      commitDraftSchema,
      pullRequestDraftSchema,
      compactionSummarySchema,
    ]) {
      const json = z.toJSONSchema(schema)
      expect(json.type).toBe('object')
      expect(json.additionalProperties).toBe(false)
      expect(json.required).toEqual(Object.keys(json.properties ?? {}))
    }
  })

  it('requires C1’s six prose sections without accepting host metadata from the model', () => {
    const answer = {
      goal: 'Finish the task',
      constraints: 'No live calls',
      progress: 'Completed: capture inventory. In progress: contracts. Blocked: none.',
      decisions: 'Keep the current replay wrapper',
      nextSteps: 'Validate the answer',
      criticalContext: 'Exact path: src/core/backends/modelapi/ModelApiHost.ts',
    }
    expect(compactionSummarySchema.parse(answer)).toEqual(answer)
    for (const key of Object.keys(answer)) {
      expect(compactionSummarySchema.safeParse({ ...answer, [key]: ' \n' }).success).toBe(false)
      const incomplete = Object.fromEntries(Object.entries(answer).filter(([name]) => name !== key))
      expect(compactionSummarySchema.safeParse(incomplete).success).toBe(false)
    }
    for (const metadata of [{ read: ['claimed.ts'] }, { todos: [] }, { keptEntries: 1 }]) {
      expect(compactionSummarySchema.safeParse({ ...answer, ...metadata }).success).toBe(false)
    }
  })
})
