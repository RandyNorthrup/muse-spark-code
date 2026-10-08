// The embedding fast-path run (M98 phase 2, lane I, PLAN.md 2i): try the
// family's logistic head first, fall back to the allowed full judge on any
// mismatch, corrupt weights, low confidence or blocked embedding call. The
// head alone never answers: a missing allowed full source is a refusal, not
// a shortcut. Embedding and fallback each reserve their own worst-case cost
// on the shared ledger; this module owns no store or ledger. No `vscode`
// import.

import * as z from 'zod/mini'
import { JUDGE_EMBED_FALLBACK_CONFIDENCE, REDACTED_MARK } from '../../../shared/constants'
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

type Step<T> = { readonly status: 'ready'; readonly value: T } | { readonly status: 'failed' }

/**
 * The only await owner: dispatch, parse and settle every step here. Stop
 * wins over fulfillment, rejection and synchronous failures, and is re-read
 * after the continuation settles too. Issued receipts stay with their ledger
 * owner: the public no-answer contract has no cost fields.
 */
async function guardedStep<T>(
  signal: AbortSignal,
  dispatch: () => unknown,
  validate: (value: unknown) => T,
  settle: (step: Step<T>) => JudgeOutcome | Promise<JudgeOutcome>,
): Promise<JudgeOutcome> {
  if (wasAborted(signal)) return refusal('cancelled')
  let step: Step<T>
  try {
    const returned: unknown = await dispatch()
    if (wasAborted(signal)) return refusal('cancelled')
    step = { status: 'ready', value: validate(returned) }
  } catch {
    // Source errors become failed steps; Stop takes precedence below.
    step = { status: 'failed' }
  }
  if (wasAborted(signal)) return refusal('cancelled')
  try {
    const outcome = await settle(step)
    return wasAborted(signal) ? refusal('cancelled') : outcome
  } catch {
    // A rejected continuation settles explicitly instead of escaping.
    return refusal(wasAborted(signal) ? 'cancelled' : 'engine-failure')
  }
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
 * Raw strings, including nested state and criteria, are scrubbed before
 * JSON escaping. The final pass catches named object fields as well.
 */
function embedInputs(request: JudgeRequest): string[] {
  return Object.values(request.questions).map((question) => {
    const payload = JSON.stringify({
      state: redactStructured(request.state),
      instructions: redactStructured(question.instructions),
      criteria: redactStructured(question.criteria ?? null),
    })
    // Never edit escaped JSON: a remaining match refuses dispatch instead.
    if (redactSecrets(payload) !== payload) throw new TypeError('embedding-redaction')
    return payload
  })
}

function redactStructured(value: unknown): unknown {
  if (typeof value === 'string') {
    // A changed string is replaced whole: retaining a fragment can leak the
    // rest of a multiline value, or recreate a quoted match after escaping.
    const inspection = value
      .replaceAll(/\\(["'])/g, (_match, quote: string) => quote)
      .replaceAll(/[\r\n]/g, ' ')
    return redactSecrets(value) !== value ||
      redactSecrets(inspection) !== inspection ||
      value.includes(REDACTED_MARK)
      ? REDACTED_MARK
      : value
  }
  if (Array.isArray(value)) return Array.from(value, (item: unknown) => redactStructured(item))
  if (value === null || typeof value !== 'object') return value
  const clean: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = redactStructured(key)
    if (typeof cleanKey !== 'string') throw new TypeError('embedding-state-key')
    // The raw field name identifies opaque values that carry no token shape.
    const fieldName = `${key}=""`
    Object.defineProperty(clean, cleanKey, {
      value: redactSecrets(fieldName) === fieldName ? redactStructured(item) : REDACTED_MARK,
      enumerable: true,
    })
  }
  return clean
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
    const probability = probabilities[index]
    if (probability === undefined) return refusal('engine-failure')
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
export function runEmbeddingJudge(
  input: unknown,
  options: EmbeddingRouteOptions,
  deps: EmbeddingRouteDependencies,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  const fallback = deps.fallback
  if (fallback === undefined) return Promise.resolve(refusal('source-unavailable'))
  return guardedStep(
    signal,
    () => input,
    (value) => judgeRequestSchema.parse(value),
    (parsed) => {
      if (parsed.status !== 'ready') return refusal('engine-failure')
      const request = parsed.value
      // Every delegate uses this guarded dispatch and accounting path.
      const delegate = (receipt?: EmbeddingReceipt): Promise<JudgeOutcome> =>
        guardedStep(
          signal,
          () => fallback.run(request, signal),
          (value) => judgeOutcomeSchema.parse(value),
          (full) => {
            if (full.status !== 'ready') return refusal('engine-failure')
            return receipt === undefined
              ? full.value
              : withEmbeddingLeg(full.value, deps.source, receipt)
          },
        )
      const head = parseEmbeddingHead(deps.head)
      if (
        !options.optedIn ||
        !isEmbeddingPermitted(deps.source, options.confidential) ||
        Object.values(request.questions).some((question) => question.type !== 'noul') ||
        head.status !== 'valid' ||
        !isMatchingHead(head.head, deps)
      ) {
        return delegate()
      }
      const trained = head.head
      // z.number refuses NaN/Infinity and never coerces null, holes or strings.
      const batchSchema = z
        .array(z.array(z.number()).check(z.length(trained.identity.dimension)))
        .check(z.length(Object.keys(request.questions).length))
      return guardedStep(
        signal,
        () =>
          deps.admission.run(
            { inputTokens: deps.source.inputTokens, uncachedCostUsd: deps.source.uncachedCostUsd },
            signal,
          ),
        (value) => receiptSchema.parse(value),
        (admitted) => {
          if (admitted.status !== 'ready') return refusal('engine-failure')
          const receipt = admitted.value
          return guardedStep(
            signal,
            () => deps.source.embed(embedInputs(request), signal),
            (value) => batchSchema.parse(value),
            (embedded) => {
              if (embedded.status === 'failed') return delegate(receipt)
              const probabilities: number[] = []
              for (const vector of embedded.value) {
                const probability = scoreEmbedding(trained.weights, trained.bias, vector)
                if (probability === undefined) return delegate(receipt)
                probabilities.push(probability)
              }
              const isConfident = probabilities.every(
                (probability) =>
                  entropyConfidence([probability, 1 - probability]) >=
                  JUDGE_EMBED_FALLBACK_CONFIDENCE,
              )
              return isConfident
                ? embeddingAnswer(request, probabilities, deps.source, receipt)
                : delegate(receipt)
            },
          )
        },
      )
    },
  )
}
