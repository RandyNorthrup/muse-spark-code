import { describe, expect, it } from 'vitest'
import { hostExitError, turnFailureError, type TurnCompleted } from '../../src/acp/agent'
import { ACP_ERROR_CODES, UI_TEXT } from '../../src/shared/constants'

function failed(overrides: Partial<TurnCompleted>): TurnCompleted {
  return { type: 'turnCompleted', turnId: 't1', terminal: 'failed', ...overrides }
}

// RLF-ACPTURNS: a failed turn's prompt error carries the backend's retry
// judgment in its `data`, so the client can offer to send the prompt
// again. Absent judgment never reads as retryable.

describe('turnFailureError', () => {
  it('carries retryable true for a failure the backend judged retryable', () => {
    const error = turnFailureError(failed({ reason: 'broke', retryable: true }))
    expect(error.data).toEqual({ retryable: true })
    expect(error.message).toContain('broke')
  })

  it('carries retryable false for a failure beyond retrying', () => {
    const error = turnFailureError(
      failed({ reason: 'not logged in', errorKind: 'authRequired', retryable: false }),
    )
    expect(error.code).toBe(ACP_ERROR_CODES.turnFailed)
    expect(error.data).toMatchObject({ retryable: false })
    expect(error.message).toContain('not logged in')
  })

  it('reads absent judgment as not retryable', () => {
    const error = turnFailureError(failed({ errorKind: 'modelError' }))
    expect(error.data).toMatchObject({ kind: 'modelError', retryable: false })
    expect(error.message).toBe(UI_TEXT.actionFailed)
  })

  it('keeps the existing words where the turn carried none', () => {
    const error = turnFailureError(failed({}))
    expect(error.code).toBe(ACP_ERROR_CODES.turnFailed)
    expect(error.data).toMatchObject({ kind: 'turn_failed', retryable: false })
    expect(error.message).toBe(UI_TEXT.actionFailed)
  })
})

describe('hostExitError', () => {
  it('says a dead backend is never retryable in its session', () => {
    const error = hostExitError('Muse Code was stopped by SIGKILL')
    expect(error.code).toBe(ACP_ERROR_CODES.unavailable)
    expect(error.data).toEqual({ retryable: false })
    expect(error.message).toContain('SIGKILL')
  })
})
