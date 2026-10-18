// Lane RETRYLIMITS: each provider retries by its documented maximum, and
// the person's `museSpark.modelApiMaxRetries` setting decides the rest.
// Pure data and pure functions only: the documented tables in
// `src/shared/retryPolicy.ts`, the per-preset quirks, the merge, the
// backoff math and the settings read. No server, no fake, no mock.
import { describe, expect, it } from 'vitest'
import { presetById, quirksOf } from '../../src/core/providers/presets'
import { readSettings } from '../../src/host/settings'
import { noRetryBudget, UNBOUNDED_RETRIES } from '../../src/core/backends/modelapi/transport'
import {
  effectiveMaxRetries,
  META_DOCUMENTED_RETRY_LIMITS,
  PROVIDER_RETRY_LIMITS,
  retryDelayMs,
} from '../../src/shared/retryPolicy'

const limitsOf = (preset: string) => quirksOf(presetById(preset)!).retryLimits

describe('each provider retries by its documented maximum', () => {
  it('pins the documented counts (anthropic.md AB13, gemini SDK, azure-openai.md, xai.md, dev.meta.ai)', () => {
    expect(limitsOf('anthropic').maxRetries).toBe(2)
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
      'openai',
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
  it('wins over the documented maximum, and 0 never retries', () => {
    expect(effectiveMaxRetries(1, { maxRetries: 4 })).toBe(1)
    expect(effectiveMaxRetries(0, { maxRetries: 4 })).toBe(0)
    expect(effectiveMaxRetries(0, {})).toBe(0)
  })
  it('falls back to the documented maximum, then to unbounded', () => {
    expect(effectiveMaxRetries(undefined, { maxRetries: 2 })).toBe(2)
    expect(effectiveMaxRetries(undefined, {})).toBeUndefined()
    expect(effectiveMaxRetries(undefined, undefined)).toBeUndefined()
  })
  it('reads unset, set and invalid values through the settings registry', () => {
    const read = (value: unknown) =>
      readSettings(
        { get: (section: string) => (section === 'modelApiMaxRetries' ? value : undefined) },
        {
          trace: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      ).modelApiMaxRetries
    expect(read(undefined)).toBeNull()
    expect(read(null)).toBeNull()
    expect(read(3)).toBe(3)
    expect(read(0)).toBe(0)
    expect(read(-1)).toBeNull()
    expect(read(2.5)).toBeNull()
    expect(read('many')).toBeNull()
  })
})

describe('waits follow the provider', () => {
  it('waits out a named wait whole, jitter on top', () => {
    expect(retryDelayMs(0, { maxRetries: 4 }, 5000, 0.5, 1000)).toBe(5500)
  })
  it('doubles from the documented base up to the documented maximum', () => {
    const gemini = { maxRetries: 4, baseMs: 1000, maxMs: 60_000 }
    expect(retryDelayMs(0, gemini, undefined, 0, 1000)).toBe(1000)
    expect(retryDelayMs(3, gemini, undefined, 0, 1000)).toBe(8000)
    expect(retryDelayMs(10, gemini, undefined, 0, 1000)).toBe(60_000)
  })
  it('grows uncapped where the provider documents no maximum wait', () => {
    expect(retryDelayMs(10, { maxRetries: 4, baseMs: 1000 }, undefined, 0, 1000)).toBe(1_024_000)
    expect(retryDelayMs(2, {}, undefined, 0, 1000)).toBe(4000)
  })
})

describe('single-attempt paths refuse every retry', () => {
  it('starts past every effective cap, documented or set', () => {
    const budget = noRetryBudget()
    for (const cap of [0, 1, 2, 4, 10, undefined]) {
      expect(budget.retriesUsed >= (cap ?? UNBOUNDED_RETRIES)).toBe(true)
    }
  })
})
