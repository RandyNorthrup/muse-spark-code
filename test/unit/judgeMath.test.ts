import { describe, expect, it } from 'vitest'
import {
  canonicalAnswerToken,
  entropyConfidence,
  renormalizeAlternatives,
} from '../../src/core/judge/math'

describe('entropyConfidence', () => {
  it('is 0 for a uniform distribution', () => {
    expect(entropyConfidence([0.5, 0.5])).toBe(0)
    expect(entropyConfidence([0.25, 0.25, 0.25, 0.25])).toBe(0)
  })

  it('approaches 1 for a peaked distribution', () => {
    expect(entropyConfidence([1, 0])).toBe(1)
    expect(entropyConfidence([0.99, 0.01])).toBeCloseTo(0.919, 3)
  })

  it('matches the probe record for the tev1 score distribution', () => {
    // docs/certification/m98-research.md: {0.008, 0.166, 0.488, 0.333,
    // 0.005} has confidence 0.329 under 1 − H/ln N.
    expect(entropyConfidence([0.008, 0.166, 0.488, 0.333, 0.005])).toBeCloseTo(0.329, 3)
  })

  it('grows as the distribution peaks', () => {
    const flat = entropyConfidence([0.5, 0.5])
    const leaning = entropyConfidence([0.8, 0.2])
    const peaked = entropyConfidence([0.99, 0.01])
    expect(leaning).toBeGreaterThan(flat)
    expect(peaked).toBeGreaterThan(leaning)
  })

  it('is 1 for a single outcome, which carries no uncertainty', () => {
    expect(entropyConfidence([1])).toBe(1)
  })

  it('throws for an empty or corrupt distribution instead of inventing a number', () => {
    expect(() => entropyConfidence([])).toThrow(RangeError)
    expect(() => entropyConfidence([0.5, NaN])).toThrow(RangeError)
    expect(() => entropyConfidence([0.5, -0.1])).toThrow(RangeError)
  })
})

describe('canonicalAnswerToken', () => {
  it('folds case and leading-space variants to one form', () => {
    expect(canonicalAnswerToken(' yes')).toBe('yes')
    expect(canonicalAnswerToken('YES')).toBe('yes')
    expect(canonicalAnswerToken('  No')).toBe('no')
    expect(canonicalAnswerToken('A')).toBe('a')
  })
})

function keyOf(canonical: string): string | undefined {
  if (canonical === 'yes') {
    return 'yes'
  }
  return canonical === 'no' ? 'no' : undefined
}

describe('renormalizeAlternatives', () => {
  it('counts case and leading-space variants once', () => {
    const renormalized = renormalizeAlternatives(
      [
        { token: 'Yes', logprob: Math.log(0.5) },
        { token: ' yes', logprob: Math.log(0.25) },
        { token: 'YES', logprob: Math.log(0.125) },
        { token: 'No', logprob: Math.log(0.125) },
      ],
      keyOf,
    )
    expect(renormalized.seenKeys).toEqual(['yes', 'no'])
    expect(renormalized.probabilities.get('yes')).toBeCloseTo(0.875, 6)
    expect(renormalized.probabilities.get('no')).toBeCloseTo(0.125, 6)
  })

  it('renormalizes over the two answers, not the complement (RVM98)', () => {
    // P(no) = 0.60, P(yes) = 0.10, others 0.30: the two-answer
    // renormalization gives 0.143, where the complement gives 0.40.
    const renormalized = renormalizeAlternatives(
      [
        { token: 'no', logprob: Math.log(0.6) },
        { token: 'yes', logprob: Math.log(0.1) },
        { token: ' maybe', logprob: Math.log(0.3) },
      ],
      keyOf,
    )
    expect(renormalized.probabilities.get('yes')).toBeCloseTo(0.143, 3)
    expect(renormalized.probabilities.get('no')).toBeCloseTo(0.857, 3)
    expect(renormalized.residualMass).toBeCloseTo(0.3, 6)
  })

  it('returns no distribution when no answer token was seen, never certainty', () => {
    const renormalized = renormalizeAlternatives(
      [{ token: 'maybe', logprob: Math.log(0.4) }],
      keyOf,
    )
    expect(renormalized.seenKeys).toEqual([])
    expect(renormalized.probabilities.size).toBe(0)
    expect(renormalized.residualMass).toBe(1)
  })

  it('throws on a non-finite logprob rather than leaking NaN', () => {
    expect(() => renormalizeAlternatives([{ token: 'yes', logprob: NaN }], keyOf)).toThrow(
      RangeError,
    )
  })
})
