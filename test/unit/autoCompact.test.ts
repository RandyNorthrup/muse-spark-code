import { describe, expect, it } from 'vitest'
import {
  AutoCompact,
  measureAutoCompactRequest,
  type AutoCompactInput,
} from '../../src/core/backends/modelapi/autoCompact'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPack'
import type { InputItem } from '../../src/core/backends/modelapi/schemas'
import type { ModelPricing } from '../../src/core/providers/priceCard'

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

function registered() {
  const model = new AutoCompact()
  model.noteTodos([
    { text: 'one', status: 'inProgress' },
    { text: 'two', status: 'pending' },
  ])
  for (let count = 0; count < 100; count += 1) model.noteRequest()
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
        output: 'long output\n'.repeat(10_000),
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
    expect(decision?.writeReadRatio).toBe(20)
  })

  it.each([NaN, Infinity, -1])('refuses malformed counts %s', (count) => {
    expect(registered().decide(input({ removableTokens: count }), true)).toBeUndefined()
  })
})
