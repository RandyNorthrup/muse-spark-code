// NOLIMITS4 C9: the team queue has no 16-task cap and no 1-hour wait cap.
// Every delegated task waits until headroom recovers, however many wait and
// however long it takes. Pure data in, through the real queue and answer.
import { describe, expect, it } from 'vitest'
import {
  answerExhausted,
  nextLocalMidnightMs,
  TeamTaskQueue,
  type QueuedTeamTask,
  type TeamEntryExhaustion,
  type TeamRolePool,
} from '../../src/core/team/teamPool'

const HOUR_MS = 3_600_000

function task(index: number): QueuedTeamTask {
  return { taskId: `task-${String(index)}`, roleId: 'role', enqueuedMs: index }
}

describe('TeamTaskQueue without task and wait caps', () => {
  it('queues past the old sixteen without refusing', () => {
    const queue = new TeamTaskQueue()
    for (let index = 0; index < 20; index += 1) {
      expect(queue.enqueue(task(index))).toEqual({ queued: true })
    }
    expect(queue.size).toBe(20)
    expect(queue.remove('task-0')).toBe(true)
    expect(queue.size).toBe(19)
  })
})

describe('answerExhausted without the 1-hour wait cap', () => {
  it('waits past the hour for a day cap that recovers at midnight', () => {
    const midnight = nextLocalMidnightMs(0)
    const nowMs = midnight + HOUR_MS
    const expected = nextLocalMidnightMs(nowMs)
    expect(expected - nowMs).toBeGreaterThan(HOUR_MS)
    const pool: TeamRolePool = {
      roleId: 'role',
      entries: [],
      policy: 'queue',
      continueOnNext: false,
    }
    const reasons: readonly TeamEntryExhaustion[] = [
      {
        entryId: 'entry',
        reason: 'cap',
        cap: { measure: 'tokens', window: 'day', amount: 1 },
      },
    ]
    expect(answerExhausted(pool, reasons, nowMs)).toEqual({
      decision: 'queue',
      untilMs: expected,
    })
  })
})
