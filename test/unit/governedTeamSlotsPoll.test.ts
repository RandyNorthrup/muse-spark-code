// What a governed team slot does while the scheduler's count and the machine
// governor's queue disagree (RLF-TEAMWORKERS3): the queue grants a permit
// because no governed process runs, while the scheduler's own bookkeeping says
// the place is taken (an engine worker holds a reservation and is no process
// the governor launched). Asking again at once would answer itself in
// microtasks and starve the process (found in RLF-TEAMWORKERS2, where it froze a
// test worker for over nine minutes), so the slot waits between asks.
//
// Real parts: the window's governor host reading this machine's sampler under a
// memory limit of 0% (the one place throttle allows), the host's real queue,
// and the real `SchedulerSlots` as the scheduler's bookkeeping. The first
// worker ends on the third ask, so the wait is bounded by a count of asks, not
// by a timer a starved loop could never fire: without the wait the same three
// asks finish in a moment, and the elapsed time says so.
import { afterAll, describe, expect, it } from 'vitest'
import {
  GovernedTeamSlots,
  SchedulerSlots,
  type SchedulerSlotPort,
  type SlotRequest,
} from '../../src/core/team/scheduler/slots'
import { RESOURCE_LAUNCH_POLL_MS } from '../../src/shared/constants'
import { governorWindow } from './helpers/governorWindow'

/** The asks before the first worker ends: two waits sit between three asks. */
const ASKS_BEFORE_THE_WORKER_ENDS = 3
/** Slack for a timer that fires a hair early or a clock read that rounds. */
const TIMER_SLACK_MS = 30

const FIRST: SlotRequest = {
  taskId: 'first',
  attempt: 1,
  workspaceId: 'workspace',
  roleId: 'engineering',
  entryId: 'entry',
  agentProfileId: 'agent',
  kind: 'engine',
}
const SECOND: SlotRequest = { ...FIRST, taskId: 'second' }

const disposers: (() => void)[] = []
afterAll(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('a governed team slot while the scheduler and the queue disagree', () => {
  it('waits between asks, and is admitted once the scheduler’s place is free', async () => {
    const { window, errors, dispose } = await governorWindow({ isLimited: true })
    disposers.push(dispose)
    const ports = window.port.teamSlotPorts()
    expect(ports.governor.capacity('worker')).toBe(1)

    // One worker already holds the scheduler's only place; it is no process the governor knows.
    const scheduler = new SchedulerSlots(FIRST.workspaceId, () => ({
      workers: 8,
      processWorkers: 8,
      role: () => 8,
      entry: () => 8,
      agent: () => 8,
    }))
    expect(scheduler.reserve(FIRST)).toEqual({ ok: true })
    scheduler.mark(FIRST, 'running')

    const asks: number[] = []
    const port: SchedulerSlotPort = {
      preflight: () => {
        // Nothing about this scheduler refuses a wait.
      },
      acquire: (_request, signal) => {
        signal.throwIfAborted()
        asks.push(performance.now())
        if (asks.length === ASKS_BEFORE_THE_WORKER_ENDS) scheduler.release(FIRST, 'retired')
        expect(scheduler.reserve(SECOND)).toEqual({ ok: true })
        return Promise.resolve({
          release: () => {
            scheduler.release(SECOND, 'notStarted')
          },
        })
      },
    }
    const slots = new GovernedTeamSlots(ports.queue, port, {
      governor: ports.governor,
      running: ports.running,
      configured: () => 1,
      occupied: () => scheduler.snapshot().length,
    })

    const begun = performance.now()
    const held = await slots.request({ kind: 'worker', priority: 0 }).ready
    const waited = performance.now() - begun
    try {
      expect(asks).toHaveLength(ASKS_BEFORE_THE_WORKER_ENDS)
      // Each ask but the first came after a wait: the loop never answered itself.
      expect(waited).toBeGreaterThanOrEqual(
        (ASKS_BEFORE_THE_WORKER_ENDS - 1) * RESOURCE_LAUNCH_POLL_MS - TIMER_SLACK_MS,
      )
      // The admitted slot is the second worker's place, and it frees it again.
      expect(scheduler.isReserved(SECOND)).toBe(true)
    } finally {
      held.release()
    }
    expect(scheduler.isReserved(SECOND)).toBe(false)
    expect(errors).toEqual([])
  })
})
