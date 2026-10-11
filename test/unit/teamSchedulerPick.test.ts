import { describe, expect, it } from 'vitest'
import { criticalPaths } from '../../src/core/team/scheduler/criticalPath'
import { inheritedPriorities, TaskPicker } from '../../src/core/team/scheduler/pick'
import { SchedulerSlots } from '../../src/core/team/scheduler/slots'
import {
  TEAM_AGING_MS,
  TEAM_STARVATION_MS,
  TEAM_START_STAGGER_MS,
} from '../../src/shared/constants'
import { entry, pickContext, readyTask, slot } from './helpers/teamScheduler'

describe('scheduler pick', () => {
  it('puts a critical chain before an older independent task and includes every score factor', () => {
    const tasks = [
      readyTask('D'),
      readyTask('A', { readyAt: 1 }),
      readyTask('B', { state: 'queued', depends_on: [{ task: 'A', on: 'merged' }] }),
      readyTask('C', { state: 'queued', depends_on: [{ task: 'B', on: 'merged' }] }),
    ]
    expect(criticalPaths(tasks).get('A')).toBe(45)
    const picker = new TaskPicker()
    expect(picker.pick(tasks, pickContext())?.task.id).toBe('A')
    const ranked = picker.rank(
      [readyTask('x')],
      pickContext({
        entries: [entry({ poolFit: 0.9, remainingDayTokens: 50 })],
        landingOverlap: () => true,
      }),
    )
    expect(ranked[0]).toMatchObject({
      priorityWeight: 2,
      criticalPathFactor: 2,
      fit: 0.225,
      score: 0.9,
    })
    expect(
      picker.rank([readyTask('short')], pickContext({ minutes: () => 1 / 2 }))[0]
        ?.criticalPathFactor,
    ).toBe(2)
    expect(
      picker.rank([readyTask('zero')], pickContext({ minutes: () => 0 }))[0]?.criticalPathFactor,
    ).toBe(1)
    expect(() => criticalPaths([readyTask('x', { depends_on: [{ task: 'x' }] })])).toThrow('cycle')
  })

  it('ages ready tasks and breaks ties by ready time then id', () => {
    const picker = new TaskPicker()
    const old = readyTask('old')
    const young = readyTask('young', { readyAt: TEAM_AGING_MS, size: 'XL' })
    expect(
      picker.pick([young, old], pickContext({ now: TEAM_AGING_MS, starvationMs: Infinity }))?.task
        .id,
    ).toBe('old')
    expect(picker.rank([readyTask('b'), readyTask('a')], pickContext())[0]?.task.id).toBe('a')
  })

  it('bounds starvation even with aging off and a newer urgent conversation', () => {
    const picker = new TaskPicker()
    const tasks = [
      readyTask('old', { priority: 'low' }),
      readyTask('urgent', {
        priority: 'urgent',
        readyAt: TEAM_STARVATION_MS,
        parentSessionId: 'other',
      }),
    ]
    expect(
      picker.pick(
        tasks,
        pickContext({ now: TEAM_STARVATION_MS, agingMs: Infinity, youngerStarted: () => true }),
      )?.task.id,
    ).toBe('old')
  })

  it('inherits through dependencies, lease holders and the merge queue then drops it with the wait', () => {
    const tasks = [
      readyTask('holder', { priority: 'low', state: 'merge' }),
      readyTask('middle', {
        priority: 'low',
        state: 'queued',
        depends_on: [{ task: 'holder', on: 'merged' }],
      }),
      readyTask('urgent', { priority: 'urgent' }),
    ]
    expect(
      inheritedPriorities(tasks, [{ waiter: 'urgent', holder: 'middle' }], 0).get('holder'),
    ).toBe('urgent')
    expect(inheritedPriorities(tasks, [], 0).get('holder')).toBe('low')
    const stopped = tasks.map((task) =>
      task.id === 'urgent' ? { ...task, state: 'cancelled' as const } : task,
    )
    expect(
      inheritedPriorities(stopped, [{ waiter: 'urgent', holder: 'middle' }], 0).get('holder'),
    ).toBe('low')
  })

  it('shares eligible lanes by weighted round robin between conversations', () => {
    const picker = new TaskPicker()
    const tasks = [
      readyTask('a', { parentSessionId: 'first' }),
      readyTask('b', { parentSessionId: 'later', readyAt: 1 }),
    ]
    const context = pickContext({ conversationWeight: (id) => (id === 'first' ? 2 : 1) })
    expect(
      Array.from({ length: 6 }, () => picker.pick(tasks, context)?.task.parentSessionId),
    ).toEqual(['first', 'later', 'first', 'first', 'later', 'first'])
  })

  it('steals any ready task of the same role, skips leased/ineligible tasks, and never preempts', () => {
    const picker = new TaskPicker()
    const tasks = [
      readyTask('running', { state: 'running', priority: 'urgent' }),
      readyTask('leased', { priority: 'urgent' }),
      readyTask('best', { priority: 'high' }),
      readyTask('other'),
    ]
    const context = pickContext({
      entries: [entry({ id: 'second' })],
      canStart: (task) => task.id !== 'leased',
    })
    expect(picker.pick(tasks, context)).toMatchObject({
      task: { id: 'best' },
      entry: { id: 'second' },
    })
    expect(
      picker.pick(tasks, pickContext({ entries: [entry({ roleId: 'docs' })] })),
    ).toBeUndefined()
    expect(
      picker.pick(tasks, pickContext({ entries: [entry({ eligible: () => false })] })),
    ).toBeUndefined()
  })

  it('stagger starts by agent without delaying another agent or engine', () => {
    const picker = new TaskPicker()
    const process = entry({ kind: 'museCode' })
    picker.started(process, 0)
    expect(
      picker.pick(
        [readyTask('a')],
        pickContext({ entries: [process], now: TEAM_START_STAGGER_MS - 1 }),
      ),
    ).toBeUndefined()
    expect(
      picker.pick(
        [readyTask('a')],
        pickContext({ entries: [process], now: TEAM_START_STAGGER_MS }),
      ),
    ).toBeDefined()
    expect(
      picker.pick(
        [readyTask('a')],
        pickContext({ entries: [entry({ kind: 'external', agentProfileId: 'other' })] }),
      ),
    ).toBeDefined()
  })
})

