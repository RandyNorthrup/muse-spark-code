// The account event words a headless run and the ACP agent both show. A leaf
// apart from accounts.ts, so dist/headless.js does not carry the panel's
// request and reply schemas for three sentences (CAPS017, PLAN.md D6).
import type { AccountEvent } from '../shared/accounts'
import { UI_TEXT } from '../shared/constants'
import { fill, formatDateTime } from '../shared/l10n/text'

/** A port refused adoption: the switch did not happen and the session keeps its
 * current account. Carries the user-facing text, already filled, so later
 * layers can repeat it instead of reporting a generic failure. */
export class AccountSwitchRefusedError extends Error {
  /** Stable cross-bundle brand: the producer bundle (runtime accounts) and
   * the consumer bundles (engine, ACP) each carry their own copy of this
   * constructor, so `instanceof` is false across the boundary. Guards check
   * this code, never the constructor. */
  public readonly code = 'accountSwitchRefused'
  public constructor(provider: string, account: string) {
    super(fill(UI_TEXT.accounts.switchUnavailable, { provider, account }))
    this.name = 'AccountSwitchRefusedError'
  }
}

/** A refused adoption, recognized across bundle boundaries by its brand
 * rather than its constructor (see the `code` field above). */
export function isAccountSwitchRefusedError(error: unknown): error is AccountSwitchRefusedError {
  return (
    error instanceof Error &&
    error.name === 'AccountSwitchRefusedError' &&
    'code' in error &&
    error.code === 'accountSwitchRefused'
  )
}

/** A refused providers file, recognized across bundle boundaries by its
 * brand rather than its constructor (each bundle carries its own copy of
 * the store error, like the refused switch above). */
export function isInvalidProvidersFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AccountStoreError' &&
    'code' in error &&
    error.code === 'invalidProvidersFile'
  )
}

/** A store refusal, recognized the same brand-first way (never imported, so
 * this leaf stays out of the store's bundle). */
function asStoreRefusal(error: Error): { code: string; cause: unknown } | undefined {
  if (error.name !== 'AccountStoreError' || !('code' in error)) return undefined
  const code: unknown = error.code
  return typeof code === 'string' ? { code, cause: error.cause } : undefined
}

/** The one call a usage link needs from the account owner. */
export interface AccountUsagePort {
  /** The selected provider's fixed public usage page, never a vendor error URL. */
  usageUrl(provider: string): string
}

export function accountErrorText(error: unknown): string {
  // A refused switch repeats its own filled text: the session did stay on
  // its account, so a generic failure would misreport what happened.
  if (isAccountSwitchRefusedError(error)) return error.message
  // A refused providers file names the refusal: the runtime is already on
  // the account service, and the file was left untouched.
  if (isInvalidProvidersFileError(error)) return UI_TEXT.accounts.providersInvalid
  let current: unknown = error
  while (current instanceof Error) {
    if (current.message === UI_TEXT.accounts.invalidAccount) return UI_TEXT.accounts.invalidAccount
    // Sentences the account layer threw when it knew what happened pass
    // through untouched: rewording them here would lose the cause again.
    if (
      [
        UI_TEXT.accounts.none,
        UI_TEXT.accounts.changed,
        UI_TEXT.accounts.notReady,
        UI_TEXT.accounts.invalidReply,
      ].includes(current.message)
    )
      return current.message
    const refusal = asStoreRefusal(current)
    const cause = refusal === undefined ? current.cause : refusal.cause
    if (refusal !== undefined) {
      // A store refusal names its own record: bad ids and unoffered
      // products keep their sentences, a refusal that kept its cause (an
      // unreadable providers file keeps its disk error) reports the cause,
      // and a refusal without detail stays a plain unavailable rather than
      // inventing a cause from its code word.
      if (refusal.code === 'invalidAccount' || refusal.code === 'invalidCredential')
        return UI_TEXT.accounts.invalidAccount
      if (refusal.code === 'notOffered') return UI_TEXT.accounts.notOffered
      if (cause === undefined) return UI_TEXT.accounts.unavailable
    } else if (cause === undefined) {
      // A raw store, credential-store or disk failure names itself: the
      // runtime is connected, so the connection sentence would lie. Wrappers
      // carry the failure as their cause, so the loop above already walked
      // past the wrapper's own text (usually the connection sentence).
      return current.message !== '' && current.message !== UI_TEXT.accounts.unavailable
        ? fill(UI_TEXT.accounts.unavailableReason, { reason: current.message })
        : UI_TEXT.accounts.unavailable
    }
    current = cause
  }
  return typeof current === 'string' && current !== ''
    ? fill(UI_TEXT.accounts.unavailableReason, { reason: current })
    : UI_TEXT.accounts.unavailable
}

export function accountUsageUrl(port: AccountUsagePort, provider: string): string {
  try {
    const url = new URL(port.usageUrl(provider))
    if (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    )
      return url.href
  } catch {
    /* An invalid URL never leaves the fixed-error boundary. */
  }
  throw new Error(UI_TEXT.accounts.unavailable)
}

export function accountStopText(
  event: Extract<AccountEvent, { type: 'stop' }>,
  account = event.account,
): string {
  return event.trigger.resetAt === null
    ? fill(UI_TEXT.accounts.resetUnknown, { provider: event.provider, account })
    : fill(UI_TEXT.accounts.stopped, {
        provider: event.provider,
        account,
        reset: formatDateTime(Date.parse(event.trigger.resetAt)),
      })
}
