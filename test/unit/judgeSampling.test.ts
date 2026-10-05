import { describe, expect, it, vi } from 'vitest'
import { sampleJudge, type JudgeSamplingOptions } from '../../src/core/judge/sampling'
import type { JudgeOutcome, JudgeRequest } from '../../src/core/judge/schema'
import {
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_QUESTION_MAX,
  JUDGE_SAMPLING_MAX_USD_PER_QUESTION,
} from '../../src/shared/constants'
import { deferred, fixtureResult, samplingRequest, techniqueFixture } from './judgeSamplingFixtures'

const options: JudgeSamplingOptions = {
  optedIn: true,
  sampleCount: 4,
  maxAttemptsPerSample: 1,
  cold: false,
  highStakes: false,
}
const signal = (): AbortSignal => new AbortController().signal

describe('judge sampling', () => {
  it('stays opt-in even for high-stakes families and refuses missing adoption evidence', async () => {
    const fixture = techniqueFixture()
    expect(
      await sampleJudge(
        samplingRequest,
        { ...options, optedIn: false, highStakes: true },
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'explicit-off' })
    expect(
      await sampleJudge(
        samplingRequest,
        options,
        { ...fixture.deps, measurement: undefined },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'source-untested' })
    expect(
      await sampleJudge(
        samplingRequest,
        options,
        {
          ...fixture.deps,
          measurement: {
            ...fixture.deps.measurement!,
            identity: { ...fixture.deps.measurement!.identity, fitVersion: '' },
          },
        },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'profile-mismatch' })
    expect(fixture.deps.prepare).not.toHaveBeenCalled()
    expect(fixture.claims).toHaveLength(0)
  })

  it('binds adoption to capture, source, model, version, endpoint, family and framing', async () => {
    const fixture = techniqueFixture()
    const measurement = fixture.deps.measurement!
    for (const field of [
      'source',
      'providerId',
      'model',
      'modelVersion',
      'endpoint',
      'technique',
      'family',
      'promptVersion',
      'criteriaVersion',
    ]) {
      const changed = new Map([
        ['source', 'separate'],
        ['technique', 'stated'],
      ])
      const identity = {
        ...measurement.identity,
        [field]: changed.get(field) ?? 'changed',
      }
      expect(
        await sampleJudge(
          samplingRequest,
          options,
          { ...fixture.deps, measurement: { ...measurement, identity } },
          signal(),
        ),
      ).toEqual({ outcome: 'no-answer', reason: 'profile-mismatch' })
    }
    expect(
      await sampleJudge(
        samplingRequest,
        options,
        { ...fixture.deps, measurement: { ...measurement, captureId: 'changed' } },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'profile-mismatch' })
    expect(
      await sampleJudge(
        samplingRequest,
        options,
        { ...fixture.deps, measurement: { ...measurement, receiptId: '' } },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'source-untested' })
    expect(
      await sampleJudge(
        { ...samplingRequest, model: 'another-model' },
        options,
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
    expect(fixture.claims).toHaveLength(0)
  })

  it('never samples a reasoning-forced Muse Spark, including the high-stakes exception', async () => {
    const fixture = techniqueFixture()
    const capability = { ...fixture.deps.capability, reasoningForced: true }
    expect(
      await sampleJudge(
        samplingRequest,
        { ...options, highStakes: true },
        { ...fixture.deps, capability },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })

  it('requires captured cache capability unless explicitly high-stakes', async () => {
    const fixture = techniqueFixture()
    const deps = { ...fixture.deps, capability: { ...fixture.deps.capability, cache: false } }
    expect(await sampleJudge(samplingRequest, options, deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(
      await sampleJudge(samplingRequest, { ...options, highStakes: true }, deps, signal()),
    ).toHaveProperty('outcome', 'answered')
    const invalid = { ...deps, capability: { ...deps.capability, captureId: '' } }
    expect(await sampleJudge(samplingRequest, options, invalid, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
  })

  it('bounds sample and retry fan-out and rejects malformed requests', async () => {
    const fixture = techniqueFixture()
    for (const sampleCount of [0, 1, -1, 1.5, Infinity, JUDGE_QUESTION_MAX + 1]) {
      expect(
        await sampleJudge(samplingRequest, { ...options, sampleCount }, fixture.deps, signal()),
      ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    }
    for (const maxAttemptsPerSample of [0, -1, 1.5, Infinity, JUDGE_QUESTION_MAX + 1]) {
      expect(
        await sampleJudge(
          samplingRequest,
          { ...options, maxAttemptsPerSample },
          fixture.deps,
          signal(),
        ),
      ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    }
    expect(
      await sampleJudge({ ...samplingRequest, questions: {} }, options, fixture.deps, signal()),
    ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    expect(fixture.claims).toHaveLength(0)
  })

  it('reserves k uncached worst cases with independent parallel samples and empirical agreement', async () => {
    const fixture = techniqueFixture()
    const gate = deferred()
    fixture.onDispatch.mockImplementation(async (_request, _index) => {
      await gate.promise
      return undefined
    })
    const pending = sampleJudge(samplingRequest, options, fixture.deps, signal())
    await vi.waitFor(() => {
      expect(fixture.claims).toHaveLength(4)
    })
    expect(fixture.claims.map((claim) => claim.id)).toEqual([0, 1, 2, 3])
    expect(fixture.claims.every((claim) => claim.reserved === 0.0001)).toBe(true)
    gate.resolve()
    const outcome = await pending
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: {
        answers: { risk: { noul: 0.75 } },
        muse: {
          risk: {
            technique: 'sampling',
            label: 'uncalibrated',
            reservedCostUsd: 0.0004,
            settledCostUsd: 0.0002,
            uncertainCostUsd: 0,
            partial: false,
          },
        },
        usage: { input_tokens: 160, output_tokens: 4 },
      },
    })
    if (outcome.outcome === 'answered')
      expect(outcome.result.muse['risk']?.confidence).toBeCloseTo(0.1887218755)
    expect(fixture.onDispatch.mock.calls.map(([request]) => request)).toEqual(
      Array.from({ length: 4 }, () => samplingRequest),
    )
  })

  it('cold-writes the first of k samples before parallel reads, with no answer conditioning', async () => {
    const fixture = techniqueFixture()
    const gate = deferred()
    fixture.onDispatch.mockImplementationOnce(async () => {
      await gate.promise
      return undefined
    })
    const pending = sampleJudge(samplingRequest, { ...options, cold: true }, fixture.deps, signal())
    await vi.waitFor(() => {
      expect(fixture.onDispatch).toHaveBeenCalledTimes(1)
    })
    expect(fixture.claims).toHaveLength(1)
    gate.resolve()
    expect(await pending).toHaveProperty('outcome', 'answered')
    expect(fixture.claims).toHaveLength(4)
    expect(fixture.onDispatch.mock.calls.map(([request]) => request)).toEqual(
      Array.from({ length: 4 }, () => samplingRequest),
    )
    expect(fixture.state.cached).toBe(true)
  })

  it('uses the provider minimum output and the complete system/user overhead plus output allowance', async () => {
    const fixture = techniqueFixture()
    const deps = {
      ...fixture.deps,
      capability: { ...fixture.deps.capability, minOutputTokens: 16, contextWindowTokens: 56 },
    }
    expect(await sampleJudge(samplingRequest, options, deps, signal())).toHaveProperty(
      'outcome',
      'answered',
    )
    expect(fixture.deps.prepare).toHaveBeenCalledWith(samplingRequest, 'sampling', 16)
    fixture.state.inputTokens = 41
    expect(await sampleJudge(samplingRequest, options, deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'over-context',
    })
    fixture.state.inputTokens = JUDGE_MAX_STATE_TOKENS
    expect(await sampleJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'over-context',
    })
    expect(
      await sampleJudge(
        samplingRequest,
        options,
        {
          ...fixture.deps,
          capability: {
            ...fixture.deps.capability,
            contextWindowTokens: JUDGE_MAX_STATE_TOKENS * 2,
          },
        },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'over-context' })
  })

  it('never substitutes cached pricing at the per-question cost gate, including retries', async () => {
    const fixture = techniqueFixture()
    fixture.state.price = JUDGE_SAMPLING_MAX_USD_PER_QUESTION / 2
    expect(await sampleJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    fixture.state.price = JUDGE_SAMPLING_MAX_USD_PER_QUESTION / 4
    expect(await sampleJudge(samplingRequest, options, fixture.deps, signal())).toHaveProperty(
      'outcome',
      'answered',
    )
    expect(
      await sampleJudge(
        samplingRequest,
        { ...options, maxAttemptsPerSample: 2 },
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'over-budget' })
  })

  it('the high-stakes exception still requires consent and every budget claim', async () => {
    const fixture = techniqueFixture()
    fixture.state.price = 0.01
    fixture.state.consent = false
    expect(
      await sampleJudge(samplingRequest, { ...options, highStakes: true }, fixture.deps, signal()),
    ).toEqual({ outcome: 'no-answer', reason: 'consent-declined' })
    fixture.state.consent = true
    fixture.state.budget = 0.02
    expect(
      await sampleJudge(samplingRequest, { ...options, highStakes: true }, fixture.deps, signal()),
    ).toEqual({ outcome: 'no-answer', reason: 'over-budget' })
    expect(fixture.claims).toHaveLength(2)
    expect(fixture.onDispatch).toHaveBeenCalledTimes(2)
  })

  it('cache misses settle the full price without cancelling already admitted peers', async () => {
    const fixture = techniqueFixture()
    fixture.state.cacheMiss = true
    const result = await sampleJudge(samplingRequest, options, fixture.deps, signal())
    expect(result).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { reservedCostUsd: 0.0004, settledCostUsd: 0.0004 } } },
    })
  })

  it('retries get new claims and retain the timed-out attempt liability', async () => {
    const fixture = techniqueFixture()
    fixture.onDispatch.mockResolvedValueOnce({ outcome: 'no-answer', reason: 'timeout' })
    const outcome = await sampleJudge(
      samplingRequest,
      { ...options, sampleCount: 2, maxAttemptsPerSample: 2, cold: true },
      fixture.deps,
      signal(),
    )
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: { muse: { risk: { settledCostUsd: 0.0001, uncertainCostUsd: 0.0001 } } },
    })
    if (outcome.outcome === 'answered')
      expect(outcome.result.muse['risk']?.reservedCostUsd).toBeCloseTo(0.0003)
    expect(fixture.claims.map((claim) => claim.id)).toEqual([0, 1, 2])
    expect(fixture.claims[0]?.uncertain).toBe(0.0001)
  })

  it('cancellation after dispatch drops late answers but waits for all settlements', async () => {
    const fixture = techniqueFixture()
    const gate = deferred()
    const controller = new AbortController()
    fixture.onDispatch.mockImplementation(async () => {
      await gate.promise
      return undefined
    })
    const pending = sampleJudge(samplingRequest, options, fixture.deps, controller.signal)
    await vi.waitFor(() => {
      expect(fixture.claims).toHaveLength(4)
    })
    controller.abort()
    gate.resolve()
    expect(await pending).toEqual({ outcome: 'no-answer', reason: 'cancelled' })
    expect(fixture.claims.every((claim) => claim.settled > 0)).toBe(true)
    const count = fixture.claims.length
    expect(await sampleJudge(samplingRequest, options, fixture.deps, controller.signal)).toEqual({
      outcome: 'no-answer',
      reason: 'cancelled',
    })
    expect(fixture.claims).toHaveLength(count)
  })

  it('rebinds admission after a held consent wait and refunds a known non-send', async () => {
    const fixture = techniqueFixture()
    const gate = deferred()
    fixture.beforeAdmission.mockImplementation(() => gate.promise)
    const pending = sampleJudge(samplingRequest, options, fixture.deps, signal())
    fixture.state.current = false
    gate.resolve()
    expect(await pending).toEqual({ outcome: 'no-answer', reason: 'profile-mismatch' })
    expect(fixture.claims).toHaveLength(0)
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })

  it('does not turn failed or malformed samples into partial success', async () => {
    const mutations = [
      (result: ReturnType<typeof fixtureResult>) => {
        result.model = 'another'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['risk']!.partial = true
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['risk']!.model = 'another'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['risk']!.source = 'separate'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['risk']!.technique = 'top1'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers = {}
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['extra'] = result.answers['risk']!
        result.muse['extra'] = result.muse['risk']!
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['risk'] = {
          type: 'noul',
          noul: 0.7,
          probabilities: { true: 0.7, false: 0.3 },
        }
      },
    ]
    for (const mutate of mutations) {
      const fixture = techniqueFixture()
      const result = fixtureResult(samplingRequest, [1])
      mutate(result)
      fixture.onDispatch.mockResolvedValueOnce({ outcome: 'answered', result })
      expect(await sampleJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
        outcome: 'no-answer',
        reason: 'engine-failure',
      })
    }
    const fixture = techniqueFixture()
    fixture.onDispatch.mockResolvedValueOnce({ outcome: 'no-answer', reason: 'timeout' })
    expect(
      await sampleJudge(samplingRequest, { ...options, cold: true }, fixture.deps, signal()),
    ).toEqual({ outcome: 'no-answer', reason: 'timeout' })
    expect(fixture.claims).toHaveLength(1)
    expect(fixture.claims[0]?.uncertain).toBe(0.0001)
  })

  it('supports choice/score frequency distributions and exposes unseen alternatives as partial', async () => {
    const request: JudgeRequest = {
      ...samplingRequest,
      questions: {
        choice: { type: 'choice', instructions: 'Pick', criteria: { A: 'a', B: 'b', C: 'c' } },
        score: { type: 'score', instructions: 'Rate', criteria: ['low', 'medium', 'high'] },
      },
    }
    const fixture = techniqueFixture()
    fixture.state.answers = [0, 1, 1, 2, 2, 2, 2, 2]
    const outcome = await sampleJudge(request, options, fixture.deps, signal())
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: {
        answers: {
          choice: { choice: 'B', probabilities: { A: 0.25, B: 0.5, C: 0.25 } },
          score: { score: 2, probabilities: { '0': 0, '1': 0, '2': 1 } },
        },
        muse: { score: { partial: true } },
        usage: { input_tokens: 320 },
      },
    })
    expect(
      fixture.onDispatch.mock.calls.every(
        ([call]) => JSON.stringify(call.state) === JSON.stringify(request.state),
      ),
    ).toBe(true)
    expect(JSON.stringify(request)).not.toContain('sampling')
  })

  it('rejects invalid preparation and thrown failures without dispatch or empty success', async () => {
    for (const price of [-1, NaN, Infinity]) {
      const fixture = techniqueFixture()
      fixture.state.price = price
      expect(await sampleJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
        outcome: 'no-answer',
        reason: 'unpriced',
      })
      expect(fixture.claims).toHaveLength(0)
    }
    for (const inputTokens of [-1, NaN, Infinity, 1.5]) {
      const fixture = techniqueFixture()
      fixture.state.inputTokens = inputTokens
      expect(await sampleJudge(samplingRequest, options, fixture.deps, signal())).toHaveProperty(
        'outcome',
        'no-answer',
      )
    }
    const fixture = techniqueFixture()
    const wrongOutput = {
      ...fixture.deps,
      prepare: (...args: Parameters<typeof fixture.deps.prepare>) => ({
        ...fixture.deps.prepare(...args),
        maxOutputTokens: 2,
      }),
    }
    expect(await sampleJudge(samplingRequest, options, wrongOutput, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    const broken = {
      ...fixture.deps,
      prepare: () => {
        throw new Error('synthetic failure')
      },
    }
    expect(await sampleJudge(samplingRequest, options, broken, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    const failedAdmission = {
      ...fixture.deps,
      admission: { run: vi.fn(() => Promise.reject(new Error('ledger failure'))) },
    }
    expect(await sampleJudge(samplingRequest, options, failedAdmission, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })

  it('validates admission receipts and refuses invented successful accounting', async () => {
    const fixture = techniqueFixture()
    for (const field of ['reservedCostUsd', 'settledCostUsd', 'uncertainCostUsd']) {
      for (const value of [-1, NaN, Infinity]) {
        const admission = {
          run: () =>
            Promise.resolve({
              outcome: {
                outcome: 'answered',
                result: fixtureResult(samplingRequest, [1]),
              } satisfies JudgeOutcome,
              reservedCostUsd: 0.0001,
              settledCostUsd: 0.00005,
              uncertainCostUsd: 0,
              [field]: value,
            }),
        }
        expect(
          await sampleJudge(samplingRequest, options, { ...fixture.deps, admission }, signal()),
        ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
      }
    }
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })
})
