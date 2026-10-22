import {
  scheduleTimeRunId,
  scheduleV1ToV2,
  type ScheduleCallOptions,
  type ScheduleStoreV2,
} from '../../shared/scheduleV2'
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
export interface CompletedScheduleMigration {
  schedule: z.infer<typeof scheduleV2Schema>
  receipt: MigrationReceipt
}
export interface ScheduleMigrationJournalPort {
  migrationReceipt(
    workspaceKey: string,
    sourceId: string,
    options?: ScheduleCallOptions,
  ): Promise<MigrationReceipt | undefined>
  saveMigrationReceipt(
    workspaceKey: string,
    receipt: MigrationReceipt,
    options?: ScheduleCallOptions,
  ): Promise<void>
  /**
  Completes the migration and returns the completion-time snapshot, so the
  caller verifies without a second journal read. A missing receipt or
  schedule completes idempotently to undefined.
  */
  completeMigration(
    workspaceKey: string,
    sourceId: string,
    options?: ScheduleCallOptions,
  ): Promise<CompletedScheduleMigration | undefined>
  reconcileMigration(
    workspaceKey: string,
    next: z.infer<typeof scheduleV2Schema>,
    receipt: MigrationReceipt,
    expectedSourceFingerprint: string,
    options?: ScheduleCallOptions,
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
  options?: ScheduleCallOptions,
): Promise<void> {
  for (;;) {
    const receipt = await store.migrationReceipt(workspaceKey, sourceId, options)
    if (receipt?.targetId !== mapped.id) throw new Error('scheduleMigrationVerificationFailed')
    if (receipt.sourceFingerprint === entry.fingerprint) return
    if (receipt.sourceJobFingerprint !== (entry.jobFingerprint ?? hash(entry.job)))
      throw new Error('scheduleMigrationSourceChanged')
    const jobs = await store.list(workspaceKey, options)
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
        options,
      )
    )
      return
  }
}

/** M52's v1 jobs migrate into the shared v2 store, verified then removed. */
export async function migrateSchedules(
  source: ScheduleMigrationSource,
  store: ScheduleStoreV2 & ScheduleMigrationJournalPort,
  workspaceKey: string,
  zone: string,
  options?: ScheduleCallOptions,
): Promise<number> {
  let migrated = 0
  const entries = await source.freeze()
  const failed: unknown[] = []
  // Every entry is attempted; each entry's failure is recorded for the
  // final throw below, so no entry hides another's migration failure.
  const failures = {
    list: failed,
    record(error: unknown): void {
      failed.push(error)
    },
  }
  for (const entry of entries) {
    try {
      const mapped = scheduleV1ToV2(entry.job, workspaceKey, zone)
      const sourceId = `${source.id ?? workspaceKey}:${entry.job.id}`
      const receipt = await store.migrationReceipt(workspaceKey, sourceId, options)
      const before = await store.list(workspaceKey, options)
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
        await store.saveMigrationReceipt(
          workspaceKey,
          {
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
          },
          options,
        )
        await store.create(mapped, options)
      } else if (receipt === undefined) {
        // A matching unedited copy from the old migration can be adopted. An
        // unrelated or edited destination needs its own durable provenance.
        if (JSON.stringify(existing) !== JSON.stringify(mapped))
          throw new Error('scheduleMigrationVerificationFailed')
        await store.saveMigrationReceipt(
          workspaceKey,
          {
            sourceId,
            sourceFingerprint: entry.fingerprint,
            sourceJobFingerprint: entry.jobFingerprint ?? hash(entry.job),
            targetId: mapped.id,
            targetRevision: existing.revision,
            targetHash: hash(existing),
            copiedFireCount: mapped.fireCount,
            ...(mapped.nextFireAtMs !== undefined && { copiedNextFireAtMs: mapped.nextFireAtMs }),
          },
          options,
        )
      } else if (receipt.sourceFingerprint !== entry.fingerprint) {
        if (receipt.sourceJobFingerprint !== (entry.jobFingerprint ?? hash(entry.job)))
          throw new Error('scheduleMigrationSourceChanged')
        // Only receipt-derived accounting/cadence is reconciled. Never restore
        // the mapped name, grants, consent, pause, target or user-edited trigger.
        await reconcileCopiedSchedule(store, workspaceKey, sourceId, entry, mapped, options)
      }
      // Burn every old receipt, even a corrupt/empty crashed receipt and even
      // occurrences older than the outstanding one. Neither claim is rolled back.
      for (const occurrence of entry.occurrences)
        await store.claim(scheduleTimeRunId(mapped.id, occurrence), options)
      // Completion returns its own snapshot, so verification needs no second
      // journal read and no pending-copy rewrite: one transaction retires the
      // receipt it verified. The snapshot is completion-time state, strictly
      // fresher than a re-read after it.
      const completed = await store.completeMigration(workspaceKey, sourceId, options)
      const reopened = completed?.schedule
      const verified = completed?.receipt
      if (
        verified === undefined ||
        reopened?.id !== verified.targetId ||
        reopened.revision < verified.targetRevision ||
        (reopened.revision === verified.targetRevision && hash(reopened) !== verified.targetHash)
      )
        throw new Error('scheduleMigrationVerificationFailed')
      await source.removeVerified(entry)
      migrated += 1
    } catch (error: unknown) {
      // The stop ends the migration: later entries wait for the next
      // control request instead of migrating behind a close.
      options?.signal?.throwIfAborted()
      failures.record(error)
    }
  }
  if (failures.list.length > 0) throw failures.list[0]
  return migrated
}
