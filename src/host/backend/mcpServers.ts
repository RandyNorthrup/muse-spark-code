// The Model API backend's MCP servers as this window runs them (M50, PLAN.md
// D42): Muse Code's settings file read by M31's reader each time they start,
// stdio servers started by the real spawner (mcpProcess.ts), remote ones
// reached with the extension host's `fetch`, and `${VAR}` read from the
// extension host's environment. The pool itself is the Model API bundle's
// (M57, PLAN.md D6); this module gives it this window's parts.

import type { McpPoolDeps } from '../../core/backends/modelapi/mcp/pool'
import type { McpVaultPoolPort } from '../../core/vault/mcpSecrets'
import { environmentValue } from '../../core/backends/musecode/launch'
import { readMcpServerEntries } from '../../core/backends/musecode/museConfigView'
import { UI_TEXT } from '../../shared/constants'
import { readTextIfPresent } from '../cliFeatures'
import type { Logger } from '../logger'
import { isExistingDirectory, isExistingFile, mcpServerSpawner } from './mcpProcess'
import { admitResource } from '../../core/resources/admission'
import { governedMcpVaultRoutes, type McpVaultBroker } from './mcpVault'

export interface ModelApiMcpDeps {
  readonly vault?: McpVaultPoolPort
  /** Installed broker binding; absent broker services continue to refuse secrets. */
  readonly vaultBroker?: McpVaultBroker
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
  readonly shellJobAssembly?: (() => Promise<string | undefined>) | undefined
  readonly env: () => NodeJS.ProcessEnv
  readonly fetch: typeof fetch
  readonly log: Logger
}

export function modelApiMcpPoolDeps(deps: ModelApiMcpDeps): McpPoolDeps {
  const beforeStart = async (isCancelled?: () => boolean) => {
    await deps.beforeWorkspaceProcessStart()
    if (isCancelled?.() === true || !deps.isWorkspaceTrusted()) {
      throw new Error(UI_TEXT.questionCancelled)
    }
  }
  const spawnDeps = {
    platform: deps.platform,
    systemRoot: environmentValue(deps.env(), deps.platform, 'SystemRoot'),
    jobExecutablePath: deps.jobExecutablePath,
    env: deps.env,
    isExistingFile,
    isExistingDirectory,
    log: (message: string) => {
      deps.log.warn(message)
    },
  }
  const vault =
    deps.vaultBroker === undefined
      ? deps.vault
      : governedMcpVaultRoutes(
          {
            ...spawnDeps,
            beforeStart,
            assembly: () => deps.shellJobAssembly?.() ?? Promise.resolve(undefined),
          },
          deps.vaultBroker,
        )
  const spawn = mcpServerSpawner(spawnDeps)
  return {
    ...(vault !== undefined && {
      vault: {
        async startStdio(server, launch, cwd, isCancelled) {
          await beforeStart(isCancelled)
          return await vault.startStdio(
            server,
            launch,
            cwd,
            () => isCancelled() || !deps.isWorkspaceTrusted(),
          )
        },
        fetchFor(server, url, headers) {
          const transport = vault.fetchFor(server, url, headers, () => !deps.isWorkspaceTrusted())
          return transport === undefined
            ? undefined
            : async (target, init) => {
                await beforeStart(() => init?.signal?.aborted === true)
                return await transport(target, init)
              }
        },
      },
    }),
    readSettings: () => readMcpServerEntries(readTextIfPresent(deps.settingsPath())),
    lookupEnv: (name) => environmentValue(deps.env(), deps.platform, name),
    isWorkspaceTrusted: deps.isWorkspaceTrusted,
    workspaceRoot: deps.workspaceRoot,
    platform: deps.platform,
    spawn: async (launch, cwd, isCancelled, signal) => {
      await deps.beforeWorkspaceProcessStart()
      const assembly = await deps.shellJobAssembly?.()
      const resource = await admitResource('mcpServer', signal)
      if (isCancelled?.() === true || !deps.isWorkspaceTrusted()) {
        resource?.complete(true)
        throw new Error(UI_TEXT.questionCancelled)
      }
      try {
        await beforeStart(isCancelled)
        return spawn(launch, cwd, isCancelled, signal, resource, assembly)
      } catch (error: unknown) {
        resource?.complete(true)
        throw error
      }
    },
    fetch: deps.fetch,
    clientVersion: deps.clientVersion,
    log: deps.log,
  }
}
