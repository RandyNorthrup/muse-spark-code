import path from 'node:path'
// Production subscriptions live in the lazy Models panel bundle. Core and
// codecs are supplied by providers.js, shared with the ACP runtime.
import * as vscode from 'vscode'
import type { ProviderClient } from '../../core/backends/modelapi/client'
import { createChatGptSignIn } from './chatgptSignIn'
import { createGrokSignIn } from './grokSignIn'
import { connectCopilotFromClick } from './copilotClient'
import { parseOpenRouterKeyUsageBody } from './openRouter'
import {
  createModelsPanelSeam,
  setUiText,
  providersFile,
  recordPlanUsage,
  huggingface,
  OPENROUTER_ORIGIN,
  metaCapabilityRecord,
} from '../backend/providersEntry'
import { ChatGptSignInError } from '../backend/subscriptionsEntry'
import {
  createSubscriptionClient,
  chatGptModels,
  chatGptAccountId,
  chatGptPlanAccount,
  grokModels,
  grokAccountId,
  grokPlanAccount,
  setUiText as setSubscriptionUiText,
} from '../backend/subscriptionCommandsEntry'
import type { CoreLogger } from '../../core/logging'
import type { SecretStore } from '../auth/credentialStore'
import type { UiTable } from '../l10n'
import {
  PROVIDER_SECRET_PREFIX,
  type PromptCacheTtl,
  SECRET_KEYS,
  UI_TEXT,
} from '../../shared/constants'
import {
  planUsageReportSchema,
  providerUsageRowSchema,
  type ProviderUsageRow,
} from '../../shared/usage'
import { fill, setUiText as setHostUiText } from '../../shared/l10n/text'
import { manageProviderHeaders } from './providerHeaders'

/** The subscription sign-ins' API origins, beside their panel entries. */
const SUBSCRIPTION_ADDRESS = {
  chatgpt: 'https://api.openai.com',
  grok: 'https://api.x.ai',
  copilot: 'https://github.com/copilot',
} as const

