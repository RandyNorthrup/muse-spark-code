import type * as z from 'zod/mini'
import {
  scheduleGrantAuditSchema,
  scheduleGrantSchema,
  scheduleV2Schema,
  type ScheduleGrant,
  type ScheduleV2,
} from '../../shared/scheduleV2'

export type ScheduleGrantAudit = z.infer<typeof scheduleGrantAuditSchema>

/** S binds one durable transaction: a stale edit must change neither authority nor audit. */
export interface ScheduleAuthorityStore {
  read(workspaceKey: string, scheduleId: string): Promise<ScheduleV2 | undefined>
  /** `created` admits an absent id at revision zero; other mutations use CAS. */
  commit(next: ScheduleV2, audit: ScheduleGrantAudit): Promise<boolean>
  append(audit: ScheduleGrantAudit): Promise<void>
  audit(workspaceKey: string, scheduleId: string): Promise<readonly ScheduleGrantAudit[]>
}

/** Shared editor model; callers supply the displayed revision when changing authority. */
export class ScheduleGrantEditor {
  public constructor(
    private readonly store: ScheduleAuthorityStore,
    private readonly now: () => number,
  ) {}

  public async create(schedule: ScheduleV2): Promise<boolean> {
    const next = scheduleV2Schema.parse(schedule)
    if (next.revision !== 0) return false
    return await this.store.commit(
      next,
      scheduleGrantAuditSchema.parse({
        scheduleId: next.id,
        atMs: this.now(),
        kind: 'created',
      }),
    )
  }

  public async change(
    workspaceKey: string,
    id: string,
    revision: number,
    grant: ScheduleGrant,
  ): Promise<boolean> {
    const current = await this.store.read(workspaceKey, id)
    if (current?.revision !== revision) return false
    const next = scheduleV2Schema.parse({
      ...current,
      grant: scheduleGrantSchema.parse(grant),
      paidCapUsd: Math.min(current.paidCapUsd, grant.paidCapUsd),
      paidConsent: undefined,
      updatedAtMs: this.now(),
    })
    return await this.store.commit(
      next,
      scheduleGrantAuditSchema.parse({
        scheduleId: id,
        atMs: next.updatedAtMs,
        kind: 'changed',
      }),
    )
  }

  public async revoke(workspaceKey: string, id: string): Promise<boolean> {
    // Retry only this mutation, from fresh authority; never replay a stale snapshot.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.store.read(workspaceKey, id)
      if (current === undefined) return false
      const next = scheduleV2Schema.parse({
        ...current,
        grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
        paidCapUsd: 0,
        paidConsent: undefined,
        updatedAtMs: this.now(),
      })
      if (
        await this.store.commit(
          next,
          scheduleGrantAuditSchema.parse({
            scheduleId: id,
            atMs: next.updatedAtMs,
            kind: 'revoked',
          }),
        )
      )
        return true
    }
    return false
  }

  public async audit(workspaceKey: string, id: string): Promise<readonly ScheduleGrantAudit[]> {
    const entries = await this.store.audit(workspaceKey, id)
    return entries.map((entry) => scheduleGrantAuditSchema.parse(entry))
  }
}
