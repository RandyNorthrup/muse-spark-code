// PROVM95: each provider's rate-limit headers with their real meaning.
// Limit/remaining values come straight from the recorded 2026-10-04
// captures (`docs/certification/m95-captures/<provider>/*-stream.json`,
// made as docs/certification/m95-captures.md says); only the Anthropic
// reset needs a live timestamp, since the captured resets are past and a
// past reset keeps the default window by design.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  anthropicPacingLimits,
  azureRetryAfterMs,
  ModelApiPacing,
  openaiPacingLimits,
  resetDurationMs,
  xaiPacingLimits,
} from '../../src/core/backends/modelapi/pacing'
import { isPacingGoverned, providerWaitMs } from '../../src/core/backends/modelapi/transport'

const CAPTURE_FILES = {
  groq: '02-tool-call-stream.json',
  openai: '02-tool-call-stream.json',
  xai: '03-tool-call-stream.json',
  anthropic: '03-tool-call-stream.json',
} as const

const capturedHeaders = Object.fromEntries(
  Object.entries(CAPTURE_FILES).map(([provider, file]) => {
    const frame = JSON.parse(
      readFileSync(
        new URL(`../../docs/certification/m95-captures/${provider}/${file}`, import.meta.url),
        'utf8',
      ),
    ) as { response: { headers: Record<string, string> } }
    return [provider, new Headers(frame.response.headers)] as const
  }),
) as Record<keyof typeof CAPTURE_FILES, Headers>

describe('resetDurationMs', () => {
  it('reads the captured OpenAI/Groq durations as milliseconds until reset', () => {
    // OpenAI 02-tool-call-stream.json; Groq 02-tool-call-stream.json.
    expect(resetDurationMs('120ms')).toBe(120)
    expect(resetDurationMs('225ms')).toBe(225)
    expect(resetDurationMs('15.254s')).toBe(15_254)
    expect(resetDurationMs('1m26.4s')).toBe(86_400)
    expect(resetDurationMs('6m0s')).toBe(360_000)
    expect(resetDurationMs('1h2m3s')).toBe(3_723_000)
  })
  it('refuses anything that is not a whole duration', () => {
    expect(resetDurationMs(null)).toBeUndefined()
    expect(resetDurationMs('')).toBeUndefined()
    expect(resetDurationMs('soon')).toBeUndefined()
    expect(resetDurationMs('5')).toBeUndefined()
    expect(resetDurationMs('1x')).toBeUndefined()
    expect(resetDurationMs('1m26.4s!')).toBeUndefined()
    expect(resetDurationMs('-5s')).toBeUndefined()
  })
})

describe('provider pacing readers', () => {
  it('derives Groq windows from the captured resets: requests per day, tokens per minute', () => {
    // A reset is the time until the bucket is full again, not the window:
    // window = reset * limit / (limit - remaining). Groq requests:
    // 86.4 s * 1000 / 1 = 86_400_000 ms (one day); tokens:
    // 15.254 s * 8000 / 2034 = about one minute. Each bucket keeps its
    // own window, so background work refills tokens per minute instead
    // of stalling on the daily request window.
    const limits = openaiPacingLimits(capturedHeaders.groq)
    expect(limits).toMatchObject({
      requests: 1000,
      remainingRequests: 999,
      tokens: 8000,
      remainingTokens: 5966,
      requestWindowMs: 86_400_000,
      tokenWindowMs: 59_996,
    })
  })
  it('derives OpenAI per-minute windows from the captured resets', () => {
    // Requests: 120 ms * 500 / 1 = 60_000 ms; tokens:
    // 225 ms * 500_000 / 1882 = about the same minute.
    const limits = openaiPacingLimits(capturedHeaders.openai)
    expect(limits).toMatchObject({
      requests: 500,
      remainingRequests: 499,
      tokens: 500_000,
      remainingTokens: 498_118,
      requestWindowMs: 60_000,
      tokenWindowMs: 59_776,
    })
  })
  it('reads xAI limits with no reset, so the default window stands', () => {
    const limits = xaiPacingLimits(capturedHeaders.xai)
    expect(limits).toMatchObject({
      requests: 1800,
      remainingRequests: 1800,
      tokens: 10_000_000,
      remainingTokens: 10_000_000,
    })
    expect(limits?.requestWindowMs).toBeUndefined()
    expect(limits?.tokenWindowMs).toBeUndefined()
  })
  it('reads Anthropic request and total-token buckets from the captured frame', () => {
    // The captured resets are past, so the window stays default; the
    // future-reset case below proves the timestamp meaning.
    const limits = anthropicPacingLimits(capturedHeaders.anthropic)
    expect(limits).toMatchObject({
      requests: 10_000,
      remainingRequests: 9999,
      tokens: 12_000_000,
      remainingTokens: 11_999_000,
    })
    expect(limits?.requestWindowMs).toBeUndefined()
    expect(limits?.tokenWindowMs).toBeUndefined()
  })
  it('reads a future Anthropic reset as a timestamp, never as the window length', () => {
    const reset = new Date(Date.now() + 45_000).toISOString()
    const headers = new Headers({
      'anthropic-ratelimit-requests-limit': '10000',
      'anthropic-ratelimit-requests-remaining': '9999',
      'anthropic-ratelimit-tokens-limit': '12000000',
      'anthropic-ratelimit-tokens-remaining': '11999000',
      'anthropic-ratelimit-requests-reset': reset,
      'anthropic-ratelimit-tokens-reset': reset,
      'anthropic-ratelimit-input-tokens-reset': reset,
      'anthropic-ratelimit-output-tokens-reset': reset,
    })
    // Every captured Anthropic bucket resets at the same instant (a fixed
    // window boundary), so the reset names when, not how long: the window
    // stays the default instead of shrinking to the time left in it.
    expect(anthropicPacingLimits(headers)?.requestWindowMs).toBeUndefined()
    expect(anthropicPacingLimits(headers)?.tokenWindowMs).toBeUndefined()
  })
  it('fails closed on partial, zero or unreadable limit headers', () => {
    expect(openaiPacingLimits(new Headers())).toBeUndefined()
    expect(xaiPacingLimits(new Headers())).toBeUndefined()
    expect(anthropicPacingLimits(new Headers())).toBeUndefined()
    expect(
      openaiPacingLimits(
        new Headers({
          'x-ratelimit-limit-requests': '10',
          'x-ratelimit-remaining-requests': '9',
        }),
      ),
    ).toBeUndefined()
    expect(
      openaiPacingLimits(
        new Headers({
          'x-ratelimit-limit-requests': '0',
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-limit-tokens': '8',
          'x-ratelimit-remaining-tokens': '7',
        }),
      ),
    ).toBeUndefined()
    const clamped = openaiPacingLimits(
      new Headers({
        'x-ratelimit-limit-requests': '10',
        'x-ratelimit-remaining-requests': '99',
        'x-ratelimit-limit-tokens': '8',
        'x-ratelimit-remaining-tokens': '7',
      }),
    )
    expect(clamped?.remainingRequests).toBe(10)
  })
})

