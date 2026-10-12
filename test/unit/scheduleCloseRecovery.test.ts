import { setTimeout as delay } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import type { ScheduleRunSettlement } from '../../src/core/schedules/delivery'
import type { createRuntimeScheduleDelivery } from '../../src/runtime/schedules/delivery'
import { RuntimeScheduleHost } from '../../src/runtime/schedules/host'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { noScheduleCost, type ScheduleV2 } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleBackground } from './helpers/schedules/background'
import { IdleScheduleSession } from './helpers/schedules/session'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

const cwd = '/schedule-close-recovery'

function deliveryRig(
  run: (schedule: ScheduleV2) => Promise<ScheduleRunSettlement>,
  backend: 'modelApi' | 'museCode' = 'modelApi',
) {
  const session = new IdleScheduleSession(backend)
  return {
    session,
    delivery: () => ({
      targets: {
        find: () => Promise.resolve({ session, release: () => Promise.resolve() }),
        open: () => Promise.reject(new Error('unused open')),
        fresh: () => Promise.reject(new Error('unused fresh')),
      },
      runs: {
        run: async (
          _session: unknown,
          schedule: ScheduleV2,
          _context: unknown,
          dispatch: () => Promise<void>,
        ) => {
          await dispatch()
          return await run(schedule)
        },
      },
      prompt: () => 'scheduled test prompt',
    }),
  }
}

it('orderly close preserves the second admitted fire behind an in-flight delivery for one reload send', async () => {
  const fs = new MemoryScheduleFs()
  const key = workspaceKey(cwd)
  const first = fakeSchedule({ id: 'first', catchUp: 'runOnce', workspaceKey: key })
  const second = fakeSchedule({ id: 'second', catchUp: 'runOnce', workspaceKey: key })
  const now = first.nextFireAtMs!
  const closing = new AbortController()
  const deliver = vi.fn(async (): Promise<ScheduleRunSettlement> => {
    closing.abort()
    return await new Promise<never>(() => undefined)
  })
  const engine = createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    now: () => now,
    backgroundEntry: new FakeScheduleBackground(),
    delivery: deliveryRig(() => deliver()).delivery,
    signal: closing.signal,
  })
  await engine.store.create(first)
  await engine.store.create(second)
  const release = await engine.runtime.holdWorkspace(cwd)
  const polling = engine.pollWorkspace(key)
  // The first delivery hangs only after it is really in flight.
  await vi.waitFor(() => {
    expect(deliver).toHaveBeenCalledTimes(1)
  })
  await engine.runtime.close()
  await polling
  await release()
  expect(await engine.store.fires(key)).toEqual([
    expect.objectContaining({ scheduleId: 'first', outcome: 'uncertain' }),
  ])
  expect(await engine.store.pending(key)).toEqual([
    expect.objectContaining({ schedule: expect.objectContaining({ id: 'second' }) }),
  ])
  // A reloaded engine on the same journal delivers the survivor exactly once.
  const resumed = vi.fn((): Promise<ScheduleRunSettlement> =>
    Promise.resolve({
      outcome: 'ran',
      refusedActions: [],
      cost: noScheduleCost(),
    }),
  )
  let deliveredId: string | undefined
  const reload = createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    now: () => now,
    backgroundEntry: new FakeScheduleBackground(),
    delivery: deliveryRig((schedule) => {
      deliveredId = schedule.id
      return resumed()
    }).delivery,
  })
  const releaseReload = await reload.runtime.holdWorkspace(cwd)
  await reload.pollWorkspace(key)
  await reload.pollWorkspace(key)
  expect(resumed).toHaveBeenCalledTimes(1)
  expect(deliveredId).toBe('second')
  expect(await reload.store.fires(key)).toHaveLength(2)
  expect(await reload.store.pending(key)).toEqual([])
  await releaseReload()
  await reload.runtime.close()
})

