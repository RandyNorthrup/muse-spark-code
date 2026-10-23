import { SpendLedgerError } from '../../core/paid/spendLedgerError'
import {
  IS_AUTO_COMPACTION_EVALUATED,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_LEGACY_CONTEXT_MODELS,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../shared/constants'
import type { ContextModel } from '../../core/context/overflow'
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
  readBoundedText,
  redactModelApiError,
  rethrowStreamError,
  redactStreamDiagnostics,
  retryAfterMs,
  providerWaitMs,
  ignoreClosingError,
  // Lane RETRYLIMITS: read by dist/configuredProviders.js
  // (UNBOUNDED_RETRIES) and dist/reviewer.js and dist/tab.js
  // (noRetryBudget), so the names exist here or they are `undefined` in the
  // built product (HOTFIX0181).
  UNBOUNDED_RETRIES,
  noRetryBudget,
  // Lane PR225FIX2: read by dist/configuredProviders.js, dist/extension.js
  // and dist/acp.js (the production retry-wait sleep), same rule.
  abortableSleep,
  redactSecrets,
  assertConfirmedAllowed,
  isStaleConfirmedError,
  noteConfirmedRequestStarted,
  canRetryWithinBudget,
  whenAborted,
  // Lane RLACP: read by dist/runtimeEngine.js (the ACP agent's failure
  // log), same rule.
  isMissingApiKeyError,
} from '../../core/backends/modelapi/transport'
import { noRetryBudget } from '../../core/backends/modelapi/transport'
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

import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import type { MediaReplaySession } from '../../core/media/replayMedia'
import { resolveAutoCompactModel } from '../../core/backends/modelapi/autoCompactionAdmission'
import { requestImageCount } from '../../core/backends/modelapi/modelPolicy'
import { Usd } from '../../shared/usd'
import { failureForLog } from '../../core/backends/musecode/logText'

import type { UiText } from '../../shared/l10n/en'
import { setUiText, uiLocale } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'
import type { ModelApiHostDeps } from '../../core/backends/modelapi/ModelApiHost'

