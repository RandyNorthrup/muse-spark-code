import { describe, expect, it } from 'vitest'
import { RequestError } from '@agentclientprotocol/sdk/unstable'
import {
  hostExitError,
  outboundError,
  toOutbound,
  turnFailureError,
  type TurnCompleted,
} from '../../src/acp/agent'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { startFailureText } from '../../src/acp/startText'
import { ACP_ERROR_CODES, CREDENTIAL_STORE_ERROR_KIND, UI_TEXT } from '../../src/shared/constants'
import { CreatedRegistrySaveError } from '../../src/shared/createdRegistrySaveError'
import { fill } from '../../src/shared/l10n/text'
import { quotaTurnFailureText } from '../../src/shared/turnFailure'
import { QUOTA_MESSAGE, QUOTA_RESETS_AT_MS, quotaTurnParams } from './helpers/musecodeQuota'

function failed(overrides: Partial<TurnCompleted>): TurnCompleted {
  return { type: 'turnCompleted', turnId: 't1', terminal: 'failed', ...overrides }
}

/** The observed quota failure through the real wire mapping. */
function quotaFailed(isRetryable: boolean): TurnCompleted {
  const mapped = mapNotification({
    method: 'turn/completed',
    params: quotaTurnParams({ sessionId: 's1', turnId: 't1', retryable: isRetryable }),
  })
  if (typeof mapped !== 'object' || !('event' in mapped)) {
    throw new Error('the quota end refused to map')
  }
  if (mapped.event.type !== 'turnCompleted') throw new Error('the quota end mapped past its turn')
  return mapped.event
}

// RLF-ACPTURNS: a failed turn's prompt error carries the backend's retry
// judgment in its `data`, so the client can offer to send the prompt
// again. Absent judgment never reads as retryable. A retryable turn says
// RLWINFIX2's sentence with its own detail; the rest keep their typed
// codes (the failed turn with its kind, the credential store's no-answer).
// RLF-QUOTA (PLAN.md D252): a spent subscription window is its own
// outcome — its own code, the reset in words, and data a client can wait
// on — and the outbound gate carries it (and every prompt error's retry
// judgment) to the wire.

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

  it.each([true, false])(
    'answers a quota turn as its own outcome with retryable %s',
    (isRetryable) => {
      const error = turnFailureError(quotaFailed(isRetryable))
      expect(error.code).toBe(ACP_ERROR_CODES.quotaExhausted)
      expect(error.message).toBe(
        quotaTurnFailureText({ quota: { resetsAtMs: QUOTA_RESETS_AT_MS } }),
      )
      expect(error.message).not.toContain(QUOTA_MESSAGE)
      expect(error.data).toEqual({
        kind: 'quota_exhausted',
        resetsAt: new Date(QUOTA_RESETS_AT_MS).toISOString(),
        retryable: false,
      })
    },
  )
})

/** A built prompt error through the real outbound classifier and rebuild. */
function wire(error: unknown): RequestError {
  return outboundError(toOutbound(error).failure)
}

