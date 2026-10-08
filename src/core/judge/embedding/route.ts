// The embedding fast-path run (M98 phase 2, lane I, PLAN.md 2i): try the
// family's logistic head first, fall back to the allowed full judge on any
// mismatch, corrupt weights, low confidence or blocked embedding call. The
// head alone never answers: a missing allowed full source is a refusal, not
// a shortcut. Embedding and fallback each reserve their own worst-case cost
// on the shared ledger; this module owns no store or ledger. No `vscode`
// import.

import * as z from 'zod/mini'
import { JUDGE_EMBED_FALLBACK_CONFIDENCE } from '../../../shared/constants'
import { redactSecrets } from '../../redact'
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
  /** The current request's framing and training lineage: every field binds. */
  readonly promptVersion: string
  readonly criteriaVersion: string
  readonly fitVersion: string
  readonly head: unknown
  readonly fallback?: EmbeddingFallback | undefined
  readonly admission: EmbeddingAdmission
}

type NoAnswer = Extract<JudgeOutcome, { outcome: 'no-answer' }>

function refusal(reason: NoAnswer['reason']): JudgeOutcome {
  return { outcome: 'no-answer', reason }
}

/**
 * Read the signal anew after every wait. `aborted` mutates under its
 * readonly field, so a single early check never covers a later wait; the
 * indirection also keeps the check outside any earlier narrowing.
 */
function wasAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * The single settlement path for every delegate wait. A Stop that lands
 * while the full judge runs never publishes its late answer: the request is
 * reported as not answered, and the legs already reserved stay on the
 * ledger. No delegate await may resolve an answer without passing through
 * here.
 */
async function settleFallback(
  pending: Promise<JudgeOutcome>,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  const outcome = await pending
  return wasAborted(signal) ? refusal('cancelled') : outcome
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

/**
 * The head must be this source's, this family's, this dimension's, and the
 * current prompt, criteria and fit versions'. A verifying head trained or
 * framed under older versions never answers: it defers to the full judge.
 */
function isMatchingHead(head: EmbeddingHead, deps: EmbeddingRouteDependencies): boolean {
  const source = deps.source
  return (
    head.identity.providerId === source.providerId &&
    head.identity.model === source.model &&
    head.identity.modelVersion === source.modelVersion &&
    head.identity.endpoint === source.endpoint &&
    head.identity.source === source.source &&
    head.identity.family === deps.family &&
    head.identity.dimension === source.dimension &&
    head.identity.promptVersion === deps.promptVersion &&
    head.identity.criteriaVersion === deps.criteriaVersion &&
    head.identity.fitVersion === deps.fitVersion
  )
}

/**
 * One embed input per question: the complete state beside its instructions
 * and the binary question's criteria. The criteria define what `true` and
 * `false` mean, so two framings of the same state never share an input.
 * Every input passes the shared secret redactor before the remote call, the
 * same pass the other judges run on their outbound text.
 */
function embedInputs(request: JudgeRequest): string[] {
  return Object.values(request.questions).map((question) =>
    redactSecrets(
      JSON.stringify({
        state: request.state,
        instructions: question.instructions,
        criteria: question.criteria ?? null,
      }),
    ),
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
 * Run the full judge and keep the embedding leg's cost on an answered
 * verdict. This wait never publishes on its own: only `settleFallback`
 * settles a delegate's answer.
 */
async function runFallbackWithLeg(
  fallback: EmbeddingFallback,
  request: JudgeRequest,
  source: EmbeddingSource,
  receipt: EmbeddingReceipt,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  return withEmbeddingLeg(await fallback.run(request, signal), source, receipt)
}

/**
 * A fallback answer after the embedding leg already reserved its worst-case
 * cost must account both legs: the embedding input tokens join the usage and
 * its reserved, settled and uncertain dollars join every verdict's muse. A
 * fallback no-answer carries no usage, so it passes through unchanged.
 */
function withEmbeddingLeg(
  outcome: JudgeOutcome,
  source: EmbeddingSource,
  receipt: EmbeddingReceipt,
): JudgeOutcome {
  if (outcome.outcome !== 'answered') return outcome
  const muse: Extract<JudgeOutcome, { outcome: 'answered' }>['result']['muse'] = {}
  for (const [id, meta] of Object.entries(outcome.result.muse)) {
    muse[id] = {
      ...meta,
      reservedCostUsd: (meta.reservedCostUsd ?? 0) + receipt.reservedCostUsd,
      settledCostUsd: (meta.settledCostUsd ?? 0) + receipt.settledCostUsd,
      uncertainCostUsd: (meta.uncertainCostUsd ?? 0) + receipt.uncertainCostUsd,
    }
  }
  return judgeOutcomeSchema.parse({
    outcome: 'answered',
    result: {
      ...outcome.result,
      answers: outcome.result.answers,
      muse,
      usage: {
        ...outcome.result.usage,
        input_tokens: outcome.result.usage.input_tokens + source.inputTokens,
        output_tokens: outcome.result.usage.output_tokens,
      },
    },
  })
}

/**
 * Run the fast path, falling back to the allowed full judge whenever the
 * head cannot answer. Only all-`noul` requests shortcut; a `choice` or
 * `score` question has no logistic head and rides the full judge whole. A
 * rejected embedding call falls back like a malformed one; a refused
 * admission or a caught cancellation stays fail-closed with an explicit
 * no-answer instead.
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
    return await settleFallback(fallback.run(request, signal), signal)
  }
  const head = parseEmbeddingHead(deps.head)
  if (head.status !== 'valid' || !isMatchingHead(head.head, deps)) {
    return await settleFallback(fallback.run(request, signal), signal)
  }
  let receipt: EmbeddingReceipt
  try {
    receipt = receiptSchema.parse(
      await deps.admission.run(
        { inputTokens: deps.source.inputTokens, uncachedCostUsd: deps.source.uncachedCostUsd },
        signal,
      ),
    )
  } catch {
    return refusal(wasAborted(signal) ? 'cancelled' : 'engine-failure')
  }
  if (wasAborted(signal)) return refusal('cancelled')
  /** The allowed full judge decides, with the embedding leg's cost kept. */
  const fallbackWithLeg = async (): Promise<JudgeOutcome> =>
    wasAborted(signal)
      ? refusal('cancelled')
      : await settleFallback(
          runFallbackWithLeg(fallback, request, deps.source, receipt, signal),
          signal,
        )
  let vectors: readonly (readonly number[])[]
  try {
    vectors = await deps.source.embed(embedInputs(request), signal)
  } catch {
    return wasAborted(signal) ? refusal('cancelled') : await fallbackWithLeg()
  }
  if (wasAborted(signal)) return refusal('cancelled')
  const ids = Object.keys(request.questions)
  if (vectors.length !== ids.length) return await fallbackWithLeg()
  const probabilities: number[] = []
  for (const vector of vectors) {
    const probability = scoreEmbedding(head.head.weights, head.head.bias, vector)
    if (probability === undefined) return await fallbackWithLeg()
    probabilities.push(probability)
  }
  const isConfident = probabilities.every(
    (probability) =>
      entropyConfidence([probability, 1 - probability]) >= JUDGE_EMBED_FALLBACK_CONFIDENCE,
  )
  return isConfident
    ? embeddingAnswer(request, probabilities, deps.source, receipt)
    : await fallbackWithLeg()
}
