import { describe, expect, it } from 'vitest'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'

const start: UiState = { ...initialUiState, sessionId: 'session-1' }
function retry(
  event: {
    type: 'turnRetry'
    turnId: string
    attempt: number
    maxAttempts?: number
    retryDelayMs: number
    reason: string
  },
  state = start,
) {
  const message: HostToWebviewMessage = { type: 'agentEvent', event }
  return uiReducer(state, { type: 'hostMessage', message, at: 1000 })
}
function noticeText(state: UiState): string {
  const entry = state.transcript.find((item) => item.kind === 'notice')
  if (entry?.kind !== 'notice') throw new Error('no retry notice in the transcript')
  return entry.text
}

describe('turnRetry ceiling', () => {
  it('names the platform ceiling when the backend supplied one', () => {
    const state = retry({
      type: 'turnRetry',
      turnId: 't1',
      attempt: 1,
      maxAttempts: 3,
      retryDelayMs: 5000,
      reason: 'rate limited',
    })
    expect(noticeText(state)).toBe('Attempt 1/3 failed (rate limited); retrying in 5 s.')
  })

  it('names the uncapped wait when no ceiling was supplied', () => {
    const state = retry({
      type: 'turnRetry',
      turnId: 't1',
      attempt: 2,
      retryDelayMs: 5000,
      reason: 'rate limited',
    })
    expect(noticeText(state)).toBe(
      'Attempt 2 failed (rate limited); retrying in 5 s (no retry limit set).',
    )
  })
})
