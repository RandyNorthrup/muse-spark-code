// Terminal and editor entry points use the same runtime host. Only the
// browser's authorize URL and translated status reach the command output.
import {
  ChatGptSignIn,
  ChatGptSignInError,
  chatGptRecordSchema,
  type ChatGptHostPort,
} from '../core/providers/subscriptions/chatgpt'
import * as z from 'zod/mini'
import type { SignInMethod } from '../acp/agent'
import {
  emptyProvidersFile,
  readProvidersFile,
  writeProvidersFileAtomic,
} from '../core/providers/providersFile'
import { parseModelRef } from '../core/providers/modelRef'
import { createRuntimeChatGptHost, type RuntimeChatGptOptions } from './chatGptHost'
import { ACP_AGENT_NAME, OAUTH_CODE_TTL_MS, UI_TEXT } from '../shared/constants'
import { fill, setUiText } from '../shared/l10n/text'
import type { ProviderClient } from '../core/backends/modelapi/client'
import {
  createSubscriptionClient,
  chatGptAccountId,
} from '../core/providers/subscriptions/registry'
import { PROVIDER_SECRET_PREFIX, SECRET_KEYS } from '../shared/constants'

/** The same registry serves JetBrains, Visual Studio, Eclipse and every ACP client. */
export function runtimeSubscriptionClient(
  options: RuntimeChatGptOptions & { readonly configFile: string },
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
    const value: unknown = stored === undefined ? undefined : JSON.parse(stored)
    return chatGptAccountId(value)
  }
  return {
    accountId,
    createClient: async (meta: ProviderClient): Promise<ProviderClient> => {
      const read = async () => {
        const result = await readProvidersFile(options.configFile)
        if (result.ok) return result.file
        if (result.reason === 'missing') return emptyProvidersFile()
        throw new Error(UI_TEXT.actionFailed)
      }
      const file = await read()
      if (file.providers.every((entry) => entry.id !== 'chatgpt')) return meta
      return createSubscriptionClient(meta, {
        fetch: options.fetch,
        hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
        providers: read,
        accountId,
        chatgpt: async () => new ChatGptSignIn(await getHost()),
      })
    },
  }
}

export type ChatGptProviderAction = 'add' | 'remove' | 'status'
export type ChatGptLocalStatus = 'signed-in' | 'expired' | 'signed-out'

/** Translated command text; failure codes never contain service text. */
export interface ChatGptCommandText {
  beforeSignIn(): string
  alreadyAdded(): string
  status(state: ChatGptLocalStatus): string
  failure(code: ChatGptSignInError['code']): string
}

export interface ChatGptProviderCommandDeps {
  createHost(): Promise<ChatGptHostPort>
  /** Nonsecret file/catalogue wiring commits atomically before success.
   * Both calls run under the grant's process lock. */
  readonly providers: {
    add(host: ChatGptHostPort): Promise<void>
    remove(): Promise<void>
  }
  readonly text: ChatGptCommandText
  print(line: string): void
  printError(line: string): void
}

