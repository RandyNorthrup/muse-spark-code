// One cross-surface grant lock for the editor's subscription sign-ins: the
// same named lock the runtime CLI and ACP agent take (src/runtime/namedLock.ts),
// on the same person-scoped names, so an editor window and a CLI process
// refreshing in the same seconds are mutually excluded. Contention past the
// deadline fails closed as the provider's `lock-busy`; a lock that cannot be
// opened keeps the provider's existing local sentence. One wrapper serves
// every subscription provider; each provider binds its own lock names and
// failure class.
import {
  CHATGPT_GRANT_LOCK_DIR,
  CHATGPT_GRANT_LOCK_FILE,
  CHATGPT_GRANT_LOCK_PIPE,
  GROK_GRANT_LOCK_DIR,
  GROK_GRANT_LOCK_FILE,
  GROK_GRANT_LOCK_PIPE,
  OAUTH_CODE_TTL_MS,
} from '../../shared/constants'
import { ChatGptSignInError, GrokSignInError } from '../backend/subscriptionsEntry'
import {
  NamedLockError,
  grantLockNames,
  withNamedLock,
  type NamedLockOptions,
} from '../../runtime/namedLock'

export interface EditorRefreshLockBinding<E extends Error> {
  readonly pipe: string
  readonly folder: string
  readonly file: string
  failBusy(): E
  failUnavailable(reason: string | undefined): E
}

/** The editor side of the one subscription refresh lock; no token, identity, file or child is involved. */
export async function withEditorRefreshLock<T, E extends Error>(
  work: () => Promise<T>,
  binding: EditorRefreshLockBinding<E>,
  options: NamedLockOptions = {},
): Promise<T> {
  try {
    return await withNamedLock(work, grantLockNames(binding), {
      ...options,
      timeoutMs: options.timeoutMs ?? OAUTH_CODE_TTL_MS,
    })
  } catch (error) {
    if (error instanceof NamedLockError) {
      if (error.kind === 'busy') throw binding.failBusy()
      if (error.kind === 'unavailable') throw binding.failUnavailable(error.reason)
    }
    throw error
  }
}

/** The ChatGPT binding with its lock names. */
export async function withEditorChatGptRefreshLock<T>(
  work: () => Promise<T>,
  options: NamedLockOptions = {},
): Promise<T> {
  return await withEditorRefreshLock(
    work,
    {
      pipe: CHATGPT_GRANT_LOCK_PIPE,
      folder: CHATGPT_GRANT_LOCK_DIR,
      file: CHATGPT_GRANT_LOCK_FILE,
      failBusy: () => new ChatGptSignInError('lock-busy'),
      failUnavailable: (reason) => new ChatGptSignInError('local-failed', reason),
    },
    options,
  )
}

/** The Grok binding with its own lock names beside the ChatGPT ones. */
export async function withEditorGrokRefreshLock<T>(
  work: () => Promise<T>,
  options: NamedLockOptions = {},
): Promise<T> {
  return await withEditorRefreshLock(
    work,
    {
      pipe: GROK_GRANT_LOCK_PIPE,
      folder: GROK_GRANT_LOCK_DIR,
      file: GROK_GRANT_LOCK_FILE,
      failBusy: () => new GrokSignInError('lock-busy'),
      failUnavailable: (reason) => new GrokSignInError('request-failed', reason),
    },
    options,
  )
}
