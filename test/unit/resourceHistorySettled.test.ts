// POSTSPAWN item 4: Windows contained and probe launches are attested, never
// tree-sampled, so their job's final accounting is the window history's only
// record of them. Its own file: the window governor host is process-wide.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  flushResourceHistory,
  resourceGovernorHost,
} from '../../src/core/resources/resourceGovernorEntry'
import { resourceHistoryReader } from '../../src/runtime/resources/history'
import { RESOURCE_GIB_BYTES, RESOURCE_SETTLED_ROWS_MAX } from '../../src/shared/constants'
import { temporaryFolders, windowHistorySettings } from './helpers/resources/journalFixtures'

// Every governor sample reads the history work source. A scripted machine
// reading keeps that independent of this host's OS probes (a failed probe
// is a null sample, which records no minute at all).
vi.mock('../../src/core/resources/sampler/system', () => ({
  createMachineResourceSampler: () => ({
    sample: () =>
      Promise.resolve({
        atMs: Date.now(),
        cpuPercent: 10,
        memoryUsedPercent: 20,
        memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
        memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
        gpuPercent: null,
        diskBusyPercent: null,
        pressure: null,
      }),
  }),
}))

const folders = temporaryFolders('postspawn-settled')
const hosts: { dispose(): void }[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose()
  await folders.cleanup()
})

async function windowHost() {
  const folder = await folders.create()
  const host = resourceGovernorHost(windowHistorySettings(folder))
  hosts.push(host)
  return { folder, host }
}

const settlement = (pid: number) => ({
  root: { pid, startTime: `${String(pid)}00` },
  scope: `attested-${String(pid)}`,
  usage: { cpuSeconds: 2, residentBytes: 4096 },
})

describe('POSTSPAWN: attested launches in the window history', () => {
  it('records an attested launch in history exactly once, beside sampled trees', async () => {
    const { folder, host } = await windowHost()
    const lease = await host.admit('other', undefined, 'foreground')
    lease.settle?.(settlement(4242))
    lease.complete(true)
    const recorded = async () => {
      // The recorder skips a reading while its previous one is still being written.
      await host.refreshStatus()
      await flushResourceHistory()
      const history = await resourceHistoryReader(folder).read()
      return history.work.filter((row) => row.kind === 'other')
    }
    const once = [{ kind: 'other', cpuSeconds: 2, peakMemoryBytes: 4096 }]
    await vi.waitFor(async () => {
      expect(await recorded()).toEqual(once)
    })
    // The read drained the row: later readings neither repeat nor keep it.
    expect(host.settled()).toEqual({ rows: [], dropped: 0 })
    expect(await recorded()).toEqual(once)
    expect(await recorded()).toEqual(once)
  })

  it('keeps at most RESOURCE_SETTLED_ROWS_MAX attested rows between reads', async () => {
    const { host } = await windowHost()
    const lease = await host.admit('other', undefined, 'foreground')
    const extra = 7
    for (let index = 1; index <= RESOURCE_SETTLED_ROWS_MAX + extra; index++)
      lease.settle?.(settlement(index))
    lease.complete(true)
    const read = host.settled()
    expect(read.rows).toHaveLength(RESOURCE_SETTLED_ROWS_MAX)
    expect(read.dropped).toBe(extra)
    // Oldest first out: the newest rows are the ones kept.
    expect(read.rows.at(-1)?.ticket.root.pid).toBe(RESOURCE_SETTLED_ROWS_MAX + extra)
    expect(host.settled()).toEqual({ rows: [], dropped: 0 })
  })
})
