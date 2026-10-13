// OPENAI-G27: each documented plan refusal maps to its own true sentence.
// Fixtures quote the provider's error table
// (https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery,
// read 2026-10-13). Pure logic through the real module: values in, whole
// sentences out.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  planHttpRefusal,
  planRefusalMessage,
} from '../../src/core/providers/subscriptions/planRefusals'

describe('plan refusal sentences', () => {
  it('names the ineligible-account action instead of retrying', () => {
    expect(
      planRefusalMessage('subscription_sharing_user_not_eligible', 'User is not eligible.'),
    ).toBe(UI_TEXT.planUi.chatGptNotEligible)
    expect(
      planHttpRefusal(
        403,
        JSON.stringify({
          error: {
            code: 'subscription_sharing_user_not_eligible',
            message: 'User is not eligible.',
          },
        }),
      ),
    ).toEqual({
      code: 'subscription_sharing_user_not_eligible',
      message: UI_TEXT.planUi.chatGptNotEligible,
    })
  })

  it('keeps the limit sentence for the usage-limit code', () => {
    expect(
      planHttpRefusal(
        429,
        JSON.stringify({
          error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit reached.' },
        }),
      ),
    ).toEqual({
      code: 'subscription_sharing_usage_limit_exceeded',
      message: UI_TEXT.planUi.limitDetail,
    })
  })

  it('keeps the sign-in on both 503 codes and asks for a later retry', () => {
    for (const code of [
      'subscription_sharing_usage_unavailable',
      'subscription_sharing_user_unavailable',
    ]) {
      expect(planRefusalMessage(code, 'Temporarily unavailable.')).toBe(
        UI_TEXT.planUi.chatGptUsageUnavailable,
      )
      expect(planHttpRefusal(503, JSON.stringify({ error: { code, message: 'x' } }))?.message).toBe(
        UI_TEXT.planUi.chatGptUsageUnavailable,
      )
    }
  })

  it('names the unsupported capability from error.param', () => {
    expect(
      planRefusalMessage(
        'subscription_sharing_unsupported_capability',
        'Invalid body.',
        'service_tier',
      ),
    ).toBe('ChatGPT refused this request (service_tier). Change the request and try again.')
  })

  it('maps the route, user and grant codes to their own sentences', () => {
    expect(planRefusalMessage('subscription_sharing_route_not_supported', 'No route.')).toBe(
      UI_TEXT.planUi.chatGptRouteNotSupported,
    )
    expect(planRefusalMessage('subscription_sharing_invalid_user', 'Bad user.')).toBe(
      UI_TEXT.planUi.chatGptInvalidUser,
    )
    for (const code of [
      'chatpass_v2_scope_not_authorized',
      'chatpass_v2_invalid_authorization_context',
    ]) {
      expect(planRefusalMessage(code, 'Not authorized.')).toBe(
        UI_TEXT.planUi.chatGptGrantNotAuthorized,
      )
    }
  })

  it('shows the provider text for an unknown refusal and for detail bodies', () => {
    expect(planRefusalMessage('some_future_code', 'Provider words.')).toBe('Provider words.')
    expect(planRefusalMessage('some_future_code')).toBeUndefined()
    expect(planHttpRefusal(403, JSON.stringify({ detail: 'Admission words.' }))?.message).toBe(
      'Admission words.',
    )
  })

  it('treats a bare 401 as an unaccepted token and leaves other bodies generic', () => {
    expect(planHttpRefusal(401, '<html>proxy</html>')?.message).toBe(
      UI_TEXT.planUi.chatGptInvalidUser,
    )
    expect(planHttpRefusal(500, '<html>proxy</html>')).toBeUndefined()
    expect(planHttpRefusal(403, JSON.stringify({ ok: true }))).toBeUndefined()
  })
})
