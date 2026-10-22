import path from 'node:path'
import { uiLocale } from '../shared/l10n/text'
// Terminal and editor entry points use the same runtime host. Only the
// browser's authorize URL and translated status reach the command output.
import {
  ChatGptSignIn,
  ChatGptSignInError,
  chatGptGrantStatus,
  chatGptRecordSchema,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import type { SignInMethod } from '../acp/agent'
import { providersFile, modelRef } from '../host/backend/providersEntry'
const { emptyProvidersFile, readProvidersFile, writeProvidersFileAtomic } = providersFile
const { parseModelRef } = modelRef
import { createRuntimeChatGptHost, type RuntimeChatGptOptions } from './chatGptHost'
import { ACP_AGENT_NAME, CHATGPT_NEW_ACCOUNT_FLAG, UI_TEXT } from '../shared/constants'
import { failureCodeNames } from '../core/networkFailure'
import { fill, setUiText } from '../shared/l10n/text'
import type { ProviderClient } from '../core/backends/modelapi/client'
import {
  createSubscriptionClient,
  chatGptAccountId,
  chatGptCatalog,
  chatGptFailureText,
} from '../core/providers/subscriptions/registry'
import { PROVIDER_SECRET_PREFIX, SECRET_KEYS } from '../shared/constants'
import { providersFileUnreadable } from '../core/accountStoreError'

/** The same registry serves JetBrains, Visual Studio, Eclipse and every ACP client. */
export function runtimeSubscriptionClient(
  options: RuntimeChatGptOptions & { readonly configFile: string; readonly catalogFile?: string },
) {
  let host: Promise<ChatGptHostPort> | undefined
  const getHost = () =>
    (host ??= (async () => {
      try {
        return await createRuntimeChatGptHost(options)
      } catch (error) {
        host = undefined
        throw error
      }
    })())
  const accountId = async () => {
    const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
    if (stored !== undefined) return chatGptAccountId(stored)
    const entry = await import('../host/backend/configuredProvidersEntry')
    entry.setUiText(UI_TEXT, uiLocale())
    return await entry
      .createConfiguredProviderServices(undefined, {
        configFile: options.configFile,
        catalogFile: options.catalogFile ?? path.resolve(__dirname, 'providerCatalog.json'),
        secrets: options.secrets,
      })
      .accountId()
  }
  return {
    accountId,
    createClient: async (meta: ProviderClient): Promise<ProviderClient> => {
      const read = async () => {
        const result = await readProvidersFile(options.configFile)
        if (result.ok) return result.file
        if (result.reason === 'missing') return emptyProvidersFile()
        // A session reads its cause here, not through the command layer:
        // the file's own fault in the refusal the editor boundary names.
        throw providersFileUnreadable(result.reason)
      }
      const file = await read()
      const subscribed = file.providers.some((entry) => entry.id === 'chatgpt')
        ? createSubscriptionClient(meta, {
            fetch: options.fetch,
            hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
            providers: read,
            accountId,
            chatgpt: async () => new ChatGptSignIn(await getHost()),
          })
        : meta
      if (file.providers.every((entry) => entry.auth === 'subscription')) return subscribed
      const entry = await import('../host/backend/configuredProvidersEntry')
      entry.setUiText(UI_TEXT, uiLocale())
      return entry.createConfiguredProviderServices(subscribed, {
        configFile: options.configFile,
        catalogFile: options.catalogFile ?? path.resolve(__dirname, 'providerCatalog.json'),
        secrets: options.secrets,
        hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
      }).client
    },
  }
}

/** `add-new-account` is `providers add chatgpt --new-account`: a new registration. */
export type ChatGptProviderAction = 'add' | 'add-new-account' | 'remove' | 'status'
export type ChatGptLocalStatus = 'signed-in' | 'expired' | 'signed-out'

/** Translated command text; failure codes never contain service text. */
export interface ChatGptCommandText {
  beforeSignIn(): string
  alreadyAdded(): string
  status(state: ChatGptLocalStatus): string
  /** `reason` carries the OS code for a `lock-unavailable` failure only. */
  failure(code: ChatGptSignInError['code'], reason?: string): string
}

export interface ChatGptProviderCommandDeps {
  createHost(): Promise<ChatGptHostPort>
  /** Nonsecret file/catalogue wiring commits atomically before success.
  Both calls run under the grant's process lock. */
  readonly providers: {
    add(host: ChatGptHostPort): Promise<void>
    remove(): Promise<void>
  }
  readonly text: ChatGptCommandText
  print(line: string): void
  printError(line: string): void
}

/** Best-effort revocation after a failed setup: the setup failure dominates,
so a revoke failure is attempted and dropped, never replacing the cause. */
const revokeSignInQuietly = async (signIn: ChatGptSignIn): Promise<void> => {
  try {
    await signIn.remove()
  } catch {
    /* The failed setup still fails; revocation attempted and the local record deleted. */
  }
}

export async function runChatGptProviderCommand(
  action: ChatGptProviderAction,
  deps: ChatGptProviderCommandDeps,
): Promise<number> {
  try {
    if (action === 'add' || action === 'add-new-account') deps.print(deps.text.beforeSignIn())
    const host = await deps.createHost()
    if (action === 'status') {
      const state = await host.withRefreshLock(async (): Promise<ChatGptLocalStatus> => {
        const stored = await host.readRecord()
        if (stored === undefined) return 'signed-out'
        const parsed = chatGptRecordSchema.safeParse(stored)
        if (!parsed.success) throw new ChatGptSignInError('grant-unreadable')
        return chatGptGrantStatus(parsed.data, host.now())
      })
      deps.print(deps.text.status(state))
      return state === 'signed-out' ? 1 : 0
    }
    return await host.withRefreshLock(async () => {
      const signIn = new ChatGptSignIn({
        ...host,
        // The outer grant lock remains held through configuration and rollback.
        // Re-entering the nonreentrant OS listener here would deadlock.
        withRefreshLock: (work) => work(),
      })
      if (action === 'remove') {
        try {
          await signIn.remove()
        } finally {
          await deps.providers.remove()
        }
        deps.print(fill(UI_TEXT.acpProviderRemoved, { id: 'chatgpt' }))
        return 0
      }
      // Never overwrite an unrevoked grant, including an expired one.
      if ((await host.readRecord()) !== undefined) {
        deps.printError(deps.text.alreadyAdded())
        return 1
      }
      await signIn.signIn({ isNewAccount: action === 'add-new-account' })
      try {
        await deps.providers.add(host)
      } catch (error) {
        await revokeSignInQuietly(signIn)
        throw error
      }
      deps.print(fill(UI_TEXT.acpProviderAdded, { id: 'chatgpt' }))
      return 0
    })
  } catch (error) {
    deps.printError(
      deps.text.failure(
        error instanceof ChatGptSignInError ? error.code : 'request-failed',
        error instanceof ChatGptSignInError ? error.reason : failureCodeNames(error),
      ),
    )
    return 1
  }
}

/** A ChatGPT failure's own sentence, or undefined for an error that is not one. */
export function chatGptFailureOf(error: unknown): string | undefined {
  return error instanceof ChatGptSignInError
    ? chatGptFailureText(error.code, error.reason)
    : undefined
}

/** Live language reads; no provider error or store text is ever interpolated. */
export function chatGptCommandText(): ChatGptCommandText {
  return {
    beforeSignIn: () => UI_TEXT.acpChatGpt.notice,
    alreadyAdded: () => UI_TEXT.acpChatGpt.alreadyAdded,
    status: (state) => UI_TEXT.acpChatGpt.states[state],
    failure: chatGptFailureText,
  }
}

/** Production terminal and ACP composition, using the shared atomic nonsecret file. */
export function runtimeChatGptCommandDeps(
  options: RuntimeChatGptOptions & {
    readonly uiText: typeof UI_TEXT
    readonly locale: string
    readonly configFile: string
    readonly print: (line: string) => void
    readonly printError: (line: string) => void
  },
): ChatGptProviderCommandDeps {
  setUiText(options.uiText, options.locale)
  const read = async () => {
    const result = await readProvidersFile(options.configFile)
    if (result.ok) return result.file
    if (result.reason === 'missing') return emptyProvidersFile()
    throw new ChatGptSignInError('providers-file-unreadable', result.reason)
  }
  const save = async (file: unknown) => {
    const result = await writeProvidersFileAtomic(options.configFile, file)
    if (!result.ok) throw new ChatGptSignInError('providers-file-unwritable', result.reason)
  }
  return {
    createHost: () => createRuntimeChatGptHost(options),
    text: chatGptCommandText(),
    print: options.print,
    printError: options.printError,
    providers: {
      add: async (host) => {
        const file = await read()
        if (file.providers.some((entry) => entry.id === 'chatgpt'))
          throw new ChatGptSignInError('already-added')
        // The plan's own catalogue, read the way every surface reads it, so a
        // refused, unreadable or empty list names its cause. The command
        // already holds the nonreentrant grant lock through this commit.
        const { slugs: models } = await chatGptCatalog(
          new ChatGptSignIn({ ...host, withRefreshLock: (work) => work() }),
          host.fetch,
        )
        await save({
          ...file,
          providers: [
            ...file.providers,
            {
              id: 'chatgpt',
              preset: 'chatgpt',
              address: 'https://api.openai.com',
              format: 'responses',
              auth: 'subscription',
              models,
            },
          ],
        })
      },
      remove: async () => {
        const file = await read()
        const { defaultModel, ...rest } = file
        await save({
          ...rest,
          ...(defaultModel !== undefined &&
            parseModelRef(defaultModel)?.providerId !== 'chatgpt' && { defaultModel }),
          providers: file.providers.filter((entry) => entry.id !== 'chatgpt'),
        })
      },
    },
  }
}

/**
The stored grant's account identity: the verified account hash where the
sign-in captured one, else the whole record. A refused `add-new-account`
leaves the old grant byte-identical, so an unchanged identity fails.
*/
function chatGptGrantIdentity(record: unknown): string | undefined {
  const parsed = chatGptRecordSchema.safeParse(record)
  return parsed.success ? (parsed.data.accountIdHash ?? JSON.stringify(parsed.data)) : undefined
}

/** ACP terminal auth methods run the exact same CLI actions in every editor. */
export function chatGptAuthenticationMethods(
  createHost: () => Promise<ChatGptHostPort>,
): SignInMethod[] {
  const actions: readonly ChatGptProviderAction[] = ['add', 'add-new-account', 'remove', 'status']
  // The grant as it was before the editor runs the terminal command (these
  // methods are built when the agent starts, the command runs later in its
  // own process). `add-new-account` must change it: the refused command
  // leaves the old grant, so an unchanged grant stays failed instead of
  // reporting the different-account authentication as succeeded.
  const baselineRecord = (async (): Promise<unknown> => {
    const host = await createHost()
    return await host.withRefreshLock(async () => await host.readRecord())
  })()
  // A startup host, lock or store failure must surface through `verify`,
  // never as an unhandled rejection that ends the standalone agent before
  // any verifier runs: this marks the rejection handled while each `await`
  // below still observes it.
  void baselineRecord.then(undefined, () => {
    /* Marked handled; `verify` observes the rejection through `await`. */
  })
  return actions.map((action) => {
    const isAdd = action === 'add' || action === 'add-new-account'
    const args =
      action === 'add-new-account'
        ? ['providers', 'add', 'chatgpt', CHATGPT_NEW_ACCOUNT_FLAG]
        : ['providers', action, 'chatgpt']
    return {
      id: `chatgpt-${action}`,
      name: UI_TEXT.acpChatGpt.actions[action],
      description: UI_TEXT.acpChatGpt.notice,
      args,
      command: `${ACP_AGENT_NAME} ${args.join(' ')}`,
      verify: async () => {
        try {
          const host = await createHost()
          // Inside the try so a baseline the store cannot read fails closed
          // through the same sentence mapping, never as a success.
          const prior = action === 'add-new-account' ? await baselineRecord : undefined
          await host.withRefreshLock(async () => {
            const stored = await host.readRecord()
            if (stored === undefined) {
              if (isAdd) throw new ChatGptSignInError('not-signed-in')
              return
            }
            const parsed = chatGptRecordSchema.safeParse(stored)
            if (!parsed.success) throw new ChatGptSignInError('grant-unreadable')
            // An expired access token refreshes on use (as `status` says), so
            // a stored grant is a completed sign-in.
            if (action === 'remove') throw new ChatGptSignInError('still-signed-in')
            if (
              action === 'add-new-account' &&
              chatGptGrantIdentity(prior) === chatGptGrantIdentity(stored)
            ) {
              // The grant never changed: the command refused with
              // `already-added` and the account is still the old one.
              throw new ChatGptSignInError('already-added')
            }
          })
          return
        } catch (error) {
          return chatGptCommandText().failure(
            error instanceof ChatGptSignInError ? error.code : 'request-failed',
            error instanceof ChatGptSignInError ? error.reason : failureCodeNames(error),
          )
        }
      },
    }
  })
}
