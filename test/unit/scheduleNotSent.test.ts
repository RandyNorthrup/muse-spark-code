import { expect, it, vi } from 'vitest'
import { Usd } from '../../src/shared/usd'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import {
  noScheduleCost,
  type ScheduleFireRecord,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleClock } from './helpers/schedules/clock'
import { FakeScheduleHost } from './helpers/schedules/host'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

function rig(jobs: readonly ScheduleV2[]) {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const clock = new FakeScheduleClock(jobs[0]!.nextFireAtMs!)
  const host = new FakeScheduleHost(clock)
  host.workspaces.add('workspace-1')
  return {
    store,
    host,
    scheduler: (overrides?: Partial<Parameters<typeof createScheduler>[0]>) =>
      createScheduler({
        store,
        runs: store,
        queue: memoryScheduleQueue(fs),
        host,
        time: {
          plan: (schedule: ScheduleV2) => ({
            occurrenceMs: schedule.nextFireAtMs!,
            missed: false,
          }),
        },
        deferEvent: () => Promise.resolve(),
        failureSettlement: () => Promise.reject(new Error('unknown result')),
        ...overrides,
      }),
  }
}

it('a host refusal before anything is sent is not-sent with its liability released', async () => {
  const job = fakeSchedule({
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidCapUsd: Usd.from(1).toAmount(),
  })
  const { store, host, scheduler } = rig([job])
  await store.create(job)
  // The hold is live when the scheduler checks, but the host's own boundary
  // refuses before sending (its session layer already closed).
  host.deliver = () => Promise.reject(new Error(UI_TEXT.scheduleV2.messages.workspaceNotHeld))
  const engine = scheduler()
  await engine.poll(job.workspaceKey)
  // Known not-sent: skipped, exact zero cost, no retained liability.
  expect(await store.fires(job.workspaceKey)).toEqual([
    expect.objectContaining({
      outcome: 'skipped',
      reason: UI_TEXT.scheduleV2.messages.workspaceNotHeld,
      cost: {
        usd: Usd.from(0).toAmount(),
        certainty: 'exact',
        retainedLiabilityUsd: Usd.from(0).toAmount(),
      },
    }),
  ])
  expect(await store.pending(job.workspaceKey)).toEqual([])
  await engine.close()
})

it('after an abort a started turn is never recorded as skipped', async () => {
  const job = fakeSchedule({
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidCapUsd: Usd.from(1).toAmount(),
  })
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  await store.create(job)
  const closing = new AbortController()
  const now = job.nextFireAtMs!
  const deliver = vi.fn(
    async (_schedule: ScheduleV2, context: { runId: string }): Promise<ScheduleFireRecord> => {
      closing.abort()
      await new Promise<void>((resolve) => setImmediate(resolve))
      // The binding cancelled a STARTED turn and (wrongly, before the fix)
      // reported it as skipped. The scheduler must not journal that.
      return {
        runId: context.runId,
        scheduleId: job.id,
        workspaceKey: job.workspaceKey,
        occurrenceMs: now,
        observedAtMs: now,
        target: job.target,
        delivery: job.delivery,
        outcome: 'skipped',
        reason: UI_TEXT.scheduleV2.messages.targetClosed,
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
      signal: closing.signal,
      holds: () => true,
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
  // Genuinely unknown: uncertain, with the cap retained for the day.
  expect(await store.fires(job.workspaceKey)).toEqual([
    expect.objectContaining({
      outcome: 'uncertain',
      cost: expect.objectContaining({
        certainty: 'unknown',
        retainedLiabilityUsd: Usd.from(1).toAmount(),
      }),
    }),
  ])
  expect(deliver).toHaveBeenCalledTimes(1)
})

it('manual refusals name their true reason', async () => {
  const deleted = fakeSchedule({ id: 'gone' })
  const paused = fakeSchedule({ id: 'paused', paused: true })
  const ended = fakeSchedule({
    id: 'ended',
    end: { atMs: deleted.nextFireAtMs! - 1 },
  })
  const live = fakeSchedule({ id: 'live' })
  const { store, host, scheduler } = rig([paused, ended, live])
  await store.create(paused)
  await store.create(ended)
  await store.create(live)
  const engine = scheduler()
  const runNow = (id: string) =>
    engine.request({ method: 'schedules/runNow', workspaceKey: 'workspace-1', id }, `request-${id}`)
  expect(await runNow('gone')).toEqual({
    kind: 'refused',
    reason: UI_TEXT.scheduleV2.messages.scheduleDeleted,
  })
  host.workspaces.delete('workspace-1')
  expect(await runNow('live')).toEqual({
    kind: 'refused',
    reason: UI_TEXT.scheduleV2.messages.workspaceNotHeld,
  })
  host.workspaces.add('workspace-1')
  expect(await runNow('paused')).toEqual({
    kind: 'refused',
    reason: UI_TEXT.scheduleV2.labels.paused,
  })
  expect(await runNow('ended')).toEqual({
    kind: 'refused',
    reason: UI_TEXT.scheduleV2.messages.scheduleEnded,
  })
  await engine.close()
})

it('a failed retry in close does not skip the rest of close', async () => {
  const first = fakeSchedule({
    id: 'first',
    catchUp: 'runOnce',
    target: { kind: 'conversation', backend: 'modelApi', sessionId: 'close-1' },
  })
  const second = fakeSchedule({
    id: 'second',
    catchUp: 'runOnce',
    target: { kind: 'conversation', backend: 'modelApi', sessionId: 'close-2' },
  })
  const { store, scheduler } = rig([first, second])
  await store.create(first)
  await store.create(second)
  // The first acknowledgement keeps failing: close must still retry the rest
  // and keep the failed entry for a later close.
  const realAcknowledge = store.acknowledge.bind(store)
  const acknowledge = vi.spyOn(store, 'acknowledge')
  acknowledge.mockImplementation((fire) =>
    fire.scheduleId === 'first'
      ? Promise.reject(new Error('store unavailable'))
      : realAcknowledge(fire),
  )
  const engine = scheduler()
  await expect(engine.poll(first.workspaceKey)).rejects.toThrow('store unavailable')
  await engine.close()
  // The second fire is recorded despite the first retry failing.
  expect(await store.fires(first.workspaceKey)).toEqual([
    expect.objectContaining({ scheduleId: 'second', outcome: 'ran' }),
  ])
  acknowledge.mockRestore()
  await engine.close()
  expect(await store.fires(first.workspaceKey)).toHaveLength(2)
  expect(await store.fires(first.workspaceKey)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ scheduleId: 'second', outcome: 'ran' }),
      expect.objectContaining({ scheduleId: 'first', outcome: 'ran' }),
    ]),
  )
})