/**
Whether a spark-hooks.json exists, user's or project's, in a trusted
workspace: only then do its readers' bundles load (M91, D6). Hooks are on
by default (D78), so a session without the file never loads them. One byte
at most is read; the readers confine and check the file themselves.
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
Hooks imported in another agent's format, read by the adapters' own bundle
(dist/foreignHooks.js, M91 lane W) when a spark-hooks.json exists. A bundle
that cannot load leaves them out and says so in the log, as an unreadable
file does.
*/
async function loadForeignHooks(sources: HookLoadDeps): Promise<readonly HookDefinition[]> {
  if (!(await hasSparkHooksFile(sources))) return []
  let entry
  try {
    entry = await import('../../core/backends/modelapi/foreignHooksEntry.js')
  } catch (error: unknown) {
    sources.warn(
      `the imported hooks bundle could not be loaded; imported hooks are off (${failureForLog(error)})`,
    )
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
  } catch (error: unknown) {
    sources.warn(
      `the hook runtime bundle could not be loaded; spark-hooks.json is off (${failureForLog(error)})`,
    )
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
      isTrusted: config.autoCompactionTrusted ?? host.isWorkspaceTrusted,
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
  const { hookSettingsPath } = deps
  // One audio path (RVMEDIAW2 2): the bundle binds it itself, so a caller's
  // callback, typed away or not, is dropped here and never runs.
  const { prepareAudioMessage: strayAudioPort, ...hostDeps } = deps.host as typeof deps.host &
    Pick<ModelApiHostDeps, 'prepareAudioMessage'>
  if (strayAudioPort !== undefined)
    hostDeps.log.warn('A caller-supplied audio preparation port was ignored')
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
  // The host's own usage kind (worker for team workers) travels with the
  // request accounting, threaded here rather than through the always-loaded
  // backend manager so headless-only bytes stay out of the activation bundle.
  const client = (await deps.createProviderClient?.(meta, hostDeps.usageKind)) ?? meta
  // C-M95-4 R3: the configured registry owns every M95 model's live
  // window (scanned locals carry their server's report in `modelLimits`).
  // The host sizes compaction from `contextModel`, so feed it from the
  // registry's synchronous peek; an explicitly supplied one still wins,
  // and an unlisted model keeps the previous fallback.
  const peekContextModel = 'peekContextModel' in client ? client.peekContextModel : undefined
  // The legacy Meta window the host applied before the registry seam;
  // installing the seam must never unlist it (the host's own legacy
  // branch only fires while `contextModel` is absent entirely).
  const legacyContextModel = (modelId: string): ContextModel | undefined =>
    MODEL_API_LEGACY_CONTEXT_MODELS.includes(modelId)
      ? { format: 'responses', contextTokens: MODEL_API_CONTEXT_WINDOW }
      : undefined
  const mcp =
    deps.createMcpServers === undefined
      ? undefined
      : await import('../../core/backends/modelapi/modelApiMcpEntry.js')
  mcp?.setUiText(deps.uiText, deps.uiLocale)
  // Production media (MONEY017D, D85.2/D85.6): the session replay through
  // the real upload storage and calibration. Every production host lands
  // here (VS Code, the CLI/ACP runtime), so one wiring covers them all. The
  // port stays absent while no storage directory is supplied (eval, tests),
  // keeping the established refusal.
  // The Files upload rides the Meta client; a subscription-wrapped provider
  // client without it keeps the established refusal.
  const requestFile =
    'requestFile' in client && typeof client.requestFile === 'function'
      ? client.requestFile.bind(client)
      : undefined
  const filesClient = requestFile === undefined ? undefined : { requestFile }
  const mediaDirectory = hostDeps.uploadLedgerDir
  const mediaAccountId = mediaDirectory === undefined ? undefined : await hostDeps.getAccountId()
  // One production media service per session, built by one factory in its
  // own deferred bundle (dist/productionMedia.js, D85.13): the Model API
  // bundle never carries it, nor transcription or conversion.
  const productionMedia =
    mediaDirectory !== undefined && filesClient !== undefined && mediaAccountId !== undefined
      ? await import('./productionMediaEntry.js')
      : undefined
  productionMedia?.setUiText(deps.uiText, deps.uiLocale)
  // Attached video and audio (lane V seam 1): the host's registry resolves a
  // `media` part to its record and its reverifying source; a tool-read file
  // reopens through the workspace as before.
  const attached = hostDeps.attachedMedia
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
  // The assist bundle's installed language (dist/modelApiAcp.js, PLAN.md D6):
  // the bundle keeps its own language state, so the entry installs the
  // caller's table when the backend starts.
  const assist = await import('../../core/backends/modelapi/modelApiAcpEntry.js')
  assist.installLanguage(deps.uiText, deps.uiLocale)
  const host: ModelApiHost = new ModelApiHost({
    ...hostDeps,
    // The one audio path (lane V seam 3B): a turn with attached sound loads
    // dist/productionAudio.js and transcribes over the Meta client's narrow
    // POST, under the hosts' paid consent and ledgers; any other turn
    // loads nothing and is byte-identical.
    ...(productionMedia !== undefined &&
      attached !== undefined &&
      mediaAccountId !== undefined && {
        prepareAudioMessage: async (request) => {
          if (request.parts.every((part) => part.type !== 'media')) return
          const audio = await import('./productionAudioEntry.js')
          // The owner's running total for the batch cost (D208): read at
          // request time, once the host below exists. A lookup failure
          // carries its true reason; the audio entry fails closed under a
          // cap for callers with no scope.
          const scope = await host.getOwnedBudgetScope(request.sessionId)
          return await audio.productionAudioFor(
            deps,
            hostDeps,
            client,
            mediaAccountId,
            scope,
          )?.(request)
        },
      }),
    ...(productionMedia !== undefined &&
      filesClient !== undefined &&
      mediaAccountId !== undefined &&
      mediaDirectory !== undefined && {
        // The replay assembly (and its expiry forwarding) resolves on
        // demand inside the production-media bundle (C-M105-8 diet).
        createMediaReplay: (sessionId: string, session: MediaReplaySession) =>
          productionMedia.createHostMediaReplay(
            hostDeps,
            filesClient,
            mediaAccountId,
            mediaDirectory,
            attached,
            sessionId,
            session,
          ),
      }),
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
    ...(deps.createAccountRequests !== undefined && {
      accountRequests: await deps.createAccountRequests(client),
    }),
    autoCompactModel: hostDeps.autoCompactModel ?? resolveAutoCompactModel,
    admitAutoCompaction: hostDeps.admitAutoCompaction ?? autoCompactionAdmission(deps),
    modelFacts: hostDeps.modelFacts ?? metaModelFacts,
    sideCallFormats: hostDeps.sideCallFormats ?? metaSideCallFormats,
    modelCapabilities: hostDeps.modelCapabilities ?? metaHostedCapabilities,
    argumentPreviewCapabilities:
      hostDeps.argumentPreviewCapabilities ?? metaArgumentPreviewCapabilities,
    modelOutputMaxTokens: hostDeps.modelOutputMaxTokens ?? metaOutputMaxTokens,
    client,
    ...(peekContextModel !== undefined &&
      hostDeps.contextModel === undefined && {
        contextModel: (modelId: string) => peekContextModel(modelId) ?? legacyContextModel(modelId),
      }),
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
              const planFacts =
                'planModelFacts' in client ? await client.planModelFacts(ref) : undefined
              return metaResolvedModel(ref, client, planFacts)
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
  yield* new ModelApiClient(deps).streamResponse(body, signal, undefined, noRetryBudget(), guard)
}
export { setUiText } from '../../shared/l10n/text'
