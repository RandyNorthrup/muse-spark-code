// Shared by every ACP editor: OS-store grants, terminal/browser URL handoff,
// the loopback callback and process-safe refresh. No VS Code dependency.
import {
  ChatGptSignInError,
  chatGptRecordSchema,
  resolveChatGptHostId,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import type { SecretStore } from '../host/auth/credentialStore'
import { PROVIDER_SECRET_PREFIX } from '../shared/constants'
import { startChatGptCallback } from './chatGptCallback'
import { withChatGptRefreshLock, type ChatGptLockOptions } from './chatGptRefreshLock'
import { storeOperation } from './keyStore'

const RECORD_ACCOUNT = `${PROVIDER_SECRET_PREFIX}chatgpt`
const HOST_ACCOUNT = `${RECORD_ACCOUNT}.host-id`

/**
 * The grant's OS-store calls. A refusal is the credential store's and is
 * said as such: the sign-in core's guard would otherwise report any foreign
 * error as a temporary ChatGPT failure (findings F14 and F78: a Windows
 * Credential Manager size refusal read "ChatGPT is temporarily unavailable").
 */
async function grantStore<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await storeOperation(work)
  } catch {
    throw new ChatGptSignInError('store-unavailable')
  }
}

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
      const stored = await grantStore(async () => await options.secrets.get(HOST_ACCOUNT))
      const resolved = resolveChatGptHostId(stored)
      if (resolved.persist) {
        await grantStore(async () => {
          await options.secrets.store(HOST_ACCOUNT, resolved.hostId)
        })
      }
      return resolved.hostId
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
        const stored = await grantStore(async () => await options.secrets.get(RECORD_ACCOUNT))
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
        await grantStore(async () => {
          await options.secrets.store(RECORD_ACCOUNT, JSON.stringify(parsed.data))
        })
      },
      deleteRecord: async () => {
        await grantStore(async () => {
          await options.secrets.delete(RECORD_ACCOUNT)
        })
      },
      withRefreshLock: (work) => withChatGptRefreshLock(work, lock),
    }
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    throw new ChatGptSignInError('request-failed')
  }
}
