import type { ScheduledPrompt } from '../../shared/schedule'
import * as z from 'zod/mini'
import { scheduleV2Schema } from '../../shared/scheduleV2'

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
