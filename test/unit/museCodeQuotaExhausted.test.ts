// RLF-QUOTA (PLAN.md D229): a spent subscription window is its own turn
// outcome, never "internal" and never transient. The CLI's typed
// `TurnError.quota` (ADR 50047) rides `turn/completed` onto the
// `turnCompleted` event; every surface states it with the reset in the
// person's local time; automatic resend never fires before the reset;
// continuing at the reset is the person's opt-in.
//
// Every wire byte is recorded or schema-verified. The failure text and
// reset instant are byte for byte from the observed 0.19.0 ACP error line
// (test/fixtures/musecode-quota/observed-acp-error.json: the lead's
// observation of 2026-10-30, every Muse lane at once); the `quota`
// member follows CLI 1.4.10's offline schema export, verified on this
// rig. The CLI's `retryable` judgment for a quota failure is unrecorded,
// so the mapping and the panel cases cover both values with an identical
// outcome. The live-wire panel cases run the real controller, a real
// MuseCodeHost and its real session over the SDK's real Connection,
// scripted with the echo-turn capture (zero model calls) as in
// museCodeAutoResend.test.ts.
import { describe, expect, it } from 'vitest'
import {
  MALFORMED_PARAMS,
  mapNotification,
  UNKNOWN_METHOD,
} from '../../src/core/backends/musecode/mapNotification'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import { quotaTurnFailureText, quotaWaitText } from '../../src/shared/turnFailure'
import { QUOTA_MESSAGE, QUOTA_RESETS_AT_MS, quotaTurnParams } from './helpers/musecodeQuota'

function mappedQuotaTurn(isRetryable: boolean) {
  const mapped = mapNotification({
    method: 'turn/completed',
    params: quotaTurnParams({ sessionId: 'session-1', turnId: 'turn-1', retryable: isRetryable }),
  })
  if (mapped === MALFORMED_PARAMS || mapped === UNKNOWN_METHOD || !('event' in mapped))
    throw new Error('the quota end refused to map')
  return mapped.event
}

describe('subscription quota mapping', () => {
  it.each([true, false])('carries the typed quota detail with retryable %s', (retryable) => {
    const event = mappedQuotaTurn(retryable)
    expect(event.type).toBe('turnCompleted')
    if (event.type !== 'turnCompleted') return
    expect(event.terminal).toBe('failed')
    expect(event.reason).toBe(QUOTA_MESSAGE)
    expect(event.retryable).toBe(retryable)
    expect(event.quota).toEqual({ limitKind: 'tierLimit', resetsAtMs: QUOTA_RESETS_AT_MS })
  })

  it('leaves a failure without the typed detail untouched', () => {
    const params = {
      ...quotaTurnParams({ sessionId: 'session-1', turnId: 'turn-1', retryable: true }),
      error: { kind: 'modelError', message: QUOTA_MESSAGE, retryable: true },
    }
    const mapped = mapNotification({ method: 'turn/completed', params })
    if (mapped === MALFORMED_PARAMS || mapped === UNKNOWN_METHOD || !('event' in mapped))
      throw new Error('the bare end refused to map')
    const event = mapped.event
    expect(event.type).toBe('turnCompleted')
    if (event.type !== 'turnCompleted') return
    expect(event.terminal).toBe('failed')
    expect(event.retryable).toBe(true)
    expect('quota' in event).toBe(false)
  })
})

describe('subscription quota words', () => {
  it('states the failure with the reset in the person’s local time', () => {
    const text = quotaTurnFailureText({ quota: { resetsAtMs: QUOTA_RESETS_AT_MS } })
    expect(text).toBe(
      fill(UI_TEXT.subscriptionQuotaExhausted, {
        resetTime: formatDateTime(QUOTA_RESETS_AT_MS),
      }),
    )
    expect(text).toContain(formatDateTime(QUOTA_RESETS_AT_MS))
    expect(text).not.toContain('{resetTime}')
    // Never the raw 429 line: the reset is stated, not buried in text.
    expect(text).not.toContain('request_id')
    expect(text).not.toContain('rate_limit_error')
  })

  it('answers undefined without the typed detail', () => {
    expect(quotaTurnFailureText({})).toBeUndefined()
    expect(quotaTurnFailureText({ quota: undefined })).toBeUndefined()
  })

  it('states the wait row with the same reset', () => {
    const text = quotaWaitText({ resetsAtMs: QUOTA_RESETS_AT_MS })
    expect(text).toBe(
      fill(UI_TEXT.turnQuotaWaiting, { resetTime: formatDateTime(QUOTA_RESETS_AT_MS) }),
    )
    expect(text).not.toContain('{resetTime}')
  })
})
