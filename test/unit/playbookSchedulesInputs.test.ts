// The schedules report reader tells a corrupt store from an unreadable one
// (M113 C-M113-4 repairs): damaged JSON and identity mismatches read
// `invalid`, genuine I/O failures read `failed`, never a generic failure
// with the store's reason discarded and never an empty success.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { localFailureOf } from '../../src/core/reporting/sources/local'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createSchedulesReportReader } from '../../src/runtime/reporting/playbookSchedulesInputs'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import * as nodeSchedules from '../../src/runtime/schedules/nodeScheduleFs'
import { MemoryScheduleFs } from './helpers/schedules/storage'
import { schedulesSource } from '../../src/core/reporting/sources/schedules'
import { scheduleTimePlan } from '../../src/runtime/schedules/timePlan'
import { UI_TEXT, SCHEDULE_FS_RETRY_ATTEMPTS } from '../../src/shared/constants'
import { fireFixture, sectionById } from './helpers/reporting/reportKindFixtures'
import { scheduleV2Schema, scheduleFireRecordSchema } from '../../src/shared/scheduleV2'
import { FIXTURE_WORKSPACE_KEY, scheduleFixture } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: FIXTURE_WORKSPACE_KEY,
  options: reportOptions('schedules'),
  signal: new AbortController().signal,
})

const codeOf = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch (error) {
    return localFailureOf(error)
  }
  throw new Error('Expected the read to fail')
}

async function withSchedulesRoot<T>(
  prefix: string,
  work: (root: string) => Promise<T>,
): Promise<T> {
  const root = await temporaryDir(prefix)
  try {
    return await work(root)
  } finally {
    await removeFolder(root)
  }
}

function readerFor(storeRoot: string) {
  return createSchedulesReportReader({ storeRoot, workspaceKey: FIXTURE_WORKSPACE_KEY })
}

