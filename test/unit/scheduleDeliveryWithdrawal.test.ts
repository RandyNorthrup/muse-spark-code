// D119 catch burn-down: a failed skip-withdrawal travels to the settling
// run, which rethrows it instead of settling a withdrawn turn. The
// session's withdrawal fails for real below.
import { describe, expect, it } from 'vitest'
import { noScheduleCost } from '../../src/shared/scheduleV2'
import { ScheduleDelivery, type ScheduleDeliverySession } from '../../src/core/schedules/delivery'
import { runContextFixture, scheduleFixture } from './helpers/scheduleFixtures'

describe('delivery withdrawal failure', () => {
  it('rethrows a failed withdrawal instead of settling', async () => {
    const failure = new Error('backend withdrawal unavailable')
    const job = scheduleFixture({
      name: 'Idle check',
      delivery: 'whenIdle',
      action: { kind: 'prompt', prompt: 'Report when idle.' },
    })
    const session: ScheduleDeliverySession = {
      backend: 'modelApi',
      sessionId: 'session-1',
      isRunning: () => false,
      isOpen: () => true,
      steer: () => Promise.resolve(undefined),
      cancel: () => Promise.resolve(undefined),
      queue: () => Promise.resolve('msg-0'),
      withdraw: () => Promise.reject(failure),
      send: () => Promise.resolve(undefined),
      waitUntilIdle: () => Promise.resolve(true),
      queueWhenIdle: () => Promise.resolve('msg-1'),
    }
    const delivery = new ScheduleDelivery({
      now: () => 1,
      monotonicNow: () => 1,
      holds: () => true,
      targets: {
        find: () => Promise.resolve(undefined),
        open: () => Promise.resolve({ session, release: () => Promise.resolve(undefined) }),
        fresh: () => Promise.resolve({ session, release: () => Promise.resolve(undefined) }),
      },
      runs: {
        run: async (_session, _schedule, runContext, dispatch) => {
          await dispatch()
          delivery.skip(runContext.runId)
          return { outcome: 'ran' as const, refusedActions: [], cost: noScheduleCost() }
        },
      },
      prompt: () => 'Report when idle.',
    })
    await expect(delivery.deliver(job, runContextFixture(job), 1_700_000_060_000)).rejects.toBe(
      failure,
    )
  })
})
