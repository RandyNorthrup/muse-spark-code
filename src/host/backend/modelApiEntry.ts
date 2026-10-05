import { MODEL_API_MAX_RETRIES } from '../../shared/constants'
import type { CreateResponseBody, StreamEvent } from '../../core/backends/modelapi/schemas'
import type { ModelApiClientDeps, ResponseAttemptGuard } from '../../core/backends/modelapi/client'
import type { UiText } from '../../shared/l10n/en'
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
import { setUiText } from '../../shared/l10n/text'
import type { ModelApiBundleDeps } from './modelApiBundle'

/** The host over the given dependencies, its stored sessions read. */
export async function createModelApiHost(deps: ModelApiBundleDeps): Promise<ModelApiHost> {
  setUiText(deps.uiText, deps.uiLocale)
  const { host: hostDeps, hookSettingsPath } = deps
  const host = new ModelApiHost({
    ...hostDeps,
    client: new ModelApiClient(deps.client),
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
