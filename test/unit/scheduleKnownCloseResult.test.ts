import { Usd } from '../../src/shared/usd'
import { expect, it, vi } from 'vitest'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import {
  noScheduleCost,
  type ScheduleV2,
  type ScheduleFireRecord,
} from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

it('records a host withdrawal returned after abort as known and releases held liability', async () => {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const job = fakeSchedule({
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidCapUsd: Usd.from(1).toAmount(),
  })
  await store.create(job)
  const close = new AbortController()
  const now = job.nextFireAtMs!
  const deliver = vi.fn(
    async (_schedule: ScheduleV2, context: { runId: string }): Promise<ScheduleFireRecord> => {
      close.abort()
      // The real binding withdraws the queued message asynchronously on close.
      await new Promise<void>((resolve) => setImmediate(resolve))
      return {
        runId: context.runId,
        scheduleId: job.id,
        workspaceKey: job.workspaceKey,
        occurrenceMs: now,
        observedAtMs: now,
        target: job.target,
        delivery: job.delivery,
        outcome: 'skipped',
        reason: 'withdrawn from queue; nothing sent',
        refusedActions: [],
        cost: noScheduleCost(),
      }
    },
  )
  const scheduler = createScheduler({
    store,
    runs: store,
    queue: memoryScheduleQueue(fs),
    host: {
      signal: close.signal,
      holds: () => !close.signal.aborted,
      now: () => now,
      monotonicNow: () => now,
      deliver,
      lookupRun: (id) => store.lookupRun(job.workspaceKey, id),
    },
    time: { plan: () => ({ occurrenceMs: now, missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown host facts')),
  })
  await scheduler.poll(job.workspaceKey)
  await scheduler.close()
  expect(await store.fires(job.workspaceKey)).toEqual([
    expect.objectContaining({
      outcome: 'skipped',
      reason: 'withdrawn from queue; nothing sent',
      cost: noScheduleCost(),
    }),
  ])
  expect(await store.pending(job.workspaceKey)).toEqual([])
  expect(deliver).toHaveBeenCalledTimes(1)
})
