// The Model API backend's bundle (M57, PLAN.md D6): esbuild builds this file
// into dist/modelApi.js, which `ModelApiBackendManager` requires the first
// time that backend starts, so the host, its tools, hooks and MCP client stay
// out of the bundle VS Code loads at activation. The bundle carries its own
// copy of every module it shares with dist/extension.js, the display
// language's state among them, so the factory installs the activation
// bundle's table before it builds anything. The English fallback remains
// available when this backend is loaded outside the extension.

import { ModelApiClient } from '../../core/backends/modelapi/client'
import { loadSparkHookDefinitions } from '../../core/backends/modelapi/extensionHooks'
import { loadHookDefinitions } from '../../core/backends/modelapi/hooks'
import { McpServerPool } from '../../core/backends/modelapi/mcp/pool'
import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import { setUiText } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'

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
      return sources === undefined ? [] : await loadHookDefinitions(sources)
    },
    // spark-hooks.json loads beside Muse Code's sources, under the same
    // trust gate and opt-in, into the same per-session snapshot (M91 lane E).
    loadExtensionHooks: async () => {
      const sources = sourcesFor()
      if (sources === undefined) return []
      const definitions = await loadSparkHookDefinitions(sources)
      // FileChanged belongs to the window runner, once for every backend.
      return definitions.filter((hook) => hook.event !== 'FileChanged')
    },
  })
  await host.load()
  return host
}
