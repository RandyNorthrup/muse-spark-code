import { noScheduleCost } from '../../src/shared/scheduleV2'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { createScheduleJournal } from '../../src/core/schedules/journal'
import { createScheduleStore, scheduleStorageHash } from '../../src/core/schedules/store'
import {
  SCHEDULE_JOURNAL_MAX_BYTES,
  SCHEDULE_JOURNAL_MAX_OPS,
  SCHEDULE_AUDIT_MAX_PER_SCHEDULE,
  SCHEDULE_AUDIT_MAX_AGE_MS,
  SCHEDULE_FENCE_GRACE_MS,
} from '../../src/shared/constants'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { MemoryScheduleFs } from './helpers/schedules/storage'

const counterSchema = z.object({ values: z.record(z.string(), z.int()) })
function counter(fs: MemoryScheduleFs) {
  const journal = createScheduleJournal(fs, 'counter', (raw) => counterSchema.parse(raw), {
    values: {},
  })
  return {
    ...journal,
    increment: () =>
      journal.transact((value) => ({
        value: { values: { n: (value.values['n'] ?? 0) + 1 } },
        result: undefined,
      })),
  }
}
async function countOf(journal: ReturnType<typeof counter>) {
  const state = await journal.read()
  return state.value.values['n']
}

function generationNames(fs: MemoryScheduleFs) {
  const names = Array.from(fs.files, ([file]) => file)
  return names.filter((file) => file.endsWith('/state.json'))
}
function generationOf(fs: MemoryScheduleFs, directory: string): string {
  return z
    .object({ generation: z.string() })
    .parse(JSON.parse(fs.files.get(`${directory}/current.json`) ?? 'null')).generation
}
function pauseActivation<T>(fs: MemoryScheduleFs, work: () => Promise<T>) {
  const entered = Promise.withResolvers<undefined>()
  const resumed = Promise.withResolvers<undefined>()
  const replace = fs.replace.bind(fs)
  vi.spyOn(fs, 'lock').mockImplementationOnce(
    async (_key, callback) => await callback(() => Promise.resolve()),
  )
  vi.spyOn(fs, 'replace').mockImplementationOnce(async (file, content, guard) => {
    await guard?.()
    entered.resolve(undefined)
    await resumed.promise
    // The old rename passed its guard before suspension. Epoch publication
    // decides authority even though this really overwrites the pointer hint.
    await replace(file, content)
  })
  const result = work()
  const withoutActivation = async () => {
    await result
    throw new Error('expected activation never paused')
  }
  return {
    result,
    entered: Promise.race([entered.promise, withoutActivation()]),
    resume: () => {
      resumed.resolve(undefined)
    },
  }
}

