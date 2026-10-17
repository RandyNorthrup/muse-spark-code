import { isSpendLedgerError } from './paid/spendLedgerError'
import { NON_BILLABLE_HTTP_REJECTIONS, UI_TEXT } from '../shared/constants'

/**
 * A paid stop (a daily, run, session or account limit) is never retried as a
 * send failure and never replaced by a generic error. Name-based so the
 * identity survives lazy bundles and every provider wrapper (D1, P2-3).
 */
export function isPaidStop(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'SessionBudgetExceededError' ||
      (error.name === 'UserRefusalError' && 'code' in error && error.code === 'daily_stopped'))
  )
}

export { UserRefusalError } from '../shared/refusal'

/** Local refusals keep their identity across lazy bundles and every provider wrapper. */
export function isUserRefusal(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  if (isSpendLedgerError(error) || error instanceof RangeError) return true
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
    UI_TEXT.execKeyRotated,
    UI_TEXT.notSignedInReason,
    UI_TEXT.media.filesReadOnly,
  ].includes(error.message)
}

/** Dispatcher evidence, independent of provider error prose or bundle copies. */
export function isRequestNotSent(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.name === 'UserRefusalError' &&
    'code' in error &&
    error.code === 'not_sent'
  )
}

/**
 * A side call (hook model, reviewer) counts as refused before sending when
 * the dispatcher says so, when a local refusal arrived before any response
 * frame and no sent mark exists, or when the provider's first answer is a
 * non-billable rejection and no usage arrived.
 */
export function isUnsentSideCall(
  error: unknown,
  hasResponseFrame: boolean,
  wasSent: boolean,
  hasUsage: boolean,
  isRefused: (error: unknown) => boolean,
): boolean {
  return (
    isRequestNotSent(error) ||
    (!hasResponseFrame && !wasSent && isRefused(error)) ||
    (!hasResponseFrame &&
      !hasUsage &&
      error instanceof Error &&
      'status' in error &&
      typeof error.status === 'number' &&
      NON_BILLABLE_HTTP_REJECTIONS.has(error.status))
  )
}
