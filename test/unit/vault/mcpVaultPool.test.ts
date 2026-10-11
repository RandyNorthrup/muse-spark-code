import { describe, expect, it, vi } from 'vitest'
import { McpServerPool, type McpPoolDeps } from '../../../src/core/backends/modelapi/mcp/pool'
import { readMcpServerEntries } from '../../../src/core/backends/musecode/museConfigView'
import {
  isExistingDirectory,
  isExistingFile,
  mcpServerSpawner,
  resolveMcpVaultCommand,
} from '../../../src/host/backend/mcpProcess'
import { realpathSync } from 'node:fs'
import { UI_TEXT } from '../../../src/shared/constants'
import { modelApiMcpPoolDeps } from '../../../src/host/backend/mcpServers'

function fixture(entry: Record<string, unknown>, vault?: McpPoolDeps['vault']) {
  const spawn = vi.fn(() => {
    throw new Error('fixture original spawner called')
  })
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.reject(new Error('fixture original transport called')),
  )
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const pool = new McpServerPool({
    readSettings: () => readMcpServerEntries(JSON.stringify({ mcpServers: { one: entry } })),
    lookupEnv: () => undefined,
    isWorkspaceTrusted: () => true,
    workspaceRoot: '/workspace',
    platform: 'darwin',
    spawn,
    fetch: fetcher,
    clientVersion: 'test',
    log,
    ...(vault !== undefined && { vault }),
  })
  return { pool, spawn, fetcher, log }
}

