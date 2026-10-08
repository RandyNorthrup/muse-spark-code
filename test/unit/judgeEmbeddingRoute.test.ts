// Fast-path routing guards for the embedding shortcut (M98 phase 2, lane I).
// Fakes and synthetic fixtures only; no live, paid or local model calls.

import { describe, expect, it, vi } from 'vitest'
import {
  runEmbeddingJudge,
  type EmbeddingRouteDependencies,
  type EmbeddingSource,
} from '../../src/core/judge/embedding/route'
import { JUDGE_EMBED_FALLBACK_CONFIDENCE, REDACTED_MARK } from '../../src/shared/constants'
import type { JudgeOutcome, JudgeRequest } from '../../src/core/judge/schema'
import { embeddingHeadDigest } from '../../src/core/judge/embedding/schema'
import {
  abortingFallbackFixture,
  captureEmbedInputs,
  confidentVectors,
  noulRequest,
  routeDependencies,
  trainedHead,
} from './judgeEmbeddingFixtures'

const options = { optedIn: true, confidential: false }
const signal = (): AbortSignal => new AbortController().signal

/** The same state and instructions under one binary framing. */
function framed(criteria: { true: string; false: string }): JudgeRequest {
  return {
    state: noulRequest.state,
    questions: { risk: { type: 'noul', instructions: 'Can it destroy data?', criteria } },
  }
}

/**
 * A fallback answer after the embedding leg spent: 40 full-judge tokens
 * beside 12 embedding tokens, with the summed reserved and settled dollars.
 */
function expectMergedFallback(
  outcome: JudgeOutcome,
  reservedCostUsd: number,
  settledCostUsd: number,
): void {
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') throw new Error('expected fallback')
  expect(outcome.result.usage).toMatchObject({ input_tokens: 52, output_tokens: 1 })
  const meta = outcome.result.muse['risk']
  expect(meta?.reservedCostUsd).toBeCloseTo(reservedCostUsd)
  expect(meta?.settledCostUsd).toBeCloseTo(settledCostUsd)
  expect(meta?.uncertainCostUsd).toBe(0)
}

/** The full judge answered; the embedding leg spent nothing and ran nothing. */
async function expectQuietFallback(
  deps: EmbeddingRouteDependencies,
  fallbackCalls: JudgeRequest[],
  embed: ReturnType<typeof vi.fn>,
  claims: readonly unknown[],
): Promise<void> {
  const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') throw new Error('expected the full judge')
  expect(outcome.result.muse['risk']?.technique).toBe('stated')
  expect(fallbackCalls).toHaveLength(1)
  expect(embed).not.toHaveBeenCalled()
  expect(claims).toHaveLength(0)
}

