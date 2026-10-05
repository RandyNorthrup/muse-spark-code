import { describe, expect, it } from 'vitest'
import {
  materialForLogprobs,
  materialForStated,
  materialForTop1,
  parseLogprobCandidates,
  selectTechnique,
} from '../../src/core/judge/techniques'

describe('selectTechnique', () => {
  it('uses logprobs wherever a top-k comes back', () => {
    expect(selectTechnique({ logprobs: 'topk' }, 'noul')).toBe('logprobs')
    expect(selectTechnique({ logprobs: 'topk' }, 'choice')).toBe('logprobs')
    expect(selectTechnique({ logprobs: 'topk' }, 'score')).toBe('logprobs')
  })

  it('uses top-1 only for a noul, stated otherwise', () => {
    expect(selectTechnique({ logprobs: 'top1' }, 'noul')).toBe('top1')
    expect(selectTechnique({ logprobs: 'top1' }, 'choice')).toBe('stated')
    expect(selectTechnique({ logprobs: 'top1' }, 'score')).toBe('stated')
  })

  it('uses stated confidence where logprobs are refused or dropped', () => {
    expect(selectTechnique({ logprobs: 'refused' }, 'noul')).toBe('stated')
    expect(selectTechnique({ logprobs: 'dropped' }, 'choice')).toBe('stated')
  })
})

describe('parseLogprobCandidates', () => {
  it('reads a top-k field', () => {
    expect(
      parseLogprobCandidates([
        { token: 'yes', logprob: -0.01 },
        { token: 'no', logprob: -4.6 },
      ]),
    ).toEqual([
      { token: 'yes', logprob: -0.01 },
      { token: 'no', logprob: -4.6 },
    ])
  })

  it('reads a silently dropped field as an engine failure, never certainty', () => {
    expect(parseLogprobCandidates(undefined)).toBeUndefined()
    expect(parseLogprobCandidates('yes')).toBeUndefined()
    expect(parseLogprobCandidates([])).toBeUndefined()
    expect(parseLogprobCandidates([{ token: 'yes' }])).toBeUndefined()
  })
})

