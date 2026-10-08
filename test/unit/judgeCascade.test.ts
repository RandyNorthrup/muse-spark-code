// Phase-2a cascade tests (lane A). Fake sides only: each side's `run`
// answers from fixed distributions with its own recorded costs, so every
// admission claim, fallback and blend is proved without a model call.
import { describe, expect, it, vi } from 'vitest'
import {
  shouldCascadeFollowUp,
  cascadeJudge,
  combineCascadeDistributions,
  type JudgeCascadeOptions,
  type JudgeCascadeSide,
} from '../../src/core/judge/cascade'
import type { CalibrationLimits, CalibrationProfile } from '../../src/core/judge/calibration/schema'
import { entropyConfidence } from '../../src/core/judge/math'
import type { JudgeTechniqueReceipt } from '../../src/core/judge/sampling'
import type {
  JudgeCapability,
  JudgeMuse,
  JudgeOutcome,
  JudgeRequest,
  JudgeResult,
  JevAnswer,
} from '../../src/core/judge/schema'
import { JUDGE_CASCADE_CONFIDENCE } from '../../src/shared/constants'

const limits: CalibrationLimits = {
  maxSamples: 500,
  maxIdentifierLength: 128,
  maxBins: 10,
  isotonicMinimumLabels: 200,
  probabilityEpsilon: 1e-9,
  maxIterations: 50,
  convergenceTolerance: 1e-6,
  regularization: 1e-3,
  weightFloor: 1e-3,
}

function capability(source: 'same' | 'separate', model: string): JudgeCapability {
  return {
    source,
    providerId: 'fixture-provider',
    model,
    modelVersion: 'v1',
    endpoint: 'https://fixture.invalid/v1',
    captureId: 'synthetic-cascade',
    logprobs: { kind: 'refused' },
    stated: true,
    systemone: false,
    reasoningForced: false,
    cache: true,
    contextWindowTokens: 32_000,
    minOutputTokens: 1,
  }
}

const sameCap = capability('same', 'fixture-same')
const separateCap = capability('separate', 'fixture-separate')

function partitionPart(tag: string) {
  return {
    ids: [`${tag}-id`],
    labels: [`${tag}-label`],
    tasks: [`${tag}-task`],
    repositories: [`${tag}-repo`],
  }
}

function profileFor(cap: JudgeCapability, fitVersion: string, weight: number): CalibrationProfile {
  return {
    version: 1,
    identity: {
      source: cap.source,
      providerId: cap.providerId,
      model: cap.model,
      modelVersion: cap.modelVersion,
      endpoint: cap.endpoint,
      technique: 'stated',
      family: 'risk.destructive',
      promptVersion: 'prompt-1',
      criteriaVersion: 'criteria-1',
      fitVersion,
    },
    evidence: 'independent',
    epsilon: 1e-9,
    fit: { method: 'platt', slope: 1, intercept: 0 },
    combinationWeight: weight,
    partitions: {
      fit: partitionPart('fit'),
      tuning: partitionPart('tune'),
      evaluation: partitionPart('eval'),
    },
    evaluation: {
      evidence: 'independent',
      bins: 5,
      uncalibrated: { sampleCount: 1, brier: 0.25, ece: 0.1 },
      calibrated: { sampleCount: 1, brier: 0.1, ece: 0.05 },
    },
  }
}

const request: JudgeRequest = {
  state: 'synthetic state',
  questions: { risk: { type: 'noul', instructions: 'Can it destroy data?' } },
}

const options: JudgeCascadeOptions = {
  family: 'risk.destructive',
  promptVersion: 'prompt-1',
  criteriaVersion: 'criteria-1',
  highStakes: false,
}

function noulAnswer(values: readonly number[]): JevAnswer {
  const yes = values[0] ?? 0
  return { type: 'noul', noul: yes, probabilities: { true: yes, false: values[1] ?? 0 } }
}

