import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { darwinProcessLease } from '../../src/core/judge/local/darwinPeer'

// Isolated because this deliberately waits for the actual helper's 30-second limit.
describe.skipIf(process.platform !== 'darwin')('M98 macOS default native deadline', () => {
  it('kills a nonresponsive helper at its own deadline before the caller fallback', async () => {
    await mkdir(path.resolve('temp/m98-j3'), { recursive: true })
    const directory = await realpath(await mkdtemp(path.resolve('temp/m98-j3/deadline-')))
    const helper = path.join(directory, 'helper')
    await writeFile(helper, '#!/bin/sh\nexec /bin/sleep 60\n')
    await chmod(helper, 0o700)
    const start = performance.now()
    try {
      await expect(
        darwinProcessLease(helper, process.pid, AbortSignal.timeout(35_000)),
      ).rejects.toThrow('unverified-darwin-lifetime')
      expect(performance.now() - start).toBeLessThan(33_000)
    } finally {
      await rm(directory, { recursive: true })
    }
  })
})
