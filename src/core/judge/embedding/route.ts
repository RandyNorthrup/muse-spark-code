// The embedding fast-path run (M98 phase 2, lane I, PLAN.md 2i): try the
// family's logistic head first, fall back to the allowed full judge on any
// mismatch, corrupt weights, low confidence or blocked embedding call. The
// head alone never answers: a missing allowed full source is a refusal, not
// a shortcut. Embedding and fallback each reserve their own worst-case cost
// on the shared ledger; this module owns no store or ledger. No `vscode`
// import.

import * as z from 'zod/mini'
import { JUDGE_EMBED_FALLBACK_CONFIDENCE, REDACTED_MARK } from '../../../shared/constants'
import { nonnegativeUsdSchema, sumUsd, Usd, type UsdAmount } from '../../../shared/usd'
import { isSecretFieldName, redactSecrets } from '../../redact'
import { isPaidStop } from '../../refusal'
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
  readonly uncachedCostUsd: UsdAmount
  readonly embed: (
    inputs: readonly string[],
    signal: AbortSignal,
  ) => Promise<readonly (readonly number[])[]>
}

export interface EmbeddingCostClaim {
  readonly inputTokens: number
  readonly uncachedCostUsd: UsdAmount
}

/** One NEW attempt/claim on the shared ledger, reserved before dispatch. */
export interface EmbeddingReceipt {
  readonly reservedCostUsd: UsdAmount
  readonly settledCostUsd: UsdAmount
  readonly uncertainCostUsd: UsdAmount
}

const costSchema = nonnegativeUsdSchema
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
Read the signal anew after every wait. `aborted` mutates under its
readonly field, so a single early check never covers a later wait; the
indirection also keeps the check outside any earlier narrowing.
*/
function wasAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

type Step<T> = { readonly status: 'ready'; readonly value: T } | { readonly status: 'failed' }

/**
Named embedding-leg failures: a paid stop, a ledger fault, a degenerate
input (cyclic data overflows the schema walk), a refused shape, a stale
binding or refused admission, and the refused-inputs control throw.
*/
function isEmbeddingStepError(error: unknown): boolean {
  // Brand checks, never constructors: leg failures cross lazy bundles.
  return (
    isPaidStop(error) ||
    error instanceof RangeError ||
    (error instanceof Error &&
      (error.name === '$ZodError' ||
        error.name === 'JudgeLedgerError' ||
        error.message === 'judge-binding-changed' ||
        error.message === 'judge-admission-refused' ||
        (error instanceof TypeError &&
          (error.message === 'invalid-input' || error.message === 'redaction-failed'))))
  )
}

/** A stop or a named leg failure fails the step; anything else surfaces. */
function isStepFailure(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || isEmbeddingStepError(error)
}

/**
The only await owner: dispatch, parse and settle every step here. Stop
wins over fulfillment, rejection and synchronous failures, and is re-read
after the continuation settles too. Issued receipts stay with their ledger
owner: the public no-answer contract has no cost fields.
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
  } catch (error: unknown) {
    // Source errors become failed steps; Stop takes precedence below.
    if (!isStepFailure(signal, error)) throw error
    step = { status: 'failed' }
  }
  if (wasAborted(signal)) return refusal('cancelled')
  try {
    const outcome = await settle(step)
    return wasAborted(signal) ? refusal('cancelled') : outcome
  } catch (error: unknown) {
    // A rejected continuation settles explicitly instead of escaping.
    if (signal.aborted) return refusal('cancelled')
    if (isEmbeddingStepError(error)) return refusal('engine-failure')
    throw error
  }
}

/**
The embedding leg may run only where the vectors may travel. A blocked leg
is not a refusal of the request: the allowed full judge still decides.
*/
function isEmbeddingPermitted(source: EmbeddingSource, isConfidential: boolean): boolean {
  return (
    !isConfidential ||
    (source.locality !== 'unverified-local' &&
      (source.locality !== 'same-provider' || source.providerPolicy === 'allow'))
  )
}

/**
The head must be this source's, this family's, this dimension's, and the
current prompt, criteria and fit versions'. A verifying head trained or
framed under older versions never answers: it defers to the full judge.
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

type PlainData = string | number | boolean | null | PlainData[] | { [key: string]: PlainData }
type EmbedInputs =
  | { readonly status: 'ready'; readonly value: string[] }
  | { readonly status: 'refused'; readonly reason: 'invalid-input' | 'redaction-failed' }

/** Inspect descriptors before a zod parser reads any property. */
function hasDataProperties(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return (
    (prototype === null ||
      prototype === Object.prototype ||
      (Array.isArray(value) && prototype === Array.prototype)) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => 'value' in descriptor,
    )
  )
}

function isPlainDataContainer(value: unknown): boolean {
  return (
    value === null ||
    typeof value !== 'object' ||
    (hasDataProperties(value) &&
      Reflect.ownKeys(value).every((key) => typeof key === 'string') &&
      !Object.hasOwn(value, 'toJSON') &&
      Object.entries(Object.getOwnPropertyDescriptors(value)).every(
        ([key, descriptor]) =>
          (Array.isArray(value) && key === 'length') ||
          (descriptor.enumerable &&
            (!Array.isArray(value) ||
              (/^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))),
      ))
  )
}

// The descriptor guard runs before the recursive union can read getters.
const plainDataSchema: z.ZodMiniType<PlainData> = z.lazy(() =>
  z.pipe(
    z.unknown().check(z.refine(isPlainDataContainer)),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(plainDataSchema),
      z.record(z.string(), plainDataSchema),
    ]),
  ),
)