function choiceAnswer(
  keys: readonly string[],
  values: readonly number[],
  confidence: number,
): JevAnswer {
  const probabilities: Record<string, number> = {}
  for (const [index, key] of keys.entries()) {
    probabilities[key] = values[index] ?? 0
  }
  const top = values.indexOf(Math.max(...values))
  return { type: 'choice', choice: keys[top] ?? '', confidence, probabilities }
}

function scoreAnswer(
  labels: readonly string[],
  values: readonly number[],
  confidence: number,
): JevAnswer {
  const probabilities: Record<string, number> = {}
  let expected = 0
  for (const index of labels.keys()) {
    const mass = values[index] ?? 0
    probabilities[String(index)] = mass
    expected += mass * index
  }
  return {
    type: 'score',
    score: expected,
    confidence,
    probabilities,
    legend: Object.fromEntries(labels.map((text, level) => [String(level), text])),
  }
}

function answered(
  asked: JudgeRequest,
  cap: JudgeCapability,
  distributions: Readonly<Record<string, readonly number[]>>,
  overrides: { partial?: boolean | undefined } = {},
): JudgeResult {
  const answers: JudgeResult['answers'] = {}
  const muse: JudgeResult['muse'] = {}
  for (const [id, question] of Object.entries(asked.questions)) {
    const values = distributions[id] ?? [1, 0]
    const confidence = entropyConfidence(values)
    if (question.type === 'noul') {
      answers[id] = noulAnswer(values)
    } else if (question.type === 'choice') {
      answers[id] = choiceAnswer(Object.keys(question.criteria), values, confidence)
    } else {
      answers[id] = scoreAnswer(question.criteria, values, confidence)
    }
    muse[id] = {
      source: cap.source,
      technique: 'stated',
      model: cap.model,
      label: 'uncalibrated',
      confidence,
      partial: overrides.partial ?? false,
    }
  }
  return {
    model: cap.model,
    answers,
    muse,
    usage: { input_tokens: 40, output_tokens: 1 },
  }
}

interface FakeSide {
  readonly side: JudgeCascadeSide
  readonly run: ReturnType<typeof vi.fn>
}

function fakeSide(
  cap: JudgeCapability,
  distributions: Readonly<Record<string, readonly number[]>>,
  settings: {
    fitVersion?: string
    weight?: number
    costs?: { reserved: number; settled: number; uncertain: number }
    answer?: JudgeOutcome
    throws?: boolean
    partial?: boolean
  } = {},
): FakeSide {
  const costs = settings.costs ?? { reserved: 0.004, settled: 0.003, uncertain: 0.001 }
  const run = vi.fn((asked: JudgeRequest, _signal: AbortSignal): Promise<JudgeTechniqueReceipt> => {
    if (settings.throws === true) {
      return Promise.reject(new Error('fake ledger is down'))
    }
    const outcome: JudgeOutcome = settings.answer ?? {
      outcome: 'answered',
      result: answered(asked, cap, distributions, { partial: settings.partial }),
    }
    return Promise.resolve({
      outcome,
      reservedCostUsd: costs.reserved,
      settledCostUsd: costs.settled,
      uncertainCostUsd: costs.uncertain,
    })
  })
  const side: JudgeCascadeSide = {
    capability: cap,
    profile: profileFor(cap, settings.fitVersion ?? 'fit-7', settings.weight ?? 3),
    fitVersion: settings.fitVersion ?? 'fit-7',
    limits,
    run,
  }
  return { side, run }
}

function depsFor(separate: FakeSide, same: FakeSide) {
  return { separate: separate.side, same: same.side }
}

/** A separate answer reported as it came: no same dispatch, honest source. */
function expectSeparatePassthrough(outcome: JudgeOutcome, same: FakeSide): void {
  expect(same.run).not.toHaveBeenCalled()
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') {
    return
  }
  expect(outcome.result.muse['risk']?.source).toBe('separate')
  expect(outcome.result.muse['risk']?.technique).toBe('stated')
}

