// Production subscriptions live in the lazy Models panel bundle. Core and
// codecs are supplied by providers.js, shared with the ACP runtime.
import type * as vscode from 'vscode'
import type { ProviderClient } from '../../core/backends/modelapi/client'
import { createChatGptSignIn } from './chatgptSignIn'
import { connectCopilotFromClick } from './copilotClient'
import {
  createModelsPanelSeam,
  createSubscriptionClient,
  chatGptModels,
  chatGptAccountId,
  chatGptPlanAccount,
  setUiText,
  providersFile,
  recordPlanUsage,
} from '../backend/providersEntry'
import type { CoreLogger } from '../../core/logging'
import type { SecretStore } from '../auth/credentialStore'
import type { UiTable } from '../l10n'
import { PROVIDER_SECRET_PREFIX, SECRET_KEYS, UI_TEXT } from '../../shared/constants'
import { planUsageReportSchema } from '../../shared/usage'
import { setUiText as setHostUiText } from '../../shared/l10n/text'

export function createSubscriptionFeatures(options: {
  readonly log: CoreLogger
  readonly secrets: SecretStore
  readonly globalStorageUri: vscode.Uri
  readonly configFile: string
  readonly l10n: UiTable
  readonly globalState: {
    get(key: string): unknown
    update(key: string, value: unknown): Thenable<void>
  }
  readonly isRemote: boolean
  readonly isConfidential: () => boolean
  readonly access: vscode.LanguageModelAccessInformation
  readonly connected: (ref: string) => Promise<void>
  readonly disconnected: () => Promise<void>
  readonly fetch?: typeof fetch
}) {
  setHostUiText(options.l10n.table, options.l10n.locale)
  setUiText(options.l10n.table, options.l10n.locale)
  const fetcher = options.fetch ?? globalThis.fetch
  let signIn: ReturnType<typeof createChatGptSignIn> | undefined
  const chatgpt = () =>
    (signIn ??= (async () => {
      try {
        return await createChatGptSignIn({
          secrets: options.secrets,
          globalStorageUri: options.globalStorageUri,
          isRemote: options.isRemote,
          fetch: fetcher,
        })
      } catch (error) {
        signIn = undefined
        throw error
      }
    })())
  const copilot = new Map<string, Awaited<ReturnType<typeof connectCopilotFromClick>>[number]>()
  const previous = planUsageReportSchema.safeParse(options.globalState.get('subscriptionUsage'))
  let tallies = previous.success ? previous.data : []
  let saving = Promise.resolve()
  const persist = (rows: ReturnType<typeof recordPlanUsage>) => {
    tallies = [...rows]
    const previousWrite = saving
    saving = (async () => {
      try {
        await previousWrite
        await options.globalState.update('subscriptionUsage', rows)
      } catch {
        options.log.warn('Plan usage could not be saved')
      }
    })()
  }
  const seam = createModelsPanelSeam({
    configFile: options.configFile,
    subscriptionModels: async (id) => {
      if (id === 'chatgpt') return await chatGptModels(await chatgpt(), fetcher)
      const ids: string[] = []
      if (!options.isConfidential())
        copilot.forEach((_client, key) => {
          ids.push(key)
        })
      return ids
    },
  })
  const accountId = async () => {
    if (copilot.size > 0 && !options.isConfidential()) return 'copilot-host-grant'
    const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
    return chatGptAccountId(stored)
  }
  const save = async (id: 'chatgpt' | 'copilot', models: readonly string[]) => {
    if (models.length === 0) throw new Error(UI_TEXT.actionFailed)
    await seam.store.restore({
      id,
      preset: id,
      auth: 'subscription',
      models,
      address: id === 'chatgpt' ? 'https://api.openai.com' : 'https://github.com/copilot',
      format: id === 'chatgpt' ? 'responses' : 'chat',
    })
    const ref = `${id}/${models[0] ?? ''}`
    await seam.store.setDefaultModel(ref)
    await options.connected(ref)
  }
  return {
    seam,
    hasCopilotAccess: () => copilot.size > 0 && !options.isConfidential(),
    accountId,
    planAccount: async () => {
      const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
      return chatGptPlanAccount(stored)
    },
    createClient: async (meta: ProviderClient): Promise<ProviderClient> => {
      const entries = await seam.store.list()
      if (entries.every((row) => row.auth !== 'subscription')) return meta
      return createSubscriptionClient(meta, {
        fetch: fetcher,
        hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
        chatgpt,
        accountId,
        providers: async () =>
          providersFile.providersFileSchema.parse({ v: 1, providers: await seam.store.list() }),
        copilot: () => (options.isConfidential() ? new Map() : copilot),
        copilotUsage: () => tallies.filter((row) => row.providerId === 'copilot'),
        loadUsage: () => tallies,
        saveUsage: (rows) => {
          persist([
            ...rows.filter((row) => row.providerId !== 'copilot'),
            ...tallies.filter((row) => row.providerId === 'copilot'),
          ])
        },
      })
    },
    connectChatGpt: async () => {
      const core = await chatgpt()
      const isNew = (await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) === undefined
      if (isNew) await core.signIn()
      try {
        await save('chatgpt', await chatGptModels(core, fetcher))
      } catch (error) {
        if (isNew) await core.remove()
        throw error
      }
    },
    connectCopilot: async () => {
      const clients = await connectCopilotFromClick({
        justification: () => UI_TEXT.planUi.aiContent,
        failureText: (code) => {
          if (code === 'quota') return UI_TEXT.planUi.copilotQuota
          if (code === 'rate-limit') return UI_TEXT.planUi.copilotRateLimit
          return code === 'consent-required'
            ? UI_TEXT.planUi.copilotConsent
            : UI_TEXT.planUi.copilotUnavailable
        },
        isConfidential: options.isConfidential,
        isUserInitiated: () => true,
        canSendRequest: (model) => options.access.canSendRequest(model),
        recordEstimatedUsage: (_model, inputTokens, outputTokens) => {
          persist(
            recordPlanUsage(tallies, {
              providerId: 'copilot',
              tokens: { inputTokens, outputTokens, source: 'estimated' },
            }),
          )
        },
      })
      for (const client of clients) copilot.set(client.model.id, client)
      await save(
        'copilot',
        clients.map((client) => client.model.id),
      )
    },
    removeSubscription: async (id: string) => {
      try {
        if (id === 'chatgpt') {
          const core = await chatgpt()
          await core.remove()
        } else if (id === 'copilot') copilot.clear()
        else throw new Error(UI_TEXT.actionFailed)
      } finally {
        await seam.store.remove(id)
        await options.disconnected()
      }
    },
  }
}
