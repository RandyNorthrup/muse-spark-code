import { describe, expect, it } from 'vitest'
import { entropyConfidence } from '../../src/core/judge/math'
import {
  applySystemOneGate,
  systemOneNanoUsd,
  systemOneRouteLabels,
  systemOneUsd,
} from '../../src/core/judge/systemone/policy'
import { prepareSystemOne, SystemOneWireError } from '../../src/core/judge/systemone/wire'
import type { JudgeOutcome, JudgeRequest } from '../../src/core/judge/schema'
import { judgeRequestSchema, judgeResultSchema } from '../../src/core/judge/schema'
import { SYSTEMONE_CAPABILITIES, systemOneCapability } from '../../src/core/providers/capabilities'
import {
  PRESETS,
  SYSTEMONE_SERVICE_PRESETS,
  listedPresets,
  systemOnePresetById,
} from '../../src/core/providers/presets'
import captures from './fixtures/judgeSystemOneCaptures.json'

const costs = { reservedCostUsd: 0.02, settledCostUsd: 0.01 }

function requestOf(capture: { request: unknown }): JudgeRequest {
  return judgeRequestSchema.parse(capture.request)
}

function finish(capture: { request: unknown; response: unknown }, allowed: readonly string[]) {
  return prepareSystemOne(capture.response, requestOf(capture), allowed).withCosts(costs)
}

function wireCode(value: unknown, request: JudgeRequest, allowed: readonly string[]): string {
  try {
    prepareSystemOne(value, request, allowed)
    return 'parsed'
  } catch (error) {
    if (error instanceof SystemOneWireError) return error.code
    throw error
  }
}

describe('systemone service catalogue', () => {
  it('omits clef from the service presets', () => {
    expect(PRESETS).toHaveLength(18)
    const chatIds = PRESETS.map((preset) => preset.id)
    expect(chatIds).not.toContain('openrouter-jev')
    expect(chatIds).not.toContain('typesafe-jev')
    expect(listedPresets().map((preset) => preset.id)).not.toContain('openrouter-jev')
    expect(systemOnePresetById('clef')).toBeUndefined()
    expect(systemOneCapability('clef', 'clef')).toBeUndefined()
    expect(SYSTEMONE_SERVICE_PRESETS.map((preset) => preset.id)).toEqual([
      'openrouter-jev',
      'typesafe-jev',
    ])
    for (const preset of SYSTEMONE_SERVICE_PRESETS) {
      expect(preset.origin.toLowerCase()).not.toContain('cloudflare')
      expect(Object.isFrozen(preset)).toBe(true)
    }
  })

  it('pins the captured Jev bounds, price and routes', () => {
    expect(systemOnePresetById('openrouter-jev')).toMatchObject({
      keyProviderId: 'openrouter',
      origin: 'https://openrouter.ai',
      path: '/api/v1/systemone',
      wireCapture: true,
      tested: false,
      optIn: true,
      autoSelectable: false,
    })
    expect(systemOnePresetById('typesafe-jev')).toMatchObject({
      keyProviderId: 'typesafe',
      origin: 'https://api.typesafe.ai',
      path: '/v1/systemone',
      wireCapture: false,
      tested: false,
      optIn: true,
      autoSelectable: false,
    })
    expect(systemOneCapability('typesafe-jev', 'jev-preview')).toBeUndefined()
    for (const row of SYSTEMONE_CAPABILITIES) {
      expect(systemOnePresetById(row.presetId)).toBeDefined()
      expect(row.inputUsdPerMillion).toBe(0.042)
      expect(row.outputUsdPerMillion).toBe(0)
      expect(row.statePlusLongestQuestionTokens).toBe(32_000)
      expect(row.requestTokens).toBe(64_000)
      expect(row.tested).toBe(false)
      expect(row.autoSelectable).toBe(false)
    }
    for (const preset of SYSTEMONE_SERVICE_PRESETS) {
      expect(SYSTEMONE_CAPABILITIES.some((row) => row.presetId === preset.id)).toBe(true)
      expect(systemOneRouteLabels(preset)).toEqual({
        tested: false,
        optIn: true,
        autoSelectable: false,
      })
    }
  })

  it('prices output at zero', () => {
    const rates = { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 }
    // Exact decimals (RVM98P2R2 8), never a float product's artifact.
    expect(systemOneUsd(491, 20, rates)).toBe(0.000020622)
    expect(systemOneUsd(100, 20, rates)).toBe(0.0000042)
    expect(systemOneNanoUsd(491, 20, rates)).toBe(20_622n)
    expect(() => systemOneUsd(-1, 0, rates)).toThrow(TypeError)
    expect(() => systemOneUsd(1.5, 0, rates)).toThrow(TypeError)
  })
})

