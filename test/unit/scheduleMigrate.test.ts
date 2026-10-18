// D119 catch burn-down: every entry is attempted and each entry's
// failure is recorded for the final throw. The store fails for real
// below: the first entry's create rejects, the second still migrates,
// and the first failure is what the caller gets.
import { describe, expect, it } from 'vitest'
import { quietStoreBase } from './helpers/scheduleFixtures'
import type { ScheduledPrompt } from '../../src/shared/schedule'
import type { ScheduleV2 } from '../../src/shared/scheduleV2'
import {
  migrateSchedules,
  type ScheduleMigrationEntry,
  type ScheduleMigrationJournalPort,
  type ScheduleMigrationSource,
} from '../../src/core/schedules/migrate'

function job(id: string): ScheduledPrompt {
  return {
    id,
    sessionId: 'session-1',
    workspaceRoot: '/workspace',
    accountId: 'account-1',
    prompt: 'Check the build',
    cadence: { kind: 'interval', everyMs: 3_600_000 },
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_800_000_000_000,
    nextFireAtMs: 1_700_000_060_000,
    fireCount: 0,
  }
}

function entry(id: string): ScheduleMigrationEntry {
  return { job: job(id), occurrences: [], fingerprint: `fingerprint-${id}` }
}

describe('schedule migration failures', () => {
  it('migrates later entries and throws the first failure', async () => {
    const failure = new Error('destination store unavailable')
    const created: ScheduleV2[] = []
    const receipts = new Map<
      string,
      Parameters<ScheduleMigrationJournalPort['saveMigrationReceipt']>[1]
    >()
    const removed: ScheduleMigrationEntry[] = []
    const source: ScheduleMigrationSource = {
      id: 'v1',
      freeze: () => Promise.resolve([entry('job-1'), entry('job-2')]),
      removeVerified: (migrated) => {
        removed.push(migrated)
        return Promise.resolve()
      },
    }
    const store = {
      create: (schedule: ScheduleV2) => {
        if (schedule.id === 'job-1') return Promise.reject(failure)
        created.push(schedule)
        return Promise.resolve()
      },
      list: () => Promise.resolve([...created]),
      ...quietStoreBase(),
      migrationReceipt: (_workspaceKey: string, sourceId: string) =>
        Promise.resolve(receipts.get(sourceId)),
      saveMigrationReceipt: (
        _workspaceKey: string,
        receipt: Parameters<ScheduleMigrationJournalPort['saveMigrationReceipt']>[1],
      ) => {
        receipts.set(receipt.sourceId, receipt)
        return Promise.resolve()
      },
      completeMigration: () => Promise.resolve(undefined),
      reconcileMigration: () => Promise.resolve(true),
    }
    await expect(migrateSchedules(source, store, 'workspace-1', 'UTC')).rejects.toBe(failure)
    expect(created.some((schedule) => schedule.id === 'job-2')).toBe(true)
    expect(removed.map((item) => item.job.id)).toEqual(['job-2'])
  })
})
