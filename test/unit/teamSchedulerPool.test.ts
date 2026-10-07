import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeamScheduler, type SchedulerDependencies } from '../../src/core/team/teamPool'
import { SchedulerSlots } from '../../src/core/team/scheduler/slots'
import { TEAM_SCHED_TICK_MS, TEAM_START_STAGGER_MS } from '../../src/shared/constants'
import {
  entry,
  makeBoard,
  pickContext,
  retireBoardAttempt,
  submission,
  slot,
} from './helpers/teamScheduler'

function fixture(workers = 2) {
  const { board } = makeBoard()
  const slots = new SchedulerSlots('workspace', () => ({
    workers,
    processWorkers: workers,
    role: () => workers,
    entry: () => workers,
    agent: () => workers,
  }))
  const deps: SchedulerDependencies = {
    now: () => Date.now(),
    context: () => pickContext({ entries: [entry({ id: 'second' })] }),
    headroom: () => 'lane',
    exhausted: vi.fn(),
    lease: () => ({ release: vi.fn() }),
    authorize: vi.fn(() => Promise.resolve(true)),
    journal: vi.fn(() => Promise.resolve()),
    start: vi.fn(() => Promise.resolve('started' as const)),
    uncertain: vi.fn(() => Promise.resolve()),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    failure: vi.fn(),
    halveAgentCap: vi.fn(),
  }
  return { board, slots, deps, scheduler: new TeamScheduler(board, slots, deps) }
}
afterEach(() => vi.useRealTimers())

