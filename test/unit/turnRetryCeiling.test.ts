import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'

const start: UiState = { ...initialUiState, sessionId: 'session-1' }
function reduce(state: UiState, event: AgentEvent): UiState {
  const message: HostToWebviewMessage = { type: 'agentEvent', event }
  return uiReducer(state, { type: 'hostMessage', message, at: 1000 })
}
function retry(
  state: UiState,
  over: { turnId?: string; attempt?: number; maxAttempts?: number } = {},
) {
  return reduce(state, {
    type: 'turnRetry',
    turnId: over.turnId ?? 't1',
    attempt: over.attempt ?? 1,
    ...(over.maxAttempts !== undefined && { maxAttempts: over.maxAttempts }),
    retryDelayMs: 5000,
    reason: 'rate limited',
  })
}
function retryRows(state: UiState) {
  return state.transcript.filter(
    (item) => item.kind === 'notice' && item.retryingTurnId !== undefined,
  )
}

describe('turnRetry ceiling', () => {
  it('names the platform ceiling when the backend supplied one', () => {
    const state = retry(start, { attempt: 1, maxAttempts: 3 })
    const [row] = retryRows(state)
    if (row?.kind !== 'notice') throw new Error('no retry row in the transcript')
    expect(row.text).toBe('Retrying in 5 s (attempt 1 of 3).')
    expect(row.retryingTurnId).toBe('t1')
  })

  it('names the uncapped wait when no ceiling was supplied', () => {
    const state = retry(start, { attempt: 2 })
    const [row] = retryRows(state)
    if (row?.kind !== 'notice') throw new Error('no retry row in the transcript')
    expect(row.text).toBe('Retrying in 5 s (attempt 2).')
  })

  it('replaces the earlier wait instead of adding a row per attempt', () => {
    const first = retry(start, { attempt: 1, maxAttempts: 3 })
    const second = retry(first, { attempt: 2, maxAttempts: 3 })
    const rows = retryRows(second)
    expect(rows).toHaveLength(1)
    const [row] = rows
    if (row?.kind !== 'notice') throw new Error('no retry row in the transcript')
    expect(row.text).toBe('Retrying in 5 s (attempt 2 of 3).')
  })

  it('clears the wait when the turn ends', () => {
    const waiting = retry(start, { attempt: 1, maxAttempts: 3 })
    const settled = reduce(waiting, { type: 'turnCompleted', turnId: 't1', terminal: 'completed' })
    expect(retryRows(settled)).toHaveLength(0)
  })

  it('clears the wait when a new turn starts', () => {
    const waiting = retry(start, { attempt: 1, maxAttempts: 3 })
    const started = reduce(waiting, { type: 'turnStarted', turnId: 't2' })
    expect(retryRows(started)).toHaveLength(0)
  })
})
