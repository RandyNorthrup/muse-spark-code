// Sampling technique (M98 P2): opt-in, eligibility, pricing and result
// aggregation over real schemas and exact amounts. The provider dispatch
// behind each sample runs in the real-life run; here an honest admission
// reserves and settles exact amounts against a recording ledger, and the
// dispatch answers come from real schema-parsed outcomes.
import { describe, expect, it } from 'vitest'
import {
  prepareTechniqueCall,
  sampleJudge,
  techniqueEligibility,
  techniqueProbabilities,
  techniqueResult,
  type JudgeTechniqueAdmission,
  type JudgeTechniqueCall,
  type JudgeTechniqueDependencies,
  type JudgeTechniqueReceipt,
} from '../../src/core/judge/sampling'
import type { JudgeOutcome, JudgeRequest } from '../../src/core/judge/schema'
import { Usd, compareUsdAmounts, type UsdAmount } from '../../src/shared/usd'

const REQUEST: JudgeRequest = {
  state: { command: 'synthetic command', context: ['complete', 'state'] },
  questions: { risk: { type: 'noul', instructions: 'Can it destroy data?' } },
}

function answered(noul = 1): JudgeOutcome {
  return {
    outcome: 'answered',
    result: {
      model: 'fixture-model',
      answers: { risk: { type: 'noul', noul, probabilities: { true: noul, false: 1 - noul } } },
      muse: {
        risk: {
          source: 'same',
          model: 'fixture-model',
          technique: 'sampling',
          label: 'uncalibrated',
          confidence: 1,
          partial: false,
        },
      },
      usage: { input_tokens: 40, output_tokens: 1 },
    },
  }
}

const OPTIONS = {
  optedIn: true,
  sampleCount: 4,
  maxAttemptsPerSample: 1,
  cold: true,
  highStakes: false,
}

/**
An honest admission: every call reserves its exact quote on the recording
ledger, dispatches, and settles the reported usage. A quote the remaining
budget cannot cover is refused as over-budget, like the production legs.
*/
function honestAdmission(options: { remaining?: string; answers?: readonly number[] } = {}): {
  admission: JudgeTechniqueAdmission
  reserved: string[]
  settled: string[]
  runs: { count: number }
} {
  const reserved: string[] = []
  const settled: string[] = []
  const runs = { count: 0 }
  const remaining = options.remaining ?? '1'
  const zero = Usd.from(0).toAmount()
  const admission: JudgeTechniqueAdmission = {
    run: (call: JudgeTechniqueCall, signal: AbortSignal) => {
      runs.count += 1
      if (signal.aborted) return Promise.reject(new Error('cancelled'))
      if (compareUsdAmounts(call.uncachedCostUsd, Usd.from(remaining).toAmount()) > 0)
        return Promise.resolve({
          outcome: { outcome: 'no-answer', reason: 'over-budget' },
          reservedCostUsd: zero,
          settledCostUsd: zero,
          uncertainCostUsd: zero,
        })
      reserved.push(call.uncachedCostUsd)
      const outcome = answered(options.answers?.[runs.count - 1] ?? 1)
      settled.push(call.uncachedCostUsd)
      return Promise.resolve({
        outcome,
        reservedCostUsd: call.uncachedCostUsd,
        settledCostUsd: call.uncachedCostUsd,
        uncertainCostUsd: zero,
      })
    },
  }
  return { admission, reserved, settled, runs }
}

function testDeps(
  admission: JudgeTechniqueAdmission,
  price = '0.0001',
  capabilityOverrides: Record<string, unknown> = {},
  isRawQuote = false,
): JudgeTechniqueDependencies {
  return {
    capability: {
      source: 'same',
      providerId: 'fixture-provider',
      model: 'fixture-model',
      modelVersion: 'v1',
      endpoint: 'https://fixture.invalid/v1',
      captureId: 'synthetic-capture',
      logprobs: { kind: 'refused' },
      stated: true,
      systemone: false,
      reasoningForced: false,
      cache: true,
      contextWindowTokens: 32_000,
      minOutputTokens: 1,
      ...capabilityOverrides,
    },
    family: 'risk.destructive',
    promptVersion: 'prompt-1',
    criteriaVersion: 'criteria-1',
    measurement: {
      captureId: 'synthetic-capture',
      receiptId: 'synthetic-adoption-only',
      identity: {
        source: 'same',
        providerId: 'fixture-provider',
        model: 'fixture-model',
        modelVersion: 'v1',
        endpoint: 'https://fixture.invalid/v1',
        technique: 'sampling',
        family: 'risk.destructive',
        promptVersion: 'prompt-1',
        criteriaVersion: 'criteria-1',
        fitVersion: 'measurement-1',
      },
    },
    prepare: (_request, _technique, maxOutputTokens) => ({
      inputTokens: 40,
      maxOutputTokens,
      uncachedCostUsd: isRawQuote ? (price as unknown as UsdAmount) : Usd.from(price).toAmount(),
      dispatch: () => Promise.resolve(answered()),
    }),
    admission,
  }
}

