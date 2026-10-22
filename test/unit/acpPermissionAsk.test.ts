// MUSEPERMS (F16): one command is asked about once. The client's first
// answer applies to every later stage of the same approval and to a
// re-issued approval for the same tool call; a newer stage never opens a
// second client request while one is unanswered. Mode report: a mode the
// client set survives a later load, and the Muse Code descriptions say a
// permission rule can already allow a command.
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk/unstable'
import type { ApprovalChoice } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { approvalChoiceSchema } from '../../src/shared/agentEvents'
import { raceRequested, raceUpdated } from './helpers/stageRaceCapture'
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

describe('persistent rule consent (captured Muse Code 1.4.2, 2026-10-02)', () => {
  const first = z.array(approvalChoiceSchema).parse(raceRequested('session')['availableChoices'])
  const changed = z.array(approvalChoiceSchema).parse(raceUpdated('session', 5)['availableChoices'])
  const same = z.array(approvalChoiceSchema).parse(raceUpdated('session', 4)['availableChoices'])
  const selectedRule = first.find((entry) => entry.choiceId === 'allow_local_prefix')
  if (selectedRule === undefined) throw new Error('Capture has no persistent rule')

  it('does not reuse git show consent for Measure-Object on the same tool call', () => {
    const answers = new ApprovalAnswers()
    answers.remember('approval', 'tool', selectedRule)
    expect(
      answers.reuse({ approvalId: 'approval', itemId: 'tool', availableChoices: changed }),
    ).toBeUndefined()
    expect(
      answers.reuse({ approvalId: 'reissued', itemId: 'tool', availableChoices: changed }),
    ).toBeUndefined()
  })

  it('does not transfer a mid-ask answer to a different rule with the same choice id', () => {
    expect(answerChoice(selected('allow_local_prefix'), first, changed)).toBeUndefined()
  })

  it('reuses consent for the same captured git show rule', () => {
    expect(answerChoice(selected('allow_local_prefix'), first, same)).toEqual(same[1])
  })

  it('honors a first choice without a preview while that exact choice is still current', () => {
    const offered = [ALLOW_ALWAYS()]
    expect(answerChoice(selected('allow-rule'), offered, offered)).toEqual(offered[0])
  })

  it('does not reuse a persistent choice whose rule identity is missing', () => {
    const answers = new ApprovalAnswers()
    answers.remember('approval', 'tool', ALLOW_ALWAYS())
    expect(
      answers.reuse({ approvalId: 'approval', itemId: 'tool', availableChoices: [ALLOW_ALWAYS()] }),
    ).toBeUndefined()
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

  it('re-asks untrusted content even after an explicit mode change', () => {
    expect(adoptedMode('bypassPermissions', 'auto', true)).toBe('manual')
    expect(adoptedMode('manual', 'auto', true)).toBe('manual')
  })
})

describe('Muse Code mode descriptions (F13)', () => {
  it('says a permission rule can already allow a command', () => {
    expect(UI_TEXT.permissionModeDetails.manual).toContain('permission rule')
    expect(UI_TEXT.permissionModeDetails.acceptEdits).toContain('permission rule')
  })
})
