// RVM107W2G P2-2: a disposed window's append that outlives the 2 s flush wait
// can never survive a Delete history. Its own file because, as in production,
// the window host is configured and disposed once per process.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitResource } from '../../src/core/resources/admission'
import { resourceHistoryReader } from '../../src/runtime/resources/history'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
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
  it('keeps a disposed window append that outlives the 2 s flush wait from surviving a delete', async () => {
    const folder = await temporary()
    const { promise: blocked, resolve: release } = Promise.withResolvers<undefined>()
    let isBlocking = true
    const realAppend = NodeUsageFs.prototype.append
    vi.spyOn(NodeUsageFs.prototype, 'append').mockImplementation(async function (
      this: NodeUsageFs,
      relative,
      line,
      isDurable,
    ) {
      if (isBlocking && relative.endsWith('.jsonl')) {
        isBlocking = false
        await blocked
      }
      await realAppend.call(this, relative, line, isDurable)
    })
    const dispose = configureWindowHistory(folder)
    const lease = await admitResource('other', undefined, 'foreground')
    lease?.complete(true)
    await waitUntil(async () => {
      const live = await liveFiles(folder)
      return live.length > 0
    }, 3000)
    dispose()
    // The disposal flush is now blocked inside its append.
    await waitUntil(() => Promise.resolve(!isBlocking), 3000)
    expect(isBlocking).toBe(false)
    const deletion = deleteThroughPage(folder)
    await new Promise((resolve) => setTimeout(resolve, 300))
    release(undefined)
    await deletion.done
    expect(deletion.posted).toContainEqual(expect.objectContaining({ outcome: 'completed' }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    // The delete waited for the append's lock, so it removed that line too.
    expect(await journalMinuteLines(folder)).toEqual([])
    const history = await resourceHistoryReader(folder).read()
    expect(history.minutes).toEqual([])
  })
})