/** A side whose stored answer carries one patched meta field. */
function mutatingSide(
  cap: JudgeCapability,
  distributions: Readonly<Record<string, readonly number[]>>,
  id: string,
  mutate: (meta: JudgeMuse) => JudgeMuse,
): FakeSide {
  const base = fakeSide(cap, distributions)
  return {
    ...base,
    side: {
      ...base.side,
      run: vi.fn((asked: JudgeRequest): Promise<JudgeTechniqueReceipt> => {
        const result = answered(asked, cap, distributions)
        const meta = result.muse[id]
        if (meta !== undefined) {
          result.muse[id] = mutate(meta)
        }
        return Promise.resolve({
          outcome: { outcome: 'answered', result },
          reservedCostUsd: 0,
          settledCostUsd: 0,
          uncertainCostUsd: 0,
        })
      }),
    },
  }
}

const signal = () => new AbortController().signal

/** A noul `risk` answer reading `yes` (close-to: the binary complement carries a 1-ulp round-trip). */
function expectRiskNoul(answer: JevAnswer | undefined, yes: number): void {
  if (answer?.type !== 'noul') {
    expect(answer?.type).toBe('noul')
    return
  }
  expect(answer.noul).toBeCloseTo(yes, 10)
  expect(answer.probabilities.true).toBeCloseTo(yes, 10)
  expect(answer.probabilities.false).toBeCloseTo(1 - yes, 10)
}

/** A partial separate answer against an ordinary same side. */
function partialSeparatePair(): { separate: FakeSide; same: FakeSide } {
  return {
    separate: fakeSide(separateCap, { risk: [0.6, 0.4] }, { partial: true }),
    same: fakeSide(sameCap, { risk: [0.6, 0.4] }),
  }
}

/** A two-question request (noul risk, choice pick) for per-question cascade cases. */
function riskPickRequest(): JudgeRequest {
  return {
    state: 'synthetic state',
    questions: {
      risk: { type: 'noul', instructions: 'Can it destroy data?' },
      pick: {
        type: 'choice',
        instructions: 'Pick one.',
        criteria: { A: 'First.', B: 'Second.' },
      },
    },
  }
}

/** A side whose pick answer is partial while its risk answer stays combinable. */
function partialPickSide(cap: JudgeCapability, risk: readonly number[]): FakeSide {
  return mutatingSide(cap, { risk, pick: [0.7, 0.3] }, 'pick', (meta) => ({
    ...meta,
    partial: true,
  }))
}

/** A real but non-combinable separate answer kept and reported as it came. */
function expectKeptSeparateAnswer(outcome: JudgeOutcome): void {
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') {
    return
  }
  expect(outcome.result.muse['risk']).toMatchObject({ source: 'separate', partial: true })
  expect(outcome.result.model).toBe('fixture-separate')
  expectRiskNoul(outcome.result.answers['risk'], 0.6)
}

/** One default-options cascade run over a multi-question request, answered. */
async function answeredMulti(
  multi: JudgeRequest,
  separate: FakeSide,
  same: FakeSide,
): Promise<JudgeResult> {
  const outcome = await cascadeJudge(multi, options, depsFor(separate, same), signal())
  expect(outcome.outcome).toBe('answered')
  if (outcome.outcome !== 'answered') {
    throw new Error('expected the cascade to answer')
  }
  return outcome.result
}

/** One cascade run that must dispatch both sides exactly once. */
async function runBothOnce(
  separate: FakeSide,
  same: FakeSide,
  opts: JudgeCascadeOptions = options,
): Promise<JudgeOutcome> {
  const outcome = await cascadeJudge(request, opts, depsFor(separate, same), signal())
  expect(separate.run).toHaveBeenCalledTimes(1)
  expect(same.run).toHaveBeenCalledTimes(1)
  return outcome
}

/** A high-stakes run dispatches both sides exactly once and returns the outcome. */
async function highStakesOutcome(separate: FakeSide, same: FakeSide): Promise<JudgeOutcome> {
  return await runBothOnce(separate, same, { ...options, highStakes: true })
}

/** A side whose profile carries a biased Platt fit (slope 1, intercept ln 3). */
function biased(base: FakeSide, cap: JudgeCapability): FakeSide {
  return {
    ...base,
    side: {
      ...base.side,
      profile: {
        ...profileFor(cap, 'fit-7', 3),
        fit: { method: 'platt', slope: 1, intercept: Math.log(3) },
      },
    },
  }
}