describe('bounded schedule generations', () => {
  it('rereads and rejects a changed delta after warming its validation cache', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    await journal.increment()
    await journal.increment()
    expect(await countOf(journal)).toBe(2)
    const file = `counter/${generationOf(fs, 'counter')}/1.json`
    fs.files.set(file, JSON.stringify({ revision: 'corrupt', changes: [] }))
    await expect(journal.read()).rejects.toThrow()
  })

  it('rereads and rejects a changed base snapshot after warming its validation cache', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    await journal.increment()
    await journal.read()
    const file = `counter/${generationOf(fs, 'counter')}/state.json`
    const snapshot = z
      .object({
        revision: z.number(),
        value: z.unknown(),
        fencingToken: z.optional(z.number()),
      })
      .parse(JSON.parse(fs.files.get(file) ?? 'null'))
    fs.files.set(file, JSON.stringify({ ...snapshot, value: { values: { n: 'corrupt' } } }))
    await expect(journal.read()).rejects.toThrow()
  })
  it.each(['read', 'unchanged transaction'] as const)(
    'refuses an in-flight stale commit after a %s takeover acquires a journal token',
    async (kind) => {
      const fs = new MemoryScheduleFs()
      const journal = counter(fs)
      await journal.increment()
      const before = await journal.read()
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const publish = fs.publish.bind(fs)
      let hasPaused = false
      vi.spyOn(fs, 'lock').mockImplementationOnce(
        async (_key, work) => await work(() => Promise.resolve()),
      )
      vi.spyOn(fs, 'publish').mockImplementation(async (file, content, guard) => {
        await guard?.()
        if (!hasPaused && content.includes('"key":"n"')) {
          hasPaused = true
          entered.resolve(undefined)
          await resume.promise
        }
        return await publish(file, content)
      })
      const stale = journal.increment()
      const outcome = Promise.allSettled([stale])
      await entered.promise
      if (kind === 'read') await counter(fs).read()
      else await counter(fs).transact((value) => ({ value, result: undefined }))
      const after = await journal.read()
      resume.resolve(undefined)
      expect(await outcome).toMatchObject([
        { status: 'rejected', reason: { message: 'scheduleJournalOwnershipLost' } },
      ])
      expect(after.fencingToken).toBeGreaterThan(before.fencingToken)
      expect(await countOf(counter(fs))).toBe(1)
    },
  )
  it('retries a locked orphan after its generation headers were already retired', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    for (let index = 0; index < SCHEDULE_JOURNAL_MAX_OPS; index += 1) await journal.increment()
    const old = `counter/${generationOf(fs, 'counter')}`
    const temporary = `${old}/.pending-old.tmp`
    await fs.publish(temporary, 'old private prompt')
    const remove = fs.remove.bind(fs)
    let isLocked = true
    vi.spyOn(fs, 'remove').mockImplementation(async (file) => {
      if (isLocked && file === temporary) throw new Error('temporary locked')
      await remove(file)
    })
    await journal.increment()
    expect(await fs.read(`${old}/state.json`)).toBeUndefined()
    expect(await fs.read(temporary)).toBe('old private prompt')
    isLocked = false
    await journal.increment()
    expect(await fs.read(temporary)).toBeUndefined()
    expect(await countOf(journal)).toBe(SCHEDULE_JOURNAL_MAX_OPS + 2)
  })
  it('leaves the old committed generation current after interrupted activation and retires the orphan on retry', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    for (let index = 0; index < SCHEDULE_JOURNAL_MAX_OPS; index += 1) await journal.increment()
    const before = fs.files.get('counter/current.json')
    fs.faults.set('replace:counter/current.json', 1)
    await expect(journal.increment()).rejects.toThrow('injected')
    expect(fs.files.get('counter/current.json')).toBe(before)
    expect(generationNames(fs)).toHaveLength(2)
    // Reopening acquires a fencing token and may retire the interrupted copy.
    expect(await countOf(counter(fs))).toBe(SCHEDULE_JOURNAL_MAX_OPS)
    await journal.increment()
    expect(await countOf(counter(fs))).toBe(SCHEDULE_JOURNAL_MAX_OPS + 1)
    expect(generationNames(fs)).toHaveLength(1)
  })
  it('retries locked retirement without failing a committed activation', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    await journal.increment()
    const old = generationNames(fs).find((file) => file.endsWith('/state.json'))!
    const remove = fs.remove.bind(fs)
    let isLocked = true
    vi.spyOn(fs, 'remove').mockImplementation(async (file) => {
      if (isLocked && file === old) throw new Error('old state locked')
      await remove(file)
    })
    for (let index = 0; index <= SCHEDULE_JOURNAL_MAX_OPS; index += 1) await journal.increment()
    expect(await countOf(journal)).toBe(SCHEDULE_JOURNAL_MAX_OPS + 2)
    expect(fs.files.has(old)).toBe(true)
    isLocked = false
    await journal.increment()
    expect(fs.files.has(old)).toBe(false)
  })
  it('compacts by bytes as well as operation count and keeps no historical prompts after compaction', async () => {
    const fs = new MemoryScheduleFs()
    const schema = z.object({ values: z.record(z.string(), z.string()) })
    const journal = createScheduleJournal(fs, 'large', (raw) => schema.parse(raw), { values: {} })
    const old = 'old private prompt'
    await journal.transact(() => ({ value: { values: { prompt: old } }, result: undefined }))
    await journal.transact(() => ({
      value: { values: { prompt: 'x'.repeat(SCHEDULE_JOURNAL_MAX_BYTES) } },
      result: undefined,
    }))
    expect(
      Array.from(fs.files, ([, content]) => content).some((content) => content.includes(old)),
    ).toBe(false)
    const current = await journal.read()
    // The large value was compacted; this read appended only its token fence.
    expect(current.ops).toBe(1)
  })
  it('rejects a paused stale writer after another owner commits and a lease guard is lost', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    await journal.increment()
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    let isOwned = true
    const original = fs.lock.bind(fs)
    vi.spyOn(fs, 'lock').mockImplementationOnce(
      async (_key, work) =>
        await work(async () => {
          if (!isOwned) throw new Error('ownership lost')
          await Promise.resolve()
        }),
    )
    const stale = journal.transact(async (value) => {
      entered.resolve(undefined)
      await resume.promise
      return { value: { values: { n: (value.values['n'] ?? 0) + 1 } }, result: undefined }
    })
    await entered.promise
    isOwned = false
    await original('counter', async () => {
      await Promise.resolve()
    })
    await counter(fs).increment()
    resume.resolve(undefined)
    await expect(stale).rejects.toThrow('ownership lost')
    expect(await countOf(counter(fs))).toBe(2)
  })
  it('fences a stale pointer rename already in flight after another owner activates and writes', async () => {
    const fs = new MemoryScheduleFs()
    const journal = counter(fs)
    for (let index = 0; index < SCHEDULE_JOURNAL_MAX_OPS; index += 1) await journal.increment()
    const paused = pauseActivation(fs, () => journal.increment())
    await paused.entered
    await counter(fs).increment()
    paused.resume()
    await expect(paused.result).rejects.toThrow('OwnershipLost')
    expect(await countOf(counter(fs))).toBe(SCHEDULE_JOURNAL_MAX_OPS + 1)
    await counter(fs).increment()
    expect(await countOf(counter(fs))).toBe(SCHEDULE_JOURNAL_MAX_OPS + 2)
  })
  it('seals a byte-full journal before compaction so a stale writer cannot erase a smaller competing operation', async () => {
    const fs = new MemoryScheduleFs()
    const schema = z.object({ values: z.record(z.string(), z.string()) })
    const journal = () =>
      createScheduleJournal(fs, 'bytes', (raw) => schema.parse(raw), { values: {} })
    const set = async (text: string) => {
      await journal().transact(() => ({ value: { values: { prompt: text } }, result: undefined }))
    }
    const size = Math.floor(SCHEDULE_JOURNAL_MAX_BYTES / 3) + 1
    for (const letter of ['a', 'b', 'c']) await set(letter.repeat(size))
    const paused = pauseActivation(fs, () => set('d'.repeat(size)))
    await paused.entered
    await set('new committed value')
    paused.resume()
    await expect(paused.result).rejects.toThrow('OwnershipLost')
    const state = await journal().read()
    expect(state.value.values['prompt']).toBe('new committed value')
  })
  it.each(['operations', 'bytes', 'collection', 'key'] as const)(
    'rejects a corrupt journal exceeding its %s boundary',
    async (boundary) => {
      const fs = new MemoryScheduleFs()
      const journal = counter(fs)
      await journal.increment()
      const generation = generationOf(fs, 'counter')
      if (boundary === 'operations') {
        for (let revision = 1; revision <= SCHEDULE_JOURNAL_MAX_OPS + 1; revision += 1)
          await fs.publish(
            `counter/${generation}/${String(revision)}.json`,
            JSON.stringify({ revision, changes: [] }),
          )
      } else
        await fs.publish(
          `counter/${generation}/1.json`,
          JSON.stringify({
            revision: 1,
            changes: [
              {
                collection: boundary === 'collection' ? 'injected' : 'values',
                key: boundary === 'key' ? '__proto__' : 'n',
                value: boundary === 'bytes' ? 'x'.repeat(SCHEDULE_JOURNAL_MAX_BYTES) : 2,
              },
            ],
          }),
        )
      await expect(journal.read()).rejects.toThrow(
        boundary === 'bytes' || boundary === 'operations' ? 'LimitExceeded' : 'DeltaInvalid',
      )
      expect(Object.prototype).not.toHaveProperty('n')
    },
  )
  it.each(['gap', 'sealed'] as const)(
    'refuses a %s journal revision before exposing changed state',
    async (kind) => {
      const fs = new MemoryScheduleFs()
      const journal = counter(fs)
      await journal.increment()
      const generation = generationOf(fs, 'counter')
      if (kind === 'sealed')
        await fs.publish(
          `counter/${generation}/1.json`,
          JSON.stringify({ revision: 1, changes: [], sealed: true }),
        )
      await fs.publish(
        `counter/${generation}/2.json`,
        JSON.stringify({ revision: 2, changes: [{ collection: 'values', key: 'n', value: 2 }] }),
      )
      await expect(journal.read()).rejects.toThrow('RevisionMismatch')
    },
  )
  it('bounds the live journal and audit at 10,000 fires while identity fences grow only linearly', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    const rows: {
      fires: number
      indexBytes: number
      totalBytes: number
      journalOps: number
      journalBytes: number
    }[] = []
    for (let run = 1; run <= 10_000; run += 1) {
      const intent = {
        schedule: job,
        runId: `${job.id}:${String(run)}`,
        occurrenceMs: run,
        advancesTime: false,
      }
      await store.admit(intent)
      await store.advance(intent)
      await store.record({
        runId: intent.runId,
        scheduleId: job.id,
        workspaceKey: job.workspaceKey,
        occurrenceMs: run,
        observedAtMs: job.createdAtMs + run,
        target: job.target,
        delivery: job.delivery,
        outcome: 'ran',
        refusedActions: [],
        cost: noScheduleCost(),
      })
      if (![1, 10, 100, 1000, 10_000].includes(run)) continue

      const pointer = z
        .object({ generation: z.string() })
        .parse(JSON.parse(fs.files.get('workspace-1/index/current.json') ?? 'null'))
      const deltas = [...fs.files].filter(
        ([file]) =>
          file.startsWith(`workspace-1/index/${pointer.generation}/`) && /\/\d+\.json$/.test(file),
      )
      const journalBytes = deltas.reduce((sum, [, content]) => sum + Buffer.byteLength(content), 0)
      rows.push({
        fires: run,
        indexBytes: fs.bytes('workspace-1/index/'),
        totalBytes: fs.bytes(),
        journalOps: deltas.length,
        journalBytes,
      })
      expect(deltas.length).toBeLessThanOrEqual(SCHEDULE_JOURNAL_MAX_OPS)
      expect(journalBytes).toBeLessThanOrEqual(SCHEDULE_JOURNAL_MAX_BYTES)
      expect(fs.bytes('workspace-1/index/')).toBeLessThan(SCHEDULE_JOURNAL_MAX_BYTES * 2)
      // Three small identity/decision/settlement fences per fire, plus the
      // bounded current state, journal and retained 100 audit records.
      expect(fs.bytes()).toBeLessThan(run * 512 + SCHEDULE_JOURNAL_MAX_BYTES * 2)
    }
    expect(await store.fires(job.workspaceKey)).toHaveLength(SCHEDULE_AUDIT_MAX_PER_SCHEDULE)
    expect(await store.claim(`${job.id}:1`)).toBe(false)
    expect(await store.pending(job.workspaceKey)).toEqual([])
    const [counted] = await store.list(job.workspaceKey)
    expect(counted?.fireCount).toBe(10_000)
    process.stdout.write(`M115 storage growth: ${JSON.stringify(rows)}\n`)
    // A deliberate 10,000-fire production-storage workload, not a normal unit operation.
  }, 240_000)
  it('retains fences through the schedule lifetime and grace, then removes them without recycling the identifier', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    await store.claim(`${job.id}:1`)
    const folder = `claims/${scheduleStorageHash(job.id)}`
    await store.maintain(job.workspaceKey, Date.now() + SCHEDULE_FENCE_GRACE_MS * 2)
    expect(fs.bytes(folder)).toBeGreaterThan(0)
    const removed = Date.now()
    await store.remove(job.workspaceKey, job.id)
    await store.maintain(job.workspaceKey, removed + SCHEDULE_FENCE_GRACE_MS - 1)
    expect(fs.bytes(folder)).toBeGreaterThan(0)
    await store.maintain(job.workspaceKey, Date.now() + SCHEDULE_FENCE_GRACE_MS + 1)
    expect(fs.bytes(folder)).toBe(0)
    await expect(store.create(job)).rejects.toThrow('AlreadyIssued')
  })
  it('expires audit by age independently of exact deduplication', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    const runId = `${job.id}:1`
    await store.claim(runId)
    await store.record({
      runId,
      scheduleId: job.id,
      workspaceKey: job.workspaceKey,
      occurrenceMs: 1,
      observedAtMs: job.createdAtMs,
      target: job.target,
      delivery: job.delivery,
      outcome: 'ran',
      refusedActions: [],
      cost: noScheduleCost(),
    })
    await store.maintain(job.workspaceKey, job.createdAtMs + SCHEDULE_AUDIT_MAX_AGE_MS + 1)
    expect(await store.fires(job.workspaceKey)).toEqual([])
    expect(await store.claim(runId)).toBe(false)
  })
})