export function createSubscriptionFeatures(options: {
  readonly log: CoreLogger
  readonly secrets: SecretStore
  readonly globalStorageUri: vscode.Uri
  readonly catalogFile?: string
  readonly configFile: string
  /** Lane RETRYLIMITS: the person's retry limit, read live per transport. */
  readonly personCap?: () => number | undefined
  /** RLPROVSYNC: the person's cache-lifetime choice, read live per request. */
  readonly promptCacheTtl?: () => PromptCacheTtl
  /** M95c part 3: the person's explicit cache breakpoints choice, read live per request. */
  readonly promptCacheBreakpoints?: () => boolean
  readonly l10n: UiTable
  readonly globalState: {
    get(key: string): unknown
    update(key: string, value: unknown): Thenable<void>
  }
  readonly isRemote: boolean
  /** This app's own xAI client id setting, read fresh for every sign-in. */
  readonly grokClientId: () => string
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
  // The Grok sign-in is rebuilt when the client id setting changes, so a
  // sign-in that refused as unconfigured succeeds after the person sets it.
  let grokSignIn: { clientId: string; core: ReturnType<typeof createGrokSignIn> } | undefined
  const grok = (): ReturnType<typeof createGrokSignIn> => {
    const clientId = options.grokClientId()
    const cached = grokSignIn
    if (cached?.clientId === clientId) return cached.core
    const core = createGrokSignIn({
      secrets: options.secrets,
      isRemote: options.isRemote,
      clientId,
      scopes: undefined,
      fetch: fetcher,
      openExternal: async (url) => await vscode.env.openExternal(vscode.Uri.parse(url)),
      log: (message) => {
        options.log.info(message)
      },
    })
    grokSignIn = { clientId, core }
    return core
  }
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
      ...(options.promptCacheTtl !== undefined && { promptCacheTtl: options.promptCacheTtl }),
      ...(options.promptCacheBreakpoints !== undefined && {
        promptCacheBreakpoints: options.promptCacheBreakpoints,
      }),
      hasMetaKey: async () => Boolean(await options.secrets.get(SECRET_KEYS.modelApiKey)),
      loadUsage: () =>
        tallies.filter((row) => !['chatgpt', 'copilot', 'grok'].includes(row.providerId)),
      saveUsage: (rows) => {
        persist([
          ...tallies.filter((row) => ['chatgpt', 'copilot', 'grok'].includes(row.providerId)),
          ...rows,
        ])
      },
    })
  }
  const seam = createModelsPanelSeam({
    configFile: options.configFile,
    subscriptionModels: async (id) => {
      if (id === 'chatgpt') return await chatGptModels(await chatgpt(), fetcher)
      if (id === 'grok') return await grokModels(grok(), fetcher)
      const ids: string[] = []
      if (!options.isConfidential())
        copilot.forEach((_client, key) => {
          ids.push(key)
        })
      return ids
    },
  })
  const teamDiscovery = async () => {
    const provider = await configured()
    return await provider.teamDiscovery()
  }
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
    // M95c part 6: the header manager loads here, with the seam, never with the panel.
    manageHeaders: manageProviderHeaders,
    catalog: {
      ...seam.catalog,
      get: (id: string) => {
        const preset = seam.catalog.get(id)
        return preset?.id === 'openrouter' || preset?.id === 'huggingface'
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
    huggingfaceExchanger: {
      exchange: async (request: {
        readonly code: string
        readonly verifier: string
        readonly redirectUri: string
        readonly signal?: AbortSignal
      }) => {
        const clientId = huggingface.HF_OAUTH_CLIENT_ID
        if (clientId === undefined) throw new Error(UI_TEXT.huggingfaceOAuthNotRegistered)
        const services = await configured()
        return await services.huggingfaceExchange(
          clientId,
          request.code,
          request.verifier,
          request.redirectUri,
          request.signal,
        )
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
        const parsed = providersFile.providerEntrySchema.parse(provider)
        const result = await services.test(parsed, key)
        // OpenRouter's key check already fetched the credit balance: parse
        // it here (host side) so Account & usage shows it after Test.
        if (result.kind === 'ok' && parsed.preset === 'openrouter' && 'keyBody' in result) {
          const keyUsage = parseOpenRouterKeyUsageBody(result.keyBody)
          if (keyUsage !== undefined) return { ...result, keyUsage }
        }
        return result
      },
    },
  }
  const accountId = async () => {
    if (copilot.size > 0 && !options.isConfidential()) return 'copilot-host-grant'
    const stored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}chatgpt`)
    const grokStored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}grok`)
    const services = await configured()
    return chatGptAccountId(stored) ?? grokAccountId(grokStored) ?? (await services.accountId())
  }
  const save = async (id: 'chatgpt' | 'copilot' | 'grok', models: readonly string[]) => {
    if (models.length === 0) throw new Error(UI_TEXT.actionFailed)
    await seam.store.restore({
      id,
      preset: id,
      auth: 'subscription',
      models,
      address: SUBSCRIPTION_ADDRESS[id],
      format: id === 'copilot' ? 'chat' : 'responses',
    })
    const ref = `${id}/${models[0] ?? ''}`
    await seam.store.setDefaultModel(ref)
    await options.connected(ref)
  }
  return {
    teamDiscovery,
    teamMetaRecord: metaCapabilityRecord,
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
      const grokStored = await options.secrets.get(`${PROVIDER_SECRET_PREFIX}grok`)
      return chatGptPlanAccount(stored) ?? grokPlanAccount(grokStored)
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
            grok: () => Promise.resolve(grok()),
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
      const services = await configured(subscribed)
      return entries.length > 0 && entries.every((row) => row.auth === 'subscription')
        ? {
            ...subscribed,
            ...(services.client.models !== undefined && { models: services.client.models }),
          }
        : services.client
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
    /**
    Connect Grok through the browser. A stored grant is reused and only
    the models are saved again; without the client id setting the
    sign-in refuses before any request goes out.
    */
    connectGrok: async () => {
      const core = grok()
      const isNew = (await options.secrets.get(`${PROVIDER_SECRET_PREFIX}grok`)) === undefined
      if (isNew) await core.signIn()
      try {
        await save('grok', await grokModels(core, fetcher))
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
        switch (id) {
          case 'chatgpt': {
            const core = await chatgpt()
            await core.remove()
            break
          }
          case 'grok': {
            const core = grok()
            await core.remove()
            break
          }
          case 'copilot': {
            copilot.clear()
            break
          }
          default: {
            throw new Error(UI_TEXT.actionFailed)
          }
        }
      } finally {
        await seam.store.remove(id)
        await options.disconnected()
      }
    },
  }
}
