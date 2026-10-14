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
