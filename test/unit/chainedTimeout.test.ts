// Long waits (NOLIMITS1FIX §N5): a Node timer stops at 2^31-1 ms, so a
// person's long timeout re-arms in slices and still waits its whole length.
// Real timers only — small slices keep every case to milliseconds.
import { describe, expect, it } from 'vitest'
import { setChainedTimeout } from '../../src/host/backend/toolIo'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('setChainedTimeout', () => {
  it('fires once after the whole delay, not after the first slice', async () => {
    const started = Date.now()
    let calls = 0
    setChainedTimeout(
      () => {
        calls += 1
      },
      100,
      10,
    )
    await wait(1000)
    expect(calls).toBe(1)
    // Timers never fire early: a single first slice would land near 10 ms.
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
  })

  it('fires a short delay without chaining', async () => {
    let calls = 0
    setChainedTimeout(() => {
      calls += 1
    }, 20)
    await wait(300)
    expect(calls).toBe(1)
  })

  it('never fires after clear', async () => {
    let calls = 0
    const timeout = setChainedTimeout(
      () => {
        calls += 1
      },
      120,
      20,
    )
    await wait(50)
    timeout.clear()
    await wait(300)
    expect(calls).toBe(0)
  })
})
