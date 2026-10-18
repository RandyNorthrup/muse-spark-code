// The production build's bounded pool (F6, msm112 cert): at most `size`
// tasks run at once, every result is keyed by bundle name, and a failure
// names its bundle and leaves unstarted work unstarted. Real tasks with real
// short delays only; no fakes, no timers.
import { describe, expect, it } from 'vitest'
import { runBuildPool, type PoolSpec } from '../../scripts/lib/buildPool.mjs'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

describe('runBuildPool', () => {
  it('keys every result by bundle name when tasks finish out of order', async () => {
    const specs: PoolSpec<string>[] = [
      [
        'slow',
        async () => {
          await delay(30)
          return 'slow-result'
        },
      ],
      [
        'fast',
        async () => {
          await delay(1)
          return 'fast-result'
        },
      ],
      [
        'medium',
        async () => {
          await delay(10)
          return 'medium-result'
        },
      ],
    ]
    const results = await runBuildPool(specs, 3)
    expect(results).toEqual({
      slow: 'slow-result',
      fast: 'fast-result',
      medium: 'medium-result',
    })
  })

  it('never runs more than `size` tasks at once', async () => {
    let inFlight = 0
    let peak = 0
    const specs: PoolSpec<number>[] = Array.from({ length: 9 }, (_, index) => [
      `bundle-${String(index)}`,
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await delay(5)
        inFlight -= 1
        return index
      },
    ])
    const results = await runBuildPool(specs, 2)
    expect(Object.keys(results)).toHaveLength(9)
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('names the failing bundle and never starts later work', async () => {
    const started: string[] = []
    const specs: PoolSpec<string>[] = [
      [
        'first',
        async () => {
          started.push('first')
          await delay(1)
          return 'ok'
        },
      ],
      [
        'broken',
        async () => {
          started.push('broken')
          await delay(1)
          throw new Error('service blew up')
        },
      ],
      [
        'never',
        () => {
          started.push('never')
          return Promise.resolve('unreached')
        },
      ],
    ]
    await expect(runBuildPool(specs, 1)).rejects.toThrow('bundle broken failed: service blew up')
    expect(started).toEqual(['first', 'broken'])
  })

  it('waits for in-flight work to settle before rejecting, and keeps a non-Error cause readable', async () => {
    let didSlowFinish = false
    const specs: PoolSpec<string>[] = [
      [
        'slow',
        async () => {
          await delay(40)
          didSlowFinish = true
          return 'slow-result'
        },
      ],
      [
        'broken',
        async () => {
          await delay(1)
          // A thrown value need not be an Error; the pool must not lose it
          // or crash reading `.message` off it.
          const failure: unknown = 'plain string failure'
          throw failure
        },
      ],
    ]
    await expect(runBuildPool(specs, 2)).rejects.toThrow(
      'bundle broken failed: plain string failure',
    )
    // The caller stops the esbuild service when the pool rejects, so no
    // bundle may still be in flight at that point.
    expect(didSlowFinish).toBe(true)
  })

  it('refuses an invalid size or duplicate names instead of silently dropping work', async () => {
    let ran = 0
    const specs: PoolSpec<number>[] = [
      [
        'one',
        () => {
          ran += 1
          return Promise.resolve(1)
        },
      ],
    ]
    await expect(runBuildPool(specs, NaN)).rejects.toThrow('pool size')
    await expect(runBuildPool(specs, 0)).rejects.toThrow('pool size')
    expect(ran).toBe(0)
    const duplicates: PoolSpec<number>[] = [
      ['dup', () => Promise.resolve(1)],
      ['dup', () => Promise.resolve(2)],
    ]
    await expect(runBuildPool(duplicates, 2)).rejects.toThrow('duplicate bundle name: dup')
  })
})