describe('systemone wire', () => {
  it('derives omitted noul probabilities and does not copy a vendor confidence', () => {
    const capture = captures.typesafeDocsNoul
    const result = finish(capture, ['jev-1.13.0'])
    const answer = result.answers['healthy']
    const no = 1 - 0.95
    expect(answer).toMatchObject({
      type: 'noul',
      noul: 0.95,
      probabilities: { true: 0.95, false: no },
    })
    const muse = result.muse['healthy']
    expect(muse).toMatchObject({
      source: 'separate',
      technique: 'systemone',
      model: 'jev-1.13.0',
      label: 'uncalibrated',
      partial: false,
      confidence: entropyConfidence([0.95, no]),
      reservedCostUsd: costs.reservedCostUsd,
      settledCostUsd: costs.settledCostUsd,
    })
    expect(muse?.vendorConfidence).toBeUndefined()
    expect(muse?.confidence).not.toBeCloseTo(Math.abs(2 * 0.95 - 1))
    expect(result.usage).toMatchObject({ input_tokens: 296, output_tokens: 20 })
  })

  it('keeps entropy confidence apart from the vendor number', () => {
    const capture = captures.documentedChoiceOnLetters
    const result = finish(capture, ['typesafe/jev-1.13', 'typesafe/jev-1.13-20260917'])
    const muse = result.muse['route']
    const masses = [0.88, 0.12, 0]
    expect(muse?.confidence).toBe(entropyConfidence(masses))
    expect(muse?.confidence).not.toBe(entropyConfidence([0.88, 0.12]))
    expect(muse?.vendorConfidence).toBe(0.81)
    expect(muse?.confidence).not.toBeCloseTo(0.81)
    expect(Reflect.get(result.answers['route'] ?? {}, 'abstain')).toBe(0.085)
  })

  it('aligns a documented score and rejects a legend that is not the request criteria', () => {
    const capture = captures.typesafeDocsScore
    const result = finish(capture, ['jev-1.13.0'])
    expect(result.answers['mood']).toMatchObject({
      type: 'score',
      score: 1.05,
      legend: { '0': 'Calm', '1': 'Frustrated', '2': 'Very angry' },
    })
    expect(result.muse['mood']?.vendorConfidence).toBe(0.92)
    expect(result.muse['mood']?.confidence).toBe(entropyConfidence([0, 0.95, 0.05]))
    const shifted = {
      ...capture.response,
      answers: {
        mood: {
          ...capture.response.answers.mood,
          legend: { '1': 'Calm', '2': 'Frustrated', '3': 'Very angry' },
        },
      },
    }
    expect(wireCode(shifted, requestOf(capture), ['jev-1.13.0'])).toBe('systemone-alignment')
  })

  it('accepts the recorded OpenRouter model and keeps a top-level addition', () => {
    const capture = captures.openrouterRecordedNoul
    const allowed = ['typesafe/jev-1.13', 'typesafe/jev-1.13-20260917']
    const withGoal = { ...capture.response, goal: 'shown-as-received' }
    const result = prepareSystemOne(withGoal, requestOf(capture), allowed).withCosts(costs)
    expect(judgeResultSchema.safeParse(result).success).toBe(true)
    expect(result.model).toBe('typesafe/jev-1.13-20260917')
    expect(result.muse['healthy']?.model).toBe('typesafe/jev-1.13-20260917')
    expect(Reflect.get(result, 'goal')).toBe('shown-as-received')
    expect(wireCode(capture.response, requestOf(capture), ['jev-1.13.0'])).toBe(
      'systemone-alignment',
    )
  })

  it('fails closed when usage is missing', () => {
    const capture = captures.typesafeDocsNoul
    const { usage: _usage, ...withoutUsage } = capture.response
    expect(wireCode(withoutUsage, requestOf(capture), ['jev-1.13.0'])).toBe('systemone-usage')
    expect(
      wireCode({ ...capture.response, usage: { input_tokens: 296 } }, requestOf(capture), [
        'jev-1.13.0',
      ]),
    ).toBe('systemone-usage')
    try {
      prepareSystemOne(withoutUsage, requestOf(capture), ['jev-1.13.0'])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SystemOneWireError)
      expect((error as SystemOneWireError).message).toBe('systemone-usage')
      expect((error as SystemOneWireError).message).not.toContain('healthy')
    }
  })

  it('rejects a distribution that disagrees with the answer', () => {
    const disagreed = {
      ...captures.typesafeDocsNoul.response,
      answers: {
        healthy: { type: 'noul' as const, noul: 0.95, probabilities: { true: 0.4, false: 0.6 } },
      },
    }
    expect(wireCode(disagreed, requestOf(captures.typesafeDocsNoul), ['jev-1.13.0'])).toBe(
      'systemone-answer',
    )
    const request = requestOf(captures.documentedChoiceOnLetters)
    const allowed = ['typesafe/jev-1.13']
    const route = captures.documentedChoiceOnLetters.response.answers.route
    const withExtra = {
      ...captures.documentedChoiceOnLetters.response,
      answers: {
        route: { ...route, choice: 'B', probabilities: { A: 0.88, B: 0.12, C: 0, D: 0 } },
      },
    }
    expect(wireCode(withExtra, request, allowed)).toBe('systemone-distribution')
    const weaker = {
      ...captures.documentedChoiceOnLetters.response,
      answers: { route: { ...route, choice: 'B', probabilities: { A: 0.88, B: 0.12, C: 0 } } },
    }
    expect(wireCode(weaker, request, allowed)).toBe('systemone-answer')
    const tied = {
      ...captures.documentedChoiceOnLetters.response,
      answers: { route: { ...route, choice: 'B', probabilities: { A: 0.5, B: 0.5, C: 0 } } },
    }
    expect(
      finish({ request: captures.documentedChoiceOnLetters.request, response: tied }, allowed)
        .answers['route'],
    ).toMatchObject({ choice: 'B' })
  })
})

