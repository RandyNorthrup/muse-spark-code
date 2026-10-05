// Lane P: model references, capabilities and price cards (M95, D74).
// Built from parts so no scanner ever sees a whole test key.

import capturedOpenai from '../../docs/certification/m95-captures/openai/02-tool-call-stream.json'
import { describe, expect, it } from 'vitest'
import {
  capabilitiesOf,
  CONSERVATIVE_CAPABILITIES,
  isAgentCapable,
  hasSameToolShape,
} from '../../src/core/providers/capabilities'
import {
  formatModelRef,
  isByoModelRef,
  isProviderId,
  parseModelRef,
  sanitizeModelLabel,
} from '../../src/core/providers/modelRef'
import {
  isValidPriceCard,
  isValidUsage,
  parseDecimalPrice,
  reserveRequestUsd,
  reserveWorstCaseUsd,
  resolvePriceCard,
  settleUsageUsd,
  ticksToUsdPerToken,
  type ModelPricing,
  type PriceCard,
} from '../../src/core/providers/priceCard'

const card: PriceCard = {
  input: 2e-6,
  cachedInput: 2e-7,
  cacheWrite: 2.5e-6,
  output: 8e-6,
  source: 'list',
  fetchedAt: '2026-10-04T00:00:00.000Z',
}
const tiered: PriceCard = {
  ...card,
  source: 'catalogue',
  longContextTier: { fromTokens: 200_000, input: 4e-6, output: 16e-6 },
}

describe('parseModelRef', () => {
  it('keeps Meta models bare', () => {
    expect(parseModelRef('muse-spark-1.3')).toEqual({
      providerId: 'meta',
      modelId: 'muse-spark-1.3',
    })
  })

  it('splits at the first slash, keeping OpenRouter author/slug', () => {
    expect(parseModelRef('openrouter/deepseek/deepseek-v4-pro')).toEqual({
      providerId: 'openrouter',
      modelId: 'deepseek/deepseek-v4-pro',
    })
    expect(parseModelRef('anthropic/claude-sonnet-5-5')).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-5-5',
    })
    expect(parseModelRef('ollama/qwen3:8b')).toEqual({ providerId: 'ollama', modelId: 'qwen3:8b' })
  })

  it('refuses reserved, malformed and empty parts', () => {
    expect(parseModelRef('meta/some-model')).toBeUndefined()
    expect(parseModelRef('OpenAI/gpt')).toBeUndefined()
    expect(parseModelRef('a'.repeat(33) + '/model')).toBeUndefined()
    expect(parseModelRef('openai/')).toBeUndefined()
    expect(parseModelRef('/model')).toBeUndefined()
    expect(parseModelRef('')).toBeUndefined()
    expect(parseModelRef('openai/has space')).toBeUndefined()
  })

  it('formats and classifies references', () => {
    expect(formatModelRef('meta', 'muse-spark-1.3')).toBe('muse-spark-1.3')
    expect(formatModelRef('openai', 'gpt-5.6-luna')).toBe('openai/gpt-5.6-luna')
    expect(isByoModelRef('openai/gpt-5.6-luna')).toBe(true)
    expect(isByoModelRef('muse-spark-1.3')).toBe(false)
    expect(isProviderId('meta')).toBe(false)
    expect(isProviderId('openrouter')).toBe(true)
    expect(isProviderId('')).toBe(false)
  })

  it('strips control and format characters and caps label length', () => {
    expect(sanitizeModelLabel('gpt-oss-20b')).toBe('gpt-oss-20b')
    expect(sanitizeModelLabel('a\u{0}b\u{200B}c\u{202E}d')).toBe('abcd')
    expect(sanitizeModelLabel('x'.repeat(200)).length).toBe(120)
  })
})

describe('capabilities', () => {
  it('fills gaps from Zed conservative defaults', () => {
    expect(capabilitiesOf({})).toEqual(CONSERVATIVE_CAPABILITIES)
    expect(capabilitiesOf({ capabilities: { vision: true } }).vision).toBe(true)
    expect(capabilitiesOf({ capabilities: { vision: true } }).parallelToolCalls).toBe(false)
  })

  it('gates agent mode on tool calling', () => {
    expect(isAgentCapable({ ...CONSERVATIVE_CAPABILITIES, toolCalling: true })).toBe(true)
    expect(isAgentCapable({ ...CONSERVATIVE_CAPABILITIES, toolCalling: false })).toBe(false)
    expect(hasSameToolShape(CONSERVATIVE_CAPABILITIES, { ...CONSERVATIVE_CAPABILITIES })).toBe(true)
    expect(
      hasSameToolShape(CONSERVATIVE_CAPABILITIES, {
        ...CONSERVATIVE_CAPABILITIES,
        parallelToolCalls: true,
      }),
    ).toBe(false)
  })
})

