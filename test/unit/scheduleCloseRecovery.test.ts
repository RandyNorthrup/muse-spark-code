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

async function fixture() {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const first = fakeSchedule({ id: 'first', catchUp: 'runOnce' })
  const second = fakeSchedule({ id: 'second', catchUp: 'runOnce' })
  await store.create(first)
  await store.create(second)
  const closing = new AbortController()
  const now = first.nextFireAtMs!
  const terminal = (schedule: ScheduleV2, runId: string): ScheduleFireRecord => ({
    runId,
    scheduleId: schedule.id,
    workspaceKey: schedule.workspaceKey,
    target: schedule.target,
    delivery: schedule.delivery,
    occurrenceMs: now,
    observedAtMs: now,
    outcome: 'ran',
    refusedActions: [],
    cost: noScheduleCost(),
  })
  const deliver = vi.fn(async () => {
    closing.abort()
    return await new Promise<ScheduleFireRecord>(() => undefined)
  })
  const deps = {
    store,
    runs: store,
    queue: memoryScheduleQueue(fs),
    host: {
      signal: closing.signal,
      holds: () => true,
      now: () => now,
      monotonicNow: () => now,
      lookupRun: (id: string) => store.lookupRun(first.workspaceKey, id),
      deliver,
    },
    time: {
      plan: (schedule: ScheduleV2) => ({
        ...(schedule.nextFireAtMs !== undefined && { occurrenceMs: schedule.nextFireAtMs }),
        missed: false,
      }),
    },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown result')),
  }
  return {
    first,
    second,
    closing,
    store,
    deliver,
    deps,
    terminal,
    scheduler: createScheduler(deps),
  }
}

it('orderly close preserves the second admitted fire behind an in-flight delivery for one reload send', async () => {
  const setup = await fixture()
  await setup.scheduler.poll(setup.first.workspaceKey)
  await setup.scheduler.close()
  expect(await setup.store.fires(setup.first.workspaceKey)).toEqual([
    expect.objectContaining({ scheduleId: 'first', outcome: 'uncertain' }),
  ])
  expect(await setup.store.pending(setup.first.workspaceKey)).toEqual([
    expect.objectContaining({ schedule: expect.objectContaining({ id: 'second' }) }),
  ])
  expect(setup.deliver).toHaveBeenCalledTimes(1)
  const resumed = vi.fn((schedule: ScheduleV2, context: { runId: string }) =>
    Promise.resolve(setup.terminal(schedule, context.runId)),
  )
  const reload = createScheduler({
    ...setup.deps,
    host: { ...setup.deps.host, signal: new AbortController().signal, deliver: resumed },
  })
  await reload.recover(setup.first.workspaceKey)
  await reload.recover(setup.first.workspaceKey)
  expect(resumed).toHaveBeenCalledTimes(1)
  expect(resumed.mock.calls[0]?.[0].id).toBe('second')
  expect(await setup.store.fires(setup.first.workspaceKey)).toHaveLength(2)
  expect(await setup.store.pending(setup.first.workspaceKey)).toEqual([])
  await reload.close()
})
