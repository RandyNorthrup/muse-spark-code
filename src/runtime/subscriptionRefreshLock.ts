// One person-scoped grant lock serializes OS-store grant mutations across
// processes: the named lock of namedLock.ts, on each grant's own name. A
// contention timeout is `lock-busy`, a caller's abort `cancelled`, and a
// local failure to open the lock reports its OS code: none reads as
// "temporarily unavailable". An untyped failure of the protected work is
// `request-failed` with its own codes. One wrapper serves every
// subscription provider; each provider binds its own lock names and
// failure class.
import {
  CHATGPT_GRANT_LOCK_DIR,
  CHATGPT_GRANT_LOCK_FILE,
  CHATGPT_GRANT_LOCK_PIPE,
  GROK_GRANT_LOCK_DIR,
  GROK_GRANT_LOCK_FILE,
  GROK_GRANT_LOCK_PIPE,
  OAUTH_CODE_TTL_MS,
} from '../shared/constants'
import { failureCodeNames } from '../core/networkFailure'
// The sign-in cores stay in dist/subscriptions.js; this bundle reads them
// through subscriptionsEntry (one `instanceof` across the boundary).
import { ChatGptSignInError, GrokSignInError } from '../host/backend/subscriptionsEntry'
import { StoreUnavailableError } from './keyStore'
import { NamedLockError, personScope, withNamedLock, type NamedLockOptions } from './namedLock'

export type ChatGptLockOptions = NamedLockOptions

/**
The contention deadline production waits: a suspended process holding the
grant lock reports `lock-busy` after this instead of hanging every CLI/ACP
account operation forever. A caller-supplied `timeoutMs` still wins.
*/
export const CHATGPT_REFRESH_LOCK_TIMEOUT_MS = OAUTH_CODE_TTL_MS

export interface SubscriptionRefreshLockBinding<E extends Error> {
  readonly pipe: string
  readonly folder: string
  readonly file: string
  fail(
    code: 'lock-busy' | 'cancelled' | 'lock-unavailable' | 'store-unavailable' | 'request-failed',
    reason?: string,
  ): E
  isFailure(error: unknown): error is E
}

/** One person-scoped grant lock; no token, identity, file or child is involved. */
export async function withSubscriptionRefreshLock<T, E extends Error>(
  work: () => Promise<T>,
  binding: SubscriptionRefreshLockBinding<E>,
  options: NamedLockOptions = {},
): Promise<T> {
  const scope = personScope()
  try {
    return await withNamedLock(
      work,
      {
        pipe: `${binding.pipe}-${scope}`,
        folder: `${binding.folder}-${scope}`,
        file: binding.file,
      },
      { ...options, timeoutMs: options.timeoutMs ?? CHATGPT_REFRESH_LOCK_TIMEOUT_MS },
    )
  } catch (error) {
    if (binding.isFailure(error)) throw error
    if (error instanceof NamedLockError) {
      if (error.kind === 'busy') throw binding.fail('lock-busy')
      if (error.kind === 'cancelled') throw binding.fail('cancelled')
      throw binding.fail('lock-unavailable', error.reason)
    }
    if (error instanceof StoreUnavailableError) throw binding.fail('store-unavailable')
    // An untyped failure of the protected work can be the network as well as this
    // machine: the known local causes are typed where they happen (store, lock,
    // browser, providers file), and what is left is named by its own codes.
    throw binding.fail('request-failed', failureCodeNames(error))
  }
}

/** The ChatGPT binding with its lock names. */
export async function withChatGptRefreshLock<T>(
  work: () => Promise<T>,
  options: ChatGptLockOptions = {},
): Promise<T> {
  return await withSubscriptionRefreshLock(
    work,
    {
      pipe: CHATGPT_GRANT_LOCK_PIPE,
      folder: CHATGPT_GRANT_LOCK_DIR,
      file: CHATGPT_GRANT_LOCK_FILE,
      fail: (code, reason?) => new ChatGptSignInError(code, reason),
      isFailure: (error): error is ChatGptSignInError => error instanceof ChatGptSignInError,
    },
    options,
  )
}

/** The Grok binding with its own lock names beside the ChatGPT ones. */
export async function withGrokRefreshLock<T>(
  work: () => Promise<T>,
  options: NamedLockOptions = {},
): Promise<T> {
  return await withSubscriptionRefreshLock(
    work,
    {
      pipe: GROK_GRANT_LOCK_PIPE,
      folder: GROK_GRANT_LOCK_DIR,
      file: GROK_GRANT_LOCK_FILE,
      fail: (code, reason?) => new GrokSignInError(code, reason),
      isFailure: (error): error is GrokSignInError => error instanceof GrokSignInError,
    },
    options,
  )
}
