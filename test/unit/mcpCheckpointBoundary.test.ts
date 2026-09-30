import { afterEach, describe, expect, it, vi } from 'vitest'
import * as processModule from '../../src/host/backend/mcpProcess'
import { modelApiMcpPoolDeps } from '../../src/host/backend/mcpServers'
import type { McpChildProcess } from '../../src/core/backends/modelapi/mcp/stdio'
import type { McpStdioLaunch } from '../../src/core/backends/modelapi/mcp/servers'
import { MCP_TRANSPORTS, UI_TEXT } from '../../src/shared/constants'
import {
  holdRestoreRef,
  changedFileTurn,
  restoreOutcome,
  type Harness,
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
} from './helpers/checkpointHarness'

vi.mock('../../src/host/backend/mcpProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof processModule>()),
}))
afterEach(async () => {
  vi.restoreAllMocks()
  await removeCheckpointFolders()
})

function childFixture(): McpChildProcess {
  return {
    write: () => undefined,
    endInput: () => undefined,
    onStdout: () => undefined,
    onStderr: () => undefined,
    onExit: () => undefined,
    kill: () => Promise.resolve(),
  }
}

const LAUNCH: McpStdioLaunch = {
  transport: MCP_TRANSPORTS.stdio,
  command: process.execPath,
  args: [],
  env: {},
  cwd: undefined,
  framing: 'auto',
}

function depsFor(h: Harness, barrier: () => Promise<void>, isTrusted: () => boolean = () => true) {
  return modelApiMcpPoolDeps({
    workspaceRoot: h.root,
    beforeWorkspaceProcessStart: barrier,
    settingsPath: () => '',
    isWorkspaceTrusted: isTrusted,
    clientVersion: 'fixture',
    platform: process.platform,
    env: () => ({}),
    fetch: globalThis.fetch,
    log: h.log,
  })
}

function heldStartup(h: Harness) {
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const barrier = async () => {
    entered.resolve(undefined)
    await resume.promise
    await h.store.markNativeBackend()
  }
  return { entered, resume, barrier }
}

describe('local MCP checkpoint startup boundary (M72)', () => {
  it(
    'awaits durable startup presence and keeps idle/closed server uncertainty',
    async () => {
      const h = await harness()
      await changedFileTurn(h)
      const { entered, resume, barrier } = heldStartup(h)
      const spawn = vi.fn(() => childFixture())
      vi.spyOn(processModule, 'mcpServerSpawner').mockReturnValue(spawn)
      const poolDeps = depsFor(h, barrier)
      const starting = poolDeps.spawn(LAUNCH, h.root)
      try {
        await entered.promise
        expect(spawn).not.toHaveBeenCalled()
      } finally {
        resume.resolve(undefined)
      }
      const child = await starting
      expect(spawn).toHaveBeenCalledOnce()
      await child.kill()
      expect(h.store.isNativeUnsafe).toBe(true)
      expect(await restoreOutcome(h.reopen(), 't1')).toEqual({ ok: false, reason: 'nativeUnsafe' })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'spawns no local MCP server while a real restore reservation is held',
    async () => {
      const h = await harness()
      await holdRestoreRef(h)
      const spawn = vi.fn(() => childFixture())
      vi.spyOn(processModule, 'mcpServerSpawner').mockReturnValue(spawn)
      const poolDeps = depsFor(h, () => h.store.markNativeBackend())
      await expect(poolDeps.spawn(LAUNCH, h.root)).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
      expect(spawn).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['cancelled', 'untrusted'])(
    'does not spawn after admission was held and then %s',
    async (kind) => {
      const h = await harness()
      const { entered, resume, barrier } = heldStartup(h)
      let isRevoked = false
      const spawn = vi.fn(() => childFixture())
      vi.spyOn(processModule, 'mcpServerSpawner').mockReturnValue(spawn)
      const poolDeps = depsFor(h, barrier, () => kind !== 'untrusted' || !isRevoked)
      const starting = poolDeps.spawn(LAUNCH, h.root, () => kind === 'cancelled' && isRevoked)
      const refused = expect(starting).rejects.toThrow(UI_TEXT.questionCancelled)
      try {
        await entered.promise
        isRevoked = true
      } finally {
        resume.resolve(undefined)
      }
      await refused
      expect(spawn).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
