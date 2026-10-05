import { describe, expect, it } from 'vitest'
import {
  assembleAnswer,
  labelForTechnique,
  type AnswerMaterial,
  type JudgeQuestion,
} from '../../src/core/judge/judge'

const noul: JudgeQuestion = { id: 'q1', kind: 'noul', text: 'may this run?' }
const choice: JudgeQuestion = {
  id: 'q2',
  kind: 'choice',
  text: 'pick one',
  options: ['alpha', 'beta', 'gamma'],
}
const score: JudgeQuestion = {
  id: 'q3',
  kind: 'score',
  text: 'rate it',
  options: ['low', 'high'],
}

function material(overrides: Partial<AnswerMaterial> = {}): AnswerMaterial {
  return {
    probabilities: [0.7, 0.3],
    vendorConfidence: undefined,
    partial: false,
    residualMass: 0,
    technique: 'stated',
    ...overrides,
  }
}

describe('labelForTechnique', () => {
  it('labels phase-1 results uncalibrated or approximate (top-1)', () => {
    expect(labelForTechnique('stated')).toBe('uncalibrated')
    expect(labelForTechnique('logprobs')).toBe('uncalibrated')
    expect(labelForTechnique('top1')).toBe('approximate (top-1)')
  })
})

describe('assembleAnswer', () => {
  it('assembles a noul with p(yes) and our entropy confidence', () => {
    const answer = assembleAnswer({ question: noul, material: material(), model: 'muse-spark' })
    expect(answer.kind).toBe('noul')
    if (answer.kind !== 'noul') {
      throw new Error('expected a noul answer')
    }
    expect(answer.questionId).toBe('q1')
    expect(answer.pYes).toBe(0.7)
    expect(answer.muse.source).toBe('same')
    expect(answer.muse.technique).toBe('stated')
    expect(answer.muse.model).toBe('muse-spark')
    expect(answer.muse.label).toBe('uncalibrated')
    expect(answer.muse.confidence).toBeCloseTo(0.119, 3)
    expect(answer.muse.partial).toBe(false)
  })

  it('keeps the backend value as vendorConfidence, never mixed with ours', () => {
    const answer = assembleAnswer({
      question: noul,
      material: material({ vendorConfidence: 0.9 }),
      model: 'tev1',
    })
    if (answer.kind !== 'noul') {
      throw new Error('expected a noul answer')
    }
    expect(answer.muse.vendorConfidence).toBe(0.9)
    expect(answer.muse.confidence).not.toBe(0.9)
  })

  it('assembles a choice with the winning option and every probability', () => {
    const answer = assembleAnswer({
      question: choice,
      material: material({ probabilities: [0.2, 0.7, 0.1] }),
      model: 'm',
    })
    expect(answer.kind).toBe('choice')
    if (answer.kind !== 'choice') {
      throw new Error('expected a choice answer')
    }
    expect(answer.optionIndex).toBe(1)
    expect(answer.probabilities).toEqual([0.2, 0.7, 0.1])
  })

  it('assembles a score with its expected level', () => {
    const answer = assembleAnswer({
      question: score,
      material: material({ probabilities: [0.25, 0.75] }),
      model: 'm',
    })
    expect(answer.kind).toBe('score')
    if (answer.kind !== 'score') {
      throw new Error('expected a score answer')
    }
    expect(answer.expectedLevel).toBeCloseTo(0.75, 9)
  })

  it('carries partial and the settled costs from admission', () => {
    const answer = assembleAnswer({
      question: noul,
      material: material({ partial: true, technique: 'logprobs' }),
      model: 'm',
      reservedCostUsd: 0.004,
      settledCostUsd: 0.001,
    })
    if (answer.kind !== 'noul') {
      throw new Error('expected a noul answer')
    }
    expect(answer.muse.partial).toBe(true)
    expect(answer.muse.reservedCostUsd).toBe(0.004)
    expect(answer.muse.settledCostUsd).toBe(0.001)
  })

  it('refuses a material that does not fit the question', () => {
    expect(() =>
      assembleAnswer({ question: noul, material: material({ probabilities: [1] }), model: 'm' }),
    ).toThrow(RangeError)
    expect(() =>
      assembleAnswer({
        question: choice,
        material: material({ probabilities: [0.5, 0.5] }),
        model: 'm',
      }),
    ).toThrow(RangeError)
    expect(() =>
      assembleAnswer({
        question: choice,
        material: material({ probabilities: [0.5, 0.5, NaN] }),
        model: 'm',
      }),
    ).toThrow(RangeError)
    expect(() =>
      assembleAnswer({
        question: { id: 'q', kind: 'choice', text: 'pick?' },
        material: material({ probabilities: [0.5, 0.5] }),
        model: 'm',
      }),
    ).toThrow(RangeError)
  })
})
