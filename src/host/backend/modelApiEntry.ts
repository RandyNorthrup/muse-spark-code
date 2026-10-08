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
  const host = new ModelApiHost({
    ...hostDeps,
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