describe('priceCard', () => {
  it('parses OpenRouter decimal strings and xAI ticks', () => {
    expect(parseDecimalPrice('0.000002')).toBe(0.000002)
    expect(parseDecimalPrice('')).toBeUndefined()
    expect(parseDecimalPrice('abc')).toBeUndefined()
    expect(parseDecimalPrice('-1')).toBeUndefined()
    expect(ticksToUsdPerToken(23_184_000)).toBeCloseTo(0.0023184, 10)
    expect(ticksToUsdPerToken(-1)).toBeUndefined()
  })

  it('resolves sources in D74 order: list, catalogue, user', () => {
    const user = { ...card, source: 'user' as const }
    const catalogue = { ...card, source: 'catalogue' as const }
    const list = { ...card, source: 'list' as const }
    expect(resolvePriceCard([user, catalogue, list])).toBe(list)
    expect(resolvePriceCard([user, catalogue])).toBe(catalogue)
    expect(resolvePriceCard([{ ...card, source: 'list', input: NaN }, user])).toBe(user)
    expect(resolvePriceCard([])).toBeUndefined()
  })

  it('reserves the worst case, with the long-context tier', () => {
    const small = reserveRequestUsd(tiered, { inputTokens: 1000, outputTokens: 100 })
    expect(small).toBeCloseTo(1000 * 2e-6 + 100 * 8e-6, 12)
    const large = reserveRequestUsd(tiered, { inputTokens: 200_000, outputTokens: 100 })
    expect(large).toBeCloseTo(200_000 * 4e-6 + 100 * 16e-6, 12)
    // Cached input never reserves above the full input price.
    const cached = reserveRequestUsd(
      { ...card, cachedInput: 9e-6 },
      { inputTokens: 1000, cachedTokens: 1000, outputTokens: 0 },
    )
    expect(cached).toBeCloseTo(1000 * 2e-6, 12)
  })

  it('reserves all input at full price despite estimated cache hits', () => {
    const usage = { inputTokens: 100_000, cachedTokens: 100_000, outputTokens: 0 }
    expect(reserveRequestUsd(card, usage)).toBeCloseTo(0.2, 12)
    expect(
      reserveRequestUsd(tiered, { ...usage, inputTokens: 200_000, cachedTokens: 200_000 }),
    ).toBeCloseTo(0.8, 12)
    expect(settleUsageUsd(card, usage)).toBeCloseTo(0.02, 12)
  })

  it('settles captured OpenAI cache writes as disjoint input categories', () => {
    const usage = capturedOpenai.response.events.find(
      (event) => event.event === 'response.completed',
    )?.data.response?.usage
    if (usage == null) {
      throw new Error('Missing captured OpenAI usage')
    }
    expect(usage).toMatchObject({
      input_tokens: 1447,
      input_tokens_details: { cache_write_tokens: 1444 },
      output_tokens: 18,
    })
    const captured = {
      inputTokens: usage.input_tokens,
      cacheWriteTokens: usage.input_tokens_details.cache_write_tokens,
      outputTokens: usage.output_tokens,
    }
    const capturedCard: PriceCard = {
      input: 0.2e-6,
      cacheWrite: 0.25e-6,
      output: 1.2e-6,
      source: 'list',
    }
    expect(settleUsageUsd(capturedCard, captured)).toBeCloseTo(0.0003832, 12)
    expect(
      settleUsageUsd(card, {
        inputTokens: 100,
        cachedTokens: 20,
        cacheWriteTokens: 30,
        outputTokens: 0,
      }),
    ).toBeCloseTo(50 * card.input + 20 * (card.cachedInput ?? 0) + 30 * (card.cacheWrite ?? 0), 12)
    expect(
      settleUsageUsd(card, {
        inputTokens: 100,
        cachedTokens: 90,
        cacheWriteTokens: 20,
        outputTokens: 0,
      }),
    ).toBeUndefined()
  })

  it('reserves across upstreams at the highest', () => {
    const cheap = { ...card, source: 'list' as const, upstream: 'cheap' }
    const dear = { ...card, source: 'list' as const, input: 4e-6, output: 16e-6, upstream: 'dear' }
    const usage = { inputTokens: 1000, outputTokens: 100 }
    expect(reserveWorstCaseUsd([cheap, dear], usage)).toBeCloseTo(
      reserveRequestUsd(dear, usage),
      12,
    )
    expect(reserveWorstCaseUsd([], usage)).toBeUndefined()
  })

  it('settles from the reported cost, else the card, else unknown', () => {
    const usage = { inputTokens: 1000, outputTokens: 100 }
    expect(settleUsageUsd(card, usage, { cost: 0.0055 })).toBe(0.0055)
    expect(settleUsageUsd(card, usage, { costInUsdTicks: 23_184_000 })).toBeCloseTo(0.0023184, 10)
    expect(settleUsageUsd(card, usage)).toBeCloseTo(reserveRequestUsd(card, usage), 12)
    // Invalid usage leaves the cost unknown instead of guessing zero.
    expect(
      settleUsageUsd(card, { inputTokens: 100, cachedTokens: 200, outputTokens: 0 }),
    ).toBeUndefined()
    expect(settleUsageUsd(card, { inputTokens: NaN, outputTokens: 0 })).toBeUndefined()
  })

  it('names the four pricing kinds', () => {
    const pricings: ModelPricing[] = [
      { kind: 'priced', card },
      { kind: 'unpriced' },
      { kind: 'local' },
      { kind: 'plan' },
    ]
    expect(pricings.map((pricing) => pricing.kind)).toEqual(['priced', 'unpriced', 'local', 'plan'])
  })

  it('rejects bad cards and bad usage', () => {
    expect(isValidPriceCard({ ...card, input: -1 })).toBe(false)
    expect(
      isValidPriceCard({ ...card, longContextTier: { fromTokens: 0, input: 1, output: 1 } }),
    ).toBe(false)
    expect(isValidUsage({ inputTokens: 1, outputTokens: -1 })).toBe(false)
    expect(isValidUsage({ inputTokens: 1, cachedTokens: 2, outputTokens: 0 })).toBe(false)
    expect(isValidUsage({ inputTokens: 2, cachedTokens: 2, outputTokens: 0 })).toBe(true)
  })
})
