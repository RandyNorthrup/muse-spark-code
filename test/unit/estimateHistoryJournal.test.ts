// The estimate calibration history: a missing journal lists as empty, a
// damaged record is skipped with its fixed code (never silently pruned),
// and a conflicting append refuses with its cause.
import { readdir, writeFile } from 'node:fs/promises'
import { usingTempDir } from './helpers/temporaryFolders'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EstimateHistoryJournal } from '../../src/core/estimator/calibration/journal'
import { canonicalRecord } from '../../src/core/estimator/calibration/records'
import type { HistoryRecord } from '../../src/shared/estimate'

function record(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    laneId: 'lane-1',
    kind: 'build',
    machineClassId: 'class-a',
    estimatedHours: 2,
    actualHours: 1,
    review: { status: 'unknown' },
    startedAt: '2026-10-01T00:00:00Z',
    finishedAt: '2026-10-01T01:00:00Z',
    durationBasis: 'agentTime',
    source: 'git',
    ...overrides,
  }
}

describe('estimate calibration history', () => {
  it('lists a missing journal as empty', async () => {
    await usingTempDir('muse-estimate-history-', async (root) => {
      const journal = new EstimateHistoryJournal(path.join(root, 'history'))
      expect(await journal.list()).toEqual([])
      expect(journal.skippedRecords).toEqual([])
    })
  })

  it('keeps an appended record across a list', async () => {
    await usingTempDir('muse-estimate-history-', async (root) => {
      const journal = new EstimateHistoryJournal(path.join(root, 'history'))
      await journal.append(record())
      expect(await journal.list()).toEqual([canonicalRecord(record())])
      expect(journal.skippedRecords).toEqual([])
    })
  })

  it('skips a record from an unknown envelope version with its code, never throwing', async () => {
    await usingTempDir('muse-estimate-history-', async (root) => {
      const journal = new EstimateHistoryJournal(path.join(root, 'history'))
      await journal.append(record())
      await writeFile(
        path.join(root, 'history', 'bogus.json'),
        JSON.stringify({ version: 999, durationBasis: 'agentTime', record: record() }),
        'utf8',
      )
      expect(await journal.list()).toEqual([canonicalRecord(record())])
      expect(journal.skippedRecords).toHaveLength(1)
      expect(journal.skippedRecords[0]?.code).toBe('unknownHistoryVersion')
    })
  })

  it('replays the same record without failing', async () => {
    await usingTempDir('muse-estimate-history-', async (root) => {
      const journal = new EstimateHistoryJournal(path.join(root, 'history'))
      await journal.append(record())
      await journal.append(record())
      expect(await journal.list()).toEqual([canonicalRecord(record())])
    })
  })

  it('refuses a conflicting record with its cause', async () => {
    await usingTempDir('muse-estimate-history-', async (root) => {
      const journal = new EstimateHistoryJournal(path.join(root, 'history'))
      await journal.append(record())
      let failure: unknown
      try {
        await journal.append(record({ kind: 'test' }))
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toContain('conflictingHistory')
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
      expect(await readdir(path.join(root, 'history'))).toHaveLength(2)
    })
  })
})