describe('sampling technique', () => {
  it('stays opt-in: without opting in it refuses instead of sampling', async () => {
    const rig = honestAdmission()
    const result = await sampleJudge(
      REQUEST,
      { ...OPTIONS, optedIn: false },
      testDeps(rig.admission),
      new AbortController().signal,
    )
    expect(result).toEqual({ outcome: 'no-answer', reason: 'explicit-off' })
    expect(rig.runs.count).toBe(0)
  })
  it('refuses a binding the adoption record does not cover', () => {
    const rig = honestAdmission()
    const mismatched = testDeps(rig.admission)
    mismatched.measurement = undefined
    expect(techniqueEligibility(mismatched, 'sampling')).toMatchObject({
      outcome: 'no-answer',
      reason: 'source-untested',
    })
  })
  it('refuses a reasoning-forced or cacheless capability', async () => {
    for (const overrides of [{ reasoningForced: true }, { cache: false }]) {
      const rig = honestAdmission()
      const result = await sampleJudge(
        REQUEST,
        OPTIONS,
        testDeps(rig.admission, '0.0001', overrides),
        new AbortController().signal,
      )
      expect(result).toMatchObject({ outcome: 'no-answer', reason: 'capability-unavailable' })
      expect(rig.runs.count).toBe(0)
    }
  })
  it('bounds its sample counts and refuses a malformed request', async () => {
    const over = honestAdmission()
    expect(
      await sampleJudge(
        REQUEST,
        { ...OPTIONS, sampleCount: 65 },
        testDeps(over.admission),
        new AbortController().signal,
      ),
    ).toMatchObject({ outcome: 'no-answer', reason: 'engine-failure' })
    const malformed = honestAdmission()
    expect(
      await sampleJudge(
        { state: { command: '', context: [] }, questions: {} },
        OPTIONS,
        testDeps(malformed.admission),
        new AbortController().signal,
      ),
    ).toMatchObject({ outcome: 'no-answer', reason: 'engine-failure' })
    expect(over.runs.count).toBe(0)
    expect(malformed.runs.count).toBe(0)
  })
  it('refuses an unpriced call: malformed or negative money never dispatches', async () => {
    // The quote travels through untouched: a throwing canonicalizer in
    // prepare would surface as an engine failure instead.
    for (const price of ['0.0001.2', '-0.5']) {
      const rig = honestAdmission()
      const quoted = testDeps(rig.admission, price, {}, true)
      const result = await sampleJudge(REQUEST, OPTIONS, quoted, new AbortController().signal)
      expect(result).toMatchObject({ outcome: 'no-answer', reason: 'unpriced' })
      expect(rig.runs.count).toBe(0)
    }
  })
  it('dispatches a costly call the ledger admits: no per-question cap of its own', async () => {
    // Above the removed JUDGE_SAMPLING_MAX_USD_PER_QUESTION (0.001): the
    // only ceiling is the ledger's remaining budget.
    const rig = honestAdmission({ remaining: '1' })
    const result = await sampleJudge(
      REQUEST,
      OPTIONS,
      testDeps(rig.admission, '0.05'),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ outcome: 'answered' })
    // One worst-case claim per sample: the warm sample plus three more.
    expect(rig.runs.count).toBe(4)
    expect(rig.reserved).toEqual(Array.from({ length: 4 }, () => '0.05'))
    expect(rig.settled).toEqual(Array.from({ length: 4 }, () => '0.05'))
  })
  it('refuses over-budget when the quote exceeds the remaining budget', async () => {
    const rig = honestAdmission({ remaining: '0.00001' })
    const result = await sampleJudge(
      REQUEST,
      OPTIONS,
      testDeps(rig.admission, '0.05'),
      new AbortController().signal,
    )
    expect(result).toMatchObject({ outcome: 'no-answer', reason: 'over-budget' })
    expect(rig.reserved).toHaveLength(0)
  })
  it('sums exact receipt costs across attempts', () => {
    const zero = Usd.from(0).toAmount()
    const receipts: JudgeTechniqueReceipt[] = [1, 2].map(() => ({
      outcome: answered(),
      reservedCostUsd: Usd.from(0.0001).toAmount(),
      settledCostUsd: Usd.from(0.00008).toAmount(),
      uncertainCostUsd: zero,
    }))
    const result = techniqueResult(
      REQUEST,
      new Map([['risk', [1]]]),
      'sampling',
      testDeps(honestAdmission().admission),
      receipts,
    )
    // Receipt costs attribute to each answered question's muse.
    expect(result).toMatchObject({
      outcome: 'answered',
      result: {
        muse: { risk: { reservedCostUsd: '0.0002', settledCostUsd: '0.00016' } },
        usage: { input_tokens: 80, output_tokens: 2 },
      },
    })
  })
  it('reads noul distributions and rejects invalid shapes', () => {
    expect(
      techniqueProbabilities(
        { type: 'noul', instructions: 'x' },
        { type: 'noul', noul: 0.7, probabilities: { true: 0.7, false: 0.3 } },
      ),
    ).toEqual([0.7, 0.3])
    expect(techniqueProbabilities({ type: 'noul', instructions: 'x' }, { type: 'top1' })).toBe(
      undefined,
    )
  })
  it('validates the prepared call before dispatching', () => {
    const rig = honestAdmission()
    const valid = prepareTechniqueCall(REQUEST, 'sampling', 100, testDeps(rig.admission))
    expect('outcome' in valid).toBe(false)
    const mismatched = prepareTechniqueCall(
      { ...REQUEST, model: 'other-model' },
      'sampling',
      100,
      testDeps(rig.admission),
    )
    expect(mismatched).toMatchObject({ outcome: 'no-answer', reason: 'capability-unavailable' })
  })
})
