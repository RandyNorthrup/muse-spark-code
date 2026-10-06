import {
  scheduleFireRecordSchema,
  scheduleV2Schema,
  type ScheduleFireRecord,
  type ScheduleStoreV2,
  type ScheduleV2,
} from '../../../../src/shared/scheduleV2'

const key = (workspace: string, id: string) => `${workspace}:${id}`

/** A test disk survives client crashes and restarts; clients never share objects. */
export class FakeScheduleDisk {
  readonly jobs = new Map<string, ScheduleV2>()
  readonly claims = new Set<string>()
  readonly records = new Map<string, ScheduleFireRecord>()
  client(): ScheduleStoreV2 {
    return {
      create: (schedule) => {
        const job = scheduleV2Schema.parse(structuredClone(schedule))
        const id = key(job.workspaceKey, job.id)
        if (this.jobs.has(id)) return Promise.reject(new Error('Schedule already exists'))
        this.jobs.set(id, job)
        return Promise.resolve()
      },
      list: (workspace) =>
        Promise.resolve(
          Array.from(this.jobs.values(), (job) => structuredClone(job)).filter(
            (job) => job.workspaceKey === workspace,
          ),
        ),
      update: (schedule) => {
        const job = scheduleV2Schema.parse(structuredClone(schedule))
        const id = key(job.workspaceKey, job.id)
        if (!this.jobs.has(id)) return Promise.resolve(false)
        this.jobs.set(id, job)
        return Promise.resolve(true)
      },
      remove: (workspace, id) => Promise.resolve(this.jobs.delete(key(workspace, id))),
      claim: (runId) => {
        if (this.claims.has(runId)) return Promise.resolve(false)
        this.claims.add(runId)
        return Promise.resolve(true)
      },
      record: (record) => {
        const fire = scheduleFireRecordSchema.parse(structuredClone(record))
        this.records.set(fire.runId, fire)
        return Promise.resolve()
      },
      fires: (workspace) =>
        Promise.resolve(
          Array.from(this.records.values(), (fire) => structuredClone(fire)).filter(
            (fire) => fire.workspaceKey === workspace,
          ),
        ),
    }
  }
}
