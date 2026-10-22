// The ACP agent's Grok ports: this app's configured xAI client id reaches
// the shared core beside the operating system's credential store, the
// terminal's browser opener and device-code surface, and the inter-process
// refresh lock. Tokens never leave the store; the device code and address
// are the only values printed.
import { setTimeout as pause } from 'node:timers/promises'
import {
  GrokSignInError,
  grokRecordSchema,
  type GrokDevicePrompt,
  type GrokHostPort,
} from '../core/providers/subscriptions/grok'
import { StoreUnavailableError, storeOperation } from './keyStore'
import type { SecretStore } from '../host/auth/credentialStore'
import { PROVIDER_SECRET_PREFIX } from '../shared/constants'
import { startGrokCallback } from './subscriptionCallback'
import { withGrokRefreshLock } from './subscriptionRefreshLock'
import type { NamedLockOptions } from './namedLock'

const RECORD_ACCOUNT = `${PROVIDER_SECRET_PREFIX}grok`

/**
The grant's OS-store calls. A refusal is the credential store's and is
said as such: the sign-in core's guard would otherwise report any foreign
error as a temporary xAI failure.
*/
async function grantStore<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await storeOperation(work)
  } catch (error) {
    // A store failure reads as the store's refusal. Anything else is a
    // caller bug, not the store, and stays what it is.
    if (error instanceof StoreUnavailableError)
      throw new GrokSignInError('store-unavailable', undefined, { cause: error })
    throw error
  }
}

/** The host's fetch answers the caller's abort beside the request's own signal. */
function abortableFetch(send: typeof fetch, signal: AbortSignal | undefined): typeof fetch {
  if (signal === undefined) return send
  return (url, init) =>
    send(url, {
      ...init,
      signal: init?.signal == null ? signal : AbortSignal.any([signal, init.signal]),
    })
}

export interface RuntimeGrokOptions {
  readonly secrets: SecretStore
  readonly fetch: typeof fetch
  /** This app's own xAI client id from configuration; unset refuses before any request. */
  readonly clientId: string | undefined
  /** The scopes to ask for; blank asks the OpenID base set. */
  readonly scopes: string | undefined
  /** Terminal commands print the URL; editor adapters may open their browser. */
  readonly openBrowser: (url: string) => Promise<void>
  readonly callbackText: () => string
  /**
  Show one device code; the terminal prints it, editors prompt for it.
  Absent where no surface can show one (session dispatch): the device
  flow then refuses as unsupported.
  */
  readonly presentDeviceCode?: (prompt: GrokDevicePrompt) => Promise<void>
  readonly signal?: AbortSignal
  readonly lock?: NamedLockOptions
}

export function createRuntimeGrokHost(options: RuntimeGrokOptions): GrokHostPort {
  const withRefreshLock: GrokHostPort['withRefreshLock'] = (work) =>
    withGrokRefreshLock(work, {
      ...options.lock,
      ...(options.signal !== undefined && { signal: options.signal }),
    })
  const readStored = async (): Promise<unknown> => {
    const stored = await grantStore(async () => await options.secrets.get(RECORD_ACCOUNT))
    if (stored === undefined) return undefined
    try {
      const value: unknown = JSON.parse(stored)
      if (!grokRecordSchema.safeParse(value).success) throw new GrokSignInError('grant-unreadable')
      return value
    } catch (error) {
      // Only malformed text fails here: a typed failure is already named,
      // and anything else is not this entry's answer to give.
      if (error instanceof GrokSignInError) throw error
      if (error instanceof SyntaxError) throw new GrokSignInError('grant-unreadable')
      throw error
    }
  }
  const sleep = async (ms: number): Promise<void> => {
    try {
      if (options.signal === undefined) await pause(ms)
      else await pause(ms, undefined, { signal: options.signal })
    } catch (error) {
      // An aborted pause is the person's cancellation, said as that with
      // its cause kept; anything else stays what it is.
      if (options.signal?.aborted !== true) throw error
      throw new GrokSignInError('cancelled', undefined, { cause: error })
    }
  }
  return {
    clientId: options.clientId,
    scopes: options.scopes,
    now: Date.now,
    fetch: abortableFetch(options.fetch, options.signal),
    ...(options.signal !== undefined && { signal: options.signal }),
    openBrowser: async (url) => {
      try {
        await options.openBrowser(url)
      } catch (error) {
        // The terminal or editor could not show the address: said as that, never as an xAI outage.
        throw new GrokSignInError('browser-unavailable', undefined, { cause: error })
      }
    },
    startCallback: (state, timeoutMs) =>
      startGrokCallback(state, timeoutMs, options.callbackText, options.signal),
    ...(options.presentDeviceCode !== undefined && {
      presentDeviceCode: options.presentDeviceCode,
    }),
    sleep,
    readRecord: () => readStored(),
    // A grant that fails its own schema was built from xAI's token answer.
    writeRecord: async (record) => {
      if (!grokRecordSchema.safeParse(record).success) throw new GrokSignInError('invalid-token')
      await grantStore(async () => {
        await options.secrets.store(RECORD_ACCOUNT, JSON.stringify(record))
      })
    },
    deleteRecord: async () => {
      await grantStore(async () => {
        await options.secrets.delete(RECORD_ACCOUNT)
      })
    },
    withRefreshLock,
  }
}
