// D119 catch burn-down: a failed skip-withdrawal travels to the settling
// run, which rethrows it instead of settling a withdrawn turn. The
// session's withdrawal fails for real below.
import { describe, expect, it } from 'vitest'
import { scheduleEventRunId } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import {
  noScheduleCost,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { ScheduleDelivery, type ScheduleDeliverySession } from '../../src/core/schedules/delivery'

function schedule(): ScheduleV2 {
  return {
    id: 'schedule-1',
    name: 'Idle check',
    action: { kind: 'prompt', prompt: 'Report when idle.' },
    trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 1_700_000_000_000 },
    target: { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
    delivery: 'whenIdle',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(0).toAmount() },
    paidCapUsd: Usd.from(0).toAmount(),
    parallel: false,
    zone: 'UTC',
    pinned: false,
    version: 2,
    revision: 0,
    workspaceKey: 'workspace-1',
    paused: false,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    nextFireAtMs: 1_700_000_060_000,
    fireCount: 0,
    consecutiveFailures: 0,
    depth: 0,
    allowAgentReschedule: false,
    creator: { kind: 'user' },
  }
}

function context(job: ScheduleV2): ScheduleRunContext {
  return {
    unattended: true,
    scheduleId: job.id,
    runId: scheduleEventRunId(job.id, { source: 'manual', eventKey: 'req-1' }),
    grant: job.grant,
    creator: job.creator,
    mode: job.mode,
    depth: job.depth,
    allowAgentReschedule: job.allowAgentReschedule,
  }
}

describe('delivery withdrawal failure', () => {
  it('rethrows a failed withdrawal instead of settling', async () => {
    const failure = new Error('backend withdrawal unavailable')
    const job = schedule()
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
    await expect(delivery.deliver(job, context(job), 1_700_000_060_000)).rejects.toBe(failure)
  })
})
