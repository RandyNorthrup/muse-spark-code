import type { McpPoolDeps, McpToolSource } from '../../core/backends/modelapi/mcp/pool'
import {
  isExistingDirectory,
  isExistingFile,
  mcpServerSpawner,
} from '../../host/backend/mcpProcess'
import { environmentValue } from '../../core/execGuard'
import { withoutCredentials, withoutKeyringRoutes } from '../credentialVariables'

export interface RuntimeMcpDeps extends Omit<McpPoolDeps, 'spawn' | 'lookupEnv'> {
  readonly env: () => NodeJS.ProcessEnv
  readonly jobExecutablePath?: string | undefined
  readonly beforeWorkspaceProcessStart: () => Promise<void>
  readonly assertCurrent: () => void
  /** Reads the selected catalog record synchronously; never an inferred provider name. */
  readonly canUseTools: () => boolean
  readonly spawn?: McpPoolDeps['spawn']
}

/** Real MCP connections use guarded process admission and the selected model's live tool capability. */
export function createRuntimeMcp(
  deps: RuntimeMcpDeps,
  newPool: (deps: McpPoolDeps) => McpToolSource,
): McpToolSource {
  const cleanEnv = () => withoutKeyringRoutes(withoutCredentials(deps.env()))
  const spawn =
    deps.spawn ??
    mcpServerSpawner({
      platform: deps.platform,
      systemRoot: environmentValue(cleanEnv(), deps.platform, 'SystemRoot'),
      jobExecutablePath: deps.jobExecutablePath,
      env: cleanEnv,
      isExistingFile,
      isExistingDirectory,
      log: (message) => {
        deps.log.warn(message)
      },
    })
  let isClosed = false
  let closing: Promise<void> | undefined
  const assertOpen = () => {
    if (isClosed) throw new Error('MHP_MCP_CLOSED')
  }
  const check = () => {
    assertOpen()
    deps.assertCurrent()
    if (!deps.isWorkspaceTrusted()) throw new Error('MHP_MCP_RESTRICTED')
    if (!deps.canUseTools()) throw new Error('MHP_MODEL_TOOLS_UNAVAILABLE')
  }
  const pool = newPool({
    ...deps,
    lookupEnv: (name) => environmentValue(cleanEnv(), deps.platform, name),
    isWorkspaceTrusted: () => !isClosed && deps.isWorkspaceTrusted() && deps.canUseTools(),
    fetch: async (...args) => {
      check()
      const response = await deps.fetch(...args)
      check()
      return response
    },
    spawn: async (launch, cwd, isCancelled) => {
      check()
      await deps.beforeWorkspaceProcessStart()
      check()
      if (isCancelled?.() === true) throw new Error('MHP_MCP_START_CANCELLED')
      const child = await spawn(launch, cwd, isCancelled)
      try {
        check()
        return child
      } catch (error: unknown) {
        await child.kill()
        throw error
      }
    },
  })
  const isAdmitted = () => !isClosed && deps.isWorkspaceTrusted() && deps.canUseTools()
  return {
    start: async () => {
      assertOpen()
      deps.assertCurrent()
      await pool.start()
      assertOpen()
      deps.assertCurrent()
    },
    snapshot: () => pool.snapshot(),
    definitions: () => {
      if (!isClosed) deps.assertCurrent()
      return isAdmitted() ? pool.definitions() : []
    },
    find: (name) => {
      if (!isClosed) deps.assertCurrent()
      return isAdmitted() ? pool.find(name) : undefined
    },
    call: async (name, args, signal, elicitation) => {
      check()
      signal.throwIfAborted()
      const result = await pool.call(name, args, signal, elicitation)
      check()
      return result
    },
    setElicitationHandler: (handler) => {
      if (pool.setElicitationHandler === undefined)
        throw new Error('MHP_MCP_ELICITATION_UNAVAILABLE')
      pool.setElicitationHandler(handler)
    },
    close: () => {
      isClosed = true
      closing ??= pool.close()
      return closing
    },
  }
}
