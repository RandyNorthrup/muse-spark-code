// One immutable generation and a bounded journal; the lease covers readers too,
// so retired generations have no outstanding readers when removal is attempted.
import { randomUUID, createHash } from 'node:crypto'
import * as z from 'zod/mini'
import {
  SCHEDULE_JOURNAL_MAX_BYTES,
  SCHEDULE_JOURNAL_MAX_OPS,
  SCHEDULE_JOURNAL_SEAL_MAX_BYTES,
} from '../../shared/constants'

export interface ScheduleFsPort {
  read(file: string): Promise<string | undefined>
  names(directory: string): Promise<readonly string[]>
  /** Complete, synced bytes, atomically published exclusively. */
  publish(file: string, content: string, guard?: () => Promise<void>): Promise<boolean>
  /** Complete, synced bytes and atomic replacement; old bytes survive failure. */
  replace(file: string, content: string, guard?: () => Promise<void>): Promise<void>
  remove(file: string, canRetryTransient?: boolean): Promise<void>
  lock<T>(key: string, work: (guard: () => Promise<void>) => Promise<T>): Promise<T>
}

/** Stored corruption must not quote private prompts or event contents. */
export function parseScheduleStoredJson(content: string | undefined): unknown {
  try {
    return JSON.parse(content ?? 'null')
  } catch {
    throw new Error('scheduleStoredJsonInvalid')
  }
}

const revisionSchema = z.int().check(z.gte(0))
const pointerSchema = z.strictObject({
  generation: z.uuid(),
  revision: revisionSchema,
  epoch: revisionSchema,
})
const envelopeSchema = z.strictObject({ revision: revisionSchema, value: z.unknown() })
const changeSchema = z.strictObject({
  collection: z.string(),
  key: z.string(),
  value: z.optional(z.unknown()),
})
const deltaSchema = z.strictObject({
  revision: revisionSchema,
  changes: z.array(changeSchema),
  sealed: z.optional(z.boolean()),
})
type Collections = Record<string, Record<string, unknown>>

function difference(before: Collections, after: Collections): z.infer<typeof changeSchema>[] {
  const changes = []
  const collections = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const collection of collections) {
    const old = before[collection] ?? {}
    const next = after[collection] ?? {}
    const keys = new Set([...Object.keys(old), ...Object.keys(next)])
    for (const key of keys) {
      if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue
      changes.push({ collection, key, ...(Object.hasOwn(next, key) && { value: next[key] }) })
    }
  }
  return changes
}

