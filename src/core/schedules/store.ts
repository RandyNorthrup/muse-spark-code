// D95.9: immutable index revisions are an atomic CAS journal. Exclusive
// publication of revision N+1 is the linearization point, including removal.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  SCHEDULE_MAX_PER_WORKSPACE,
  SCHEDULE_ID_MAX_CHARS,
  SCHEDULE_PAUSE_AFTER_FAILURES,
} from '../../shared/constants'
import {
  scheduleFireRecordSchema,
  scheduleV2Schema,
  type ScheduleStoreV2,
} from '../../shared/scheduleV2'
import { scheduleEventSchema } from '../../shared/scheduleEvents'

export interface ScheduleFsPort {
  read(file: string): Promise<string | undefined>
  names(directory: string): Promise<readonly string[]>
  /** Complete bytes, flushed before atomic exclusive publication. */
  publish(file: string, content: string): Promise<boolean>
}

export interface ScheduleQueuePort {
  /** The entire creation-ordered target batch, until final settlement. */
  serialize(targetKey: string, work: () => Promise<void>): Promise<void>
}

export function scheduleStorageHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Stored corruption must not quote private prompts/events in an exception. */
function parseScheduleStoredJson(content: string | undefined): unknown {
  try {
    return JSON.parse(content ?? 'null')
  } catch {
    throw new Error('scheduleStoredJsonInvalid')
  }
}

const identifier = z
  .string()
  .check(z.minLength(1), z.maxLength(SCHEDULE_ID_MAX_CHARS), z.regex(/^[\w-][\w.-]*$/))
const envelopeSchema = z.strictObject({ revision: z.int().check(z.gte(0)), value: z.unknown() })
const indexSchema = z.strictObject({
  schedules: z.array(scheduleV2Schema),
  retired: z.array(identifier),
  admitted: z.optional(z.array(scheduleFireRecordSchema.shape.runId)),
  settled: z.optional(z.array(scheduleFireRecordSchema.shape.runId)),
  timeCursors: z.optional(z.record(identifier, z.int().check(z.gte(0)))),
})
const intentSchema = z.strictObject({
  runId: scheduleFireRecordSchema.shape.runId,
  schedule: scheduleV2Schema,
  occurrenceMs: z.int().check(z.gte(0)),
  event: z.optional(scheduleEventSchema),
  advancesTime: z.boolean(),
  nextFireAtMs: z.optional(z.int().check(z.gte(0))),
})
export type ScheduleRunIntent = z.infer<typeof intentSchema>
export interface ScheduleRunJournalPort {
  /** Atomically claim with recovery facts before any delivery or spending. */
  admit(intent: ScheduleRunIntent): Promise<boolean>
  advance(intent: ScheduleRunIntent): Promise<void>
  abandoned(workspaceKey: string): Promise<readonly ScheduleRunIntent[]>
}
const claimSchema = z.strictObject({
  runId: scheduleFireRecordSchema.shape.runId,
  ownerPid: z.int().check(z.gte(1)),
  intent: z.optional(intentSchema),
})

export function isScheduleProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // EPERM and unrecognized failures never authorize stealing live work.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

/** Public for the Node adapter's cross-process delivery queue journal. */
export function createScheduleJournal<T>(
  fs: ScheduleFsPort,
  directory: string,
  parse: (input: unknown) => T,
  initial: T,
) {
  return {
    async read(): Promise<{ revision: number; value: T }> {
      const names = await fs.names(directory)
      const revisions = names.flatMap((name) => {
        const match = /^(\d+)\.json$/.exec(name)
        if (match === null) return []
        const revision = Number(match[1])
        if (!Number.isSafeInteger(revision)) throw new Error('scheduleIndexRevisionInvalid')
        return [revision]
      })
      let revision = -1
      for (const value of revisions) revision = Math.max(revision, value)
      if (revision === -1) return { revision: -1, value: initial }
      const content = await fs.read(`${directory}/${String(revision)}.json`)
      if (content === undefined) throw new Error('scheduleIndexMissing')
      const raw = parseScheduleStoredJson(content)
      const envelope = envelopeSchema.parse(raw)
      if (envelope.revision !== revision) throw new Error('scheduleIndexRevisionMismatch')
      return { revision, value: parse(envelope.value) }
    },
    async replace(revision: number, value: T): Promise<boolean> {
      const next = envelopeSchema.parse({ revision: revision + 1, value: parse(value) })
      return await fs.publish(`${directory}/${String(next.revision)}.json`, JSON.stringify(next))
    },
  }
}

