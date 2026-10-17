// The schedules report reader tells a corrupt store from an unreadable one
// (M113 C-M113-4 repairs): damaged JSON and identity mismatches read
// `invalid`, genuine I/O failures read `failed`, never a generic failure
// with the store's reason discarded and never an empty success.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import * as ts from 'typescript'
import { codeUnitCompare, localFailureOf } from '../../src/core/reporting/sources/local'
import type { ScheduleFsPort } from '../../src/core/schedules/journal'
import { createScheduleStore, scheduleStorageHash } from '../../src/core/schedules/store'
import {
  createSchedulesReportReader,
  SCHEDULE_QUEUE_FAILURES,
} from '../../src/runtime/reporting/playbookSchedulesInputs'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import * as nodeSchedules from '../../src/runtime/schedules/nodeScheduleFs'
import { MemoryScheduleFs } from './helpers/schedules/storage'
import { schedulesSource } from '../../src/core/reporting/sources/schedules'
import { scheduleTimePlan } from '../../src/runtime/schedules/timePlan'
import { UI_TEXT, SCHEDULE_FS_RETRY_ATTEMPTS } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fireFixture, sectionById } from './helpers/reporting/reportKindFixtures'
import {
  scheduleV2Schema,
  scheduleFireRecordSchema,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { FIXTURE_WORKSPACE_KEY, scheduleFixture } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/snapshot'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const context = () => ({
  reportText: EN,
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

async function admitFirstFire(
  store: ReturnType<typeof createScheduleStore>,
  schedule: ScheduleV2,
  runId: string,
  occurrenceMs: number,
): Promise<void> {
  const intent = { schedule, runId, occurrenceMs, advancesTime: false }
  expect(await store.admit(intent)).toBe(true)
  expect(await store.advance(intent)).toBe(true)
}

async function holdProductionLease(root: string) {
  await seedJob(root)
  const holderFs = createNodeScheduleFs(root)
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const held = holderFs.lock(`${FIXTURE_WORKSPACE_KEY}/index`, async () => {
    entered.resolve(undefined)
    await release.promise
  })
  await entered.promise
  return { release, held }
}

function spyReaderPort(readerFs: ScheduleFsPort) {
  return {
    read: vi.spyOn(readerFs, 'read'),
    names: vi.spyOn(readerFs, 'names'),
    publish: vi.spyOn(readerFs, 'publish'),
    replace: vi.spyOn(readerFs, 'replace'),
    remove: vi.spyOn(readerFs, 'remove'),
    lock: vi.spyOn(readerFs, 'lock'),
  }
}

async function holdMemoryLease() {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const job = scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY))
  await store.create(job)
  const release = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  const held = fs.lock(`${FIXTURE_WORKSPACE_KEY}/index`, () => {
    entered.resolve(undefined)
    return release.promise
  })
  await entered.promise
  return { fs, store, job, release, held }
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
        const runId = `${job.id}:3000`
        await admitFirstFire(store, job, runId, 3000)
        await store.record(
          scheduleFireRecordSchema.parse(
            fireFixture({
              runId,
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

const freshContext = () => ({ ...context(), asOf: new Date().toISOString() })
const sourceFor = (storeRoot: string) =>
  schedulesSource(
    createSchedulesReportReader({ storeRoot, workspaceKey: FIXTURE_WORKSPACE_KEY }),
    (text) => text,
  )

async function seedJob(root: string) {
  const store = createScheduleStore(createNodeScheduleFs(root))
  const job = scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY))
  await store.create(job)
  return job
}

async function inventory(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (relative: string) => {
    const names = await readdir(path.join(root, relative))
    for (const name of names) {
      const next = relative === '' ? name : `${relative}/${name}`
      found.push(next.replaceAll('\\', '/'))
      const info = await stat(path.join(root, next))
      if (info.isDirectory()) await walk(next)
    }
  }
  await walk('')
  return found.toSorted(codeUnitCompare)
}

async function firstFile(root: string, folder: string): Promise<string> {
  const names = await inventory(root)
  for (const name of names) {
    if (name.startsWith(`${folder}/`) && name.endsWith('.json') && !name.endsWith('.released'))
      return path.join(root, name)
  }
  throw new Error(`Expected a file under ${folder}`)
}

// Forged store JSON has no schema: the casts below only reach into the
// envelope the store itself wrote, to corrupt one field per word.
const recordOf = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null)
    throw new Error(`Expected ${what} to hold a JSON object`)
  return value as Record<string, unknown>
}
const readJsonRecord = async (file: string): Promise<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  return recordOf(parsed, file)
}
async function stateDocument(root: string) {
  const pointer = recordOf(
    JSON.parse(
      await readFile(path.join(root, FIXTURE_WORKSPACE_KEY, 'index', 'current.json'), 'utf8'),
    ),
    'index/current.json',
  )
  const file = path.join(
    root,
    FIXTURE_WORKSPACE_KEY,
    'index',
    String(pointer['generation']),
    'state.json',
  )
  const doc = await readJsonRecord(file)
  const { value, revision } = doc
  if (typeof revision !== 'number') throw new Error('Expected the state revision to be a number')
  return { file, doc, value: recordOf(value, 'state value'), revision }
}