// Non-JSON state remains the full judge's concern, never an embedding input.
// This shape check does not serialize it or read its properties. A valid
// plain request still crosses the shared byte-cap schema below.
const requestFieldsSchema = z.pipe(
  z.unknown().check(z.refine(hasDataProperties)),
  z.object({
    ...judgeRequestSchema.shape,
    state: z.custom<JudgeRequest['state']>(
      (value: unknown) =>
        typeof value === 'string' || (value !== null && typeof value === 'object'),
    ),
    questions: z.pipe(
      z.unknown().check(
        z.refine((value) => {
          if (!hasDataProperties(value)) return false
          return Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => {
            const question: unknown = descriptor.value
            if (!hasDataProperties(question)) return false
            const criteria: unknown = Object.getOwnPropertyDescriptor(question, 'criteria')?.value
            return criteria === undefined || hasDataProperties(criteria)
          })
        }),
      ),
      judgeRequestSchema.shape.questions,
    ),
  }),
)

/** Plain validation precedes even the shared parser's byte measurement. */
function prepareRequest(value: unknown): { request: JudgeRequest; inputs: EmbedInputs } {
  let plain: PlainData | undefined
  try {
    const parsed = plainDataSchema.safeParse(value)
    if (parsed.success) plain = parsed.data
  } catch (error: unknown) {
    // Cyclic data cannot be JSON; it takes the same typed input refusal.
    if (!(error instanceof RangeError)) throw error
  }
  if (plain === undefined) {
    return {
      request: requestFieldsSchema.parse(value),
      inputs: { status: 'refused', reason: 'invalid-input' },
    }
  }
  const request = judgeRequestSchema.parse(plain)
  return { request, inputs: embedInputs(plain) }
}

/** Walk the admitted data once; a remaining serialized match refuses. */
function embedInputs(value: PlainData): EmbedInputs {
  const scrubbed = judgeRequestSchema.safeParse(redactStructured(value))
  if (!scrubbed.success) return { status: 'refused', reason: 'invalid-input' }
  const inputs: string[] = []
  for (const question of Object.values(scrubbed.data.questions)) {
    const payload = JSON.stringify({
      state: scrubbed.data.state,
      instructions: question.instructions,
      criteria: question.criteria ?? null,
    })
    if (redactSecrets(payload) !== payload) return { status: 'refused', reason: 'redaction-failed' }
    inputs.push(payload)
  }
  return { status: 'ready', value: inputs }
}

/** Replace a changed inline string whole, including quoted or multiline tails. */
function redactString(value: string): string {
  const inspection = value
    .replaceAll(/\\(["'])/g, (_match, quote: string) => quote)
    .replaceAll(/[\r\n]/g, ' ')
  return [value, inspection].some((text) => redactSecrets(text) !== text) ||
    value.includes(REDACTED_MARK)
    ? REDACTED_MARK
    : value
}

/** A secret name anywhere on the path taints the entire value, of any type. */
function redactStructured(value: PlainData, path: readonly string[] = []): PlainData {
  if (path.some((key) => isSecretFieldName(key))) return REDACTED_MARK
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) {
    return value.map((item, index) => redactStructured(item, [...path, String(index)]))
  }
  if (value === null || typeof value !== 'object') return value
  const clean: Record<string, PlainData> = {}
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(clean, redactString(key), {
      value: redactStructured(item, [...path, key]),
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
A fallback answer after the embedding leg already reserved its worst-case
cost must account both legs: the embedding input tokens join the usage and
its reserved, settled and uncertain dollars join every verdict's muse. A
fallback no-answer carries no usage, so it passes through unchanged.
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
      reservedCostUsd:
        meta.reservedCostUsd === undefined
          ? receipt.reservedCostUsd
          : sumUsd(meta.reservedCostUsd, receipt.reservedCostUsd),
      settledCostUsd:
        meta.settledCostUsd === undefined
          ? receipt.settledCostUsd
          : sumUsd(meta.settledCostUsd, receipt.settledCostUsd),
      uncertainCostUsd:
        meta.uncertainCostUsd === undefined
          ? receipt.uncertainCostUsd
          : sumUsd(meta.uncertainCostUsd, receipt.uncertainCostUsd),
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
Run the fast path, falling back to the allowed full judge whenever the
head cannot answer. Only all-`noul` requests shortcut; a `choice` or
`score` question has no logistic head and rides the full judge whole. A
rejected embedding call falls back like a malformed one; a refused
admission or a caught cancellation stays fail-closed with an explicit
no-answer instead.
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
    prepareRequest,
    (parsed) => {
      if (parsed.status !== 'ready') return refusal('engine-failure')
      const { request, inputs } = parsed.value
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
      // The source quotes an exact amount; the seam re-canonicalizes it
      // into the claim.
      const claim: EmbeddingCostClaim = {
        inputTokens: deps.source.inputTokens,
        uncachedCostUsd: Usd.from(deps.source.uncachedCostUsd).toAmount(),
      }
      return guardedStep(
        signal,
        () => deps.admission.run(claim, signal),
        (value) => receiptSchema.parse(value),
        (admitted) => {
          if (admitted.status !== 'ready') return refusal('engine-failure')
          const receipt = admitted.value
          return guardedStep(
            signal,
            () => {
              if (inputs.status === 'refused') throw new TypeError(inputs.reason)
              return deps.source.embed(inputs.value, signal)
            },
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
