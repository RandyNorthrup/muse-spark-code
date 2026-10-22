// RLWINFIX item 2: a failing retention names its cause. The real journal
// runs here on the real filesystem with a file blocking its folder, so
// retention fails for real: the retention callback must receive the
// failure, not an empty alarm.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ResourceJournal } from '../../src/core/usage/resourceJournal'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import type { ResourceRecord } from '../../src/shared/resources'
import { removeFolder } from './helpers/temporaryFolders'

describe('resource retention failure', () => {
  it('hands the failure to the retention callback', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'muse-retain-cause-'))
    try {
      await mkdir(path.join(dataFolder, 'usage', 'v1'), { recursive: true })
      await writeFile(path.join(dataFolder, 'usage', 'v1', 'resources'), 'blocking file', 'utf8')
      const received: unknown[] = []
      const journal = new ResourceJournal(new NodeUsageFs(dataFolder), {
        writerId: 'probe-writer',
        now: () => Date.now(),
        isEnabled: () => true,
        historyDays: () => null,
        resetAtMs: () => -1,
        onRetentionError: (error: unknown) => {
          received.push(error)
        },
      })
      const record: ResourceRecord = {
        type: 'resource',
        atMs: Date.now(),
        event: null,
        minute: {
          cpuPercent: 12.5,
          memoryUsedPercent: 81,
          availableMemory: 'ample',
          gpuPercent: null,
          diskBusyPercent: null,
          level: 'normal',
          thresholds: { cpuMaxPercent: null, memoryMaxPercent: null, memoryMinFreeGiB: null },
        },
        work: [],
      }
      await expect(journal.append(record)).rejects.toThrow()
      expect(received).toHaveLength(1)
      expect(received[0]).toBeInstanceOf(Error)
    } finally {
      await removeFolder(dataFolder)
    }
  })
})