async function journalOverflowFolder(root: string) {
  await seedJob(root)
  const pointer = recordOf(
    JSON.parse(
      await readFile(path.join(root, FIXTURE_WORKSPACE_KEY, 'index', 'current.json'), 'utf8'),
    ),
    'index/current.json',
  )
  const folder = path.join(root, FIXTURE_WORKSPACE_KEY, 'index', String(pointer['generation']))
  const { revision } = await stateDocument(root)
  return { folder, revision }
}

async function forgeJournalOverflow(root: string, changes: unknown) {
  const { folder, revision } = await journalOverflowFolder(root)
  await writeFile(
    path.join(folder, `${String(revision + 1)}.json`),
    JSON.stringify({ revision: revision + 1, changes }),
  )
}

describe('schedules report contention waits', () => {
  // The production 5 s source deadline must elapse while a valid holder owns
  // the lease, so this needs longer than the repository default timeout.
  it(
    'reports a held production lease as busy with no late publish',
    { timeout: 30_000 },
    async () => {
      await withSchedulesRoot('schedules-held-lease-', async (root) => {
        const { release, held } = await holdProductionLease(root)
        const readerFs = createNodeScheduleFs(root)
        const spies = spyReaderPort(readerFs)
        const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(readerFs)
        try {
          // A valid writer holds the lease past the source deadline: the
          // verdict is the Host busy sentence, never cancelled or timed out.
          const result = await sourceFor(root).read(freshContext())
          expect(result.record.status).toBe('unavailable')
          expect(result.record.reason).toBe(UI_TEXT.teamHostBusy)
          // One attempt only: the expired wait is terminal, never retried.
          expect(spies.lock).toHaveBeenCalledTimes(1)
          const counts = Object.fromEntries(
            Object.entries(spies).map(([method, spy]) => [method, spy.mock.calls.length]),
          )
          release.resolve(undefined)
          await held
          await delay(300)
          // The stopped reader performs no further read, write or publish once
          // the holder lets go: every call count stays where it was.
          for (const [method, spy] of Object.entries(spies))
            expect(spy.mock.calls.length, method).toBe(counts[method])
        } finally {
          release.resolve(undefined)
          createFs.mockRestore()
        }
      })
    },
  )

  // Five sequential refreshes against a persistent holder: each one ends
  // busy on its own wait, files stay untouched, and releasing the holder
  // afterwards serves a fresh read. Needs five production waits back to back.
  it('ends every refresh busy without accumulating readers', { timeout: 60_000 }, async () => {
    await withSchedulesRoot('schedules-refresh-', async (root) => {
      const { release, held } = await holdProductionLease(root)
      try {
        // Heartbeat pulses belong to the holder's own lease, not to a
        // reader: filter them so the comparison sees only acquisitions.
        const withoutPulse = (files: readonly string[]) =>
          files.filter((file) => !file.endsWith('.heartbeat'))
        const before = withoutPulse(await inventory(root))
        for (let refresh = 0; refresh < 5; refresh += 1) {
          const result = await sourceFor(root).read(freshContext())
          expect(result.record.status).toBe('unavailable')
          expect(result.record.reason).toBe(UI_TEXT.teamHostBusy)
        }
        // No refresh acquired the lease, so no fence header or marker
        // appeared: repeated refreshes accumulate no readers.
        expect(withoutPulse(await inventory(root))).toEqual(before)
      } finally {
        release.resolve(undefined)
      }
      await held
      const fresh = await sourceFor(root).read(freshContext())
      expect(fresh.record.status).toBe('ok')
      expect(fresh.data).not.toBeNull()
    })
  })

  // The full 5 s reader wait must elapse against the gated lock, so this
  // needs longer than the repository default timeout.
  it(
    'stops a queued memory reader on its deadline with frozen calls',
    { timeout: 30_000 },
    async () => {
      const { fs, release, held } = await holdMemoryLease()
      const readerFs = new MemoryScheduleFs(fs)
      const spies = spyReaderPort(readerFs)
      const baseline = {
        read: spies.read.mock.calls.length,
        names: spies.names.mock.calls.length,
        publish: spies.publish.mock.calls.length,
        replace: spies.replace.mock.calls.length,
        remove: spies.remove.mock.calls.length,
        lock: spies.lock.mock.calls.length,
      }
      const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(readerFs)
      try {
        expect(await codeOf(() => readerFor('memory').read(freshContext()))).toBe('busy')
        // The single lock attempt waited out its deadline; no read, listing,
        // write or removal followed the stop.
        expect(spies.lock.mock.calls.length).toBe(baseline.lock + 1)
        expect(spies.read.mock.calls.length).toBe(baseline.read)
        expect(spies.names.mock.calls.length).toBe(baseline.names)
        expect(spies.publish.mock.calls.length).toBe(baseline.publish)
        expect(spies.replace.mock.calls.length).toBe(baseline.replace)
        expect(spies.remove.mock.calls.length).toBe(baseline.remove)
        release.resolve(undefined)
        await held
        // Check the abandoned tail before a reread can repair it.
        await delay(0)
        expect(fs.tails.size).toBe(0)
        const reread = await readerFor('memory').read(context())
        expect(reread.schedules).toHaveLength(1)
        expect(fs.tails.size).toBe(0)
      } finally {
        release.resolve(undefined)
        createFs.mockRestore()
      }
    },
  )

  it('still reports an explicit abort as cancelled, never busy', async () => {
    const { fs, release, held } = await holdMemoryLease()
    const readerFs = new MemoryScheduleFs(fs)
    const publish = vi.spyOn(readerFs, 'publish')
    const replace = vi.spyOn(readerFs, 'replace')
    const published = publish.mock.calls.length
    const replaced = replace.mock.calls.length
    const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(readerFs)
    try {
      const controller = new AbortController()
      const pending = sourceFor('memory').read({ ...freshContext(), signal: controller.signal })
      const outcome = (async () => {
        try {
          return { value: await pending }
        } catch (error: unknown) {
          return { error }
        }
      })()
      await delay(50)
      controller.abort()
      const settled = await outcome
      expect(settled).toHaveProperty('value')
      if (!('value' in settled)) throw new Error('Expected the source to settle its record')
      expect(settled.value.record.status).toBe('unavailable')
      expect(settled.value.record.reason).toBe(UI_TEXT.reportSourceReasons.cancelled)
      // Freeze only after releasing/settling the holder, so an abandoned
      // reader cannot resume unseen after these assertions.
      release.resolve(undefined)
      await held
      await delay(100)
      expect(publish.mock.calls.length).toBe(published)
      expect(replace.mock.calls.length).toBe(replaced)
    } finally {
      release.resolve(undefined)
      createFs.mockRestore()
    }
    await held
  })
})

