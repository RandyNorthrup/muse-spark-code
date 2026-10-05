import { JUDGE_CARD_CHOICES } from './helpers/judgeUseRig'
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { parseHostToWebviewMessage } from '../../src/shared/protocol'
import { ApprovalCard } from '../../src/webview/components/ApprovalCard'
import { JudgeStatusLine } from '../../src/webview/components/JudgeStatusLine'
import {
  initialUiState,
  uiReducer,
  waitingApprovals,
  type UiState,
} from '../../src/webview/state/uiState'

const CARD: Extract<AgentEvent, { type: 'approvalRequested' }> = {
  type: 'approvalRequested',
  approvalId: 'a1',
  itemId: 'i1',
  toolName: 'bash',
  rawArgs: '{}',
  requirementId: { approvalId: 'a1', sourceIndex: 0 },
  subject: { kind: 'shell', command: 'npm test' },
  availableChoices: [...JUDGE_CARD_CHOICES],
  isProtectedWrite: false,
  isJudgeEscalated: false,
}
const CAUTION: AgentEvent = {
  type: 'approvalCaution',
  approvalId: 'a1',
  requirementId: CARD.requirementId,
}
const STATUS = {
  mode: 'same' as const,
  reason: 'auto-same' as const,
  modelId: 'muse-spark-1.3',
  billing: 'subscription' as const,
}

function event(state: UiState, message: AgentEvent): UiState {
  return uiReducer(state, {
    type: 'hostMessage',
    message: { type: 'agentEvent', event: message },
    at: 0,
  })
}

describe('Judge card note and status', () => {
  it('validates extension-owned messages and refuses invalid shapes at the boundary', () => {
    expect(parseHostToWebviewMessage({ type: 'agentEvent', event: CAUTION }).ok).toBe(true)
    expect(parseHostToWebviewMessage({ type: 'judgeState', state: STATUS }).ok).toBe(true)
    expect(
      parseHostToWebviewMessage({ type: 'judgeState', state: { ...STATUS, mode: 'allow' } }).ok,
    ).toBe(false)
    expect(
      parseHostToWebviewMessage({
        type: 'agentEvent',
        event: { ...CAUTION, requirementId: undefined },
      }).ok,
    ).toBe(false)
  })

  it('adds only a fixed caution and one announcement, preserving the user choices', () => {
    const pending = event(initialUiState, CARD)
    const next = event(pending, CAUTION)
    const approval = waitingApprovals(next.transcript)[0]?.approval
    expect(approval?.judgeCaution).toBe(true)
    expect(approval?.availableChoices).toEqual(CARD.availableChoices)
    expect(next.announcement?.text).toBe(UI_TEXT.judgeCaution)
    expect(event(next, CAUTION)).toBe(next)
    if (approval === undefined) throw new Error('No approval')
    const decide = vi.fn()
    render(<ApprovalCard approval={approval} toolName="bash" onDecide={decide} />)
    expect(screen.getByText(UI_TEXT.judgeCaution)).toBeVisible()
    const once = screen.getByRole('button', { name: 'Allow once' })
    once.focus()
    expect(once).toHaveFocus()
    fireEvent.click(once)
    expect(decide).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ choiceId: 'allow_once' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('drops a caution after the user decides, after resolution, and for a replaced stage or conversation', () => {
    const pending = event(initialUiState, CARD)
    const decided = uiReducer(pending, {
      type: 'approvalDecided',
      approvalId: 'a1',
      requirementId: CARD.requirementId,
    })
    expect(event(decided, CAUTION)).toBe(decided)
    const resolved = event(pending, {
      type: 'approvalResolved',
      approvalId: 'a1',
      itemId: 'i1',
      decision: 'abort',
      resolvedBy: 'user',
    })
    expect(event(resolved, CAUTION)).toBe(resolved)
    const replaced = event(pending, {
      type: 'approvalUpdated',
      approvalId: 'a1',
      requirementId: { approvalId: 'a1', sourceIndex: 1 },
      subject: CARD.subject,
      availableChoices: CARD.availableChoices,
    })
    expect(event(replaced, CAUTION)).toBe(replaced)
    const cleared = uiReducer(pending, { type: 'conversationCleared' })
    expect(event(cleared, CAUTION)).toBe(cleared)
  })

  it('shows the same model and subscription, and names the measured default-off reason', () => {
    const view = render(<JudgeStatusLine status={STATUS} />)
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.judgeStatusSame)
    expect(screen.getByRole('status')).toHaveTextContent(STATUS.modelId)
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.judgeStatusSubscription)
    view.rerender(<JudgeStatusLine status={{ ...STATUS, mode: 'off', reason: 'ready-rate-low' }} />)
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.judgeStatusSlow)
    view.rerender(<JudgeStatusLine status={undefined} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
