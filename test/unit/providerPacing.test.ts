// PROVM95: each provider's rate-limit headers with their real meaning.
// Limit/remaining values come straight from the recorded 2026-10-04
// captures (`docs/certification/m95-captures/<provider>/*-stream.json`,
// made as docs/certification/m95-captures.md says); only the Anthropic
// reset needs a live timestamp, since the captured resets are past and a
// past reset keeps the default window by design.

import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  anthropicPacingLimits,
  azureBurstShare,
  azureRetryAfterMs,
  deepseekConcurrencyLimit,
  ModelApiPacing,
  openaiPacingLimits,
  resetDurationMs,
  xaiPacingLimits,
  type PacingClass,
  type PacingWaitHandler,
  type PacingWaitLimit,
} from '../../src/core/backends/modelapi/pacing'
import {
  isPacingGoverned,
  pacingAccountFor,
  pacingWaitReason,
  providerWaitMs,
  releaseSlotOnSettled,
  RequestTransport,
} from '../../src/core/backends/modelapi/transport'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import { buildExactCountRequest } from '../../src/core/providers/tokenCount'
import { resolveAttemptBillingRoute } from '../../src/core/backends/modelapi/billingRoute'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { haikuRequestBody } from './helpers/haikuRequest'
import { transportTestDeps } from './helpers/modelApiTransport'
import { realRecordingPacer } from './helpers/realPacer'
import {
  AZURE_BURST_WINDOW_LONG_MS,
  AZURE_BURST_WINDOW_SHORT_MS,
  DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH,
  DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_RETRY_MAX_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, formatNumber } from '../../src/shared/l10n/text'