describe('schedules report lease identity words', () => {
  const leaseIdentityCases: [string, (header: string) => Promise<void>][] = [
    [
      'a token above its file name',
      async (header: string) => {
        const doc = await readJsonRecord(header)
        const token = doc['fencingToken']
        if (typeof token !== 'number') throw new Error('Expected the lease header to carry a token')
        await writeFile(header, JSON.stringify({ ...doc, fencingToken: token + 1 }))
      },
    ],
    [
      'a file name above its token',
      async (header: string) => {
        const name = path.basename(header, '.json')
        await rename(header, path.join(path.dirname(header), `${String(Number(name) + 1)}.json`))
      },
    ],
    [
      'no token at all',
      async (header: string) => {
        const doc = await readJsonRecord(header)
        const { fencingToken: _dropped, ...legacy } = doc
        await writeFile(header, JSON.stringify(legacy))
      },
    ],
  ]
  it.each(leaseIdentityCases)(
    'reads a fence header with %s as invalid without retrying',
    async (_name, forge) => {
      await withSchedulesRoot('schedules-lease-invalid-', async (root) => {
        await seedJob(root)
        const fs = createNodeScheduleFs(root)
        const lock = vi.spyOn(fs, 'lock')
        const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
        try {
          await forge(await firstFile(root, 'leaseFences'))
          // No competing writer can make a self-contradicting identity valid:
          // invalid at once, with a single lock attempt and no retry.
          expect(await codeOf(() => readerFor(root).read(context()))).toBe('invalid')
          expect(lock).toHaveBeenCalledTimes(1)
        } finally {
          createFs.mockRestore()
        }
      })
    },
  )

  it('heals a fence entry that vanishes between listing and read', async () => {
    await withSchedulesRoot('schedules-lease-transient-', async (root) => {
      await seedJob(root)
      const fs = createNodeScheduleFs(root)
      const header = await firstFile(root, 'leaseFences')
      const segment = path.relative(root, path.dirname(header)).replaceAll('\\', '/')
      await fs.remove(path.relative(root, header))
      const through = fs.names.bind(fs)
      const names = vi.spyOn(fs, 'names')
      let isStale = true
      names.mockImplementation(async (directory: string) => {
        const listed = await through(directory)
        if (isStale && directory.replaceAll('\\', '/') === segment) {
          isStale = false
          return [...listed, path.basename(header)]
        }
        return listed
      })
      const createFs = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
      try {
        // The first attempt loses the listed fence to a writer that moved
        // on; the retry observes the takeover and reads successfully.
        const read = await readerFor(root).read(context())
        expect(read.schedules).toHaveLength(1)
        expect(isStale, 'the listed-then-vanished fault was injected').toBe(false)
      } finally {
        createFs.mockRestore()
      }
    })
  })
})