describe('schedules report reader failures', () => {
  it('reconciles a manual one-shot fire between schedule and history reads', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const job = scheduleV2Schema.parse(
      scheduleFixture(FIXTURE_WORKSPACE_KEY, { trigger: { kind: 'once', atMs: 2000 } }),
    )
    await store.create(job)
    const originalLock = fs.lock.bind(fs)
    let isInterleave = true
    vi.spyOn(fs, 'lock').mockImplementation(async (key, work) => {
      const result = await originalLock(key, work)
      if (isInterleave) {
        isInterleave = false
        const intent = {
          schedule: job,
          runId: `${job.id}:3000`,
          occurrenceMs: 3000,
          advancesTime: false,
        }
        expect(await store.admit(intent)).toBe(true)
        expect(await store.advance(intent)).toBe(true)
        await store.record(
          scheduleFireRecordSchema.parse(
            fireFixture({
              runId: intent.runId,
              occurrenceMs: 3000,
              observedAtMs: 3000,
              outcome: 'ran',
              refusedActions: [],
            }),
          ),
        )
      }
      return result
    })
    const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
    try {
      const read = await readerFor('memory').read(context())
      const observed = scheduleV2Schema.parse(read.schedules[0])
      expect(observed.fireCount).toBe(1)
      expect(observed.nextFireAtMs).toBe(2000)
      expect(
        scheduleTimePlan(observed, {
          nowMs: 3000,
          monotonicMs: 3000,
          wallDeltaMs: 1,
          monotonicDeltaMs: 1,
          hasJumped: false,
          isStartup: false,
        }),
      ).toEqual({ missed: false })
      const result = await schedulesSource(
        { read: () => Promise.resolve(read) },
        (text) => text,
      ).read(context())
      expect(sectionById(result.data, 'schedules/timeline').rows).toEqual([])
      expect(sectionById(result.data, 'schedules/schedules').rows[0]!.cells['status']?.value).toBe(
        'complete',
      )
      expect(read.fires).toHaveLength(1)
    } finally {
      createFs.mockRestore()
    }
  })

  it('retries a valid writer winning the reader fencing CAS', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const job = scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY))
    await store.create(job)
    let token = 0
    vi.spyOn(fs, 'lock').mockImplementation(
      async (_key, work) =>
        await work(Object.assign(() => Promise.resolve(), { fencingToken: ++token })),
    )
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const publish = fs.publish.bind(fs)
    let isPark = true
    vi.spyOn(fs, 'publish').mockImplementation(async (file, bytes, guard) => {
      if (isPark && /\/index\/[^/]+\/\d+\.json$/.test(file.replaceAll('\\', '/'))) {
        isPark = false
        await guard?.()
        entered.resolve(undefined)
        await resume.promise
      }
      return await publish(file, bytes, guard)
    })
    const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
    try {
      const pending = readerFor('memory').read(context())
      // Attach rejection immediately; a losing reader is an expected race.
      const result = (async () => {
        try {
          return { value: await pending }
        } catch (error: unknown) {
          return { error }
        }
      })()
      await entered.promise
      expect(await store.update({ ...job, name: 'Winning writer' })).toBe(true)
      resume.resolve(undefined)
      const observed = await result
      expect(observed).toHaveProperty('value')
      if (!('value' in observed)) throw new Error('Expected contention to retry')
      expect(scheduleV2Schema.parse(observed.value.schedules[0]).name).toBe('Winning writer')
    } finally {
      resume.resolve(undefined)
      createFs.mockRestore()
    }
  })

  it.each(['scheduleJournalOwnershipLost', 'scheduleQueueOwnershipLost'])(
    'names persistent %s as busy, never corrupt',
    async (message) => {
      const fs = new MemoryScheduleFs()
      vi.spyOn(fs, 'lock').mockRejectedValue(new Error(message))
      const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
      try {
        const result = await schedulesSource(readerFor('memory'), (text) => text).read(context())
        expect(result.record.status).toBe('unavailable')
        expect(result.record.reason).toBe(UI_TEXT.teamHostBusy)
        expect(fs.lock).toHaveBeenCalledTimes(SCHEDULE_FS_RETRY_ATTEMPTS)
      } finally {
        createFs.mockRestore()
      }
    },
  )

  it('reads damaged stored JSON as invalid, never a generic failure', async () => {
    await withSchedulesRoot('schedules-corrupt-', async (root) => {
      await mkdir(path.join(root, FIXTURE_WORKSPACE_KEY, 'fires'), { recursive: true })
      await writeFile(path.join(root, FIXTURE_WORKSPACE_KEY, 'fires', 'abc123.json'), '{corrupt')
      expect(await codeOf(() => readerFor(root).read(context()))).toBe('invalid')
    })
  })

  it('reads a fencing-token regression as invalid, never a generic failure', async () => {
    await withSchedulesRoot('schedules-fencing-', async (root) => {
      const store = createScheduleStore(createNodeScheduleFs(root))
      const first = scheduleV2Schema.parse(
        scheduleFixture(FIXTURE_WORKSPACE_KEY, { id: 'sched-1', name: 'First' }),
      )
      const second = scheduleV2Schema.parse(
        scheduleFixture(FIXTURE_WORKSPACE_KEY, { id: 'sched-2', name: 'Second' }),
      )
      await store.create(first)
      await store.create(second)
      // A delta whose fencing token runs below the previous delta's is a
      // superseded writer's stale write: corrupt journal data, not an I/O
      // failure. Forge it by lowering the second delta's token below the
      // first delta's.
      const generations = await readdir(path.join(root, FIXTURE_WORKSPACE_KEY, 'index'))
      const generation = generations.find(
        (name) => name !== 'current.json' && name !== 'initialized',
      )
      if (generation === undefined) throw new Error('Expected a journal generation folder')
      const secondDelta = path.join(root, FIXTURE_WORKSPACE_KEY, 'index', generation, '2.json')
      const delta = JSON.parse(await readFile(secondDelta, 'utf8')) as {
        fencingToken?: number
      }
      if (typeof delta.fencingToken !== 'number' || delta.fencingToken < 1)
        throw new Error('Expected a fenced second delta to regress')
      await writeFile(secondDelta, JSON.stringify({ ...delta, fencingToken: 0 }))
      expect(await codeOf(() => readerFor(root).read(context()))).toBe('invalid')
    })
  })

  it('reads an unreadable store root as failed, never invalid', async () => {
    await withSchedulesRoot('schedules-unreadable-', async (root) => {
      const file = path.join(root, 'file')
      await writeFile(file, 'not a directory')
      expect(await codeOf(() => readerFor(file).read(context()))).toBe('failed')
    })
  })

  it('omits a removed schedule instead of listing it as deleted', async () => {
    await withSchedulesRoot('schedules-removed-', async (root) => {
      const store = createScheduleStore(createNodeScheduleFs(root))
      const job = scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY))
      await store.create(job)
      expect(await store.remove(FIXTURE_WORKSPACE_KEY, job.id)).toBe(true)
      const read = await readerFor(root).read(context())
      // Removal retires the schedule from the store: the report has no
      // deleted row to show, so it shows nothing rather than a stale fire.
      expect(read.schedules).toEqual([])
    })
  })

  it('reads a fresh store as empty, never a miss', async () => {
    await withSchedulesRoot('schedules-fresh-', async (root) => {
      const read = await readerFor(root).read(context())
      expect(read.schedules).toEqual([])
      expect(read.fires).toEqual([])
    })
  })
})