describe('M109 O pool and spawner enforcement', () => {
  it('W-O4 credentialed HTTP awaits admission and rechecks current workspace trust', async () => {
    let isTrusted = true
    const guarded = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ ok: true })))
    const fetchFor = vi.fn(() => guarded)
    const admission = vi.fn(() => {
      isTrusted = false
      return Promise.resolve()
    })
    const deps = modelApiMcpPoolDeps({
      vault: { startStdio: () => Promise.reject(new Error('unused')), fetchFor },
      beforeWorkspaceProcessStart: admission,
      workspaceRoot: '/workspace',
      settingsPath: () => '/fixture/settings.json',
      isWorkspaceTrusted: () => isTrusted,
      clientVersion: 'test',
      platform: 'darwin',
      env: () => ({}),
      fetch: guarded,
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    const transport = deps.vault?.fetchFor('one', 'https://mcp.example.test/mcp', {})
    if (!transport) throw new Error('expected guarded transport')
    await expect(transport('https://mcp.example.test/mcp', { redirect: 'error' })).rejects.toThrow(
      UI_TEXT.questionCancelled,
    )
    expect(admission).toHaveBeenCalledOnce()
    expect(guarded).not.toHaveBeenCalled()
  })

  it('retains host checkpoint admission and current workspace trust for vault stdio', async () => {
    let isTrusted = true
    const startStdio = vi.fn(() => Promise.reject(new Error('fixture no process')))
    const beforeWorkspaceProcessStart = vi.fn(() => {
      isTrusted = false
      return Promise.resolve()
    })
    const deps = modelApiMcpPoolDeps({
      vault: { startStdio, fetchFor: () => undefined },
      beforeWorkspaceProcessStart,
      workspaceRoot: '/workspace',
      settingsPath: () => '/fixture/settings.json',
      isWorkspaceTrusted: () => isTrusted,
      clientVersion: 'test',
      platform: 'darwin',
      env: () => ({}),
      fetch: vi.fn(() => Promise.reject(new Error('fixture no network'))),
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    await expect(
      deps.vault!.startStdio(
        'one',
        {
          transport: 'stdio',
          command: 'server',
          args: [],
          env: { TOKEN: '${secret:one}' },
          cwd: undefined,
          framing: 'auto',
        },
        '/workspace',
        () => false,
      ),
    ).rejects.toThrow(UI_TEXT.questionCancelled)
    expect(beforeWorkspaceProcessStart).toHaveBeenCalledOnce()
    expect(startStdio).not.toHaveBeenCalled()
  })

  it('refuses a configured vault port that supplies no transport for secret headers', async () => {
    const f = fixture(
      { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Token: '${secret:one}' } },
      { startStdio: () => Promise.reject(new Error('not stdio')), fetchFor: () => undefined },
    )
    await f.pool.start()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.pool.snapshot().servers[0]?.state).toEqual({
      status: 'failed',
      reason: UI_TEXT.vault.noAccess,
    })
    await f.pool.close()
  })

  it('resolves the actual executable and working folder before granting stdio use', () => {
    const command = resolveMcpVaultCommand(
      {
        transport: 'stdio',
        command: process.execPath,
        args: ['--version'],
        env: { TOKEN: '${secret:one}' },
        cwd: undefined,
        framing: 'auto',
      },
      process.cwd(),
      {
        platform: process.platform,
        systemRoot: undefined,
        env: () => ({}),
        isExistingDirectory,
        isExistingFile,
        log: vi.fn(),
      },
    )
    expect(command).toEqual({
      executable: realpathSync(process.execPath),
      argv: ['--version'],
      cwd: realpathSync(process.cwd()),
    })
  })
  it.each([
    { command: 'server', env: { TOKEN: '${secret:one}' } },
    { command: 'server', args: ['secret://one'] },
    { type: 'http', url: 'https://mcp.example.test', headers: { Authorization: '${secret:one}' } },
  ])('refuses an unbound vault reference before start/HTTP dispatch', async (entry) => {
    const f = fixture(entry)
    await f.pool.start()
    expect(f.pool.snapshot().servers[0]?.state).toEqual({
      status: 'failed',
      reason: UI_TEXT.vault.noAccess,
    })
    expect(f.spawn).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
    await f.pool.close()
  })

  it('passes server identity and cancellation to the vault route, preserving handles', async () => {
    const startStdio = vi.fn(() => Promise.reject(new Error(UI_TEXT.vault.noAccess)))
    const f = fixture(
      { command: 'server', cwd: 'tools', env: { TOKEN: '${secret:one}' } },
      { startStdio, fetchFor: () => undefined },
    )
    await f.pool.start()
    expect(startStdio).toHaveBeenCalledWith(
      'one',
      expect.objectContaining({ env: { TOKEN: '${secret:one}' } }),
      '/workspace/tools',
      expect.any(Function),
    )
    expect(f.spawn).not.toHaveBeenCalled()
    await f.pool.close()
  })

  it('binds remote transport to the exact configured server and endpoint', async () => {
    const remote = vi.fn<typeof fetch>(() => Promise.reject(new Error(UI_TEXT.vault.noAccess)))
    const fetchFor = vi.fn(() => remote)
    const f = fixture(
      { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Token: '${secret:one}' } },
      { startStdio: () => Promise.reject(new Error('not stdio')), fetchFor },
    )
    await f.pool.start()
    expect(fetchFor).toHaveBeenCalledWith('one', 'https://mcp.example.test/mcp', {
      Token: '${secret:one}',
    })
    expect(remote).toHaveBeenCalledWith(
      'https://mcp.example.test/mcp',
      expect.objectContaining({ redirect: 'error' }),
    )
    expect(f.fetcher).not.toHaveBeenCalled()
    await f.pool.close()
  })

  it('keeps legacy stdio without references on the existing spawner', async () => {
    const startStdio = vi.fn(() => Promise.reject(new Error('not selected')))
    const f = fixture(
      { command: 'server', env: { ORDINARY: 'plain' } },
      { startStdio, fetchFor: () => undefined },
    )
    await f.pool.start()
    expect(f.spawn).toHaveBeenCalledOnce()
    expect(startStdio).not.toHaveBeenCalled()
    await f.pool.close()
  })

  it('direct host spawner refuses unresolved vault references before probing/spawning', () => {
    const isExistingDirectory = vi.fn(() => true)
    const start = mcpServerSpawner({
      platform: 'darwin',
      systemRoot: undefined,
      env: () => ({}),
      isExistingDirectory,
      isExistingFile: () => false,
      log: vi.fn(),
    })
    expect(() =>
      start(
        {
          transport: 'stdio',
          command: 'server',
          args: [],
          cwd: undefined,
          framing: 'auto',
          env: { TOKEN: '${secret:one}' },
        },
        '/workspace',
      ),
    ).toThrow(UI_TEXT.vault.noAccess)
    expect(isExistingDirectory).not.toHaveBeenCalled()
  })
})