describe('materialForLogprobs', () => {
  it('marks partial when fewer distinct alternatives were seen than offered', () => {
    const material = materialForLogprobs({
      kind: 'choice',
      optionCount: 4,
      candidates: [
        { token: 'A', logprob: Math.log(0.7) },
        { token: 'b', logprob: Math.log(0.2) },
      ],
    })
    expect(material.outcome).toBe('answer')
    if (material.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(material.material.partial).toBe(true)
    expect(material.material.probabilities).toHaveLength(4)
    expect(material.material.probabilities[2]).toBe(0)
    expect(material.material.probabilities[3]).toBe(0)
    expect(material.material.technique).toBe('logprobs')
  })

  it('answers fully when every alternative was seen', () => {
    const material = materialForLogprobs({
      kind: 'noul',
      optionCount: 0,
      candidates: [
        { token: 'yes', logprob: Math.log(0.9) },
        { token: 'No', logprob: Math.log(0.1) },
      ],
    })
    expect(material.outcome).toBe('answer')
    if (material.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(material.material.partial).toBe(false)
    expect(material.material.probabilities[0]).toBeCloseTo(0.9, 6)
    expect(material.material.residualMass).toBeCloseTo(0, 6)
  })

  it('addresses score levels by digit', () => {
    const material = materialForLogprobs({
      kind: 'score',
      optionCount: 5,
      candidates: [
        { token: '2', logprob: Math.log(0.6) },
        { token: '3', logprob: Math.log(0.4) },
      ],
    })
    expect(material.outcome).toBe('answer')
    if (material.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(material.material.probabilities).toHaveLength(5)
    expect(material.material.probabilities[2]).toBeCloseTo(0.6, 6)
    expect(material.material.partial).toBe(true)
  })

  it('ignores letters past the offered options', () => {
    const material = materialForLogprobs({
      kind: 'choice',
      optionCount: 2,
      candidates: [
        { token: 'A', logprob: Math.log(0.5) },
        { token: 'Z', logprob: Math.log(0.5) },
      ],
    })
    expect(material.outcome).toBe('answer')
    if (material.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(material.material.probabilities).toEqual([1, 0])
    expect(material.material.partial).toBe(true)
  })

  it('fails the question when no answer token was seen', () => {
    expect(
      materialForLogprobs({
        kind: 'noul',
        optionCount: 0,
        candidates: [{ token: 'maybe', logprob: Math.log(0.5) }],
      }),
    ).toEqual({ outcome: 'engine-failure' })
  })

  it('refuses unanswerable shapes instead of guessing', () => {
    expect(() => materialForLogprobs({ kind: 'choice', optionCount: 1, candidates: [] })).toThrow(
      RangeError,
    )
    expect(() => materialForLogprobs({ kind: 'choice', optionCount: 27, candidates: [] })).toThrow(
      RangeError,
    )
    expect(() => materialForLogprobs({ kind: 'score', optionCount: 11, candidates: [] })).toThrow(
      RangeError,
    )
  })
})

describe('materialForTop1', () => {
  it('falls back under the floor: the RVM98 counterexample', () => {
    // P(no) = 0.60 with the floor at 0.80: the complement (0.40) is not a
    // distribution, so the question falls back to stated confidence.
    expect(materialForTop1('noul', { token: 'no', probability: 0.6 }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
  })

  it('answers p for yes and 1 − p for no above the floor', () => {
    const yes = materialForTop1('noul', { token: ' Yes', probability: 0.95 }, 0.8)
    expect(yes.outcome).toBe('answer')
    if (yes.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(yes.material.probabilities[0]).toBe(0.95)
    expect(yes.material.probabilities[1]).toBeCloseTo(0.05, 9)
    expect(yes.material.partial).toBe(false)
    expect(yes.material.technique).toBe('top1')
    expect(yes.material.residualMass).toBeCloseTo(0.05, 9)

    const no = materialForTop1('noul', { token: 'NO', probability: 0.9 }, 0.8)
    if (no.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(no.material.probabilities[0]).toBeCloseTo(0.1, 9)
  })

  it('answers exactly at the floor', () => {
    expect(materialForTop1('noul', { token: 'yes', probability: 0.8 }, 0.8).outcome).toBe('answer')
  })

  it('never distributes a top-1 over a choice or score', () => {
    expect(materialForTop1('choice', { token: 'A', probability: 0.99 }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
    expect(materialForTop1('score', { token: '4', probability: 0.99 }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
    // Even a yes/no token above the floor is not a distribution.
    expect(materialForTop1('choice', { token: 'yes', probability: 0.99 }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
  })

  it('falls back on a non-answer token or a corrupt probability', () => {
    expect(materialForTop1('noul', { token: 'maybe', probability: 0.99 }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
    expect(materialForTop1('noul', { token: 'yes', probability: NaN }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
    expect(materialForTop1('noul', { token: 'yes', probability: 1.5 }, 0.8)).toEqual({
      outcome: 'fallback-to-stated',
    })
  })

  it('rejects a floor outside (0, 1]', () => {
    expect(() => materialForTop1('noul', { token: 'yes', probability: 0.9 }, 0)).toThrow(RangeError)
    expect(() => materialForTop1('noul', { token: 'yes', probability: 0.9 }, 1.5)).toThrow(
      RangeError,
    )
  })
})

describe('materialForStated', () => {
  it('maps a noul answer and confidence to p(yes)', () => {
    const yes = materialForStated({
      kind: 'noul',
      optionCount: 0,
      response: { answer: 'yes', confidence: 80 },
    })
    expect(yes.outcome).toBe('answer')
    if (yes.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(yes.material.probabilities[0]).toBe(0.8)
    expect(yes.material.probabilities[1]).toBeCloseTo(0.2, 9)
    expect(yes.material.technique).toBe('stated')

    const no = materialForStated({
      kind: 'noul',
      optionCount: 0,
      response: { answer: 'no', confidence: 80 },
    })
    if (no.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(no.material.probabilities[0]).toBeCloseTo(0.2, 9)
    expect(no.material.probabilities[1]).toBe(0.8)
  })

  it('reads a missing confidence as a failure, never as certainty', () => {
    expect(
      materialForStated({ kind: 'noul', optionCount: 0, response: { answer: 'yes' } }),
    ).toEqual({ outcome: 'failure', failure: 'missing-field' })
    expect(
      materialForStated({ kind: 'choice', optionCount: 2, response: { answer: 'A' } }),
    ).toEqual({ outcome: 'failure', failure: 'missing-field' })
  })

  it('rejects wrong shapes and out-of-range confidence', () => {
    expect(materialForStated({ kind: 'noul', optionCount: 0, response: 'yes' })).toEqual({
      outcome: 'failure',
      failure: 'bad-shape',
    })
    expect(
      materialForStated({
        kind: 'noul',
        optionCount: 0,
        response: { answer: 'yes', confidence: 'high' },
      }),
    ).toEqual({ outcome: 'failure', failure: 'bad-shape' })
    expect(
      materialForStated({
        kind: 'noul',
        optionCount: 0,
        response: { answer: 'yes', confidence: 120 },
      }),
    ).toEqual({ outcome: 'failure', failure: 'bad-range' })
  })

  it('normalizes a choice distribution and checks its length', () => {
    const material = materialForStated({
      kind: 'choice',
      optionCount: 3,
      response: { probabilities: [60, 30, 10] },
    })
    expect(material.outcome).toBe('answer')
    if (material.outcome !== 'answer') {
      throw new Error('expected an answer')
    }
    expect(material.material.probabilities).toEqual([0.6, 0.3, 0.1])
    expect(
      materialForStated({ kind: 'choice', optionCount: 3, response: { probabilities: [50, 50] } }),
    ).toEqual({ outcome: 'failure', failure: 'bad-length' })
    expect(
      materialForStated({ kind: 'score', optionCount: 2, response: { probabilities: [0, 0] } }),
    ).toEqual({ outcome: 'failure', failure: 'empty-distribution' })
    expect(
      materialForStated({
        kind: 'choice',
        optionCount: 2,
        response: { probabilities: [110, -10] },
      }),
    ).toEqual({ outcome: 'failure', failure: 'bad-range' })
  })
})
