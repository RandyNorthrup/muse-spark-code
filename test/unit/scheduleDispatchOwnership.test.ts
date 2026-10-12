import { spawn, spawnSync } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { createScheduler } from '../../src/core/schedules/scheduler'
import {
  createScheduleStore,
  isScheduleDispatchOwnerAlive,
  scheduleProcessBirth,
} from '../../src/core/schedules/store'
import { scheduleTimeRunId } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleClock } from './helpers/schedules/clock'
import { FakeScheduleHost } from './helpers/schedules/host'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

function rig() {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const clock = new FakeScheduleClock(fakeSchedule().nextFireAtMs!)
  const host = new FakeScheduleHost(clock)
  host.workspaces.add('workspace-1')
  return { store, host, queue: memoryScheduleQueue(fs) }
}

it('a lost startDispatch race against a live foreign owner records nothing', async () => {
  const { store, host, queue } = rig()
  const job = fakeSchedule({ id: 'raced', catchUp: 'runOnce' })
  await store.create(job)
  const intent = {
    schedule: job,
    runId: scheduleTimeRunId(job.id, job.nextFireAtMs!),
    occurrenceMs: job.nextFireAtMs!,
    advancesTime: true,
  }
  // The foreign owner admits and advances, exactly like this process would.
  await store.admit(intent)
  await store.advance(intent)
  // This process reaches startDispatch after the foreign owner won it. The
  // liveness oracle is the only process-bound seam: the journal below is real.
  const realStartDispatch = store.startDispatch.bind(store)
  const startDispatch = vi.spyOn(store, 'startDispatch')
  startDispatch.mockImplementationOnce(async (...args) => {
    await realStartDispatch(args[0], args[1])
    return await store.startDispatch(args[0], args[1])
  })
  const scheduler = createScheduler({
    store,
    runs: {
      ...store,
      startDispatch: (...args) => store.startDispatch(...args),
      isLiveDispatchOwnedElsewhere: () => Promise.resolve(true),
    },
    queue,
    host,
    time: { plan: () => ({ occurrenceMs: job.nextFireAtMs!, missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown result')),
  })
  await scheduler.poll(job.workspaceKey)
  // Nothing recorded: no uncertain fire, no consumed settlement. The owner's
  // real result and its cost are never lost to a false record here.
  expect(await store.fires(job.workspaceKey)).toEqual([])
  expect(await store.pending(job.workspaceKey)).toHaveLength(1)
  expect(host.deliveries).toHaveLength(0)
  startDispatch.mockRestore()
  await scheduler.close()
})

it('a dispatch owner is a process birth, not a number', () => {
  const birth = scheduleProcessBirth()
  expect(isScheduleDispatchOwnerAlive(birth.pid, birth.start)).toBe(true)
  // The same pid from another birth is dead, even though it is "alive".
  expect(isScheduleDispatchOwnerAlive(birth.pid, birth.start + 1)).toBe(false)
  // A pid whose process exited is dead.
  const exited = spawnSync(process.execPath, ['--version'])
  expect(typeof exited.pid).toBe('number')
  expect(isScheduleDispatchOwnerAlive(exited.pid)).toBe(false)
  // A live foreign pid is alive.
  const live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
  try {
    expect(isScheduleDispatchOwnerAlive(live.pid!)).toBe(true)
  } finally {
    live.kill()
  }
})

it('a dead owner dispatch is settled by the recovery rule and never blocks its target', async () => {
  const { store, host, queue } = rig()
  const target = fakeSchedule().target
  const first = fakeSchedule({ id: 'dead-owner', catchUp: 'runOnce', target })
  const second = fakeSchedule({ id: 'follower', catchUp: 'runOnce', target })
  await store.create(first)
  await store.create(second)
  const atMs = first.nextFireAtMs!
  const firstIntent = {
    schedule: first,
    runId: scheduleTimeRunId(first.id, atMs),
    occurrenceMs: atMs,
    advancesTime: true,
  }
  // The owner admits, advances and starts dispatch, then its process dies. A
  // dead pid stands in for it: the row below is byte-identical to a real
  // crash except for the owner number.
  const realPid = process.pid
  Object.defineProperty(process, 'pid', { configurable: true, get: () => 424_242 })
  try {
    await store.admit(firstIntent)
    await store.advance(firstIntent)
    await store.startDispatch(firstIntent, first.grant.paidCapUsd)
  } finally {
    Object.defineProperty(process, 'pid', { configurable: true, value: realPid, writable: false })
  }
  expect(await store.abandoned(first.workspaceKey)).toEqual([
    expect.objectContaining({ runId: firstIntent.runId }),
  ])
  expect(await store.isLiveDispatchOwnedElsewhere?.(first.workspaceKey, firstIntent.runId)).toBe(
    false,
  )
  const scheduler = createScheduler({
    store,
    runs: store,
    queue,
    host,
    time: {
      plan: (schedule) => ({ occurrenceMs: schedule.nextFireAtMs!, missed: false }),
    },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown result')),
  })
  await scheduler.poll(first.workspaceKey)
  // The dead dispatch recovers uncertain without replay; the follower behind
  // it on the same target still delivers exactly once.
  expect(await store.fires(first.workspaceKey)).toEqual([
    expect.objectContaining({ scheduleId: 'dead-owner', outcome: 'uncertain' }),
    expect.objectContaining({ scheduleId: 'follower', outcome: 'ran' }),
  ])
  expect(await store.pending(first.workspaceKey)).toEqual([])
  expect(host.deliveries.map((delivery) => delivery.schedule.id)).toEqual(['follower'])
  await scheduler.close()
})
