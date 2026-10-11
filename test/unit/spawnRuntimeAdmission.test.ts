import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { lazyRuntimeResources } from '../../src/runtime/resources/load'
import { admitBootstrap, resourceWindowsJob } from '../../src/core/resources/admission'
import { execResourceFile } from '../../src/core/resources/launcher'
import { runtimeResources } from './helpers/resources/runtime'
import { runBootstrap } from '../../src/core/bootstrapCommand'
import * as runtimeJobs from '../../src/runtime/resources/jobs'
import { TreeTempRoots } from '../../src/host/resources/tempRoots'
import { localGitRefs } from '../../src/core/schedules/events/git'
import { removeFolder } from './helpers/temporaryFolders'
import * as childProcess from 'node:child_process'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { windowsVaultExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import { createToolIo } from '../../src/host/backend/toolIo'
import { ResourceHelperChangedError } from '../../src/host/backend/helperIntegrity'

vi.mock('node:child_process', { spy: true })
// The runtime prepares its Windows helpers through this module (load.ts).
vi.mock('../../src/runtime/resources/jobs', { spy: true })

/** Binds global process admission to the fixture's runtime queue, as `run()` does. */
function bindRuntime(
  host: Awaited<ReturnType<typeof runtimeResources>>['host'],
  bundle: { machineDir?: string } = {},
) {
  return lazyRuntimeResources({
    distDir: path.resolve('dist'),
    machineDir: bundle.machineDir ?? process.cwd(),
    sleep: () => Promise.resolve(),
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    onError: vi.fn(),
    loadBundle: () => ({ createResources: () => Promise.resolve(host) }),
  })
}

describe('runtime global admission', () => {
  it('uses the runtime queue for process work and refuses heavy bootstrap work at pause', async () => {
    const fixture = await runtimeResources()
    const admits = vi.spyOn(fixture.host, 'admit')
    const resources = bindRuntime(fixture.host)
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
      const storage = await mkdtemp(path.join(tmpdir(), 'l-SPAWN017C-'))
      try {
        await expect(
          runBootstrap(process.execPath, ['-e', 'process.exit(0)'], {}, { timeoutMs: 100 }),
        ).rejects.toMatchObject({ code: 'paused', message: 'Resources: Paused' })
        if (process.platform === 'win32') {
          const log = vi.fn()
          const io = createToolIo({
            platform: 'win32',
            systemRoot: process.env['SystemRoot'],
            env: () => ({}),
            listFiles: () => Promise.resolve([]),
            searchWorkerPath: path.resolve('dist/searchWorker.js'),
            log,
            unsavedFiles: () => [],
            shellJobAssembly: shellJobAssembly({
              storageDir: storage,
              systemRoot: process.env['SystemRoot'] ?? '',
              readJobSource: () => Promise.resolve('public class PausedFirstShell {}'),
              log,
            }),
          })
          await expect(
            io.runShell('echo first-shell', process.cwd(), 100, undefined),
          ).rejects.toMatchObject({ code: 'paused', message: 'Resources: Paused' })
          expect(log).not.toHaveBeenCalled()
        }
        await expect(
          shellJobAssembly({
            storageDir: storage,
            systemRoot: path.resolve('unavailable-system-root'),
            readJobSource: () => Promise.resolve('public class PauseFixture {}'),
            log: vi.fn(),
          })(),
        ).rejects.toMatchObject({ code: 'paused', message: 'Resources: Paused' })
        const count = admits.mock.calls.length
        await expect(
          windowsVaultExecutable({
            storageDir: storage,
            systemRoot: path.resolve('unavailable-system-root'),
            readSource: () =>
              Promise.resolve(
                '// BEGIN VAULT PATH GUARD\npublic class Fixture {}\n// END VAULT PATH GUARD',
              ),
          }),
        ).rejects.toMatchObject({ code: 'paused', message: 'Resources: Paused' })
        expect(admits.mock.calls.length - count).toBe(1)
        expect(spawn).not.toHaveBeenCalled()
      } finally {
        spawn.mockRestore()
        await removeFolder(storage)
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
  it('includes a sampler that never returns in the caller admission deadline', async () => {
    const fixture = await runtimeResources()
    const sample = vi
      .spyOn(fixture.sampler, 'sample')
      .mockImplementation(() => Promise.withResolvers<never>().promise)
    const admits = vi.spyOn(fixture.host, 'admit')
    const resources = bindRuntime(fixture.host)
    const signal = AbortSignal.timeout(100)
    try {
      await expect(admitBootstrap(signal)).rejects.toMatchObject({ name: 'TimeoutError' })
      // The status read reached the sampler; the caller's deadline ended the wait.
      expect(sample).toHaveBeenCalled()
      expect(admits).not.toHaveBeenCalled()
    } finally {
      resources.dispose()
      fixture.host.dispose()
    }
  })

  it('prepares the Windows job helpers once and retries a failed preparation', async () => {
    const fixture = await runtimeResources()
    const jobs = {
      assemblyPath: String.raw`C:\fixture\job.dll`,
      executablePath: String.raw`C:\fixture\job.exe`,
      verify: vi.fn(() => Promise.resolve()),
    }
    const prepare = vi.mocked(runtimeJobs.runtimeResourceJobs)
    prepare.mockResolvedValueOnce(undefined).mockResolvedValue(jobs)
    const resources = bindRuntime(fixture.host)
    try {
      await expect(resourceWindowsJob()).resolves.toBeUndefined()
      const concurrent = await Promise.all([resourceWindowsJob(), resourceWindowsJob()])
      const shape = {
        assemblyPath: jobs.assemblyPath,
        executablePath: jobs.executablePath,
        verify: expect.any(Function),
      }
      expect(concurrent).toEqual([shape, shape])
      const ready = await resourceWindowsJob()
      expect(ready).toEqual(shape)
      // One failed preparation, then one shared successful one.
      expect(prepare).toHaveBeenCalledTimes(2)
      // Each launch verifies the shared helper; a changed one re-prepares next time.
      await ready?.verify()
      expect(jobs.verify).toHaveBeenCalledOnce()
      jobs.verify.mockRejectedValueOnce(new ResourceHelperChangedError())
      await expect(ready?.verify()).rejects.toMatchObject({ code: 'helperChanged' })
      await resourceWindowsJob()
      expect(prepare).toHaveBeenCalledTimes(3)
    } finally {
      resources.dispose()
      fixture.host.dispose()
      prepare.mockReset()
    }
  })
})

describe('bounded runtime commands', () => {
  const state: { machineDir?: string; dispose?: () => void } = {}
  const fixture: { current?: Awaited<ReturnType<typeof runtimeResources>> } = {}
  beforeAll(async () => {
    fixture.current = await runtimeResources()
    state.machineDir = await mkdtemp(path.join(tmpdir(), 'spawn017c-'))
    const resources = bindRuntime(fixture.current.host, { machineDir: state.machineDir })
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

  it('admits a read-only probe through the runtime queue without a per-command temp root', async () => {
    const host = fixture.current?.host
    if (host === undefined) throw new Error('Runtime fixture missing')
    const admits = vi.spyOn(host, 'admit')
    const temp = vi.spyOn(TreeTempRoots.prototype, 'create')
    try {
      const result = await execResourceFile(
        'probe',
        process.execPath,
        ['-e', "process.stdout.write('governed')"],
        { env: process.env, encoding: 'utf8' },
      )
      expect(result.stdout).toBe('governed')
      expect(admits).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'other', class: 'foreground' }),
        undefined,
        expect.any(AbortSignal),
      )
      expect(temp).not.toHaveBeenCalled()
    } finally {
      admits.mockRestore()
      temp.mockRestore()
    }
  })

  it('never lets the probe exemption become the default: contained commands get a temp root', async () => {
    const refusal = new Error('Fixture temp root refused')
    const temp = vi.spyOn(TreeTempRoots.prototype, 'create').mockRejectedValue(refusal)
    const spawn = vi.spyOn(childProcess, 'spawn')
    try {
      await expect(
        execResourceFile('contained', process.execPath, ['-e', 'process.exit(0)'], {
          env: process.env,
          encoding: 'utf8',
        }),
      ).rejects.toBe(refusal)
      expect(temp).toHaveBeenCalledOnce()
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      temp.mockRestore()
      spawn.mockRestore()
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
