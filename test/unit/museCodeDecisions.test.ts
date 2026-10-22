// `approval/decide` feedback admission (Muse Code 1.4.11): the host refuses
// feedback on a choice that does not accept it (the SDK's
// `feedbackNotAccepted` failure), so the client sends the decision without
// it and the turn goes on. The scheduled path's abort-with-reason is the
// shape that must drop its reason; the card's accepted feedback rides.
import { describe, expect, it } from 'vitest'
import type { ApprovalDecision } from '../../src/core/agent/agentBackend'
import { stripUnacceptedDecisionFeedback } from '../../src/core/backends/musecode/MuseCodeHost'
import type { ApprovalChoice } from '../../src/shared/agentEvents'

const requirementId = { approvalId: 'a1', sourceIndex: 0 }

function choice(overrides: Partial<ApprovalChoice> = {}): ApprovalChoice {
  return {
    choiceId: 'abort',
    label: 'Abort',
    decision: 'abort',
    scope: 'once',
    ...overrides,
  }
}

function decision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return { approvalId: 'a1', choiceId: 'abort', requirementId, ...overrides }
}

describe('approval/decide feedback admission', () => {
  it('drops the reason where the choice takes no feedback', () => {
    expect(
      stripUnacceptedDecisionFeedback([choice()], decision({ feedback: 'the turn is refused' })),
    ).toEqual(decision())
  })

  it('keeps the reason where the choice accepts it', () => {
    const decided = decision({ choiceId: 'deny', feedback: 'use the other tool' })
    expect(
      stripUnacceptedDecisionFeedback(
        [choice(), choice({ choiceId: 'deny', acceptsFeedback: true })],
        decided,
      ),
    ).toBe(decided)
  })

  it('keeps a decision the ledger never saw for the host to refuse', () => {
    const decided = decision({ feedback: 'the turn is refused' })
    expect(stripUnacceptedDecisionFeedback(undefined, decided)).toBe(decided)
    expect(stripUnacceptedDecisionFeedback([choice({ choiceId: 'other' })], decided)).toBe(decided)
  })

  it('passes a decision without feedback through untouched', () => {
    const decided = decision()
    expect(stripUnacceptedDecisionFeedback([choice()], decided)).toBe(decided)
  })
})
