// The judge's probability math (M98, D77). Pure functions over distributions
// the judge computed itself; the backend's own confidence is never mixed in.

/** Canonical form of one answer token: case and leading-space variants count as one (D77). */
export function canonicalAnswerToken(token: string): string {
  return token.trimStart().toLowerCase()
}

/**
 * Our confidence for a distribution: `1 − H(p)/ln N` (D77). 0 for uniform,
 * approaching 1 for peaked. A single outcome carries no uncertainty, so its
 * confidence is 1. Throws for an empty or non-finite distribution rather
 * than returning a tuned-looking number.
 */
export function entropyConfidence(probabilities: readonly number[]): number {
  if (probabilities.length === 0) {
    throw new RangeError('entropyConfidence needs at least one probability')
  }
  if (probabilities.length === 1) {
    return 1
  }
  let entropy = 0
  for (const probability of probabilities) {
    if (!Number.isFinite(probability) || probability < 0) {
      throw new RangeError('entropyConfidence needs a finite distribution over non-negative masses')
    }
    if (probability > 0) {
      entropy -= probability * Math.log(probability)
    }
  }
  const confidence = 1 - entropy / Math.log(probabilities.length)
  return Math.min(1, Math.max(0, confidence))
}

/** One top-k entry for the first generated token. */
export interface LogprobAlternative {
  readonly token: string
  readonly logprob: number
}

/**
 * One distribution renormalized over the distinct answer alternatives seen
 * in the top-k. Probabilities sum to 1 when at least one answer token was
 * seen, and are empty otherwise (never read as certainty).
 */
export interface RenormalizedAlternatives {
  /** Per distinct answer key, in first-seen order; sums to 1 when non-empty. */
  readonly probabilities: ReadonlyMap<string, number>
  /**
   * 1 minus the total answer-token mass: the non-answer top-k tokens plus
   * everything outside the top-k.
   */
  readonly residualMass: number
  readonly seenKeys: readonly string[]
}

/**
 * Renormalize the top-k over the distinct answer alternatives. `keyOf` maps
 * a canonical token to its answer key, or undefined for a non-answer token;
 * variants of one answer share a key, so they are counted once. Throws on a
 * non-finite logprob rather than leaking NaN into a confidence.
 */
export function renormalizeAlternatives(
  candidates: readonly LogprobAlternative[],
  keyOf: (canonicalToken: string) => string | undefined,
): RenormalizedAlternatives {
  const masses = new Map<string, number>()
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.logprob)) {
      throw new RangeError('renormalizeAlternatives needs finite logprobs')
    }
    const key = keyOf(canonicalAnswerToken(candidate.token))
    if (key === undefined) {
      continue
    }
    masses.set(key, (masses.get(key) ?? 0) + Math.exp(candidate.logprob))
  }
  let total = 0
  for (const mass of masses.values()) {
    total += mass
  }
  // A zero total means no answer token was seen: the loop below then runs
  // zero times and the caller sees empty probabilities, never certainty.
  const probabilities = new Map<string, number>()
  const seenKeys: string[] = []
  for (const [key, mass] of masses) {
    probabilities.set(key, mass / total)
    seenKeys.push(key)
  }
  return { probabilities, residualMass: Math.max(0, 1 - total), seenKeys }
}
