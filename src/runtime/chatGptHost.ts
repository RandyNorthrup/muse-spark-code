// Shared by every ACP editor: OS-store grants, terminal/browser URL handoff,
// the loopback callback and process-safe refresh. No VS Code dependency.
import {
  ChatGptSignInError,
  chatGptRecordSchema,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import { isPkceState, pkceRandom } from '../core/providers/pkce'
import type { SecretStore } from '../host/auth/credentialStore'
import { PKCE_STATE_BYTES, PROVIDER_SECRET_PREFIX } from '../shared/constants'
import { startChatGptCallback } from './chatGptCallback'
import { withChatGptRefreshLock, type ChatGptLockOptions } from './chatGptRefreshLock'

const RECORD_ACCOUNT = `${PROVIDER_SECRET_PREFIX}chatgpt`
const HOST_ACCOUNT = `${RECORD_ACCOUNT}.host-id`

export interface RuntimeChatGptOptions {
  readonly secrets: SecretStore
  readonly fetch: typeof fetch
  /** Terminal commands print the URL; editor adapters may open their browser. */
  readonly openBrowser: (url: string) => Promise<void>
  readonly callbackText: () => string
  readonly signal?: AbortSignal
  readonly lock?: ChatGptLockOptions
}

export async function createRuntimeChatGptHost(
  options: RuntimeChatGptOptions,
): Promise<ChatGptHostPort> {
  const lock = { ...options.lock, ...(options.signal !== undefined && { signal: options.signal }) }
  try {
    const hostId = await withChatGptRefreshLock(async () => {
      const stored = await options.secrets.get(HOST_ACCOUNT)
      if (stored !== undefined) {
        if (!isPkceState(stored)) throw new ChatGptSignInError('invalid-token')
        return stored
      }
      const created = pkceRandom(PKCE_STATE_BYTES)
      await options.secrets.store(HOST_ACCOUNT, created)
      return created
    }, lock)
    return {
      hostId,
      now: Date.now,
      fetch: (url, init) =>
        options.fetch(url, {
          ...init,
          ...(options.signal !== undefined && {
            signal:
              init?.signal == null
                ? options.signal
                : AbortSignal.any([options.signal, init.signal]),
          }),
        }),
      openBrowser: options.openBrowser,
      startCallback: (state, timeoutMs) =>
        startChatGptCallback(state, timeoutMs, options.callbackText, options.signal),
      readRecord: async () => {
        const stored = await options.secrets.get(RECORD_ACCOUNT)
        if (stored === undefined) return
        try {
          const value: unknown = JSON.parse(stored)
          const parsed = chatGptRecordSchema.safeParse(value)
          if (!parsed.success) throw new ChatGptSignInError('invalid-token')
          return parsed.data
        } catch {
          throw new ChatGptSignInError('invalid-token')
        }
      },
      writeRecord: async (record) => {
        const parsed = chatGptRecordSchema.safeParse(record)
        if (!parsed.success) throw new ChatGptSignInError('invalid-token')
        await options.secrets.store(RECORD_ACCOUNT, JSON.stringify(parsed.data))
      },
      deleteRecord: async () => {
        await options.secrets.delete(RECORD_ACCOUNT)
      },
      withRefreshLock: (work) => withChatGptRefreshLock(work, lock),
    }
  } catch {
    throw new ChatGptSignInError('request-failed')
  }
}