export async function runChatGptProviderCommand(
  action: ChatGptProviderAction,
  deps: ChatGptProviderCommandDeps,
): Promise<number> {
  try {
    if (action === 'add') deps.print(deps.text.beforeSignIn())
    const host = await deps.createHost()
    if (action === 'status') {
      const state = await host.withRefreshLock(async (): Promise<ChatGptLocalStatus> => {
        const stored = await host.readRecord()
        if (stored === undefined) return 'signed-out'
        const parsed = chatGptRecordSchema.safeParse(stored)
        if (!parsed.success) throw new ChatGptSignInError('invalid-token')
        return parsed.data.expiresAt > host.now() ? 'signed-in' : 'expired'
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
      await signIn.signIn()
      try {
        await deps.providers.add(host)
      } catch (error) {
        try {
          await signIn.remove()
        } catch {
          /* The failed setup still fails; revocation attempted and the local record deleted. */
        }
        throw error
      }
      deps.print(fill(UI_TEXT.acpProviderAdded, { id: 'chatgpt' }))
      return 0
    })
  } catch (error) {
    deps.printError(
      deps.text.failure(error instanceof ChatGptSignInError ? error.code : 'request-failed'),
    )
    return 1
  }
}

/** Live language reads; no provider error or store text is ever interpolated. */
export function chatGptCommandText(): ChatGptCommandText {
  return {
    beforeSignIn: () => UI_TEXT.acpChatGpt.notice,
    alreadyAdded: () => UI_TEXT.acpChatGpt.alreadyAdded,
    status: (state) => UI_TEXT.acpChatGpt.states[state],
    failure: (code) => {
      switch (code) {
        case 'store-unavailable': {
          return UI_TEXT.acpChatGpt.storeUnavailable
        }
        case 'expired': {
          return UI_TEXT.planUi.expired
        }
        case 'request-failed': {
          return UI_TEXT.planUi.retry
        }
        default: {
          return UI_TEXT.acpChatGpt.failure
        }
      }
    },
  }
}

/** Owner capture acdc0f60/577bc807, 2026-10-05: account catalogue, not API-key data[]. */
const modelsSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().check(z.minLength(1)),
      visibility: z.enum(['list', 'hide']),
      supported_in_api: z.boolean(),
    }),
  ),
})

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
    throw new ChatGptSignInError('request-failed')
  }
  const save = async (file: unknown) => {
    const result = await writeProvidersFileAtomic(options.configFile, file)
    if (!result.ok) throw new ChatGptSignInError('request-failed')
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
          throw new ChatGptSignInError('request-failed')
        const url = 'https://api.openai.com/v1/models'
        // The command already holds the nonreentrant grant lock through this commit.
        const token = await new ChatGptSignIn({
          ...host,
          withRefreshLock: (work) => work(),
        }).accessToken(url, 0)
        const response = await host.fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(OAUTH_CODE_TTL_MS),
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) throw new ChatGptSignInError('sign-in-required')
        const value: unknown = await response.json()
        const parsed = modelsSchema.safeParse(value)
        if (!parsed.success) throw new ChatGptSignInError('invalid-token')
        const models = [
          ...new Set(
            parsed.data.models
              .filter((model) => model.visibility === 'list' && model.supported_in_api)
              .map((model) => model.slug),
          ),
        ]
        if (models.length === 0) throw new ChatGptSignInError('sign-in-required')
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

/** ACP terminal auth methods run the exact same CLI actions in every editor. */
export function chatGptAuthenticationMethods(
  createHost: () => Promise<ChatGptHostPort>,
): SignInMethod[] {
  const actions: readonly ChatGptProviderAction[] = ['add', 'remove', 'status']
  return actions.map((action) => {
    const args = ['providers', action, 'chatgpt']
    return {
      id: `chatgpt-${action}`,
      name: UI_TEXT.acpChatGpt.actions[action],
      description: UI_TEXT.acpChatGpt.notice,
      args,
      command: `${ACP_AGENT_NAME} ${args.join(' ')}`,
      verify: async () => {
        try {
          const host = await createHost()
          await host.withRefreshLock(async () => {
            const stored = await host.readRecord()
            if (stored === undefined) {
              if (action === 'add') throw new ChatGptSignInError('sign-in-required')
              return
            }
            const parsed = chatGptRecordSchema.safeParse(stored)
            if (!parsed.success) throw new ChatGptSignInError('invalid-token')
            if (action === 'remove' || (action === 'add' && parsed.data.expiresAt <= host.now()))
              throw new ChatGptSignInError('sign-in-required')
          })
          return
        } catch (error) {
          return chatGptCommandText().failure(
            error instanceof ChatGptSignInError ? error.code : 'request-failed',
          )
        }
      },
    }
  })
}
