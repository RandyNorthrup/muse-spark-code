import { scheduleTimeRunId, scheduleV1ToV2, type ScheduleStoreV2 } from '../../shared/scheduleV2'
import type { ScheduledPrompt } from '../../shared/schedule'

export interface ScheduleMigrationEntry {
  readonly job: ScheduledPrompt
  readonly occurrences: readonly number[]
  /** Source-private identity used to verify its bytes before removal. */
  readonly fingerprint: string
}
export interface ScheduleMigrationSource {
  /** Seals v1 admission before returning a recovered, validated snapshot. */
  freeze(): Promise<readonly ScheduleMigrationEntry[]>
  /** Must refuse unless the original job and receipt bytes still match. */
  removeVerified(entry: ScheduleMigrationEntry): Promise<void>
}

export async function migrateSchedules(
  source: ScheduleMigrationSource,
  store: ScheduleStoreV2,
  workspaceKey: string,
  zone: string,
): Promise<number> {
  let migrated = 0
  const entries = await source.freeze()
  for (const entry of entries) {
    const mapped = scheduleV1ToV2(entry.job, workspaceKey, zone)
    const before = await store.list(workspaceKey)
    const existing = before.find((job) => job.id === mapped.id)
    if (existing === undefined) await store.create(mapped)
    // Burn every old receipt, even a corrupt/empty crashed receipt and even
    // occurrences older than the outstanding one. Neither claim is rolled back.
    for (const occurrence of entry.occurrences)
      await store.claim(scheduleTimeRunId(mapped.id, occurrence))
    const after = await store.list(workspaceKey)
    const reopened = after.find((job) => job.id === mapped.id)
    if (JSON.stringify(reopened) !== JSON.stringify(mapped))
      throw new Error('scheduleMigrationVerificationFailed')
    await source.removeVerified(entry)
    migrated += 1
  }
  return migrated
}