describe('shouldCascadeFollowUp', () => {
  it('follows up below the entropy gate and rests above it', () => {
    expect(shouldCascadeFollowUp([entropyConfidence([0.99, 0.01])], false)).toBe(false)
    expect(shouldCascadeFollowUp([entropyConfidence([0.6, 0.4])], false)).toBe(true)
    expect(
      shouldCascadeFollowUp(
        [entropyConfidence([0.99, 0.01]), entropyConfidence([0.6, 0.4])],
        false,
      ),
    ).toBe(true)
  })

  it('pins the prototype counterexample: entropy follows where |2p-1| would rest', () => {
    // p = 0.92: the prototype's |2p-1| reads 0.84, at rest under a 0.8 bar;
    // the specified entropy confidence reads ~0.60, a follow-up. This is one
    // of the 11 asks the specified gate adds over the prototype's 17.
    expect(Math.abs(2 * 0.92 - 1)).toBeGreaterThanOrEqual(JUDGE_CASCADE_CONFIDENCE)
    const confidence = entropyConfidence([0.92, 0.08])
    expect(confidence).toBeLessThan(JUDGE_CASCADE_CONFIDENCE)
    expect(shouldCascadeFollowUp([confidence], false)).toBe(true)
  })

  it('always invokes the same model for a high-stakes family', () => {
    expect(shouldCascadeFollowUp([entropyConfidence([0.99, 0.01])], true)).toBe(true)
    expect(shouldCascadeFollowUp([1], true)).toBe(true)
  })

  it('throws on an empty or non-finite gate rather than guessing', () => {
    expect(() => shouldCascadeFollowUp([], false)).toThrow(RangeError)
    expect(() => shouldCascadeFollowUp([NaN], false)).toThrow(RangeError)
    expect(() => shouldCascadeFollowUp([Infinity], false)).toThrow(RangeError)
  })
})

describe('combineCascadeDistributions', () => {
  it('blends with fitted weights, not equal raw weights', () => {
    const blend = combineCascadeDistributions([
      { distribution: [0.9, 0.1], weight: 3 },
      { distribution: [0.2, 0.8], weight: 1 },
    ])
    expect(blend.distribution[0]).toBeCloseTo(0.725, 10)
    expect(blend.distribution[1]).toBeCloseTo(0.275, 10)
    expect(blend.confidence).toBeCloseTo(entropyConfidence([0.725, 0.275]), 10)
  })

  it('keeps every blend convex: a cautious dissent can only add caution', () => {
    const separate = [0.9, 0.1]
    const same = [0.2, 0.8]
    const blend = combineCascadeDistributions([
      { distribution: separate, weight: 3 },
      { distribution: same, weight: 1 },
    ])
    for (const [index, mass] of blend.distribution.entries()) {
      expect(mass).toBeGreaterThanOrEqual(Math.min(separate[index] ?? 0, same[index] ?? 0))
      expect(mass).toBeLessThanOrEqual(Math.max(separate[index] ?? 0, same[index] ?? 0))
    }
  })

  it('throws on a caller bug rather than emitting a tuned-looking blend', () => {
    expect(() => combineCascadeDistributions([])).toThrow(RangeError)
    expect(() => combineCascadeDistributions([{ distribution: [1], weight: 1 }])).toThrow(
      RangeError,
    )
    expect(() =>
      combineCascadeDistributions([
        { distribution: [0.5, 0.5], weight: 1 },
        { distribution: [0.5, 0.4, 0.1], weight: 1 },
      ]),
    ).toThrow(RangeError)
    expect(() => combineCascadeDistributions([{ distribution: [0.5, 0.5], weight: 0 }])).toThrow(
      RangeError,
    )
    expect(() => combineCascadeDistributions([{ distribution: [0.5, 0.5], weight: NaN }])).toThrow(
      RangeError,
    )
    expect(() => combineCascadeDistributions([{ distribution: [0.6, 0.5], weight: 1 }])).toThrow(
      RangeError,
    )
    expect(() => combineCascadeDistributions([{ distribution: [0.5, -0.5], weight: 1 }])).toThrow(
      RangeError,
    )
  })
})

