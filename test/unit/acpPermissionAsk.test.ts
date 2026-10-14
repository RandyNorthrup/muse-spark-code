// MUSEPERMS (F16): one command is asked about once. The client's first
// answer applies to every later stage of the same approval and to a
// re-issued approval for the same tool call; a newer stage never opens a
// second client request while one is unanswered. Mode report: a mode the
// client set survives a later load, and the Muse Code descriptions say a
// permission rule can already allow a command.
import { describe, expect, it } from 'vitest'
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk'
import type { ApprovalChoice } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { adoptedMode, answerChoice, ApprovalAnswers } from '../../src/acp/permissionAsk'

function choice(choiceId: string, decision: string, scope: string): ApprovalChoice {
  return { choiceId, label: choiceId, decision, scope }
}

const ALLOW_ONCE = () => choice('allow-1', 'approved', 'once')
const REJECT_ONCE = () => choice('reject-1', 'abort', 'once')
const ALLOW_ALWAYS = () => choice('allow-rule', 'approved', 'session')

function selected(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } }
}

describe('ApprovalAnswers.reuse', () => {
  it('asks a first-seen approval: nothing remembered', () => {
    const answers = new ApprovalAnswers()
    expect(
      answers.reuse({ approvalId: 'a1', itemId: 't1', availableChoices: [ALLOW_ONCE()] }),
    ).toBeUndefined()
  })

  it('reuses an allow-once answer on the next stage without asking again', () => {
    const answers = new ApprovalAnswers()
    answers.remember('a1', 't1', ALLOW_ONCE())
    const next = [choice('allow-2', 'approved', 'once'), choice('reject-2', 'abort', 'once')]
    expect(answers.reuse({ approvalId: 'a1', itemId: 't1', availableChoices: next })).toEqual(
      next[0],
    )
  })

  it('matches by meaning, not by choice id, which changes per stage', () => {
    const answers = new ApprovalAnswers()
    answers.remember('a1', 't1', ALLOW_ONCE())
    const next = [choice('different-id', 'approved', 'once')]
    expect(answers.reuse({ approvalId: 'a1', itemId: 't1', availableChoices: next })).toEqual(
      next[0],
    )
  })

  it('reuses the tool call answer when the CLI re-issues under a new approval id', () => {
    const answers = new ApprovalAnswers()
    answers.remember('a1', 't1', ALLOW_ONCE())
    const next = [choice('allow-9', 'approved', 'once')]
    expect(answers.reuse({ approvalId: 'a2', itemId: 't1', availableChoices: next })).toEqual(
      next[0],
    )
  })

  it('applies a denial to the later stages too, without asking again', () => {
    const answers = new ApprovalAnswers()
    answers.remember('a1', 't1', REJECT_ONCE())
    const next = [choice('allow-2', 'approved', 'once'), choice('reject-2', 'abort', 'once')]
    expect(answers.reuse({ approvalId: 'a1', itemId: 't1', availableChoices: next })).toEqual(
      next[1],
    )
  })

  it('never escalates allow-once into an allow-always rule on its own', () => {
    const answers = new ApprovalAnswers()
    answers.remember('a1', 't1', ALLOW_ONCE())
    // The new stage offers only a persistent rule and a refusal: asking again
    // is the only safe move, so there is no reuse.
    expect(
      answers.reuse({ approvalId: 'a1', itemId: 't1', availableChoices: [ALLOW_ALWAYS()] }),
    ).toBeUndefined()
  })

  it('forgets a settled approval but keeps the tool call answer', () => {
    const answers = new ApprovalAnswers()
    answers.remember('a1', 't1', ALLOW_ONCE())
    answers.resolved('a1')
    const next = [choice('allow-2', 'approved', 'once')]
    expect(answers.reuse({ approvalId: 'a1', itemId: 't1', availableChoices: next })).toEqual(
      next[0],
    )
  })
})

describe('ApprovalAnswers.claim', () => {
  it('admits one asker per approval and readmits after release', () => {
    const answers = new ApprovalAnswers()
    expect(answers.claim('a1')).toBe(true)
    expect(answers.claim('a1')).toBe(false)
    answers.release('a1')
    expect(answers.claim('a1')).toBe(true)
  })
})

describe('answerChoice', () => {
  it('applies the picked meaning to the latest stage', () => {
    const latest = [choice('allow-9', 'approved', 'once'), choice('reject-9', 'abort', 'once')]
    expect(answerChoice(selected('allow-1'), [ALLOW_ONCE(), REJECT_ONCE()], latest)).toEqual(
      latest[0],
    )
  })

  it('has no answer when the picked meaning is gone from the latest stage', () => {
    const latest = [ALLOW_ALWAYS(), choice('reject-9', 'abort', 'once')]
    expect(answerChoice(selected('allow-1'), [ALLOW_ONCE()], latest)).toBeUndefined()
  })

  it('has no answer when the client cancelled', () => {
    const latest = [choice('allow-9', 'approved', 'once')]
    expect(
      answerChoice({ outcome: { outcome: 'cancelled' } }, [ALLOW_ONCE()], latest),
    ).toBeUndefined()
  })
})

describe('adoptedMode', () => {
  it('keeps the mode the client set across a later load', () => {
    expect(adoptedMode('acceptEdits', 'manual', false)).toBe('acceptEdits')
  })

  it('starts new sessions in the initial mode', () => {
    expect(adoptedMode(undefined, 'manual', false)).toBe('manual')
  })

  it('still opens untrusted content in an asking mode', () => {
    expect(adoptedMode(undefined, 'auto', true)).toBe('manual')
  })
})

describe('Muse Code mode descriptions (F13)', () => {
  it('says a permission rule can already allow a command', () => {
    expect(UI_TEXT.permissionModeDetails.manual).toContain('permission rule')
    expect(UI_TEXT.permissionModeDetails.acceptEdits).toContain('permission rule')
  })
})
