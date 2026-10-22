import { describe, expect, it } from 'vitest'
import { ModelApiPacing } from '../../src/core/backends/modelapi/pacing'
import { fanOutPacingClass } from '../../src/core/backends/modelapi/subagentTools'

function pacer() {
  return new ModelApiPacing({
    now: () => Date.now(),
    wait: (ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        const onAbort = () => {
          clearTimeout(timer)
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }),
  })
}

function observed(pacing: ModelApiPacing, account: string) {
  pacing.observe(
    account,
    {
      requests: 10,
      remainingRequests: 0,
      tokens: 1000,
      remainingTokens: 1000,
      requestWindowMs: 100,
      tokenWindowMs: 100,
    },
    0,
  )
}

describe('pacing follows the provider, not our own pace (NOLIMITS2 C2)', () => {
  it('unobserved background work admits freely with no headroom math', async () => {
    const pacing = pacer()
    const waits: number[] = []
    const signal = new AbortController().signal
    for (let index = 0; index < 10; index += 1) {
      await pacing.acquire('fresh', 'team', 100, signal, (delayMs) => {
        waits.push(delayMs)
      })
    }
    // Ten admissions at a 10-a-minute startup pace would queue the last
    // ones; following only observed headers, none wait.
    expect(waits).toEqual([])
  })

  it('over-half-bucket estimates are admitted, never refused', async () => {
    const pacing = pacer()
    pacing.observe(
      'roomy',
      { requests: 10, remainingRequests: 10, tokens: 1000, remainingTokens: 1000 },
      0,
    )
    const signal = new AbortController().signal
    // Six hundred of a thousand observed tokens: the old half-bucket
    // refusal threw here; headers with room admit.
    await expect(pacing.acquire('roomy', 'team', 600, signal)).resolves.toBeUndefined()
  })

  it('observed exhaustion still queues behind the provider headers', async () => {
    const pacing = pacer()
    observed(pacing, 'busy')
    const waits: number[] = []
    const signal = new AbortController().signal
    await pacing.acquire('busy', 'team', 10, signal, (delayMs) => {
      waits.push(delayMs)
    })
    expect(waits.length).toBeGreaterThan(0)
    expect(waits[0]).toBeGreaterThan(0)
  })

  it('a 429 pause holds even before the first headers', async () => {
    const pacing = pacer()
    pacing.observe('paused', undefined, 60)
    const waits: number[] = []
    const signal = new AbortController().signal
    await pacing.acquire('paused', 'team', 10, signal, (delayMs) => {
      waits.push(delayMs)
    })
    expect(waits.length).toBeGreaterThan(0)
  })

  it('an estimate past the whole observed bucket waits for a full bucket, then goes', async () => {
    const pacing = pacer()
    pacing.observe(
      'small',
      {
        requests: 10,
        remainingRequests: 10,
        tokens: 1000,
        remainingTokens: 0,
        requestWindowMs: 100,
        tokenWindowMs: 100,
      },
      0,
    )
    const waits: number[] = []
    const signal = new AbortController().signal
    // Five thousand tokens against a thousand-token bucket: no refill ever
    // covers it, so the wait ends when the bucket is full (one window).
    await pacing.acquire('small', 'team', 5000, signal, (delayMs) => {
      waits.push(delayMs)
    })
    expect(waits.length).toBeGreaterThan(0)
    expect(Math.max(...waits)).toBeLessThanOrEqual(100)
  })

  it('Stop ends a headroom wait', async () => {
    const pacing = pacer()
    // A minute's window with no request left: the wait is seconds long.
    pacing.observe(
      'stuck',
      {
        requests: 10,
        remainingRequests: 0,
        tokens: 1000,
        remainingTokens: 0,
        requestWindowMs: 60_000,
        tokenWindowMs: 60_000,
      },
      0,
    )
    const controller = new AbortController()
    const waited = pacing.acquire('stuck', 'team', 100, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort(new Error('stopped by the test'))
    await expect(waited).rejects.toThrow('stopped by the test')
  })

  it('foreground never queues, however exhausted the observed bucket', async () => {
    const pacing = pacer()
    observed(pacing, 'drained')
    const waits: number[] = []
    const signal = new AbortController().signal
    await pacing.acquire('drained', 'foreground', 10, signal, (delayMs) => {
      waits.push(delayMs)
    })
    expect(waits).toEqual([])
  })
})

describe('fan-out pacing classes (D86.6, C-M106-4)', () => {
  it('paces key-billed team work as background team, never foreground', () => {
    expect(fanOutPacingClass('teamWorkers')).toBe('team')
  })

  it('keeps every paid tag on its own class', () => {
    expect(fanOutPacingClass('subagents')).toBe('subagent')
    expect(fanOutPacingClass('bestOfN')).toBe('bestOfN')
    expect(fanOutPacingClass('scheduledPrompts')).toBe('schedule')
    expect(fanOutPacingClass('judge')).toBe('judge')
    expect(fanOutPacingClass(undefined)).toBe('foreground')
  })
})
