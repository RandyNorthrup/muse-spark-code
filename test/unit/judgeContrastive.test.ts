import { describe, expect, it, vi } from 'vitest'
import { contrastiveJudge, type JudgeContrastiveOptions } from '../../src/core/judge/contrastive'
import {
  runTechniqueCall,
  techniqueProbabilities,
  techniqueResult,
} from '../../src/core/judge/sampling'
import type { JudgeRequest, JevAnswer } from '../../src/core/judge/schema'
import { JUDGE_QUESTION_MAX } from '../../src/shared/constants'
import { deferred, fixtureResult, samplingRequest, techniqueFixture } from './judgeSamplingFixtures'

const options: JudgeContrastiveOptions = {
  inverses: {
    risk: {
      type: 'noul',
      instructions: 'Is it free of destructive changes?',
      criteria: { true: 'cannot destroy', false: 'can destroy' },
    },
  },
  maxOutputTokens: 100,
}
const signal = (): AbortSignal => new AbortController().signal

describe('one-call judge contrastive framing', () => {
  it('sends one paired request with intact state and combines mean(p, 1−inverse)', async () => {
    const fixture = techniqueFixture('contrastive')
    fixture.state.answers = [0.8, 0.4]
    const outcome = await contrastiveJudge(samplingRequest, options, fixture.deps, signal())
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: {
        answers: { risk: { noul: 0.7 } },
        muse: {
          risk: {
            technique: 'contrastive',
            label: 'uncalibrated',
            partial: false,
            reservedCostUsd: 0.0001,
            settledCostUsd: 0.00005,
          },
        },
        usage: { input_tokens: 40, output_tokens: 1 },
      },
    })
    expect(fixture.onDispatch).toHaveBeenCalledTimes(1)
    expect(fixture.deps.admission.run).toHaveBeenCalledTimes(1)
    expect(fixture.claims).toHaveLength(1)
    const sent = fixture.onDispatch.mock.calls[0]![0]
    expect(sent.state).toEqual(samplingRequest.state)
    expect(Object.values(sent.questions)).toEqual([
      samplingRequest.questions['risk'],
      options.inverses['risk'],
    ])
    expect(Object.keys(sent.questions)).toEqual(['0', '1'])
    expect(sent.questions).not.toHaveProperty('risk')
    if (outcome.outcome === 'answered')
      expect(outcome.result.muse['risk']?.confidence).toBeCloseTo(0.1187091)
  })

  it('aligns multiple pairs without response order dependence or sequential conditioning', async () => {
    const fixture = techniqueFixture('contrastive')
    fixture.state.answers = [0.8, 0.4, 0.2, 0.8]
    const request: JudgeRequest = {
      ...samplingRequest,
      questions: {
        '1': samplingRequest.questions['risk']!,
        '0': { type: 'noul', instructions: 'A second question?' },
      },
    }
    const inverses = {
      '1': options.inverses['risk']!,
      '0': { type: 'noul', instructions: 'A second inverse?' },
    } satisfies JudgeRequest['questions']
    fixture.onDispatch.mockImplementation(async (sent) => {
      await Promise.resolve()
      const result = fixtureResult(sent, fixture.state.answers)
      result.answers = Object.fromEntries(Object.entries(result.answers).toReversed())
      return { outcome: 'answered', result }
    })
    const outcome = await contrastiveJudge(
      request,
      { ...options, inverses },
      fixture.deps,
      signal(),
    )
    expect(outcome).toMatchObject({
      outcome: 'answered',
      result: { answers: { '0': { noul: 0.7 }, '1': { noul: expect.closeTo(0.2) } } },
    })
    expect(fixture.onDispatch).toHaveBeenCalledTimes(1)
    expect(samplingRequest.questions['risk']?.instructions).toBe('Can it destroy data?')
  })

  it('requires exact adoption evidence and a captured stated path', async () => {
    const fixture = techniqueFixture('contrastive')
    expect(
      await contrastiveJudge(
        samplingRequest,
        options,
        { ...fixture.deps, measurement: undefined },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'source-untested' })
    expect(
      await contrastiveJudge(
        samplingRequest,
        options,
        { ...fixture.deps, capability: { ...fixture.deps.capability, stated: false } },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })

  it('refuses missing/extra inverses and non-binary framings rather than guessing an inverse', async () => {
    const fixture = techniqueFixture('contrastive')
    for (const inverses of [{}, { ...options.inverses, extra: options.inverses['risk']! }]) {
      expect(
        await contrastiveJudge(samplingRequest, { ...options, inverses }, fixture.deps, signal()),
      ).toHaveProperty('outcome', 'no-answer')
    }
    expect(
      await contrastiveJudge(
        samplingRequest,
        { ...options, inverses: { wrong: options.inverses['risk']! } },
        fixture.deps,
        signal(),
      ),
    ).toHaveProperty('outcome', 'no-answer')
    const choice = { type: 'choice', instructions: 'Pick', criteria: { A: 'a', B: 'b' } } as const
    expect(
      await contrastiveJudge(
        { ...samplingRequest, questions: { risk: choice } },
        options,
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
    expect(
      await contrastiveJudge(
        samplingRequest,
        { ...options, inverses: { risk: choice } },
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
    expect(fixture.claims).toHaveLength(0)
  })

  it('preflights the entire paired request including output, provider minimum and body cap', async () => {
    const fixture = techniqueFixture('contrastive')
    const deps = {
      ...fixture.deps,
      capability: { ...fixture.deps.capability, minOutputTokens: 16, contextWindowTokens: 56 },
    }
    expect(
      await contrastiveJudge(samplingRequest, { ...options, maxOutputTokens: 1 }, deps, signal()),
    ).toHaveProperty('outcome', 'answered')
    expect(fixture.deps.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ state: samplingRequest.state }),
      'contrastive',
      16,
    )
    fixture.state.inputTokens = 41
    expect(
      await contrastiveJudge(samplingRequest, { ...options, maxOutputTokens: 1 }, deps, signal()),
    ).toEqual({ outcome: 'no-answer', reason: 'over-context' })
    const request = { ...samplingRequest, state: 's'.repeat(60_000) }
    expect(
      await contrastiveJudge(
        request,
        { ...options, inverses: { risk: { type: 'noul', instructions: 'i'.repeat(6000) } } },
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'over-context' })
  })

  it('refuses excess pairs instead of splitting the state or making multiple calls', async () => {
    const fixture = techniqueFixture('contrastive')
    const questions = Object.fromEntries(
      Array.from({ length: JUDGE_QUESTION_MAX / 2 + 1 }, (_, index) => [
        String(index),
        samplingRequest.questions['risk']!,
      ]),
    )
    expect(
      await contrastiveJudge(
        { ...samplingRequest, questions },
        { ...options, inverses: questions },
        fixture.deps,
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'over-context' })
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })

  it('never bypasses consent, unpriced/budget refusal, or cancellation while admission waits', async () => {
    const fixture = techniqueFixture('contrastive')
    fixture.state.consent = false
    expect(await contrastiveJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'consent-declined',
    })
    fixture.state.consent = true
    fixture.state.budget = 0
    expect(await contrastiveJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'over-budget',
    })
    fixture.state.price = NaN
    expect(await contrastiveJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'unpriced',
    })
    fixture.state.price = 0.0001
    fixture.state.budget = 1
    const gate = deferred()
    fixture.beforeAdmission.mockImplementation(() => gate.promise)
    const controller = new AbortController()
    const pending = contrastiveJudge(samplingRequest, options, fixture.deps, controller.signal)
    controller.abort()
    gate.resolve()
    expect(await pending).toEqual({ outcome: 'no-answer', reason: 'cancelled' })
    expect(fixture.claims).toHaveLength(0)
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })

  it('drops late cancelled output while preserving the actual settlement', async () => {
    const fixture = techniqueFixture('contrastive')
    const gate = deferred()
    fixture.onDispatch.mockImplementation(async () => {
      await gate.promise
      return undefined
    })
    const controller = new AbortController()
    const pending = contrastiveJudge(samplingRequest, options, fixture.deps, controller.signal)
    await vi.waitFor(() => {
      expect(fixture.claims).toHaveLength(1)
    })
    controller.abort()
    gate.resolve()
    expect(await pending).toEqual({ outcome: 'no-answer', reason: 'cancelled' })
    expect(fixture.claims[0]?.settled).toBe(0.00005)
  })

  it('retains uncertain charges on timeout without an automatic second POST', async () => {
    const fixture = techniqueFixture('contrastive')
    fixture.onDispatch.mockResolvedValueOnce({ outcome: 'no-answer', reason: 'timeout' })
    expect(await contrastiveJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
      outcome: 'no-answer',
      reason: 'timeout',
    })
    expect(fixture.onDispatch).toHaveBeenCalledTimes(1)
    expect(fixture.claims[0]?.uncertain).toBe(0.0001)
  })

  it('rejects mismatched pairs, partial/top-1, source/model switches and invalid distributions', async () => {
    const paired: JudgeRequest = {
      ...samplingRequest,
      questions: { '0': samplingRequest.questions['risk']!, '1': options.inverses['risk']! },
    }
    const mutations = [
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['extra'] = result.answers['0']!
        result.muse['extra'] = result.muse['0']!
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.model = 'another'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        delete result.answers['1']
        delete result.muse['1']
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['wrong'] = result.answers['1']!
        result.muse['wrong'] = result.muse['1']!
        delete result.answers['1']
        delete result.muse['1']
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['1']!.partial = true
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['1']!.model = 'another'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['1']!.source = 'separate'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.muse['1']!.technique = 'top1'
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['1'] = { type: 'noul', noul: 0.4, probabilities: { true: 0.4, false: 0.4 } }
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['1'] = { type: 'noul', noul: 0.9, probabilities: { true: 0.4, false: 0.6 } }
      },
      (result: ReturnType<typeof fixtureResult>) => {
        result.answers['1'] = {
          type: 'score',
          score: 0,
          confidence: 1,
          probabilities: { '0': 1, '1': 0 },
          legend: { '0': 'a', '1': 'b' },
        }
      },
    ]
    for (const mutate of mutations) {
      const fixture = techniqueFixture('contrastive')
      const result = fixtureResult(paired, [0.8, 0.4])
      mutate(result)
      fixture.onDispatch.mockResolvedValueOnce({ outcome: 'answered', result })
      expect(await contrastiveJudge(samplingRequest, options, fixture.deps, signal())).toEqual({
        outcome: 'no-answer',
        reason: 'engine-failure',
      })
    }
  })

  it('refuses invalid input/output allowance and thrown preparation/admission failures', async () => {
    const fixture = techniqueFixture('contrastive')
    for (const maxOutputTokens of [0, -1, NaN, Infinity, 1.5]) {
      expect(
        await contrastiveJudge(
          samplingRequest,
          { ...options, maxOutputTokens },
          fixture.deps,
          signal(),
        ),
      ).toHaveProperty('outcome', 'no-answer')
    }
    expect(
      await contrastiveJudge(
        { ...samplingRequest, questions: {} },
        options,
        fixture.deps,
        signal(),
      ),
    ).toHaveProperty('outcome', 'no-answer')
    expect(
      await contrastiveJudge(
        samplingRequest,
        options,
        {
          ...fixture.deps,
          prepare: () => {
            throw new Error('failed preparation')
          },
        },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    expect(
      await contrastiveJudge(
        samplingRequest,
        options,
        { ...fixture.deps, admission: { run: () => Promise.reject(new Error('failed ledger')) } },
        signal(),
      ),
    ).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    expect(fixture.onDispatch).not.toHaveBeenCalled()
  })
})

