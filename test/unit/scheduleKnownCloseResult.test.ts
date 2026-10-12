import { Usd } from '../../src/shared/usd'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { expect, it, vi } from 'vitest'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import { workspaceKey } from '../../src/runtime/dataFolder'
import type { ScheduleRunSettlement } from '../../src/core/schedules/delivery'
import { noScheduleCost, type ScheduleV2 } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleBackground } from './helpers/schedules/background'
import { IdleScheduleSession } from './helpers/schedules/session'
import { MemoryScheduleFs, memoryScheduleQueue } from './helpers/schedules/storage'

const cwd = '/schedule-known-close-result'

// Through the production engine: the delivery below stands in for the
// binding's confirmed queue withdrawal (covered for real, with the real
// withdrawQueued port, in scheduleDeliveryBinding.test.ts). It aborts the
// engine mid-dispatch, then reports the withdrawal one turn later with the
// canonical confirmed-withdrawal sentence and zero cost.
function engineRig(
  fs: MemoryScheduleFs,
  now: number,
  run: (schedule: ScheduleV2, runId: string) => Promise<ScheduleRunSettlement>,
  signal: AbortSignal,
) {
  const session = new IdleScheduleSession('modelApi')
  return createScheduleEngine({
    fs,
    queue: memoryScheduleQueue(fs),
    now: () => now,
    backgroundEntry: new FakeScheduleBackground(),
    signal,
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
          context: { runId: string },
          dispatch: () => Promise<void>,
        ) => {
          await dispatch()
          return await run(schedule, context.runId)
        },
      },
      prompt: () => 'scheduled test prompt',
    }),
  })
}

it('records a host withdrawal returned after abort as known and releases held liability', async () => {
  const fs = new MemoryScheduleFs()
  const key = workspaceKey(cwd)
  const job = fakeSchedule({
    workspaceKey: key,
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidCapUsd: Usd.from(1).toAmount(),
  })
  const now = job.nextFireAtMs!
  const close = new AbortController()
  const deliver = vi.fn(
    async (_schedule: ScheduleV2, _runId: string): Promise<ScheduleRunSettlement> => {
      close.abort()
      // The real binding withdraws the queued message asynchronously on close.
      await new Promise<void>((resolve) => setImmediate(resolve))
      return {
        outcome: 'skipped',
        reason: UI_TEXT.turnUnqueued,
        refusedActions: [],
        cost: noScheduleCost(),
      }
    },
  )
  const engine = engineRig(fs, now, deliver, close.signal)
  await engine.store.create(job)
  const release = await engine.runtime.holdWorkspace(cwd)
  await engine.pollWorkspace(key)
  await engine.runtime.close()
  await release()
  expect(await engine.store.fires(key)).toEqual([
    expect.objectContaining({
      outcome: 'skipped',
      reason: UI_TEXT.turnUnqueued,
      cost: noScheduleCost(),
    }),
  ])
  expect(await engine.store.pending(key)).toEqual([])
  expect(deliver).toHaveBeenCalledTimes(1)
})

it('a skipped report after abort without a confirmed withdrawal stays uncertain', async () => {
  const fs = new MemoryScheduleFs()
  const key = workspaceKey(cwd)
  const job = fakeSchedule({
    workspaceKey: key,
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidCapUsd: Usd.from(1).toAmount(),
  })
  const now = job.nextFireAtMs!
  const close = new AbortController()
  // A turn that had STARTED can never come back as a known nothing-sent fire,
  // even when the host calls it skipped: the model may have partly run it.
  const deliver = vi.fn(
    async (_schedule: ScheduleV2, _runId: string): Promise<ScheduleRunSettlement> => {
      close.abort()
      await new Promise<void>((resolve) => setImmediate(resolve))
      return {
        outcome: 'skipped',
        reason: UI_TEXT.scheduleV2.messages.targetClosed,
        refusedActions: [],
        cost: noScheduleCost(),
      }
    },
  )
  const engine = engineRig(fs, now, deliver, close.signal)
  await engine.store.create(job)
  const release = await engine.runtime.holdWorkspace(cwd)
  await engine.pollWorkspace(key)
  await engine.runtime.close()
  await release()
  expect(await engine.store.fires(key)).toEqual([
    expect.objectContaining({
      outcome: 'uncertain',
      cost: expect.objectContaining({ certainty: 'unknown' }),
    }),
  ])
  expect(deliver).toHaveBeenCalledTimes(1)
})
