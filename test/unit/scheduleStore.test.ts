import { readFile, writeFile, readdir, mkdir, symlink } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createScheduleStore,
  scheduleStorageHash,
  isScheduleProcessAlive,
} from '../../src/core/schedules/store'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { schedulesFolder } from '../../src/runtime/dataFolder'
import {
  SCHEDULE_MAX_PER_WORKSPACE,
  SCHEDULE_OUTBOX_MAX_PENDING,
  SCHEDULE_MIN_INTERVAL_MS,
} from '../../src/shared/constants'
import { scheduleFireRecordSchema } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { removeFolder } from './helpers/temporaryFolders'
import {
  scheduleStateFile,
  seedScheduleIndex,
  schedulePointerFence,
  MemoryScheduleFs,
} from './helpers/schedules/storage'

const exec = promisify(execFile)
const root = mkdtempSync(path.join(tmpdir(), 'muse-m115-s-'))
const child = path.join(root, 'worker.cjs')
beforeAll(async () => {
  await build({
    stdin: {
      contents: String.raw`
        import { createScheduleStore } from './src/core/schedules/store';
        import { createNodeScheduleFs, createNodeScheduleQueue } from './src/runtime/schedules/nodeScheduleFs';
        const [directory, mode, value] = process.argv.slice(2);
        const fsPort = createNodeScheduleFs(directory);
        const store = createScheduleStore(fsPort);
        (async () => {
          let result;
          if (mode === 'claim') result = await store.claim(value);
          if (mode === 'admit') result = await store.admit(JSON.parse(value));
          if (mode === 'advance') result = await store.advance(JSON.parse(value));
          if (mode === 'update') result = await store.update(JSON.parse(value));
          if (mode === 'queueWait' || mode === 'queueProbe') {
            const fs = require('node:fs/promises');
            if (mode === 'queueProbe') await fs.writeFile(directory + '/probe-ready', '');
            await createNodeScheduleQueue(directory).serialize(value, async () => {
              await fs.appendFile(directory + '/order.txt', 'start\n');
              if (mode === 'queueWait') {
                for (;;) {
                  try { await fs.access(directory + '/release'); break; } catch {}
                  await new Promise(resolve => setTimeout(resolve, 10));
                }
              }
              await fs.appendFile(directory + '/order.txt', 'end\n');
            });
            result = true;
          }
          process.stdout.write(JSON.stringify(result));
        })().catch(() => { process.exitCode = 1; });
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    outfile: child,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
})
afterAll(async () => {
  await removeFolder(root)
})

async function worker(directory: string, mode: string, value: string): Promise<string> {
  const result = await exec(process.execPath, [child, directory, mode, value], {
    // Only the process launcher's OS prerequisite; no inherited credentials.
    env: { SystemRoot: process.env['SystemRoot'] },
  })
  return result.stdout
}

describe('M115 durable shared store', () => {
  it('uses the same schedules root on Windows, macOS and Linux', () => {
    expect(
      schedulesFolder({ platform: 'win32', homeDir: String.raw`C:\Users\test`, env: {} }),
    ).toBe(String.raw`C:\Users\test\AppData\Local\Muse Spark Code\schedules\v1`)
    expect(schedulesFolder({ platform: 'darwin', homeDir: '/home/test', env: {} })).toBe(
      '/home/test/Library/Application Support/Muse Spark Code/schedules/v1',
    )
    expect(
      schedulesFolder({
        platform: 'linux',
        homeDir: '/home/test',
        env: { XDG_DATA_HOME: '/data' },
      }),
    ).toBe('/data/muse-spark-code/schedules/v1')
  })
  it('isolates workspaces and never reuses an identifier after removal', async () => {
    const directory = path.join(root, 'identity')
    const store = createScheduleStore(createNodeScheduleFs(directory))
    const job = fakeSchedule()
    await store.create(job)
    expect(await store.list('workspace-2')).toEqual([])
    expect(await store.remove('workspace-2', job.id)).toBe(false)
    expect(await store.remove(job.workspaceKey, job.id)).toBe(true)
    await expect(store.create(job)).rejects.toThrow('AlreadyIssued')
    await expect(store.create({ ...job, workspaceKey: 'workspace-2' })).rejects.toThrow(
      'AlreadyIssued',
    )
    await expect(store.create(fakeSchedule({ id: 'nonzero', revision: 1 }))).rejects.toThrow(
      'RevisionInvalid',
    )
  })
  it('atomically compares revisions across two real processes and keeps revoked authority', async () => {
    const directory = path.join(root, 'cas')
    const store = createScheduleStore(createNodeScheduleFs(directory))
    const job = fakeSchedule({
      grant: {
        rules: [{ id: 'read', kind: 'tool', name: 'read_file' }],
        destinationIds: [],
        paidCapUsd: 0,
      },
    })
    await store.create(job)
    const outcomes = await Promise.all([
      worker(
        directory,
        'update',
        JSON.stringify({
          ...job,
          paused: true,
          grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
        }),
      ),
      worker(directory, 'update', JSON.stringify({ ...job, name: 'Changed name' })),
    ])
    expect(outcomes.toSorted((a, b) => a.localeCompare(b))).toEqual(['false', 'true'])
    const [current] = await store.list(job.workspaceKey)
    expect(current?.revision).toBe(1)
    expect(await store.update(job)).toBe(false)
    expect(await store.update({ ...job, id: 'missing' })).toBe(false)
    expect(await store.list(job.workspaceKey)).toEqual([current])
  })
  it('claims once across processes, crash, restart and schedule removal', async () => {
    const directory = path.join(root, 'claims')
    const runId = 'schedule-1:123'
    const outcomes = await Promise.all([
      worker(directory, 'claim', runId),
      worker(directory, 'claim', runId),
    ])
    expect(outcomes.toSorted((a, b) => a.localeCompare(b))).toEqual(['false', 'true'])
    const store = createScheduleStore(createNodeScheduleFs(directory))
    await store.create(fakeSchedule())
    await store.remove('workspace-1', 'schedule-1')
    expect(await store.claim(runId)).toBe(false)
    // The winning child ended without sending; a reopened process cannot replay it.
    expect(await worker(directory, 'claim', runId)).toBe('false')
    await store.create(fakeSchedule({ id: 'schedule-2' }))
    const longId = `schedule-2:github:${'🦜'.repeat(200)}`
    expect(await store.claim(longId)).toBe(true)
    expect(await store.claim(longId)).toBe(false)
    const names = await readdir(path.join(directory, 'claims'), { recursive: true })
    expect(names.every((name) => path.basename(name).length < 100)).toBe(true)
  })
  it('recovers an unpublished creation and ignores incomplete staging files', async () => {
    const directory = path.join(root, 'staging')
    const fs = createNodeScheduleFs(directory)
    const job = fakeSchedule()
    await fs.publish(
      `identifiers/${scheduleStorageHash(job.id)}.json`,
      JSON.stringify({
        id: job.id,
        workspaceKey: job.workspaceKey,
        creationHash: scheduleStorageHash(JSON.stringify(job)),
      }),
    )
    await fs.publish('workspace-1/index/0.json.writer.tmp', '{')
    const store = createScheduleStore(fs)
    await store.create(job)
    expect(await store.list(job.workspaceKey)).toEqual([job])
    await writeFile(path.join(directory, await scheduleStateFile(fs)), '{', 'utf8')
    await expect(store.list(job.workspaceKey)).rejects.toThrow()
  })
  it('enforces the workspace count even when two clients race the last slot', async () => {
    const directory = path.join(root, 'limit')
    const fs = createNodeScheduleFs(directory)
    const jobs = Array.from({ length: SCHEDULE_MAX_PER_WORKSPACE - 1 }, (_, count) =>
      fakeSchedule({ id: `job-${String(count)}` }),
    )
    await seedScheduleIndex(fs, jobs)
    const outcomes = await Promise.allSettled([
      createScheduleStore(fs).create(fakeSchedule({ id: 'last-a' })),
      createScheduleStore(createNodeScheduleFs(directory)).create(fakeSchedule({ id: 'last-b' })),
    ])
    expect(outcomes.map((result) => result.status).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(await createScheduleStore(fs).list('workspace-1')).toHaveLength(
      SCHEDULE_MAX_PER_WORKSPACE,
    )
  })
  it('serializes target batches in two real processes until their final settlement', async () => {
    const directory = path.join(root, 'queues')
    await createNodeScheduleFs(directory).publish('order.txt', '')
    const first = worker(directory, 'queueWait', 'workspace:session')
    await vi.waitFor(
      async () => {
        expect(await readFile(path.join(directory, 'order.txt'), 'utf8')).toBe('start\n')
      },
      { timeout: 120_000 },
    )
    const second = worker(directory, 'queueProbe', 'workspace:session')
    try {
      await vi.waitFor(() => readFile(path.join(directory, 'probe-ready')), { timeout: 120_000 })
      await delay(1000)
      expect(await readFile(path.join(directory, 'order.txt'), 'utf8')).toBe('start\n')
    } finally {
      await writeFile(path.join(directory, 'release'), '')
      await Promise.allSettled([first, second])
    }
    expect(await Promise.all([first, second])).toEqual(['true', 'true'])
    expect(await readFile(path.join(directory, 'order.txt'), 'utf8')).toBe(
      'start\nend\nstart\nend\n',
    )
    const queue = createNodeScheduleQueue(directory)
    await expect(
      queue.serialize('workspace:session', () => Promise.reject(new Error('failed'))),
    ).rejects.toThrow('failed')
    await queue.serialize('workspace:session', () => Promise.resolve())
  })
  it('refuses path traversal and stored workspace mismatches', async () => {
    const directory = path.join(root, 'boundary')
    const fs = createNodeScheduleFs(directory)
    await expect(fs.publish('../escape', '{}')).rejects.toThrow('PathRefused')
    await expect(fs.read('../escape')).rejects.toThrow('PathRefused')
    await seedScheduleIndex(fs, [fakeSchedule({ workspaceKey: 'wrong' })])
    await expect(createScheduleStore(fs).list('workspace-1')).rejects.toThrow('WorkspaceMismatch')
  })
  it('rejects a mismatched index envelope and mismatched fire filename', async () => {
    const directory = path.join(root, 'index-shape')
    const fs = createNodeScheduleFs(directory)
    await seedScheduleIndex(fs, [])
    await fs.replace(await scheduleStateFile(fs), JSON.stringify({ revision: 1, value: {} }))
    const store = createScheduleStore(fs)
    await expect(store.list('workspace-1')).rejects.toThrow('RevisionMismatch')
    const job = fakeSchedule()
    const fire = {
      runId: 'schedule-1:1',
      scheduleId: job.id,
      workspaceKey: job.workspaceKey,
      occurrenceMs: 1,
      observedAtMs: 2,
      target: job.target,
      delivery: job.delivery,
      outcome: 'ran',
      refusedActions: [],
      cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
    }
    await fs.publish('workspace-1/fires/abc.json', JSON.stringify({ fire, sequence: 0 }))
    await expect(store.fires('workspace-1')).rejects.toThrow('IdentityMismatch')
  })
  it('rejects an ownership swap while a target batch runs', async () => {
    const directory = path.join(root, 'queue-swap')
    const fs = createNodeScheduleFs(directory)
    const key = 'workspace:swap'
    await expect(
      createNodeScheduleQueue(directory).serialize(key, async () => {
        await fs.publish(`leases/${scheduleStorageHash(`target:${key}`)}.json.overtaken`, '')
        await vi.waitFor(
          async () => {
            await fs.replace(
              `leases/${scheduleStorageHash(`target:${key}`)}.json`,
              JSON.stringify({
                pid: process.pid,
                start: 0,
                token: '00000000-0000-4000-8000-000000000000',
                heartbeat: Date.now(),
              }),
            )
          },
          { timeout: 120_000 },
        )
      }),
    ).rejects.toThrow('OwnershipLost')
  })
  it('refuses storage junctions before creating or reading anything through them', async () => {
    const directory = path.join(root, 'junctions')
    const outside = path.join(root, 'junction-target')
    await mkdir(directory)
    await mkdir(outside)
    await symlink(outside, path.join(directory, 'workspace-1'), 'junction')
    const fs = createNodeScheduleFs(directory)
    await expect(fs.publish('workspace-1/index/0.json', '{}')).rejects.toThrow('LinkRefused')
    expect(await readdir(outside)).toEqual([])
    await expect(fs.names('workspace-1/index')).resolves.toEqual([])
    await expect(fs.names('workspace-1')).rejects.toThrow('LinkRefused')
    await writeFile(path.join(outside, 'data'), 'private')
    await expect(fs.read('workspace-1/data')).rejects.toThrow('LinkRefused')
    await symlink(path.join(outside, 'data'), path.join(directory, 'private-link'), 'file')
    await expect(fs.read('private-link')).rejects.toThrow('LinkRefused')
  })
  it('uses a trusted ancestor alias while refusing a linked storage root', async () => {
    const physical = path.join(root, 'physical-ancestor')
    const alias = path.join(root, 'trusted-ancestor')
    await mkdir(physical)
    await symlink(physical, alias, 'junction')
    const fs = createNodeScheduleFs(path.join(alias, 'storage'))
    expect(await fs.publish('index/0.json', 'complete')).toBe(true)
    expect(await readFile(path.join(physical, 'storage/index/0.json'), 'utf8')).toBe('complete')
    await expect(createNodeScheduleFs(alias).publish('outside.json', '{}')).rejects.toThrow(
      'LinkRefused',
    )
  })
  it('rejects unsafe revisions, vanished indices and inconsistent claim identities', async () => {
    const directory = path.join(root, 'journal-boundaries')
    const fs = createNodeScheduleFs(directory)
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    const originalRead = fs.read.bind(fs)
    const activeFile = await scheduleStateFile(fs)
    const read = vi
      .spyOn(fs, 'read')
      .mockImplementation(async (file) =>
        file === activeFile ? undefined : await originalRead(file),
      )
    // A vanished active pointer is corruption; the state file still exists.
    await expect(store.list(job.workspaceKey)).rejects.toThrow('IndexMissing')
    read.mockRestore()
    const pointerFence = await schedulePointerFence(fs)
    const current = JSON.parse((await fs.read(pointerFence)) ?? 'null')
    await fs.replace(pointerFence, JSON.stringify({ ...current, revision: 9_007_199_254_740_992 }))
    await expect(store.list(job.workspaceKey)).rejects.toThrow()
    const claimDirectory = path.join(root, 'claim-boundaries')
    const claims = createNodeScheduleFs(claimDirectory)
    const claimStore = createScheduleStore(claims)
    const intent = { schedule: job, runId: 'schedule-1:1', occurrenceMs: 1, advancesTime: false }
    await claimStore.admit(intent)
    const hash = scheduleStorageHash(intent.runId)
    const file = path.join(
      claimDirectory,
      'claims',
      scheduleStorageHash(job.id),
      hash.slice(0, 2),
      `${hash}.json`,
    )
    for (const claim of [{ runId: 'different-run', ownerPid: process.pid }]) {
      await writeFile(file, JSON.stringify(claim))
      await expect(claimStore.advance(intent)).rejects.toThrow('ClaimIdentityMismatch')
    }
  })
  it('never treats an inaccessible process as a dead owner', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('private OS detail'), { code: 'EPERM' })
    })
    try {
      expect(isScheduleProcessAlive(1)).toBe(true)
    } finally {
      kill.mockRestore()
    }
  })
  it('keeps cost, refusal and liability facts intact, refusing conflicting settlement', async () => {
    const directory = path.join(root, 'settlement')
    const store = createScheduleStore(createNodeScheduleFs(directory))
    const job = fakeSchedule()
    await store.create(job)
    const fire = scheduleFireRecordSchema.parse({
      runId: 'schedule-1:1',
      scheduleId: job.id,
      workspaceKey: job.workspaceKey,
      occurrenceMs: 1,
      observedAtMs: 2,
      target: job.target,
      delivery: job.delivery,
      outcome: 'failed',
      refusedActions: [{ actionClass: 'shell', tool: 'shell', reason: 'outside grant' }],
      cost: { usd: 0.2, certainty: 'unknown', retainedLiabilityUsd: 0.8 },
    })
    await store.record(fire)
    await store.record(fire)
    expect(await store.fires(job.workspaceKey)).toEqual([fire])
    expect(await store.fires('workspace-2')).toEqual([])
    await expect(store.record({ ...fire, cost: { ...fire.cost, usd: 0 } })).rejects.toThrow(
      'SettlementConflict',
    )
    const [current] = await store.list(job.workspaceKey)
    expect(current?.consecutiveFailures).toBe(1)
    const newer = { ...fire, runId: 'schedule-1:10', occurrenceMs: 10, outcome: 'ran' as const }
    await store.record(newer)
    await store.record({ ...fire, runId: 'schedule-1:3', occurrenceMs: 3 })
    await store.record({ ...fire, runId: 'schedule-1:4', occurrenceMs: 4 })
    const list = await store.list(job.workspaceKey)
    expect(list[0]).toMatchObject({ consecutiveFailures: 0, paused: false })
    await store.remove(job.workspaceKey, job.id)
    expect(await store.fires(job.workspaceKey)).toHaveLength(4)
  })
  it('recovers dead process intents but never steals work from a live owner', async () => {
    const directory = path.join(root, 'intent')
    const store = createScheduleStore(createNodeScheduleFs(directory))
    const job = fakeSchedule()
    await store.create(job)
    const intent = {
      schedule: job,
      runId: 'schedule-1:123',
      occurrenceMs: 123,
      advancesTime: false,
    }
    expect(await worker(directory, 'admit', JSON.stringify(intent))).toBe('true')
    expect(await store.abandoned(job.workspaceKey)).toEqual([intent])
    const live = { ...intent, runId: 'schedule-1:124' }
    expect(await store.admit(live)).toBe(true)
    expect(await store.abandoned(job.workspaceKey)).toEqual([intent])
    await store.advance(intent)
    await store.advance(intent)
    const [current] = await store.list(job.workspaceKey)
    expect(current?.fireCount).toBe(1)
    expect(await store.admit(intent)).toBe(false)
  })
  it('orders failures by admission even when manual wall time moves backward', async () => {
    const store = createScheduleStore(createNodeScheduleFs(path.join(root, 'failure-clock')))
    const job = fakeSchedule()
    await store.create(job)
    const earlier = {
      schedule: job,
      runId: 'schedule-1:earlier',
      occurrenceMs: 200,
      advancesTime: false,
    }
    const later = { ...earlier, runId: 'schedule-1:later', occurrenceMs: 100 }
    for (const intent of [earlier, later]) {
      await store.admit(intent)
      await store.advance(intent)
    }
    const base = {
      scheduleId: job.id,
      workspaceKey: job.workspaceKey,
      observedAtMs: 300,
      target: job.target,
      delivery: job.delivery,
      refusedActions: [],
      cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
    }
    await store.record(
      scheduleFireRecordSchema.parse({
        ...base,
        runId: later.runId,
        occurrenceMs: later.occurrenceMs,
        outcome: 'ran',
      }),
    )
    await store.record(
      scheduleFireRecordSchema.parse({
        ...base,
        runId: earlier.runId,
        occurrenceMs: earlier.occurrenceMs,
        outcome: 'failed',
      }),
    )
    const jobs = await store.list(job.workspaceKey)
    expect(jobs[0]).toMatchObject({
      consecutiveFailures: 0,
      paused: false,
    })
  })
  it('enforces after-N in two real processes and permanently refuses declined or removed runs', async () => {
    const directory = path.join(root, 'admission-limit')
    const store = createScheduleStore(createNodeScheduleFs(directory))
    const job = fakeSchedule({ end: { afterRuns: 1 } })
    await store.create(job)
    const first = { schedule: job, runId: 'schedule-1:first', occurrenceMs: 1, advancesTime: false }
    const second = { ...first, runId: 'schedule-1:second' }
    for (const intent of [first, second]) await store.admit(intent)
    const results = await Promise.all(
      [first, second].map((intent) => worker(directory, 'advance', JSON.stringify(intent))),
    )
    expect(results.toSorted((a, b) => a.localeCompare(b))).toEqual(['false', 'true'])
    const declined = results[0] === 'false' ? first : second
    const [current] = await store.list(job.workspaceKey)
    expect(current?.fireCount).toBe(1)
    await store.update({ ...current!, end: { afterRuns: 2 } })
    expect(await store.advance(declined)).toBe(false)
    const removed = { ...first, runId: 'schedule-1:removed' }
    await store.admit(removed)
    await store.remove(job.workspaceKey, job.id)
    expect(await store.advance(removed)).toBe(false)
  })
  it('never regresses a newer time cursor during crash recovery or confuses it with a manual wall time', async () => {
    const directory = path.join(root, 'cursor')
    const store = createScheduleStore(createNodeScheduleFs(directory))
    const job = fakeSchedule()
    await store.create(job)
    const newer = {
      schedule: job,
      runId: 'schedule-1:200',
      occurrenceMs: 200,
      advancesTime: true,
      nextFireAtMs: 300,
    }
    const older = { ...newer, runId: 'schedule-1:100', occurrenceMs: 100, nextFireAtMs: 200 }
    await store.admit(newer)
    await store.admit(older)
    await store.advance(newer)
    await store.advance(older)
    let jobs = await store.list(job.workspaceKey)
    expect(jobs[0]).toMatchObject({ fireCount: 1, nextFireAtMs: 300 })
    const manual = {
      ...newer,
      runId: 'schedule-1:manual',
      occurrenceMs: 1000,
      advancesTime: false,
    }
    await store.admit(manual)
    await store.advance(manual)
    const next = {
      ...newer,
      schedule: jobs[0]!,
      runId: 'schedule-1:300',
      occurrenceMs: 300,
      nextFireAtMs: 400,
    }
    await store.admit(next)
    await store.advance(next)
    jobs = await store.list(job.workspaceKey)
    expect(jobs[0]).toMatchObject({ fireCount: 3, nextFireAtMs: 400, lastFireAtMs: 1000 })
  })
  it('never advances an unclaimed or mismatched run and never quotes private corrupt JSON', async () => {
    const directory = path.join(root, 'run-boundary')
    const fs = createNodeScheduleFs(directory)
    const store = createScheduleStore(fs)
    const job = fakeSchedule()
    await store.create(job)
    const intent = {
      schedule: job,
      runId: 'schedule-1:123',
      occurrenceMs: 123,
      advancesTime: false,
    }
    await expect(store.advance(intent)).rejects.toThrow('NotClaimed')
    await store.admit(intent)
    await expect(store.advance({ ...intent, occurrenceMs: 124 })).rejects.toThrow('IntentMismatch')
    const [current] = await store.list(job.workspaceKey)
    expect(current?.fireCount).toBe(0)
    await writeFile(path.join(directory, await scheduleStateFile(fs)), 'private phrase')
    await expect(store.list(job.workspaceKey)).rejects.toThrow('scheduleStoredJsonInvalid')
  })
  it('refuses more than the bounded pending outbox without changing committed state', async () => {
    const fs = new MemoryScheduleFs()
    const job = fakeSchedule()
    await seedScheduleIndex(fs, [job])
    const file = await scheduleStateFile(fs)
    const pending = Object.fromEntries(
      Array.from({ length: SCHEDULE_OUTBOX_MAX_PENDING }, (_value, index) => {
        const runId = `${job.id}:queued-${String(index)}`
        return [
          runId,
          {
            ownerPid: process.pid,
            intent: { runId, schedule: job, occurrenceMs: index, advancesTime: false },
          },
        ]
      }),
    )
    await fs.replace(
      file,
      JSON.stringify({
        revision: 0,
        value: {
          schedules: { [job.id]: job },
          pending,
          timeCursors: {},
          migrations: {},
          retirements: {},
        },
      }),
    )
    const before = fs.bytes()
    await expect(
      createScheduleStore(fs).admit({
        runId: `${job.id}:overflow`,
        schedule: job,
        occurrenceMs: 0,
        advancesTime: false,
      }),
    ).rejects.toThrow('OutboxLimit')
    expect(fs.bytes()).toBe(before)
  })
  it.each(['__proto__', 'constructor', 'prototype'])(
    'refuses the reserved map identifier %s before any write',
    async (id) => {
      const fs = new MemoryScheduleFs()
      await expect(createScheduleStore(fs).create(fakeSchedule({ id }))).rejects.toThrow()
      expect(fs.files.size).toBe(0)
    },
  )
  it('keeps only the current time cursor after repeated trigger edits without reopening prior identities', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const initial = fakeSchedule()
    await store.create(initial)
    for (let run = 1; run <= 100; run += 1) {
      const [current] = await store.list(initial.workspaceKey)
      const occurrenceMs = initial.createdAtMs + run * SCHEDULE_MIN_INTERVAL_MS
      await store.update({
        ...current!,
        trigger: { kind: 'interval', everyMs: SCHEDULE_MIN_INTERVAL_MS, anchorMs: occurrenceMs },
        nextFireAtMs: occurrenceMs,
      })
      const [schedule] = await store.list(initial.workspaceKey)
      const intent = {
        schedule: schedule!,
        runId: `${initial.id}:${String(occurrenceMs)}`,
        occurrenceMs,
        advancesTime: true,
      }
      await store.admit(intent)
      expect(await store.advance(intent)).toBe(true)
      await store.record({
        runId: intent.runId,
        scheduleId: initial.id,
        workspaceKey: initial.workspaceKey,
        occurrenceMs,
        observedAtMs: occurrenceMs,
        target: initial.target,
        delivery: initial.delivery,
        outcome: 'ran',
        refusedActions: [],
        cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
      })
    }
    const file = await scheduleStateFile(fs)
    const snapshot = z
      .object({ value: z.object({ timeCursors: z.record(z.string(), z.number()) }) })
      .parse(JSON.parse(fs.files.get(file) ?? 'null'))
    expect(Object.keys(snapshot.value.timeCursors).length).toBeLessThanOrEqual(1)
    expect(
      await store.claim(`${initial.id}:${String(initial.createdAtMs + SCHEDULE_MIN_INTERVAL_MS)}`),
    ).toBe(false)
  })
})