async function recordFire(root: string, scheduleId: string, runId: string) {
  const store = createScheduleStore(createNodeScheduleFs(root))
  const job = scheduleV2Schema.parse(scheduleFixture(FIXTURE_WORKSPACE_KEY, { id: scheduleId }))
  await store.create(job)
  await admitFirstFire(store, job, runId, 3000)
  await store.record(
    scheduleFireRecordSchema.parse(
      fireFixture({ runId, scheduleId, occurrenceMs: 3000, observedAtMs: 3000, outcome: 'ran' }),
    ),
  )
}

describe('schedules report stored-word classification', () => {
  const storedWordCases: [string, string, (root: string) => Promise<void>][] = [
    [
      'scheduleFireIdentityMismatch',
      'invalid',
      async (root: string) => {
        const runId = 'sched-1:3000'
        await recordFire(root, 'sched-1', runId)
        await rename(
          path.join(root, FIXTURE_WORKSPACE_KEY, 'fires', `${scheduleStorageHash(runId)}.json`),
          path.join(root, FIXTURE_WORKSPACE_KEY, 'fires', `${'0'.repeat(64)}.json`),
        )
      },
    ],
    [
      'scheduleWorkspaceMismatch',
      'invalid',
      async (root: string) => {
        await seedJob(root)
        const { file, doc, value } = await stateDocument(root)
        const schedules = recordOf(value['schedules'], 'state schedules')
        for (const schedule of Object.values(schedules))
          recordOf(schedule, 'stored schedule')['workspaceKey'] = 'elsewhere'
        await writeFile(file, JSON.stringify(doc))
      },
    ],
    [
      'scheduleOutcomeIdentityMissing',
      'invalid',
      async (root: string) => {
        await seedJob(root)
        const { file, doc, value } = await stateDocument(root)
        value['outcomes'] = { ghost: { baselineFailures: 0, heads: [] } }
        await writeFile(file, JSON.stringify(doc))
      },
    ],
    [
      'scheduleIndexRevisionMismatch',
      'invalid',
      async (root: string) => {
        await seedJob(root)
        const { file, doc, revision } = await stateDocument(root)
        await writeFile(file, JSON.stringify({ ...doc, revision: revision + 1 }))
      },
    ],
    [
      'scheduleIndexDeltaInvalid',
      'invalid',
      (root: string) =>
        forgeJournalOverflow(root, [{ collection: 'no-such-collection', key: 'x', value: 1 }]),
    ],
    [
      'scheduleJournalLimitExceeded',
      'invalid',
      (root: string) =>
        forgeJournalOverflow(root, [
          { collection: 'pending', key: 'pad', value: 'x'.repeat(300 * 1024) },
        ]),
    ],
    [
      '$ZodError',
      'invalid',
      async (root: string) => {
        await seedJob(root)
        await mkdir(path.join(root, FIXTURE_WORKSPACE_KEY, 'fires'), { recursive: true })
        await writeFile(
          path.join(root, FIXTURE_WORKSPACE_KEY, 'fires', `${'a'.repeat(64)}.json`),
          '{}',
        )
      },
    ],
    [
      'scheduleIndexMissing',
      'failed',
      async (root: string) => {
        await seedJob(root)
        const { file } = await stateDocument(root)
        await rm(file)
      },
    ],
    [
      'scheduleStorageLinkRefused',
      'failed',
      async (root: string) => {
        await mkdir(root, { recursive: true })
        await writeFile(path.join(root, FIXTURE_WORKSPACE_KEY), 'not a directory')
      },
    ],
  ]
  it.each(storedWordCases)('reads %s as %s', async (_word, expected, forge) => {
    await withSchedulesRoot('schedules-word-', async (root) => {
      await forge(root)
      expect(await codeOf(() => readerFor(root).read(context()))).toBe(expected)
    })
  })
})

