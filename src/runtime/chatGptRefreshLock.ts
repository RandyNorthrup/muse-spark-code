// One person-scoped grant lock serializes OS-store grant mutations across
// processes: the named lock of namedLock.ts, on the grant's own name. A
// contention timeout is `lock-busy`, a caller's abort `cancelled`, and a local
// failure to open the lock reports its OS code: none reads as "temporarily
// unavailable". An untyped failure of the protected work is `request-failed`
// with its own codes.
import {
  CHATGPT_GRANT_LOCK_DIR,
  CHATGPT_GRANT_LOCK_FILE,
  CHATGPT_GRANT_LOCK_PIPE,
  OAUTH_CODE_TTL_MS,
} from '../shared/constants'
import { failureCodeNames } from '../core/networkFailure'
import { ChatGptSignInError } from '../core/providers/subscriptions/chatgpt'
import { StoreUnavailableError } from './keyStore'
import { NamedLockError, personScope, withNamedLock, type NamedLockOptions } from './namedLock'

export type ChatGptLockOptions = NamedLockOptions

/**
 * The contention deadline production waits: a suspended process holding the
 * grant lock reports `lock-busy` after this instead of hanging every CLI/ACP
 * account operation forever. A caller-supplied `timeoutMs` still wins.
 */
export const CHATGPT_REFRESH_LOCK_TIMEOUT_MS = OAUTH_CODE_TTL_MS

/** One person-scoped grant lock; no token, identity, file or child is involved. */
export async function withChatGptRefreshLock<T>(
  work: () => Promise<T>,
  options: ChatGptLockOptions = {},
): Promise<T> {
  const scope = personScope()
  try {
    return await withNamedLock(
      work,
      {
        pipe: `${CHATGPT_GRANT_LOCK_PIPE}-${scope}`,
        folder: `${CHATGPT_GRANT_LOCK_DIR}-${scope}`,
        file: CHATGPT_GRANT_LOCK_FILE,
      },
      { ...options, timeoutMs: options.timeoutMs ?? CHATGPT_REFRESH_LOCK_TIMEOUT_MS },
    )
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    if (error instanceof NamedLockError) {
      if (error.kind === 'busy') throw new ChatGptSignInError('lock-busy')
      if (error.kind === 'cancelled') throw new ChatGptSignInError('cancelled')
      throw new ChatGptSignInError('lock-unavailable', error.reason)
    }
    if (error instanceof StoreUnavailableError) throw new ChatGptSignInError('store-unavailable')
    // An untyped failure of the protected work can be the network as well as this
    // machine: the known local causes are typed where they happen (store, lock,
    // browser, providers file), and what is left is named by its own codes.
    throw new ChatGptSignInError('request-failed', failureCodeNames(error))
  }
}
