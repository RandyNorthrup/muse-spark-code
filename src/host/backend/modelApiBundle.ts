import type { CreateResponseBody, StreamEvent } from '../../core/backends/modelapi/schemas'
import type { ResponseAttemptGuard } from '../../core/backends/modelapi/client'
// The Model API backend's bundle as the activation bundle sees it (M57,
// PLAN.md D6): `dist/modelApi.js`, built from `modelApiEntry.ts` and loaded
// by `ModelApiBackendManager` the first time that backend starts. Only types
// come from src/core/backends/modelapi/** here: a value imported from there
// would carry the backend back into dist/extension.js, which the
// bundle-split gate (scripts/check-bundle-split.mjs) refuses.

import type { ModelApiClientDeps } from '../../core/backends/modelapi/client'
import type { McpPoolDeps, McpToolSource } from '../../core/backends/modelapi/mcp/pool'
import type { ModelApiHost, ModelApiHostDeps } from '../../core/backends/modelapi/ModelApiHost'
import type { UiText } from '../../shared/l10n/en'

/** The bundle's MCP server pool (M50), built from the activation bundle's spawner and settings. */
export type McpPoolFactory = (deps: McpPoolDeps) => McpToolSource

/**
 * What the bundle builds a host from: values and functions of the activation
 * bundle, and nothing compared by identity across the two (M57's audit).
 */
export interface ModelApiBundleDeps {
  /**
   * The installed table and its language (PLAN.md D33). The bundle's own
   * `UI_TEXT` starts English; the factory installs these before it builds.
   */
  readonly uiText: UiText
  readonly uiLocale: string
  readonly client: ModelApiClientDeps
  /** The host's, but for what the bundle makes itself: the client, the hooks and the MCP pool. */
  readonly host: Omit<ModelApiHostDeps, 'client' | 'loadHooks' | 'mcpServers'>
  /** Muse Code's settings file, read for hooks while `host.isHooksEnabled` says so (M51). */
  readonly hookSettingsPath: string | undefined
  /** The MCP servers for the host (M50), made with the bundle's pool; undefined runs none. */
  readonly createMcpServers:
    ((newPool: McpPoolFactory) => McpToolSource | Promise<McpToolSource>) | undefined
}

/** The bundle's one export. */
export interface ModelApiBundle {
  readonly streamLegalExplanation?: (
    deps: ModelApiClientDeps,
    body: CreateResponseBody,
    signal: AbortSignal,
    guard: ResponseAttemptGuard,
    table: UiText,
    locale: string,
  ) => AsyncIterable<StreamEvent>

  /** Installs the table, builds the client and the host, and reads the stored sessions. */
  readonly createModelApiHost: (deps: ModelApiBundleDeps) => Promise<ModelApiHost>
}

/**
 * Whether a required module is the bundle: its factory is a function. The
 * factory's signature is taken on trust (PLAN.md §8): both bundles are built
 * from one source tree by one `npm run build` and ship in one package.
 */
export function isModelApiBundle(value: unknown): value is ModelApiBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createModelApiHost' in value &&
    typeof value.createModelApiHost === 'function'
  )
}