export function createScheduleStore(fs: ScheduleFsPort): ScheduleStoreV2 & ScheduleRunJournalPort {
  const index = (workspaceKey: string) => {
    identifier.parse(workspaceKey)
    return createScheduleJournal(
      fs,
      `${workspaceKey}/index`,
      (raw) => {
        const parsed = indexSchema.parse(raw)
        if (parsed.schedules.some((schedule) => schedule.workspaceKey !== workspaceKey))
          throw new Error('scheduleWorkspaceMismatch')
        return parsed
      },
      { schedules: [], retired: [] },
    )
  }

  const readFires: ScheduleStoreV2['fires'] = async (workspaceKey) => {
    identifier.parse(workspaceKey)
    const directory = `${workspaceKey}/fires`
    const result = []
    const names = await fs.names(directory)
    for (const name of names) {
      if (!/^[\da-f]+\.json$/.test(name)) continue
      const content = await fs.read(`${directory}/${name}`)
      const raw = parseScheduleStoredJson(content)
      const fire = scheduleFireRecordSchema.parse(raw)
      if (fire.workspaceKey !== workspaceKey || name !== `${scheduleStorageHash(fire.runId)}.json`)
        throw new Error('scheduleFireIdentityMismatch')
      result.push(fire)
    }
    return result.toSorted(
      (a, b) => a.occurrenceMs - b.occurrenceMs || a.runId.localeCompare(b.runId),
    )
  }

  return {
    async create(input) {
      const schedule = scheduleV2Schema.parse(input)
      if (schedule.revision !== 0) throw new Error('scheduleCreationRevisionInvalid')
      const journal = index(schedule.workspaceKey)
      const reservation = `identifiers/${scheduleStorageHash(schedule.id)}.json`
      const isNew = await fs.publish(reservation, JSON.stringify(schedule))
      if (!isNew) {
        const content = await fs.read(reservation)
        const raw = parseScheduleStoredJson(content)
        const reserved = scheduleV2Schema.parse(raw)
        // Recover only the exact unpublished creation after a writer crash.
        if (JSON.stringify(reserved) !== JSON.stringify(schedule))
          throw new Error('scheduleIdentifierAlreadyIssued')
      }
      for (;;) {
        const current = await journal.read()
        if (
          current.value.schedules.some((job) => job.id === schedule.id) ||
          current.value.retired.includes(schedule.id)
        )
          throw new Error('scheduleIdentifierAlreadyIssued')
        if (current.value.schedules.length >= SCHEDULE_MAX_PER_WORKSPACE)
          throw new Error('scheduleWorkspaceLimit')
        if (
          await journal.replace(current.revision, {
            ...current.value,
            schedules: [...current.value.schedules, schedule],
          })
        )
          return
      }
    },
    async list(workspaceKey) {
      const current = await index(workspaceKey).read()
      return current.value.schedules.toSorted((a, b) => a.createdAtMs - b.createdAtMs)
    },
    async update(input) {
      const schedule = scheduleV2Schema.parse(input)
      const journal = index(schedule.workspaceKey)
      for (;;) {
        const current = await journal.read()
        const existing = current.value.schedules.find((job) => job.id === schedule.id)
        if (existing?.revision !== schedule.revision) return false
        const next = scheduleV2Schema.parse({ ...schedule, revision: schedule.revision + 1 })
        if (
          await journal.replace(current.revision, {
            ...current.value,
            schedules: current.value.schedules.map((job) => (job.id === schedule.id ? next : job)),
          })
        )
          return true
      }
    },
    async remove(workspaceKey, id) {
      identifier.parse(id)
      const journal = index(workspaceKey)
      for (;;) {
        const current = await journal.read()
        if (current.value.schedules.every((job) => job.id !== id)) return false
        if (
          await journal.replace(current.revision, {
            ...current.value,
            schedules: current.value.schedules.filter((job) => job.id !== id),
            retired: [...current.value.retired, id],
          })
        )
          return true
      }
    },
    async claim(runId) {
      // Reuse the contract's complete run-id bounds without truncating it.
      scheduleFireRecordSchema.shape.runId.parse(runId)
      return await fs.publish(
        `claims/${scheduleStorageHash(runId)}.json`,
        JSON.stringify({ runId, ownerPid: process.pid }),
      )
    },
    async admit(input) {
      const intent = intentSchema.parse(input)
      return await fs.publish(
        `claims/${scheduleStorageHash(intent.runId)}.json`,
        JSON.stringify({
          runId: intent.runId,
          ownerPid: process.pid,
          intent,
        }),
      )
    },
    async advance(input) {
      const intent = intentSchema.parse(input)
      const content = await fs.read(`claims/${scheduleStorageHash(intent.runId)}.json`)
      if (content === undefined) throw new Error('scheduleRunNotClaimed')
      const receipt = claimSchema.parse(parseScheduleStoredJson(content))
      if (JSON.stringify(receipt.intent) !== JSON.stringify(intent))
        throw new Error('scheduleRunIntentMismatch')
      const journal = index(intent.schedule.workspaceKey)
      for (;;) {
        const current = await journal.read()
        if (current.value.admitted?.includes(intent.runId)) return
        const cursorKey = scheduleStorageHash(
          JSON.stringify({
            id: intent.schedule.id,
            trigger: intent.schedule.trigger,
            zone: intent.schedule.zone,
          }),
        )
        const previousTime = current.value.timeCursors?.[cursorKey]
        const schedules = current.value.schedules.map((job) => {
          if (job.id !== intent.schedule.id) return job
          const { nextFireAtMs: _next, ...rest } = job
          const isAdvancesTime =
            intent.advancesTime &&
            JSON.stringify(job.trigger) === JSON.stringify(intent.schedule.trigger) &&
            job.zone === intent.schedule.zone &&
            (previousTime === undefined || previousTime <= intent.occurrenceMs)
          return scheduleV2Schema.parse({
            ...(isAdvancesTime ? rest : job),
            ...(isAdvancesTime &&
              intent.nextFireAtMs !== undefined && { nextFireAtMs: intent.nextFireAtMs }),
            revision: job.revision + 1,
            fireCount: job.fireCount + 1,
            lastFireAtMs: Math.max(job.lastFireAtMs ?? 0, intent.occurrenceMs),
          })
        })
        if (
          await journal.replace(current.revision, {
            ...current.value,
            schedules,
            admitted: [...(current.value.admitted ?? []), intent.runId],
            ...(intent.advancesTime && {
              timeCursors: {
                ...current.value.timeCursors,
                [cursorKey]: Math.max(previousTime ?? 0, intent.occurrenceMs),
              },
            }),
          })
        )
          return
      }
    },
    async abandoned(workspaceKey) {
      identifier.parse(workspaceKey)
      const pending: ScheduleRunIntent[] = []
      const names = await fs.names('claims')
      for (const name of names) {
        if (!/^[\da-f]+\.json$/.test(name)) continue
        const content = await fs.read(`claims/${name}`)
        const raw = parseScheduleStoredJson(content)
        const claim = claimSchema.parse(raw)
        if (
          name !== `${scheduleStorageHash(claim.runId)}.json` ||
          (claim.intent !== undefined && claim.intent.runId !== claim.runId)
        )
          throw new Error('scheduleClaimIdentityMismatch')
        const intent = claim.intent
        if (
          intent?.schedule.workspaceKey !== workspaceKey ||
          isScheduleProcessAlive(claim.ownerPid)
        )
          continue
        const current = await index(workspaceKey).read()
        if (!current.value.settled?.includes(claim.runId)) pending.push(intent)
      }
      return pending
    },
    async record(input) {
      const fire = scheduleFireRecordSchema.parse(input)
      const file = `${fire.workspaceKey}/fires/${scheduleStorageHash(fire.runId)}.json`
      if (!(await fs.publish(file, JSON.stringify(fire)))) {
        const content = await fs.read(file)
        const raw = parseScheduleStoredJson(content)
        const previous = scheduleFireRecordSchema.parse(raw)
        if (JSON.stringify(previous) !== JSON.stringify(fire))
          throw new Error('scheduleSettlementConflict')
      }
      const journal = index(fire.workspaceKey)
      for (;;) {
        const current = await journal.read()
        if (current.value.settled?.includes(fire.runId)) return
        const history = await readFires(fire.workspaceKey)
        const admitted = current.value.admitted ?? []
        const ordered = history
          .filter((entry) => entry.scheduleId === fire.scheduleId)
          .toSorted((a, b) => {
            const before = admitted.indexOf(a.runId)
            const after = admitted.indexOf(b.runId)
            // Admission order survives wall-clock rollback and late settlement.
            return before !== -1 || after !== -1
              ? after - before
              : b.occurrenceMs - a.occurrenceMs || b.runId.localeCompare(a.runId)
          })
        const firstNonFailure = ordered.findIndex((entry) => entry.outcome !== 'failed')
        const consecutiveFailures = firstNonFailure === -1 ? ordered.length : firstNonFailure
        const schedules = current.value.schedules.map((job) => {
          if (job.id !== fire.scheduleId) return job
          const isMustPause = consecutiveFailures >= SCHEDULE_PAUSE_AFTER_FAILURES
          return scheduleV2Schema.parse({
            ...job,
            revision: job.revision + 1,
            consecutiveFailures,
            ...(isMustPause && { paused: true, pauseReason: 'consecutiveFailures' }),
          })
        })
        if (
          await journal.replace(current.revision, {
            ...current.value,
            schedules,
            settled: [...(current.value.settled ?? []), fire.runId],
          })
        )
          return
      }
    },
    fires: readFires,
  }
}
