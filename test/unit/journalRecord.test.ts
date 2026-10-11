import { Usd } from '../../src/shared/usd'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  createUsageRecord,
  normaliseUsage,
  usageLocalDay,
  type UsageRecordContext,
} from '../../src/core/usage/journalRecord'
import { isValidUsage, settleUsageUsd, type PriceCard } from '../../src/core/providers/priceCard'
import { decodeAnthropicStream } from '../../src/core/backends/modelapi/codecs/anthropic'
import { decodeChatStream } from '../../src/core/backends/modelapi/codecs/chat'
import { decodeGeminiStream } from '../../src/core/backends/modelapi/codecs/gemini'
import { decodeOllamaStream } from '../../src/core/backends/modelapi/codecs/ollama'
import { createResponsesCodec } from '../../src/core/backends/modelapi/codecs/responses'
import type { StreamEvent, Usage } from '../../src/core/backends/modelapi/schemas'

const context: UsageRecordContext = {
  id: 'call-1',
  at: 1_791_205_200_000,
  startedAt: 1_791_205_199_000,
  client: 'Zed',
  backend: 'modelApi',
  provider: 'custom',
  model: 'test-model',
  kind: 'turn',
  outcome: 'completed',
}
const usage: Usage = {
  input_tokens: 100,
  output_tokens: 20,
  input_tokens_details: { cached_tokens: 30, cache_write_tokens: 20, cache_write_tokens_1h: 5 },
  output_tokens_details: { reasoning_tokens: 4 },
}
const card: PriceCard = {
  input: 1,
  cachedInput: 0.1,
  cacheWrite: 2,
  cacheWrite1h: 3,
  output: 4,
  request: 0.5,
  source: 'list',
  fetchedAt: '2026-10-04T12:00:00Z',
}
const captureSchema = z.object({
  response: z.object({
    events: z.optional(z.array(z.object({ event: z.optional(z.string()), data: z.unknown() }))),
    body: z.optional(z.string()),
  }),
})
function capture(provider: string, name: string) {
  return captureSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../docs/certification/m95-captures/${provider}/${name}.json`, import.meta.url),
        'utf8',
      ),
    ),
  ).response
}
function chunks(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}
function completed(events: StreamEvent[]): Usage {
  const event = events.at(-1)
  if (event?.type !== 'response.completed' || event.response.usage == null)
    throw new Error('missing captured usage')
  return event.response.usage
}

describe('journal records', () => {
  it('prices one-hour writes as a subset, including tier rates and invalid splits', () => {
    const billable = {
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 30,
      cacheWriteTokens: 20,
      cacheWriteTokens1h: 5,
    }
    expect(settleUsageUsd(card, billable)).toBe(178.5)
    expect(settleUsageUsd({ ...card, cacheWrite1h: undefined }, billable)).toBe(173.5)
    expect(
      settleUsageUsd(
        { ...card, longContextTier: { fromTokens: 100, input: 2, output: 8 } },
        billable,
      ),
    ).toBe(308.5)
    expect(isValidUsage({ ...billable, cacheWriteTokens1h: 21 })).toBe(false)
    expect(settleUsageUsd(card, { ...billable, cacheWriteTokens1h: 21 })).toBeUndefined()
    expect(settleUsageUsd(card, { ...billable, cacheWriteTokens1h: NaN })).toBeUndefined()
  })
  it('keeps canonical subsets and absent counters without inventing zeroes', () => {
    expect(normaliseUsage(usage)).toEqual({
      input: 100,
      output: 20,
      cached: 30,
      cacheWrite: 20,
      cacheWrite1h: 5,
      cacheWrite5m: 15,
      reasoning: 4,
    })
    expect(normaliseUsage({ input_tokens: 100 })).toEqual({ input: 100 })
    expect(normaliseUsage({ input_tokens: 100, output_tokens: 20 })).toEqual({
      input: 100,
      output: 20,
    })
    expect(createUsageRecord(undefined, context)).toMatchObject({
      tokens: {},
      cost: { certainty: 'unpriced' },
    })
    expect(
      createUsageRecord(undefined, { ...context, pricing: { kind: 'priced', card } }).cost,
    ).toEqual({ certainty: 'uncertain' })
    expect(() => normaliseUsage({ ...usage, input_tokens: 40 })).toThrow()
    expect(() => normaliseUsage({ ...usage, output_tokens: 1 })).toThrow()
    expect(() => normaliseUsage({ ...usage, input_tokens: -1 })).toThrow()
  })
  it('settles reported USD, ticks, dated cards, local and unpriced independently', () => {
    const priced = { ...context, pricing: { kind: 'priced', card } } satisfies UsageRecordContext
    expect(createUsageRecord(usage, priced).cost).toEqual({
      certainty: 'computed',
      usd: 178.5,
      source: 'list',
      date: '2026-10-04',
    })
    expect(
      createUsageRecord(usage, {
        ...priced,
        providerCostUsd: Usd.from(0).toAmount(),
        costInUsdTicks: 10_000_000_000,
      }).cost,
    ).toEqual({ certainty: 'reported', usd: 0 })
    expect(
      createUsageRecord(undefined, { ...context, costInUsdTicks: 2_500_000_000 }).cost,
    ).toEqual({
      certainty: 'reported',
      usd: 0.25,
    })
    expect(createUsageRecord(usage, { ...context, pricing: { kind: 'local' } }).cost).toEqual({
      certainty: 'local',
      usd: 0,
    })
    expect(
      createUsageRecord(usage, { ...context, providerCostUsd: Usd.from(-1).toAmount() }).cost,
    ).toEqual({
      certainty: 'unpriced',
    })
    expect(
      createUsageRecord(undefined, {
        ...priced,
        uncertain: true,
        retainedLiabilityUsd: Usd.from(10).toAmount(),
      }).cost,
    ).toEqual({ certainty: 'uncertain', usd: 10 })
    const record = createUsageRecord(usage, priced)
    cardCostChange(record.cost.usd)
    function cardCostChange(original: number | undefined) {
      expect(
        createUsageRecord(usage, {
          ...priced,
          pricing: { kind: 'priced', card: { ...card, input: 10 } },
        }).cost.usd,
      ).not.toBe(original)
      expect(record.cost.usd).toBe(original)
    }
  })
  it('keeps known prices and prices the known part of incomplete usage', () => {
    const priced = {
      ...context,
      outcome: 'incomplete',
      pricing: { kind: 'priced', card },
    } satisfies UsageRecordContext
    for (const [partial, expected] of [
      [{ input_tokens: 100 }, 100.5],
      [{ output_tokens: 20 }, 80.5],
      [{ input_tokens: 100, input_tokens_details: usage.input_tokens_details }, 98.5],
      [{ input_tokens_details: { cached_tokens: 30 } }, 3.5],
      [{ output_tokens_details: { reasoning_tokens: 4 } }, 16.5],
    ] satisfies [Partial<Usage>, number][]) {
      const record = createUsageRecord(partial, priced)
      expect(record.cost).toEqual({
        certainty: 'uncertain',
        usd: expected,
        source: 'list',
        date: '2026-10-04',
      })
      expect(record.tokens.input).toBe(partial.input_tokens)
      expect(record.tokens.output).toBe(partial.output_tokens)
    }
    expect(createUsageRecord(undefined, priced).cost).toEqual({ certainty: 'uncertain' })
    expect(createUsageRecord({ input_tokens: 100 }, { ...priced, uncertain: true }).cost).toEqual({
      certainty: 'uncertain',
      usd: 100.5,
      source: 'list',
      date: '2026-10-04',
    })
    expect(
      createUsageRecord(
        { input_tokens: 100 },
        {
          ...priced,
          uncertain: true,
          providerCostUsd: Usd.from(2).toAmount(),
        },
      ).cost,
    ).toEqual({ certainty: 'uncertain', usd: 2 })
    expect(createUsageRecord({ input_tokens: 100 }, context).cost).toEqual({
      certainty: 'unpriced',
    })
    const meta = { ...context, provider: 'meta', model: 'muse-spark-1.3' }
    expect(createUsageRecord({ input_tokens: 100 }, meta).cost).toEqual({
      certainty: 'uncertain',
      usd: 0.000125,
      source: 'meta-published',
      date: '2026-09-26',
    })
    expect(createUsageRecord({ output_tokens: 20 }, meta).cost.usd).toBe(0.000085)
    expect(
      createUsageRecord(
        { input_tokens: 100 },
        { ...priced, providerCostUsd: Usd.from(2).toAmount() },
      ).cost,
    ).toEqual({ certainty: 'reported', usd: 2 })
  })
  it('prices only exact published Meta ids and keeps plan equivalents separate', () => {
    const meta = { ...context, provider: 'meta', model: 'muse-spark-1.3' }
    expect(createUsageRecord({ input_tokens: 100, output_tokens: 20 }, meta).cost).toEqual({
      certainty: 'computed',
      usd: 0.00021,
      source: 'meta-published',
      date: '2026-09-26',
    })
    expect(createUsageRecord(usage, { ...meta, model: 'future-contributor' }).cost).toEqual({
      certainty: 'unpriced',
    })
    expect(createUsageRecord(usage, { ...context, backend: 'museCode' }).cost).toEqual({
      certainty: 'plan',
    })
    expect(createUsageRecord(usage, { ...meta, backend: 'museCode' }).cost).toMatchObject({
      certainty: 'plan',
      apiEquivalentUsd: expect.any(Number),
    })
    expect(
      createUsageRecord(usage, { ...context, pricing: { kind: 'plan' }, apiEquivalentCard: card })
        .cost,
    ).toEqual({ certainty: 'plan', apiEquivalentUsd: 178.5 })
    expect(
      createUsageRecord(usage, {
        ...context,
        pricing: { kind: 'plan' },
        apiEquivalentCard: { ...card, source: 'user' },
      }).cost,
    ).toEqual({ certainty: 'plan' })
    expect(
      createUsageRecord(usage, {
        ...context,
        pricing: { kind: 'priced', card },
        estimatedTokens: true,
      }),
    ).toMatchObject({ tokens: { estimated: true }, cost: { certainty: 'estimated' } })
  })
  it('records paid units and retains uncertain voice liability', () => {
    expect(
      createUsageRecord(undefined, { ...context, kind: 'search', units: { searches: 2 } }).cost.usd,
    ).toBe(0.005)
    expect(
      createUsageRecord(undefined, { ...context, kind: 'image', units: { images: 2 } }).cost.usd,
    ).toBe(0.02)
    expect(
      createUsageRecord(undefined, { ...context, kind: 'voice', units: { audioSeconds: 3600 } })
        .cost,
    ).toEqual({ certainty: 'uncertain', usd: 0.18 })
  })
  it('uses the original local day and offset and validates privacy fields', () => {
    const at = new Date(2026, 9, 5, 23, 59).getTime()
    expect(usageLocalDay(at)).toBe('2026-10-05')
    expect(
      createUsageRecord(usage, {
        ...context,
        at,
        client: 'Zed\u{1}',
        durationMs: 15,
        firstTokenMs: 2,
        retries: 2,
        rateLimited: true,
      }),
    ).toMatchObject({
      day: '2026-10-05',
      client: 'Zed',
      timezoneOffsetMins: new Date(at).getTimezoneOffset(),
      durationMs: 15,
      firstTokenMs: 2,
      retries: 2,
      rateLimited: true,
    })
    expect(() =>
      createUsageRecord(usage, { ...context, headers: { 'retry-after': 'x'.repeat(65) } }),
    ).toThrow()
    const smuggled = { ...context, prompt: 'private-canary', workspace: '/private-canary' }
    expect(JSON.stringify(createUsageRecord(usage, smuggled))).not.toContain('private-canary')
  })
  it('replays captured Anthropic cache TTL usage without renormalising', async () => {
    const receipt = capture('anthropic', '08-cache-call-1')
    const frames = (receipt.events ?? []).map((event) => ({
      event: event.event ?? '',
      data: JSON.stringify(event.data),
    }))
    const native = completed(
      await Array.fromAsync(decodeAnthropicStream(frames, { model: 'claude-sonnet-5.5' })),
    )
    const record = createUsageRecord(native, {
      ...context,
      provider: 'anthropic',
      pricing: { kind: 'priced', card },
    })
    expect(record.tokens.input).toBe(native.input_tokens)
    expect(record.tokens.cacheWrite).toBeGreaterThan(0)
    expect(record.tokens.cacheWrite5m! + record.tokens.cacheWrite1h!).toBe(record.tokens.cacheWrite)
  })
  it.each(['openai', 'xai'])(
    'replays %s captured cached and reasoning subsets',
    async (provider) => {
      const receipt = capture(
        provider,
        provider === 'openai' ? '03-tool-result-stream' : '04-tool-result-stream',
      )
      const stream = chunks(
        (receipt.events ?? [])
          .map((event) => `event: ${event.event ?? ''}\ndata: ${JSON.stringify(event.data)}\n\n`)
          .join(''),
      )
      const codec = createResponsesCodec({
        sendPromptCacheRetention: true,
        sendPromptCacheKey: true,
      })
      const costs: number[] = []
      const native = completed(
        await Array.fromAsync(
          codec.decodeStream(stream, {
            settledCostUsd: (usd) => {
              costs.push(Number(usd))
            },
          }),
        ),
      )
      const record = createUsageRecord(native, {
        ...context,
        provider,
        ...(costs[0] !== undefined && { providerCostUsd: Usd.from(costs[0]).toAmount() }),
      })
      expect(record.tokens.input).toBe(native.input_tokens)
      expect(record.tokens.output).toBe(native.output_tokens)
      expect(record.tokens.cached).toBe(native.input_tokens_details?.cached_tokens)
      expect(record.tokens.reasoning).toBe(native.output_tokens_details?.reasoning_tokens)
      if (provider === 'xai') expect(record.cost.certainty).toBe('reported')
    },
  )
  it('settles OpenRouter reported cost from its captured final chunk', () => {
    const receipt = capture('openrouter', '05-tool-result-stream')
    const decoded = decodeChatStream(
      (receipt.events ?? []).map((event) => event.data),
      'openai/gpt-oss-20b',
      {
        presetId: 'openrouter',
        replayField: 'details',
        toolResultName: false,
        reasoningParam: 'effort-object',
        outputCap: 'max_tokens',
        includeUsage: true,
        sendCacheKey: false,
        toolStream: false,
      },
      { outputItems: 128, argumentBytes: 65_536, streamBytes: 1_048_576, frameBytes: 65_536 },
    )
    expect(Number(decoded.providerCostUsd)).toBeGreaterThan(0)
    const record = createUsageRecord(decoded.response.usage ?? undefined, {
      ...context,
      provider: 'openrouter',
      ...(decoded.providerCostUsd !== undefined && {
        providerCostUsd: decoded.providerCostUsd,
      }),
    })
    expect(record.cost).toEqual({ certainty: 'reported', usd: Number(decoded.providerCostUsd) })
    expect(record.tokens.input).toBe(decoded.response.usage?.input_tokens)
  })
  it('replays captured Gemini thoughts and Ollama local usage', async () => {
    const receipt = capture('gemini', '03-tool-result-stream')
    const native = completed(
      await Array.fromAsync(
        decodeGeminiStream(
          chunks(
            (receipt.events ?? [])
              .map((event) => `data: ${JSON.stringify(event.data)}\n\n`)
              .join(''),
          ),
          'gemini-3.5-flash-lite',
        ),
      ),
    )
    expect(createUsageRecord(native, context).tokens.output).toBe(native.output_tokens)
    const ollama = capture('ollama', '03-plain-stream')
    const local = completed(
      await Array.fromAsync(
        decodeOllamaStream(chunks(ollama.body ?? ''), {
          model: 'qwen3:4b-instruct-2507-q4_K_M',
          responseId: 'captured',
          status: 200,
        }),
      ),
    )
    expect(createUsageRecord(local, { ...context, pricing: { kind: 'local' } })).toMatchObject({
      tokens: { input: local.input_tokens, output: local.output_tokens },
      cost: { certainty: 'local', usd: 0 },
    })
  })
})
