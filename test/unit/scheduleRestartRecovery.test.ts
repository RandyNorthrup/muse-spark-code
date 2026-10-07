import { setTimeout as delay } from 'node:timers/promises'
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
import { FakeScheduleSession } from './helpers/schedules/session'
import { MemoryScheduleFs } from './helpers/schedules/storage'

const occurrenceMs = Date.parse('2026-10-06T12:00:00Z')
const settlement: ScheduleRunSettlement = {
  outcome: 'ran',
  refusedActions: [],
  cost: { usd: 0.1, certainty: 'estimated', retainedLiabilityUsd: 0.2 },
}

class RecoverySession extends FakeScheduleSession implements ScheduleDeliverySession {
  private readonly idle = new Set<(isIdle: boolean) => void>()
  waitUntilIdle(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || !this.open) return Promise.resolve(false)
    if (!this.running) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (isIdle: boolean): void => {
        this.idle.delete(done)
        signal.removeEventListener('abort', aborted)
        resolve(isIdle)
      }
      const aborted = (): void => {
        done(false)
      }
      this.idle.add(done)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }
  queueWhenIdle(
    prompt: string,
    context: Parameters<FakeScheduleSession['queue']>[1],
    signal: AbortSignal,
  ): Promise<string | undefined> {
    return signal.aborted ? Promise.resolve(undefined) : this.queue(prompt, context)
  }
}

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
    queue: {
      serialize: async (key: string, work: () => Promise<void>) => {
        await delay(0)
        await fs.lock(key, async () => {
          await work()
        })
      },
    },
    time: { plan: () => ({ missed: false }) },
    failureSettlement: (failed: ScheduleRunIntent) =>
      Promise.resolve(failedFire(failed, occurrenceMs)),
    deferEvent: () => Promise.resolve(),
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
    const { store, job, intent, first, scheduler, restartScheduler } = await fixture()
    vi.spyOn(store, 'acknowledge').mockRejectedValueOnce(new Error('ack down'))
    await store.admit(intent)
    await expect(scheduler.recover(job.workspaceKey)).rejects.toThrow('ack down')
    expect(first.runs.run).toHaveBeenCalledTimes(1)
    expect(await store.fires(job.workspaceKey)).toEqual([])
    expect(await store.pending(job.workspaceKey)).toHaveLength(1)
    expect(await first.delivery.lookupRun(intent.runId)).toMatchObject({ status: 'settled' })

    await restartScheduler().recover(job.workspaceKey)
    expect(first.runs.run).toHaveBeenCalledTimes(1)
    const fires = await store.fires(job.workspaceKey)
    expect(fires).toHaveLength(1)
    expect(fires[0]).toMatchObject({ runId: intent.runId, outcome: 'ran' })
    expect(await store.pending(job.workspaceKey)).toEqual([])
  })

  it('re-runs at most once when both the acknowledgement and the ledger are lost, still recording one fire', async () => {
    const { store, job, intent, first, scheduler } = await fixture()
    vi.spyOn(store, 'acknowledge').mockRejectedValueOnce(new Error('ack down'))
    await store.admit(intent)
    await expect(scheduler.recover(job.workspaceKey)).rejects.toThrow('ack down')
    expect(first.runs.run).toHaveBeenCalledTimes(1)

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
      time: { plan: () => ({ missed: false }) },
      failureSettlement: (failed: ScheduleRunIntent) =>
        Promise.resolve(failedFire(failed, occurrenceMs)),
      deferEvent: () => Promise.resolve(),
    })
    await crossProcess.recover(job.workspaceKey)
    expect(fresh.runs.run).toHaveBeenCalledTimes(1)
    const fires = await store.fires(job.workspaceKey)
    expect(fires).toHaveLength(1)
    expect(fires[0]).toMatchObject({ runId: intent.runId, outcome: 'ran' })
    expect(await store.pending(job.workspaceKey)).toEqual([])
  })
})
