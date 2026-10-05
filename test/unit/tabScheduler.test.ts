import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TAB_DEBOUNCE_MS,
  TAB_MAX_IN_FLIGHT,
  TAB_MAX_REQUESTS_PER_MINUTE,
} from '../../src/shared/constants'
import { TabScheduler, type TabScheduledWork } from '../../src/core/tab/tabScheduler'

/** A manually clocked scheduler: time moves only here. */
function setup(): {
  scheduler: TabScheduler
  advance: (ms: number) => Promise<void>
} {
  vi.useFakeTimers()
  let now = 1_000_000
  const scheduler = new TabScheduler({ now: () => now })
  return {
    scheduler,
    advance: async (ms: number) => {
      now += ms
      await vi.advanceTimersByTimeAsync(ms)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

/** A run hook that logs `name` into `log`. */
function record(log: string[], name: string): () => void {
  return () => {
    log.push(name)
  }
}

/** Work whose run the test starts and settles by hand. */
function hanging(
  token: { cancelled: boolean },
  onRun: () => void,
): {
  work: TabScheduledWork
  settle: () => void
} {
  const gate = Promise.withResolvers<undefined>()
  const work: TabScheduledWork = {
    token,
    run: async () => {
      onRun()
      await gate.promise
    },
  }
  return {
    work,
    settle: () => {
      gate.resolve(undefined)
    },
  }
}

async function startOlderRequest() {
  const { scheduler, advance } = setup()
  const started: string[] = []
  const older = hanging({ cancelled: false }, record(started, 'A'))
  scheduler.trigger(older.work, { immediate: true })
  await advance(0)
  return { scheduler, advance, started, older }
}

describe('debounce', () => {
  it('sends nothing while keystrokes keep coming, then sends the latest', async () => {
    const { scheduler, advance } = setup()
    const seen: string[] = []
    const immediate = (name: string): TabScheduledWork => ({
      token: { cancelled: false },
      run: () => {
        seen.push(name)
        return Promise.resolve()
      },
    })
    scheduler.trigger(immediate('first'))
    await advance(TAB_DEBOUNCE_MS - 1)
    scheduler.trigger(immediate('second'))
    await advance(TAB_DEBOUNCE_MS - 1)
    expect(seen).toEqual([])
    await advance(1)
    expect(seen).toEqual(['second'])
  })

  it('sends nothing when the token is cancelled before the wait ends', async () => {
    const { scheduler, advance } = setup()
    const token = { cancelled: false }
    let runs = 0
    scheduler.trigger({
      token,
      run: () => {
        runs += 1
        return Promise.resolve()
      },
    })
    token.cancelled = true
    await advance(TAB_DEBOUNCE_MS)
    expect(runs).toBe(0)
    expect(scheduler.hasPending).toBe(false)
  })

  it('never sends newer Automatic work early when older work settles', async () => {
    const { scheduler, advance, started, older } = await startOlderRequest()
    expect(started).toEqual(['A'])
    scheduler.trigger({
      token: { cancelled: false },
      run: () => {
        record(started, 'B')()
        return Promise.resolve()
      },
    })
    const settleAt = 100
    await advance(settleAt)
    older.settle()
    await advance(0)
    expect(started).toEqual(['A'])
    expect(scheduler.hasPending).toBe(true)
    await advance(TAB_DEBOUNCE_MS - settleAt - 1)
    expect(started).toEqual(['A'])
    await advance(1)
    expect(started).toEqual(['A', 'B'])
    await advance(TAB_DEBOUNCE_MS)
    expect(started).toEqual(['A', 'B'])
  })

  it('keeps the cancellation window after older work settles', async () => {
    const { scheduler, advance, started, older } = await startOlderRequest()
    const token = { cancelled: false }
    scheduler.trigger({
      token,
      run: () => {
        record(started, 'B')()
        return Promise.resolve()
      },
    })
    older.settle()
    await advance(0)
    token.cancelled = true
    await advance(TAB_DEBOUNCE_MS)
    expect(started).toEqual(['A'])
    expect(scheduler.hasPending).toBe(false)
  })

  it('skips the wait on Invoke', async () => {
    const { scheduler, advance } = setup()
    let runs = 0
    scheduler.trigger(
      {
        token: { cancelled: false },
        run: () => {
          runs += 1
          return Promise.resolve()
        },
      },
      { immediate: true },
    )
    await advance(0)
    expect(runs).toBe(1)
  })
})

describe('never abort', () => {
  it('lets a sent request run to its end after its token is cancelled', async () => {
    const { scheduler, advance } = setup()
    const token = { cancelled: false }
    let isFinished = false
    const gate = Promise.withResolvers<undefined>()
    scheduler.trigger(
      {
        token,
        run: async () => {
          await gate.promise
          isFinished = true
        },
      },
      { immediate: true },
    )
    await advance(0)
    expect(scheduler.inFlightCount).toBe(1)
    // The scheduler holds no abort handle: cancelling only stops unsent work.
    token.cancelled = true
    gate.resolve(undefined)
    await advance(0)
    expect(isFinished).toBe(true)
    expect(scheduler.inFlightCount).toBe(0)
  })
})

describe('caps', () => {
  it(`keeps at most ${String(TAB_MAX_IN_FLIGHT)} requests open`, async () => {
    const { scheduler, advance } = setup()
    const started: string[] = []
    const first = hanging({ cancelled: false }, record(started, 'first'))
    const second = hanging({ cancelled: false }, record(started, 'second'))
    const third = hanging({ cancelled: false }, record(started, 'third'))
    scheduler.trigger(first.work, { immediate: true })
    scheduler.trigger(second.work, { immediate: true })
    scheduler.trigger(third.work, { immediate: true })
    await advance(0)
    expect(started).toEqual(['first', 'second'])
    expect(scheduler.hasPending).toBe(true)
    first.settle()
    await advance(0)
    expect(started).toEqual(['first', 'second', 'third'])
  })

  it(`starts at most ${String(TAB_MAX_REQUESTS_PER_MINUTE)} requests a minute, then resumes`, async () => {
    const { scheduler, advance } = setup()
    let starts = 0
    const quick = (): TabScheduledWork => ({
      token: { cancelled: false },
      run: () => {
        starts += 1
        return Promise.resolve()
      },
    })
    for (let index = 0; index < TAB_MAX_REQUESTS_PER_MINUTE; index += 1) {
      scheduler.trigger(quick(), { immediate: true })
      await advance(0)
    }
    expect(starts).toBe(TAB_MAX_REQUESTS_PER_MINUTE)
    scheduler.trigger(quick(), { immediate: true })
    await advance(0)
    expect(starts).toBe(TAB_MAX_REQUESTS_PER_MINUTE)
    expect(scheduler.hasPending).toBe(true)
    await advance(60_000)
    expect(starts).toBe(TAB_MAX_REQUESTS_PER_MINUTE + 1)
    expect(scheduler.hasPending).toBe(false)
  })
})
