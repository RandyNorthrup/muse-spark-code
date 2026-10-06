import { describe, expect, it } from 'vitest'
import {
  effortForPolicy,
  modelPolicyFor,
  modelPricedUsage,
  outputLimitFor,
} from '../../src/core/backends/modelapi/modelPolicy'
import type { ModelPricing } from '../../src/core/providers/priceCard'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { reserveRequest } from '../../src/core/backends/modelapi/sessionBudget'
import { autoReviewPrice } from '../../src/shared/paid'
import { MODEL_API_MAX_OUTPUT_TOKENS } from '../../src/shared/constants'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'

const ref = 'team/author/model'
const card = {
  input: 0.001,
  cachedInput: 0.0001,
  cacheWrite: 0.002,
  output: 0.003,
  source: 'user' as const,
}

function registry(pricing: ModelPricing) {
  return createProviderRegistry({
    models: () =>
      Promise.resolve([
        {
          ref,
          origin: 'https://example.test',
          pricing,
          evidence: { capabilities: { toolCalling: true }, maxOutputTokens: 100 },
        },
      ]),
    createClient: () =>
      Promise.resolve(fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())),
    isCurrent: () => true,
  })
}

describe('resolved model policy', () => {
  it('keeps missing BYO evidence unknown and does not inherit Meta limits, tools or effort', () => {
    const policy = modelPolicyFor(ref)
    expect(policy.tools.calling.state).toBe('unknown')
    expect(policy.hosted.webSearch.state).toBe('unknown')
    expect(modelPolicyFor(ref, { webSearch: true }).hosted.webSearch.state).toBe('unknown')
    expect(policy.output.maxTokens).toBeUndefined()
    expect(policy.pricing.kind).toBe('unpriced')
    expect(effortForPolicy(policy, 'high')).toBe('none')
  })

  it('uses the selected model output ceiling and native effort tiers', () => {
    const policy = modelPolicyFor(ref, { maxOutputTokens: 100, effortLevels: ['low', 'high'] })
    expect(outputLimitFor(policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(100)
    expect(effortForPolicy(policy, 'high')).toBe('high')
    expect(effortForPolicy(policy, 'xhigh')).toBe('none')
    expect(modelPolicyFor(ref, { capabilities: { toolCalling: false } }).tools.calling.state).toBe(
      'no',
    )
  })

  it('retains the exact Meta output cap and effort mapping', () => {
    const policy = modelPolicyFor('muse-spark-1.3')
    expect(outputLimitFor(policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
    expect(effortForPolicy(policy, 'none')).toBe('minimal')
    expect(effortForPolicy(policy, 'max')).toBe('max')
    expect(policy.hosted.webSearch.state).toBe('yes')
  })

  it('reserves cold cache writes at public price-card rates and settles the reported cost', async () => {
    const model = await registry({ kind: 'priced', card }).resolve(ref)
    expect(model.price.reserve({ inputTokens: 100, outputTokens: 1 })).toBeCloseTo(0.203)
    expect(model.price.settle({ inputTokens: 100, outputTokens: 1 }, { cost: 0.7 })).toBe(0.7)
    const reserved = reserveRequest({
      capUsd: 0.213,
      spentUsd: 0,
      estimatedInputTokens: 100,
      modelId: ref,
      maxOutputTokens: 100,
      price: model.price,
    })
    expect(reserved.maxOutputTokens).toBe(4)
    expect(reserved.costUsd).toBeLessThanOrEqual(0.213)
  })

  it('keeps local free, unpriced unknown and plan paid by the plan', async () => {
    for (const kind of ['local', 'unpriced', 'plan'] as const) {
      const model = await registry({ kind }).resolve(ref)
      const cost = model.price.settle({ inputTokens: 100, outputTokens: 1 })
      expect(cost).toBe(kind === 'unpriced' ? undefined : 0)
      expect(model.price.reserve({ inputTokens: 100, outputTokens: 1 })).toBe(
        kind === 'unpriced' ? undefined : 0,
      )
      if (kind === 'unpriced') {
        expect(() =>
          reserveRequest({
            capUsd: 1,
            spentUsd: 0,
            estimatedInputTokens: 100,
            modelId: ref,
            price: model.price,
          }),
        ).toThrow('whose price this extension does not know')
      } else {
        expect(
          reserveRequest({
            capUsd: 1,
            spentUsd: 0,
            estimatedInputTokens: 100,
            modelId: ref,
            maxOutputTokens: 100,
            price: model.price,
          }).maxOutputTokens,
        ).toBe(100)
      }
    }
  })

  it('carries disjoint writes and the one-hour subset to the public settlement seam', () => {
    expect(
      modelPricedUsage({
        input_tokens: 100,
        output_tokens: 1,
        input_tokens_details: {
          cached_tokens: 10,
          cache_write_tokens: 20,
          cache_write_tokens_1h: 15,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 1,
      cachedTokens: 10,
      cacheWriteTokens: 20,
      cacheWriteTokens1h: 15,
    })
  })

  it('quotes cache writes, per-request/image fees and long-context rates in review consent', () => {
    const text = autoReviewPrice(ref, {
      kind: 'priced',
      card: {
        ...card,
        cacheWrite1h: 0.004,
        request: 0.5,
        image: 0.6,
        longContextTier: { fromTokens: 100, input: 0.005, output: 0.006 },
      },
    })
    expect(text).toContain('cache write $2,000.000')
    expect(text).toContain('one-hour write $4,000.000')
    expect(text).toContain('Per request $0.500; per image $0.600')
    expect(text).toContain('From 100 input tokens: input $5,000.000, output $6,000.000')
    expect(autoReviewPrice(ref, { kind: 'unpriced' })).toBeUndefined()
  })

  it('reserves and settles image fees once, with authoritative provider cost taking precedence', async () => {
    const priced = await registry({
      kind: 'priced',
      card: { ...card, request: 0.5, image: 0.6 },
    }).resolve(ref)
    const usage = { inputTokens: 100, outputTokens: 3, images: 2 }
    expect(priced.price.reserve(usage)).toBeCloseTo(1.909)
    expect(priced.price.settle(usage)).toBeCloseTo(1.809)
    expect(priced.price.settle(usage, { cost: 0.25 })).toBe(0.25)
    expect(() =>
      reserveRequest({
        capUsd: 1,
        spentUsd: 0,
        estimatedInputTokens: 100,
        modelId: ref,
        price: priced.price,
        images: 2,
      }),
    ).toThrow()
  })

  it('keeps positive provider fees visible below the usual currency precision', () => {
    const text = autoReviewPrice(ref, {
      kind: 'priced',
      card: { ...card, request: 0.00005, image: 1e-30 },
    })
    expect(text).toContain('Per request $0.00005; per image $1.000E-30')
  })

  it('retains uncertain one-hour-write liability while the public price module lacks P2 settlement', async () => {
    const priced = await registry({
      kind: 'priced',
      card: { ...card, cacheWrite1h: 0.004 },
    }).resolve(ref)
    expect(
      priced.price.settle({
        inputTokens: 20,
        outputTokens: 0,
        cacheWriteTokens: 20,
        cacheWriteTokens1h: 10,
      }),
    ).toBeUndefined()
    expect(
      priced.price.settle(
        { inputTokens: 20, outputTokens: 0, cacheWriteTokens: 20, cacheWriteTokens1h: 10 },
        { cost: 0.06 },
      ),
    ).toBe(0.06)
  })
})
