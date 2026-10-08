import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { lazyRuntimeResources } from '../../src/runtime/resources/load'
import { admitBootstrap } from '../../src/core/resources/admission'
import { runtimeResources } from './helpers/resources/runtime'
import { runBootstrap } from '../../src/core/resources/bootstrap'
import * as childProcess from 'node:child_process'
import { shellJobAssembly } from '../../src/host/backend/shellJob'
import { windowsVaultExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import { createToolIo } from '../../src/host/backend/toolIo'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:child_process', { spy: true })

/** Binds global process admission to the fixture's runtime queue, as `run()` does. */
function bindRuntime(host: Awaited<ReturnType<typeof runtimeResources>>['host']) {
  return lazyRuntimeResources({
    distDir: path.resolve('dist'),
    machineDir: process.cwd(),
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
})