function slots(workers = 2, processWorkers = 2) {
  return new SchedulerSlots('workspace', () => ({
    workers,
    processWorkers,
    role: () => workers,
    entry: () => workers,
    agent: () => workers,
  }))
}

describe('reserved child slots', () => {
  it('binds reserved children to their selected entry and retains recovered liabilities above a lowered cap', () => {
    const pool = slots(1)
    pool.reserve(slot('child'))
    expect(pool.isReserved(slot('child'))).toBe(true)
    expect(pool.isReserved(slot('child', { entryId: 'different' }))).toBe(false)
    expect(pool.isReserved(slot('child', { workspaceId: 'different' }))).toBe(false)
    pool.release(slot('child'), 'notStarted')
    pool.recover(slot('old'))
    pool.recover(slot('older'))
    expect(pool.snapshot()).toHaveLength(2)
    expect(pool.reserve(slot('new'))).toMatchObject({ reason: 'workers' })
    expect(() => {
      pool.recover(slot('old'))
    }).toThrow('recoverySlot')
    expect(() => {
      pool.recover(slot('foreign', { workspaceId: 'foreign' }))
    }).toThrow('recoverySlot')
  })
  it('refuses a child behind its parent at once and reserves the whole batch or none', () => {
    const one = slots(1)
    const parent = slot('parent')
    one.reserve(parent)
    one.mark(parent, 'running')
    expect(one.reserveChildren(parent, [slot('child')])).toEqual({
      ok: false,
      reason: 'workers',
      recovery: 'selfOrRaiseLimit',
    })
    const two = slots()
    two.reserve(parent)
    two.mark(parent, 'running')
    expect(two.reserveChildren(parent, [slot('child'), slot('extra')]).ok).toBe(false)
    expect(two.snapshot()).toHaveLength(1)
    expect(two.reserveChildren(parent, [slot('child')]).ok).toBe(true)
    expect(two.snapshot()).toHaveLength(2)
  })

  it('counts uncertain attempts and process caps, prevents duplicate and foreign reservations', () => {
    const pool = slots(2, 1)
    const old = slot('old', { kind: 'external' })
    pool.reserve(old)
    pool.mark(old, 'uncertain')
    expect(pool.reserve(slot('replacement', { kind: 'external' }))).toMatchObject({
      ok: false,
      reason: 'processWorkers',
    })
    expect(pool.release(old, 'notStarted')).toBe(false)
    expect(pool.reserve(old)).toMatchObject({ reason: 'duplicate' })
    expect(pool.reserve(slot('foreign', { workspaceId: 'other' }))).toMatchObject({
      reason: 'workspace',
    })
    expect(pool.release(old, 'retired')).toBe(true)
    expect(pool.reserve(slot('replacement', { kind: 'external' })).ok).toBe(true)
  })

  it('checks role, entry and agent limits across conversations and fully occupied parents', () => {
    for (const kind of ['role', 'entry', 'agent'] as const) {
      const limits = {
        workers: 10,
        processWorkers: 10,
        role: () => 10,
        entry: () => 10,
        agent: () => 10,
        [kind]: () => 1,
      }
      const pool = new SchedulerSlots('workspace', () => limits)
      pool.reserve(slot('a'))
      pool.mark(slot('a'), 'running')
      expect(pool.reserve(slot('b'))).toMatchObject({ reason: kind })
    }
    const pool = slots()
    pool.reserve(slot('a'))
    pool.reserve(slot('b'))
    pool.mark(slot('a'), 'running')
    pool.mark(slot('b'), 'running')
    for (const parent of ['a', 'b'])
      expect(pool.reserveChildren(slot(parent), [slot(`${parent}-child`)]).ok).toBe(false)
    expect(pool.snapshot()).toHaveLength(2)
  })
})
