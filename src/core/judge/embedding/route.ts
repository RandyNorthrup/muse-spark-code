// The embedding fast-path run (M98 phase 2, lane I, PLAN.md 2i): try the
// family's logistic head first, fall back to the allowed full judge on any
// mismatch, corrupt weights, low confidence or blocked embedding call. The
// head alone never answers: a missing allowed full source is a refusal, not
// a shortcut. Embedding and fallback each reserve their own worst-case cost
// on the shared ledger; this module owns no store or ledger. No `vscode`
// import.

import * as z from 'zod/mini'
import { JUDGE_EMBED_FALLBACK_CONFIDENCE } from '../../../shared/constants'
import { entropyConfidence } from '../math'
import {
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeOutcome,
  type JudgeRequest,
  type JevAnswer,
} from '../schema'
import { scoreEmbedding } from './fit'
import { parseEmbeddingHead, type EmbeddingHead } from './schema'

/** Where the embedding vectors come from. Identity, never a provider name. */
export type EmbeddingLocality = 'same-provider' | 'verified-local' | 'unverified-local'

export interface EmbeddingSource {
  readonly providerId: string
  readonly model: string
  readonly modelVersion: string
  readonly endpoint: string
  readonly source: 'same' | 'separate'
  readonly locality: EmbeddingLocality
  /** The chat model's own rule for this provider's remote use. */
  readonly providerPolicy: 'allow' | 'refuse'
  readonly dimension: number
  readonly inputTokens: number
  readonly uncachedCostUsd: number
  readonly embed: (
    inputs: readonly string[],
    signal: AbortSignal,
  ) => Promise<readonly (readonly number[])[]>
}

export interface EmbeddingCostClaim {
  readonly inputTokens: number
  readonly uncachedCostUsd: number
}

/** One NEW attempt/claim on the shared ledger, reserved before dispatch. */
export interface EmbeddingReceipt {
  readonly reservedCostUsd: number
  readonly settledCostUsd: number
  readonly uncertainCostUsd: number
}

const costSchema = z.number().check(z.nonnegative())
const receiptSchema = z.strictObject({
  reservedCostUsd: costSchema,
  settledCostUsd: costSchema,
  uncertainCostUsd: costSchema,
})

/** D78's ledger behind lane Z's adapter: reserve this leg before dispatch. */
export interface EmbeddingAdmission {
  readonly run: (call: EmbeddingCostClaim, signal: AbortSignal) => Promise<EmbeddingReceipt>
}

/** The allowed full judge with its normal admission, supplied by assembly. */
export interface EmbeddingFallback {
  readonly run: (request: JudgeRequest, signal: AbortSignal) => Promise<JudgeOutcome>
}

export interface EmbeddingRouteOptions {
  /** The fast path runs only when explicitly enabled for this call. */
  readonly optedIn: boolean
  readonly confidential: boolean
}

export interface EmbeddingRouteDependencies {
  readonly source: EmbeddingSource
  readonly family: string
  readonly head: unknown
  readonly fallback?: EmbeddingFallback | undefined
  readonly admission: EmbeddingAdmission
}

type NoAnswer = Extract<JudgeOutcome, { outcome: 'no-answer' }>

function refusal(reason: NoAnswer['reason']): JudgeOutcome {
  return { outcome: 'no-answer', reason }
}

/**
 * The embedding leg may run only where the vectors may travel. A blocked leg
 * is not a refusal of the request: the allowed full judge still decides.
 */
function isEmbeddingPermitted(source: EmbeddingSource, isConfidential: boolean): boolean {
  return (
    !isConfidential ||
    (source.locality !== 'unverified-local' &&
      (source.locality !== 'same-provider' || source.providerPolicy === 'allow'))
  )
}

/** The head must be this source's, this family's, and this dimension's. */
function isMatchingHead(head: EmbeddingHead, source: EmbeddingSource, family: string): boolean {
  return (
    head.identity.providerId === source.providerId &&
    head.identity.model === source.model &&
    head.identity.modelVersion === source.modelVersion &&
    head.identity.endpoint === source.endpoint &&
    head.identity.source === source.source &&
    head.identity.family === family &&
    head.identity.dimension === source.dimension
  )
}

/** One embed input per question: the complete state beside its instructions. */
function embedInputs(request: JudgeRequest): string[] {
  return Object.values(request.questions).map((question) =>
    JSON.stringify({ state: request.state, instructions: question.instructions }),
  )
}

function embeddingAnswer(
  request: JudgeRequest,
  probabilities: readonly number[],
  source: EmbeddingSource,
  receipt: EmbeddingReceipt,
): JudgeOutcome {
  const answers: Record<string, JevAnswer> = {}
  const muse: Extract<JudgeOutcome, { outcome: 'answered' }>['result']['muse'] = {}
  const ids = Object.keys(request.questions)
  for (const [index, id] of ids.entries()) {
    const probability = probabilities[index] ?? 0
    answers[id] = {
      type: 'noul',
      noul: probability,
      probabilities: { true: probability, false: 1 - probability },
    }
    muse[id] = {
      source: source.source,
      model: source.model,
      technique: 'embedding',
      label: 'uncalibrated',
      partial: false,
      confidence: entropyConfidence([probability, 1 - probability]),
      reservedCostUsd: receipt.reservedCostUsd,
      settledCostUsd: receipt.settledCostUsd,
      uncertainCostUsd: receipt.uncertainCostUsd,
    }
  }
  return judgeOutcomeSchema.parse({
    outcome: 'answered',
    result: {
      model: source.model,
      answers,
      muse,
      usage: { input_tokens: source.inputTokens, output_tokens: 0 },
    },
  })
}

/**
 * Run the fast path, falling back to the allowed full judge whenever the
 * head cannot answer. Only all-`noul` requests shortcut; a `choice` or
 * `score` question has no logistic head and rides the full judge whole.
 */
export async function runEmbeddingJudge(
  input: unknown,
  options: EmbeddingRouteOptions,
  deps: EmbeddingRouteDependencies,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  const fallback = deps.fallback
  if (fallback === undefined) return refusal('source-unavailable')
  if (signal.aborted) return refusal('cancelled')
  const parsed = judgeRequestSchema.safeParse(input)
  if (!parsed.success) return refusal('engine-failure')
  const request = parsed.data
  if (
    !options.optedIn ||
    !isEmbeddingPermitted(deps.source, options.confidential) ||
    Object.values(request.questions).some((question) => question.type !== 'noul')
  ) {
    return await fallback.run(request, signal)
  }
  const head = parseEmbeddingHead(deps.head)
  if (head.status !== 'valid' || !isMatchingHead(head.head, deps.source, deps.family)) {
    return await fallback.run(request, signal)
  }
  const receipt = receiptSchema.parse(
    await deps.admission.run(
      { inputTokens: deps.source.inputTokens, uncachedCostUsd: deps.source.uncachedCostUsd },
      signal,
    ),
  )
  const vectors = await deps.source.embed(embedInputs(request), signal)
  const ids = Object.keys(request.questions)
  if (vectors.length !== ids.length) return await fallback.run(request, signal)
  const probabilities: number[] = []
  for (const vector of vectors) {
    const probability = scoreEmbedding(head.head.weights, head.head.bias, vector)
    if (probability === undefined) return await fallback.run(request, signal)
    probabilities.push(probability)
  }
  const isConfident = probabilities.every(
    (probability) =>
      entropyConfidence([probability, 1 - probability]) >= JUDGE_EMBED_FALLBACK_CONFIDENCE,
  )
  return isConfident
    ? embeddingAnswer(request, probabilities, deps.source, receipt)
    : await fallback.run(request, signal)
}