describe('systemone gate', () => {
  it('keeps a failing check when noul is safe', () => {
    const capture = structuredClone(captures.typesafeDocsNoul)
    capture.response.answers.healthy.noul = 0.01
    const outcome: JudgeOutcome = {
      outcome: 'answered',
      result: finish(capture, ['jev-1.13.0']),
    }
    const checks = ['lint-failed']
    const gate = applySystemOneGate({ passed: false, checks }, outcome)
    expect(gate.passed).toBe(false)
    expect(gate.cautionOnly).toBe(true)
    expect(gate.advisory).toBe(true)
    expect(gate.checks).toEqual(checks)
    expect(gate.checks).not.toBe(checks)
  })

  it('keeps a passing gate when the score is high', () => {
    const capture = structuredClone(captures.typesafeDocsScore)
    capture.response.answers.mood.score = 1.95
    capture.response.answers.mood.probabilities = { '0': 0, '1': 0.05, '2': 0.95 }
    const outcome: JudgeOutcome = {
      outcome: 'answered',
      result: finish(capture, ['jev-1.13.0']),
    }
    const gate = applySystemOneGate({ passed: true, checks: ['lint-ok'] }, outcome)
    expect(gate.passed).toBe(true)
    expect(gate.advisory).toBe(true)
    const silent = applySystemOneGate(
      { passed: true, checks: ['lint-ok'] },
      {
        outcome: 'no-answer',
        reason: 'engine-failure',
      },
    )
    expect(silent.passed).toBe(true)
    expect(silent.advisory).toBe(false)
  })
})
