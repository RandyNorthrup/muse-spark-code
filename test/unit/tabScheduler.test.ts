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

/** Work whose run the test starts and settles by hand. */
function hanging(token: { cancelled: boolean }, onRun: () => void): {
  work: TabScheduledWork
  settle: () => void
} {
  let release: (() => void) | undefined
  const work: TabScheduledWork = {
    token,
    run: () => {
      onRun()
      return new Promise<void>((resolve) => {
        release = resolve
      })
    },
  }
  return { work, settle: () => release?.() }
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
    let release: (() => void) | undefined
    let finished = false
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scheduler.trigger(
      {
        token,
        run: () =>
          gate.then(() => {
            finished = true
          }),
      },
      { immediate: true },
    )
    await advance(0)
    expect(scheduler.inFlightCount).toBe(1)
    // The scheduler holds no abort handle: cancelling only stops unsent work.
    token.cancelled = true
    release?.()
    await advance(0)
    expect(finished).toBe(true)
    expect(scheduler.inFlightCount).toBe(0)
  })
})

describe('caps', () => {
  it(`keeps at most ${String(TAB_MAX_IN_FLIGHT)} requests open`, async () => {
    const { scheduler, advance } = setup()
    const started: string[] = []
    const first = hanging({ cancelled: false }, () => started.push('first'))
    const second = hanging({ cancelled: false }, () => started.push('second'))
    const third = hanging({ cancelled: false }, () => started.push('third'))
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
