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
  openaiPacingLimits,
  resetDurationMs,
  resetTimestampMs,
  xaiPacingLimits,
} from '../../src/core/backends/modelapi/pacing'
import { retryWaitMs } from '../../src/core/backends/modelapi/transport'

function captureHeaders(provider: string, file: string): Headers {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL(`../../docs/certification/m95-captures/${provider}/${file}`, import.meta.url),
      'utf8',
    ),
  )
  if (typeof raw !== 'object' || raw === null || !('response' in raw))
    throw new Error('No response')
  const response = raw.response as { headers?: Record<string, string> }
  return new Headers(response.headers ?? {})
}

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
  it('reads Groq limits with the longest captured reset as the window', () => {
    const limits = openaiPacingLimits(captureHeaders('groq', '02-tool-call-stream.json'))
    expect(limits).toMatchObject({
      requests: 1000,
      remainingRequests: 999,
      tokens: 8000,
      remainingTokens: 5966,
      windowMs: 86_400,
    })
  })
  it('reads OpenAI limits with the longest captured reset as the window', () => {
    const limits = openaiPacingLimits(captureHeaders('openai', '02-tool-call-stream.json'))
    expect(limits).toMatchObject({
      requests: 500,
      remainingRequests: 499,
      tokens: 500_000,
      remainingTokens: 498_118,
      windowMs: 225,
    })
  })
  it('reads xAI limits with no reset, so the default window stands', () => {
    const limits = xaiPacingLimits(captureHeaders('xai', '03-tool-call-stream.json'))
    expect(limits).toMatchObject({
      requests: 1800,
      remainingRequests: 1800,
      tokens: 10_000_000,
      remainingTokens: 10_000_000,
    })
    expect(limits?.windowMs).toBeUndefined()
  })
  it('reads Anthropic request and total-token buckets from the captured frame', () => {
    // The captured resets are past, so the window stays default; the
    // future-reset case below proves the timestamp meaning.
    const limits = anthropicPacingLimits(captureHeaders('anthropic', '03-tool-call-stream.json'))
    expect(limits).toMatchObject({
      requests: 10_000,
      remainingRequests: 9999,
      tokens: 12_000_000,
      remainingTokens: 11_999_000,
    })
    expect(limits?.windowMs).toBeUndefined()
  })
  it('turns a future Anthropic reset into the milliseconds until it', () => {
    const reset = new Date(Date.now() + 45_000).toISOString()
    expect(resetTimestampMs(reset)).toBeGreaterThan(Date.now())
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
    const windowMs = anthropicPacingLimits(headers)?.windowMs ?? 0
    expect(windowMs).toBeGreaterThan(40_000)
    expect(windowMs).toBeLessThanOrEqual(45_000)
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

describe('azureRetryAfterMs', () => {
  it('reads integer milliseconds, nothing else', () => {
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': '1500' }))).toBe(1500)
    expect(azureRetryAfterMs(new Headers())).toBeUndefined()
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': '1.5' }))).toBeUndefined()
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': '-3' }))).toBeUndefined()
    expect(azureRetryAfterMs(new Headers({ 'retry-after-ms': 'soon' }))).toBeUndefined()
  })
  it('backs the standard header, which keeps precedence', () => {
    const now = Date.now()
    expect(retryWaitMs(new Headers({ 'retry-after': '2', 'retry-after-ms': '1500' }), now)).toBe(
      2000,
    )
    expect(retryWaitMs(new Headers({ 'retry-after-ms': '1500' }), now)).toBe(1500)
    expect(retryWaitMs(new Headers(), now)).toBeUndefined()
  })
})
