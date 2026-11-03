import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  AutoCompact,
  compactionSummaryBudget,
  measureAutoCompactRequest,
  type AutoCompactInput,
} from '../../src/core/backends/modelapi/autoCompact'
import { modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPacking'
import { restoredToolText, type InputItem } from '../../src/core/backends/modelapi/schemas'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import type { ModelPricing } from '../../src/core/providers/priceCard'
import {
  COMPACTION_SUMMARY_MAX_TOKENS,
  MODEL_API_CONTEXT_WINDOW,
  PROVIDERS_FILE_VERSION,
} from '../../src/shared/constants'
import { recordedFunctionToolSchema } from './helpers/recordedFunctionTool'

const PRICES: readonly { name: string; pricing: ModelPricing; ratio?: number }[] = [
  {
    name: 'Meta standard',
    pricing: {
      kind: 'priced',
      card: { input: 1.25, cachedInput: 0.15, output: 4.25, source: 'catalogue' },
    },
    ratio: 1.25 / 0.15,
  },
  {
    name: 'Meta contributor',
    pricing: {
      kind: 'priced',
      card: { input: 0.1, cachedInput: 0.002, output: 0.2, source: 'catalogue' },
    },
    ratio: 50,
  },
  {
    name: 'Anthropic 5m',
    pricing: {
      kind: 'priced',
      card: {
        input: 3,
        cachedInput: 0.3,
        cacheWrite: 3.75,
        cacheWrite1h: 6,
        output: 15,
        source: 'catalogue',
      },
    },
    ratio: 12.5,
  },
  {
    name: 'Anthropic 1h',
    pricing: {
      kind: 'priced',
      card: {
        input: 3,
        cachedInput: 0.3,
        cacheWrite: 3.75,
        cacheWrite1h: 6,
        output: 15,
        source: 'catalogue',
      },
    },
    ratio: 20,
  },
  {
    name: 'OpenAI',
    pricing: {
      kind: 'priced',
      card: { input: 2.5, cachedInput: 0.625, output: 10, source: 'catalogue' },
    },
    ratio: 4,
  },
  {
    name: 'Gemini',
    pricing: {
      kind: 'priced',
      card: { input: 1.25, cachedInput: 0.125, output: 10, source: 'catalogue' },
    },
    ratio: 10,
  },
  { name: 'local', pricing: { kind: 'local' }, ratio: 10 },
  { name: 'plan', pricing: { kind: 'plan' } },
  { name: 'unpriced', pricing: { kind: 'unpriced' } },
]

function input(changes: Partial<AutoCompactInput> = {}): AutoCompactInput {
  return {
    pricing: { kind: 'priced', card: { input: 1, cachedInput: 1, output: 1, source: 'user' } },
    contextTokens: 60_000,
    windowTokens: 100_000,
    removableTokens: 40_000,
    summaryTokens: 2000,
    summaryInputTokens: 60_000,
    summaryOutputTokens: 2000,
    summaryRequests: 1,
    cachedTokens: 60_000,
    ...changes,
  }
}

function registered(requests = 100) {
  const model = new AutoCompact()
  model.noteTodos([
    { text: 'one', status: 'inProgress' },
    { text: 'two', status: 'pending' },
  ])
  for (let count = 0; count < requests; count += 1) model.noteRequest()
  model.noteTodos([
    { text: 'one', status: 'completed' },
    { text: 'two', status: 'pending' },
  ])
  return model
}

describe('automatic compaction economics (D81.4)', () => {
  it('measures removable dispatched placeholders rather than their stored originals', () => {
    const pack = new ObservationPack()
    const original: InputItem[] = [
      {
        type: 'function_call_output',
        call_id: 'large-output',
        output: restoredToolText('long output\n'.repeat(10_000)),
      },
    ]
    pack.noteSent(pack.project(original))
    pack.noteSent(pack.project(original))
    const sent = pack.project(original)
    const body = { instructions: 'prefix', tools: [], input: sent }
    const measured = measureAutoCompactRequest(body, ['old'], new Set())
    expect(measured?.removableTokens).toBeLessThan(1000)
    expect(
      measureAutoCompactRequest({ ...body, input: original }, ['old'], new Set())?.removableTokens,
    ).toBeGreaterThan(10_000)
    expect(measureAutoCompactRequest(body, ['old'], new Set(['old']))?.removableTokens).toBe(0)
    expect(measureAutoCompactRequest(body, [], new Set())).toBeUndefined()
  })

  it.each(PRICES)(
    'prices $name across sizes with finite nonnegative debt and selected ratios',
    ({ name, pricing, ratio }) => {
      for (let size = 1; size <= 100; size += 1) {
        const model = registered()
        const request = input({
          pricing,
          cacheDuration: name === 'Anthropic 1h' ? '1h' : '5m',
          localTime: { prefill: 0.01, read: 0.001, output: 0.01 },
          contextTokens: size * 1000,
          removableTokens: size * 500,
          windowTokens: size * 1100,
          summaryTokens: size * 10,
        })
        const decision = model.decide(request)
        expect(decision?.reason).toBe('near-window')
        if (ratio === undefined) expect(decision?.writeReadRatio).toBeUndefined()
        else expect(decision?.writeReadRatio).toBeCloseTo(ratio)
        expect(Number.isFinite(decision?.newDebt)).toBe(true)
        expect(decision?.newDebt).toBeGreaterThanOrEqual(0)
        if (decision === undefined) {
          continue
        }

        model.succeeded(decision, size * 10)
        expect(model.summaryTokens).toBe(size * 10)
      }
    },
  )

  it('charges the post-compaction context and the summarizer call including request fees', () => {
    const model = registered()
    const decision = model.decide(
      input({
        pricing: {
          kind: 'priced',
          card: {
            input: 2,
            cachedInput: 1,
            cacheWrite: 3,
            output: 4,
            request: 5,
            source: 'user',
          },
        },
        summaryRequests: 2,
      }),
    )
    expect(decision?.newDebt).toBe(22_000 * 2 + (60_000 + 2000 * 4 + 5) * 2)
    expect(decision?.breakEvenRequests).toBe((decision?.newDebt ?? 0) / 38_000)
  })

  it('consumes one transition per boundary and ignores first-seen completed items', () => {
    const model = new AutoCompact()
    for (let request = 0; request < 100; request += 1) model.noteRequest()
    model.noteTodos([
      { text: 'old history', status: 'completed' },
      { text: 'open', status: 'pending' },
    ])
    expect(model.decide(input())).toBeUndefined()
    const registeredModel = registered()
    expect(registeredModel.decide(input())?.reason).toBe('cost')
    expect(registeredModel.decide(input())).toBeUndefined()
  })

  it('does not match a new text or a duplicate first-seen completion to an unfinished item', () => {
    const model = new AutoCompact()
    model.noteTodos([{ text: 'a', status: 'pending' }])
    for (let request = 0; request < 100; request += 1) model.noteRequest()
    model.noteTodos([
      { text: 'b', status: 'completed' },
      { text: 'a', status: 'pending' },
    ])
    expect(model.decide(input())).toBeUndefined()
    model.noteTodos([
      { text: 'a', status: 'pending' },
      { text: 'a', status: 'completed' },
    ])
    expect(model.decide(input())).toBeUndefined()
  })

  it('requires the floor for cost, but near-window and overflow bypass cooldown and todo history', () => {
    expect(registered().decide(input({ contextTokens: 49_999 }))).toBeUndefined()
    const model = new AutoCompact()
    const decision = model.decide(input({ contextTokens: 90_000 }))
    expect(decision?.reason).toBe('near-window')
    if (decision !== undefined) model.succeeded(decision, 3500)
    expect(model.decide(input(), true)?.reason).toBe('overflow')
    expect(model.decide(input({ contextTokens: 90_000 }))?.reason).toBe('near-window')
    expect(model.decide(input({ removableTokens: 0 }), true)).toBeUndefined()
  })

  it('enforces two dispatched requests for cost, accumulates and repays debt', () => {
    const model = registered()
    const first = model.decide(input())
    expect(first).toBeDefined()
    if (first === undefined) return
    model.succeeded(first, 3000)
    const debt = model.carriedDebt
    model.noteTodos([
      { text: 'two', status: 'completed' },
      { text: 'three', status: 'pending' },
    ])
    expect(model.decide(input())).toBeUndefined()
    model.noteRequest()
    expect(model.carriedDebt).toBe(Math.max(0, debt - first.saving))
    model.noteRequest()
    const second = model.decide(input({ contextTokens: 90_000 }))
    if (second === undefined) throw new Error('near-window decision absent')
    const carried = model.carriedDebt
    model.succeeded(second, 4000)
    expect(model.carriedDebt).toBe(carried + second.newDebt)
    model.failed()
    expect(model.carriedDebt).toBe(0)
    expect(model.decide(input(), true)).toBeUndefined()
    model.noteToolWork()
    expect(model.decide(input(), true)?.reason).toBe('overflow')
  })

  it('adds unpaid economic debt across consecutive near-window compactions', () => {
    const model = new AutoCompact()
    const decision = model.decide(input({ contextTokens: 90_000 }))
    if (decision === undefined) throw new Error('near-window decision absent')
    model.succeeded(decision, 3000)
    model.succeeded(decision, 4000)
    expect(model.carriedDebt).toBe(decision.newDebt * 2)
  })

  it('keeps debt but resets the horizon after a completed task and new user input', () => {
    const model = registered()
    const first = model.decide(input())
    if (first === undefined) throw new Error('cost decision absent')
    model.succeeded(first, 3000)
    model.noteTodos([
      { text: 'one', status: 'completed' },
      { text: 'two', status: 'completed' },
    ])
    model.newUserTask()
    expect(model.carriedDebt).toBe(first.newDebt)
    expect(model.decide(input())).toBeUndefined()
    model.failed()
    model.newUserTask()
    expect(model.decide(input(), true)?.reason).toBe('overflow')
  })

  it.each(['unpriced', 'plan'] as const)('%s uses near-window only', (kind) => {
    expect(registered().decide(input({ pricing: { kind } }))).toBeUndefined()
    expect(registered().decide(input({ pricing: { kind }, contextTokens: 90_000 }))?.reason).toBe(
      'near-window',
    )
  })

  it('local cost requires measured time and reads the long-context tier', () => {
    expect(registered().decide(input({ pricing: { kind: 'local' } }))).toBeUndefined()
    expect(
      registered().decide(
        input({
          pricing: { kind: 'local' },
          localTime: { prefill: 0.001, read: 0.0001, output: 0.002 },
        }),
      )?.reason,
    ).toBe('cost')
    const model = registered()
    const decision = model.decide(
      input({
        contextTokens: 90_000,
        pricing: {
          kind: 'priced',
          card: {
            input: 1,
            cachedInput: 0.1,
            output: 2,
            source: 'user',
            longContextTier: { fromTokens: 80_000, input: 2, output: 4 },
          },
        },
      }),
    )
    expect(decision?.writeReadRatio).toBe(10)
  })

  it.each([
    { summaryInputTokens: 90_000, debt: 0.4228 },
    { summaryInputTokens: 60_000, debt: 0.1748 },
  ])(
    'prices the retained write and $summaryInputTokens-token summary at their own tiers',
    ({ summaryInputTokens, debt }) => {
      const model = registered(120)
      const decision = model.decide(
        input({
          windowTokens: 150_000,
          contextTokens: 90_000,
          summaryInputTokens,
          summaryRequests: 2,
          cachedTokens: 0,
          pricing: {
            kind: 'priced',
            card: {
              input: 0.000001,
              cachedInput: 0.0000001,
              output: 0.000002,
              source: 'user',
              longContextTier: { fromTokens: 80_000, input: 0.000002, output: 0.000004 },
            },
          },
        }),
      )
      expect(decision?.reason).toBe('cost')
      expect(decision?.newDebt).toBeCloseTo(debt)
      expect(decision?.breakEvenRequests).toBeCloseTo(debt / 0.0038)
      expect(decision?.writeReadRatio).toBe(10)
    },
  )

  it.each([NaN, Infinity, -1])('refuses malformed counts %s', (count) => {
    expect(registered().decide(input({ removableTokens: count }), true)).toBeUndefined()
  })
})

const goldenFileSchema = z.object({ scenario: z.string(), requests: z.array(z.string()) })
const goldenSummaryBodySchema = z.object({
  instructions: z.string(),
  tools: z.array(recordedFunctionToolSchema),
  input: z.array(
    z.object({
      type: z.literal('message'),
      role: z.enum(['user', 'assistant', 'developer']),
      content: z.array(
        z.union([
          z.object({ type: z.literal('input_text'), text: z.string() }),
          z.object({ type: z.literal('output_text'), text: z.string() }),
        ]),
      ),
    }),
  ),
})

/**
The recorded manual-compaction summary request
(`test/fixtures/golden-requests/05-manual-compaction.json`, request 1 of
the M91-G harness capture), parsed into the send path's own part shapes,
so the budget tests measure the same input the request builder does.
*/
function recordedSummaryInputTokens(): number {
  const golden = goldenFileSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../fixtures/golden-requests/05-manual-compaction.json', import.meta.url),
        'utf8',
      ),
    ),
  )
  const body = goldenSummaryBodySchema.parse(JSON.parse(golden.requests[1] ?? ''))
  return estimateInput(requestParts(body), undefined).inputTokens
}

