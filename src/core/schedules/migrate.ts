import { scheduleTimeRunId, scheduleV1ToV2, type ScheduleStoreV2 } from '../../shared/scheduleV2'
import type { ScheduledPrompt } from '../../shared/schedule'
import * as z from 'zod/mini'
import { scheduleV2Schema } from '../../shared/scheduleV2'
import { createHash } from 'node:crypto'

export const scheduleMigrationReceiptSchema = z.strictObject({
  sourceId: z.string(),
  sourceFingerprint: z.string(),
  sourceJobFingerprint: z.string(),
  targetId: scheduleV2Schema.shape.id,
  targetRevision: scheduleV2Schema.shape.revision,
  targetHash: z.string(),
  copiedFireCount: z.int().check(z.gte(0)),
  copiedNextFireAtMs: z.optional(z.int().check(z.gte(0))),
  pendingCopy: z.optional(z.boolean()),
  pendingCopyHash: z.optional(z.string()),
})
type MigrationReceipt = z.infer<typeof scheduleMigrationReceiptSchema>
export interface ScheduleMigrationJournalPort {
  migrationReceipt(workspaceKey: string, sourceId: string): Promise<MigrationReceipt | undefined>
  saveMigrationReceipt(workspaceKey: string, receipt: MigrationReceipt): Promise<void>
  completeMigration(workspaceKey: string, sourceId: string): Promise<void>
  reconcileMigration(
    workspaceKey: string,
    next: z.infer<typeof scheduleV2Schema>,
    receipt: MigrationReceipt,
    expectedSourceFingerprint: string,
  ): Promise<boolean>
}
function hash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export interface ScheduleMigrationEntry {
  readonly job: ScheduledPrompt
  readonly occurrences: readonly number[]
  /** Source-private identity used to verify its bytes before removal. */
  readonly fingerprint: string
  /** Stable original job bytes, distinct from racing receipt bytes. */
  readonly jobFingerprint?: string
}
export interface ScheduleMigrationSource {
  /** Stable source namespace; the host factory hashes its storage directory. */
  readonly id?: string
  /** Seals v1 admission before returning a recovered, validated snapshot. */
  freeze(): Promise<readonly ScheduleMigrationEntry[]>
  /** Must refuse unless the original job and receipt bytes still match. */
  removeVerified(entry: ScheduleMigrationEntry): Promise<void>
}

async function reconcileCopiedSchedule(
  store: ScheduleStoreV2 & ScheduleMigrationJournalPort,
  workspaceKey: string,
  sourceId: string,
  entry: ScheduleMigrationEntry,
  mapped: z.infer<typeof scheduleV2Schema>,
): Promise<void> {
  for (;;) {
    const receipt = await store.migrationReceipt(workspaceKey, sourceId)
    if (receipt?.targetId !== mapped.id) throw new Error('scheduleMigrationVerificationFailed')
    if (receipt.sourceFingerprint === entry.fingerprint) return
    if (receipt.sourceJobFingerprint !== (entry.jobFingerprint ?? hash(entry.job)))
      throw new Error('scheduleMigrationSourceChanged')
    const jobs = await store.list(workspaceKey)
    const current = jobs.find((job) => job.id === mapped.id)
    if (current === undefined) throw new Error('scheduleMigrationVerificationFailed')
    const delta = Math.max(0, mapped.fireCount - receipt.copiedFireCount)
    const isFollowingCadence =
      current.nextFireAtMs === receipt.copiedNextFireAtMs &&
      current.trigger.kind === 'interval' &&
      current.trigger.anchorMs === receipt.copiedNextFireAtMs
    const next = scheduleV2Schema.parse({
      ...current,
      fireCount: current.fireCount + delta,
      ...(mapped.lastFireAtMs !== undefined && {
        lastFireAtMs: Math.max(current.lastFireAtMs ?? 0, mapped.lastFireAtMs),
      }),
      ...(isFollowingCadence && { trigger: mapped.trigger, nextFireAtMs: mapped.nextFireAtMs }),
    })
    const updated = scheduleV2Schema.parse({ ...next, revision: next.revision + 1 })
    if (
      await store.reconcileMigration(
        workspaceKey,
        next,
        {
          ...receipt,
          sourceFingerprint: entry.fingerprint,
          targetRevision: updated.revision,
          targetHash: hash(updated),
          copiedFireCount: mapped.fireCount,
          ...(mapped.nextFireAtMs !== undefined && { copiedNextFireAtMs: mapped.nextFireAtMs }),
        },
        receipt.sourceFingerprint,
      )
    )
      return
  }
}

