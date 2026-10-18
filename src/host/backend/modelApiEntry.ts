import { SpendLedgerError } from '../../core/paid/spendLedgerError'
import {
  IS_AUTO_COMPACTION_EVALUATED,
  MODEL_API_MAX_RETRIES,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../shared/constants'
import type { CreateResponseBody, StreamEvent } from '../../core/backends/modelapi/schemas'
import {
  type ResponseAttemptGuard,
  ModelApiClient,
  type ModelApiClientDeps,
} from '../../core/backends/modelapi/client'
// The Model API backend's bundle (M57, PLAN.md D6): esbuild builds this file
// into dist/modelApi.js, which `ModelApiBackendManager` requires the first
// time that backend starts, so the host, its tools, hooks and MCP client stay
// out of the bundle VS Code loads at activation. The bundle carries its own
// copy of every module it shares with dist/extension.js, the display
// language's state among them, so the factory installs the activation
// bundle's table before it builds anything. The English fallback remains
// available when this backend is loaded outside the extension.

// T's one request loop and framing API are shared by the lazy provider adapters.
// The build points every other bundle's import of transport.ts, sse.ts and
// ndjson.ts at this bundle (deferredCohort), so a name those bundles import
// exists at run time only if it is exported here: TypeScript checks the import
// against the source module and cannot see the difference. 0.18.0 shipped
// without the three confirmed-dispatch names, and every turn on a configured
// provider, a plan or Copilot failed before sending (HOTFIX0181). The split
// gate now reads the built bundles and fails on a member this list lacks.
export {
  RequestTransport,
  ModelApiError,
  isModelApiError,
  rateLimitHeaders,
  parseJsonResponse,
  redactModelApiError,
  rethrowStreamError,
  ignoreClosingError,
  redactSecrets,
  assertConfirmedAllowed,
  isStaleConfirmedError,
  noteConfirmedRequestStarted,
} from '../../core/backends/modelapi/transport'
export { parseSse, boundedChunks, streamLimitError } from '../../core/backends/modelapi/sse'
export { parseNdjson } from '../../core/backends/modelapi/ndjson'
// Lane PROVERR: the typed refusal other bundles require from this bundle
// (deferredCohort), so a name they import exists here or it is `undefined`
// in the built product (HOTFIX0181).
export {
  boundProviderMessage,
  firstBodyLine,
  isDefiniteRefusal,
  isRefusalRetryable,
  isRetryableStreamFailure,
  parseRefusalError,
  refusalOf,
  refusalSentence,
  scrubRefusalLeak,
} from '../../core/backends/modelapi/providerRefusal'
export { streamEventSchema, usageSchema } from '../../core/backends/modelapi/schemas'
export { pinnedHttpsRequest, pinnedPostRequest } from '../web/pinnedRequest'
import type { ExtensionHookDefinition } from '../../core/backends/modelapi/extensionHooks'
import type { HookDefinition, HookLoadDeps } from '../../core/backends/modelapi/hooks'
import { metaResolvedModel } from '../../core/backends/modelapi/modelPolicy'
import {
  metaModelFacts,
  metaSideCallFormats,
  metaHostedCapabilities,
  metaArgumentPreviewCapabilities,
  metaOutputMaxTokens,
} from '../../core/backends/modelapi/modelCapabilities'

import { sparkHooksFiles } from '../../core/backends/modelapi/hookNames'

import { ModelApiHost, type ModelApiHostDeps } from '../../core/backends/modelapi/ModelApiHost'
import { resolveAutoCompactModel } from '../../core/backends/modelapi/autoCompactionAdmission'
import { requestImageCount } from '../../core/backends/modelapi/modelPolicy'
import { Usd } from '../../shared/usd'

import type { UiText } from '../../shared/l10n/en'
import { setUiText, uiLocale } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'

/**
 * Whether a spark-hooks.json exists, user's or project's, in a trusted
 * workspace: only then do its readers' bundles load (M91, D6). Hooks are on
 * by default (D78), so a session without the file never loads them. One byte
 * at most is read; the readers confine and check the file themselves.
 */
async function hasSparkHooksFile(sources: HookLoadDeps): Promise<boolean> {
  if (!sources.isWorkspaceTrusted()) return false
  const { user, project } = sparkHooksFiles(sources)
  for (const file of [user, project]) {
    if ((await sources.io.readFile(file, 0)) !== undefined) return true
  }
  return false
}

/**
 * Hooks imported in another agent's format, read by the adapters' own bundle
 * (dist/foreignHooks.js, M91 lane W) when a spark-hooks.json exists. A bundle
 * that cannot load leaves them out and says so in the log, as an unreadable
 * file does.
 */
async function loadForeignHooks(sources: HookLoadDeps): Promise<readonly HookDefinition[]> {
  if (!(await hasSparkHooksFile(sources))) return []
  let entry
  try {
    entry = await import('../../core/backends/modelapi/foreignHooksEntry.js')
  } catch {
    sources.warn('the imported hooks bundle could not be loaded; imported hooks are off')
    return []
  }
  return await entry.loadForeignHookDefinitions(sources)
}

/** spark-hooks.json's extension-event hooks, read by the hook runtime (M91). */
async function loadSparkHooks(sources: HookLoadDeps): Promise<readonly ExtensionHookDefinition[]> {
  if (!(await hasSparkHooksFile(sources))) return []
  let entry
  try {
    entry = await import('../../core/backends/modelapi/hookRuntimeEntry.js')
  } catch {
    sources.warn('the hook runtime bundle could not be loaded; spark-hooks.json is off')
    return []
  }
  return await entry.loadSparkHookDefinitions(sources)
}

/** The same admission authority, constructed behind the backend's existing boundary. */
function autoCompactionAdmission(
  deps: ModelApiBundleDeps,
): ModelApiHostDeps['admitAutoCompaction'] {
  const config = deps.autoCompaction
  if (
    config?.reserveAutoCompaction === undefined &&
    config?.autoCompactionAccounting !== 'transport'
  )
    return
  const host = deps.host
  return async (request) => {
    const runtime = await import('../../core/backends/modelapi/foreignHooksEntry')
    runtime.setUiText(UI_TEXT, uiLocale())
    return await runtime.createAutoCompactionAdmission({
      loadPricing: async () => {
        const { priceCard } = await import('./providersEntry')
        return { reserveRequestAmount: priceCard.reserveRequestAmount, requestImageCount }
      },
      accounting:
        config.autoCompactionAccounting === 'transport'
          ? 'transport'
          : {
              reserveCompaction: async (amount, signal) => {
                if (config.reserveAutoCompaction === undefined)
                  throw new SpendLedgerError('integrity', {
                    scope: 'session',
                    file: 'modelApiEntry',
                  })
                return await config.reserveAutoCompaction(amount, signal)
              },
            },
      allowsPaidUse: host.allowsPaidUse,
      isOn: () => host.isPaidFeatureOn('autoCompaction') && host.autoCompaction?.() !== false,
      isTrusted: host.isWorkspaceTrusted,
      isEvaluated: () => host.autoCompactionEvaluated?.() ?? IS_AUTO_COMPACTION_EVALUATED,
      paidUseFence: (sessionId) =>
        config.paidUseFence?.('autoCompaction', sessionId) ?? (() => false),
      dailyBudgetUsd:
        config.paidDailyBudgetUsd ??
        (() => Usd.from(SETTING_DEFAULTS.paidDailyBudgetUsd).toAmount()),
      notePaidUse: host.notePaidUse,
      log: host.log,
    })(request)
  }
}

/** The host over the given dependencies, its stored sessions read. */
export async function createModelApiHost(deps: ModelApiBundleDeps): Promise<ModelApiHost> {
  setUiText(deps.uiText, deps.uiLocale)
  const { host: hostDeps, hookSettingsPath } = deps
  const sourcesFor = () =>
    hookSettingsPath === undefined || hostDeps.isHooksEnabled?.() !== true
      ? undefined
      : {
          io: hostDeps.contextIo,
          platform: hostDeps.platform,
          settingsPath: hookSettingsPath,
          workspaceRoot: hostDeps.workspaceRoot,
          isWorkspaceTrusted: hostDeps.isWorkspaceTrusted,
          warn: (message: string) => {
            hostDeps.log.warn(`Hooks: ${message}`)
          },
        }
  let providers: ReturnType<NonNullable<typeof deps.createProviders>> | undefined
  const resolveProviders = async () => {
    if (deps.createProviders === undefined) throw new Error(UI_TEXT.modelApiProvidersMissing)
    providers ??= deps.createProviders()
    try {
      return await providers
    } catch (error: unknown) {
      providers = undefined
      throw error
    }
  }
  const meta = new ModelApiClient(deps.client)
  const client = (await deps.createProviderClient?.(meta)) ?? meta
  const mcp =
    deps.createMcpServers === undefined
      ? undefined
      : await import('../../core/backends/modelapi/modelApiMcpEntry.js')
  mcp?.setUiText(deps.uiText, deps.uiLocale)
  // The host carries the exact resolved record through each request.
  // The session client's own resolver is authoritative in every production
  // path (RVCM1062B P1/P2): the runtime's accounting-wrapped headless client
  // keeps its daily reservation and run-ledger admission, and the
  // subscription-aware extension/ACP client keeps its plan routing and
  // shared usage ownership. A standalone registry is only the fallback for
  // a client without one; a plan ref it cannot name still resolves against
  // the session client, as it did before any registry was supplied. Bare
  // Meta models never reach the resolver (the host answers them from M95's
  // own policy), so they fall through to the shared Meta default.
  // The `in` narrowings (not truthiness reads) carry the optional
  // members off the ModelApiClient | ProviderClient union.
  const clientModels = 'models' in client ? client.models : undefined
  const isPlanModel = 'isPlanModel' in client ? client.isPlanModel : undefined
  const host = new ModelApiHost({
    ...hostDeps,
    autoCompactModel: hostDeps.autoCompactModel ?? resolveAutoCompactModel,
    admitAutoCompaction: hostDeps.admitAutoCompaction ?? autoCompactionAdmission(deps),
    modelFacts: hostDeps.modelFacts ?? metaModelFacts,
    sideCallFormats: hostDeps.sideCallFormats ?? metaSideCallFormats,
    modelCapabilities: hostDeps.modelCapabilities ?? metaHostedCapabilities,
    argumentPreviewCapabilities:
      hostDeps.argumentPreviewCapabilities ?? metaArgumentPreviewCapabilities,
    modelOutputMaxTokens: hostDeps.modelOutputMaxTokens ?? metaOutputMaxTokens,
    client,
    ...((clientModels !== undefined || deps.createProviders !== undefined) && {
      models: {
        resolve: async (ref: string) => {
          if (clientModels !== undefined) {
            return await clientModels.resolve(ref)
          }
          const registry = await resolveProviders()
          try {
            return await registry.resolve(ref)
          } catch (error: unknown) {
            if (isPlanModel?.(ref) === true) {
              return metaResolvedModel(ref, client)
            }
            throw error
          }
        },
        // A client without a list keeps the host's client-only catalogue:
        // always defining list would turn that absence into a failure.
        ...((clientModels?.list !== undefined || deps.createProviders !== undefined) && {
          list: async () => {
            if (clientModels?.list !== undefined) return await clientModels.list()
            const { list } = await resolveProviders()
            if (list === undefined) throw new Error(UI_TEXT.modelApiProvidersMissing)
            return await list()
          },
        }),
      },
    }),
    mcpServers:
      mcp === undefined
        ? undefined
        : await deps.createMcpServers?.((poolDeps) => new mcp.McpServerPool(poolDeps)),
    loadHooks: async () => {
      const sources = sourcesFor()
      // Hooks imported in another agent's format live in spark-hooks.json and
      // join the same per-session snapshot, after Muse Code's (M91 lane W).
      if (sources === undefined) return []
      const hooks = await import('../../core/backends/modelapi/modelApiHooksEntry.js')
      return [...(await hooks.loadHookDefinitions(sources)), ...(await loadForeignHooks(sources))]
    },
    // spark-hooks.json loads beside Muse Code's sources, under the same
    // trust gate and opt-in, into the same per-session snapshot (M91 lane E).
    loadExtensionHooks: async () => {
      const sources = sourcesFor()
      if (sources === undefined) return []
      const definitions = await loadSparkHooks(sources)
      // FileChanged belongs to the window runner, once for every backend.
      return definitions.filter((hook) => hook.event !== 'FileChanged')
    },
  })
  await host.load()
  return host
}

/** Stored-key operations share this bundle's client and installed language. */
export function createModelApiClient(
  deps: ModelApiClientDeps,
  table: UiText,
  locale: string,
): ModelApiClient {
  setUiText(table, locale)
  return new ModelApiClient(deps)
}

export async function* streamLegalExplanation(
  deps: ModelApiClientDeps,
  body: CreateResponseBody,
  signal: AbortSignal,
  guard: ResponseAttemptGuard,
  table: UiText,
  locale: string,
): AsyncGenerator<StreamEvent> {
  setUiText(table, locale)
  yield* new ModelApiClient(deps).streamResponse(
    body,
    signal,
    undefined,
    { retriesUsed: MODEL_API_MAX_RETRIES },
    guard,
  )
}
export { setUiText } from '../../shared/l10n/text'
