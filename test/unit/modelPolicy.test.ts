import { Usd } from '../../src/shared/usd'
import { describe, expect, it } from 'vitest'
import {
  effortForPolicy,
  hasUsableEffortLevels,
  minOutputTokensForPolicy,
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
    // Round 2: an unlisted level resolves to the provider default, never
    // to off (GAPANTH-G10).
    expect(effortForPolicy(policy, 'high')).toBe('default')
  })

  it('uses the selected model output ceiling and native effort tiers', () => {
    const policy = modelPolicyFor(ref, { maxOutputTokens: 100, effortLevels: ['low', 'high'] })
    expect(outputLimitFor(policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(100)
    expect(effortForPolicy(policy, 'high')).toBe('high')
    // Round 2: `xhigh` is unlisted here, so the provider default answers
    // (GAPANTH-G10), not off and not a neighbour.
    expect(effortForPolicy(policy, 'xhigh')).toBe('default')
    expect(modelPolicyFor(ref, { capabilities: { toolCalling: false } }).tools.calling.state).toBe(
      'no',
    )
  })

  it('resolves a declared Thinking-off switch from the record, never by name', () => {
    // Lane DSTHINK3: only the preset's declared switch changes the mapping.
    const deepseek = modelPolicyFor('deepseek/deepseek-flash', {
      effortLevels: ['low', 'high', 'max'],
      canDisableReasoning: true,
      thinkingOff: 'thinking-switch',
    })
    expect(effortForPolicy(deepseek, 'high')).toBe('high')
    expect(effortForPolicy(deepseek, 'medium')).toBe('high')
    expect(effortForPolicy(deepseek, 'minimal')).toBe('low')
    expect(effortForPolicy(deepseek, 'none')).toBe('none')
    // Refused and default settings ride unchanged to the codec's resolver.
    expect(
      effortForPolicy(
        { ...deepseek, reasoning: { ...deepseek.reasoning, canDisable: { state: 'no' } } },
        'none',
      ),
    ).toBe('none')
    expect(
      effortForPolicy(
        modelPolicyFor('deepseek/deepseek-flash', {
          effortLevels: [],
          thinkingOff: 'thinking-switch',
        }),
        'high',
      ),
    ).toBe('high')
    // Same name, no declared switch: the base mapping.
    const named = modelPolicyFor('deepseek/deepseek-flash', {
      effortLevels: ['low', 'high', 'max'],
    })
    // Round 2: unlisted `medium` resolves to the provider default
    // (GAPANTH-G10), never to off.
    expect(effortForPolicy(named, 'medium')).toBe('default')
    expect(named.reasoning).not.toHaveProperty('thinkingOff')
    const openai = modelPolicyFor('openai/gpt-5-nano', {
      effortLevels: ['minimal', 'low', 'medium', 'high'],
    })
    expect(effortForPolicy(openai, 'minimal')).toBe('minimal')
    expect(
      modelPolicyFor('muse-spark-1.3', { thinkingOff: 'thinking-switch' }).reasoning,
    ).not.toHaveProperty('thinkingOff')
  })

  it('refuses Thinking off the record does not affirm, and passes affirmed off through', () => {
    // Lane REASONSHAPESR2 (OPENAI-G02, XAI-G02): gpt-6-astra lists
    // low/medium/high/xhigh/max and no switch, so `none` refuses before
    // dispatch (the provider answers 400); a listed `none` rides.
    const astra = modelPolicyFor('openai/gpt-6-astra', {
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    })
    expect(effortForPolicy(astra, 'high')).toBe('high')
    expect(() => effortForPolicy(astra, 'none')).toThrow('unsupported_reasoning_effort')
    const grok = modelPolicyFor('xai/grok-4.5', {
      effortLevels: ['low', 'medium', 'high'],
    })
    expect(() => effortForPolicy(grok, 'none')).toThrow('unsupported_reasoning_effort')
    // Unlisted `xhigh` on grok-4.5 is the provider default until the
    // catalogue carries the documented fact (XAI-G01).
    expect(effortForPolicy(grok, 'xhigh')).toBe('default')
    const qwen = modelPolicyFor('groq/qwen', {
      effortLevels: ['none', 'low', 'medium', 'high'],
    })
    expect(effortForPolicy(qwen, 'none')).toBe('none')
    // A model with no usable levels takes the plain turn: off is already
    // satisfied, and no reasoning field is sent (the xAI-first defect).
    const build = modelPolicyFor('xai/grok-build-0.1', { effortLevels: [] })
    expect(hasUsableEffortLevels(build.reasoning.effortLevels)).toBe(false)
    expect(effortForPolicy(build, 'none')).toBe('none')
    expect(effortForPolicy(build, 'high')).toBe('default')
    expect(hasUsableEffortLevels(astra.reasoning.effortLevels)).toBe(true)
    // An affirmed off switch rides through even where `disabled` is
    // refused (Claude Sonnet 5.5's `between_tools`, GAPANTH-G02).
    const sonnet55 = modelPolicyFor('anthropic/claude-sonnet-5-5', {
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      canDisableReasoning: false,
      offSwitch: 'between_tools',
    })
    expect(effortForPolicy(sonnet55, 'none')).toBe('none')
  })

  it('posts the record levels and default for the picker slider (round 2)', async () => {
    // Lane REASONSHAPESR2 (OPENAI-G01, XAI-G01): a configured-provider
    // id contains `/`, so the static table serves nothing and only the
    // row's own levels light the slider; the list's default rides where
    // it names a served tier.
    const listed = createProviderRegistry({
      models: () =>
        Promise.resolve([
          {
            ref: 'xai/grok-4.3',
            origin: 'https://api.x.ai',
            pricing: { kind: 'unpriced' },
            evidence: {
              capabilities: { toolCalling: true },
              effortLevels: ['none', 'low', 'medium', 'high', 'xhigh'],
              defaultEffort: 'low',
            },
          },
          {
            ref: 'xai/grok-build-0.1',
            origin: 'https://api.x.ai',
            pricing: { kind: 'unpriced' },
            evidence: { capabilities: { toolCalling: true }, effortLevels: [] },
          },
        ]),
      createClient: () =>
        Promise.resolve(fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel())),
      isCurrent: () => true,
    })
    const listModels = listed.list
    if (listModels === undefined) throw new Error('expected the registry to list models')
    const rows = await listModels()
    // `none` is the Thinking toggle's value, not a slider tier.
    expect(rows.find((row) => row.modelId === 'xai/grok-4.3')).toMatchObject({
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'low',
    })
    const build = rows.find((row) => row.modelId === 'xai/grok-build-0.1')
    expect(build).not.toHaveProperty('effortLevels')
    expect(build).not.toHaveProperty('defaultEffort')
  })

  it('maps documented effort aliases and passes server-routed efforts through', () => {
    // Lane REASONSHAPES: the preset's table rides the policy to both codecs.
    const aliased = modelPolicyFor('deepseek/deepseek-flash', {
      effortLevels: ['low', 'high', 'max'],
      canDisableReasoning: true,
      thinkingOff: 'thinking-switch',
      effortAliases: { ultra: 'max', xhigh: 'high' },
    })
    expect(effortForPolicy(aliased, 'ultra')).toBe('max')
    expect(effortForPolicy(aliased, 'xhigh')).toBe('high')
    expect(effortForPolicy(aliased, 'none')).toBe('none')
    const routed = modelPolicyFor('llamacpp/server-model', { sendUndeclaredEffort: true })
    expect(effortForPolicy(routed, 'high')).toBe('high')
    expect(effortForPolicy(routed, 'none')).toBe('none')
  })

  it('floors Meta requests at the captured provider minimum and leaves others at one', () => {
    expect(minOutputTokensForPolicy(modelPolicyFor('muse-spark-1.3'))).toBe(16)
    expect(minOutputTokensForPolicy(modelPolicyFor(ref))).toBe(1)
    expect(minOutputTokensForPolicy(modelPolicyFor(ref, { minOutputTokens: 32 }))).toBe(32)
  })

  it('retains the exact Meta output cap and effort mapping', () => {
    const policy = modelPolicyFor('muse-spark-1.3')
    expect(outputLimitFor(policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(MODEL_API_MAX_OUTPUT_TOKENS)
    expect(effortForPolicy(policy, 'none')).toBe('minimal')
    expect(effortForPolicy(policy, 'max')).toBe('max')
    // Lane REASONSHAPES: the Model API has no `ultra`; it rides as `max`.
    expect(effortForPolicy(policy, 'ultra')).toBe('max')
    expect(policy.hosted.webSearch.state).toBe('yes')
  })

  it('reserves cold cache writes at public price-card rates and settles the reported cost', async () => {
    const model = await registry({ kind: 'priced', card }).resolve(ref)
    expect(Number(model.price.reserve({ inputTokens: 100, outputTokens: 1 }))).toBeCloseTo(0.203)
    expect(
      model.price.settle({ inputTokens: 100, outputTokens: 1 }, { cost: Usd.from(0.7).toAmount() }),
    ).toBe(Usd.from(0.7).toAmount())
    const reserved = reserveRequest({
      capUsd: Usd.from(0.213).toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 100,
      modelId: ref,
      maxOutputTokens: 100,
      price: model.price,
    })
    expect(reserved.maxOutputTokens).toBe(4)
    expect(Number(reserved.costUsd)).toBeLessThanOrEqual(0.213)
  })

  it('admits an exact decimal provider quote at the budget boundary', async () => {
    const model = await registry({
      kind: 'priced',
      card: { input: 0.1, output: 0.2, source: 'user' },
    }).resolve(ref)
    const reserved = reserveRequest({
      capUsd: Usd.from('0.3').toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 1,
      modelId: ref,
      maxOutputTokens: 1,
      price: model.price,
    })
    expect(reserved.maxOutputTokens).toBe(1)
    expect(reserved.costUsd).toBe(Usd.from('0.3').toAmount())
  })

  it('keeps local free, unpriced unknown and plan paid by the plan', async () => {
    for (const kind of ['local', 'unpriced', 'plan'] as const) {
      const model = await registry({ kind }).resolve(ref)
      const cost = model.price.settle({ inputTokens: 100, outputTokens: 1 })
      expect(cost).toBe(kind === 'unpriced' ? undefined : Usd.from(0).toAmount())
      expect(model.price.reserve({ inputTokens: 100, outputTokens: 1 })).toBe(
        kind === 'unpriced' ? undefined : Usd.from(0).toAmount(),
      )
      if (kind === 'unpriced') {
        expect(() =>
          reserveRequest({
            capUsd: Usd.from(1).toAmount(),
            spentUsd: Usd.from(0).toAmount(),
            estimatedInputTokens: 100,
            modelId: ref,
            price: model.price,
          }),
        ).toThrow('whose price this extension does not know')
      } else {
        expect(
          reserveRequest({
            capUsd: Usd.from(1).toAmount(),
            spentUsd: Usd.from(0).toAmount(),
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
    expect(Number(priced.price.reserve(usage))).toBeCloseTo(1.909)
    expect(Number(priced.price.settle(usage))).toBeCloseTo(1.809)
    expect(priced.price.settle(usage, { cost: Usd.from(0.25).toAmount() })).toBe(
      Usd.from(0.25).toAmount(),
    )
    expect(() =>
      reserveRequest({
        capUsd: Usd.from(1).toAmount(),
        spentUsd: Usd.from(0).toAmount(),
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
        { cost: Usd.from(0.06).toAmount() },
      ),
    ).toBe(Usd.from(0.06).toAmount())
  })
})

it('rejects a configured cap or provider ceiling below the selected minimum', () => {
  for (const cap of [1, 15])
    expect(() => outputLimitFor(modelPolicyFor('muse-spark-1.3'), cap)).toThrow(
      'Output cap must be at least 16 tokens.',
    )
  expect(() =>
    outputLimitFor(modelPolicyFor(ref, { minOutputTokens: 32, maxOutputTokens: 31 }), 100),
  ).toThrow('Output cap must be at least 32 tokens.')
  expect(outputLimitFor(modelPolicyFor('muse-spark-1.3'), 16)).toBe(16)
  expect(outputLimitFor(modelPolicyFor(ref), 1)).toBe(1)
  expect(() => outputLimitFor(modelPolicyFor(ref), 0)).toThrow(
    'Output cap must be at least 1 token.',
  )
})
