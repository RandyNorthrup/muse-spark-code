import { Usd } from '../../src/shared/usd'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { UpdateTranslator } from '../../src/acp/translate'
import { PaidUsage } from '../../src/core/paid/paidFeatures'
import {
  decodeOllamaStream,
  type OllamaDurations,
} from '../../src/core/backends/modelapi/codecs/ollama'
import type { UsageRecording } from '../../src/core/usage/recording'
import { usageRecordSchema, type UsageCost } from '../../src/shared/usageJournal'
import { FakeLogOutputChannel } from './helpers/fakes'

function port(): UsageRecording {
  return {
    note: vi.fn(),
    limit: vi.fn(),
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
}
const record = usageRecordSchema.parse({
  v: 1,
  type: 'usage',
  id: 'one',
  at: 100,
  day: '2026-10-05',
  timezoneOffsetMins: 0,
  client: 'Zed',
  backend: 'modelApi',
  provider: 'meta',
  model: 'muse-spark-1.3',
  startedAt: 1,
  kind: 'turn',
  tokens: {},
  cost: { certainty: 'unpriced' },
  outcome: 'completed',
})
const context = {
  type: 'contextUsage',
  usedTokens: 12,
  windowTokens: 100,
  pressure: 'low',
} as const

describe('auxiliary recording', () => {
  it('records searches, images and fractional voice seconds with separate units', () => {
    const tap = port()
    const usage = new PaidUsage(new FakeLogOutputChannel(), tap)
    usage.add('webSearch', 2, Usd.from('0.005').toAmount())
    usage.add('imageGeneration', 1)
    usage.add('voice', 1.5)
    expect(tap.note).toHaveBeenNthCalledWith(
      1,
      undefined,
      expect.objectContaining({ kind: 'search', units: { searches: 2 } }),
    )
    expect(tap.note).toHaveBeenNthCalledWith(
      2,
      undefined,
      expect.objectContaining({ kind: 'image', model: 'muse-image-1.0', units: { images: 1 } }),
    )
    expect(tap.note).toHaveBeenNthCalledWith(
      3,
      undefined,
      expect.objectContaining({
        kind: 'voice',
        model: 'muse-voice-transcribe-1.0',
        units: { audioSeconds: 1.5 },
      }),
    )
    usage.add('voice', 0)
    expect(tap.note).toHaveBeenCalledTimes(3)
  })
  it('restores returned images without treating unknown sent outcomes as returned', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.restore([
      {
        ...record,
        id: 'sent-unknown',
        kind: 'image',
        units: { images: 1 },
        outcome: 'failed',
        cost: { certainty: 'uncertain', usd: 0.01 },
      },
      {
        ...record,
        id: 'returned',
        kind: 'image',
        units: { images: 1 },
        cost: { certainty: 'computed', usd: 0.01 },
      },
    ])
    expect(usage.current.images).toBe(1)
  })
  it('rebuilds today once, retains live additions and preserves uncertain liabilities', () => {
    const usage = new PaidUsage(new FakeLogOutputChannel())
    usage.add('imageGeneration', 1)
    usage.restore([
      {
        ...record,
        kind: 'search',
        units: { searches: 2 },
        cost: { certainty: 'computed', usd: 0.005 },
      },
      {
        ...record,
        id: 'image',
        kind: 'image',
        units: { images: 2 },
        cost: { certainty: 'computed', usd: 0.02 },
      },
      {
        ...record,
        id: 'voice',
        kind: 'voice',
        units: { audioSeconds: 1.5 },
        cost: { certainty: 'uncertain', usd: 0.01 },
      },
      {
        ...record,
        id: 'child',
        kind: 'subagent',
        tokens: { input: 20, output: 10 },
        cost: { certainty: 'uncertain', usd: 0.5 },
      },
      {
        ...record,
        id: 'review',
        kind: 'reviewer',
        tokens: { input: 10, output: 5 },
        cost: { certainty: 'reported', usd: 0.1 },
      },
      {
        ...record,
        id: 'attempt',
        session: 'attempt-session',
        kind: 'bestOfN',
        tokens: { input: 10, output: 5 },
        cost: { certainty: 'unpriced' },
      },
      {
        ...record,
        id: 'attempt-two',
        session: 'attempt-session',
        kind: 'bestOfN',
        tokens: { input: 10, output: 5 },
        cost: { certainty: 'computed', usd: 0.1 },
      },
    ])
    const expected = { ...usage.current }
    usage.restore([{ ...record, kind: 'image', units: { images: 100 } }])
    expect(usage.current).toEqual(expected)
    expect(usage.current).toMatchObject({
      webSearches: 2,
      images: 3,
      voiceSeconds: 1.5,
      subagentRequests: 1,
      subagentUnknownRequests: 1,
      subagentTokens: 30,
      subagentCostUsd: Usd.from(0.5).toAmount(),
      autoReviews: 1,
      autoReviewUnknownRequests: 0,
      bestOfNAttempts: 1,
      bestOfNRequests: 2,
      bestOfNUnknownRequests: 1,
      bestOfNTokens: 30,
      bestOfNCostUsd: Usd.from(0.1).toAmount(),
    })
  })
  it('adds priced ACP session cost with certainty and leaves unknown prices absent', () => {
    const translator = new UpdateTranslator('/workspace', false, undefined, 'modelApi')
    translator.updates({
      type: 'tokenUsage',
      modelId: 'muse-spark-1.3',
      inputTokens: 100,
      outputTokens: 10,
      cachedTokens: 20,
    })
    expect(translator.updates(context)).toEqual([
      {
        sessionUpdate: 'usage_update',
        used: 12,
        size: 100,
        cost: { amount: 0.0001455, currency: 'USD' },
        _meta: { museSpark: { costCertainty: 'computed' } },
      },
    ])
    translator.updates({
      type: 'tokenUsage',
      modelId: 'unknown/model',
      inputTokens: 200,
      outputTokens: 20,
    })
    expect(translator.updates(context)).toEqual([
      { sessionUpdate: 'usage_update', used: 12, size: 100 },
    ])
    const subscription = new UpdateTranslator('/workspace', false)
    subscription.updates({
      type: 'tokenUsage',
      modelId: 'muse-spark-1.3',
      inputTokens: 100,
      outputTokens: 10,
    })
    expect(subscription.updates(context)).toEqual([
      { sessionUpdate: 'usage_update', used: 12, size: 100 },
    ])
  })
  it('uses injected BYO settlement for reported and local prices, withholding plan and uncertainty', () => {
    let cost: UsageCost | undefined = { certainty: 'reported', usd: 0.12 }
    const translator = new UpdateTranslator('/workspace', false, () => cost, 'modelApi')
    translator.updates({
      type: 'tokenUsage',
      modelId: 'muse-spark-1.3',
      inputTokens: 100,
      outputTokens: 10,
    })
    expect(translator.updates(context)).toEqual([
      expect.objectContaining({
        cost: { amount: 0.12, currency: 'USD' },
        _meta: { museSpark: { costCertainty: 'reported' } },
      }),
    ])
    cost = { certainty: 'local', usd: 0 }
    expect(translator.updates(context)).toEqual([
      expect.objectContaining({ cost: { amount: 0, currency: 'USD' } }),
    ])
    for (const certainty of ['plan', 'uncertain', 'unpriced'] as const) {
      cost = { certainty, usd: 1 }
      expect(translator.updates(context)).toEqual([
        { sessionUpdate: 'usage_update', used: 12, size: 100 },
      ])
    }
    cost = undefined
    expect(translator.updates(context)).toEqual([
      { sessionUpdate: 'usage_update', used: 12, size: 100 },
    ])
  })
  it('retains all four native Ollama durations from the counted capture', async () => {
    const capture = z
      .object({ response: z.object({ body: z.string() }) })
      .parse(
        JSON.parse(
          readFileSync(
            new URL(
              '../../docs/certification/m95-captures/ollama/05-tool-follow-up.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      )
    async function* chunks(body = capture.response.body) {
      await Promise.resolve()
      yield new TextEncoder().encode(body)
    }
    const onDurations = vi.fn()
    const events = decodeOllamaStream(chunks(), {
      model: 'qwen3:4b-instruct-2507-q4_K_M',
      responseId: 'capture',
      status: 200,
      onDurations,
    })
    for await (const _event of events) {
      /* Consume the real captured stream. */
    }
    expect(onDurations).toHaveBeenCalledExactlyOnceWith({
      totalNs: 363_239_700,
      loadNs: 4_255_500,
      promptEvalNs: 36_928_000,
      evalNs: 278_229_000,
    })
    for (const field of [
      'total_duration',
      'load_duration',
      'prompt_eval_duration',
      'eval_duration',
    ]) {
      const body = capture.response.body.replace(
        new RegExp(String.raw`"${field}":\s*\d+`),
        () => `"${field}":-1`,
      )
      expect(body).not.toBe(capture.response.body)
      const observe = vi.fn<(durations: OllamaDurations) => void>()
      const damagedEvents = decodeOllamaStream(chunks(body), {
        model: 'qwen3:4b-instruct-2507-q4_K_M',
        responseId: 'bad-timing',
        status: 200,
        onDurations: observe,
      })
      for await (const _event of damagedEvents) {
        /* Invalid optional timing does not fail a valid model response. */
      }
      expect(Object.values(observe.mock.calls[0]?.[0] ?? {})).not.toContain(-1)
    }
    let hasCompleted = false
    const observedEvents = decodeOllamaStream(chunks(), {
      model: 'qwen3:4b-instruct-2507-q4_K_M',
      responseId: 'failed-observer',
      status: 200,
      onDurations: () => {
        throw new Error('private observer failure')
      },
    })
    for await (const event of observedEvents)
      if (event.type === 'response.completed') hasCompleted = true
    expect(hasCompleted).toBe(true)
  })
})