describe('pacing admission', () => {
  it('governs configured-provider inference carrying a model id, nothing else', () => {
    // The codec path supplies the native model id on a native path (never
    // `/responses`): a Groq or Anthropic stream joins the bucket its
    // rate-limit observations feed, so learned quotas and 429 pauses
    // throttle its background fan-out.
    expect(isPacingGoverned('/chat/completions', 'llama-3.3-70b-versatile', 'groq')).toBe(true)
    expect(isPacingGoverned('/v1/messages', 'claude-sonnet-4-5', 'anthropic')).toBe(true)
    // Count and list calls carry no model id and stay observation-only.
    expect(isPacingGoverned('/chat/completions', undefined, 'groq')).toBe(false)
    expect(isPacingGoverned('/models', undefined, 'groq')).toBe(false)
    // Meta keeps its exact shape: only `/responses` with a model id.
    expect(isPacingGoverned('/responses', 'muse-spark-1-3', 'meta')).toBe(true)
    expect(isPacingGoverned('/responses', undefined, 'meta')).toBe(false)
    expect(isPacingGoverned('/responses/input_tokens', undefined, 'meta')).toBe(false)
    expect(isPacingGoverned('/models', undefined, 'meta')).toBe(false)
  })

  it('holds background fan-out on a configured-provider pause while the foreground passes', async () => {
    // A 429 pause the observation recorded (the captured Groq readers
    // teach the windows, the 2 s wait stands in for its Retry-After):
    // admitted background work waits it out, the user's turn never does.
    let now = 1_800_000_000_000
    const waits: number[] = []
    const pacing = new ModelApiPacing({
      now: () => now,
      wait: (ms) => {
        waits.push(ms)
        now += ms
        return Promise.resolve()
      },
    })
    pacing.observe('groq', openaiPacingLimits(capturedHeaders.groq), 2000)
    await pacing.acquire('groq', 'subagent', 0, AbortSignal.timeout(5000))
    expect(waits).toEqual([2000])
    await pacing.acquire('groq', 'foreground', 0, AbortSignal.timeout(5000))
    expect(waits).toEqual([2000])
  })
})

describe('ModelApiPacing refill windows', () => {
  it('refills Groq tokens per minute while requests refill per day', () => {
    // The captured Groq limits give requests a one-day window and tokens
    // a one-minute window. After a minute the token bucket is full again
    // while the request bucket has barely moved: a shared slower window
    // used to stall background work for hours here.
    let now = 1_800_000_000_000
    const pacing = new ModelApiPacing({
      now: () => now,
      wait: (ms) => {
        now += ms
        return Promise.resolve()
      },
    })
    const limits = openaiPacingLimits(capturedHeaders.groq)
    expect(limits).toBeDefined()
    pacing.observe('groq', limits)
    const start = pacing.headroom('groq')
    expect(start.remainingTokens).toBe(5966)
    now += 61_000
    const later = pacing.headroom('groq')
    expect(later.remainingTokens).toBe(8000)
    expect(later.remainingRequests).toBeLessThan(1000)
  })
})

describe('azureRetryAfterMs', () => {
  it('reads integer milliseconds, nothing else', () => {
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': '1500' }))).toBe(1500)
    expect(azureRetryAfterMs(new Headers())).toBeUndefined()
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': '1.5' }))).toBeUndefined()
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': '-3' }))).toBeUndefined()
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': 'soon' }))).toBeUndefined()
  })
  it('reads the millisecond header first (research azure-openai.md ZB2)', () => {
    const now = Date.now()
    expect(providerWaitMs(new Headers({ 'retry-after': '2', 'retry-after-ms': '1500' }), now)).toBe(
      1500,
    )
    expect(providerWaitMs(new Headers({ 'retry-after-ms': '1500' }), now)).toBe(1500)
    expect(providerWaitMs(new Headers({ 'retry-after': '2' }), now)).toBe(2000)
    expect(providerWaitMs(new Headers(), now)).toBeUndefined()
  })
})
