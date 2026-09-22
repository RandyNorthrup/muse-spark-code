// Fuzzy path matching for @-mentions: case-insensitive subsequence match with
// a score that rewards consecutive characters, matches at path-segment starts
// and matches inside the file name. Deterministic and dependency-free so the
// ranking can be unit-tested exactly.

const SEGMENT_SEPARATORS = new Set(['/', '.', '-', '_', ' '])
const CONSECUTIVE_BONUS = 8
const SEGMENT_START_BONUS = 6
const BASENAME_BONUS = 4
const GAP_PENALTY = 1

function isSegmentStart(candidate: string, index: number): boolean {
  if (index === 0) {
    return true
  }
  const previous = candidate.charAt(index - 1)
  return SEGMENT_SEPARATORS.has(previous)
}

/**
 * Greedy left-to-right subsequence score of `needle` in `haystack`, both
 * already lower-cased; undefined when it is not a subsequence. Characters at
 * or past `basenameStart` earn the file-name bonus.
 */
function greedyScore(needle: string, haystack: string, basenameStart: number): number | undefined {
  let score = 0
  let position = 0
  let previousMatch = -1
  for (const character of needle) {
    const found = haystack.indexOf(character, position)
    if (found === -1) {
      return undefined
    }
    if (found === previousMatch + 1) {
      score += CONSECUTIVE_BONUS
    } else if (previousMatch !== -1) {
      score -= Math.min(found - previousMatch - 1, CONSECUTIVE_BONUS) * GAP_PENALTY
    }
    if (isSegmentStart(haystack, found)) {
      score += SEGMENT_START_BONUS
    }
    if (found >= basenameStart) {
      score += BASENAME_BONUS
    }
    previousMatch = found
    position = found + 1
  }
  return score
}

/**
 * Score of `query` against `candidate`, or undefined when the query is not a
 * subsequence of the candidate. An empty query matches everything with 0.
 *
 * Greedy matching over the whole path can latch onto an early folder letter
 * ("c" of `src/` for `cfg` against `src/config.ts`), so a match confined to
 * the file name is scored separately and the better of the two wins.
 */
export function fuzzyScore(query: string, candidate: string): number | undefined {
  const needle = query.toLowerCase()
  if (needle === '') {
    return 0
  }
  const haystack = candidate.toLowerCase()
  const basenameStart = haystack.lastIndexOf('/') + 1
  const whole = greedyScore(needle, haystack, basenameStart)
  if (whole === undefined) {
    return undefined
  }
  const basenameOnly = greedyScore(needle, haystack.slice(basenameStart), 0)
  return basenameOnly === undefined ? whole : Math.max(whole, basenameOnly)
}

interface Ranked<T> {
  readonly item: T
  readonly score: number
}

/**
 * The best `limit` items for `query`, highest score first; ties go to the
 * shorter key, then to the original order. An empty query keeps the
 * original order.
 */
export function rankMatches<T>(
  query: string,
  items: readonly T[],
  keyOf: (item: T) => string,
  limit: number,
): readonly T[] {
  if (query === '') {
    return items.slice(0, limit)
  }
  const ranked: Ranked<T>[] = []
  for (const item of items) {
    const score = fuzzyScore(query, keyOf(item))
    if (score !== undefined) {
      ranked.push({ item, score })
    }
  }
  return ranked
    .toSorted((a, b) => b.score - a.score || keyOf(a.item).length - keyOf(b.item).length)
    .slice(0, limit)
    .map((entry) => entry.item)
}
