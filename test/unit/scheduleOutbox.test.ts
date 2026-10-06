import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { createScheduler } from '../../src/core/schedules/scheduler'
import {
  createScheduleStore,
  scheduleStorageHash,
  type ScheduleRunIntent,
  type ScheduleRunJournalPort,
} from '../../src/core/schedules/store'
import {
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_RECONCILE_MAX_RUNS,
  SCHEDULE_AUDIT_MAX_AGE_MS,
  SCHEDULE_POLL_INTERVAL_MS,
  SCHEDULE_PAUSE_AFTER_FAILURES,
  SCHEDULE_OUTBOX_MAX_PENDING,
  SCHEDULE_FENCE_GRACE_MS,
} from '../../src/shared/constants'
import type { ScheduleFireRecord, ScheduleV2 } from '../../src/shared/scheduleV2'
import { MemoryScheduleFs, scheduleStateFile } from './helpers/schedules/storage'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleClock } from './helpers/schedules/clock'
import { FakeScheduleHost } from './helpers/schedules/host'
import { FakeScheduleDisk } from './helpers/schedules/store'

async function fixture() {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const job = fakeSchedule()
  await store.create(job)
  const clock = new FakeScheduleClock(job.nextFireAtMs!)
  const host = new FakeScheduleHost(clock)
  host.workspaces.add(job.workspaceKey)
  const failureSettlement = vi.fn((intent: ScheduleRunIntent) =>
    Promise.resolve(fireOf(intent, host.now(), 'failed')),
  )
  const deps = {
    store,
    runs: store,
    host,
    queue: {
      serialize: async (key: string, work: () => Promise<void>) => {
        await delay(0)
        await fs.lock(key, async () => {
          await work()
        })
      },
    },
    time: {
      plan: (schedule: typeof job) => ({
        missed: false,
        ...(schedule.nextFireAtMs !== undefined && { occurrenceMs: schedule.nextFireAtMs }),
      }),
    },
    failureSettlement,
    deferEvent: () => Promise.resolve(),
  }
  const intent = {
    schedule: job,
    runId: `${job.id}:${String(job.nextFireAtMs)}`,
    occurrenceMs: job.nextFireAtMs!,
    advancesTime: true,
    missed: false,
  }
  return { fs, store, host, clock, job, intent, deps, scheduler: createScheduler(deps) }
}
// Scheduling bounds/order are exercised without repeatedly parsing the entire
// production journal; the other outbox cases own durable publication cuts.
async function dispatchFixture() {
  const disk = new FakeScheduleDisk()
  const store = disk.client()
  const job = fakeSchedule()
  await store.create(job)
  const clock = new FakeScheduleClock(job.nextFireAtMs!)
  const host = new FakeScheduleHost(clock)
  host.workspaces.add(job.workspaceKey)
  const entries = new Map<string, ScheduleRunIntent>()
  const runs: ScheduleRunJournalPort = {
    admit: (intent) => {
      entries.set(intent.runId, intent)
      return Promise.resolve(true)
    },
    advance: () => Promise.resolve(true),
    pending: () =>
      Promise.resolve(
        Array.from(entries, ([, intent]) => intent).toSorted(
          (a, b) =>
            a.schedule.createdAtMs - b.schedule.createdAtMs ||
            a.schedule.id.localeCompare(b.schedule.id) ||
            a.runId.localeCompare(b.runId),
        ),
      ),
    abandoned: () => Promise.resolve([]),
    acknowledge: () => Promise.resolve(),
    acknowledged: () => Promise.resolve(undefined),
    maintain: () => Promise.resolve(),
  }
  const record = store.record.bind(store)
  vi.spyOn(store, 'record').mockImplementation(async (fire) => {
    await record(fire)
    entries.delete(fire.runId)
  })
  const scheduler = createScheduler({
    store,
    runs,
    host,
    queue: {
      serialize: async (_key, work) => {
        await work()
      },
    },
    time: { plan: () => ({ missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: (intent) => Promise.resolve(fireOf(intent, host.now(), 'failed')),
  })
  const intent = {
    schedule: job,
    runId: `${job.id}:1`,
    occurrenceMs: job.nextFireAtMs!,
    advancesTime: false,
  }
  return { store, host, scheduler, job, entries, intent }
}
function fireOf(
  intent: ScheduleRunIntent,
  now: number,
  outcome: ScheduleFireRecord['outcome'] = 'ran',
): ScheduleFireRecord {
  const { id: scheduleId, workspaceKey, target, delivery } = intent.schedule
  return {
    scheduleId,
    workspaceKey,
    target,
    delivery,
    runId: intent.runId,
    occurrenceMs: intent.occurrenceMs,
    observedAtMs: now,
    outcome,
    refusedActions: [],
    cost: { usd: 0.2, certainty: 'unknown', retainedLiabilityUsd: 0.8 },
    ...(intent.event !== undefined && { event: intent.event }),
  }
}
async function failedPoll(
  scheduler: ReturnType<typeof createScheduler>,
  workspaceKey: string,
  message: string,
) {
  await expect(scheduler.poll(workspaceKey)).rejects.toThrow(message)
}
async function seedInitialState(fs: MemoryScheduleFs, fields: Record<string, unknown>) {
  const file = await scheduleStateFile(fs)
  const state = z
    .object({ revision: z.int(), value: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse((await fs.read(file)) ?? 'null'))
  await fs.replace(file, JSON.stringify({ ...state, value: { ...state.value, ...fields } }))
}
function failNextDelta(fs: MemoryScheduleFs, workspaceKey: string, message: string) {
  const publish = fs.publish.bind(fs)
  let isFailed = false
  vi.spyOn(fs, 'publish').mockImplementation(async (file, content, guard) => {
    if (
      !isFailed &&
      file.startsWith(`${workspaceKey}/index/`) &&
      /\/\d+\.json$/.test(file) &&
      !content.includes('"changes":[]')
    ) {
      isFailed = true
      throw new Error(message)
    }
    return await publish(file, content, guard)
  })
}
async function assertSingleSettlement(
  store: ReturnType<typeof createScheduleStore>,
  host: FakeScheduleHost,
  workspaceKey: string,
) {
  expect(host.deliveries).toHaveLength(1)
  expect(await store.fires(workspaceKey)).toHaveLength(1)
  const [counted] = await store.list(workspaceKey)
  expect(counted?.fireCount).toBe(1)
  expect(await store.pending(workspaceKey)).toEqual([])
}
describe('schedule outbox reconciliation', () => {
  it('retries a failed advance while the claiming process is still alive', async () => {
    const { store, scheduler, host, job } = await fixture()
    vi.spyOn(store, 'advance').mockRejectedValueOnce(new Error('advance failed'))
    await failedPoll(scheduler, job.workspaceKey, 'advance failed')
    expect(await store.abandoned(job.workspaceKey)).toEqual([])
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
    await scheduler.poll(job.workspaceKey)
    await assertSingleSettlement(store, host, job.workspaceKey)
  })
  it('retains final liability across record failure and a scheduler restart', async () => {
    const { store, scheduler, host, deps, intent, job } = await fixture()
    host.result = fireOf(intent, host.now())
    vi.spyOn(store, 'record').mockRejectedValueOnce(new Error('record failed'))
    await expect(scheduler.poll(job.workspaceKey)).rejects.toThrow('record failed')
    await createScheduler(deps).poll(job.workspaceKey)
    expect(host.deliveries).toHaveLength(1)
    expect(await store.fires(job.workspaceKey)).toEqual([host.result])
    expect(await store.pending(job.workspaceKey)).toEqual([])
  })
  it('finds an intent abandoned after a surviving host has already recovered', async () => {
    const { store, scheduler, host, job, intent } = await fixture()
    await scheduler.recover(job.workspaceKey)
    await store.admit(intent)
    await scheduler.poll(job.workspaceKey)
    expect(host.deliveries).toHaveLength(1)
    expect(await store.pending(job.workspaceKey)).toEqual([])
  })
  it('reconciles an intent added after startup on the next timer tick without restarting the host', async () => {
    const { store, scheduler, host, job, intent, deps } = await fixture()
    vi.spyOn(deps.time, 'plan').mockReturnValue({ missed: false })
    vi.spyOn(deps.queue, 'serialize').mockImplementation(async (_key, work) => {
      await work()
    })
    vi.useFakeTimers()
    const errors = vi.fn()
    const handle = scheduler.start(() => [job.workspaceKey], errors)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(host.deliveries).toEqual([])
      await store.admit(intent)
      await vi.advanceTimersByTimeAsync(SCHEDULE_POLL_INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(0)
      expect(host.deliveries).toHaveLength(1)
      expect(await store.pending(job.workspaceKey)).toEqual([])
      expect(errors).not.toHaveBeenCalled()
    } finally {
      handle.dispose()
      vi.useRealTimers()
    }
  })
  it.each([
    'beforeIntent',
    'intentBeforeFence',
    'claimBeforeAdvance',
    'advanceBeforeTarget',
    'finalBeforeAck',
    'ackBeforeSettle',
    'auditBeforeSettle',
    'settledBeforeReturn',
  ] as const)(
    'recovers a crash at %s with exactly one admission and one accounting increment',
    async (step) => {
      const { fs, store, host, intent, job, deps } = await fixture()
      if (step === 'intentBeforeFence') {
        const publish = fs.publish.bind(fs)
        let isFailed = false
        vi.spyOn(fs, 'publish').mockImplementation(async (file, content, guard) => {
          if (!isFailed && file.startsWith('claims/')) {
            isFailed = true
            throw new Error('crash before fence')
          }
          return await publish(file, content, guard)
        })
        await expect(store.admit(intent)).rejects.toThrow('crash before fence')
      } else if (step !== 'beforeIntent') await store.admit(intent)
      if (!['beforeIntent', 'intentBeforeFence', 'claimBeforeAdvance'].includes(step))
        await store.advance(intent)
      const fire = fireOf(intent, host.now())
      if (
        ['finalBeforeAck', 'ackBeforeSettle', 'auditBeforeSettle', 'settledBeforeReturn'].includes(
          step,
        )
      ) {
        host.result = fire
        await host.deliver(
          job,
          {
            unattended: true,
            scheduleId: job.id,
            runId: intent.runId,
            grant: job.grant,
            creator: job.creator,
            mode: job.mode,
            depth: job.depth,
            allowAgentReschedule: job.allowAgentReschedule,
          },
          intent.occurrenceMs,
        )
      }
      if (['ackBeforeSettle', 'auditBeforeSettle', 'settledBeforeReturn'].includes(step))
        await store.acknowledge(fire)
      if (step === 'auditBeforeSettle') {
        failNextDelta(fs, job.workspaceKey, 'crash before settle')
        await expect(store.record(fire)).rejects.toThrow('crash before settle')
      } else if (step === 'settledBeforeReturn') {
        await store.record(fire)
        expect(await store.admit(intent)).toBe(false)
      }
      const restarted = createScheduler(deps)
      await restarted.poll(job.workspaceKey)
      await restarted.poll(job.workspaceKey)
      await assertSingleSettlement(store, host, job.workspaceKey)
    },
  )
  it('leaves a definitely unsent delivery failure pending and retries it once', async () => {
    const { host, store, scheduler, job, deps } = await fixture()
    vi.spyOn(host, 'deliver').mockRejectedValueOnce(new Error('no target admission'))
    await failedPoll(scheduler, job.workspaceKey, 'no target admission')
    expect(await store.fires(job.workspaceKey)).toEqual([])
    await scheduler.poll(job.workspaceKey)
    expect(host.deliveries).toHaveLength(1)
    expect(deps.failureSettlement).not.toHaveBeenCalled()
  })
  it('never resends a dispatched request whose response was lost and retains its uncertain liability', async () => {
    const { host, store, scheduler, intent, job } = await fixture()
    const delivery = vi.spyOn(host, 'deliver')
    await store.admit(intent)
    await store.advance(intent)
    const uncertain = fireOf(intent, host.now(), 'failed')
    host.ledger.set(intent.runId, { status: 'uncertain', fire: uncertain })
    await scheduler.poll(job.workspaceKey)
    await scheduler.poll(job.workspaceKey)
    expect(host.deliveries).toEqual([])
    expect(delivery).not.toHaveBeenCalled()
    expect(await store.fires(job.workspaceKey)).toEqual([uncertain])
    const [counted] = await store.list(job.workspaceKey)
    expect(counted?.fireCount).toBe(1)
  })
  it('waits for acknowledged target work and reconciles its eventual settlement without a second delivery', async () => {
    const { host, store, scheduler, intent, job } = await fixture()
    const delivery = vi.spyOn(host, 'deliver')
    await store.admit(intent)
    await store.advance(intent)
    host.ledger.set(intent.runId, { status: 'admitted' })
    await scheduler.recover(job.workspaceKey)
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
    host.ledger.set(intent.runId, { status: 'settled', fire: fireOf(intent, host.now()) })
    await scheduler.poll(job.workspaceKey)
    expect(host.deliveries).toEqual([])
    expect(delivery).not.toHaveBeenCalled()
    expect(await store.pending(job.workspaceKey)).toEqual([])
  })
  it('recovers final-before-ack storage failure by looking up the target run id', async () => {
    const { host, store, scheduler, deps, job } = await fixture()
    vi.spyOn(store, 'acknowledge').mockRejectedValueOnce(new Error('ack failed'))
    await expect(scheduler.poll(job.workspaceKey)).rejects.toThrow('ack failed')
    await createScheduler(deps).poll(job.workspaceKey)
    expect(host.deliveries).toHaveLength(1)
    expect(await store.pending(job.workspaceKey)).toEqual([])
  })
  it('keeps a target-owned admitted run pending when delivery throws before its final response', async () => {
    const { host, store, scheduler, deps, job, intent } = await fixture()
    const delivery = vi.spyOn(host, 'deliver').mockImplementationOnce(() => {
      host.ledger.set(intent.runId, { status: 'admitted' })
      return Promise.reject(new Error('target response interrupted'))
    })
    await expect(scheduler.poll(job.workspaceKey)).rejects.toThrow('target response interrupted')
    expect(await store.fires(job.workspaceKey)).toEqual([])
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
    expect(deps.failureSettlement).not.toHaveBeenCalled()
    await scheduler.poll(job.workspaceKey)
    expect(delivery).toHaveBeenCalledTimes(1)
    const final = fireOf(intent, host.now())
    host.ledger.set(intent.runId, { status: 'settled', fire: final })
    await scheduler.poll(job.workspaceKey)
    expect(await store.fires(job.workspaceKey)).toEqual([final])
    expect(delivery).toHaveBeenCalledTimes(1)
  })
  it('refuses exact accounting on an uncertain ledger response and records corrected liability without sending', async () => {
    const { host, store, scheduler, job, intent } = await fixture()
    await store.admit(intent)
    const delivery = vi.spyOn(host, 'deliver')
    const uncertain = fireOf(intent, host.now(), 'failed')
    host.ledger.set(intent.runId, {
      status: 'uncertain',
      fire: { ...uncertain, cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 } },
    })
    await expect(scheduler.recover(job.workspaceKey)).rejects.toThrow()
    expect(await store.fires(job.workspaceKey)).toEqual([])
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
    host.ledger.set(intent.runId, { status: 'uncertain', fire: uncertain })
    await scheduler.recover(job.workspaceKey)
    expect(await store.fires(job.workspaceKey)).toEqual([uncertain])
    expect(delivery).not.toHaveBeenCalled()
  })
  it('orders concurrent younger-first singleton batches from two schedulers by creation time then id', async () => {
    const { store, host, deps, job, clock } = await fixture()
    await store.remove(job.workspaceKey, job.id)
    const trigger: ScheduleV2['trigger'] = {
      kind: 'event',
      source: 'git',
      event: 'branchUpdated',
      conditions: [],
    }
    const older = fakeSchedule({ id: 'old', trigger })
    const tied = fakeSchedule({ id: 'a-tied', trigger })
    const younger = fakeSchedule({ id: 'young', trigger, createdAtMs: older.createdAtMs + 1 })
    for (const schedule of [older, tied, younger]) await store.create(schedule)
    const event = {
      source: 'git',
      kind: 'branchUpdated',
      eventKey: 'ref-1',
      fields: {},
      observedAt: clock.now(),
    }
    await Promise.all([
      createScheduler(deps).fireEvent(job.workspaceKey, younger.id, event, clock.now()),
      createScheduler(deps).fireEvent(job.workspaceKey, older.id, event, clock.now()),
      createScheduler(deps).fireEvent(job.workspaceKey, tied.id, event, clock.now()),
    ])
    expect(host.deliveries.map((entry) => entry.schedule.id)).toEqual(['a-tied', 'old', 'young'])
  })
  it('rejects a queued time candidate superseded by another host while accounting already dispatched recovery idempotently', async () => {
    const { store, host, deps, job, intent, clock } = await fixture()
    await store.update({
      ...job,
      trigger: {
        kind: 'interval',
        anchorMs: intent.occurrenceMs,
        everyMs: SCHEDULE_MIN_INTERVAL_MS,
      },
    })
    const [schedule] = await store.list(job.workspaceKey)
    const older = {
      ...intent,
      schedule: schedule!,
      nextFireAtMs: intent.occurrenceMs + SCHEDULE_MIN_INTERVAL_MS,
    }
    const newer = {
      ...older,
      runId: `${job.id}:${String(older.occurrenceMs + 3 * SCHEDULE_MIN_INTERVAL_MS)}`,
      occurrenceMs: older.occurrenceMs + 3 * SCHEDULE_MIN_INTERVAL_MS,
      nextFireAtMs: older.occurrenceMs + 4 * SCHEDULE_MIN_INTERVAL_MS,
    }
    await store.admit(older)
    await store.admit(newer)
    expect(await store.advance(newer)).toBe(true)
    const final = fireOf(newer, clock.now())
    host.ledger.set(newer.runId, { status: 'settled', fire: final })
    clock.advance(3 * SCHEDULE_MIN_INTERVAL_MS)
    await createScheduler(deps).recover(job.workspaceKey)
    expect(host.deliveries).toEqual([])
    const records = await store.fires(job.workspaceKey)
    expect(records.find((fire) => fire.runId === older.runId)?.outcome).toBe('skipped')
    const [counted] = await store.list(job.workspaceKey)
    expect(counted).toMatchObject({
      fireCount: 1,
      nextFireAtMs: newer.nextFireAtMs,
    })
    expect(await store.advance(newer)).toBe(true)
  })
  it('bounds reconciliation work across many targets per poll', async () => {
    const { store, scheduler, host, job, intent, entries } = await dispatchFixture()
    for (let index = 0; index < SCHEDULE_RECONCILE_MAX_RUNS + 1; index += 1) {
      const schedule = fakeSchedule({
        id: `extra-${String(index)}`,
        target: {
          kind: 'conversation',
          backend: 'modelApi',
          sessionId: `session-${String(index)}`,
        },
      })
      await store.create(schedule)
      const runId = `${schedule.id}:1`
      entries.set(runId, { ...intent, schedule, runId, advancesTime: false })
    }
    await scheduler.recover(job.workspaceKey)
    expect(host.deliveries).toHaveLength(SCHEDULE_RECONCILE_MAX_RUNS)
    expect(entries.size).toBe(1)
  })
  it('round-robins past a blocked old target and reaches every independent target', async () => {
    const { store, scheduler, host, job, intent, entries } = await dispatchFixture()
    for (let index = 0; index < SCHEDULE_RECONCILE_MAX_RUNS; index += 1) {
      const runId = `${job.id}:blocked-${String(index).padStart(2, '0')}`
      entries.set(runId, { ...intent, runId, advancesTime: false })
    }
    const blockedId = `${job.id}:blocked-00`
    host.ledger.set(blockedId, { status: 'admitted' })
    for (let index = 0; index < SCHEDULE_RECONCILE_MAX_RUNS + 1; index += 1) {
      const schedule = fakeSchedule({
        id: `healthy-${String(index)}`,
        createdAtMs: job.createdAtMs + 1,
        target: {
          kind: 'conversation',
          backend: 'modelApi',
          sessionId: `healthy-${String(index)}`,
        },
      })
      await store.create(schedule)
      const runId = `${schedule.id}:1`
      entries.set(runId, { ...intent, schedule, runId, advancesTime: false })
    }
    for (let poll = 0; poll < 3; poll += 1) await scheduler.recover(job.workspaceKey)
    expect(host.deliveries).toHaveLength(SCHEDULE_RECONCILE_MAX_RUNS + 1)
    expect(new Set(host.deliveries.map((item) => item.schedule.id)).size).toBe(
      SCHEDULE_RECONCILE_MAX_RUNS + 1,
    )
    expect(entries.size).toBe(SCHEDULE_RECONCILE_MAX_RUNS)
    expect(scheduler.blockedRuns()).toContainEqual({
      runId: blockedId,
      status: 'blocked',
      reason: 'targetPending',
    })
  })
  it('plans healthy due schedules on every tick while one recovery ledger fails', async () => {
    const { fs, store, deps, host, job, intent } = await fixture()
    const healthy = fakeSchedule({
      id: 'healthy-due',
      target: { kind: 'conversation', backend: 'modelApi', sessionId: 'healthy' },
    })
    await store.create(healthy)
    await store.admit({ ...intent, advancesTime: false })
    const lookup = host.lookupRun.bind(host)
    vi.spyOn(host, 'lookupRun').mockImplementation(async (runId) => {
      if (runId === intent.runId) throw new Error('ledger unavailable')
      return await lookup(runId)
    })
    const plan = vi.fn(deps.time.plan)
    const scheduler = createScheduler({
      ...deps,
      time: { plan },
      queue: {
        serialize: async (key, work) => {
          await fs.lock(key, async () => {
            await work()
          })
        },
      },
    })
    vi.useFakeTimers()
    const errors = vi.fn()
    const timer = scheduler.start(() => [job.workspaceKey], errors)
    try {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(SCHEDULE_POLL_INTERVAL_MS)
      expect(plan.mock.calls.filter(([schedule]) => schedule.id === healthy.id)).toHaveLength(2)
      expect(host.deliveries.map((item) => item.schedule.id)).toEqual([healthy.id])
      expect(scheduler.blockedRuns()).toContainEqual({
        runId: intent.runId,
        status: 'blocked',
        reason: 'recoveryFailed',
      })
      expect(errors).toHaveBeenCalled()
    } finally {
      timer.dispose()
      vi.useRealTimers()
    }
  })
  it('rolls back failed removal and keeps the listed schedule usable after reopening', async () => {
    const { fs, store, job, intent } = await fixture()
    failNextDelta(fs, job.workspaceKey, 'removal publication failed')
    await expect(store.remove(job.workspaceKey, job.id)).rejects.toThrow(
      'removal publication failed',
    )
    const reopened = createScheduleStore(fs)
    expect(await reopened.list(job.workspaceKey)).toEqual([job])
    expect(await reopened.claim(`${job.id}:fresh-claim`)).toBe(true)
    expect(await reopened.admit(intent)).toBe(true)
    expect(await reopened.advance(intent)).toBe(true)
    expect(await reopened.remove(job.workspaceKey, job.id)).toBe(true)
    expect(await reopened.claim(`${job.id}:removed-claim`)).toBe(false)
    expect(await reopened.admit({ ...intent, runId: `${job.id}:removed-admit` })).toBe(false)
  })
  it('rereads creation priority when an older entry arrives between two settlements', async () => {
    const { store, host, deps, job, intent, scheduler } = await fixture()
    await store.remove(job.workspaceKey, job.id)
    const jobs = [
      fakeSchedule({ id: 'first', createdAtMs: job.createdAtMs }),
      fakeSchedule({ id: 'middle', createdAtMs: job.createdAtMs + 1 }),
      fakeSchedule({ id: 'last', createdAtMs: job.createdAtMs + 2 }),
    ]
    const intents = jobs.map((schedule) => ({
      ...intent,
      schedule,
      runId: `${schedule.id}:1`,
      advancesTime: false,
    }))
    for (const schedule of jobs) await store.create(schedule)
    await store.admit(intents[0]!)
    await store.admit(intents[2]!)
    host.deferSettlements = true
    const work = scheduler.recover(job.workspaceKey)
    await vi.waitFor(() => {
      expect(host.deliveries).toHaveLength(1)
    })
    await store.admit(intents[1]!)
    host.settle(fireOf(intents[0]!, host.now()))
    await vi.waitFor(() => {
      expect(host.deliveries).toHaveLength(2)
    })
    expect(host.deliveries[1]?.schedule.id).toBe('middle')
    host.settle(fireOf(intents[1]!, host.now()))
    await work
    host.deferSettlements = false
    await createScheduler(deps).recover(job.workspaceKey)
    expect(host.deliveries.map((delivery) => delivery.schedule.id)).toEqual([
      'first',
      'middle',
      'last',
    ])
  })
  it('refuses a time candidate after a direct cursor edit before any newer fire exists', async () => {
    const { store, host, job, intent, scheduler } = await fixture()
    await store.admit(intent)
    await store.update({ ...job, nextFireAtMs: intent.occurrenceMs + SCHEDULE_MIN_INTERVAL_MS })
    await scheduler.recover(job.workspaceKey)
    expect(host.deliveries).toEqual([])
    const [record] = await store.fires(job.workspaceKey)
    expect(record?.outcome).toBe('skipped')
    const [counted] = await store.list(job.workspaceKey)
    expect(counted?.fireCount).toBe(0)
  })
  it('rejects an old occurrence even when its captured fresh cursor equals the stored cursor', async () => {
    const { store, job, intent } = await fixture()
    const newer = {
      ...intent,
      runId: `${job.id}:newer-cursor`,
      occurrenceMs: intent.occurrenceMs + SCHEDULE_MIN_INTERVAL_MS,
      nextFireAtMs: intent.occurrenceMs + 2 * SCHEDULE_MIN_INTERVAL_MS,
    }
    await store.admit(newer)
    expect(await store.advance(newer)).toBe(true)
    const [current] = await store.list(job.workspaceKey)
    const older = { ...intent, schedule: current! }
    await store.admit(older)
    expect(await store.advance(older)).toBe(false)
    const [finished] = await store.list(job.workspaceKey)
    expect(finished?.fireCount).toBe(1)
    expect(finished?.nextFireAtMs).toBe(newer.nextFireAtMs)
  })
  it('validates a settlement against its retained intent before any audit or queue mutation', async () => {
    const { store, intent, job, host } = await fixture()
    await store.admit(intent)
    const before = await store.list(job.workspaceKey)
    await expect(
      store.record({ ...fireOf(intent, host.now()), occurrenceMs: intent.occurrenceMs + 1 }),
    ).rejects.toThrow('IdentityMismatch')
    expect(await store.list(job.workspaceKey)).toEqual(before)
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
  })
  it('keeps declined-run chronology distinct when an after-N limit is raised during clock rollback', async () => {
    const { store, intent, job, host } = await fixture()
    await store.update({ ...job, end: { afterRuns: 1 } })
    const first = { ...intent, advancesTime: false }
    await store.admit(first)
    expect(await store.advance(first)).toBe(true)
    await store.record(fireOf(first, host.now()))
    const declined = { ...first, runId: `${job.id}:declined`, occurrenceMs: first.occurrenceMs + 1 }
    await store.admit(declined)
    expect(await store.advance(declined)).toBe(false)
    await store.record(fireOf(declined, host.now(), 'skipped'))
    const [counted] = await store.list(job.workspaceKey)
    await store.update({ ...counted!, end: { afterRuns: 2 } })
    const newer = { ...first, runId: `${job.id}:newer`, occurrenceMs: first.occurrenceMs - 1 }
    await store.admit(newer)
    expect(await store.advance(newer)).toBe(true)
    await store.record(fireOf(newer, host.now() - 1, 'failed'))
    const [finished] = await store.list(job.workspaceKey)
    expect(finished?.consecutiveFailures).toBe(1)
    expect(finished?.fireCount).toBe(2)
  })
  it('retries audit-before-index failure for a raw receipt and never resurrects retired audit on replay', async () => {
    const { fs, store, intent, job, host } = await fixture()
    await store.claim(intent.runId)
    failNextDelta(fs, job.workspaceKey, 'crash before record index')
    const fire = fireOf(intent, host.now(), 'failed')
    await expect(store.record(fire)).rejects.toThrow('crash before record index')
    await store.record(fire)
    const [finished] = await store.list(job.workspaceKey)
    expect(finished?.consecutiveFailures).toBe(1)
    await store.maintain(job.workspaceKey, host.now() + SCHEDULE_AUDIT_MAX_AGE_MS + 1)
    expect(await store.fires(job.workspaceKey)).toEqual([])
    await store.record(fire)
    expect(await store.fires(job.workspaceKey)).toEqual([])
  })
  it('retains failure chronology across audit expiry and a later out-of-order success', async () => {
    const { store, intent, job, host } = await fixture()
    const run = async (id: string, ordinal: number) => {
      const candidate = {
        ...intent,
        runId: `${job.id}:${id}`,
        occurrenceMs: intent.occurrenceMs + ordinal,
        advancesTime: false,
      }
      await store.admit(candidate)
      await store.advance(candidate)
      return candidate
    }
    const first = await run('first-failure', 0)
    await store.record(fireOf(first, host.now(), 'failed'))
    const middle = await run('middle-success', 1)
    const second = await run('second-failure', 2)
    await store.record(fireOf(second, host.now(), 'failed'))
    const later = host.now() + SCHEDULE_AUDIT_MAX_AGE_MS + 1
    await store.maintain(job.workspaceKey, later)
    expect(await store.fires(job.workspaceKey)).toEqual([])
    const third = await run('third-failure', 3)
    await store.record(fireOf(third, later, 'failed'))
    const [paused] = await store.list(job.workspaceKey)
    expect(paused).toMatchObject({ consecutiveFailures: 3, paused: true })
    await store.record(fireOf(middle, later + 1))
    const [reordered] = await store.list(job.workspaceKey)
    expect(reordered).toMatchObject({ consecutiveFailures: 2, paused: true })
  })
  it('preserves an existing scalar failure baseline and bounds it at the pause threshold', async () => {
    const fs = new MemoryScheduleFs()
    const store = createScheduleStore(fs)
    const job = fakeSchedule({ consecutiveFailures: 2 })
    await store.create(job)
    const intent = {
      schedule: job,
      runId: `${job.id}:baseline`,
      occurrenceMs: job.createdAtMs,
      advancesTime: false,
    }
    await store.admit(intent)
    await store.advance(intent)
    await store.record(fireOf(intent, job.createdAtMs, 'failed'))
    const [paused] = await store.list(job.workspaceKey)
    expect(paused).toMatchObject({ consecutiveFailures: 3, paused: true })
    for (const ordinal of [2, 3, 4]) {
      const next = {
        ...intent,
        runId: `${job.id}:baseline-${String(ordinal)}`,
        occurrenceMs: ordinal,
      }
      await store.admit(next)
      await store.advance(next)
      await store.record(fireOf(next, job.createdAtMs, 'failed'))
      const counted = await store.list(job.workspaceKey)
      expect(counted[0]?.consecutiveFailures).toBe(3)
    }
    const [current] = await store.list(job.workspaceKey)
    await store.update({ ...current!, consecutiveFailures: 0, paused: false })
    const reset = { ...intent, runId: `${job.id}:reset`, occurrenceMs: 5 }
    await store.admit(reset)
    await store.advance(reset)
    await store.record(fireOf(reset, job.createdAtMs, 'failed'))
    const restarted = await store.list(job.workspaceKey)
    expect(restarted[0]?.consecutiveFailures).toBe(1)
    await store.remove(job.workspaceKey, job.id)
    expect(await store.list(job.workspaceKey)).toEqual([])
  })
  it('refuses an outcome summary without its live schedule', async () => {
    const { fs, store, job } = await fixture()
    await seedInitialState(fs, { outcomes: { missing: { baselineFailures: 0, heads: [] } } })
    await expect(store.list(job.workspaceKey)).rejects.toThrow('scheduleOutcomeIdentityMissing')
  })
  it('preserves admission chronology after applied-marker failure and subsequent audit expiry', async () => {
    const { fs, store, job, host } = await fixture()
    const intents = []
    for (const ordinal of [1, 2, 3]) {
      const intent = {
        schedule: job,
        runId: `${job.id}:applied-${String(ordinal)}`,
        occurrenceMs: ordinal,
        advancesTime: false,
      }
      await store.admit(intent)
      await store.advance(intent)
      intents.push(intent)
    }
    for (const intent of intents.slice(0, 2))
      await store.record(fireOf(intent, host.now(), 'failed'))
    const final = fireOf(intents[2]!, host.now())
    const publish = fs.publish.bind(fs)
    let isLocked = true
    vi.spyOn(fs, 'publish').mockImplementation(async (file, content, guard) => {
      if (isLocked && file.endsWith('.applied')) {
        throw new Error('applied marker locked')
      }
      return await publish(file, content, guard)
    })
    await expect(store.record(final)).rejects.toThrow('applied marker locked')
    expect(await store.pending(job.workspaceKey)).toEqual([])
    await store.maintain(job.workspaceKey, host.now() + SCHEDULE_AUDIT_MAX_AGE_MS + 1)
    expect(await store.fires(job.workspaceKey)).toEqual([])
    isLocked = false
    await store.record(final)
    const [current] = await store.list(job.workspaceKey)
    expect(current).toMatchObject({ consecutiveFailures: 0, fireCount: 3, paused: false })
    expect(await store.fires(job.workspaceKey)).toEqual([])
  })
  it.each(['baseline', 'markers'] as const)(
    'refuses a corrupt outcome %s beyond its bound',
    async (boundary) => {
      const { fs, store, job } = await fixture()
      await seedInitialState(fs, {
        outcomes: {
          [job.id]: {
            baselineFailures: boundary === 'baseline' ? SCHEDULE_PAUSE_AFTER_FAILURES + 1 : 0,
            heads:
              boundary === 'markers'
                ? Array.from({ length: SCHEDULE_PAUSE_AFTER_FAILURES + 1 }, () => ({
                    runHash: 'a'.repeat(64),
                    sequence: 0,
                    occurrenceMs: 0,
                    outcome: 'failed',
                  }))
                : [],
          },
        },
      })
      await expect(store.list(job.workspaceKey)).rejects.toThrow()
    },
  )
  it('bounds completion work and retries only one bounded batch per maintenance pass', async () => {
    const { fs, store, job, intent, host } = await fixture()
    const finalizations = Object.fromEntries(
      Array.from({ length: SCHEDULE_OUTBOX_MAX_PENDING }, (_, index) => [
        `${job.id}:completion-${String(index)}`,
        'retained completion digest',
      ]),
    )
    await seedInitialState(fs, { finalizations })
    await expect(store.record(fireOf(intent, host.now()))).rejects.toThrow(
      'scheduleFinalizationLimit',
    )
    expect(fs.bytes(`${job.workspaceKey}/fires`)).toBe(0)
    const publish = vi.spyOn(fs, 'publish')
    await store.maintain(job.workspaceKey, host.now())
    const markers = publish.mock.calls.filter(([file]) => file.endsWith('.applied'))
    expect(markers).toHaveLength(SCHEDULE_RECONCILE_MAX_RUNS)
    expect(fs.bytes('claims/')).toBe(0)
    expect(
      Array.from(fs.files, ([file]) => file).filter((file) => file.endsWith('.applied')),
    ).toHaveLength(SCHEDULE_RECONCILE_MAX_RUNS)
    publish.mockClear()
    await store.maintain(job.workspaceKey, host.now())
    expect(publish.mock.calls.filter(([file]) => file.endsWith('.applied'))).toHaveLength(
      SCHEDULE_RECONCILE_MAX_RUNS,
    )
    expect(
      Array.from(fs.files, ([file]) => file).filter((file) => file.endsWith('.applied')),
    ).toHaveLength(SCHEDULE_RECONCILE_MAX_RUNS * 2)
  })
  it('retains removed-run fences until failed completion work is finalized', async () => {
    const { fs, store, job, intent, host } = await fixture()
    await store.admit(intent)
    await store.advance(intent)
    const publish = fs.publish.bind(fs)
    let isLocked = true
    vi.spyOn(fs, 'publish').mockImplementation(async (file, content, guard) => {
      if (isLocked && file.endsWith('.applied')) throw new Error('completion locked')
      return await publish(file, content, guard)
    })
    await expect(store.record(fireOf(intent, host.now()))).rejects.toThrow('completion locked')
    await store.remove(job.workspaceKey, job.id)
    const afterGrace = Date.now() + SCHEDULE_FENCE_GRACE_MS + 1
    await store.maintain(job.workspaceKey, afterGrace)
    const folder = `claims/${scheduleStorageHash(job.id)}`
    expect(fs.bytes(folder)).toBeGreaterThan(0)
    isLocked = false
    await store.maintain(job.workspaceKey, afterGrace)
    expect(fs.bytes(folder)).toBe(0)
  })
})
