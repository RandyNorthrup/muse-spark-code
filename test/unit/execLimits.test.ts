// The exec deadline timer honors a set --timeout with no maximum of ours: a
// delay past Node's setTimeout ceiling re-arms instead of firing after 1 ms.
// Drives the real createLifecycle; only the clock and the timer plumbing its
// signature requires are controlled (main.ts passes the setTimeout versions).
import { describe, expect, it } from 'vitest'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { NODE_SET_TIMEOUT_MAX_MS } from '../../src/shared/constants'

interface Timer {
  ms: number
  run: () => void
  cleared: boolean
}

const ignore = () => undefined

function harness(timeoutMs: number) {
  let now = 0
  const timers: Timer[] = []
  const lifecycle = createLifecycle({
    processStartMs: 0,
    timeoutMs,
    now: () => now,
    setTimer: (ms: number, run: () => void) => {
      const timer: Timer = { ms, run, cleared: false }
      timers.push(timer)
      return () => {
        timer.cleared = true
      }
    },
    onSignal: () => ignore,
    forceFinish: ignore,
    exit: (): never => {
      throw new Error('must not exit')
    },
  })
  return {
    lifecycle,
    timers,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('exec deadline with no maximum', () => {
  it('latches timeout once at an ordinary deadline', () => {
    const { lifecycle, timers, advance } = harness(5000)
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(5000)
    expect(lifecycle.cause).toBeNull()
    advance(5000)
    timers[0]?.run()
    expect(lifecycle.cause).toEqual({ kind: 'timeout' })
  })

  it('re-arms past the platform ceiling and latches only at the deadline', () => {
    const { lifecycle, timers, advance } = harness(NODE_SET_TIMEOUT_MAX_MS + 5000)
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(NODE_SET_TIMEOUT_MAX_MS)
    advance(NODE_SET_TIMEOUT_MAX_MS)
    timers[0]?.run()
    expect(lifecycle.cause).toBeNull()
    expect(timers).toHaveLength(2)
    expect(timers[1]?.ms).toBe(5000)
    advance(5000)
    timers[1]?.run()
    expect(lifecycle.cause).toEqual({ kind: 'timeout' })
  })

  it('dispose clears the pending deadline timer', () => {
    const { lifecycle, timers } = harness(5000)
    lifecycle.dispose()
    expect(timers[0]?.cleared).toBe(true)
    expect(lifecycle.cause).toBeNull()
  })
})
