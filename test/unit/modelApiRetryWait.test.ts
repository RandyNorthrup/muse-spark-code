import { describe, expect, it } from 'vitest'
import { RequestTransport } from '../../src/core/backends/modelapi/transport'
import { MODEL_API_BASE_URL, MODEL_API_TIMER_MAX_MS } from '../../src/shared/constants'

function silent(): void {
  // The wait test never logs.
}

function transportFor(slept: number[]): RequestTransport {
  return new RequestTransport({
    fetch: () => Promise.reject(new Error('a wait test never fetches')),
    baseUrl: MODEL_API_BASE_URL,
    sleep: (ms: number) => {
      slept.push(ms)
      return Promise.resolve()
    },
    now: () => 0,
    random: () => 0,
    log: { trace: silent, info: silent, warn: silent, error: silent },
  })
}

describe('RequestTransport.pause', () => {
  it('sleeps an ordinary delay in one call', async () => {
    const slept: number[] = []
    await transportFor(slept).pause(1500, undefined)
    expect(slept).toEqual([1500])
  })

  it('sleeps a provider wait past the timer maximum in whole pieces', async () => {
    const slept: number[] = []
    const wait = MODEL_API_TIMER_MAX_MS + 1000
    await transportFor(slept).pause(wait, undefined)
    expect(slept).toEqual([MODEL_API_TIMER_MAX_MS, 1000])
    expect(slept.reduce((total, chunk) => total + chunk, 0)).toBe(wait)
    for (const chunk of slept) expect(chunk).toBeLessThanOrEqual(MODEL_API_TIMER_MAX_MS)
  })

  it('still refuses at once when the wait is already cancelled', async () => {
    const slept: number[] = []
    const controller = new AbortController()
    controller.abort()
    await expect(
      transportFor(slept).pause(MODEL_API_TIMER_MAX_MS + 1000, controller.signal),
    ).rejects.toThrow('cancelled')
    expect(slept).toEqual([])
  })
})
