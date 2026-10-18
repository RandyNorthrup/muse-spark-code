// Shared by every ACP editor: OS-store grants, terminal/browser URL handoff,
// the loopback callback and process-safe refresh. No VS Code dependency.
import type * as z from 'zod/mini'
import {
  ChatGptSignInError,
  chatGptRecordSchema,
  chatGptRegistrationSchema,
  resolveChatGptHostId,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import type { SecretStore } from '../host/auth/credentialStore'
import { CHATGPT_REGISTRATION_SECRET_KEY, PROVIDER_SECRET_PREFIX } from '../shared/constants'
import { startChatGptCallback } from './chatGptCallback'
import { withChatGptRefreshLock, type ChatGptLockOptions } from './chatGptRefreshLock'
import { StoreUnavailableError, storeOperation } from './keyStore'

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
  } catch (error) {
    // A store failure reads as the store's refusal. Anything else is a
    // caller bug, not the store, and stays what it is.
    if (error instanceof StoreUnavailableError) throw new ChatGptSignInError('store-unavailable')
    throw error
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
  /**
   * One JSON entry of the grant's store, validated on the way in and out;
   * `code` names which entry could not be read or kept.
   */
  const readStored = async <T>(
    account: string,
    schema: z.ZodMiniType<T>,
    code: ChatGptSignInError['code'],
  ) => {
    const stored = await grantStore(async () => await options.secrets.get(account))
    if (stored === undefined) return
    try {
      const value: unknown = JSON.parse(stored)
      const parsed = schema.safeParse(value)
      if (!parsed.success) throw new ChatGptSignInError(code)
      return parsed.data
    } catch (error) {
      // Only malformed text fails here: a typed failure is already named,
      // and anything else is not this entry's answer to give.
      if (error instanceof ChatGptSignInError) throw error
      if (error instanceof SyntaxError) throw new ChatGptSignInError(code)
      throw error
    }
  }
  const writeStored = async <T>(
    account: string,
    schema: z.ZodMiniType<T>,
    value: T,
    code: ChatGptSignInError['code'],
  ) => {
    const parsed = schema.safeParse(value)
    if (!parsed.success) throw new ChatGptSignInError(code)
    await grantStore(async () => {
      await options.secrets.store(account, JSON.stringify(parsed.data))
    })
  }
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
      openBrowser: async (url) => {
        try {
          await options.openBrowser(url)
        } catch {
          // The terminal or editor could not show the address: said as that, never as a ChatGPT outage.
          throw new ChatGptSignInError('browser-unavailable')
        }
      },
      startCallback: (state, timeoutMs, clientId) =>
        startChatGptCallback(state, timeoutMs, options.callbackText, options.signal, clientId),
      readRecord: () => readStored(RECORD_ACCOUNT, chatGptRecordSchema, 'grant-unreadable'),
      // A grant that fails its own schema was built from OpenAI's token answer.
      writeRecord: (record) =>
        writeStored(RECORD_ACCOUNT, chatGptRecordSchema, record, 'invalid-token'),
      deleteRecord: async () => {
        await grantStore(async () => {
          await options.secrets.delete(RECORD_ACCOUNT)
        })
      },
      readRegistration: () =>
        readStored(
          CHATGPT_REGISTRATION_SECRET_KEY,
          chatGptRegistrationSchema,
          'registration-unreadable',
        ),
      // A registration that fails its schema carries the callback's issued client.
      writeRegistration: (registration) =>
        writeStored(
          CHATGPT_REGISTRATION_SECRET_KEY,
          chatGptRegistrationSchema,
          registration,
          'invalid-callback',
        ),
      withRefreshLock: (work) => withChatGptRefreshLock(work, lock),
    }
  } catch (error) {
    if (error instanceof ChatGptSignInError) throw error
    // Preparing the host is local work (lock, store): an untyped failure is
    // this machine's, named by its own code or name.
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    const name = error instanceof Error ? error.name : 'unknown'
    throw new ChatGptSignInError('local-failed', typeof code === 'string' ? code : name)
  }
}
