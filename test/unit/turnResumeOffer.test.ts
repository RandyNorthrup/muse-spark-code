import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'

const start: UiState = { ...initialUiState, sessionId: 'session-1' }
const FAILED_AT = Date.UTC(2026, 10, 1, 12, 0, 30)

function failedTurn(event: Extract<AgentEvent, { type: 'turnCompleted' }>): UiState {
  const message: HostToWebviewMessage = { type: 'agentEvent', event }
  return uiReducer(start, { type: 'hostMessage', message, at: FAILED_AT })
}

function errorEntry(state: UiState) {
  const entry = state.transcript.find((item) => item.kind === 'error')
  if (entry?.kind !== 'error') throw new Error('no error entry in the transcript')
  return entry
}

// M88 lane C (PLAN.md D67, item 16): a failed turn at a limit carries
// the row's resume offer. A rate limit and a spent window fit their
// default minute; a far lift and a spent budget carry no timer.

describe('resume offers on failed turns', () => {
  it('fits a rate limit default to the Retry-After minute', () => {
    const entry = errorEntry(
      failedTurn({
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        errorKind: 'rateLimited',
        retryAfterMs: 5000,
        retryable: true,
      }),
    )
    expect(entry.resume).toEqual({
      kind: 'rateLimit',
      turnId: 't1',
      defaultAtMs: Date.UTC(2026, 10, 1, 12, 2),
    })
  })

  it('defaults a silent rate limit to five minutes, fitted', () => {
    const entry = errorEntry(
      failedTurn({
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        errorKind: 'rateLimited',
        retryable: true,
      }),
    )
    expect(entry.resume).toEqual({
      kind: 'rateLimit',
      turnId: 't1',
      defaultAtMs: Date.UTC(2026, 10, 1, 12, 6),
    })
  })

  it('fits a spent window to its reset minute', () => {
    const entry = errorEntry(
      failedTurn({
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        quota: { limitKind: 'tierLimit', resetsAtMs: Date.UTC(2026, 10, 1, 19, 42, 18) },
      }),
    )
    expect(entry.resume).toEqual({
      kind: 'quota',
      turnId: 't1',
      defaultAtMs: Date.UTC(2026, 10, 1, 19, 43),
    })
  })

  it('carries the lift instant instead of a timer past six days', () => {
    const resetsAtMs = FAILED_AT + 7 * 24 * 60 * 60 * 1000
    const entry = errorEntry(
      failedTurn({
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        quota: { limitKind: 'tierLimit', resetsAtMs },
      }),
    )
    expect(entry.resume).toEqual({ kind: 'quota', turnId: 't1', liftsAtMs: resetsAtMs })
  })

  it('offers a spent budget its setting, never a timer', () => {
    const entry = errorEntry(
      failedTurn({
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        reason: 'session budget spent',
        errorKind: 'budget',
        retryable: false,
      }),
    )
    expect(entry.resume).toEqual({ kind: 'budget', turnId: 't1' })
    expect(entry.retryTurnId).toBeUndefined()
  })

  it('offers nothing for ordinary failures and unusable instants', () => {
    expect(
      errorEntry(failedTurn({ type: 'turnCompleted', turnId: 't1', terminal: 'failed' })).resume,
    ).toBeUndefined()
    expect(
      errorEntry(
        failedTurn({
          type: 'turnCompleted',
          turnId: 't1',
          terminal: 'failed',
          quota: { limitKind: 'tierLimit', resetsAtMs: -1 },
        }),
      ).resume,
    ).toBeUndefined()
  })
})
