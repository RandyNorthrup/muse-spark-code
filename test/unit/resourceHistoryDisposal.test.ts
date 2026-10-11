// RVM107W2G P2-2 / RVM107W2H P3: a disposed window's append that outlives the
// 2 s flush wait can never survive a Delete history. Its own file because, as
// in production, the window host is configured and disposed once per process.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitResource } from '../../src/core/resources/admission'
import { resourceHistoryReader } from '../../src/runtime/resources/history'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { RESOURCE_HISTORY_FLUSH_TIMEOUT_MS } from '../../src/shared/constants'
import {
  configureWindowHistory,
  deleteThroughPage,
  journalMinuteLines,
  liveFiles,
  temporaryFolders,
  waitUntil,
} from './helpers/resources/journalFixtures'

const folders = temporaryFolders('rvm107w2g-disposal')
const temporary = folders.create
afterEach(async () => {
  vi.restoreAllMocks()
  await folders.cleanup()
})

describe('RVM107W2G P2-2: no write can land between Delete history and its boundary', () => {
  it(
    'keeps a disposed window append that outlives the 2 s flush wait from surviving a delete',
    // It waits out the production 2 s timer; the repository default leaves no room.
    { timeout: 15_000 },
    async () => {
      const folder = await temporary()
      // The disposal flush's own 2 s timer, observed firing.
      let isFlushWaitOver = false
      const realSetTimeout = globalThis.setTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        callback: (...values: unknown[]) => void,
        ms?: number,
        ...rest: unknown[]
      ) =>
        realSetTimeout(() => {
          if (ms === RESOURCE_HISTORY_FLUSH_TIMEOUT_MS) isFlushWaitOver = true
          callback(...rest)
        }, ms)) as never)
      const { promise: blocked, resolve: release } = Promise.withResolvers<undefined>()
      let isBlocking = true
      let isAppendDone = false
      const realAppend = NodeUsageFs.prototype.append
      vi.spyOn(NodeUsageFs.prototype, 'append').mockImplementation(async function (
        this: NodeUsageFs,
        ...args: Parameters<NodeUsageFs['append']>
      ) {
        if (isBlocking && args[0].endsWith('.jsonl')) {
          isBlocking = false
          await blocked
        }
        await realAppend.apply(this, args)
        if (!isBlocking) isAppendDone = true
      })
      const dispose = configureWindowHistory(folder)
      const lease = await admitResource('other', undefined, 'foreground')
      lease?.complete(true)
      await waitUntil(async () => {
        const live = await liveFiles(folder)
        return live.length > 0
      }, 3000)
      dispose()
      // The disposal flush is now blocked inside its append, holding the write lock.
      await waitUntil(() => Promise.resolve(!isBlocking), 3000)
      expect(isBlocking).toBe(false)
      // Past the flush wait: disposal gave up waiting; the append is still in flight.
      await waitUntil(
        () => Promise.resolve(isFlushWaitOver),
        RESOURCE_HISTORY_FLUSH_TIMEOUT_MS + 2000,
      )
      expect(isFlushWaitOver).toBe(true)
      expect(isAppendDone).toBe(false)
      // From here, every write-lock refusal is Delete history waiting for the append's lock.
      let refusals = 0
      const realAcquire = NodeUsageFs.prototype.acquireLock
      vi.spyOn(NodeUsageFs.prototype, 'acquireLock').mockImplementation(async function (
        this: NodeUsageFs,
        ...args: Parameters<NodeUsageFs['acquireLock']>
      ) {
        const lock = await realAcquire.apply(this, args)
        if (lock === undefined && args[0].endsWith('/write.lock')) refusals += 1
        return lock
      })
      const deletion = deleteThroughPage(folder)
      let isDeleted = false
      void deletion.done.then(() => {
        isDeleted = true
      })
      await waitUntil(() => Promise.resolve(refusals > 0 || isDeleted), 3000)
      // Delete history is refused the lock the append still holds.
      expect(refusals).toBeGreaterThan(0)
      expect(isDeleted).toBe(false)
      release(undefined)
      await deletion.done
      expect(deletion.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
      // The append landed first, so the delete removed that line too.
      expect(await journalMinuteLines(folder)).toEqual([])
      const history = await resourceHistoryReader(folder).read()
      expect(history.minutes).toEqual([])
    },
  )
})
