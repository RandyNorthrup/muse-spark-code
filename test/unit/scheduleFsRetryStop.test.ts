// The schedule storage retry bound (D121 clarification, RLF-SAFELIMITS): a
// transient-coded failure retries a bounded number of times, then the last
// error surfaces with its kind; a brief denial still reads, and the call's
// stop still ends the wait with the abort reason. The denial below is the
// kernel's own (helpers/deniedAccess: chmod 0 on POSIX, a deny entry on
// Windows); nothing is simulated.
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import {
  createNodeScheduleFs,
  isTransientStoreError,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { denyAccess } from './helpers/deniedAccess'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

describe('schedule storage reads with a retry bound', () => {
  it('reads through a brief transient denial', async () => {
    const root = await temporaryDir('muse-schedule-retry-')
    try {
      const fs = createNodeScheduleFs(root)
      await fs.publish('probe/file.json', '{"held":true}')
      // Five attempts space themselves over ~200 ms of backoff (20 ms ×
      // attempt); lifting the denial after 100 ms proves a transient
      // failure still heals inside the budget.
      const allow = await denyAccess(root)
      const reading = fs.read('probe/file.json')
      await delay(100)
      await allow()
      await expect(reading).resolves.toBe('{"held":true}')
    } finally {
      await removeFolder(root)
    }
  })

  it('stops a never-clearing denial after five attempts, keeping its kind', async () => {
    const root = await temporaryDir('muse-schedule-bound-')
    const fs = createNodeScheduleFs(root)
    // The read targets a file that exists, as below: Windows reads a missing
    // name under a denied folder as missing (ENOENT), not as the denial.
    await fs.publish('probe/file.json', '{"held":true}')
    const allow = await denyAccess(root)
    try {
      // Unbounded code would wait here past the suite's own timeout; the
      // bound rejects after five attempts (~200 ms of backoff).
      let failure: unknown
      try {
        await fs.read('probe/file.json')
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(isTransientStoreError(failure)).toBe(true)
    } finally {
      await allow()
      await removeFolder(root)
    }
  })

  it('ends a transient wait at the call stop, with the abort reason', async () => {
    const root = await temporaryDir('muse-schedule-stop-')
    const fs = createNodeScheduleFs(root)
    // The read targets a file that exists: Windows grants every user
    // traverse past a denied folder, so a missing name under it reads as
    // missing there (ENOENT), never as the transient denial this case needs.
    await fs.publish('probe/file.json', '{"held":true}')
    const allow = await denyAccess(root)
    try {
      const stop = new AbortController()
      const reading = fs.read('probe/file.json', { signal: stop.signal })
      // Abort mid-backoff, before the five attempts run out (~200 ms):
      // the stop still ends the wait with its own reason.
      await delay(50)
      stop.abort()
      await expect(reading).rejects.toBe(stop.signal.reason)
    } finally {
      await allow()
      await removeFolder(root)
    }
  })
})
