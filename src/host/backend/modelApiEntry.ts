// The Model API backend's bundle (M57, PLAN.md D6): esbuild builds this file
// into dist/modelApi.js, which `ModelApiBackendManager` requires the first
// time that backend starts, so the host, its tools, hooks and MCP client stay
// out of the bundle VS Code loads at activation. The bundle carries its own
// copy of every module it shares with dist/extension.js, the display
// language's state among them, so the factory installs the activation
// bundle's table before it builds anything. The English fallback remains
// available when this backend is loaded outside the extension.

import { ModelApiClient } from '../../core/backends/modelapi/client'
import { loadHookDefinitions } from '../../core/backends/modelapi/hooks'
import { McpServerPool } from '../../core/backends/modelapi/mcp/pool'
import { ModelApiHost } from '../../core/backends/modelapi/ModelApiHost'
import { UI_TEXT } from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'

/** The host over the given dependencies, its stored sessions read. */
export async function createModelApiHost(deps: ModelApiBundleDeps): Promise<ModelApiHost> {
  setUiText(deps.uiText, deps.uiLocale)
  const { host: hostDeps, hookSettingsPath } = deps
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
  const host = new ModelApiHost({
    ...hostDeps,
    client: new ModelApiClient(deps.client),
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
    mcpServers: await deps.createMcpServers?.((poolDeps) => new McpServerPool(poolDeps)),
    loadHooks: async () =>
      hookSettingsPath !== undefined && hostDeps.isHooksEnabled?.() === true
        ? await loadHookDefinitions({
            io: hostDeps.contextIo,
            platform: hostDeps.platform,
            settingsPath: hookSettingsPath,
            workspaceRoot: hostDeps.workspaceRoot,
            isWorkspaceTrusted: hostDeps.isWorkspaceTrusted,
            warn: (message) => {
              hostDeps.log.warn(`Hooks: ${message}`)
            },
          })
        : [],
  })
  await host.load()
  return host
}
