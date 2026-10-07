import { describe, expect, it, vi } from 'vitest'
import {
  ScheduleDelivery,
  type ScheduleDeliveryRuns,
  type ScheduleDeliverySession,
  type ScheduleRunSettlement,
  type ScheduleTargetLease,
} from '../../src/core/schedules/delivery'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore, type ScheduleRunIntent } from '../../src/core/schedules/store'
import type { ScheduleFireRecord, ScheduleV2 } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { IdleScheduleSession } from './helpers/schedules/session'
import { memoryScheduleQueue, MemoryScheduleFs } from './helpers/schedules/storage'

const occurrenceMs = Date.parse('2026-10-06T12:00:00Z')
const settlement: ScheduleRunSettlement = {
  outcome: 'ran',
  refusedActions: [],
  cost: { usd: 0.1, certainty: 'estimated', retainedLiabilityUsd: 0.2 },
}

class RecoverySession extends IdleScheduleSession implements ScheduleDeliverySession {}

function failedFire(intent: ScheduleRunIntent, now: number): ScheduleFireRecord {
  return {
    scheduleId: intent.schedule.id,
    workspaceKey: intent.schedule.workspaceKey,
    target: intent.schedule.target,
    delivery: intent.schedule.delivery,
    runId: intent.runId,
    occurrenceMs: intent.occurrenceMs,
    observedAtMs: now,
    outcome: 'failed',
    reason: 'Dispatch failed',
    refusedActions: [],
    cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
  }
}

function deliveryRig() {
  const session = new RecoverySession('modelApi')
  const release = vi.fn(() => Promise.resolve(undefined))
  const lease: ScheduleTargetLease = { session, release }
  const targets = {
    find: vi.fn((): Promise<ScheduleTargetLease | undefined> => Promise.resolve(lease)),
    open: vi.fn((): Promise<ScheduleTargetLease> => Promise.resolve(lease)),
    fresh: vi.fn((): Promise<ScheduleTargetLease> => Promise.resolve(lease)),
  }
  const runs = {
    run: vi.fn<ScheduleDeliveryRuns['run']>(async (_session, _schedule, _context, dispatch) => {
      await dispatch()
      return settlement
    }),
  }
  const delivery = new ScheduleDelivery({
    now: () => occurrenceMs,
    monotonicNow: () => 1,
    holds: () => true,
    targets,
    runs,
    prompt: (input: ScheduleV2) =>
      input.action.kind === 'prompt' ? input.action.prompt : 'unexpected report',
  })
  return { delivery, runs, release }
}

const settleDeps = {
  time: { plan: () => ({ missed: false }) },
  failureSettlement: (failed: ScheduleRunIntent) =>
    Promise.resolve(failedFire(failed, occurrenceMs)),
  deferEvent: () => Promise.resolve(),
}

async function fixture() {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const job = fakeSchedule()
  await store.create(job)
  const intent: ScheduleRunIntent = {
    schedule: job,
    runId: `${job.id}:${String(job.nextFireAtMs)}`,
    occurrenceMs: job.nextFireAtMs!,
    advancesTime: false,
    missed: false,
  }
  const first = deliveryRig()
  const deps = {
    store,
    runs: store,
    host: first.delivery,
    queue: memoryScheduleQueue(fs),
    ...settleDeps,
  }
  return {
    fs,
    store,
    job,
    intent,
    first,
    deps,
    scheduler: createScheduler(deps),
    restart: () => {
      const next = deliveryRig()
      const restarted = createScheduler({ ...deps, host: next.delivery })
      return { scheduler: restarted, delivery: next }
    },
    restartScheduler: () => createScheduler(deps),
  }
}

type RecoveryFixture = Awaited<ReturnType<typeof fixture>>

async function failFirstAck(
  setup: Pick<RecoveryFixture, 'store' | 'job' | 'intent' | 'scheduler' | 'first'>,
): Promise<void> {
  vi.spyOn(setup.store, 'acknowledge').mockRejectedValueOnce(new Error('ack down'))
  await setup.store.admit(setup.intent)
  await expect(setup.scheduler.recover(setup.job.workspaceKey)).rejects.toThrow('ack down')
  expect(setup.first.runs.run).toHaveBeenCalledTimes(1)
}

async function expectSingleRanFire(
  setup: Pick<RecoveryFixture, 'store' | 'job' | 'intent'>,
): Promise<void> {
  const fires = await setup.store.fires(setup.job.workspaceKey)
  expect(fires).toHaveLength(1)
  expect(fires[0]).toMatchObject({ runId: setup.intent.runId, outcome: 'ran' })
  expect(await setup.store.pending(setup.job.workspaceKey)).toEqual([])
}

describe('schedule restart recovery through the real delivery ledger', () => {
  it('settles once and a restart with a fresh ledger never redelivers', async () => {
    const { store, job, intent, first, scheduler, restart } = await fixture()
    await store.admit(intent)
    await scheduler.recover(job.workspaceKey)
    expect(first.runs.run).toHaveBeenCalledTimes(1)
    expect(first.release).toHaveBeenCalledOnce()
    expect(await store.fires(job.workspaceKey)).toHaveLength(1)
    expect(await store.pending(job.workspaceKey)).toEqual([])

    const { scheduler: restarted, delivery: second } = restart()
    await restarted.recover(job.workspaceKey)
    expect(second.runs.run).not.toHaveBeenCalled()
    expect(await store.fires(job.workspaceKey)).toHaveLength(1)
  })

  it('recovers a lost acknowledgement through the admitted ledger without a second run', async () => {
    const setup = await fixture()
    const { store, job, intent, first, restartScheduler } = setup
    await failFirstAck(setup)
    expect(await store.fires(job.workspaceKey)).toEqual([])
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
    expect(await first.delivery.lookupRun(intent.runId)).toMatchObject({ status: 'settled' })

    await restartScheduler().recover(job.workspaceKey)
    expect(first.runs.run).toHaveBeenCalledTimes(1)
    await expectSingleRanFire(setup)
  })

  it('re-runs at most once when both the acknowledgement and the ledger are lost, still recording one fire', async () => {
    const setup = await fixture()
    const { store, job } = setup
    await failFirstAck(setup)

    // A new process loses the in-memory ledger; the store owns durability.
    const fresh = deliveryRig()
    const crossProcess = createScheduler({
      store,
      runs: store,
      host: fresh.delivery,
      queue: {
        serialize: async (_key: string, work: () => Promise<void>) => {
          await work()
        },
      },
      ...settleDeps,
    })
    await crossProcess.recover(job.workspaceKey)
    expect(fresh.runs.run).toHaveBeenCalledTimes(1)
    await expectSingleRanFire(setup)
  })
})