describe('window scheduler drain', () => {
  it('spaces process starts from observed launch completion even after a slow launch', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.board.submit([submission('a'), submission('b')], 0)
    f.deps.context = () => pickContext({ entries: [entry({ kind: 'museCode' })] })
    let launches = 0
    f.deps.start = async () => {
      launches++
      if (launches === 1)
        await new Promise((resolve) => setTimeout(resolve, TEAM_START_STAGGER_MS * 2))
      return 'started'
    }
    const first = f.scheduler.wake()
    await vi.advanceTimersByTimeAsync(TEAM_START_STAGGER_MS * 2)
    await first
    expect(launches).toBe(1)
    await vi.advanceTimersByTimeAsync(TEAM_START_STAGGER_MS - 1)
    await f.scheduler.wake()
    expect(launches).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await f.scheduler.wake()
    expect(launches).toBe(2)
  })
  it('ignores a late launch result or failure after that attempt retired', async () => {
    for (const hasFailure of [false, true]) {
      const f = fixture()
      const releases = vi.fn()
      f.deps.lease = () => ({ release: releases })
      f.board.submit([submission('a')], 0)
      let retirement: Promise<void> | undefined
      f.deps.start = () => {
        retireBoardAttempt(f.board, 'a')
        f.board.transition('a', 1, 'cancelled', Date.now())
        retirement = f.scheduler.retired({ taskId: 'a', attempt: 1 })
        return hasFailure
          ? Promise.reject(new Error('late launch failure'))
          : Promise.resolve('uncertain')
      }
      if (hasFailure) await expect(f.scheduler.wake()).rejects.toThrow('late launch failure')
      else await f.scheduler.wake()
      if (hasFailure) await expect(retirement).rejects.toThrow('late launch failure')
      else await retirement
      expect(f.board.task('a').state).toBe('cancelled')
      expect(f.board.task('a').attempts.at(-1)?.state).toBe('retired')
      expect(f.deps.uncertain).not.toHaveBeenCalled()
      expect(f.slots.snapshot()).toHaveLength(0)
      expect(releases).toHaveBeenCalledOnce()
    }
  })
  it('refuses a launch retired or cancelled while its journal write was pending', async () => {
    const f = fixture()
    f.board.submit([submission('a')], 0)
    f.deps.journal = () => {
      if (f.board.task('a').state === 'running') {
        retireBoardAttempt(f.board, 'a')
        f.board.transition('a', 1, 'cancelled', Date.now())
      }
      return Promise.resolve()
    }
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    expect(f.board.task('a').state).toBe('cancelled')
    expect(f.slots.snapshot()).toHaveLength(0)
  })
  it('dispatches children in their reserved slots instead of queuing behind the parent', async () => {
    const f = fixture()
    f.board.submit([submission('parent')], 0)
    await f.scheduler.wake()
    f.board.submit([submission('child')], 1)
    expect(
      f.slots.reserveChildren({ taskId: 'parent', attempt: 1 }, [
        slot('child', { entryId: 'second' }),
      ]).ok,
    ).toBe(true)
    await f.scheduler.wake()
    expect(f.board.task('child').state).toBe('running')
    expect(f.slots.snapshot()).toHaveLength(2)
    expect(f.deps.start).toHaveBeenCalledTimes(2)
  })

  it('forwards overload to the shared agent ceiling policy without moving running work', async () => {
    const f = fixture(4)
    f.board.submit([submission('a')], 0)
    await f.scheduler.wake()
    f.scheduler.providerOverloaded('agent')
    expect(f.deps.halveAgentCap).toHaveBeenCalledWith('agent')
    expect(f.board.task('a').state).toBe('running')
  })
  it('fills free lanes within one event and reservations enforce caps during concurrent wakes', async () => {
    const f = fixture()
    f.board.submit([submission('a'), submission('b'), submission('c')], 0)
    const gate = Promise.withResolvers<undefined>()
    f.deps.authorize = vi.fn(async () => {
      await gate.promise
      return true
    })
    const first = f.scheduler.wake()
    const second = f.scheduler.wake()
    expect(f.slots.snapshot()).toHaveLength(1)
    gate.resolve(undefined)
    await Promise.all([first, second])
    expect(f.deps.start).toHaveBeenCalledTimes(2)
    expect(f.slots.snapshot()).toHaveLength(2)
    retireBoardAttempt(f.board, 'a')
    f.board.transition('a', 1, 'review', 2)
    await f.scheduler.retired({ taskId: 'a', attempt: 1 })
    expect(f.deps.start).toHaveBeenCalledTimes(3)
    expect(f.board.task('c').state).toBe('running')
  })

  it('skips overlapping leases to fill another lane and starts the waiter after retirement', async () => {
    const f = fixture()
    const releases: string[] = []
    let isHeld = false
    f.board.submit([submission('a'), submission('b'), submission('c')], 0)
    f.deps.lease = (task) => {
      if (isHeld && task.id !== 'c') return undefined
      if (task.id !== 'c') isHeld = true
      return {
        release: () => {
          if (task.id !== 'c') isHeld = false
          releases.push(task.id)
        },
      }
    }
    await f.scheduler.wake()
    expect(f.board.task('a').state).toBe('running')
    expect(f.board.task('b').state).toBe('ready')
    expect(f.board.task('c').state).toBe('running')
    retireBoardAttempt(f.board, 'a')
    f.board.transition('a', 1, 'review', 2)
    await f.scheduler.retired({ taskId: 'a', attempt: 1 })
    expect(f.board.task('b').state).toBe('running')
    expect(releases).toEqual(['a'])
  })

  it('does not ask for transient lane waits and applies exhaustion only to spent headroom', async () => {
    const f = fixture(1)
    f.board.submit([submission('a'), submission('b')], 0)
    await f.scheduler.wake()
    expect(f.deps.exhausted).not.toHaveBeenCalled()
    f.deps.headroom = () => 'exhausted'
    await f.scheduler.wake()
    expect(f.deps.exhausted).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('reloads never dispatch until Resume queue and paid authorization runs again', async () => {
    const f = fixture()
    f.board.submit([submission('a')], 0)
    f.board.restore(f.board.snapshot())
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    expect(f.deps.authorize).not.toHaveBeenCalled()
    f.board.resume()
    await f.scheduler.wake()
    expect(f.deps.authorize).toHaveBeenCalledOnce()
    expect(f.deps.start).toHaveBeenCalledOnce()
  })

  it('journals before dispatch and does not launch if paused or held during consent', async () => {
    const f = fixture()
    const release = vi.fn()
    f.deps.lease = () => ({ release })
    f.board.submit([submission('a')], 0)
    f.deps.authorize = () => {
      f.board.reschedule({ task_ids: ['a'], hold: true }, 1)
      return Promise.resolve(true)
    }
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    expect(f.slots.snapshot()).toHaveLength(0)
    expect(release).toHaveBeenCalledOnce()
    f.board.reschedule({ task_ids: ['a'], hold: false }, 1)
    f.deps.authorize = () => Promise.resolve(true)
    f.deps.journal = () => {
      f.board.pause()
      return Promise.resolve()
    }
    await f.scheduler.wake()
    expect(f.deps.start).not.toHaveBeenCalled()
    expect(f.slots.snapshot()).toMatchObject([{ state: 'uncertain' }])
    expect(f.deps.uncertain).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    const fresh = fixture()
    fresh.board.submit([submission('a')], 0)
    const order: string[] = []
    fresh.deps.journal = () => {
      order.push('journal')
      return Promise.resolve()
    }
    fresh.deps.start = () => {
      order.push('start')
      return Promise.resolve('started')
    }
    await fresh.scheduler.wake()
    expect(order).toEqual(['journal', 'start'])
  })

  it('retains slots/leases on an uncertain launch and Stop never preempts running work', async () => {
    const f = fixture(1)
    f.board.submit([submission('a'), submission('b')], 0)
    f.deps.start = () => Promise.resolve('uncertain')
    await f.scheduler.wake()
    expect(f.board.task('a').state).toBe('blocked')
    expect(f.slots.snapshot()).toHaveLength(1)
    expect(f.deps.uncertain).toHaveBeenCalledOnce()
    await expect(f.scheduler.retired({ taskId: 'a', attempt: 1 })).rejects.toThrow('notRetired')
    f.scheduler.stopSweep()
    await f.scheduler.wake()
    expect(f.slots.snapshot()).toHaveLength(1)
    expect(f.board.task('b').state).toBe('ready')
  })

  it('has no timer/worker effects until explicitly started and sweeps recovered limits', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.board.submit([submission('a')], 0)
    f.deps.context = () => pickContext({ canStart: () => false })
    await vi.advanceTimersByTimeAsync(TEAM_SCHED_TICK_MS * 2)
    expect(f.deps.start).not.toHaveBeenCalled()
    f.scheduler.startSweep()
    await vi.advanceTimersByTimeAsync(TEAM_SCHED_TICK_MS)
    expect(f.deps.start).not.toHaveBeenCalled()
    f.deps.context = () => pickContext()
    await vi.advanceTimersByTimeAsync(TEAM_SCHED_TICK_MS)
    expect(f.deps.start).toHaveBeenCalledOnce()
    f.scheduler.stopSweep()
    expect(vi.getTimerCount()).toBe(0)
  })
})
