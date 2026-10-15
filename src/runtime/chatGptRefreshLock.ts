// One person-scoped grant lock serializes OS-store grant mutations across
// processes: the named lock of namedLock.ts, on the grant's own name. A
// contention timeout, an abort or an untyped failure of the protected work
// fails closed as `request-failed`; a local failure to open the lock reports
// its OS code, never "temporarily unavailable".
import {
  CHATGPT_GRANT_LOCK_DIR,
  CHATGPT_GRANT_LOCK_FILE,
  CHATGPT_GRANT_LOCK_PIPE,
} from '../shared/constants'
import { ChatGptSignInError } from '../core/providers/subscriptions/chatgpt'
import { StoreUnavailableError } from './keyStore'
import { personScope, withNamedLock, type NamedLockOptions } from './namedLock'

export type ChatGptLockOptions = NamedLockOptions

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
      options,
    )
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    if (error instanceof StoreUnavailableError) throw new ChatGptSignInError('store-unavailable')
    throw new ChatGptSignInError('request-failed')
  }
}
