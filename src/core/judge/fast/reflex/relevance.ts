// M125 lane R (D107): context ranking over caller-supplied candidates
// (repo-map entries, paths, snippets). Textbook BM25; the caller reads
// the files, this module only scores text it is given. No score above
// zero misses to the engine. Pure and synchronous.
export interface RelevanceCandidate {
  readonly id: string
  readonly text: string
}

export interface RankedCandidate {
  readonly id: string
  readonly score: number
}

export type RelevanceVerdict =
  | { readonly decision: 'ranked'; readonly ranked: readonly RankedCandidate[] }
  | { readonly decision: 'miss' }

// The textbook BM25 saturation, length-normalisation and IDF smoothing constants.
const BM25_K1 = 1.2
const BM25_B = 0.75
const BM25_IDF_SMOOTHING = 0.5

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_/.-]+/u)
    .filter((term) => term.length > 0)
}

/** Rank candidates against the query, or miss when nothing scores. */
export function rankRelevance(
  query: string,
  candidates: readonly RelevanceCandidate[],
): RelevanceVerdict {
  const queryTerms = [...new Set(terms(query))]
  if (queryTerms.length === 0 || candidates.length === 0) return { decision: 'miss' }
  const documents = candidates.map((candidate) => terms(candidate.text))
  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) / documents.length
  const scored = candidates.map((candidate, index) => {
    const document = documents[index] ?? []
    let score = 0
    for (const term of queryTerms) {
      const frequency = document.filter((word) => word === term).length
      if (frequency === 0) continue
      const containing = documents.filter((other) => other.includes(term)).length
      const idf = Math.log(
        (candidates.length - containing + BM25_IDF_SMOOTHING) / (containing + BM25_IDF_SMOOTHING) +
          1,
      )
      const lengthNorm =
        1 - BM25_B + (BM25_B * document.length) / (averageLength === 0 ? 1 : averageLength)
      score += (idf * frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * lengthNorm)
    }
    return { id: candidate.id, score }
  })
  const ranked = scored
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score)
  return ranked.length === 0 ? { decision: 'miss' } : { decision: 'ranked', ranked }
}
