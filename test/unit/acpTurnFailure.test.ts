import { describe, expect, it } from 'vitest'
import { hostExitError, turnFailureError, type TurnCompleted } from '../../src/acp/agent'
import { ACP_ERROR_CODES, CREDENTIAL_STORE_ERROR_KIND, UI_TEXT } from '../../src/shared/constants'

function failed(overrides: Partial<TurnCompleted>): TurnCompleted {
  return { type: 'turnCompleted', turnId: 't1', terminal: 'failed', ...overrides }
}

// RLF-ACPTURNS: a failed turn's prompt error carries the backend's retry
// judgment in its `data`, so the client can offer to send the prompt
// again. Absent judgment never reads as retryable. A retryable turn says
// RLWINFIX2's sentence with its own detail; the rest keep their typed
// codes (the failed turn with its kind, the credential store's no-answer).

describe('turnFailureError', () => {
  it('carries retryable true for a failure the backend judged retryable', () => {
    const error = turnFailureError(failed({ reason: 'broke', retryable: true }))
    expect(error.data).toEqual({ retryable: true })
    expect(error.message).toContain(`${UI_TEXT.turnTransientFailed} (broke)`)
  })

  it('carries retryable false for a failure beyond retrying', () => {
    const error = turnFailureError(
      failed({ reason: 'not logged in', errorKind: 'authRequired', retryable: false }),
    )
    expect(error.code).toBe(ACP_ERROR_CODES.turnFailed)
    expect(error.data).toEqual({ kind: 'authRequired', retryable: false })
    expect(error.message).toBe('not logged in')
  })

  it('reads absent judgment as not retryable', () => {
    const error = turnFailureError(failed({ errorKind: 'modelError' }))
    expect(error.data).toEqual({ kind: 'modelError', retryable: false })
    expect(error.message).toBe(UI_TEXT.actionFailed)
  })

  it('names a failure without a kind as a failed turn, never as retryable', () => {
    const error = turnFailureError(failed({}))
    expect(error.code).toBe(ACP_ERROR_CODES.turnFailed)
    expect(error.data).toEqual({ kind: 'turn_failed', retryable: false })
  })

  it('keeps the credential store no-answer typed and not retryable', () => {
    const error = turnFailureError(failed({ errorKind: CREDENTIAL_STORE_ERROR_KIND }))
    expect(error.code).toBe(ACP_ERROR_CODES.credentialStore)
    expect(error.message).toBe(UI_TEXT.acpCredentialStoreNoAnswer)
    expect(error.data).toEqual({
      kind: CREDENTIAL_STORE_ERROR_KIND,
      requestSent: false,
      retryable: false,
    })
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