describe('queue vocabulary coverage', () => {
  it('covers the source union and every emitted queue word exactly once', async () => {
    const file = path.resolve('src/runtime/schedules/nodeScheduleFs.ts')
    const source = await readFile(file, 'utf8')
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const declared = new Set<string>()
    const emitted = new Set<string>()
    const visit = (node: ts.Node) => {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === 'ScheduleQueueFailure' &&
        ts.isUnionTypeNode(node.type)
      ) {
        for (const member of node.type.types)
          if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal))
            declared.add(member.literal.text)
      }
      if (
        (ts.isNewExpression(node) && node.expression.getText(tree) === 'Error') ||
        (ts.isCallExpression(node) && node.expression.getText(tree) === 'scheduleQueueFailure')
      ) {
        const word = node.arguments?.[0]
        if (word !== undefined && ts.isStringLiteral(word) && word.text.startsWith('schedule'))
          emitted.add(word.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(declared.size).toBeGreaterThan(0)
    expect([...declared].toSorted(codeUnitCompare)).toEqual(
      Object.keys(SCHEDULE_QUEUE_FAILURES).toSorted(codeUnitCompare),
    )
    expect([...emitted].toSorted(codeUnitCompare)).toEqual([...declared].toSorted(codeUnitCompare))
  })

  it.each(Object.entries(SCHEDULE_QUEUE_FAILURES))(
    'classifies %s as %s',
    async (word, classification) => {
      const fs = new MemoryScheduleFs()
      const lock = vi.spyOn(fs, 'lock').mockRejectedValue(new Error(word))
      const factory = vi.spyOn(nodeSchedules, 'createNodeScheduleFs').mockReturnValue(fs)
      try {
        expect(await codeOf(() => readerFor('memory').read(context()))).toBe(
          classification === 'retry' ? 'busy' : classification,
        )
        expect(lock).toHaveBeenCalledTimes(
          classification === 'retry' ? SCHEDULE_FS_RETRY_ATTEMPTS : 1,
        )
      } finally {
        factory.mockRestore()
      }
    },
  )
})
