import * as childProcess from 'node:child_process'
import * as museSdk from '@muse-code/sdk'
import { spawnResourceMuseConnection } from '../../src/host/resources/museResourceLaunch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { admitResource, resourceWindowsJob } from '../../src/core/resources/admission'
import type { ResourceLease } from '../../src/core/resources/launch'
import type * as resources from '../../src/core/resources/admission'
import { nativeToolIo } from './helpers/fakeToolIo'
import { createGitProcess } from '../../src/host/git'
import { modelApiMcpPoolDeps } from '../../src/host/backend/mcpServers'
import { FakeLogOutputChannel } from './helpers/fakes'
import { spawnHelper, startRecorder } from '../../src/host/voice/voiceProcesses'
import { runResourceCommand } from '../../src/host/backend/toolIo'

vi.mock('../../src/core/resources/admission', async (importOriginal) => ({
  ...(await importOriginal<typeof resources>()),
  admitResource: vi.fn(),
  resourceWindowsJob: vi.fn(),
}))
vi.mock('node:child_process', { spy: true })
vi.mock('@muse-code/sdk', { spy: true })
const lease: ResourceLease = { register: vi.fn(), complete: vi.fn(), background: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(admitResource).mockResolvedValue(lease)
  vi.mocked(resourceWindowsJob).mockResolvedValue(undefined)
})

const io = () => nativeToolIo(undefined, () => process.env)

