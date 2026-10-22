// OPENAI-G27: one true sentence per documented ChatGPT plan refusal.
//
// Shapes and recovery actions quoted from the provider's own page
// (https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery,
// read 2026-10-13):
// - Structured Responses errors carry error.code / error.param.
// - Direct-route admission can return {"detail":"..."} instead.
// - "They are not an exhaustive list": a refusal the product does not know
//   shows the provider's own text, never a guessed meaning.
//
// Pure: values in, display sentences out. UI text is read when a function
// runs, never at module load.
import { PLAN_REFUSAL_TEXT_MAX_CHARS, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'

/** Provider text is shown as sent; overlong bodies are not pasted whole. */
function providerText(value: string): string {
  return value.length <= PLAN_REFUSAL_TEXT_MAX_CHARS
    ? value
    : value.slice(0, PLAN_REFUSAL_TEXT_MAX_CHARS)
}

/**
The display sentence for one plan refusal code. A refusal the product
does not know shows the provider's own message; without one there is no
sentence to show and the caller keeps its generic retry.
*/
export function planRefusalMessage(
  code: string,
  providerMessage?: string,
  param?: string,
): string | undefined {
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded': {
      return UI_TEXT.planUi.limitDetail
    }
    case 'subscription_sharing_user_not_eligible': {
      return UI_TEXT.planUi.chatGptNotEligible
    }
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable': {
      return UI_TEXT.planUi.chatGptUsageUnavailable
    }
    case 'subscription_sharing_unsupported_capability': {
      return fill(UI_TEXT.planUi.chatGptUnsupportedCapability, {
        detail: param ?? providerMessage ?? code,
      })
    }
    case 'subscription_sharing_route_not_supported': {
      return UI_TEXT.planUi.chatGptRouteNotSupported
    }
    case 'subscription_sharing_invalid_user': {
      return UI_TEXT.planUi.chatGptInvalidUser
    }
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context': {
      return UI_TEXT.planUi.chatGptGrantNotAuthorized
    }
    default: {
      return providerMessage === undefined ? undefined : providerText(providerMessage)
    }
  }
}
