import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { lazyRuntimeResources } from '../../src/runtime/resources/load'
import { admitBootstrap } from '../../src/core/resources/admission'
import { runtimeResources } from './helpers/resources/runtime'
import { runBootstrap } from '../../src/core/resources/bootstrap'
import * as childProcess from 'node:child_process'

vi.mock('node:child_process', { spy: true })

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
})
