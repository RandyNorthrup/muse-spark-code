import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { lazyRuntimeResources } from '../../src/runtime/resources/load'
import {
  admitBootstrap,
  execResourceFile,
  resourceWindowsJob,
} from '../../src/core/resources/admission'
import { runtimeResources } from './helpers/resources/runtime'
import { runBootstrap } from '../../src/core/resources/bootstrap'
import { runtimeResourceJobs } from '../../src/runtime/resources/entry'
import { TreeTempRoots } from '../../src/host/resources/tempRoots'
import { localGitRefs } from '../../src/core/schedules/events/git'
import { removeFolder } from './helpers/temporaryFolders'
import * as childProcess from 'node:child_process'

vi.mock('node:child_process', { spy: true })

const silentLog = () => ({ trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('runtime global admission', () => {
  it('uses the runtime queue for process work and refuses heavy bootstrap work at pause', async () => {
    const fixture = await runtimeResources()
    const admits = vi.spyOn(fixture.host, 'admit')
    const resources = lazyRuntimeResources({
      distDir: path.resolve('dist'),
      machineDir: process.cwd(),
      sleep: () => Promise.resolve(),
      log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      onError: vi.fn(),
      loadBundle: () => ({ createResources: () => Promise.resolve(fixture.host) }),
    })
    try {
      const lease = await admitBootstrap()
      expect(admits).toHaveBeenCalledWith(
        expect.objectContaining({ class: 'background', diskHeavy: true }),
        undefined,
        undefined,
      )
      lease.complete(true)
      fixture.reading.memoryAvailableBytes = 1
      fixture.reading.memoryUsedPercent = 100

      const paused = await fixture.host.status()
      expect(paused.level).toBe('pause')
      const spawn = vi.spyOn(childProcess, 'spawn')
      try {
        await expect(
          runBootstrap(process.execPath, ['-e', 'process.exit(0)'], {}, { timeoutMs: 100 }),
        ).rejects.toThrow()
        expect(spawn).not.toHaveBeenCalled()
      } finally {
        spawn.mockRestore()
      }
      const controller = new AbortController()
      const denied = admitBootstrap(controller.signal)
      const rejection = expect(denied).rejects.toThrow()
      await fixture.host.status()
      controller.abort()
      await rejection
    } finally {
      resources.dispose()
      fixture.host.dispose()
    }
    await expect(admitBootstrap()).rejects.toThrow('disposed')
  })

  it('prepares the Windows job helpers once and retries a failed preparation', async () => {
    const fixture = await runtimeResources()
    const jobs = {
      assemblyPath: String.raw`C:\fixture\job.dll`,
      executablePath: String.raw`C:\fixture\job.exe`,
    }
    const prepare = vi.fn<typeof runtimeResourceJobs>()
    prepare.mockResolvedValueOnce(undefined).mockResolvedValue(jobs)
    const resources = lazyRuntimeResources({
      distDir: path.resolve('dist'),
      machineDir: process.cwd(),
      sleep: () => Promise.resolve(),
      log: silentLog(),
      onError: vi.fn(),
      loadBundle: () => ({
        createResources: () => Promise.resolve(fixture.host),
        runtimeResourceJobs: prepare,
      }),
    })
    try {
      await expect(resourceWindowsJob()).resolves.toBeUndefined()
      const concurrent = await Promise.all([resourceWindowsJob(), resourceWindowsJob()])
      expect(concurrent).toEqual([jobs, jobs])
      await expect(resourceWindowsJob()).resolves.toEqual(jobs)
      // One failed preparation, then one shared successful one.
      expect(prepare).toHaveBeenCalledTimes(2)
    } finally {
      resources.dispose()
      fixture.host.dispose()
    }
  })
})

describe('bounded runtime commands', () => {
  const state: { machineDir?: string; dispose?: () => void } = {}
  const fixture: { current?: Awaited<ReturnType<typeof runtimeResources>> } = {}
  beforeAll(async () => {
    fixture.current = await runtimeResources()
    const host = fixture.current.host
    state.machineDir = await mkdtemp(path.join(tmpdir(), 'spawn017c-'))
    const resources = lazyRuntimeResources({
      distDir: path.resolve('dist'),
      machineDir: state.machineDir,
      sleep: () => Promise.resolve(),
      log: silentLog(),
      onError: vi.fn(),
      loadBundle: () => ({ createResources: () => Promise.resolve(host), runtimeResourceJobs }),
    })
    state.dispose = () => {
      resources.dispose()
    }
    // Windows compiles and self-tests the real job helpers once, before timed cases.
    if (process.platform === 'win32') expect(await resourceWindowsJob()).toBeDefined()
  }, 60_000)
  afterAll(async () => {
    state.dispose?.()
    fixture.current?.host.dispose()
    if (state.machineDir !== undefined) await removeFolder(state.machineDir)
  })

  it('admits a bounded command through the runtime queue without a per-command temp root', async () => {
    const host = fixture.current?.host
    if (host === undefined) throw new Error('Runtime fixture missing')
    const admits = vi.spyOn(host, 'admit')
    const temp = vi.spyOn(TreeTempRoots.prototype, 'create')
    try {
      const result = await execResourceFile(
        process.execPath,
        ['-e', "process.stdout.write('governed')"],
        { env: process.env, encoding: 'utf8' },
      )
      expect(result.stdout).toBe('governed')
      expect(admits).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'other', class: 'foreground' }),
        undefined,
        undefined,
      )
      expect(temp).not.toHaveBeenCalled()
    } finally {
      admits.mockRestore()
      temp.mockRestore()
    }
  })

  it('keeps the actual refusal behind the fixed unavailable Git reason', async () => {
    const host = fixture.current?.host
    if (host === undefined) throw new Error('Runtime fixture missing')
    const refusal = new Error('Fixture admission refused')
    const admits = vi.spyOn(host, 'admit').mockRejectedValue(refusal)
    const spawn = vi.spyOn(childProcess, 'spawn')
    try {
      const read = localGitRefs(process.cwd(), () => true).read()
      await expect(read).rejects.toThrow('gitRefs')
      await expect(read).rejects.toHaveProperty('cause', refusal)
      expect(admits).toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      admits.mockRestore()
      spawn.mockRestore()
    }
  })
})
