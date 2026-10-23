// USAGEFIELDS lane: every usage and price field a provider reports is read
// and shown. Pure logic through the real modules, with values passed in as
// data: no mocks, no servers, no provider calls.
import { describe, expect, it } from 'vitest'
import { Usd } from '../../src/shared/usd'
import {
  cataloguePriceCard,
  huggingFaceUpstreamCards,
  isValidPriceCard,
  isValidUsage,
  reserveRequestAmount,
  settleUsageAmount,
} from '../../src/core/providers/priceCard'
import { nativeCapabilityEvidence } from '../../src/core/providers/modelMetadata'
import { providerEntrySchema } from '../../src/core/providers/providersFile'
import {
  encodeChatRequest,
  type ChatPresetQuirks,
} from '../../src/core/backends/modelapi/codecs/chat'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { modelPricedUsage } from '../../src/core/backends/modelapi/modelPolicy'
import { parseOpenRouterKeyUsageBody } from '../../src/host/providers/openRouter'

const CHAT_BASE: ChatPresetQuirks = {
  presetId: 'fireworks',
  outputCap: 'max_tokens',
  reasoningParam: 'effort-flat',
  sendCacheKey: true,
  includeUsage: true,
  toolStream: false,
  toolResultName: false,
  replayField: 'content',
}

function chatBody(): CreateResponseBody {
  return {
    model: 'usagefields-model',
    instructions: 'answer briefly',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'carrier ping' }],
      },
    ],
    max_output_tokens: 64,
    reasoning: { effort: 'minimal', summary: 'auto' },
    prompt_cache_key: 'usagefields-key',
    prompt_cache_retention: '24h',
    tools: [],
    tool_choice: 'auto',
    stream: true,
    store: false,
    include: [],
  }
}

describe('DS-G03: catalogue cost.reasoning reaches the price card', () => {
  // vendor/models-dev/snapshot.json deepseek/deepseek-flash, read 2026-10-12.
  const flash = { input: 0.15, output: 0.6, cache_read: 0.003, reasoning: 0.6 }

  it('maps reasoning per-token alongside input/output/cache_read', () => {
    const card = cataloguePriceCard('deepseek', flash)
    expect(card).toMatchObject({
      input: 0.15 / 1_000_000,
      output: 0.6 / 1_000_000,
      cachedInput: 0.003 / 1_000_000,
      reasoning: 0.6 / 1_000_000,
      source: 'catalogue',
    })
    expect(card !== undefined && isValidPriceCard(card)).toBe(true)
  })

  it('settles reasoning tokens at the reasoning rate, the rest at output', () => {
    const card = cataloguePriceCard('deepseek', {
      input: 0.3,
      output: 1.2,
      reasoning: 2.4,
    })!
    const settled = settleUsageAmount(card, {
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 200,
    })
    // 1000 input @0.3 + 200 thought @2.4 + 300 rest @1.2, per million.
    expect(settled).toEqual(Usd.from('0.00114').toAmount())
  })

  it('keeps the old total where reasoning equals the output price', () => {
    const card = cataloguePriceCard('deepseek', flash)!
    const split = settleUsageAmount(card, {
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 200,
      cachedTokens: 100,
    })
    const unsplit = settleUsageAmount(card, {
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 100,
    })
    expect(split).toEqual(unsplit)
  })

  it('reserves output at the dearer reasoning rate', () => {
    const card = cataloguePriceCard('deepseek', {
      input: 0.3,
      output: 1.2,
      reasoning: 2.4,
    })!
    const reserved = reserveRequestAmount(card, { inputTokens: 1000, outputTokens: 500 })
    expect(reserved).toEqual(Usd.from('0.0015').toAmount())
  })

  it('rejects a reasoning count outside output instead of mispricing it', () => {
    expect(isValidUsage({ inputTokens: 10, outputTokens: 5, reasoningTokens: 6 })).toBe(false)
    const card = cataloguePriceCard('deepseek', flash)!
    expect(
      settleUsageAmount(card, { inputTokens: 10, outputTokens: 5, reasoningTokens: 6 }),
    ).toBeUndefined()
  })

  it('threads the reported reasoning count into settlement', () => {
    expect(
      modelPricedUsage({
        input_tokens: 10,
        output_tokens: 5,
        output_tokens_details: { reasoning_tokens: 2 },
      }).reasoningTokens,
    ).toBe(2)
  })
})