describe('compaction summary output budget (R2, Pi v1.4.0)', () => {
  it('gives a reasoning model its own output limit, above the legacy cap', () => {
    const policy = modelPolicyFor('muse-spark-1.3-contributor')
    expect(policy.reasoning.supported).toEqual({ state: 'yes', value: true })
    expect(policy.output.maxTokens).toBe(131_072)
    const summaryInputTokens = recordedSummaryInputTokens()
    expect(summaryInputTokens).toBe(11_048)
    const budget = compactionSummaryBudget({
      policy,
      windowTokens: MODEL_API_CONTEXT_WINDOW,
      summaryInputTokens,
    })
    expect(budget).toBe(131_072)
    expect(budget).toBeGreaterThan(COMPACTION_SUMMARY_MAX_TOKENS)
    expect(summaryInputTokens + budget).toBeLessThanOrEqual(MODEL_API_CONTEXT_WINDOW)
  })

  it('clamps a small-window record so summary input plus output fit instead of overflowing', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'compactcap-'))
    const configFile = path.join(directory, 'providers.json')
    const catalogFile = path.join(directory, 'catalog.json')
    writeFileSync(
      configFile,
      JSON.stringify({
        v: PROVIDERS_FILE_VERSION,
        providers: [
          {
            id: 'compact',
            preset: 'custom',
            address: 'https://8.8.8.8/v1',
            auth: 'none',
            format: 'responses',
            models: ['small'],
            modelLimits: { small: { contextTokens: 32_768, outputTokens: 24_576 } },
            modelCapabilities: {
              small: { tools: { calling: { state: 'yes', value: true } } },
            },
          },
        ],
      }),
    )
    writeFileSync(catalogFile, JSON.stringify({ providers: {} }))
    const services = createConfiguredProviderServices(undefined, {
      configFile,
      catalogFile,
      secrets: { get: () => Promise.resolve(undefined) },
      send: () => Promise.reject(new Error('the budget test sends no request')),
    })
    const registry = services.registry
    if (registry.list === undefined) throw new TypeError('Expected a listing registry')
    await registry.list()
    const resolved = await registry.resolve('compact/small')
    expect(resolved.policy.output.maxTokens).toBe(24_576)
    const windowTokens = resolved.contextTokens
    if (windowTokens === undefined) throw new TypeError('Expected the record window')
    expect(windowTokens).toBe(32_768)
    const summaryInputTokens = recordedSummaryInputTokens()
    const budget = compactionSummaryBudget({
      policy: resolved.policy,
      windowTokens,
      summaryInputTokens,
    })
    // The record's own 24,576-token output limit would overflow the 32,768
    // window on top of the recorded input; the clamp fits exactly.
    expect(budget).toBe(windowTokens - summaryInputTokens)
    expect(budget).toBeLessThan(resolved.policy.output.maxTokens ?? 0)
    expect(summaryInputTokens + budget).toBe(windowTokens)
  })

  it('keeps the legacy cap only where the record states no output limit', () => {
    const policy = modelPolicyFor('compact/unlisted-limits')
    expect(policy.output.maxTokens).toBeUndefined()
    const summaryInputTokens = recordedSummaryInputTokens()
    const budget = compactionSummaryBudget({
      policy,
      windowTokens: MODEL_API_CONTEXT_WINDOW,
      summaryInputTokens,
    })
    expect(budget).toBe(COMPACTION_SUMMARY_MAX_TOKENS)
    expect(summaryInputTokens + budget).toBeLessThanOrEqual(MODEL_API_CONTEXT_WINDOW)
  })
})
