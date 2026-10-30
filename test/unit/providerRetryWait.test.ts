// A provider-named 429 wait is honoured whole and told at once: the retry
// notice names when the wait ends in absolute time and plain words, and
// the turn's Stop ends the wait immediately. No fetch answers anything
// here and no Response plays the provider: the header values are plain
// input to the real decision functions (`providerWaitMs`, `backoffMs`,
// `providerRetryReason` — the exact function the request loop calls per
// retry), the real `pause` sleeps over real timers against a real
// AbortController, and the real `ModelApiPacing` holds background dispatch
// for the derived wait. The real global `fetch` is passed as the
// transport's dependency but `request` never runs, so it is never called.

import { describe, expect, it } from 'vitest'
import { realRecordingPacer } from './helpers/realPacer'
import {
  providerRetryReason,
  providerWaitMs,
  RequestTransport,
} from '../../src/core/backends/modelapi/transport'
import { MODEL_API_RETRY_MAX_MS, UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'

const FIXED_NOW = 1_800_000_000_000
const HOSTILE_WAIT_MS = 99_999_999_999_999

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** The real transport with real timers; `request` never runs, so its fetch is never called. */
function transport(seen?: number[]): RequestTransport {
  return new RequestTransport({
    fetch,
    baseUrl: 'https://example.invalid',
    apiKey: () => Promise.resolve('test-key'),
    sleep: (ms: number) => {
      seen?.push(ms)
      return new Promise<void>((done) => setTimeout(done, ms))
    },
    now: () => Date.now(),
    random: () => 0,
    log: silent,
  })
}

describe('a provider-named 429 wait', () => {
  it('is derived from the header values as plain input and slept whole', () => {
    // `retry-after-ms` first (Azure), then `Retry-After` seconds, then an
    // HTTP date; a trillions-scale value stays whole — no ceiling of ours
    // applies to a value the provider sent.
    expect(providerWaitMs(new Headers({ 'retry-after-ms': '250' }), FIXED_NOW)).toBe(250)
    expect(providerWaitMs(new Headers({ 'retry-after': '120' }), FIXED_NOW)).toBe(120_000)
    expect(
      providerWaitMs(new Headers({ 'retry-after': '2', 'retry-after-ms': '1500' }), FIXED_NOW),
    ).toBe(1500)
    expect(
      providerWaitMs(
        new Headers({ 'retry-after': new Date(FIXED_NOW + 5000).toUTCString() }),
        FIXED_NOW,
      ),
    ).toBe(5000)
    expect(
      providerWaitMs(new Headers({ 'retry-after-ms': String(HOSTILE_WAIT_MS) }), FIXED_NOW),
    ).toBe(HOSTILE_WAIT_MS)
    expect(providerWaitMs(new Headers(), FIXED_NOW)).toBeUndefined()
    // The retry loop sleeps what `backoffMs` returns: a named wait whole
    // per try, while our own fallback (no provider value) keeps a ceiling.
    const real = transport()
    expect(real.backoffMs(0, 250)).toBe(250)
    expect(real.backoffMs(0, HOSTILE_WAIT_MS)).toBe(HOSTILE_WAIT_MS)
    for (const attempt of [0, 1, 2, 3]) {
      expect(real.backoffMs(attempt, undefined)).toBeLessThanOrEqual(MODEL_API_RETRY_MAX_MS)
    }
  })

  it('is told with when it ends in absolute time', () => {
    // The exact function the request loop calls per retry: a named wait
    // reads as the absolute-time sentence, an unnamed one as the plain
    // `HTTP …` reason the rate-limited retry readers match on.
    expect(providerRetryReason(429, 'slow down', 250, FIXED_NOW)).toBe(
      fill(UI_TEXT.modelApiProviderRetryWait, {
        reason: 'HTTP 429: slow down',
        time: formatDateTime(FIXED_NOW + 250),
      }),
    )
    expect(providerRetryReason(429, 'slow down', HOSTILE_WAIT_MS, FIXED_NOW)).toBe(
      fill(UI_TEXT.modelApiProviderRetryWait, {
        reason: 'HTTP 429: slow down',
        time: formatDateTime(FIXED_NOW + HOSTILE_WAIT_MS),
      }),
    )
    expect(providerRetryReason(429, 'slow down', undefined, FIXED_NOW)).toBe('HTTP 429: slow down')
  })

  it('ends at once when the turn stops, naming the whole wait it cut short', async () => {
    // The header values derive the whole 120 s wait and its absolute end;
    // the real in-progress sleep ends on the Stop 50 ms later, in
    // milliseconds rather than minutes.
    const derived = providerWaitMs(new Headers({ 'retry-after': '120' }), FIXED_NOW)
    expect(derived).toBe(120_000)
    const real = transport()
    const delay = real.backoffMs(0, derived)
    expect(delay).toBe(120_000)
    expect(providerRetryReason(429, 'slow down', delay, FIXED_NOW)).toBe(
      fill(UI_TEXT.modelApiProviderRetryWait, {
        reason: 'HTTP 429: slow down',
        time: formatDateTime(FIXED_NOW + 120_000),
      }),
    )
    const stop = new AbortController()
    const started = performance.now()
    const waiting = real.pause(delay, stop.signal)
    setTimeout(() => {
      stop.abort()
    }, 50)
    await expect(waiting).rejects.toThrow('cancelled')
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('really sleeps the whole named wait over real timers', async () => {
    // The whole named wait reaches the real timer, and the pause does not
    // resolve before it: still waiting 50 ms in proves the wait was not
    // skipped, with no wall-clock floor for timer jitter to trip.
    const seen: number[] = []
    let isResolved = false
    const waiting = (async () => {
      await transport(seen).pause(250, new AbortController().signal)
      isResolved = true
    })()
    await new Promise((done) => setTimeout(done, 50))
    expect(isResolved).toBe(false)
    expect(seen).toEqual([250])
    await waiting
    expect(isResolved).toBe(true)
  })

  it('pauses background dispatch for the whole derived wait while the foreground passes', async () => {
    // The wait derived from the header values holds admitted background
    // work: the background acquire really sleeps it out over real timers
    // while the user's turn, acquired beside it, resolves first. The
    // pacer's clock is real time, so the slept remainder carries the
    // milliseconds the dispatch itself took, within tolerance.
    const derived = providerWaitMs(new Headers({ 'retry-after-ms': '250' }), Date.now())
    expect(derived).toBe(250)
    const { pacing, waits } = realRecordingPacer()
    pacing.observe('rogue', undefined, derived)
    const order: string[] = []
    const backgrounded = (async () => {
      await pacing.acquire('rogue', 'subagent', 0, AbortSignal.timeout(5000))
      order.push('background')
    })()
    const foregrounded = (async () => {
      await pacing.acquire('rogue', 'foreground', 0, AbortSignal.timeout(5000))
      order.push('foreground')
    })()
    await foregrounded
    // The foreground passed while the background was still sleeping.
    expect(order).toEqual(['foreground'])
    await backgrounded
    expect(order).toEqual(['foreground', 'background'])
    expect(waits).toHaveLength(1)
    expect(waits[0] ?? 0).toBeGreaterThan(200)
    expect(waits[0] ?? 0).toBeLessThanOrEqual(250)
  })
})
