// The schedules report reader tells a corrupt store from an unreadable one
// (M113 C-M113-4 repairs): damaged JSON and identity mismatches read
// `invalid`, genuine I/O failures read `failed`, never a generic failure
// with the store's reason discarded and never an empty success.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { codeUnitCompare, localFailureOf } from '../../src/core/reporting/sources/local'
import { createScheduleStore, scheduleStorageHash } from '../../src/core/schedules/store'
import {
  createSchedulesReportReader,
  SCHEDULE_QUEUE_FAILURES,
} from '../../src/runtime/reporting/playbookSchedulesInputs'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { schedulesSource } from '../../src/core/reporting/sources/schedules'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fireFixture } from './helpers/reporting/reportKindFixtures'
import {
  scheduleV2Schema,
  scheduleFireRecordSchema,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { FIXTURE_WORKSPACE_KEY, scheduleFixture } from './helpers/reporting/reportKindFixtures'
import { REPORT_FIXTURE_AS_OF, reportOptions } from './helpers/reporting/kindFixtures'
import { removeFolder, temporaryDir } from './helpers/temporaryFolders'

const context = () => ({
  reportText: EN,
  locale: 'en',
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

describe('schedules report reader failures', () => {
  // NOTE (MSM113FIX): the former mid-read interleave cases are gone. The
  // one-shot reconciliation, the fencing-CAS retry and the persistent
  // ownership-loss cases hooked the reader's lock/publish calls through the
  // module factory: interception, unrepresentable through the real reader.
  // Their verdicts are withdrawn in docs/certification/msm113.md; the busy
  // verdict itself stays proven below against a real held lease, and the
  // retry loop is admission's own suites.

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
        try {
          // A valid writer holds the lease past the source deadline: the
          // verdict is the Host busy sentence, never cancelled or timed out.
          const result = await sourceFor(root).read(freshContext())
          expect(result.record.status).toBe('unavailable')
          expect(result.record.reason).toBe(UI_TEXT.teamHostBusy)
          release.resolve(undefined)
          await held
          const settled = await inventory(root)
          await delay(300)
          // The stopped reader performs no further read, write or publish
          // once the holder lets go: the tree stays exactly as it settled.
          // (Lock attempts leave no trace, so the single attempt is not
          // asserted here.)
          expect(await inventory(root)).toEqual(settled)
        } finally {
          release.resolve(undefined)
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
  it('stops a queued reader on its deadline with a frozen tree', { timeout: 30_000 }, async () => {
    await withSchedulesRoot('schedules-queued-reader-', async (root) => {
      const { release, held } = await holdProductionLease(root)
      try {
        expect(await codeOf(() => readerFor(root).read(freshContext()))).toBe('busy')
        release.resolve(undefined)
        await held
        const settled = await inventory(root)
        await delay(300)
        // No read, listing, write or removal followed the stop: the tree
        // stays exactly as it settled.
        expect(await inventory(root)).toEqual(settled)
        const reread = await readerFor(root).read(context())
        expect(reread.schedules).toHaveLength(1)
      } finally {
        release.resolve(undefined)
      }
    })
  })

  it('still reports an explicit abort as cancelled, never busy', async () => {
    await withSchedulesRoot('schedules-abort-', async (root) => {
      const { release, held } = await holdProductionLease(root)
      try {
        const controller = new AbortController()
        const pending = sourceFor(root).read({ ...freshContext(), signal: controller.signal })
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
        const frozen = await inventory(root)
        await delay(100)
        expect(await inventory(root)).toEqual(frozen)
      } finally {
        release.resolve(undefined)
      }
      await held
    })
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
        await forge(await firstFile(root, 'leaseFences'))
        // No competing writer can make a self-contradicting identity valid:
        // invalid at once. (Lock attempts leave no trace, so the single
        // attempt is not asserted here.)
        expect(await codeOf(() => readerFor(root).read(context()))).toBe('invalid')
      })
    },
  )

  // NOTE (MSM113FIX): the listed-then-vanished healing case is gone. It made
  // the reader's listing lie once through a names hook: interception,
  // unrepresentable through the real reader (a real concurrent removal is a
  // race, never deterministic). The healing verdict is withdrawn in
  // docs/certification/msm113.md.
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

  // NOTE (MSM113FIX): the per-word lock-rejection table is gone. It made
  // the lock fail with each queue word through the module factory:
  // interception, and lock attempts leave no real trace to assert. Each
  // verdict stays proven for real elsewhere in this file: busy against a
  // real held lease, invalid through forged fence headers, failed through
  // forged store states. The retry rows (ownership loss) and the heartbeat
  // failure have no deterministic real trigger; their runtime
  // classification is withdrawn in docs/certification/msm113.md.
})