describe('GEM-G01: catalogue tiers reach the long-context tier', () => {
  // vendor/models-dev/snapshot.json gemini/gemini-2.5-pro, read 2026-10-12;
  // rates confirmed on ai.google.dev/gemini-api/docs/pricing the same day.
  const pro = {
    input: 1.25,
    output: 10,
    cache_read: 0.125,
    tiers: [
      {
        input: 2.5,
        output: 15,
        cache_read: 0.25,
        tier: { type: 'context', size: 200_000 },
      },
    ],
    context_over_200k: { input: 2.5, output: 15, cache_read: 0.25 },
  }

  it('prices past 200k prompts at the tier (2.5 Pro $2.50/$15)', () => {
    const card = cataloguePriceCard('gemini', pro)!
    expect(card.longContextTier).toMatchObject({
      fromTokens: 200_000,
      input: 2.5 / 1_000_000,
      output: 15 / 1_000_000,
      cachedInput: 0.25 / 1_000_000,
    })
    const settled = settleUsageAmount(card, { inputTokens: 200_000, outputTokens: 10 })
    expect(settled).toEqual(Usd.from('0.50015').toAmount())
  })

  it('keeps base rates below the tier', () => {
    const card = cataloguePriceCard('gemini', pro)!
    const settled = settleUsageAmount(card, { inputTokens: 1000, outputTokens: 10 })
    expect(settled).toEqual(Usd.from('0.00135').toAmount())
  })

  it('prefers the tier entry size (OpenAI reprices from 272k)', () => {
    const card = cataloguePriceCard('openai', {
      input: 2.5,
      output: 15,
      cache_read: 0.25,
      tiers: [
        { input: 5, output: 22.5, cache_read: 0.5, tier: { type: 'context', size: 272_000 } },
      ],
      context_over_200k: { input: 5, output: 22.5, cache_read: 0.5 },
    })!
    expect(card.longContextTier?.fromTokens).toBe(272_000)
  })

  it('reads cache_write where the catalogue carries one', () => {
    const card = cataloguePriceCard('openai', {
      input: 4,
      output: 20,
      cache_read: 0.4,
      cache_write: 5,
    })!
    expect(card.cacheWrite).toBe(5 / 1_000_000)
  })
})

describe('GQ-G01: Groq cached tokens settle at the documented half price', () => {
  it('fills a missing cached rate at 50% of input', () => {
    const card = cataloguePriceCard('groq', { input: 0.59, output: 0.79 })!
    expect(card.cachedInput).toBe(0.295 / 1_000_000)
  })

  it('keeps a listed cached rate where one exists', () => {
    const card = cataloguePriceCard('groq', {
      input: 0.075,
      output: 0.3,
      cache_read: 0.0375,
    })!
    expect(card.cachedInput).toBe(0.0375 / 1_000_000)
  })

  it('settles cached tokens below the full input price', () => {
    const card = cataloguePriceCard('groq', { input: 0.6, output: 0.8 })!
    expect(card.cachedInput).toBe(0.3 / 1_000_000)
    const settled = settleUsageAmount(card, {
      inputTokens: 1000,
      outputTokens: 10,
      cachedTokens: 900,
    })
    // 100 fresh @0.6 + 900 cached @0.3 + 10 @0.8, per million. Cards are
    // floats by convention, so the total holds to sub-nano-USD precision.
    expect(Number(settled)).toBeCloseTo(0.000338, 12)
    const fullRate = settleUsageAmount(
      { ...card, cachedInput: undefined },
      {
        inputTokens: 1000,
        outputTokens: 10,
        cachedTokens: 900,
      },
    )
    expect(Number(settled)).toBeLessThan(Number(fullRate))
  })

  it('leaves other presets without a guessed cached rate', () => {
    const card = cataloguePriceCard('together', { input: 0.6, output: 1.7 })!
    expect(card.cachedInput).toBeUndefined()
  })
})

describe('HF-G01: per-upstream cards from the live router row', () => {
  // router.huggingface.co/v1/models shape, captured 2026-10-12.
  const row = {
    id: 'Qwen/Qwen3.8-27B',
    providers: [
      {
        provider: 'novita',
        status: 'live',
        context_length: 1_000_000,
        pricing: { input: 0.42, output: 3 },
      },
      { provider: 'featherless-ai', status: 'live' },
      {
        provider: 'ovhcloud',
        status: 'live',
        context_length: 262_144,
        pricing: { input: 0.47, output: 3.19 },
      },
      {
        provider: 'deepinfra',
        status: 'staging',
        context_length: 262_144,
        pricing: { input: 0.2, output: 2.5 },
      },
    ],
  }

  it('returns live priced upstreams cheapest first, skipping the rest', () => {
    const cards = huggingFaceUpstreamCards(row)
    expect(cards.map((entry) => entry.upstream)).toEqual(['novita', 'ovhcloud'])
    expect(cards[0]).toMatchObject({
      card: { input: 0.42 / 1_000_000, output: 3 / 1_000_000, source: 'list', upstream: 'novita' },
    })
  })

  it('returns no card where no upstream is priced', () => {
    expect(
      huggingFaceUpstreamCards({ id: 'x', providers: [{ provider: 'a', status: 'live' }] }),
    ).toEqual([])
  })
})