const CAPTURE_FILES = {
  groq: '02-tool-call-stream.json',
  openai: '02-tool-call-stream.json',
  xai: '03-tool-call-stream.json',
  anthropic: '03-tool-call-stream.json',
  deepseek: '02-tool-call-stream.json',
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
  it('reads xAI limits with documented per-second requests and per-minute tokens', () => {
    // No reset headers in the capture; the scopes come from xAI's own rate
    // limit doc (docs.x.ai/developers/rate-limits, read 2026-10-22): every
    // team holds per-model requests-per-second and tokens-per-minute
    // budgets, so requests refill per second and tokens per minute.
    const limits = xaiPacingLimits(capturedHeaders.xai)
    expect(limits).toMatchObject({
      requests: 1800,
      remainingRequests: 1800,
      tokens: 10_000_000,
      remainingTokens: 10_000_000,
      requestWindowMs: 1000,
      tokenWindowMs: 60_000,
    })
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

/** A pacing wait's notice as the tests read it: the delay and the binding documented limit, if one binds it. */
interface RecordedNotice {
  readonly delayMs: number
  readonly limit: PacingWaitLimit | undefined
}

/** A pacer over controllable time that records every wait it takes and every notice it gives. */
function recordingPacer(): {
  readonly pacing: ModelApiPacing
  readonly waits: number[]
  readonly notices: RecordedNotice[]
  readonly notice: PacingWaitHandler
} {
  let now = 1_800_000_000_000
  const waits: number[] = []
  const notices: RecordedNotice[] = []
  const pacing = new ModelApiPacing({
    now: () => now,
    wait: (ms) => {
      waits.push(ms)
      now += ms
      return Promise.resolve()
    },
  })
  const notice: PacingWaitHandler = (delayMs, limit) => {
    notices.push({ delayMs, limit })
  }
  return { pacing, waits, notices, notice }
}

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
    // A 429 pause the observation recorded: the captured Groq limits
    // teach the windows (stale under real time, so the buckets stand
    // full), the 2 s pause is fresh, and admitted background work really
    // sleeps it out over real timers while the user's turn never does.
    const { pacing, waits } = realRecordingPacer()
    pacing.observe('groq', openaiPacingLimits(capturedHeaders.groq), 2000)
    await pacing.acquire('groq', 'subagent', 0, AbortSignal.timeout(5000))
    expect(waits).toHaveLength(1)
    expect(waits[0] ?? 0).toBeGreaterThan(1900)
    expect(waits[0] ?? 0).toBeLessThanOrEqual(2000)
    await pacing.acquire('groq', 'foreground', 0, AbortSignal.timeout(5000))
    expect(waits).toHaveLength(1)
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

describe('provider waits are honoured whole', () => {
  it('pauses background dispatch for the whole named wait while the foreground passes', async () => {
    // A provider answering `retry-after-ms` in the trillions pauses
    // background work for exactly that wait — no ceiling of ours applies to
    // a value the provider sent — and the user's turn never waits on a
    // sibling pause.
    const { pacing, waits } = recordingPacer()
    pacing.observe('rogue', undefined, 99_999_999_999_999)
    await pacing.acquire('rogue', 'subagent', 0, AbortSignal.timeout(5000))
    expect(waits).toEqual([99_999_999_999_999])
    await pacing.acquire('rogue', 'foreground', 0, AbortSignal.timeout(5000))
    expect(waits).toEqual([99_999_999_999_999])
  })
  it('paces count answers under their own account and leaves the message bucket untouched', async () => {
    // Token counting and message creation have separate and independent
    // rate limits (platform.claude.com/docs/en/build-with-claude/
    // token-counting): a count answer must never shape the message
    // bucket. The answer replayed here is the recorded 2026-10-04
    // Anthropic stream answer — status, headers and body all come from
    // the capture (`docs/certification/m95-captures/anthropic/
    // 03-tool-call-stream.json`, made as docs/certification/
    // m95-captures.md says). The native request is built by the real
    // codec and the count sibling by the real count builder, the same
    // two steps the client takes.
    const frame = JSON.parse(
      readFileSync(
        new URL(
          '../../docs/certification/m95-captures/anthropic/03-tool-call-stream.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { response: { status: number; headers: Record<string, string>; events: unknown[] } }
    const { pacing } = recordingPacer()
    const transport = new RequestTransport(
      transportTestDeps({
        fetch: () =>
          Promise.resolve(
            Response.json(frame.response.events, {
              status: frame.response.status,
              headers: frame.response.headers,
            }),
          ),
        baseUrl: 'https://api.anthropic.com',
        apiKey: () => Promise.resolve('test-key'),
        pacing,
        pacingProvider: () => ({
          identity: { provider: 'anthropic' },
          readLimits: anthropicPacingLimits,
        }),
      }),
    )
    const sent: CreateResponseBody = haikuRequestBody('Workspace: test', 1024)
    const encoded = encodeAnthropicRequest(sent, {
      model: 'claude-haiku-4-5',
      maxTokens: sent.max_output_tokens,
      effort: 'none',
    })
    const count = buildExactCountRequest('anthropic-count-tokens', {
      path: encoded.path,
      body: encoded.body,
      headers: encoded.headers,
    })
    if (count === undefined) throw new Error('count request not built')
    await transport.request(
      count.path,
      {
        billingRoute: await resolveAttemptBillingRoute({
          feature: 'tokenCount',
          isMetaDirect: false,
        }),
        method: 'POST',
        body: count.body,
        headers: encoded.headers,
        accept: 'application/json',
        countRequest: true,
        retries: 'rateLimitOnly',
      },
      undefined,
    )
    const digest = createHash('sha256').update('test-key').digest('hex')
    const messageAccount = pacingAccountFor('anthropic', 'https://api.anthropic.com', digest, false)
    const countAccount = pacingAccountFor('anthropic', 'https://api.anthropic.com', digest, true)
    expect(pacing.headroom(messageAccount).observed).toBe(false)
    // The captured answer carried a 10,000-request limit; it landed in
    // the count bucket only.
    const countBucket = pacing.headroom(countAccount)
    expect(countBucket.observed).toBe(true)
    expect(countBucket.requests).toBe(10_000)
  })
  it('sleeps the whole named wait per retry try; only our own fallback keeps a ceiling', () => {
    // The foreground retry loop sleeps what backoffMs returns: a header
    // naming trillions of milliseconds sleeps that whole wait per try, with
    // the retry notice naming when it ends and Stop ending it at once.
    const silent = {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
    const transport = new RequestTransport({
      fetch,
      baseUrl: 'https://example.invalid',
      now: () => Date.now(),
      random: () => Math.random(),
      log: silent,
    })
    // The jitter is real randomness: each named wait lands whole
    // beneath it, inside one jitter window.
    for (const named of [99_999_999_999_999, 1500]) {
      const wait = transport.backoffMs(0, named)
      expect(wait).toBeGreaterThanOrEqual(named)
      expect(wait).toBeLessThanOrEqual(named + MODEL_API_RETRY_JITTER_MS)
    }
    expect(transport.backoffMs(0, undefined)).toBeLessThanOrEqual(MODEL_API_RETRY_MAX_MS)
  })
})

describe('deepseekConcurrencyLimit', () => {
  it('carries the documented per-model ceilings and nothing else', () => {
    // api-docs.deepseek.com/quick_start/rate_limit, "Concurrency Limit",
    // read 2026-10-23: 2500 for deepseek-flash, 500 for deepseek-v4-pro.
    expect(deepseekConcurrencyLimit('deepseek-flash')).toBe(DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH)
    expect(DEEPSEEK_CONCURRENCY_DEEPSEEK_FLASH).toBe(2500)
    expect(deepseekConcurrencyLimit('deepseek-v4-pro')).toBe(DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO)
    expect(DEEPSEEK_CONCURRENCY_DEEPSEEK_V4_PRO).toBe(500)
    // Models the table does not name stay unpaced: only the live 429
    // pause applies to them.
    expect(deepseekConcurrencyLimit(undefined)).toBeUndefined()
    expect(deepseekConcurrencyLimit('deepseek-v4-flash')).toBeUndefined()
    expect(deepseekConcurrencyLimit('deepseek-chat')).toBeUndefined()
  })

  it('paces DeepSeek from the documented table because its answers carry no limit headers', () => {
    // The recorded DeepSeek answer has no rate-limit headers for any
    // header reader to interpret; the concurrency table above is the
    // only documented pacing input.
    for (const name of capturedHeaders.deepseek.keys()) {
      expect(name.startsWith('x-ratelimit')).toBe(false)
      expect(name.startsWith('anthropic-ratelimit')).toBe(false)
    }
    expect(openaiPacingLimits(capturedHeaders.deepseek)).toBeUndefined()
    expect(deepseekConcurrencyLimit('deepseek-flash')).toBe(2500)
  })
})

/** Fills the model's documented DeepSeek ceiling, returning every held lease. */
async function holdDeepseekCeiling(
  pacing: ModelApiPacing,
  notice: PacingWaitHandler,
  model: string,
): Promise<(() => void)[]> {
  const ceiling = deepseekConcurrencyLimit(model)
  if (ceiling === undefined) throw new Error('the filled ceiling must be documented')
  const leases: (() => void)[] = []
  for (let held = 0; held < ceiling; held += 1) {
    const lease = await pacing.acquire(
      'deepseek',
      'subagent',
      0,
      AbortSignal.timeout(5000),
      notice,
      { model, provider: 'deepseek' },
    )
    if (lease === undefined) throw new Error('a ceiling admission must hold a slot')
    leases.push(lease)
  }
  return leases
}

describe('DeepSeek concurrency admission', () => {
  const options = { model: 'deepseek-v4-pro', provider: 'deepseek' }

  it('holds a slot per admission and waits past the documented 500', async () => {
    const { pacing, notices, notice } = recordingPacer()
    const leases = await holdDeepseekCeiling(pacing, notice, options.model)
    expect(notices).toEqual([])
    let hasSettled = false
    const waiting = pacing.acquire(
      'deepseek',
      'subagent',
      0,
      AbortSignal.timeout(5000),
      notice,
      options,
    )
    const track = (async (): Promise<void> => {
      await waiting
      hasSettled = true
    })()
    // The 501st admission cannot proceed: the notice names DeepSeek's
    // account concurrency ceiling instead of generic headroom.
    expect(hasSettled).toBe(false)
    expect(notices).toEqual([{ delayMs: 0, limit: { kind: 'concurrency', limit: 500 } }])
    const first = leases.at(0)
    if (first === undefined) throw new Error('leases must be held')
    first()
    const freed = await waiting
    await track
    expect(hasSettled).toBe(true)
    expect(freed).not.toBeUndefined()
    freed?.()
    for (const lease of leases.slice(1)) lease()
  })

  it('lets the foreground hold a slot without waiting past the ceiling', async () => {
    const { pacing, notices, notice } = recordingPacer()
    const leases = await holdDeepseekCeiling(pacing, notice, options.model)
    // The user's turn never waits on siblings: it holds its slot past
    // the ceiling and its own retry loop answers the provider's 429.
    const foreground = await pacing.acquire(
      'deepseek',
      'foreground',
      0,
      AbortSignal.timeout(5000),
      notice,
      options,
    )
    expect(notices).toEqual([])
    expect(foreground).not.toBeUndefined()
    foreground?.()
    for (const lease of leases) lease()
  })

  it('counts each documented model against its own ceiling', async () => {
    const { pacing, notices, notice } = recordingPacer()
    const leases = await holdDeepseekCeiling(pacing, notice, options.model)
    // deepseek-v4-pro is full, but deepseek-flash has its own 2500 and
    // admits at once on the same account.
    const flash = await pacing.acquire(
      'deepseek',
      'subagent',
      0,
      AbortSignal.timeout(5000),
      notice,
      { model: 'deepseek-flash', provider: 'deepseek' },
    )
    expect(notices).toEqual([])
    expect(flash).not.toBeUndefined()
    flash?.()
    for (const lease of leases) lease()
  })

  it('holds no slot where no documented ceiling applies', async () => {
    const { pacing, notices, notice } = recordingPacer()
    // An undocumented DeepSeek model ...
    expect(
      await pacing.acquire('deepseek', 'subagent', 0, AbortSignal.timeout(5000), notice, {
        model: 'deepseek-v4-flash',
        provider: 'deepseek',
      }),
    ).toBeUndefined()
    // ... and any other provider stay lease-free: only the live 429
    // pause paces them.
    expect(
      await pacing.acquire('other', 'subagent', 0, AbortSignal.timeout(5000), notice, {
        model: 'gpt-4.1',
        provider: 'openai',
      }),
    ).toBeUndefined()
    expect(notices).toEqual([])
  })

  it('ends a concurrency wait at Stop and leaves the bucket clean', async () => {
    const { pacing, notice } = recordingPacer()
    const leases = await holdDeepseekCeiling(pacing, notice, options.model)
    const stop = new AbortController()
    const waiting = pacing.acquire('deepseek', 'subagent', 0, stop.signal, notice, options)
    stop.abort()
    await expect(waiting).rejects.toThrow()
    // The stopped waiter left no registration behind: freeing the
    // ceiling admits again at once.
    for (const lease of leases) lease()
    const lease = await pacing.acquire(
      'deepseek',
      'subagent',
      0,
      AbortSignal.timeout(5000),
      notice,
      options,
    )
    expect(lease).not.toBeUndefined()
    lease?.()
  })
})

describe('azureBurstShare', () => {
  it('shares the quota doc’s 600-RPM example across both sub-windows', () => {
    // learn.microsoft.com/azure/foundry/openai/how-to/quota, read
    // 2026-10-23: 600 RPM over 1-second windows allows 10 per window.
    expect(azureBurstShare(600, 60_000, 1000)).toBe(10)
    expect(azureBurstShare(600, 60_000, 10_000)).toBe(100)
    expect(AZURE_BURST_WINDOW_SHORT_MS).toBe(1000)
    expect(AZURE_BURST_WINDOW_LONG_MS).toBe(10_000)
  })

  it('floors fractional shares and never strands a lone request', () => {
    // Past the expected share answers 429, so shares floor; a lone
    // request is never a burst, so a share is never zero.
    expect(azureBurstShare(100, 60_000, 1000)).toBe(1)
    expect(azureBurstShare(30, 60_000, 1000)).toBe(1)
    expect(azureBurstShare(30, 60_000, 10_000)).toBe(5)
  })
})

/** Admits Azure background work, counting every admission toward the burst windows. */
async function admitAzure(
  pacing: ModelApiPacing,
  notice: PacingWaitHandler | undefined,
  count: number,
  kind: PacingClass = 'subagent',
): Promise<void> {
  for (let sent = 0; sent < count; sent += 1) {
    await pacing.acquire('azure', kind, 0, AbortSignal.timeout(5000), notice, {
      model: 'any-deployment',
      provider: 'azure',
    })
  }
}

/** Admits one more Azure request, expecting the named burst wait. */
async function expectAzureBurstWait(
  rig: ReturnType<typeof recordingPacer>,
  waitMs: number,
  windowMs: number,
): Promise<void> {
  await admitAzure(rig.pacing, rig.notice, 1)
  expect(rig.waits).toEqual([waitMs])
  expect(rig.notices).toEqual([{ delayMs: waitMs, limit: { kind: 'burst', windowMs } }])
}

describe('Azure burst admission', () => {
  const rpm600 = {
    requests: 600,
    remainingRequests: 600,
    tokens: 1_000_000,
    remainingTokens: 1_000_000,
    requestWindowMs: 60_000,
    tokenWindowMs: 60_000,
  }

  it('spreads a burst across the 1-second share of an observed 600-RPM deployment', async () => {
    const rig = recordingPacer()
    rig.pacing.observe('azure', rpm600)
    await admitAzure(rig.pacing, rig.notice, 10)
    expect(rig.waits).toEqual([])
    // The 11th request inside the same second waits out the sub-window,
    // naming Azure's small-window evaluation instead of generic headroom.
    await expectAzureBurstWait(rig, 1000, 1000)
  })

  it('binds the 10-second sub-window past a foreground burst', async () => {
    const rig = recordingPacer()
    rig.pacing.observe('azure', rpm600)
    // A hundred foreground admissions at once: the foreground never
    // waits, but every one counts toward Azure's evaluation windows.
    await admitAzure(rig.pacing, rig.notice, 100, 'foreground')
    expect(rig.waits).toEqual([])
    // The trailing ten seconds hold the full hundred-share, so the next
    // background admission waits for the window to age out — the longer
    // wait binds over the 1-second one — and names the 10-second window.
    await expectAzureBurstWait(rig, 10_000, 10_000)
  })

  it('counts foreground admissions while the foreground never waits', async () => {
    const rig = recordingPacer()
    rig.pacing.observe('azure', rpm600)
    await admitAzure(rig.pacing, rig.notice, 10, 'foreground')
    expect(rig.waits).toEqual([])
    // Azure evaluates requests received, whoever sent them: the ten
    // foreground admissions fill the 1-second share for background work.
    await expectAzureBurstWait(rig, 1000, 1000)
  })

  it('leaves unobserved Azure buckets unshaped: no per-minute limit, no shares', async () => {
    const { pacing, waits, notices, notice } = recordingPacer()
    await admitAzure(pacing, notice, 20)
    expect(waits).toEqual([])
    expect(notices).toEqual([])
  })

  it('still admits a lone request per window on a small deployment', async () => {
    const { pacing, waits } = recordingPacer()
    pacing.observe('azure', { ...rpm600, requests: 30, remainingRequests: 30 })
    // A 30-RPM deployment shares one request per second: three rapid
    // admissions serialize instead of deadlocking.
    await admitAzure(pacing, undefined, 3)
    expect(waits).toEqual([1000, 1000])
  })
})

describe('pacingWaitReason', () => {
  it('names the binding provider-documented limit in words', () => {
    expect(pacingWaitReason({ kind: 'concurrency', limit: 500 })).toBe(
      fill(UI_TEXT.modelApiPacingConcurrencyWaiting, { limit: formatNumber(500) }),
    )
    expect(pacingWaitReason({ kind: 'burst', windowMs: 1000 })).toBe(
      UI_TEXT.modelApiPacingBurstWaiting,
    )
  })

  it('ships sentences that name the provider and its limit', () => {
    expect(EN.modelApiPacingConcurrencyWaiting).toContain('DeepSeek')
    expect(EN.modelApiPacingConcurrencyWaiting).toContain('concurrency')
    expect(EN.modelApiPacingBurstWaiting).toContain('Azure')
    expect(EN.modelApiPacingBurstWaiting).toContain('evenly')
  })
})

function byteStreamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const bytes = chunks.map((chunk) => new TextEncoder().encode(chunk))
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of bytes) controller.enqueue(part)
      controller.close()
    },
  })
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const parts: number[][] = []
  for (;;) {
    const next = await reader.read()
    if (next.done) return Buffer.from(parts.flat()).toString('utf8')
    parts.push([...next.value])
  }
}

describe('releaseSlotOnSettled', () => {
  it('passes the bytes through and frees the slot when the body completes', async () => {
    // Our bytes through our wrapper: nothing here plays a provider.
    let released = 0
    const wrapped = releaseSlotOnSettled(byteStreamOf(['ab', 'cd']), () => {
      released += 1
    })
    expect(await readStreamText(wrapped)).toBe('abcd')
    expect(released).toBe(1)
  })

  it('frees the slot exactly once when the consumer goes away', async () => {
    let released = 0
    const wrapped = releaseSlotOnSettled(byteStreamOf(['ab', 'cd']), () => {
      released += 1
    })
    const reader = wrapped.getReader()
    await reader.cancel('stop')
    await reader.cancel('stop')
    expect(released).toBe(1)
  })

  it('frees the slot with the source’s own error, never a replacement', async () => {
    let released = 0
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('source failed'))
      },
    })
    const wrapped = releaseSlotOnSettled(failing, () => {
      released += 1
    })
    await expect(readStreamText(wrapped)).rejects.toThrow('source failed')
    expect(released).toBe(1)
  })
})