describe('cascadeJudge', () => {
  it('returns a confident separate answer untouched and never dispatches the same model', async () => {
    const separate = fakeSide(separateCap, { risk: [0.99, 0.01] })
    const same = fakeSide(
      sameCap,
      { risk: [0.5, 0.5] },
      { costs: { reserved: 0, settled: 0, uncertain: 0 } },
    )
    const outcome = await cascadeJudge(request, options, depsFor(separate, same), signal())
    expect(separate.run).toHaveBeenCalledTimes(1)
    expectSeparatePassthrough(outcome, same)
  })

  it('blends an uncertain separate answer with fitted weights and both claims', async () => {
    const separate = fakeSide(separateCap, { risk: [0.9, 0.1] })
    const same = fakeSide(
      sameCap,
      { risk: [0.2, 0.8] },
      { weight: 1, costs: { reserved: 0.002, settled: 0.002, uncertain: 0 } },
    )
    const outcome = await runBothOnce(separate, same)
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    expectRiskNoul(outcome.result.answers['risk'], 0.725)
    const meta = outcome.result.muse['risk']
    expect(meta).toMatchObject({
      source: 'both',
      technique: 'cascade',
      model: 'fixture-separate',
      label: 'uncalibrated',
      partial: false,
      reservedCostUsd: 0.006,
      settledCostUsd: 0.005,
      uncertainCostUsd: 0.001,
    })
    expect(meta?.confidence).toBeCloseTo(entropyConfidence([0.725, 0.275]), 10)
    expect(outcome.result.model).toBe('fixture-separate')
    expect(outcome.result.usage).toEqual({ input_tokens: 80, output_tokens: 2 })
    // Only the two answering models appear: the conversation model is never reselected.
    expect(JSON.stringify(outcome)).not.toContain('chat-model')
  })

  it('always follows up for a high-stakes family, even when confident', async () => {
    const separate = fakeSide(separateCap, { risk: [0.99, 0.01] })
    const same = fakeSide(sameCap, { risk: [0.99, 0.01] }, { weight: 1 })
    const outcome = await highStakesOutcome(separate, same)
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome === 'answered') {
      expect(outcome.result.muse['risk']?.source).toBe('both')
    }
  })

  it('invokes the same model for a high-stakes family even when the separate answer cannot combine', async () => {
    const { separate, same } = partialSeparatePair()
    const outcome = await highStakesOutcome(separate, same)
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome === 'answered') {
      expect(outcome.result.muse['risk']).toMatchObject({ source: 'same', partial: false })
    }
  })

  it('keeps the separate answer when neither side can combine on a high-stakes follow-up', async () => {
    // Both partial: neither enters the combiner, but the separate answer
    // is real, so it stands as it came — never an engine failure. A failed
    // (timed-out) same follow-up already leaves it standing; a real but
    // non-combinable one must not be treated worse.
    const { separate } = partialSeparatePair()
    const samePartial = fakeSide(sameCap, { risk: [0.6, 0.4] }, { partial: true })
    expectKeptSeparateAnswer(await highStakesOutcome(separate, samePartial))
  })

  it('keeps the separate answer when the high-stakes follow-up is top-1', async () => {
    const { separate } = partialSeparatePair()
    const sameTop1 = mutatingSide(sameCap, { risk: [0.6, 0.4] }, 'risk', (meta) => ({
      ...meta,
      technique: 'top1',
      label: 'approximate (top-1)',
    }))
    // runBothOnce reads the unwrapped mock, which mutatingSide replaces;
    // assert on the side's own dispatch instead.
    const outcome = await cascadeJudge(
      request,
      { ...options, highStakes: true },
      depsFor(separate, sameTop1),
      signal(),
    )
    expect(separate.run).toHaveBeenCalledTimes(1)
    expect(sameTop1.side.run).toHaveBeenCalledTimes(1)
    expectKeptSeparateAnswer(outcome)
  })

  it('refuses a foreign standing answer instead of keeping it', async () => {
    // Neither side can combine, and the separate side's stored answer does
    // not even name this separate side: there is no separate answer in
    // hand to keep, so the run refuses rather than passing a foreign
    // answer through as the separate source's.
    const foreign = mutatingSide(separateCap, { risk: [0.6, 0.4] }, 'risk', (meta) => ({
      ...meta,
      source: 'same',
      partial: true,
    }))
    const samePartial = fakeSide(sameCap, { risk: [0.6, 0.4] }, { partial: true })
    const outcome = await cascadeJudge(
      request,
      { ...options, highStakes: true },
      depsFor(foreign, samePartial),
      signal(),
    )
    expect(foreign.side.run).toHaveBeenCalledTimes(1)
    expect(samePartial.run).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
  })

  it('names the serving model on the envelope when the same follow-up stands alone', async () => {
    // Partial separate, combinable same: the reported answer is the same
    // model's, so the envelope names it — a consumer keying the serving
    // model on result.model must not bill it to the separate model.
    const { separate, same } = partialSeparatePair()
    const outcome = await highStakesOutcome(separate, same)
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    expect(outcome.result.muse['risk']).toMatchObject({
      source: 'same',
      model: 'fixture-same',
      partial: false,
    })
    expect(outcome.result.model).toBe('fixture-same')
    expect(outcome.result.usage).toEqual({ input_tokens: 80, output_tokens: 2 })
  })

  it('keeps a binary bias correction instead of renormalizing it away', async () => {
    // Platt slope 1, intercept ln(3): p(yes) = 0.5 must calibrate to 0.75.
    // Calibrating both masses and renormalizing would return 0.5.
    const separate = biased(fakeSide(separateCap, { risk: [0.5, 0.5] }), separateCap)
    const same = biased(fakeSide(sameCap, { risk: [0.5, 0.5] }, { weight: 1 }), sameCap)
    const outcome = await runBothOnce(separate, same)
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    expectRiskNoul(outcome.result.answers['risk'], 0.75)
    expect(outcome.result.muse['risk']?.source).toBe('both')
  })

  it('leaves phase-1 behaviour on a failed separate output and names its source', async () => {
    const separate = fakeSide(
      separateCap,
      { risk: [0.9, 0.1] },
      { answer: { outcome: 'no-answer', reason: 'timeout' } },
    )
    const same = fakeSide(sameCap, { risk: [0.7, 0.3] })
    const outcome = await cascadeJudge(request, options, depsFor(separate, same), signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    expect(outcome.result.muse['risk']?.source).toBe('same')
    expect(outcome.result.muse['risk']?.technique).toBe('stated')
  })

  it('lets a failed same follow-up leave the separate answer standing', async () => {
    const separate = fakeSide(separateCap, { risk: [0.6, 0.4] })
    const same = fakeSide(
      sameCap,
      { risk: [0.6, 0.4] },
      { answer: { outcome: 'no-answer', reason: 'timeout' } },
    )
    const outcome = await cascadeJudge(request, options, depsFor(separate, same), signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome === 'answered') {
      expect(outcome.result.muse['risk']?.source).toBe('separate')
    }
  })

  it('reports no answer when both sides fail, with the fallback reason', async () => {
    const separate = fakeSide(
      separateCap,
      { risk: [0.6, 0.4] },
      { answer: { outcome: 'no-answer', reason: 'timeout' } },
    )
    const same = fakeSide(
      sameCap,
      { risk: [0.6, 0.4] },
      { answer: { outcome: 'no-answer', reason: 'engine-failure' } },
    )
    await expect(
      cascadeJudge(request, options, depsFor(separate, same), signal()),
    ).resolves.toEqual({
      outcome: 'no-answer',
      reason: 'engine-failure',
    })
  })

  it('keeps a partial separate result out of the combiner and reports it as it came', async () => {
    const { separate, same } = partialSeparatePair()
    const outcome = await cascadeJudge(request, options, depsFor(separate, same), signal())
    expect(same.run).not.toHaveBeenCalled()
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome === 'answered') {
      expect(outcome.result.muse['risk']).toMatchObject({ source: 'separate', partial: true })
    }
  })

  it('keeps a top-1 separate result out of the combiner', async () => {
    const top1 = mutatingSide(separateCap, { risk: [0.6, 0.4] }, 'risk', (meta) => ({
      ...meta,
      technique: 'top1',
      label: 'approximate (top-1)',
    }))
    const same = fakeSide(sameCap, { risk: [0.6, 0.4] })
    const outcome = await cascadeJudge(request, options, depsFor(top1, same), signal())
    expect(same.run).not.toHaveBeenCalled()
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome === 'answered') {
      expect(outcome.result.muse['risk']?.technique).toBe('top1')
    }
  })

  it('refuses a stale profile and reports the separate answer, never a blend', async () => {
    const separate = fakeSide(separateCap, { risk: [0.6, 0.4] }, { fitVersion: 'fit-8' })
    const stale = {
      ...separate,
      side: { ...separate.side, profile: profileFor(separateCap, 'fit-7', 3) },
    } satisfies FakeSide
    const same = fakeSide(sameCap, { risk: [0.6, 0.4] })
    const outcome = await cascadeJudge(request, options, depsFor(stale, same), signal())
    expectSeparatePassthrough(outcome, same)
  })

  it('turns disagreement into caution, never into one side winning', async () => {
    const separate = fakeSide(separateCap, { risk: [0.9, 0.1] }, { weight: 1 })
    const same = fakeSide(sameCap, { risk: [0.1, 0.9] }, { weight: 1 })
    const outcome = await cascadeJudge(request, options, depsFor(separate, same), signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    // Close-to, not bit-exact: disagreement settles at 0.5 caution, but
    // each side's logit/sigmoid round-trip costs a ulp (see expectRiskNoul).
    expectRiskNoul(outcome.result.answers['risk'], 0.5)
    const meta = outcome.result.muse['risk']
    expect(meta?.confidence).toBeCloseTo(0, 10)
    expect(meta?.confidence).toBeLessThan(entropyConfidence([0.9, 0.1]))
    expect(meta?.confidence).toBeLessThan(entropyConfidence([0.1, 0.9]))
    expect(JSON.stringify(outcome)).not.toContain('allow')
  })

  it('passes a lone combinable side through untouched when the other side cannot combine', async () => {
    const multi = riskPickRequest()
    const partialPick = partialPickSide(separateCap, [0.6, 0.4])
    const same = fakeSide(sameCap, { risk: [0.6, 0.4], pick: [0.7, 0.3] }, { weight: 1 })
    const outcome = await cascadeJudge(multi, options, depsFor(partialPick, same), signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    expect(outcome.result.muse['risk']?.source).toBe('both')
    expect(outcome.result.muse['pick']).toMatchObject({ source: 'same', partial: false })
  })

  it('falls back per question when one blends and another cannot combine on either side', async () => {
    // Risk blends; pick is partial on both sides, so neither enters the
    // combiner there. The run still answers: risk as a blend, pick as the
    // separate answer already in hand — never a whole-run engine failure.
    const multi = riskPickRequest()
    const separate = partialPickSide(separateCap, [0.9, 0.1])
    const same = partialPickSide(sameCap, [0.2, 0.8])
    const result = await answeredMulti(multi, separate, same)
    expect(separate.side.run).toHaveBeenCalledTimes(1)
    expect(same.side.run).toHaveBeenCalledTimes(1)
    expect(result.muse['risk']?.source).toBe('both')
    expect(result.muse['pick']).toMatchObject({ source: 'separate', partial: true })
    expect(result.model).toBe('fixture-separate')
  })

  it('names the separate model on a mixed envelope and keeps each question honest', async () => {
    // Risk blends (the cascade's blend convention names the separate
    // model); pick stands on the same side alone. The envelope follows the
    // blend convention while pick's muse still names the model that
    // answered it.
    const multi = riskPickRequest()
    const separate = partialPickSide(separateCap, [0.9, 0.1])
    const same = fakeSide(sameCap, { risk: [0.2, 0.8], pick: [0.7, 0.3] }, { weight: 1 })
    const result = await answeredMulti(multi, separate, same)
    expect(result.muse['risk']?.source).toBe('both')
    expect(result.muse['pick']).toMatchObject({
      source: 'same',
      model: 'fixture-same',
      partial: false,
    })
    expect(result.model).toBe('fixture-separate')
  })

  it('assembles choice and score blends with winners, legends and expected levels', async () => {
    const multi: JudgeRequest = {
      state: 'synthetic state',
      questions: {
        pick: {
          type: 'choice',
          instructions: 'Pick one.',
          criteria: { A: 'First.', B: 'Second.' },
        },
        level: { type: 'score', instructions: 'Rate it.', criteria: ['low', 'high'] },
      },
    }
    const separate = fakeSide(separateCap, { pick: [0.8, 0.2], level: [0.25, 0.75] })
    const same = fakeSide(sameCap, { pick: [0.4, 0.6], level: [0.5, 0.5] }, { weight: 1 })
    const outcome = await cascadeJudge(multi, options, depsFor(separate, same), signal())
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome !== 'answered') {
      return
    }
    // Choice blend [(2.4+0.4)/4, (0.6+0.6)/4] = [0.7, 0.3]: A wins.
    // (Calibration round-trips through Platt, so masses are close, not exact.)
    const pick = outcome.result.answers['pick']
    expect(pick?.type).toBe('choice')
    if (pick?.type === 'choice') {
      expect(pick.choice).toBe('A')
      expect(pick.probabilities['A']).toBeCloseTo(0.7, 9)
      expect(pick.probabilities['B']).toBeCloseTo(0.3, 9)
    }
    // Score blend [(0.75+0.5)/4, (2.25+0.5)/4] = [0.3125, 0.6875]: level 0.6875.
    const level = outcome.result.answers['level']
    expect(level?.type).toBe('score')
    if (level?.type === 'score') {
      expect(level.score).toBeCloseTo(0.6875, 10)
      expect(level.legend).toEqual({ '0': 'low', '1': 'high' })
    }
    expect(outcome.result.muse['pick']?.source).toBe('both')
    expect(outcome.result.muse['level']?.source).toBe('both')
  })

  it('admits nothing new once cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const separate = fakeSide(separateCap, { risk: [0.6, 0.4] })
    const same = fakeSide(sameCap, { risk: [0.6, 0.4] })
    await expect(
      cascadeJudge(request, options, depsFor(separate, same), controller.signal),
    ).resolves.toEqual({ outcome: 'no-answer', reason: 'cancelled' })
    expect(separate.run).not.toHaveBeenCalled()
    expect(same.run).not.toHaveBeenCalled()
  })

  it('refuses an empty request and an unbound model without dispatching', async () => {
    const separate = fakeSide(separateCap, { risk: [0.9, 0.1] })
    const same = fakeSide(sameCap, { risk: [0.9, 0.1] })
    await expect(
      cascadeJudge({ state: 'x', questions: {} }, options, depsFor(separate, same), signal()),
    ).resolves.toEqual({ outcome: 'no-answer', reason: 'engine-failure' })
    await expect(
      cascadeJudge({ ...request, model: 'chat-model' }, options, depsFor(separate, same), signal()),
    ).resolves.toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
    expect(separate.run).not.toHaveBeenCalled()
    expect(same.run).not.toHaveBeenCalled()
  })

  it('never bills a doomed same call when the request binds only the separate model', async () => {
    const separate = fakeSide(separateCap, { risk: [0.6, 0.4] })
    const same = fakeSide(sameCap, { risk: [0.6, 0.4] })
    const outcome = await cascadeJudge(
      { ...request, model: 'fixture-separate' },
      options,
      depsFor(separate, same),
      signal(),
    )
    expect(same.run).not.toHaveBeenCalled()
    expect(outcome.outcome).toBe('answered')
    if (outcome.outcome === 'answered') {
      expect(outcome.result.muse['risk']?.source).toBe('separate')
    }
  })
})
