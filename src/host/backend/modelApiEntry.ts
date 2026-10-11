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
import type { MediaReplaySession } from '../../core/media/replayMedia'

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'
import type { ModelApiHostDeps } from '../../core/backends/modelapi/ModelApiHost'

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
  const host = new ModelApiHost({
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
          return await audio.productionAudioFor(deps, hostDeps, client, mediaAccountId)?.(request)
        },
      }),
    ...(productionMedia !== undefined &&
      filesClient !== undefined &&
      mediaAccountId !== undefined &&
      mediaDirectory !== undefined && {
        createMediaReplay: (sessionId: string, session: MediaReplaySession) =>
          productionMedia.createProductionMediaReplay({
            sessionId,
            client: filesClient,
            accountId: mediaAccountId,
            currentAccountId: hostDeps.getAccountId,
            directory: mediaDirectory,
            log: hostDeps.log,
            ...(hostDeps.uploadExpiryDays !== undefined && {
              expiryDays: hostDeps.uploadExpiryDays,
            }),
            ...session,
            source: productionMedia.attachedOrWorkspaceSource(
              attached,
              productionMedia.workspaceMediaSource({
                workspaceRoot: hostDeps.workspaceRoot,
                platform: hostDeps.platform,
                io: hostDeps.io,
              }),
            ),
            ...(attached !== undefined && { attachment: (part) => attached.resolve(part) }),
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