describe('embedding fast path', () => {
  it('answers from the head with its own reservation when confident', async () => {
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      source: { embed: () => Promise.resolve(confidentVectors) },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected an answer')
    const meta = outcome.result.muse['risk']
    expect(meta?.technique).toBe('embedding')
    expect(meta?.label).toBe('uncalibrated')
    expect(meta?.partial).toBe(false)
    expect(meta?.confidence).toBeGreaterThanOrEqual(JUDGE_EMBED_FALLBACK_CONFIDENCE)
    expect(outcome.result.answers['risk']).toMatchObject({ type: 'noul' })
    expect(embed).toHaveBeenCalledTimes(1)
    expect(fallbackCalls).toHaveLength(0)
    expect(claims).toEqual([{ inputTokens: 12, uncachedCostUsd: 0.0002 }])
    expect(meta?.reservedCostUsd).toBe(0.0002)
  })

  it('refuses without an allowed full source and spends nothing', async () => {
    const { deps, claims, embed } = routeDependencies()
    const outcome = await runEmbeddingJudge(
      noulRequest,
      options,
      { ...deps, fallback: undefined },
      signal(),
    )
    expect(outcome).toEqual({ outcome: 'no-answer', reason: 'source-unavailable' })
    expect(embed).not.toHaveBeenCalled()
    expect(claims).toHaveLength(0)
  })

  it.each([
    ['model', { model: 'other-model' }],
    ['provider', { providerId: 'other-provider' }],
    ['family', { family: 'skill.fit' }],
  ])('falls back on a head bound to another %s without embedding', async (_case, changed) => {
    const head = trainedHead()
    // Re-digest so the head verifies: only the source binding may refuse it.
    const rebound = { ...head, identity: { ...head.identity, ...changed } }
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      head: { ...rebound, digest: embeddingHeadDigest(rebound) },
    })
    await expectQuietFallback(deps, fallbackCalls, embed, claims)
  })

  it.each([
    ['prompt', { promptVersion: 'prompt-2' }],
    ['criteria', { criteriaVersion: 'criteria-2' }],
    ['fit', { fitVersion: 'fit-2' }],
  ])(
    'falls back on a head from an obsolete %s version without embedding',
    async (_case, changed) => {
      // The head is current (prompt-1/criteria-1/fit-1); only the request's
      // newer versions may refuse it.
      const { deps, fallbackCalls, claims, embed } = routeDependencies({
        ...changed,
        source: { embed: () => Promise.resolve(confidentVectors) },
      })
      await expectQuietFallback(deps, fallbackCalls, embed, claims)
    },
  )

  it('falls back on a head whose dimension disagrees with its weights', async () => {
    const head = trainedHead()
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      head: { ...head, identity: { ...head.identity, dimension: 4 } },
    })
    await expectQuietFallback(deps, fallbackCalls, embed, claims)
  })

  it('falls back on corrupt weights without embedding', async () => {
    const head = trainedHead()
    const { deps, fallbackCalls, claims, embed } = routeDependencies({
      head: { ...head, bias: head.bias + 10 },
    })
    await expectQuietFallback(deps, fallbackCalls, embed, claims)
  })

  it('falls back below the confidence floor and reserves each leg separately', async () => {
    const { deps, fallbackCalls, fallbackClaims, claims, embed } = routeDependencies({
      source: { embed: () => Promise.resolve([[0.5, 0.5, 0.5]]) },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected fallback')
    expect(outcome.result.muse['risk']?.technique).toBe('stated')
    expect(embed).toHaveBeenCalledTimes(1)
    expect(fallbackCalls).toHaveLength(1)
    expect(claims).toEqual([{ inputTokens: 12, uncachedCostUsd: 0.0002 }])
    expect(fallbackClaims).toEqual([{ inputTokens: 40, uncachedCostUsd: 0.001 }])
  })

  it('falls back whole on a choice question the head cannot answer', async () => {
    const { deps, fallbackCalls, claims, embed } = routeDependencies()
    const choice = {
      state: noulRequest.state,
      questions: {
        pick: { type: 'choice', instructions: 'Pick one', criteria: { A: 'x', B: 'y' } },
      },
    } as const
    const outcome = await runEmbeddingJudge(choice, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    expect(claims).toHaveLength(0)
  })

  it('falls back when not opted in and when cancelled or malformed', async () => {
    const { deps, fallbackCalls, embed } = routeDependencies()
    expect(
      await runEmbeddingJudge(noulRequest, { ...options, optedIn: false }, deps, signal()),
    ).toMatchObject({ outcome: 'answered' })
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort()
    expect(await runEmbeddingJudge(noulRequest, options, deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(await runEmbeddingJudge({ questions: {} }, options, deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
  })

  it('falls back on a misbehaving embedding source', async () => {
    const { deps, fallbackCalls, embed } = routeDependencies({
      source: { embed: () => Promise.resolve([]) },
    })
    expect(await runEmbeddingJudge(noulRequest, options, deps, signal())).toMatchObject({
      outcome: 'answered',
    })
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('sends each binary question complete with its criteria', async () => {
    const { seen, embed } = captureEmbedInputs(confidentVectors)
    const { deps } = routeDependencies({
      source: { embed },
    })
    const forward = { true: 'the command destroys data', false: 'the command is safe' }
    const reversed = { true: 'the command is safe', false: 'the command destroys data' }
    for (const criteria of [forward, reversed]) {
      const outcome = await runEmbeddingJudge(framed(criteria), options, deps, signal())
      expect(outcome.outcome).toBe('answered')
    }
    expect(seen).toHaveLength(2)
    // Reversed meanings never share an embedding input.
    expect(seen[0]?.[0]).not.toBe(seen[1]?.[0])
    expect(JSON.parse(seen[0]?.[0] ?? '')).toMatchObject({ criteria: forward })
    expect(JSON.parse(seen[1]?.[0] ?? '')).toMatchObject({ criteria: reversed })
  })

  it('answers nothing when Stop aborts while admission waits', async () => {
    const controller = new AbortController()
    const { deps, fallbackCalls, embed } = routeDependencies({
      admission: {
        run: vi.fn(() => {
          controller.abort()
          return Promise.resolve({
            reservedCostUsd: 0.0002,
            settledCostUsd: 0.0002,
            uncertainCostUsd: 0,
          })
        }),
      },
    })
    expect(await runEmbeddingJudge(noulRequest, options, deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(embed).not.toHaveBeenCalled()
    expect(fallbackCalls).toHaveLength(0)
  })

  it('answers nothing when Stop aborts while embedding waits', async () => {
    const controller = new AbortController()
    const { deps, fallbackCalls } = routeDependencies({
      source: {
        embed: () => {
          controller.abort()
          return Promise.resolve(confidentVectors)
        },
      },
    })
    expect(await runEmbeddingJudge(noulRequest, options, deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(fallbackCalls).toHaveLength(0)
  })

  it('answers nothing when Stop aborts while the pre-embedding fallback waits', async () => {
    for (const shape of ['opted-out', 'mismatched-head'] as const) {
      const controller = new AbortController()
      const { calls, fallback } = abortingFallbackFixture(controller)
      const { deps, claims, embed } = routeDependencies({
        ...(shape === 'mismatched-head' && {
          head: { ...trainedHead(), digest: '0'.repeat(64) },
        }),
        fallback,
      })
      const runOptions = shape === 'opted-out' ? { ...options, optedIn: false } : options
      expect(await runEmbeddingJudge(noulRequest, runOptions, deps, controller.signal)).toEqual({
        outcome: 'no-answer',
        reason: 'cancelled',
      })
      // The late stated answer never publishes, and the embedding leg never ran.
      expect(calls).toHaveLength(1)
      expect(embed).not.toHaveBeenCalled()
      expect(claims).toHaveLength(0)
    }
  })

  it('answers nothing when Stop aborts while the fallback leg waits', async () => {
    const controller = new AbortController()
    const { calls, fallback } = abortingFallbackFixture(controller)
    const { deps, claims, embed } = routeDependencies({
      source: { embed: () => Promise.resolve([[0.5, 0.5, 0.5]]) },
      fallback,
    })
    expect(await runEmbeddingJudge(noulRequest, options, deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    // The late stated answer never publishes, but the legs it really spent
    // stay reserved on the ledger.
    expect(calls).toHaveLength(1)
    expect(embed).toHaveBeenCalledTimes(1)
    expect(claims).toEqual([{ inputTokens: 12, uncachedCostUsd: 0.0002 }])
  })

  it('redacts named secrets in state, instructions and criteria before embedding', async () => {
    const { seen, embed } = captureEmbedInputs(confidentVectors)
    const { deps } = routeDependencies({
      source: { embed },
    })
    const request: JudgeRequest = {
      state: { command: 'synthetic command', note: 'password=opaque-state' },
      questions: {
        risk: {
          type: 'noul',
          instructions: 'check api_key=opaque-instructions before answering',
          criteria: { true: 'runs client_secret=opaque-true', false: 'the command is safe' },
        },
      },
    }
    const outcome = await runEmbeddingJudge(request, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    expect(seen).toHaveLength(1)
    const inputs = seen[0] ?? []
    for (const input of inputs) {
      expect(input).not.toContain('opaque-')
      expect(input).toContain(REDACTED_MARK)
    }
  })

  it('falls back to the full judge when the embedding call rejects', async () => {
    const { deps, fallbackCalls, embed } = routeDependencies({
      source: { embed: () => Promise.reject(new Error('fixture network failure')) },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected the full judge')
    expect(outcome.result.muse['risk']?.technique).toBe('stated')
    expect(embed).toHaveBeenCalledTimes(1)
    expect(fallbackCalls).toHaveLength(1)
  })

  it('refuses without fallback when admission rejects', async () => {
    const { deps, fallbackCalls, embed } = routeDependencies({
      admission: { run: () => Promise.reject(new Error('fixture over budget')) },
    })
    expect(await runEmbeddingJudge(noulRequest, options, deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(embed).not.toHaveBeenCalled()
    expect(fallbackCalls).toHaveLength(0)
  })

  it('keeps the embedding leg usage and cost in a fallback answer', async () => {
    const { deps, embed } = routeDependencies({
      source: { embed: () => Promise.resolve([[0.5, 0.5, 0.5]]) },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    // The fixture fallback carries no cost; the embedding leg reserved $0.0002.
    expectMergedFallback(outcome, 0.0002, 0.0002)
    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('adds both legs when the fallback reports its own cost', async () => {
    const { deps } = routeDependencies({
      source: { embed: () => Promise.resolve([[0.5, 0.5, 0.5]]) },
      fallbackCosts: { reservedCostUsd: 0.001, settledCostUsd: 0.001, uncertainCostUsd: 0 },
    })
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    // $0.001 of fallback beside $0.0002 of embedding leg.
    expectMergedFallback(outcome, 0.0012, 0.0012)
  })
})

describe('embedding pipeline regressions', () => {
  it.each([
    ['quoted', (name: string) => `password="opaque-${name}"`],
    ['escaped', (name: string) => String.raw`api_key="opaque-${name}\"tail"`],
    ['multiline', (name: string) => `client_secret="opaque-${name}\nopaque-tail"`],
    ['escaped delimiters', (name: string) => String.raw`password=\"opaque-${name}\"`],
    [
      'private key',
      (name: string) =>
        `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\nopaque-${name}\n${['-----END', 'PRIVATE KEY-----'].join(' ')}`,
    ],
  ])('redacts %s secrets in every structured field (RVM98P2IC 1)', async (_name, text) => {
    const { seen, embed } = captureEmbedInputs(confidentVectors)
    const { deps } = routeDependencies({ source: { embed } })
    const request: JudgeRequest = {
      state: {
        note: text('state'),
        nested: [text('array'), { [text('key')]: text('nested') }],
        password: 'opaque-property',
        safe: 'public context',
      },
      questions: {
        risk: {
          type: 'noul',
          instructions: text('instructions'),
          criteria: { true: text('true'), false: text('false') },
        },
      },
    }
    const original = JSON.stringify(request)
    expect(await runEmbeddingJudge(request, options, deps, signal())).toMatchObject({
      outcome: 'answered',
    })
    expect(seen).toHaveLength(1)
    const payload = seen[0]?.[0] ?? ''
    expect(payload).not.toContain('opaque-')
    expect(payload).toContain(REDACTED_MARK)
    expect(JSON.parse(payload)).toMatchObject({ state: { safe: 'public context' } })
    expect(JSON.stringify(request)).toBe(original)
  })

  it.each([
    ['null batch', null],
    ['object batch', { length: 1, 0: [2, -1, 0.5] }],
    ['string batch', 'x'],
    ['null vector', [null]],
    ['object vector', [{ length: 3, 0: 2, 1: -1, 2: 0.5 }]],
    ['wrong dimension', [[2, -1]]],
    [
      'wrong count',
      [
        [2, -1, 0.5],
        [2, -1, 0.5],
      ],
    ],
    ['NaN', [[2, NaN, 0.5]]],
    ['infinite', [[2, Infinity, 0.5]]],
    ['null component', [[2, null, 0.5]]],
    ['missing component', [[2, undefined, 0.5]]],
    ['sparse component', [Object.assign(Array.from({ length: 3 }), { 0: 2, 2: 0.5 })]],
    ['string component', [[2, '-1', 0.5]]],
  ])('falls back on %s source output (RVM98P2IC 2–3)', async (_name, output) => {
    const { deps, claims, fallbackCalls } = routeDependencies({
      fallbackCosts: { reservedCostUsd: 0.001, settledCostUsd: 0.001 },
    })
    // An untyped, misbehaving implementation must cross the runtime boundary.
    Reflect.set(deps.source, 'embed', () => Promise.resolve(output))
    const outcome = await runEmbeddingJudge(noulRequest, options, deps, signal())
    expectMergedFallback(outcome, 0.0012, 0.0012)
    if (outcome.outcome !== 'answered') throw new Error('expected fallback')
    expect(outcome.result.muse['risk']?.technique).toBe('stated')
    expect(fallbackCalls).toHaveLength(1)
    expect(claims).toHaveLength(1)
  })

  it.each(['opted-out', 'mismatched-head', 'low-confidence', 'embed-rejection'] as const)(
    'settles a rejected Stop on the %s delegate (RVM98P2IC 4)',
    async (path) => {
      const controller = new AbortController()
      const { deps, claims, embed, fallbackClaims } = routeDependencies({
        ...(path === 'mismatched-head' && { head: null }),
        source: {
          embed: () =>
            path === 'embed-rejection'
              ? Promise.reject(new Error('fixture embed rejection'))
              : Promise.resolve([[0.5, 0.5, 0.5]]),
        },
      })
      const fallback = deps.fallback
      if (fallback === undefined) throw new Error('expected fixture fallback')
      const run = vi.fn(async (request: JudgeRequest, waitSignal: AbortSignal) => {
        await fallback.run(request, waitSignal)
        controller.abort()
        throw new Error('fixture aborted rejection')
      })
      const runOptions = path === 'opted-out' ? { ...options, optedIn: false } : options
      const hasSpentEmbedding = path === 'low-confidence' || path === 'embed-rejection'
      expect(
        await runEmbeddingJudge(
          noulRequest,
          runOptions,
          { ...deps, fallback: { run } },
          controller.signal,
        ),
      ).toEqual({ outcome: 'no-answer', reason: 'cancelled' })
      expect(run).toHaveBeenCalledTimes(1)
      expect(embed).toHaveBeenCalledTimes(hasSpentEmbedding ? 1 : 0)
      expect(claims).toHaveLength(hasSpentEmbedding ? 1 : 0)
      expect(fallbackClaims).toEqual([{ inputTokens: 40, uncachedCostUsd: 0.001 }])
    },
  )

  it.each([
    ['admission', 'reject'],
    ['admission', 'throw'],
    ['embed', 'reject'],
    ['embed', 'throw'],
  ])('settles Stop during a %s %s without another leg', async (stage, failure) => {
    const controller = new AbortController()
    const { deps, claims, fallbackCalls, embed } = routeDependencies()
    const stop = () => {
      controller.abort()
      const error = new Error('fixture stopped step')
      if (failure === 'throw') throw error
      return Promise.reject(error)
    }
    if (stage === 'admission') Reflect.set(deps.admission, 'run', stop)
    else Reflect.set(deps.source, 'embed', vi.fn(stop))
    expect(await runEmbeddingJudge(noulRequest, options, deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(claims).toHaveLength(stage === 'embed' ? 1 : 0)
    if (stage === 'embed') expect(deps.source.embed).toHaveBeenCalledTimes(1)
    else expect(embed).not.toHaveBeenCalled()
    expect(fallbackCalls).toHaveLength(0)
  })

  it.each(['reject', 'throw', 'malformed'])(
    'settles a full-source %s as an explicit engine failure',
    async (failure) => {
      const { deps, claims, embed } = routeDependencies()
      const fallback = deps.fallback
      if (fallback === undefined) throw new Error('expected fixture fallback')
      Reflect.set(fallback, 'run', () => {
        if (failure === 'malformed') return Promise.resolve(null)
        const error = new Error('fixture full-source failure')
        if (failure === 'throw') throw error
        return Promise.reject(error)
      })
      expect(
        await runEmbeddingJudge(noulRequest, { ...options, optedIn: false }, deps, signal()),
      ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
      expect(claims).toHaveLength(0)
      expect(embed).not.toHaveBeenCalled()
    },
  )
})

describe('embedding confidentiality', () => {
  const confidentialOptions = { optedIn: true, confidential: true }

  /** The blocked leg defers to the full judge without spending or sending. */
  async function expectConfidentialFallback(source: Partial<EmbeddingSource>): Promise<void> {
    const { deps, fallbackCalls, claims, embed } = routeDependencies({ source })
    const outcome = await runEmbeddingJudge(noulRequest, confidentialOptions, deps, signal())
    expect(outcome.outcome).toBe('answered')
    expect(fallbackCalls).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    expect(claims).toHaveLength(0)
  }

  /** The permitted leg answers from the head; the full judge never runs. */
  async function expectConfidentialAnswer(source: Partial<EmbeddingSource>): Promise<void> {
    const { deps, fallbackCalls, embed } = routeDependencies({ source })
    const outcome = await runEmbeddingJudge(noulRequest, confidentialOptions, deps, signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') throw new Error('expected an answer')
    expect(outcome.result.muse['risk']?.technique).toBe('embedding')
    expect(fallbackCalls).toHaveLength(0)
    expect(embed).toHaveBeenCalledTimes(1)
  }

  it('never embeds remotely in a confidential workspace without provider permission', async () => {
    await expectConfidentialFallback({ locality: 'same-provider', providerPolicy: 'refuse' })
  })

  it('embeds remotely in a confidential workspace the provider policy permits', async () => {
    await expectConfidentialAnswer({
      locality: 'same-provider',
      providerPolicy: 'allow',
      embed: () => Promise.resolve(confidentVectors),
    })
  })

  it('never uses an unverified local endpoint in a confidential workspace', async () => {
    await expectConfidentialFallback({ locality: 'unverified-local' })
  })

  it('uses a verified local endpoint in a confidential workspace', async () => {
    await expectConfidentialAnswer({
      locality: 'verified-local',
      embed: () => Promise.resolve(confidentVectors),
    })
  })
})