export function createScheduleJournal<T extends Collections>(
  fs: ScheduleFsPort,
  directory: string,
  parse: (input: unknown) => T,
  initial: T,
) {
  const pointerFile = `${directory}/current.json`
  const fences = `generationFences/${createHash('sha256').update(directory).digest('hex')}`
  const pointer = async () => {
    // Tiny append-only activation fences never carry state or prompts. Only
    // the newest segment is read. A mutable pointer is a hint; a paused stale
    // rename cannot supersede the exclusive epoch's committed generation.
    const folders = await fs.names(fences)
    const segments = folders
      .filter((name) => /^\d+$/.test(name))
      .toSorted((a, b) => Number(b) - Number(a))
    for (const segment of segments) {
      const entries = await fs.names(`${fences}/${segment}`)
      const names = entries
        .filter((name) => /^\d+\.json$/.test(name))
        .toSorted((a, b) => Number.parseInt(b) - Number.parseInt(a))
      const name = names[0]
      if (name === undefined) continue
      const bytes = await fs.read(`${fences}/${segment}/${name}`)
      if (bytes === undefined) throw new Error('scheduleIndexMissing')
      const result = pointerSchema.parse(parseScheduleStoredJson(bytes))
      if (
        name !== `${String(result.epoch)}.json` ||
        Number(segment) !== Math.floor(result.epoch / SCHEDULE_JOURNAL_MAX_OPS)
      )
        throw new Error('scheduleIndexRevisionMismatch')
      return result
    }
    return
  }
  const read = async () => {
    const active = await pointer()
    if (active === undefined) {
      if ((await fs.read(`${directory}/initialized`)) !== undefined)
        throw new Error('scheduleIndexMissing')
      // A published generation without its pointer is an interrupted activation,
      // never a new empty success. Initial creation may safely retry it.
      return {
        revision: -1,
        value: parse(initial),
        ops: 0,
        bytes: 0,
        generation: undefined,
        epoch: -1,
        sealed: false,
      }
    }
    const folder = `${directory}/${active.generation}`
    const content = await fs.read(`${folder}/state.json`)
    if (content === undefined) throw new Error('scheduleIndexMissing')
    const snapshot = envelopeSchema.parse(parseScheduleStoredJson(content))
    if (snapshot.revision !== active.revision) throw new Error('scheduleIndexRevisionMismatch')
    const next: Collections = structuredClone(parse(snapshot.value))
    let revision = snapshot.revision
    let bytes = 0
    let ops = 0
    let isSealed = false
    const entries = await fs.names(folder)
    const names = entries
      .filter((name) => /^\d+\.json$/.test(name))
      .toSorted((a, b) => Number.parseInt(a) - Number.parseInt(b))
    for (const name of names) {
      const deltaContent = await fs.read(`${folder}/${name}`)
      if (deltaContent === undefined) throw new Error('scheduleIndexMissing')
      const delta = deltaSchema.parse(parseScheduleStoredJson(deltaContent))
      if (isSealed || delta.revision !== revision + 1 || name !== `${String(delta.revision)}.json`)
        throw new Error('scheduleIndexRevisionMismatch')
      for (const change of delta.changes) {
        const collection = next[change.collection]
        if (
          collection === undefined ||
          !Object.hasOwn(next, change.collection) ||
          ['__proto__', 'constructor', 'prototype'].includes(change.key)
        )
          throw new Error('scheduleIndexDeltaInvalid')
        if ('value' in change) collection[change.key] = change.value
        else Reflect.deleteProperty(collection, change.key)
      }
      revision = delta.revision
      bytes += Buffer.byteLength(deltaContent)
      ops += 1
      isSealed = delta.sealed === true
    }
    if (ops > SCHEDULE_JOURNAL_MAX_OPS || bytes > SCHEDULE_JOURNAL_MAX_BYTES)
      throw new Error('scheduleJournalLimitExceeded')
    return {
      revision,
      value: parse(next),
      ops,
      bytes,
      generation: active.generation,
      epoch: active.epoch,
      sealed: isSealed,
    }
  }
  const retire = async (keep: string, revision: number, guard: () => Promise<void>) => {
    const names = await fs.names(directory)
    for (const name of names) {
      if (name === keep || !z.uuid().safeParse(name).success) continue
      // Locked retirement is debt, not a failed committed transaction. Every
      // later mutation retries it. A Windows reader never blocks activation.
      try {
        const content =
          (await fs.read(`${directory}/${name}/state.json`)) ??
          (await fs.read(`${directory}/${name}/staging.json`))
        if (
          content === undefined ||
          envelopeSchema.parse(parseScheduleStoredJson(content)).revision > revision
        )
          continue
        const children = await fs.names(`${directory}/${name}`)
        for (const child of children) {
          await guard()
          await fs.remove(`${directory}/${name}/${child}`, false)
        }
        await fs.remove(`${directory}/${name}`, false)
      } catch {
        continue
      }
    }
  }
  const commit = async (
    current: Awaited<ReturnType<typeof read>>,
    input: T,
    guard: () => Promise<void>,
  ) => {
    const value = parse(input)
    let state = current
    let revision = revisionSchema.parse(state.revision + 1)
    let content = JSON.stringify({ revision, changes: difference(state.value, value) })
    const isLarge =
      Buffer.byteLength(content) + SCHEDULE_JOURNAL_SEAL_MAX_BYTES > SCHEDULE_JOURNAL_MAX_BYTES
    if (
      isLarge ||
      state.sealed ||
      state.generation === undefined ||
      state.ops + 2 > SCHEDULE_JOURNAL_MAX_OPS ||
      state.bytes + Buffer.byteLength(content) + SCHEDULE_JOURNAL_SEAL_MAX_BYTES >
        SCHEDULE_JOURNAL_MAX_BYTES
    ) {
      // Seal uses the SAME next-revision CAS slot as an ordinary operation.
      // Thus a writer paused just before publication either wins that slot or
      // is rejected; it cannot append to a generation being compacted.
      if (state.generation !== undefined && !state.sealed) {
        const seal = JSON.stringify({ revision, changes: [], sealed: true })
        if (
          !(await fs.publish(
            `${directory}/${state.generation}/${String(revision)}.json`,
            seal,
            guard,
          ))
        )
          throw new Error('scheduleJournalOwnershipLost')
        state = { ...state, revision, sealed: true }
      }
      const generation = randomUUID()
      const baseRevision = state.generation === undefined ? revision : state.revision
      const epoch = revisionSchema.parse(state.epoch + 1)
      await fs.publish(
        `${directory}/${generation}/staging.json`,
        JSON.stringify({ revision: baseRevision, value: null }),
        guard,
      )
      await fs.publish(
        `${directory}/${generation}/state.json`,
        JSON.stringify({
          revision: baseRevision,
          value: isLarge || state.generation === undefined ? value : state.value,
        }),
        guard,
      )
      const activation = JSON.stringify({ generation, revision: baseRevision, epoch })
      await fs.replace(pointerFile, activation, guard)
      if (
        !(await fs.publish(
          `${fences}/${String(Math.floor(epoch / SCHEDULE_JOURNAL_MAX_OPS))}/${String(epoch)}.json`,
          activation,
          guard,
        ))
      )
        throw new Error('scheduleJournalOwnershipLost')
      await fs.publish(`${directory}/initialized`, '')
      await retire(generation, baseRevision, guard)
      if (isLarge || state.generation === undefined) return
      state = { ...state, generation, epoch, ops: 0, bytes: 0, sealed: false }
      revision = revisionSchema.parse(state.revision + 1)
      content = JSON.stringify({ revision, changes: difference(state.value, value) })
    }
    if (
      !(await fs.publish(
        `${directory}/${state.generation}/${String(revision)}.json`,
        content,
        guard,
      ))
    )
      throw new Error('scheduleJournalOwnershipLost')
    await retire(state.generation, state.revision, guard)
  }
  return {
    read: async () => await fs.lock(directory, async () => await read()),
    async transact<R>(
      work: (
        value: T,
        revision: number,
      ) => Promise<{ value: T; result: R }> | { value: T; result: R },
    ): Promise<R> {
      return await fs.lock(directory, async (guard) => {
        const current = await read()
        const next = await work(structuredClone(current.value), current.revision)
        if (JSON.stringify(current.value) !== JSON.stringify(next.value))
          await commit(current, next.value, guard)
        return next.result
      })
    },
  }
}
