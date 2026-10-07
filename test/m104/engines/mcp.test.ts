import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRuntimeMcp, type RuntimeMcpDeps } from '../../../src/runtime/features/mcp'
import { McpServerPool } from '../../../src/core/backends/modelapi/mcp/pool'
import { readMcpServerEntries } from '../../../src/core/backends/musecode/museConfigView'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { FAKE_MCP_SERVER, fixtureJobLifecycle } from '../../unit/helpers/mcpFixtures'

const owners: ReturnType<typeof createRuntimeMcp>[] = []
const jobs = fixtureJobLifecycle()
beforeAll(jobs.setup)
afterAll(jobs.dispose)
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.close()))
})
function setup(overrides: Partial<RuntimeMcpDeps> = {}) {
  const state = { isTrusted: true, canUseTools: true, isCurrent: true }
  const admit = vi.fn(() => Promise.resolve())
  const owner = createRuntimeMcp(
    {
      readSettings: () =>
        readMcpServerEntries(
          JSON.stringify({
            mcpServers: {
              fake: { command: process.execPath, args: [FAKE_MCP_SERVER] },
            },
          }),
        ),
      isWorkspaceTrusted: () => state.isTrusted,
      canUseTools: () => state.canUseTools,
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('replaced')
      },
      beforeWorkspaceProcessStart: admit,
      workspaceRoot: path.dirname(FAKE_MCP_SERVER),
      platform: process.platform,
      jobExecutablePath: jobs.path,
      env: () => ({ PATH: process.env['PATH'] }),
      fetch: () => Promise.reject(new Error('no external network in fixture')),
      clientVersion: 'test',
      log: new FakeLogOutputChannel(),
      ...overrides,
    },
    (deps) => new McpServerPool(deps),
  )
  owners.push(owner)
  return { state, admit, owner }
}

describe('portable capability-aware MCP lifecycle', () => {
  it('connects the real fixture, calls its tool and withdraws offerings on live admission changes', async () => {
    const { owner, state, admit } = setup()
    await owner.start()
    expect(admit).toHaveBeenCalledOnce()
    expect(owner.find('mcp__fake__echo')).toBeDefined()
    expect(
      await owner.call('mcp__fake__echo', '{"text":"portable"}', new AbortController().signal),
    ).toMatchObject({ output: 'echo: portable' })
    state.canUseTools = false
    expect(owner.definitions()).toEqual([])
    expect(owner.find('mcp__fake__echo')).toBeUndefined()
    await expect(owner.call('mcp__fake__echo', '{}', new AbortController().signal)).rejects.toThrow(
      'MHP_MODEL_TOOLS_UNAVAILABLE',
    )
    state.canUseTools = true
    state.isTrusted = false
    expect(owner.definitions()).toEqual([])
    await expect(owner.call('mcp__fake__echo', '{}', new AbortController().signal)).rejects.toThrow(
      'MHP_MCP_RESTRICTED',
    )
    state.isTrusted = true
    state.isCurrent = false
    expect(() => owner.definitions()).toThrow('replaced')
    const closing = owner.close()
    expect(owner.close()).toBe(closing)
    await closing
    expect(owner.definitions()).toEqual([])
    await expect(owner.start()).rejects.toThrow('MHP_MCP_CLOSED')
  })

  it.each(['trust', 'tools'])(
    'starts no process while %s admission is off, then starts after it changes',
    async (gate) => {
      const { owner, state, admit } = setup()
      if (gate === 'trust') state.isTrusted = false
      else state.canUseTools = false
      await owner.start()
      expect(admit).not.toHaveBeenCalled()
      expect(owner.snapshot().servers[0]?.state.status).toBe('restricted')
      state.isTrusted = true
      state.canUseTools = true
      await owner.start()
      expect(owner.definitions()).not.toEqual([])
    },
  )

  it('rechecks admission after a suspended checkpoint barrier and never spawns', async () => {
    const held = Promise.withResolvers<undefined>()
    const reached = Promise.withResolvers<undefined>()
    const spawn = vi.fn<NonNullable<RuntimeMcpDeps['spawn']>>(() => {
      throw new Error('no fixture process expected')
    })
    const { owner, state } = setup({
      beforeWorkspaceProcessStart: () => {
        reached.resolve(undefined)
        return held.promise
      },
      spawn,
    })
    const starting = owner.start()
    await reached.promise
    state.isTrusted = false
    held.resolve(undefined)
    await starting
    expect(spawn).not.toHaveBeenCalled()
    expect(owner.snapshot().servers[0]?.state.status).toBe('failed')
  })

  it('kills a late acquired child and waits for its cleanup when released during spawn', async () => {
    const held = Promise.withResolvers<undefined>()
    const reached = Promise.withResolvers<undefined>()
    const killed = vi.fn(() => Promise.resolve())
    const { owner } = setup({
      spawn: async () => {
        reached.resolve(undefined)
        await held.promise
        return {
          write: () => undefined,
          endInput: () => undefined,
          onStdout: () => undefined,
          onStderr: () => undefined,
          onExit: () => undefined,
          kill: killed,
        }
      },
    })
    const starting = owner.start()
    await reached.promise
    const closing = owner.close()
    held.resolve(undefined)
    await expect(starting).rejects.toThrow('MHP_MCP_CLOSED')
    await closing
    expect(killed).toHaveBeenCalledOnce()
    expect(owner.definitions()).toEqual([])
  })
})
