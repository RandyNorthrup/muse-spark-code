// Lane RETRYLIMITS: each provider retries by its documented maximum, and
// the person's `museSpark.modelApiMaxRetries` setting decides the rest.
// Real code and real data only (review of PR #225): the documented tables in
// `src/shared/retryPolicy.ts` and the per-preset quirks, the product's own
// `RequestTransport` with the platform's own random source and timer, and
// the agent's own logger. No server, no fake, no mock, and no provider wait
// is fed in: the repository holds no recorded real exchange with a
// `Retry-After` header, so the named-wait rule is proved by the packed
// product's real-life run. The VS Code settings read itself is not
// unit-tested here: its source is the editor's own configuration object,
// which a unit test may not stand in for (review RVRETRYLIMITS); the lead's
// real-life run sets `museSpark.modelApiMaxRetries` in the packed product.
import { setTimeout as timer } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { PLAN_KEY_PRESETS, PRESETS, presetById, quirksOf } from '../../src/core/providers/presets'
import {
  ModelApiError,
  noRetryBudget,
  RequestTransport,
  UNBOUNDED_RETRIES,
} from '../../src/core/backends/modelapi/transport'
import { stderrLogger } from '../../src/runtime/stderrLog'
import {
  MODEL_API_BASE_URL,
  MODEL_API_RETRY_JITTER_MS,
  MODEL_API_TIMER_MAX_MS,
} from '../../src/shared/constants'
import {
  effectiveMaxRetries,
  META_DOCUMENTED_RETRY_LIMITS,
  PROVIDER_RETRY_LIMITS,
  type RetryLimits,
} from '../../src/shared/retryPolicy'

const limitsOf = (preset: string) => quirksOf(presetById(preset)!).retryLimits

/** When the overflow test's Stop comes; any time well past 1 ms proves it. */
const STOP_AFTER_MS = 200

/** The product's transport over one provider's documented limits. */
const transportFor = (retryLimits: RetryLimits) =>
  new RequestTransport({
    fetch: globalThis.fetch,
    baseUrl: MODEL_API_BASE_URL,
    retryLimits,
    // The platform's own timer, unreferenced so a wait left pending by a
    // Stop never holds the test process open.
    sleep: async (ms) => {
      await timer(ms, undefined, { ref: false })
    },
    now: Date.now,
    random: Math.random,
    log: stderrLogger((line) => process.stderr.write(`${line}\n`), 'warn'),
  })

describe('each provider retries by its documented maximum', () => {
  it('pins the documented counts (anthropic.md AB13, openai SDK, gemini SDK, azure-openai.md, xai.md, dev.meta.ai)', () => {
    expect(limitsOf('anthropic').maxRetries).toBe(2)
    expect(limitsOf('openai').maxRetries).toBe(2)
    expect(limitsOf('gemini').maxRetries).toBe(4)
    expect(limitsOf('azure').maxRetries).toBe(10)
    expect(limitsOf('xai').maxRetries).toBe(4)
    expect(META_DOCUMENTED_RETRY_LIMITS.maxRetries).toBe(4)
  })
  it('pins the documented backoff bounds (gemini SDK 1 s to 60 s, xAI 1 s doubling uncapped)', () => {
    expect(limitsOf('gemini').baseMs).toBe(1000)
    expect(limitsOf('gemini').maxMs).toBe(60_000)
    expect(limitsOf('xai').baseMs).toBe(1000)
    expect(limitsOf('xai').maxMs).toBeUndefined()
    expect(limitsOf('anthropic').baseMs).toBeUndefined()
    expect(limitsOf('anthropic').maxMs).toBeUndefined()
  })
  it('leaves every undocumented provider without a limit of ours', () => {
    for (const preset of [
      'openrouter',
      'groq',
      'deepseek',
      'mistral',
      'together',
      'fireworks',
      'huggingface',
      'zai',
      'ollama',
      'lmstudio',
      'vllm',
      'llamacpp',
      'custom',
    ]) {
      expect(limitsOf(preset).maxRetries).toBeUndefined()
    }
    expect(PROVIDER_RETRY_LIMITS.responses.maxRetries).toBeUndefined()
    expect(PROVIDER_RETRY_LIMITS.chat.maxRetries).toBeUndefined()
  })
})

describe("the person's setting decides", () => {
  it('wins over the documented maximum (0 never retries), else the documented one, else none', () => {
    expect(effectiveMaxRetries(1, limitsOf('xai'))).toBe(1)
    expect(effectiveMaxRetries(0, limitsOf('azure'))).toBe(0)
    expect(effectiveMaxRetries(0, limitsOf('openrouter'))).toBe(0)
    expect(effectiveMaxRetries(undefined, limitsOf('anthropic'))).toBe(2)
    expect(effectiveMaxRetries(undefined, limitsOf('openrouter'))).toBeUndefined()
    expect(transportFor(limitsOf('gemini')).maxRetries()).toBe(4)
    expect(transportFor(limitsOf('groq')).maxRetries()).toBeUndefined()
  })
})

describe('waits follow the provider', () => {
  it('doubles from the documented base up to the documented maximum, jitter on top', () => {
    const gemini = transportFor(limitsOf('gemini'))
    for (const [attempt, base] of [
      [0, 1000],
      [3, 8000],
    ] as const) {
      const wait = gemini.backoffMs(attempt)
      expect(wait).toBeGreaterThanOrEqual(base)
      expect(wait).toBeLessThan(base + MODEL_API_RETRY_JITTER_MS)
    }
    expect(gemini.backoffMs(10)).toBe(60_000)
  })
  it('grows uncapped where the provider documents no maximum wait', () => {
    for (const [preset, attempt, base] of [
      ['xai', 10, 1_024_000],
      ['openrouter', 2, 4000],
    ] as const) {
      const wait = transportFor(limitsOf(preset)).backoffMs(attempt)
      expect(wait).toBeGreaterThanOrEqual(base)
      expect(wait).toBeLessThan(base + MODEL_API_RETRY_JITTER_MS)
    }
  })
  it('waits out a backoff longer than one timer holds instead of asking again at once', async () => {
    // An undocumented provider's 23rd try: the backoff has passed the
    // longest delay one timer holds, which the platform would cut to 1 ms.
    const transport = transportFor(limitsOf('openrouter'))
    const wait = transport.backoffMs(22)
    expect(wait).toBeGreaterThan(MODEL_API_TIMER_MAX_MS)
    // A Stop well past the 1 ms the platform would cut the wait to: the
    // wait must still be running when it comes, so the Stop ends it.
    const stop = AbortSignal.timeout(STOP_AFTER_MS)
    await expect(transport.pause(wait, stop)).rejects.toBeInstanceOf(ModelApiError)
    expect(stop.aborted).toBe(true)
  })
})

describe('single-attempt paths refuse every retry', () => {
  it("starts past every provider's documented cap and every count the person can set", () => {
    const budget = noRetryBudget()
    const caps = [
      ...[...PRESETS, ...PLAN_KEY_PRESETS].map((preset) => quirksOf(preset).retryLimits.maxRetries),
      META_DOCUMENTED_RETRY_LIMITS.maxRetries,
      // The largest count the setting's schema accepts (`z.int()`: safe
      // integers only; 2 ** 60 is refused, measured 2026-10-17).
      Number.MAX_SAFE_INTEGER,
    ]
    for (const cap of caps) {
      expect(budget.retriesUsed >= (cap ?? UNBOUNDED_RETRIES)).toBe(true)
    }
  })
})
