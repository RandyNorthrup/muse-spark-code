import { describe, expect, it } from 'vitest'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { PromptLedger } from '../../src/core/backends/musecode/promptLedger'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  prefixLabel,
  RACE_APPROVAL_ID,
  raceRequested,
  raceUpdated,
} from './helpers/stageRaceCapture'

const choices = [{ choiceId: 'allow_once', label: 'Allow', decision: 'approved', scope: 'once' }]

function requested(sourceIndex: number): Extract<AgentEvent, { type: 'approvalRequested' }> {
  return {
    type: 'approvalRequested',
    approvalId: 'a1',
    itemId: 'call-1',
    toolName: 'shell',
    rawArgs: '{}',
    requirementId: { approvalId: 'a1', sourceIndex },
    subject: { kind: 'command', command: 'ls' },
    availableChoices: choices,
    isJudgeEscalated: false,
    isProtectedWrite: false,
  }
}

function updated(sourceIndex: number): AgentEvent {
  return {
    type: 'approvalUpdated',
    approvalId: 'a1',
    requirementId: { approvalId: 'a1', sourceIndex },
    subject: { kind: 'command', command: 'ls' },
    availableChoices: choices,
  }
}

const question: AgentEvent = {
  type: 'questionRequested',
  userInputId: 'u1',
  itemId: 'call-2',
  questions: [],
}

describe('PromptLedger (D26)', () => {
  it('lets one card through per approval stage and turns a new stage into an update', () => {
    const ledger = new PromptLedger()
    expect(ledger.admit(requested(1))).toEqual(requested(1))
    expect(ledger.admit(requested(1))).toBeUndefined()
    expect(ledger.admit(requested(2))).toEqual(updated(2))
    expect(ledger.admit(updated(3))).toEqual(updated(3))
    // The open approval now reads as its latest stage.
    expect(ledger.open()).toEqual([requested(3)])
  })

  it('drops every stage after the host closed an approval, until it resolves', () => {
    const ledger = new PromptLedger()
    ledger.admit(requested(1))
    ledger.close('a1')
    expect(ledger.admit(updated(2))).toBeUndefined()
    expect(ledger.admit(requested(2))).toBeUndefined()
    expect(ledger.open()).toEqual([])
    const resolved: AgentEvent = {
      type: 'approvalResolved',
      approvalId: 'a1',
      itemId: 'call-1',
      decision: 'approved',
      resolvedBy: 'user',
    }
    expect(ledger.admit(resolved)).toEqual(resolved)
    // The id is free again (a later approval that reuses it is new).
    expect(ledger.admit(requested(1))).toEqual(requested(1))
  })

  it('passes an update for an approval it never showed', () => {
    expect(new PromptLedger().admit(updated(2))).toEqual(updated(2))
  })

  it('shows a question once and forgets it when it settles', () => {
    const ledger = new PromptLedger()
    expect(ledger.admit(question)).toEqual(question)
    expect(ledger.admit(question)).toBeUndefined()
    expect(ledger.open()).toEqual([question])
    const settled: AgentEvent = {
      type: 'questionSettled',
      userInputId: 'u1',
      outcome: 'answered',
      answers: [],
    }
    expect(ledger.admit(settled)).toEqual(settled)
    expect(ledger.open()).toEqual([])
  })

  it('passes every other event untouched', () => {
    const event: AgentEvent = { type: 'turnStarted', turnId: 't1' }
    expect(new PromptLedger().admit(event)).toBe(event)
  })
})

/** A captured frame as the session sees it (through the real mapping). */
function mapped(method: string, params: Record<string, unknown>): AgentEvent {
  const result = mapNotification({ method, params })
  if (typeof result !== 'object' || !('event' in result)) {
    throw new Error(`${method} did not map to an event`)
  }
  return result.event
}

/** A stage of the captured eight-stage approval. */
function stage(sourceIndex: number) {
  return { approvalId: RACE_APPROVAL_ID, sourceIndex }
}

describe('PromptLedger: one decision per stage (D26, captured 2026-10-02)', () => {
  it('remembers the stages decided, until the approval resolves', () => {
    const ledger = new PromptLedger()
    ledger.admit(mapped('approval/requested', raceRequested('s1')))
    expect(ledger.isDecided(stage(0))).toBe(false)
    ledger.markDecided(stage(0))
    expect(ledger.isDecided(stage(0))).toBe(true)
    expect(ledger.isDecided(stage(1))).toBe(false)
    ledger.unmarkDecided(stage(0))
    expect(ledger.isDecided(stage(0))).toBe(false)
    ledger.markDecided(stage(0))
    ledger.admit({
      type: 'approvalResolved',
      approvalId: RACE_APPROVAL_ID,
      itemId: RACE_APPROVAL_ID,
      decision: 'approved',
      resolvedBy: 'user',
    })
    expect(ledger.isDecided(stage(0))).toBe(false)
    expect(ledger.pending(RACE_APPROVAL_ID)).toBeUndefined()
  })

  it('moves a card to the stage a stale refusal names, with that stage’s own rule label', () => {
    const ledger = new PromptLedger()
    ledger.admit(mapped('approval/requested', raceRequested('s1', 4)))
    const update = ledger.advanceTo(stage(5))
    expect(update).toMatchObject({ type: 'approvalUpdated', requirementId: stage(5) })
    const rule = update?.availableChoices.find((choice) => choice.choiceId === 'allow_local_prefix')
    // Stage 4's "git show" rule would mislabel stage 5 (Measure-Object).
    expect(rule).toMatchObject({ label: prefixLabel(5), rulePreview: prefixLabel(5) })
    expect(update?.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'allow_local_prefix',
      'abort',
    ])
    // Not yet admitted: the ledger moves when the session emits it.
    expect(ledger.pending(RACE_APPROVAL_ID)?.requirementId).toEqual(stage(4))
    if (update !== undefined) {
      ledger.admit(update)
    }
    expect(ledger.pending(RACE_APPROVAL_ID)?.requirementId).toEqual(stage(5))
    expect(ledger.advanceTo(stage(5))).toBeUndefined()
    expect(ledger.advanceTo({ approvalId: 'other', sourceIndex: 1 })).toBeUndefined()
    ledger.close(RACE_APPROVAL_ID)
    expect(ledger.advanceTo(stage(6))).toBeUndefined()
  })

  it('drops the rule choice when the stage it moves to suggests no rule', () => {
    const ledger = new PromptLedger()
    const params = raceRequested('s1', 4)
    const subject = params['subject'] as { stages: { suggestedPrefix?: unknown }[] }
    delete subject.stages[5]?.suggestedPrefix
    ledger.admit(mapped('approval/requested', params))
    expect(ledger.advanceTo(stage(5))?.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
  })

  it('names the open approvals a Stop must reject first: an earlier stage decided, the current not', () => {
    const ledger = new PromptLedger()
    ledger.admit(mapped('approval/requested', raceRequested('s1')))
    expect(ledger.partlyDecided()).toEqual([])
    ledger.markDecided(stage(0))
    // Stage 0 sent and not yet moved on: nothing waits undecided.
    expect(ledger.partlyDecided()).toEqual([])
    ledger.admit(mapped('approval/updated', raceUpdated('s1', 1)))
    expect(ledger.partlyDecided().map((approval) => approval.requirementId)).toEqual([stage(1)])
    ledger.close(RACE_APPROVAL_ID)
    expect(ledger.partlyDecided()).toEqual([])
  })
})
