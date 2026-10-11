import * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import {
  scheduleGrantAuditSchema,
  scheduleV2Schema,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import type { ScheduleAuthorityStore, ScheduleGrantAudit } from '../../core/schedules/grantAudit'
import type { ScheduleStoreV2 } from '../../shared/scheduleV2'

const auditFileSchema = z.record(z.string(), z.array(scheduleGrantAuditSchema))

/** File-backed grant audits beside the schedule store; authority ops stay on the store. */
export function createAuthorityStore(
  store: ScheduleStoreV2,
  fs: ScheduleFsPort,
  file: string,
): ScheduleAuthorityStore {
  const readAudits = async (): Promise<z.infer<typeof auditFileSchema>> => {
    const raw = await fs.read(file)
    if (raw === undefined) return {}
    try {
      return auditFileSchema.parse(JSON.parse(raw))
    } catch {
      throw new Error('scheduleStoredJsonInvalid')
    }
  }
  const append = async (audit: ScheduleGrantAudit): Promise<void> => {
    const entry = scheduleGrantAuditSchema.parse(audit)
    const current = await readAudits()
    const entries = [...(current[entry.scheduleId] ?? []), entry]
    await fs.replace(file, JSON.stringify({ ...current, [entry.scheduleId]: entries }))
  }
  return {
    async read(workspaceKey: string, scheduleId: string): Promise<ScheduleV2 | undefined> {
      const schedules = await store.list(workspaceKey)
      return schedules.find((schedule) => schedule.id === scheduleId)
    },
    async commit(next: ScheduleV2, audit: ScheduleGrantAudit): Promise<boolean> {
      const schedule = scheduleV2Schema.parse(next)
      if (schedule.revision === 0) {
        try {
          await store.create(schedule)
        } catch (error: unknown) {
          if (error instanceof Error && error.message === 'scheduleIdentifierAlreadyIssued')
            return false
          throw error
        }
      } else if (!(await store.update(schedule))) return false
      await append(audit)
      return true
    },
    append,
    async audit(_workspaceKey: string, scheduleId: string): Promise<readonly ScheduleGrantAudit[]> {
      const current = await readAudits()
      return current[scheduleId] ?? []
    },
  }
}