// The five close cuts below run the real journal, the real RuntimeScheduleHost
// and the real scheduler; only time, the target queue and the turn itself are
// faked. (The engine snapshots the store's methods at construction, so a spy
// installed afterwards could not cut these paths through the engine; the
// delivery path above proves the full engine composition.)
function cutRig(boundary: 'acknowledged' | 'lookupRun' | 'advance' | 'load' | 'fresh') {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const key = 'workspace-1'
  const now = fakeSchedule().nextFireAtMs!
  const closing = new AbortController()
  const deliver = vi.fn(() => Promise.reject(new Error('deliver must not run')))
  // The production host: the hold is real, the close signal is real, only the
  // turn itself is faked (it must never run on these paths).
  const host = new RuntimeScheduleHost({
    now: () => now,
    monotonicNow: () => now,
    signal: closing.signal,
    lookupRun: (workspace, runId) => store.lookupRun(workspace, runId),
    deliver,
  })
  host.hold(key)
  const abort = () => {
    closing.abort()
  }
  switch (boundary) {
    case 'load':
    case 'fresh': {
      const list = store.list.bind(store)
      let calls = 0
      vi.spyOn(store, 'list').mockImplementation(async (workspace) => {
        const jobs = await list(workspace)
        calls += 1
        if (calls === (boundary === 'load' ? 2 : 3)) abort()
        return jobs
      })
      break
    }
    case 'acknowledged': {
      const acknowledged = store.acknowledged.bind(store)
      vi.spyOn(store, 'acknowledged').mockImplementation(async (...args) => {
        const result = await acknowledged(...args)
        abort()
        return result
      })
      break
    }
    case 'lookupRun': {
      const lookup = store.lookupRun.bind(store)
      vi.spyOn(store, 'lookupRun').mockImplementation(async (...args) => {
        const result = await lookup(...args)
        abort()
        return result
      })
      break
    }
    default: {
      const advance = store.advance.bind(store)
      vi.spyOn(store, 'advance').mockImplementation(async (...args) => {
        const isAdvanced = await advance(...args)
        abort()
        return isAdvanced
      })
    }
  }
  const scheduler = createScheduler({
    store,
    runs: store,
    queue: memoryScheduleQueue(fs),
    host,
    time: { plan: () => ({ occurrenceMs: now, missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown result')),
  })
  return { store, scheduler, deliver, key, now }
}

it('engine close joins dispatches even when delivery close throws', async () => {
  const fs = new MemoryScheduleFs()
  const key = workspaceKey(cwd)
  // A museCode target: the engine's Model API paid guard has nothing to refuse.
  const job = fakeSchedule({
    id: 'close-join',
    workspaceKey: key,
    catchUp: 'runOnce',
    target: { kind: 'conversation', backend: 'museCode', sessionId: 'session-1' },
  })
  const now = job.nextFireAtMs!
  const started = Promise.withResolvers<undefined>()
  const gate = Promise.withResolvers<undefined>()
  const runDelivery = () => run()
  const run = vi.fn(async (): Promise<ScheduleRunSettlement> => {
    started.resolve(undefined)
    await gate.promise
    return {
      outcome: 'ran',
      refusedActions: [],
      cost: noScheduleCost(),
    }
  })
  const deliveryClose = new Error('delivery close failed')
  const detached = (): void => undefined
  const noAttach = (): (() => void) => detached
  // The factory stand-in implements the throwing close only; delivery comes
  // from the engine's ordinary test ports. No production seam is widened.
  function throwingFactory(
    _ports: Parameters<typeof createRuntimeScheduleDelivery>[0],
    _authority: Parameters<typeof createRuntimeScheduleDelivery>[1],
    _registry: Parameters<typeof createRuntimeScheduleDelivery>[2],
  ): ReturnType<typeof createRuntimeScheduleDelivery> {
    return {
      attach: noAttach,
      consent: () => Promise.resolve(undefined),
      delivery: deliveryRig(runDelivery, 'museCode').delivery(),
      close: () => Promise.reject(deliveryClose),
    }
  }
  const engine = createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    now: () => now,
    backgroundEntry: new FakeScheduleBackground(),
    delivery: deliveryRig(runDelivery, 'museCode').delivery,
    runtimeDelivery: {
      backendFor: () => Promise.reject(new Error('unused backend')),
      allowsContributorModels: false,
      row: () => undefined,
      deferQuestions: () => Promise.resolve(),
    },
    runtimeDeliveryFactory: throwingFactory,
  })
  await engine.store.create(job)
  const release = await engine.runtime.holdWorkspace(cwd)
  const polling = engine.scheduler.poll(key)
  await started.promise
  const closing = engine.runtime.close()
  let isSettled = false
  void closing
    .then(() => {
      isSettled = true
    })
    .catch(() => {
      isSettled = true
    })
  // The close is still joining the in-flight dispatch; a close that skipped
  // it would already have rejected with the delivery error.
  await delay(50)
  expect(isSettled).toBe(false)
  gate.resolve(undefined)
  await expect(closing).rejects.toBe(deliveryClose)
  await polling
  expect(await engine.store.fires(key)).toEqual([
    expect.objectContaining({ scheduleId: 'close-join', outcome: 'ran' }),
  ])
  await release()
})

it.each(['acknowledged', 'lookupRun', 'advance', 'load', 'fresh'] as const)(
  'keeps unhanded admissions when close arrives during %s',
  async (boundary) => {
    const { store, scheduler, deliver, key, now } = cutRig(boundary)
    const first = fakeSchedule({ id: 'first', catchUp: 'runOnce', nextFireAtMs: now })
    const second = fakeSchedule({ id: 'second', catchUp: 'runOnce', nextFireAtMs: now })
    await store.create(first)
    await store.create(second)
    await scheduler.poll(key)
    await scheduler.close()
    expect(await store.fires(key)).toEqual([])
    expect(await store.pending(key)).toHaveLength(2)
    expect(deliver).not.toHaveBeenCalled()
  },
)
