import { MODEL_API_MAX_RETRIES, UI_TEXT } from '../../shared/constants'
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
export {
  RequestTransport,
  ModelApiError,
  isModelApiError,
  rateLimitHeaders,
  parseJsonResponse,
  redactModelApiError,
  ignoreClosingError,
  redactSecrets,
} from '../../core/backends/modelapi/transport'
export { parseSse, boundedChunks, streamLimitError } from '../../core/backends/modelapi/sse'
export { parseNdjson } from '../../core/backends/modelapi/ndjson'
export { streamEventSchema, usageSchema } from '../../core/backends/modelapi/schemas'
export { pinnedHttpsRequest, pinnedPostRequest } from '../web/pinnedRequest'
import type { ExtensionHookDefinition } from '../../core/backends/modelapi/extensionHooks'
import type { HookDefinition, HookLoadDeps } from '../../core/backends/modelapi/hooks'
import {
  metaModelFacts,
  metaSideCallFormats,
  metaHostedCapabilities,
} from '../../core/backends/modelapi/modelCapabilities'

import { sparkHooksFiles } from '../../core/backends/modelapi/hookNames'

import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import type { StoredMediaPart } from '../../core/media/replayMedia'

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
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
    if (deps.createProviders === undefined) throw new Error(UI_TEXT.modelsPanelUnavailable)
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
  // Production media loads behind the existing lazy boundary, never with
  // the entry: the Model API bundle stays under its cap without it.
  const productionMedia =
    mediaDirectory !== undefined && filesClient !== undefined && mediaAccountId !== undefined
      ? await import('../../core/media/productionMedia.js')
      : undefined
  // The transcription adapters ride the same lazy boundary: they bind only
  // when the caller supplies the lane-V seams (attach-port tokens, the
  // host-owned transcription POST, converter presence and the paid consent
  // and reserve), so the product carries no dormant port.
  const seams = deps.audioPreparation
  const audioModule =
    seams === undefined ? undefined : await import('../../core/voice/audioMessagePreparation.js')
  const transcriptionModule =
    seams === undefined ? undefined : await import('../../core/voice/transcribeBatchHttp.js')
  const host = new ModelApiHost({
    ...hostDeps,
    ...(productionMedia !== undefined &&
      filesClient !== undefined &&
      mediaAccountId !== undefined &&
      mediaDirectory !== undefined && {
        createMediaReplay: (sessionId: string) =>
          productionMedia.createProductionMediaReplay({
            sessionId,
            client: filesClient,
            accountId: mediaAccountId,
            currentAccountId: hostDeps.getAccountId,
            directory: mediaDirectory,
            log: hostDeps.log,
            // Interactive media tokens arrive with the attach port's bind
            // (E1); scheduled reads adopt through read_file instead, so no
            // TurnPart resolves here yet.
            attachment: () => {
              const resolved: StoredMediaPart | undefined = undefined
              return resolved
            },
            source: productionMedia.workspaceMediaSource({
              workspaceRoot: hostDeps.workspaceRoot,
              platform: hostDeps.platform,
              io: hostDeps.io,
            }),
            authorize: (_media, model, gate, signal) => {
              signal.throwIfAborted()
              if (!gate.ok) throw new Error(gate.reason)
              // A scheduled upload follows its approved read; the read's own
              // approval is the authorization. Interactive contributor
              // consent binds at the attach port (D85.7), before any upload.
              if (model.provider !== 'meta') throw new Error('Media upload provider mismatch')
              return Promise.resolve()
            },
          }),
      }),
    ...(audioModule !== undefined &&
      transcriptionModule !== undefined &&
      seams !== undefined && {
        prepareAudioMessage: audioModule.createPrepareAudioMessage({
          contextFor: (modelId) =>
            transcriptionModule.createModelApiAudioContext({
              modelId,
              canExtractWav: seams.canExtractWav,
              isVoiceOn: hostDeps.isPaidFeatureOn('voice'),
            }),
          ...transcriptionModule.createTranscriptionPorts({
            postTranscription: seams.postTranscription,
            readAudioBytes: seams.readAudioBytes,
            resolveSourcePath: seams.resolveSourcePath,
            ...(seams.conversionOptions !== undefined && {
              conversionOptions: seams.conversionOptions,
            }),
            ...(seams.locateConverter !== undefined && { locateConverter: seams.locateConverter }),
          }),
          gate: { isOn: (feature) => hostDeps.isPaidFeatureOn(feature) },
          usage: seams.usage ?? {
            addVoiceBatch: (seconds: number) => {
              hostDeps.notePaidUse('voice', seconds)
            },
          },
          resolveSource: seams.resolveSource,
          assertCurrent:
            seams.assertCurrent ??
            (() => {
              // The host re-checks its model revision around the prepare
              // call; without lane V there is no owner context to assert.
            }),
          consent: seams.consent,
          reserve: seams.reserve,
        }),
      }),
    modelFacts: hostDeps.modelFacts ?? metaModelFacts,
    sideCallFormats: hostDeps.sideCallFormats ?? metaSideCallFormats,
    modelCapabilities: hostDeps.modelCapabilities ?? metaHostedCapabilities,
    client,
    ...('models' in client && { models: client.models }),
    ...(deps.createProviders !== undefined && {
      models: {
        resolve: async (ref: string) => {
          const registry = await resolveProviders()
          return await registry.resolve(ref)
        },
        list: async () => {
          const { list } = await resolveProviders()
          if (list === undefined) throw new Error(UI_TEXT.modelsPanelUnavailable)
          return await list()
        },
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
