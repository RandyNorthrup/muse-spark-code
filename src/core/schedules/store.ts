// Compact current state, a bounded delta journal and separate linear fences.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  SCHEDULE_MAX_PER_WORKSPACE,
  SCHEDULE_ID_MAX_CHARS,
  SCHEDULE_PAUSE_AFTER_FAILURES,
  SCHEDULE_OUTBOX_MAX_PENDING,
  SCHEDULE_AUDIT_MAX_PER_SCHEDULE,
  SCHEDULE_AUDIT_MAX_AGE_MS,
  SCHEDULE_FENCE_GRACE_MS,
  SCHEDULE_FENCE_SEGMENT_CHARS,
  SCHEDULE_RECONCILE_MAX_RUNS,
} from '../../shared/constants'
import {
  scheduleFireRecordSchema,
  scheduleV2Schema,
  type ScheduleStoreV2,
  type ScheduleFireRecord,
} from '../../shared/scheduleV2'
import { scheduleEventSchema } from '../../shared/scheduleEvents'
import { createScheduleJournal, parseScheduleStoredJson, type ScheduleFsPort } from './journal'
import { scheduleMigrationReceiptSchema, type ScheduleMigrationJournalPort } from './migrate'
import { validateScheduleSettlement } from './fireRecord'

export interface ScheduleQueuePort {
  /** One dispatcher per target, held until final settlement. */
  serialize(targetKey: string, work: () => Promise<void>): Promise<void>
}
export function scheduleStorageHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
const identifier = z
  .string()
  .check(z.minLength(1), z.maxLength(SCHEDULE_ID_MAX_CHARS), z.regex(/^[\w-][\w.-]*$/))
const intentSchema = z.strictObject({
  runId: scheduleFireRecordSchema.shape.runId,
  schedule: scheduleV2Schema,
  occurrenceMs: z.int().check(z.gte(0)),
  event: z.optional(scheduleEventSchema),
  advancesTime: z.boolean(),
  nextFireAtMs: z.optional(z.int().check(z.gte(0))),
  missed: z.optional(z.boolean()),
})
export type ScheduleRunIntent = z.infer<typeof intentSchema>
const pendingSchema = z.strictObject({
  intent: intentSchema,
  ownerPid: z.int().check(z.gte(1)),
  admitted: z.optional(z.boolean()),
  sequence: z.optional(z.int().check(z.gte(0))),
  ack: z.optional(scheduleFireRecordSchema),
})
const indexSchema = z.strictObject({
  schedules: z.record(identifier, scheduleV2Schema),
  pending: z.record(z.string(), pendingSchema),
  timeCursors: z.record(z.string(), z.int().check(z.gte(0))),
  migrations: z.record(z.string(), scheduleMigrationReceiptSchema),
  retirements: z.record(identifier, z.int().check(z.gte(0))),
})
const fenceSchema = z.strictObject({
  runId: scheduleFireRecordSchema.shape.runId,
  ownerPid: z.int().check(z.gte(1)),
})
const decisionSchema = z.strictObject({
  admitted: z.boolean(),
  sequence: z.int().check(z.gte(0)),
  intentHash: z.string(),
})
const fireEnvelopeSchema = z.strictObject({
  fire: scheduleFireRecordSchema,
  sequence: z.int().check(z.gte(0)),
})
const reservationSchema = z.strictObject({
  id: identifier,
  workspaceKey: identifier,
  creationHash: z.string(),
  removedAtMs: z.optional(z.int().check(z.gte(0))),
})
export interface ScheduleRunJournalPort {
  admit(intent: ScheduleRunIntent): Promise<boolean>
  /** Cursor CAS and after-N admission, idempotent for an already admitted run. */
  advance(intent: ScheduleRunIntent): Promise<boolean>
  /** Bounded dispatchers select from this persisted queue, including live owners. */
  pending(workspaceKey: string): Promise<readonly ScheduleRunIntent[]>
  abandoned(workspaceKey: string): Promise<readonly ScheduleRunIntent[]>
  /** Retain final accounting durably until record succeeds. */
  acknowledge(fire: ScheduleFireRecord): Promise<void>
  acknowledged(workspaceKey: string, runId: string): Promise<ScheduleFireRecord | undefined>
  maintain(workspaceKey: string, now: number): Promise<void>
}
export function isScheduleProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}
function ordered(a: ScheduleRunIntent, b: ScheduleRunIntent): number {
  return (
    a.schedule.createdAtMs - b.schedule.createdAtMs ||
    compareId(a.schedule.id, b.schedule.id) ||
    compareId(a.runId, b.runId)
  )
}
function compareId(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1
}
function fenceFolder(runId: string): string {
  const hash = scheduleStorageHash(runId)
  // Segment by schedule and hash prefix: removal can retire this one schedule's
  // identities after its grace without scanning every workspace's history.
  const id = decodeURIComponent(runId.split(':', 1)[0] ?? '')
  return `claims/${scheduleStorageHash(id)}/${hash.slice(0, SCHEDULE_FENCE_SEGMENT_CHARS)}/${hash}`
}

