// VS Code ports for the shared subscription core. The global-storage files
// contain only an opaque host id, never tokens; the refresh lock is the
// cross-surface named lock the runtime CLI and ACP agent share.
import * as vscode from 'vscode'
import { CHATGPT_REGISTRATION_SECRET_KEY, PROVIDER_SECRET_PREFIX } from '../../../shared/constants'
import {
  ChatGptSignIn,
  ChatGptSignInError,
  type ChatGptHostPort,
} from '../../backend/subscriptionsEntry'
import type { NamedLockOptions } from '../../../runtime/namedLock'
import type { RecordStore } from '../../providers/credentialRecords'
import { loadChatGptHostId } from '../../providers/chatgptHostId'
import { fileErrorCode, startChatGptCallback } from '../../providers/subscriptionCallback'
import { withEditorChatGptRefreshLock } from '../../providers/subscriptionRefreshLock'

/**
The grant's SecretStorage calls. A refusal is the editor's credential
store and is said as such: the sign-in core's guard would otherwise report
any foreign error as a temporary ChatGPT failure (F14).
*/
async function grantStore<T>(work: () => Thenable<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw new ChatGptSignInError('store-unavailable', undefined, { cause: error })
  }
}

export interface ChatGptVsCodeDeps {
  readonly secrets: RecordStore
  readonly globalStorageUri: vscode.Uri
  /** Captured remote forwarding is not available; remote sign-in refuses. */
  readonly isRemote: boolean
  readonly fetch: typeof fetch
  readonly openExternal?: (uri: vscode.Uri) => Thenable<boolean>
  /** Refused sign-in callbacks are logged here, without any request text. */
  readonly log: (message: string) => void
  /** Test isolation for the refresh lock; production takes the shared names. */
  readonly lock?: NamedLockOptions
}

/** W composes this factory into the lazy Models panel; X implements the same core port. */
export async function createChatGptSignIn(deps: ChatGptVsCodeDeps): Promise<ChatGptSignIn> {
  try {
    const directory = deps.globalStorageUri.fsPath
    const withRefreshLock: ChatGptHostPort['withRefreshLock'] = (work) =>
      withEditorChatGptRefreshLock(work, deps.lock)
    const hostId = await withRefreshLock(() => loadChatGptHostId(directory))
    const key = `${PROVIDER_SECRET_PREFIX}chatgpt`
    const readStored = async (account: string): Promise<unknown> => {
      const stored = await grantStore(() => deps.secrets.get(account))
      if (stored === undefined) return
      try {
        const parsed: unknown = JSON.parse(stored)
        return parsed
      } catch (error: unknown) {
        // Only the parser's own failure reads as an unreadable grant; anything
        // else reaches the caller with its cause, never mislabelled.
        if (error instanceof SyntaxError) {
          throw new ChatGptSignInError(
            account === key ? 'grant-unreadable' : 'registration-unreadable',
          )
        }
        throw error
      }
    }
    return new ChatGptSignIn({
      hostId,
      fetch: deps.fetch,
      now: Date.now,
      withRefreshLock,
      openBrowser: async (url) => {
        let isOpened = false
        try {
          isOpened = await (deps.openExternal ?? vscode.env.openExternal)(vscode.Uri.parse(url))
        } catch {
          // The editor refused to open it: said as that below, never as a ChatGPT outage.
        }
        if (!isOpened) throw new ChatGptSignInError('browser-unavailable')
      },
      startCallback: async (state, timeoutMs, clientId) => {
        if (deps.isRemote) throw new ChatGptSignInError('invalid-callback')
        return await startChatGptCallback(state, timeoutMs, clientId, deps.log)
      },
      readRecord: () => readStored(key),
      writeRecord: async (record) => {
        await grantStore(() => deps.secrets.store(key, JSON.stringify(record)))
      },
      deleteRecord: async () => {
        await grantStore(() => deps.secrets.delete(key))
      },
      // The core validates both shapes; this port stores the JSON as given.
      readRegistration: () => readStored(CHATGPT_REGISTRATION_SECRET_KEY),
      writeRegistration: async (registration) => {
        await grantStore(() =>
          deps.secrets.store(CHATGPT_REGISTRATION_SECRET_KEY, JSON.stringify(registration)),
        )
      },
    })
  } catch (error) {
    // A typed failure (a corrupt host id) keeps its own sentence; anything else
    // is a local file problem, said with the operating system's code.
    if (error instanceof ChatGptSignInError) throw error
    const code = fileErrorCode(error)
    throw new ChatGptSignInError('local-failed', typeof code === 'string' ? code : 'unknown', {
      cause: error,
    })
  }
}
