import { describe, expect, it } from 'vitest'
import { PromptLedger } from '../../src/core/backends/musecode/promptLedger'
import type { AgentEvent } from '../../src/shared/agentEvents'

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
