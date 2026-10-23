// VS Code ports for the Grok subscription core: the shared file lock and
// loopback server, this app's configured xAI client id, and no host id or
// registration. Deliberately free of the `vscode` module, so the port runs
// in unit tests over the real server, lock and store; the caller adapts
// the editor's storage path and opener.
import { randomUUID } from 'node:crypto'
import {
  MILLISECONDS_PER_SECOND,
  OAUTH_CODE_TTL_MS,
  PROVIDER_SECRET_PREFIX,
} from '../../shared/constants'
import {
  GrokSignIn,
  GrokSignInError,
  type GrokHostPort,
  type GrokRecord,
} from '../backend/subscriptionsEntry'
import type { RecordStore } from './credentialRecords'
import { startGrokCallback } from './subscriptionCallback'
import { withSubscriptionFileLock } from './subscriptionFileLock'

export interface GrokVsCodeDeps {
  readonly secrets: RecordStore
  readonly globalStoragePath: string
  /** Captured remote forwarding is not available; remote sign-in refuses. */
  readonly isRemote: boolean
  /** This app's own xAI client id from configuration; unset refuses before any request. */
  readonly clientId: string | undefined
  /** The scopes to ask for; blank asks the OpenID base set. */
  readonly scopes: string | undefined
  readonly fetch: typeof fetch
  readonly openExternal: (url: string) => Promise<boolean>
  /** Refused sign-in callbacks are logged here, without any request text. */
  readonly log: (message: string) => void
  readonly lockTimeoutMs?: number
  readonly lockPollMs?: number
}

/** The Models & Agents panel composes this factory beside the ChatGPT one. */
export function createGrokSignIn(deps: GrokVsCodeDeps): GrokSignIn {
  const ownerId = randomUUID()
  const key = `${PROVIDER_SECRET_PREFIX}grok`
  const withRefreshLock: GrokHostPort['withRefreshLock'] = (work) =>
    withSubscriptionFileLock(
      deps.globalStoragePath,
      ownerId,
      deps.lockTimeoutMs ?? OAUTH_CODE_TTL_MS,
      deps.lockPollMs ?? MILLISECONDS_PER_SECOND,
      work,
      {
        lockFile: 'grok.refresh.lock',
        tmpPrefix: '.grok-lock-',
        failBusy: () => new GrokSignInError('lock-busy'),
      },
    )
  const readStored = async (): Promise<unknown> => {
    let stored: string | undefined
    try {
      stored = await deps.secrets.get(key)
    } catch (error) {
      throw new GrokSignInError('store-unavailable', undefined, { cause: error })
    }
    if (stored === undefined) return undefined
    try {
      const parsed: unknown = JSON.parse(stored)
      return parsed
    } catch (error: unknown) {
      // Only the parser's own failure reads as an unreadable grant; anything
      // else reaches the caller with its cause, never mislabelled.
      if (error instanceof SyntaxError) throw new GrokSignInError('grant-unreadable')
      throw error
    }
  }
  const writeStored = async (record: GrokRecord): Promise<void> => {
    try {
      await deps.secrets.store(key, JSON.stringify(record))
    } catch (error) {
      throw new GrokSignInError('store-unavailable', undefined, { cause: error })
    }
  }
  const deleteStored = async (): Promise<void> => {
    try {
      await deps.secrets.delete(key)
    } catch (error) {
      throw new GrokSignInError('store-unavailable', undefined, { cause: error })
    }
  }
  return new GrokSignIn({
    clientId: deps.clientId,
    scopes: deps.scopes,
    fetch: deps.fetch,
    now: Date.now,
    withRefreshLock,
    openBrowser: async (url) => {
      try {
        if (!(await deps.openExternal(url))) throw new GrokSignInError('browser-unavailable')
      } catch (error) {
        // A typed refusal keeps its own sentence; anything else is the
        // editor failing to open, said as that with its cause kept.
        if (error instanceof GrokSignInError) throw error
        if (!(error instanceof Error)) throw error
        throw new GrokSignInError('browser-unavailable', undefined, { cause: error })
      }
    },
    startCallback: async (state, timeoutMs) => {
      if (deps.isRemote) throw new GrokSignInError('invalid-callback')
      return await startGrokCallback(state, timeoutMs, deps.log)
    },
    readRecord: () => readStored(),
    writeRecord: (record) => writeStored(record),
    deleteRecord: () => deleteStored(),
  })
}
