// The Model API backend's MCP servers as this window runs them (M50, PLAN.md
// D42): Muse Code's settings file read by M31's reader each time they start,
// stdio servers started by the real spawner (mcpProcess.ts), remote ones
// reached with the extension host's `fetch`, and `${VAR}` read from the
// extension host's environment. The pool itself is the Model API bundle's
// (M57, PLAN.md D6); this module gives it this window's parts.

import type { McpPoolDeps } from '../../core/backends/modelapi/mcp/pool'
import { environmentValue } from '../../core/backends/musecode/launch'
import { readMcpServerEntries } from '../../core/backends/musecode/museConfigView'
import { UI_TEXT } from '../../shared/constants'
import { readTextIfPresent } from '../cliFeatures'
import type { Logger } from '../logger'
import { isExistingDirectory, isExistingFile, mcpServerSpawner } from './mcpProcess'

export interface ModelApiMcpDeps {
  /** Awaited before a workspace-capable local stdio process can start. */
  readonly beforeWorkspaceProcessStart: () => Promise<void>
  readonly workspaceRoot: string
  /** Muse Code's settings file where `muse serve` would read it. */
  readonly settingsPath: () => string
  readonly isWorkspaceTrusted: () => boolean
  /** The extension's version, sent as the client's in `initialize`. */
  readonly clientVersion: string
  readonly platform: NodeJS.Platform
  /** Windows: the compiled M50 job executable; absent means stdio fails closed. */
  readonly jobExecutablePath?: string | undefined
  readonly env: () => NodeJS.ProcessEnv
  readonly fetch: typeof fetch
  readonly log: Logger
}

export function modelApiMcpPoolDeps(deps: ModelApiMcpDeps): McpPoolDeps {
  const spawn = mcpServerSpawner({
    platform: deps.platform,
    systemRoot: environmentValue(deps.env(), deps.platform, 'SystemRoot'),
    jobExecutablePath: deps.jobExecutablePath,
    env: deps.env,
    isExistingFile,
    isExistingDirectory,
    log: (message) => {
      deps.log.warn(message)
    },
  })
  return {
    readSettings: () => readMcpServerEntries(readTextIfPresent(deps.settingsPath())),
    lookupEnv: (name) => environmentValue(deps.env(), deps.platform, name),
    isWorkspaceTrusted: deps.isWorkspaceTrusted,
    workspaceRoot: deps.workspaceRoot,
    platform: deps.platform,
    spawn: async (launch, cwd, isCancelled) => {
      await deps.beforeWorkspaceProcessStart()
      if (isCancelled?.() === true || !deps.isWorkspaceTrusted()) {
        throw new Error(UI_TEXT.questionCancelled)
      }
      return spawn(launch, cwd)
    },
    fetch: deps.fetch,
    clientVersion: deps.clientVersion,
    log: deps.log,
  }
}