describe('outboundError wire contract', () => {
  it('carries the quota error to the wire byte for byte', () => {
    const built = turnFailureError(quotaFailed(true))
    const error = wire(built)
    expect(error.code).toBe(ACP_ERROR_CODES.quotaExhausted)
    expect(error.message).toBe(built.message)
    expect(error.data).toEqual({
      kind: 'quota_exhausted',
      resetsAt: new Date(QUOTA_RESETS_AT_MS).toISOString(),
      retryable: false,
    })
  })

  it('passes the backend retry judgment through for ordinary failures', () => {
    const retryable = wire(turnFailureError(failed({ reason: 'broke', retryable: true })))
    expect(retryable.data).toMatchObject({ retryable: true })
    const refused = wire(
      turnFailureError(failed({ reason: 'no', errorKind: 'authRequired', retryable: false })),
    )
    expect(refused.data).toMatchObject({ kind: 'authRequired', retryable: false })
  })

  it('does not let the observed request id ride inside the quota sentence', () => {
    // The recorded provider line, placed where the reset instant goes.
    // The open template used to let that whole sentence leave.
    const planted = fill(UI_TEXT.subscriptionQuotaExhausted, { resetTime: QUOTA_MESSAGE })
    const error = wire(
      new RequestError(ACP_ERROR_CODES.quotaExhausted, planted, {
        kind: 'quota_exhausted',
        resetsAt: new Date(QUOTA_RESETS_AT_MS).toISOString(),
        retryable: false,
      }),
    )
    expect(planted).toContain('request_id=')
    expect(error.message).toBe(UI_TEXT.actionFailed)
    expect(error.message).not.toContain('request_id=')
    expect(error.data).toEqual({
      kind: 'quota_exhausted',
      resetsAt: new Date(QUOTA_RESETS_AT_MS).toISOString(),
      retryable: false,
    })
  })

  // RLF-MAKERFENCE item 4: a session or turn start our layers refused
  // reaches the client in its own sentence with the refusal's code,
  // never as -32603 with the generic failure.
  it.each([
    UI_TEXT.hardwareBindingUnavailable,
    UI_TEXT.hardwareBypassNotice,
    UI_TEXT.scheduleBusy,
    UI_TEXT.permissionReviewerMissing,
  ])('carries a start refusal to the wire in its own sentence: %s', (sentence) => {
    const built = RequestError.invalidRequest(undefined, sentence)
    const error = wire(built)
    expect(error.code).toBe(built.code)
    expect(error.code).not.toBe(ACP_ERROR_CODES.internal)
    expect(error.message).toBe(built.message)
    expect(error.message).toContain(sentence)
    expect(error.data).toEqual({ kind: 'invalid_request' })
  })

  it('carries a failed start behind its site sentence and a registry refusal', () => {
    const started = RequestError.internalError(
      undefined,
      fill(UI_TEXT.acpTurnStartFailed, { detail: 'Error EPIPE' }),
    )
    const turn = wire(started)
    expect(turn.code).toBe(ACP_ERROR_CODES.internal)
    expect(turn.message).toBe(started.message)

    const registry = RequestError.invalidRequest(
      undefined,
      startFailureText(new CreatedRegistrySaveError('refused'), 'session'),
    )
    const saved = wire(registry)
    expect(saved.code).toBe(registry.code)
    expect(saved.message).toBe(registry.message)
  })

  it('still replaces unlisted text with the generic failure', () => {
    const built = RequestError.invalidRequest(undefined, 'failed at /Users/someone/secret.txt')
    const error = wire(built)
    expect(error.message).toBe(UI_TEXT.actionFailed)
    expect(error.message).not.toContain('someone')
  })

  it('drops an unparseable reset instant', () => {
    const error = wire(
      new RequestError(ACP_ERROR_CODES.quotaExhausted, UI_TEXT.actionFailed, {
        kind: 'quota_exhausted',
        resetsAt: 'soon',
        retryable: false,
      }),
    )
    expect(error.data).toEqual({ kind: 'quota_exhausted', retryable: false })
  })
})

describe('hostExitError', () => {
  it('says a crashed backend is retryable in its session: the resend re-attaches it', () => {
    const error = hostExitError({
      description: 'Muse Code was stopped by SIGKILL',
      isExpected: false,
      isFailure: true,
      isPersistent: false,
    })
    expect(error.code).toBe(ACP_ERROR_CODES.unavailable)
    expect(error.data).toEqual({ retryable: true })
    expect(error.message).toContain('SIGKILL')
  })
  it('says an expected or persistent exit is not retryable in its session', () => {
    for (const exit of [
      {
        description: 'Muse Code exited as asked (exit code 0)',
        isExpected: true,
        isFailure: false,
        isPersistent: false,
      },
      {
        description: 'Muse Code exited with code 3',
        isExpected: false,
        isFailure: true,
        isPersistent: true,
      },
    ]) {
      const error = hostExitError(exit)
      expect(error.code).toBe(ACP_ERROR_CODES.unavailable)
      expect(error.data).toEqual({ retryable: false })
    }
  })
})
