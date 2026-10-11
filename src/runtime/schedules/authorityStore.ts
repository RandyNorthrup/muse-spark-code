import * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import {
  scheduleGrantAuditSchema,
  scheduleV2Schema,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import type { ScheduleAuthorityStore, ScheduleGrantAudit } from '../../core/schedules/grantAudit'
import type { ScheduleStoreV2 } from '../../shared/scheduleV2'

const keyOf = (workspace: string, id: string) => JSON.stringify([workspace, id])

const auditFileSchema = z.record(z.string(), z.array(scheduleGrantAuditSchema))

/** File-backed grant audits beside the schedule store; authority ops stay on the store. */
export function createAuthorityStore(
  store: ScheduleStoreV2,
  fs: ScheduleFsPort,
  file: string,
): ScheduleAuthorityStore {
  const generations = new Map<string, number>()
  const observed = new Map<string, string>()

  const invalidate = (key: string) => generations.set(key, (generations.get(key) ?? 0) + 1)
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
    await fs.lock(file, async (guard) => {
      const current = await readAudits()
      const entries = [...(current[entry.scheduleId] ?? []), entry]
      await fs.replace(file, JSON.stringify({ ...current, [entry.scheduleId]: entries }), guard)
    })
  }
  return {
    generation: (workspace, id) =>
      (generations.get(keyOf(workspace, id)) ?? 0) +
      (store.authorityGeneration?.(workspace, id) ?? 0),
    async read(workspaceKey: string, scheduleId: string): Promise<ScheduleV2 | undefined> {
      const schedules = await store.list(workspaceKey)
      const schedule = schedules.find((schedule) => schedule.id === scheduleId)
      const key = keyOf(workspaceKey, scheduleId)
      const fingerprint = JSON.stringify(
        schedule === undefined
          ? null
          : [schedule.paused, schedule.mode, schedule.grant, schedule.paidConsent, schedule.target],
      )
      if (observed.has(key) && observed.get(key) !== fingerprint) invalidate(key)
      observed.set(key, fingerprint)
      return schedule
    },
    async commit(next: ScheduleV2, audit: ScheduleGrantAudit): Promise<boolean> {
      const schedule = scheduleV2Schema.parse(next)
      invalidate(keyOf(schedule.workspaceKey, schedule.id))
      observed.delete(keyOf(schedule.workspaceKey, schedule.id))
      if (audit.kind === 'created') {
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