export function createScheduleStore(
  fs: ScheduleFsPort,
): ScheduleStoreV2 & ScheduleRunJournalPort & ScheduleMigrationJournalPort {
  const index = (workspaceKey: string) => {
    identifier.parse(workspaceKey)
    return createScheduleJournal(
      fs,
      `${workspaceKey}/index`,
      (raw) => {
        const value = indexSchema.parse(raw)
        if (
          Object.entries(value.schedules).some(
            ([id, job]) => job.workspaceKey !== workspaceKey || id !== job.id,
          ) ||
          Object.entries(value.pending).some(
            ([runId, entry]) =>
              entry.intent.schedule.workspaceKey !== workspaceKey || entry.intent.runId !== runId,
          )
        )
          throw new Error('scheduleWorkspaceMismatch')
        return value
      },
      { schedules: {}, pending: {}, timeCursors: {}, migrations: {}, retirements: {} },
    )
  }
  const read = async <T>(file: string, parse: (raw: unknown) => T): Promise<T | undefined> => {
    const content = await fs.read(file)
    return content === undefined ? undefined : parse(parseScheduleStoredJson(content))
  }
  const immutable = async (file: string, content: string, failure: string) => {
    if (!(await fs.publish(file, content)) && (await fs.read(file)) !== content)
      throw new Error(failure)
  }
  const fires = async (workspaceKey: string) => {
    identifier.parse(workspaceKey)
    const result = []
    const names = await fs.names(`${workspaceKey}/fires`)
    for (const name of names) {
      if (!/^[\da-f]+\.json$/.test(name)) continue
      const entry = await read(`${workspaceKey}/fires/${name}`, (raw) =>
        fireEnvelopeSchema.parse(raw),
      )
      if (entry === undefined) continue
      if (
        entry.fire.workspaceKey !== workspaceKey ||
        name !== `${scheduleStorageHash(entry.fire.runId)}.json`
      )
        throw new Error('scheduleFireIdentityMismatch')
      result.push(entry)
    }
    return result
  }
  const trimAudit = async (
    workspaceKey: string,
    now: number,
    retained?: Awaited<ReturnType<typeof fires>>,
  ) => {
    const history = (retained ?? (await fires(workspaceKey))).toSorted(
      (a, b) => b.sequence - a.sequence || b.fire.occurrenceMs - a.fire.occurrenceMs,
    )
    const counts = new Map<string, number>()
    for (const entry of history) {
      const count = (counts.get(entry.fire.scheduleId) ?? 0) + 1
      counts.set(entry.fire.scheduleId, count)
      if (
        count > SCHEDULE_AUDIT_MAX_PER_SCHEDULE ||
        entry.fire.observedAtMs < now - SCHEDULE_AUDIT_MAX_AGE_MS
      ) {
        try {
          await fs.remove(`${workspaceKey}/fires/${scheduleStorageHash(entry.fire.runId)}.json`)
        } catch {
          continue
        }
      }
    }
  }
  const store: ScheduleStoreV2 & ScheduleRunJournalPort & ScheduleMigrationJournalPort = {
    async create(input) {
      const schedule = scheduleV2Schema.parse(input)
      if (schedule.revision !== 0) throw new Error('scheduleCreationRevisionInvalid')
      const file = `identifiers/${scheduleStorageHash(schedule.id)}.json`
      const reservation = {
        id: schedule.id,
        workspaceKey: schedule.workspaceKey,
        creationHash: scheduleStorageHash(JSON.stringify(schedule)),
      }
      await immutable(file, JSON.stringify(reservation), 'scheduleIdentifierAlreadyIssued')
      await index(schedule.workspaceKey).transact(async (value) => {
        if (
          value.schedules[schedule.id] !== undefined ||
          (await fs.read(`${file}.committed`)) !== undefined
        )
          throw new Error('scheduleIdentifierAlreadyIssued')
        if (Object.keys(value.schedules).length >= SCHEDULE_MAX_PER_WORKSPACE)
          throw new Error('scheduleWorkspaceLimit')
        value.schedules[schedule.id] = schedule
        return { value, result: undefined }
      })
      await fs.publish(`${file}.committed`, '')
    },
    async list(workspaceKey) {
      const current = await index(workspaceKey).read()
      return Object.values(current.value.schedules).toSorted(
        (a, b) => a.createdAtMs - b.createdAtMs || compareId(a.id, b.id),
      )
    },
    async update(input) {
      const job = scheduleV2Schema.parse(input)
      return await index(job.workspaceKey).transact((value) => {
        if (value.schedules[job.id]?.revision !== job.revision) return { value, result: false }
        value.schedules[job.id] = scheduleV2Schema.parse({ ...job, revision: job.revision + 1 })
        return { value, result: true }
      })
    },
    async remove(workspaceKey, id) {
      identifier.parse(id)
      return await index(workspaceKey).transact(async (value) => {
        if (value.schedules[id] === undefined) return { value, result: false }
        // The tombstone is tiny and permanent; it contains no old action/prompt.
        const file = `identifiers/${scheduleStorageHash(id)}.json`
        const reservation = await read(file, (raw) => reservationSchema.parse(raw))
        if (reservation === undefined) throw new Error('scheduleIdentifierMissing')
        await fs.replace(file, JSON.stringify({ ...reservation, removedAtMs: Date.now() }))
        await fs.publish(`${file}.committed`, '')
        Reflect.deleteProperty(value.schedules, id)
        value.retirements[id] = Date.now()
        for (const key of Object.keys(value.timeCursors)) {
          if (key.startsWith(`${id}:`)) Reflect.deleteProperty(value.timeCursors, key)
        }
        return { value, result: true }
      })
    },
    async claim(runId) {
      scheduleFireRecordSchema.shape.runId.parse(runId)
      const id = decodeURIComponent(runId.split(':', 1)[0] ?? '')
      const reservation = await read(`identifiers/${scheduleStorageHash(id)}.json`, (raw) =>
        reservationSchema.parse(raw),
      )
      return (
        reservation?.removedAtMs === undefined &&
        (await fs.publish(
          `${fenceFolder(runId)}.json`,
          JSON.stringify({ runId, ownerPid: process.pid }),
        ))
      )
    },
    async admit(input) {
      const intent = intentSchema.parse(input)
      const isNew = await index(intent.schedule.workspaceKey).transact(async (value) => {
        const reservation = await read(
          `identifiers/${scheduleStorageHash(intent.schedule.id)}.json`,
          (raw) => reservationSchema.parse(raw),
        )
        if (reservation?.removedAtMs !== undefined) return { value, result: false }
        if (
          value.pending[intent.runId] !== undefined ||
          (await fs.read(`${fenceFolder(intent.runId)}.json`)) !== undefined
        )
          return { value, result: false }
        if (Object.keys(value.pending).length >= SCHEDULE_OUTBOX_MAX_PENDING)
          throw new Error('scheduleOutboxLimit')
        value.pending[intent.runId] = { intent, ownerPid: process.pid }
        return { value, result: true }
      })
      // Intent precedes the identity fence. A crash here leaves definitely-unsent
      // work in the outbox, which reconciliation will fence and deliver once.
      if (isNew) await store.claim(intent.runId)
      return isNew
    },
    async advance(input) {
      const intent = intentSchema.parse(input)
      const fence = await read(`${fenceFolder(intent.runId)}.json`, (raw) => fenceSchema.parse(raw))
      if (fence !== undefined && fence.runId !== intent.runId)
        throw new Error('scheduleClaimIdentityMismatch')
      let decision: z.infer<typeof decisionSchema> | undefined
      const isResult = await index(intent.schedule.workspaceKey).transact(
        async (value, revision) => {
          const pending = value.pending[intent.runId]
          if (pending === undefined) {
            const saved = await read(`${fenceFolder(intent.runId)}.decision`, (raw) =>
              decisionSchema.parse(raw),
            )
            if (saved !== undefined) {
              if (saved.intentHash !== scheduleStorageHash(JSON.stringify(intent)))
                throw new Error('scheduleRunIntentMismatch')
              return { value, result: saved.admitted }
            }
            throw new Error('scheduleRunNotClaimed')
          }
          if (JSON.stringify(pending.intent) !== JSON.stringify(intent))
            throw new Error('scheduleRunIntentMismatch')
          if (pending.admitted !== undefined) {
            decision = {
              admitted: pending.admitted,
              sequence: pending.sequence ?? 0,
              intentHash: scheduleStorageHash(JSON.stringify(intent)),
            }
            return { value, result: pending.admitted }
          }
          const job = value.schedules[intent.schedule.id]
          const cursorKey = `${intent.schedule.id}:${scheduleStorageHash(JSON.stringify({ trigger: intent.schedule.trigger, zone: intent.schedule.zone }))}`
          const cursor = value.timeCursors[cursorKey]
          const isAdmitted =
            job !== undefined &&
            (job.end?.afterRuns === undefined || job.fireCount < job.end.afterRuns) &&
            (!intent.advancesTime ||
              (job.nextFireAtMs === intent.schedule.nextFireAtMs &&
                JSON.stringify(job.trigger) === JSON.stringify(intent.schedule.trigger) &&
                job.zone === intent.schedule.zone &&
                (cursor === undefined || intent.occurrenceMs > cursor)))
          const sequence = revision + 1
          pending.admitted = isAdmitted
          pending.sequence = sequence
          decision = {
            admitted: isAdmitted,
            sequence,
            intentHash: scheduleStorageHash(JSON.stringify(intent)),
          }
          if (isAdmitted) {
            const { nextFireAtMs: _next, ...rest } = job
            const isAdvances =
              intent.advancesTime &&
              JSON.stringify(job.trigger) === JSON.stringify(intent.schedule.trigger) &&
              job.zone === intent.schedule.zone
            value.schedules[job.id] = scheduleV2Schema.parse({
              ...(isAdvances ? rest : job),
              revision: job.revision + 1,
              fireCount: job.fireCount + 1,
              lastFireAtMs: Math.max(job.lastFireAtMs ?? 0, intent.occurrenceMs),
              ...(isAdvances &&
                intent.nextFireAtMs !== undefined && { nextFireAtMs: intent.nextFireAtMs }),
            })
            if (isAdvances) value.timeCursors[cursorKey] = intent.occurrenceMs
          }
          return { value, result: isAdmitted }
        },
      )
      await store.claim(intent.runId)
      if (decision !== undefined)
        await immutable(
          `${fenceFolder(intent.runId)}.decision`,
          JSON.stringify(decision),
          'scheduleAdmissionConflict',
        )
      return isResult
    },
    async pending(workspaceKey) {
      const current = await index(workspaceKey).read()
      return Object.values(current.value.pending)
        .map((entry) => entry.intent)
        .toSorted(ordered)
    },
    async abandoned(workspaceKey) {
      const current = await index(workspaceKey).read()
      return Object.values(current.value.pending)
        .filter((entry) => !isScheduleProcessAlive(entry.ownerPid))
        .map((entry) => entry.intent)
        .toSorted(ordered)
    },
    async acknowledge(input) {
      const fire = scheduleFireRecordSchema.parse(input)
      await index(fire.workspaceKey).transact((value) => {
        const pending = value.pending[fire.runId]
        if (pending === undefined) throw new Error('scheduleRunNotClaimed')
        validateScheduleSettlement(
          pending.intent.schedule,
          pending.intent.runId,
          pending.intent.occurrenceMs,
          fire,
          pending.intent.event,
        )
        if (pending.ack !== undefined && JSON.stringify(pending.ack) !== JSON.stringify(fire))
          throw new Error('scheduleSettlementConflict')
        pending.ack = fire
        return { value, result: undefined }
      })
    },
    async acknowledged(workspaceKey, runId) {
      const current = await index(workspaceKey).read()
      return current.value.pending[runId]?.ack
    },
    async record(input) {
      const fire = scheduleFireRecordSchema.parse(input)
      await index(fire.workspaceKey).transact(async (value) => {
        const folder = fenceFolder(fire.runId)
        const hash = scheduleStorageHash(JSON.stringify(fire))
        const previous = await fs.read(`${folder}.settled`)
        if (previous !== undefined && previous !== hash)
          throw new Error('scheduleSettlementConflict')
        const pending = value.pending[fire.runId]
        if (
          previous !== undefined &&
          pending === undefined &&
          (await fs.read(`${folder}.applied`)) !== undefined
        )
          return { value, result: undefined }
        const file = `${fire.workspaceKey}/fires/${scheduleStorageHash(fire.runId)}.json`
        const saved =
          pending === undefined
            ? await read(file, (raw) => fireEnvelopeSchema.parse(raw))
            : undefined
        const sequence = pending?.sequence ?? saved?.sequence ?? 0
        const envelope = { fire, sequence }
        await immutable(file, JSON.stringify(envelope), 'scheduleSettlementConflict')
        await immutable(`${folder}.settled`, hash, 'scheduleSettlementConflict')
        const retained = await fires(fire.workspaceKey)
        const history = retained
          .filter((entry) => entry.fire.scheduleId === fire.scheduleId)
          .toSorted(
            (a, b) =>
              b.sequence - a.sequence ||
              b.fire.occurrenceMs - a.fire.occurrenceMs ||
              b.fire.runId.localeCompare(a.fire.runId),
          )
        const firstNonFailure = history.findIndex((entry) => entry.fire.outcome !== 'failed')
        const consecutiveFailures = firstNonFailure === -1 ? history.length : firstNonFailure
        const job = value.schedules[fire.scheduleId]
        const isMustPause = consecutiveFailures >= SCHEDULE_PAUSE_AFTER_FAILURES
        if (
          job !== undefined &&
          (job.consecutiveFailures !== consecutiveFailures || (isMustPause && !job.paused))
        )
          value.schedules[job.id] = scheduleV2Schema.parse({
            ...job,
            revision: job.revision + 1,
            consecutiveFailures,
            ...(isMustPause && {
              paused: true,
              pauseReason: 'consecutiveFailures',
            }),
          })
        Reflect.deleteProperty(value.pending, fire.runId)
        await trimAudit(fire.workspaceKey, fire.observedAtMs, retained)
        return { value, result: undefined }
      })
      await fs.publish(`${fenceFolder(fire.runId)}.applied`, '')
    },
    async fires(workspaceKey) {
      const history = await fs.lock(`${workspaceKey}/index`, async () => await fires(workspaceKey))
      return history
        .map((entry) => entry.fire)
        .toSorted((a, b) => a.occurrenceMs - b.occurrenceMs || a.runId.localeCompare(b.runId))
    },
    async migrationReceipt(workspaceKey, sourceId) {
      const current = await index(workspaceKey).read()
      return (
        current.value.migrations[sourceId] ??
        (await read(
          `${workspaceKey}/migrationReceipts/${scheduleStorageHash(sourceId)}.json`,
          (raw) => scheduleMigrationReceiptSchema.parse(raw),
        ))
      )
    },
    async saveMigrationReceipt(workspaceKey, input) {
      const receipt = scheduleMigrationReceiptSchema.parse(input)
      await index(workspaceKey).transact((value) => {
        value.migrations[receipt.sourceId] = receipt
        return { value, result: undefined }
      })
    },
    async completeMigration(workspaceKey, sourceId) {
      await index(workspaceKey).transact(async (value) => {
        const receipt = value.migrations[sourceId]
        if (receipt !== undefined) {
          await fs.replace(
            `${workspaceKey}/migrationReceipts/${scheduleStorageHash(sourceId)}.json`,
            JSON.stringify(receipt),
          )
          Reflect.deleteProperty(value.migrations, sourceId)
        }
        return { value, result: undefined }
      })
    },
    async reconcileMigration(workspaceKey, next, receipt, expectedSourceFingerprint) {
      return await index(workspaceKey).transact(async (value) => {
        const currentReceipt =
          value.migrations[receipt.sourceId] ??
          (await read(
            `${workspaceKey}/migrationReceipts/${scheduleStorageHash(receipt.sourceId)}.json`,
            (raw) => scheduleMigrationReceiptSchema.parse(raw),
          ))
        if (
          value.schedules[next.id]?.revision !== next.revision ||
          currentReceipt?.sourceFingerprint !== expectedSourceFingerprint
        )
          return { value, result: false }
        value.schedules[next.id] = scheduleV2Schema.parse({ ...next, revision: next.revision + 1 })
        value.migrations[receipt.sourceId] = scheduleMigrationReceiptSchema.parse(receipt)
        return { value, result: true }
      })
    },
    async maintain(workspaceKey, now) {
      await index(workspaceKey).transact(async (value) => {
        await trimAudit(workspaceKey, now)
        let remaining = SCHEDULE_RECONCILE_MAX_RUNS
        for (const [id, atMs] of Object.entries(value.retirements)) {
          if (
            now - atMs < SCHEDULE_FENCE_GRACE_MS ||
            Object.values(value.pending).some((entry) => entry.intent.schedule.id === id)
          )
            continue
          const folder = `claims/${scheduleStorageHash(id)}`
          let isRetired = true
          const segments = await fs.names(folder)
          for (const segment of segments) {
            if (remaining <= 0) {
              isRetired = false
              continue
            }
            const names = await fs.names(`${folder}/${segment}`)
            for (const name of names.slice(0, remaining)) {
              remaining -= 1
              try {
                await fs.remove(`${folder}/${segment}/${name}`, false)
              } catch {
                isRetired = false
              }
            }
            try {
              await fs.remove(`${folder}/${segment}`, false)
            } catch {
              isRetired = false
            }
          }
          try {
            await fs.remove(folder, false)
          } catch {
            isRetired = false
          }
          if (isRetired) Reflect.deleteProperty(value.retirements, id)
        }
        return { value, result: undefined }
      })
    },
  }
  return store
}