describe('HF-G02/G03: per-upstream context and flags enter the record', () => {
  const row = {
    id: 'Qwen/Qwen3.8-27B',
    providers: [
      {
        provider: 'novita',
        status: 'live',
        context_length: 1_000_000,
        supports_tools: true,
        supports_structured_output: false,
      },
      {
        provider: 'ovhcloud',
        status: 'live',
        context_length: 262_144,
        supports_tools: true,
        supports_structured_output: true,
      },
    ],
  }

  it('promises no more than the smallest live window', () => {
    const evidence = nativeCapabilityEvidence('huggingface', row, {
      kind: 'models-list',
      ref: 'https://router.huggingface.co/v1/models',
    })
    expect(evidence.fields.limits?.contextTokens).toBe(262_144)
  })

  it('takes tools and structured flags from the chosen upstream', () => {
    const evidence = nativeCapabilityEvidence(
      'huggingface',
      row,
      { kind: 'models-list', ref: 'https://router.huggingface.co/v1/models' },
      'novita',
    )
    expect(evidence.fields.limits?.contextTokens).toBe(1_000_000)
    expect(evidence.fields.tools?.calling).toMatchObject({ state: 'yes', value: true })
    expect(evidence.fields.output?.formats).toMatchObject({ state: 'yes', value: ['text'] })
  })

  it('leaves other presets untouched', () => {
    const evidence = nativeCapabilityEvidence('openrouter', row, {
      kind: 'models-list',
      ref: 'https://openrouter.ai/api/v1/models',
    })
    expect(evidence.fields.limits?.contextTokens).toBeUndefined()
  })
})

describe('HF-G04: the upstream choice is stored, validated and sent', () => {
  const base = {
    id: 'hf',
    preset: 'huggingface',
    address: 'https://router.huggingface.co',
    auth: 'apiKey',
    models: ['Qwen/Qwen3.8-27B'],
  } as const

  it('accepts an upstream on a Hugging Face entry', () => {
    const parsed = providerEntrySchema.safeParse({ ...base, upstream: 'novita' })
    expect(parsed.success).toBe(true)
  })

  it('refuses an upstream on any other preset', () => {
    const parsed = providerEntrySchema.safeParse({
      ...base,
      preset: 'openrouter',
      upstream: 'novita',
    })
    expect(parsed.success).toBe(false)
  })

  it('sends the documented model:upstream suffix only when chosen', () => {
    const plain: ChatPresetQuirks = { ...CHAT_BASE, presetId: 'huggingface', sendCacheKey: false }
    expect(encodeChatRequest(chatBody(), 'Qwen/Qwen3.8-27B', plain).body.model).toBe(
      'Qwen/Qwen3.8-27B',
    )
    const pinned: ChatPresetQuirks = { ...plain, upstreamSuffix: 'novita' }
    expect(encodeChatRequest(chatBody(), 'Qwen/Qwen3.8-27B', pinned).body.model).toBe(
      'Qwen/Qwen3.8-27B:novita',
    )
  })
})

describe('FW-G01: the isolation key rides with the cache key', () => {
  it('sends prompt_cache_isolation_key beside prompt_cache_key', () => {
    const encoded = encodeChatRequest(chatBody(), 'm', {
      ...CHAT_BASE,
      sendCacheIsolationKey: true,
    })
    expect(encoded.body.prompt_cache_key).toBe('usagefields-key')
    expect(encoded.body.prompt_cache_isolation_key).toBe('usagefields-key')
    expect(Object.keys(encoded.body)).toEqual([
      'model',
      'messages',
      'stream',
      'stream_options',
      'max_tokens',
      'reasoning_effort',
      'prompt_cache_key',
      'prompt_cache_isolation_key',
    ])
  })

  it('sends neither key where the record accepts no key', () => {
    const encoded = encodeChatRequest(chatBody(), 'm', { ...CHAT_BASE, sendCacheKey: false })
    expect(encoded.body).not.toHaveProperty('prompt_cache_key')
    expect(encoded.body).not.toHaveProperty('prompt_cache_isolation_key')
  })
})

describe('OR-G04: the key body parses into a credit snapshot', () => {
  // openrouter.ai/openapi.json getCurrentKey example, read 2026-10-12.
  const keyBody = {
    data: {
      label: 'key',
      limit: 100,
      limit_remaining: 74.5,
      usage: 25.5,
      usage_daily: 25.5,
      usage_weekly: 25.5,
      usage_monthly: 25.5,
      effective_budget: { limit_usd: 50, spend_usd: 32.5, remaining_usd: 17.5 },
    },
  }

  it('reads used, limit and remaining credit', () => {
    expect(parseOpenRouterKeyUsageBody(keyBody)).toEqual({
      usedToday: 25.5,
      usedThisWeek: 25.5,
      usedThisMonth: 25.5,
      limit: 100,
      remaining: 74.5,
    })
  })

  it('falls back to the usage total and the effective budget', () => {
    expect(
      parseOpenRouterKeyUsageBody({
        data: { usage: 3, effective_budget: { limit_usd: 50, remaining_usd: 17.5 } },
      }),
    ).toEqual({
      usedToday: 3,
      usedThisWeek: 3,
      usedThisMonth: 3,
      limit: 50,
      remaining: 17.5,
    })
  })

  it('returns no snapshot for a missing or invalid body', () => {
    expect(parseOpenRouterKeyUsageBody(undefined)).toBeUndefined()
    expect(parseOpenRouterKeyUsageBody({ data: { usage: -1 } })).toBeUndefined()
    expect(parseOpenRouterKeyUsageBody({ data: { usage: 1, limit: 'many' } })).toBeUndefined()
  })
})