export async function migrateSchedules(
  source: ScheduleMigrationSource,
  store: ScheduleStoreV2 & ScheduleMigrationJournalPort,
  workspaceKey: string,
  zone: string,
): Promise<number> {
  let migrated = 0
  const entries = await source.freeze()
  const failures: unknown[] = []
  for (const entry of entries) {
    try {
      const mapped = scheduleV1ToV2(entry.job, workspaceKey, zone)
      const sourceId = `${source.id ?? workspaceKey}:${entry.job.id}`
      const receipt = await store.migrationReceipt(workspaceKey, sourceId)
      const before = await store.list(workspaceKey)
      const existing = before.find((job) => job.id === mapped.id)
      if (existing === undefined) {
        if (
          receipt !== undefined &&
          (receipt.targetRevision !== 0 ||
            receipt.targetId !== mapped.id ||
            receipt.sourceJobFingerprint !== (entry.jobFingerprint ?? hash(entry.job)))
        )
          throw new Error('scheduleMigrationVerificationFailed')
        // Receipt precedes copy, so a crash after create can recognize its own
        // destination even when the person edits it before migration restarts.
        await store.saveMigrationReceipt(workspaceKey, {
          sourceId,
          sourceFingerprint: entry.fingerprint,
          sourceJobFingerprint: entry.jobFingerprint ?? hash(entry.job),
          targetId: mapped.id,
          targetRevision: mapped.revision,
          targetHash: hash(mapped),
          copiedFireCount: mapped.fireCount,
          pendingCopy: true,
          pendingCopyHash: receipt?.pendingCopyHash ?? receipt?.targetHash ?? hash(mapped),
          ...(mapped.nextFireAtMs !== undefined && { copiedNextFireAtMs: mapped.nextFireAtMs }),
        })
        await store.create(mapped)
      } else if (receipt === undefined) {
        // A matching unedited copy from the old migration can be adopted. An
        // unrelated or edited destination needs its own durable provenance.
        if (JSON.stringify(existing) !== JSON.stringify(mapped))
          throw new Error('scheduleMigrationVerificationFailed')
        await store.saveMigrationReceipt(workspaceKey, {
          sourceId,
          sourceFingerprint: entry.fingerprint,
          sourceJobFingerprint: entry.jobFingerprint ?? hash(entry.job),
          targetId: mapped.id,
          targetRevision: existing.revision,
          targetHash: hash(existing),
          copiedFireCount: mapped.fireCount,
          ...(mapped.nextFireAtMs !== undefined && { copiedNextFireAtMs: mapped.nextFireAtMs }),
        })
      } else if (receipt.sourceFingerprint !== entry.fingerprint) {
        if (receipt.sourceJobFingerprint !== (entry.jobFingerprint ?? hash(entry.job)))
          throw new Error('scheduleMigrationSourceChanged')
        // Only receipt-derived accounting/cadence is reconciled. Never restore
        // the mapped name, grants, consent, pause, target or user-edited trigger.
        await reconcileCopiedSchedule(store, workspaceKey, sourceId, entry, mapped)
      }
      // Burn every old receipt, even a corrupt/empty crashed receipt and even
      // occurrences older than the outstanding one. Neither claim is rolled back.
      for (const occurrence of entry.occurrences)
        await store.claim(scheduleTimeRunId(mapped.id, occurrence))
      const after = await store.list(workspaceKey)
      const reopened = after.find((job) => job.id === mapped.id)
      const verified = await store.migrationReceipt(workspaceKey, sourceId)
      if (
        verified === undefined ||
        reopened?.id !== verified.targetId ||
        reopened.revision < verified.targetRevision ||
        (reopened.revision === verified.targetRevision && hash(reopened) !== verified.targetHash)
      )
        throw new Error('scheduleMigrationVerificationFailed')
      if (verified.pendingCopy)
        await store.saveMigrationReceipt(workspaceKey, { ...verified, pendingCopy: false })
      await source.removeVerified(entry)
      await store.completeMigration(workspaceKey, sourceId)
      migrated += 1
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw failures[0]
  return migrated
}
