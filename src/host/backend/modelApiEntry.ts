// The Model API backend's bundle (M57, PLAN.md D6): esbuild builds this file
// into dist/modelApi.js, which `ModelApiBackendManager` requires the first
// time that backend starts, so the host, its tools, hooks and MCP client stay
// out of the bundle VS Code loads at activation. The bundle carries its own
// copy of every module it shares with dist/extension.js, the display
// language's state among them, so the factory installs the activation
// bundle's table before it builds anything. The English fallback remains
// available when this backend is loaded outside the extension.

import path from 'node:path'
import { ModelApiClient } from '../../core/backends/modelapi/client'
import type { ExtensionHookDefinition } from '../../core/backends/modelapi/extensionHooks'
import {
  type HookDefinition,
  type HookLoadDeps,
  loadHookDefinitions,
} from '../../core/backends/modelapi/hooks'
import { McpServerPool } from '../../core/backends/modelapi/mcp/pool'
import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import { SPARK_HOOKS_SEGMENTS } from '../../shared/constants'
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
  const files = [
    path.join(path.dirname(sources.settingsPath), SPARK_HOOKS_SEGMENTS.user[1]),
    path.join(sources.workspaceRoot, ...SPARK_HOOKS_SEGMENTS.project),
  ]
  for (const file of files) {
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
  const host = new ModelApiHost({
    ...hostDeps,
    client: new ModelApiClient(deps.client),
    mcpServers: await deps.createMcpServers?.((poolDeps) => new McpServerPool(poolDeps)),
    loadHooks: async () => {
      const sources = sourcesFor()
      // Hooks imported in another agent's format live in spark-hooks.json and
      // join the same per-session snapshot, after Muse Code's (M91 lane W).
      return sources === undefined
        ? []
        : [...(await loadHookDefinitions(sources)), ...(await loadForeignHooks(sources))]
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
