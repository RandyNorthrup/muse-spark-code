import path from 'node:path'
// Production subscriptions live in the lazy Models panel bundle. Core and
// codecs are supplied by providers.js, shared with the ACP runtime.
import type * as vscode from 'vscode'
import type { ProviderClient } from '../../core/backends/modelapi/client'
import { createChatGptSignIn } from './chatgptSignIn'
import { connectCopilotFromClick } from './copilotClient'
import {
  createModelsPanelSeam,
  setUiText,
  providersFile,
  recordPlanUsage,
  OPENROUTER_ORIGIN,
} from '../backend/providersEntry'
import {
  ChatGptSignInError,
  createSubscriptionClient,
  chatGptModels,
  chatGptAccountId,
  chatGptPlanAccount,
  setUiText as setSubscriptionUiText,
} from '../backend/subscriptionsEntry'
import type { CoreLogger } from '../../core/logging'
import type { SecretStore } from '../auth/credentialStore'
import type { UiTable } from '../l10n'
import { PROVIDER_SECRET_PREFIX, SECRET_KEYS, UI_TEXT } from '../../shared/constants'
import {
  planUsageReportSchema,
  providerUsageRowSchema,
  type ProviderUsageRow,
} from '../../shared/usage'
import { fill, setUiText as setHostUiText } from '../../shared/l10n/text'

export function createSubscriptionFeatures(options: {
  readonly log: CoreLogger
  readonly secrets: SecretStore
  readonly globalStorageUri: vscode.Uri
  readonly catalogFile?: string
  readonly configFile: string
  /** Lane RETRYLIMITS: the person's retry limit, read live per transport. */
  readonly personCap?: () => number | undefined
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
  setSubscriptionUiText(options.l10n.table, options.l10n.locale)
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
          log: (message) => {
            options.log.info(message)
          },
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
  const configured = async (meta?: ProviderClient) => {
    const entry = await import('../backend/configuredProvidersEntry')
    entry.setUiText(options.l10n.table, options.l10n.locale)
    return entry.createConfiguredProviderServices(meta, {
      configFile: options.configFile,
      catalogFile: options.catalogFile ?? path.resolve(__dirname, 'providerCatalog.json'),
      secrets: options.secrets,
      // The transport's still-waiting notices reach the product log
      // (PR #214 review); per-request timing still goes nowhere.
      log: options.log,
      ...(options.personCap !== undefined && { personCap: options.personCap }),
      hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
      loadUsage: () => tallies.filter((row) => !['chatgpt', 'copilot'].includes(row.providerId)),
      saveUsage: (rows) => {
        persist([
          ...tallies.filter((row) => ['chatgpt', 'copilot'].includes(row.providerId)),
          ...rows,
        ])
      },
    })
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
  const panelFetch: typeof seam.fetcher.fetchModels = (...args) => seam.fetcher.fetchModels(...args)
  const fetchModels: typeof seam.fetcher.fetchModels = async (provider, key, signal) => {
    if (provider.auth === 'subscription') return await panelFetch(provider, key, signal)
    const services = await configured()
    return {
      rows: await services.scanRows(providersFile.providerEntrySchema.parse(provider), key, signal),
    }
  }
  const panelSeam = {
    ...seam,
    catalog: {
      ...seam.catalog,
      get: (id: string) => {
        const preset = seam.catalog.get(id)
        return preset?.id === 'openrouter'
          ? { ...preset, connectLabel: fill(UI_TEXT.providerConnect, { provider: preset.name }) }
          : preset
      },
    },
    exchanger: {
      exchange: async (request: {
        readonly code: string
        readonly verifier: string
        readonly signal?: AbortSignal
      }) => {
        const services = await configured()
        return await services.openRouterExchange(request.code, request.verifier, request.signal)
      },
    },
    usage: {
      read: async (key: string, signal?: AbortSignal) => {
        const services = await configured()
        return await services.openRouterUsage(
          {
            id: 'openrouter',
            preset: 'openrouter',
            address: OPENROUTER_ORIGIN,
            auth: 'apiKey',
            models: [],
          },
          key,
          signal,
        )
      },
    },
    fetcher: { fetchModels },
    tester: {
      test: async (provider: Parameters<typeof fetchModels>[0], key: string) => {
        const services = await configured()
        return await services.test(providersFile.providerEntrySchema.parse(provider), key)
      },
    },
  }
  const accountId = async () => {
    if (copilot.size > 0 && !options.isConfidential()) return 'copilot-host-grant'
    const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
    const services = await configured()
    return chatGptAccountId(stored) ?? (await services.accountId())
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
    seam: panelSeam,
    readKeyUsage: async (): Promise<ProviderUsageRow[]> => {
      const services = await configured()
      const rows: ProviderUsageRow[] = []
      const entries = await seam.store.list()
      for (const entry of entries) {
        if (entry.preset !== 'openrouter') continue
        try {
          const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)
          if (stored === undefined) throw new Error(UI_TEXT.providerUsageFailed)
          const snapshot = await services.openRouterUsage(
            providersFile.providerEntrySchema.parse(entry),
          )
          if ((await options.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)) !== stored)
            throw new Error(UI_TEXT.providerUsageFailed)
          rows.push(
            providerUsageRowSchema.parse({
              providerId: entry.id,
              providerLabel: seam.catalog.get(entry.preset)?.name ?? entry.id,
              pricing: 'priced',
              inputTokens: 0,
              outputTokens: 0,
              keyUsage: {
                totalUsd: snapshot.usedTotal,
                unlimited: snapshot.unlimited,
                todayUsd: snapshot.usedToday,
                weekUsd: snapshot.usedThisWeek,
                monthUsd: snapshot.usedThisMonth,
                limitUsd: snapshot.limit,
                remainingUsd: snapshot.remaining,
              },
            }),
          )
        } catch {
          rows.push({
            providerId: entry.id,
            providerLabel: 'OpenRouter',
            pricing: 'priced',
            inputTokens: 0,
            outputTokens: 0,
            keyUsageError: UI_TEXT.providerUsageFailed,
          })
        }
      }
      return rows
    },
    hasCopilotAccess: () => copilot.size > 0 && !options.isConfidential(),
    accountId,
    planAccount: async () => {
      const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
      return chatGptPlanAccount(stored)
    },
    createClient: async (meta: ProviderClient): Promise<ProviderClient> => {
      const entries = await seam.store.list()
      const subscribed = entries.some((row) => row.auth === 'subscription')
        ? createSubscriptionClient(meta, {
            fetch: fetcher,
            hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
            // Lane PR225W1: the plan routes answer the person's setting.
            ...(options.personCap !== undefined && {
              personCap: options.personCap,
            }),
            chatgpt,
            accountId,
            // Indefinite ChatGPT stream waits say so on the product log
            // (PR #214 review) instead of looking hung until Stop.
            log: options.log,
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
        : meta
      if (entries.every((row) => row.auth === 'subscription')) return subscribed
      const services = await configured(subscribed)
      return services.client
    },
    /**
    Connect ChatGPT. A saved registration is reused; `isNewAccount` registers
    a different account instead, and like a terminal `add` it never
    replaces a grant that is still stored.
    */
    connectChatGpt: async (isNewAccount = false) => {
      const core = await chatgpt()
      const isNew = (await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)) === undefined
      if (!isNew && isNewAccount) throw new ChatGptSignInError('already-added')
      if (isNew) await core.signIn({ isNewAccount })
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
