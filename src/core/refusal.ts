import { UI_TEXT } from '../shared/constants'

/** A local, intentional refusal; its message is already safe for the user. */
export class UserRefusalError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'UserRefusalError'
  }
}

/** Local refusals keep their identity across lazy bundles and every provider wrapper. */
export function isUserRefusal(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  if (error instanceof RangeError) return true
  const names = [
    'UserRefusalError',
    'ModelApiError',
    'CredentialOriginError',
    'SessionBudgetExceededError',
    'ChatCodecError',
    'AnthropicCodecError',
    'ResponsesDecodeError',
    'ResponsesOutputCapError',
    'ChatgptPlanLimitError',
    'MissingApiKeyError',
    'AbortedError',
    'AbortError',
    'ContextOverflowError',
    'HookStoppedError',
    'HookCancelledError',
    'ChildTaskRefusedError',
  ]
  if (names.includes(error.name)) return true
  // Older local guards use fixed, installed-language sentences. Never admit
  // arbitrary provider prose or substring matches as a trusted refusal.
  return [
    UI_TEXT.scheduleConfirmationExpired,
    UI_TEXT.execBudgetRefused,
    UI_TEXT.execModelUnpriced,
    UI_TEXT.execUnknownModel,
    UI_TEXT.sessionBudgetStoreUnavailable,
    UI_TEXT.sessionBudgetRetryUnavailable,
    UI_TEXT.sessionBudgetSearchUnavailable,
    UI_TEXT.sessionBudgetLegacyFeesUnknown,
    UI_TEXT.paidDailyLedgerUnavailable,
    UI_TEXT.paidDailyStopped,
    UI_TEXT.notSignedInReason,
    UI_TEXT.contextWindowFull,
    UI_TEXT.media.filesReadOnly,
    UI_TEXT.media.cappedRateUnknown,
  ].includes(error.message)
}
