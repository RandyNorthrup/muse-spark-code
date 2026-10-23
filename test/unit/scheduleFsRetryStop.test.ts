// No attempt count of ours on schedule storage reads (D121, RLF-NOLIMITS):
// a transient-coded failure retries until the read succeeds, fails another
// way, or the call's stop fires. The denial below is the kernel's own
// (helpers/deniedAccess: chmod 0 on POSIX, a deny entry on Windows);
// nothing is simulated.
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { denyAccess } from './helpers/deniedAccess'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

describe('schedule storage reads without an attempt count', () => {
  it('retries a transient denial past five attempts, then reads', async () => {
    const root = await temporaryDir('muse-schedule-retry-')
    try {
      const fs = createNodeScheduleFs(root)
      await fs.publish('probe/file.json', '{"held":true}')
      // Six attempts space themselves ~420 ms apart (20 ms × attempt);
      // holding the denial 1.5 s proves the read outlived the removed
      // five-attempt budget with room for a loaded rig.
      const allow = await denyAccess(root)
      const reading = fs.read('probe/file.json')
      await delay(1500)
      await allow()
      await expect(reading).resolves.toBe('{"held":true}')
    } finally {
      await removeFolder(root)
    }
  })

  it('ends a transient wait at the call stop, with the abort reason', async () => {
    const root = await temporaryDir('muse-schedule-stop-')
    const allow = await denyAccess(root)
    try {
      const fs = createNodeScheduleFs(root)
      const stop = new AbortController()
      const reading = fs.read('probe/missing.json', { signal: stop.signal })
      await delay(300)
      stop.abort()
      await expect(reading).rejects.toBe(stop.signal.reason)
    } finally {
      await allow()
      await removeFolder(root)
    }
  })
})