describe('C1 final process admission', () => {
  it.each([-1, 0.5, NaN, Infinity, 2_147_483_648])(
    'refuses an invalid SDK shutdown timer %s before launch',
    async (shutdownTimeoutMs) => {
      await expect(
        spawnResourceMuseConnection(
          { command: 'unused', shutdownTimeoutMs },
          lease,
          () => Promise.resolve(undefined),
          process.env['SystemRoot'],
          () => Promise.resolve(),
        ),
      ).rejects.toThrow(RangeError)
      expect(museSdk.spawnMspConnection).not.toHaveBeenCalled()
      expect(lease.complete).toHaveBeenCalledWith(true)
    },
  )

  it('admits and registers short CLI commands before they start', async () => {
    const held = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(held.promise)
    const pending = runResourceCommand(
      { command: process.execPath, args: ['-e', "process.stdout.write('cli-result')"] },
      1000,
    )
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(childProcess.execFile).not.toHaveBeenCalled()
    expect(admitResource).toHaveBeenCalledWith('other', undefined, 'foreground')
    held.resolve(lease)
    expect(await pending).toEqual({ exitCode: 0, stdout: 'cli-result', stderr: '' })
    expect(lease.register).toHaveBeenCalledWith(
      expect.objectContaining({ pid: expect.any(Number) }),
    )
    expect(lease.complete).toHaveBeenCalledWith(false)
  })

  it('rechecks short CLI ownership after admission and never starts a cancelled command', async () => {
    const held = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(held.promise)
    let isAllowed = true
    const stop = new AbortController()
    const pending = runResourceCommand(
      { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      1000,
      undefined,
      undefined,
      stop.signal,
      () => {
        if (!isAllowed) throw new Error('CLI owner changed')
      },
    )
    isAllowed = false
    held.resolve(lease)
    expect(await pending).toMatchObject({ exitCode: -1, stderr: 'CLI owner changed' })
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
  })
  it('rechecks the Muse SDK owner after launch preparation before the SDK can start a process', async () => {
    const sdk = vi.spyOn(museSdk, 'spawnMspConnection')
    vi.mocked(resourceWindowsJob).mockResolvedValue({
      assemblyPath: 'unused.dll',
      executablePath: 'unused.exe',
    })
    try {
      await expect(
        spawnResourceMuseConnection(
          { command: 'unused', args: [] },
          lease,
          () => Promise.resolve('unused.dll'),
          process.env['SystemRoot'],
          () => {
            throw new Error('Muse owner changed')
          },
        ),
      ).rejects.toThrow('Muse owner changed')
      expect(sdk).not.toHaveBeenCalled()
      expect(lease.complete).toHaveBeenCalledWith(true)
    } finally {
      sdk.mockRestore()
    }
  })

  it('stops a voice helper waiting for admission without starting its process', async () => {
    const hold = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(hold.promise)
    const child = spawnHelper({ command: process.execPath, args: ['-e', 'process.exit(0)'] })
    const exited = Promise.withResolvers<string>()
    child.onExit(exited.resolve)
    child.kill()
    hold.resolve(lease)
    expect(await exited.promise).toBe('signal SIGTERM')
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
  })

  it('admits a recorder before forwarding real bytes and registering its process', async () => {
    const child = startRecorder(process.execPath, [
      '-e',
      "process.stdout.write('recorded-fixture')",
    ])
    const output = Promise.withResolvers<string>()
    const exited = Promise.withResolvers<string>()
    child.onData((bytes) => {
      output.resolve(Buffer.from(bytes).toString('utf8'))
    })
    child.onExit(exited.resolve)
    expect(await output.promise).toBe('recorded-fixture')
    expect(await exited.promise).toBe('exit code 0')
    expect(admitResource).toHaveBeenCalledWith('other', expect.any(AbortSignal))
    expect(lease.register).toHaveBeenCalledWith(
      expect.objectContaining({ pid: expect.any(Number) }),
    )
    expect(lease.complete).toHaveBeenCalledWith(false)
  })
  it('rechecks shell permission after the governor wait and releases an unstarted reservation', async () => {
    const hold = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(hold.promise)
    let isAllowed = true
    const pending = io().runShell(
      'exit 0',
      process.cwd(),
      1000,
      undefined,
      undefined,
      () => {
        if (!isAllowed) throw new Error('permission changed')
      },
      false,
      'check',
    )
    expect(childProcess.spawn).not.toHaveBeenCalled()
    isAllowed = false
    hold.resolve(lease)
    expect(await pending).toMatchObject({ isCancelled: true, isWorkspaceShutdownProven: true })
    expect(admitResource).toHaveBeenCalledWith('check', undefined)
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
  })

  it('cancels command hooks while waiting without starting a child', async () => {
    const hold = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(hold.promise)
    const stop = new AbortController()
    const runHook = io().runHook
    if (runHook === undefined) throw new Error('Missing hook launcher')
    const pending = runHook('exit 0', '{}', process.cwd(), 1000, stop.signal)
    stop.abort()
    hold.resolve(lease)
    expect(await pending).toMatchObject({ isCancelled: true })
    expect(admitResource).toHaveBeenCalledWith('hook', stop.signal)
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('rechecks the Git owner immediately before spawning after a resource wait', async () => {
    const hold = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(hold.promise)
    const run = createGitProcess({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      fileExists: () => true,
      spawn: childProcess.spawn,
    })
    let isAllowed = true
    const guard = () => {
      if (!isAllowed) throw new Error('owner changed')
    }
    const pending = run(['status'], {
      cwd: '/workspace',
      env: {},
      timeoutMs: 1000,
      beforeRun: guard,
    })
    isAllowed = false
    hold.resolve(lease)
    await expect(pending).rejects.toThrow('owner changed')
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
  })

  it('rechecks MCP workspace admission after the governor wait', async () => {
    const hold = Promise.withResolvers<ResourceLease>()
    vi.mocked(admitResource).mockReturnValue(hold.promise)
    let isAllowed = true
    const before = vi.fn(() =>
      isAllowed ? Promise.resolve() : Promise.reject(new Error('workspace changed')),
    )
    const deps = modelApiMcpPoolDeps({
      beforeWorkspaceProcessStart: before,
      workspaceRoot: process.cwd(),
      settingsPath: () => 'unused',
      isWorkspaceTrusted: () => true,
      clientVersion: 'test',
      platform: process.platform,
      env: () => ({}),
      fetch,
      log: new FakeLogOutputChannel(),
    })
    const pending = deps.spawn(
      {
        transport: 'stdio',
        command: process.execPath,
        args: [],
        env: {},
        cwd: undefined,
        framing: 'auto',
      },
      process.cwd(),
    )
    await Promise.resolve()
    await Promise.resolve()
    isAllowed = false
    hold.resolve(lease)
    await expect(pending).rejects.toThrow('workspace changed')
    expect(before).toHaveBeenCalledTimes(2)
    expect(childProcess.spawn).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
  })
})
