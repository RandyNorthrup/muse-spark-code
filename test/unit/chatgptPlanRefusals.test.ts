// OPENAI-G27: each documented plan refusal maps to its own true sentence.
// Refusal shapes quote the provider's error table
// (https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery,
// read 2026-10-13). Pure logic through the real modules: codes in, whole
// sentences out; HTTP cases run through the real plan error reader with
// real Response objects.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { planRefusalMessage } from '../../src/core/providers/subscriptions/planRefusals'
import { planRequestError } from '../../src/core/providers/subscriptions/registry'

function planResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

describe('plan refusal sentences', () => {
  it('names the ineligible-account action instead of retrying', () => {
    expect(
      planRefusalMessage('subscription_sharing_user_not_eligible', 'User is not eligible.'),
    ).toBe(UI_TEXT.planUi.chatGptNotEligible)
  })

  it('keeps the limit sentence for the usage-limit code', async () => {
    expect(planRefusalMessage('subscription_sharing_usage_limit_exceeded', 'Limit reached.')).toBe(
      UI_TEXT.planUi.limitDetail,
    )
    const error = await planRequestError(
      planResponse(429, {
        error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit reached.' },
      }),
    )
    expect(error.code).toBe('subscription_sharing_usage_limit_exceeded')
    expect(error.message).toBe(UI_TEXT.planUi.limitDetail)
  })

  it('keeps the sign-in on both 503 codes and asks for a later retry', async () => {
    for (const code of [
      'subscription_sharing_usage_unavailable',
      'subscription_sharing_user_unavailable',
    ]) {
      expect(planRefusalMessage(code, 'Temporarily unavailable.')).toBe(
        UI_TEXT.planUi.chatGptUsageUnavailable,
      )
      const error = await planRequestError(
        planResponse(503, { error: { code, message: 'Temporarily unavailable.' } }),
      )
      expect(error.code).toBe(code)
      expect(error.message).toBe(UI_TEXT.planUi.retry)
    }
  })

  it('names the unsupported capability from error.param', async () => {
    expect(
      planRefusalMessage(
        'subscription_sharing_unsupported_capability',
        'Invalid body.',
        'service_tier',
      ),
    ).toBe('ChatGPT refused this request (service_tier). Change the request and try again.')
    const error = await planRequestError(
      planResponse(400, {
        error: {
          code: 'subscription_sharing_unsupported_capability',
          message: 'Invalid body.',
          param: 'service_tier',
        },
      }),
    )
    expect(error.code).toBe('subscription_sharing_unsupported_capability')
    expect(error.message).toBe(
      'ChatGPT refused this request (service_tier). Change the request and try again.',
    )
  })

  it('maps the route, user and grant codes to their own sentences', async () => {
    for (const [code, sentence] of [
      ['subscription_sharing_route_not_supported', UI_TEXT.planUi.chatGptRouteNotSupported],
      ['subscription_sharing_invalid_user', UI_TEXT.planUi.chatGptInvalidUser],
      ['chatpass_v2_scope_not_authorized', UI_TEXT.planUi.chatGptGrantNotAuthorized],
      ['chatpass_v2_invalid_authorization_context', UI_TEXT.planUi.chatGptGrantNotAuthorized],
    ] as const) {
      expect(planRefusalMessage(code, 'Not served.')).toBe(sentence)
      const error = await planRequestError(
        planResponse(403, { error: { code, message: 'Not served.' } }),
      )
      expect(error.code).toBe(code)
      expect(error.message).toBe(sentence)
    }
  })

  it('shows the provider text for an unknown refusal and for detail bodies', async () => {
    expect(planRefusalMessage('some_future_code', 'Provider words.')).toBe('Provider words.')
    expect(planRefusalMessage('some_future_code')).toBeUndefined()
    const error = await planRequestError(
      planResponse(403, { error: { code: 'some_future_code', message: 'Provider words.' } }),
    )
    expect(error.code).toBe('some_future_code')
    expect(error.message).toContain('Provider words.')
    const admission = await planRequestError(planResponse(403, { detail: 'Admission words.' }))
    expect(admission.code).toBe('request-failed')
    expect(admission.message).toContain('Admission words.')
  })

  it('reads the HTTP status where OpenAI sent no words', async () => {
    const error = await planRequestError(planResponse(500, '<html>proxy</html>'))
    expect(error.code).toBe('request-failed')
    expect(error.message).toContain('HTTP 500')
    const empty = await planRequestError(planResponse(403, JSON.stringify({ ok: true })))
    expect(empty.message).toContain('HTTP 403')
  })
})