describe('technique distribution validation', () => {
  it('rejects wrong alternatives, out-of-range/nonfinite masses and incorrect choice/score summaries', () => {
    const question = { type: 'choice', instructions: 'Pick', criteria: { A: 'a', B: 'b' } } as const
    const valid: JevAnswer = {
      type: 'choice',
      choice: 'A',
      confidence: 1,
      probabilities: { A: 1, B: 0 },
    }
    expect(techniqueProbabilities(question, valid)).toEqual([1, 0])
    for (const probabilities of [
      { A: 1 },
      { A: 1, C: 0 },
      { A: 1, B: 0, C: 0 },
      { A: -0.1, B: 1.1 },
      { A: NaN, B: 0 },
      { A: Infinity, B: 0 },
      { A: 0.4, B: 0.4 },
    ]) {
      expect(techniqueProbabilities(question, { ...valid, probabilities })).toBeUndefined()
    }
    expect(techniqueProbabilities(question, { ...valid, choice: 'B' })).toBeUndefined()
    expect(
      techniqueProbabilities(question, {
        type: 'score',
        score: 0,
        confidence: 1,
        probabilities: { A: 1, B: 0 },
        legend: { A: 'a', B: 'b' },
      }),
    ).toBeUndefined()
    expect(
      techniqueProbabilities(samplingRequest.questions['risk']!, {
        type: 'noul',
        noul: -0.1,
        probabilities: { true: -0.1, false: 1.1 },
      }),
    ).toBeUndefined()
    const score = { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] } as const
    expect(
      techniqueProbabilities(
        { ...score, criteria: [...score.criteria] },
        {
          type: 'score',
          score: 0,
          confidence: 1,
          probabilities: { '0': 0, '1': 1 },
          legend: { '0': 'a', '1': 'b' },
        },
      ),
    ).toBeUndefined()
  })

  it('parses the full receipt before returning to either technique', async () => {
    const fixture = techniqueFixture('contrastive')
    const call = fixture.deps.prepare(samplingRequest, 'contrastive', 100)
    for (const field of ['reservedCostUsd', 'settledCostUsd', 'uncertainCostUsd']) {
      for (const value of [-1, NaN, Infinity]) {
        const deps = {
          ...fixture.deps,
          admission: {
            run: () =>
              Promise.resolve({
                outcome: {
                  outcome: 'answered',
                  result: fixtureResult(samplingRequest, [1]),
                } as const,
                reservedCostUsd: 0.0001,
                settledCostUsd: 0.00005,
                uncertainCostUsd: 0,
                [field]: value,
              }),
          },
        }
        await expect(runTechniqueCall(call, signal(), deps)).rejects.toThrow()
      }
    }
  })

  it('pre-cancelled calls never enter admission and missing distributions are no answer', async () => {
    const fixture = techniqueFixture('contrastive')
    const controller = new AbortController()
    controller.abort()
    const call = fixture.deps.prepare(samplingRequest, 'contrastive', 100)
    expect(await runTechniqueCall(call, controller.signal, fixture.deps)).toMatchObject({
      outcome: { outcome: 'no-answer', reason: 'cancelled' },
      reservedCostUsd: 0,
    })
    expect(fixture.deps.admission.run).not.toHaveBeenCalled()
    expect(techniqueResult(samplingRequest, new Map(), 'contrastive', fixture.deps, [])).toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
  })
})
