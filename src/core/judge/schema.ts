import { nonnegativeUsdSchema, type UsdAmount } from '../../shared/usd'
// The Muse Judge's contract (M98, PLAN.md D77): the Jev wire shapes for
// `noul`, `choice` and `score`, bounded at the intersection of the SystemOne
// services, plus our sibling `muse` object, so `answers` stays
// byte-compatible with any SystemOne client.
//
// The shapes follow TypeSafe's documented `/v1/systemone` wire as served by
// TypeSafe, OpenRouter (`typesafe/jev-1.13`), Ollama (`/v1/systemone`) and
// Cloudflare Clef (docs/certification/m98-research.md): a request carries a
// `state` and `questions` keyed by id; a response carries one typed answer
// per question id, the serving `model`, and token `usage`. A question id is
// never sent to a model. No `vscode` here: lanes J, A, S and U build on
// these schemas from either backend.

import * as z from 'zod/mini'
import {
  JUDGE_CHOICE_OPTION_MAX,
  JUDGE_CHOICE_OPTION_MIN,
  JUDGE_MAX_BODY_BYTES,
  JUDGE_QUESTION_MAX,
  JUDGE_QUESTION_MIN,
  JUDGE_SCORE_LEVEL_MAX,
  JUDGE_SCORE_LEVEL_MIN,
} from '../../shared/constants'

/** Where a verdict came from. Phase 1 emits only `same` (lane J's resolver). */
export const JUDGE_SOURCES = ['same', 'separate', 'both'] as const
export type JudgeSource = (typeof JUDGE_SOURCES)[number]

/** How the verdict was read. Phase 1 only; later sections add their own. */
export const JUDGE_TECHNIQUES = ['logprob', 'top1', 'stated'] as const
export type JudgeTechnique = (typeof JUDGE_TECHNIQUES)[number]

/**
 * What a verdict is labelled. Our confidence is always `1 − H(p)/ln N` and
 * computed by us; the backend's own value is kept as `vendorConfidence` and
 * never mixed with ours (PLAN.md D77).
 */
export const JUDGE_LABELS = [
  'calibrated (logprob)',
  'calibrated (stated)',
  'uncalibrated',
  'approximate (top-1)',
] as const
export type JudgeLabel = (typeof JUDGE_LABELS)[number]

/** A probability both we and the wire speak: inside 0 and 1, both held. */
const probabilitySchema = z.number().check(z.gte(0), z.lte(1))

/** Choice options are lettered A–Z, one letter per option. */
const optionLetterSchema = z.string().check(z.regex(/^[A-Z]$/))

const instructionsSchema = z.string().check(z.minLength(1))

const noulQuestionSchema = z.object({
  type: z.literal('noul'),
  instructions: instructionsSchema,
  // As Jev: optional, and only about `true` and `false`.
  criteria: z.optional(
    z.object({
      true: z.optional(z.string()),
      false: z.optional(z.string()),
    }),
  ),
})

const choiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: instructionsSchema,
  // As Jev: each option to its description, or null without one.
  criteria: z
    .record(optionLetterSchema, z.union([z.string(), z.null()]))
    .check(
      z.refine(
        (criteria) =>
          Object.keys(criteria).length >= JUDGE_CHOICE_OPTION_MIN &&
          Object.keys(criteria).length <= JUDGE_CHOICE_OPTION_MAX,
      ),
    ),
})

const scoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: instructionsSchema,
  // As Jev: the ordered level descriptions.
  criteria: z
    .array(z.string().check(z.minLength(1)))
    .check(z.minLength(JUDGE_SCORE_LEVEL_MIN), z.maxLength(JUDGE_SCORE_LEVEL_MAX)),
})

export const judgeQuestionSchema = z.discriminatedUnion('type', [
  noulQuestionSchema,
  choiceQuestionSchema,
  scoreQuestionSchema,
])
export type JudgeQuestion = z.infer<typeof judgeQuestionSchema>

/**
 * One judge request: the judged state (data, never split) and 1–64 pending
 * questions, each carrying the full state. The serialized body stays within
 * 64 KiB; an over-context state is refused with an explicit no-answer by
 * lane J against JUDGE_MAX_STATE_TOKENS.
 */
export const judgeRequestSchema = z
  .object({
    state: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
    questions: z
      .record(z.string(), judgeQuestionSchema)
      .check(
        z.refine(
          (questions) =>
            Object.keys(questions).length >= JUDGE_QUESTION_MIN &&
            Object.keys(questions).length <= JUDGE_QUESTION_MAX &&
            Object.keys(questions).every((id) => id.length > 0),
        ),
      ),
    // The model that answers. Unset in phase 1: the conversation's own model
    // judges through the backend and endpoint it already uses, and never
    // switches to another model.
    model: z.optional(z.string().check(z.minLength(1))),
  })
  .check(z.refine((request) => judgeRequestBytes(request) <= JUDGE_MAX_BODY_BYTES))
export type JudgeRequest = z.infer<typeof judgeRequestSchema>

/** The wire's bytes for a request, as the 64 KiB cap measures them. */
export function judgeRequestBytes(request: unknown): number {
  // `stringify` returns `undefined` for no request at all; the types do not
  // say so, so the check reads the value rather than the signature.
  const body: unknown = JSON.stringify(request)
  return new TextEncoder().encode(typeof body === 'string' ? body : '').length
}

// The vendors' answers, kept byte-compatible: loose objects, so anything the
// wire adds later (a goal status, an MSP-style field) is shown as it came
// rather than dropped (PLAN.md D36, M43). A missing required field is a
// failure, never read as certainty.

/** A `noul` gives p(yes): `noul` is P(true). It carries no `confidence`. */
export const jevNoulAnswerSchema = z.looseObject({
  type: z.literal('noul'),
  noul: probabilitySchema,
  probabilities: z.object({
    true: probabilitySchema,
    false: probabilitySchema,
  }),
})

/** A `choice` gives the option, its probabilities and a confidence. */
export const jevChoiceAnswerSchema = z.looseObject({
  type: z.literal('choice'),
  choice: z.string().check(z.minLength(1)),
  confidence: probabilitySchema,
  probabilities: z.record(z.string(), probabilitySchema),
})

/**
 * A `score` gives the expected level, the legend (level numbers as string
 * keys), the probabilities and a confidence.
 */
export const jevScoreAnswerSchema = z.looseObject({
  type: z.literal('score'),
  score: z.number(),
  confidence: probabilitySchema,
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), probabilitySchema),
})

export const jevAnswerSchema = z.discriminatedUnion('type', [
  jevNoulAnswerSchema,
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema,
])
export type JevAnswer = z.infer<typeof jevAnswerSchema>

/**
 * Our additions, in the sibling `muse` object keyed by the same question
 * ids: the source, technique and model that answered, the label, our
 * confidence, `partial` when fewer distinct semantic alternatives were seen
 * than there are options (case and leading-space variants count as one), and
 * the reserved and the settled cost.
 */
export const judgeMuseSchema = z.object({
  source: z.enum(JUDGE_SOURCES),
  technique: z.enum(JUDGE_TECHNIQUES),
  model: z.string().check(z.minLength(1)),
  label: z.enum(JUDGE_LABELS),
  confidence: probabilitySchema,
  vendorConfidence: z.optional(probabilitySchema),
  partial: z.boolean(),
  reservedCostUsd: z.optional(nonnegativeUsdSchema),
  settledCostUsd: z.optional(nonnegativeUsdSchema),
})
export type JudgeMuse = z.infer<typeof judgeMuseSchema>

/**
 * One answered call: the serving model, the byte-compatible `answers`, our
 * sibling `muse` (every answered id has one, and every one answers an id),
 * and the token usage. Top-level vendor additions (a reported cost, a goal
 * status) are kept, not dropped.
 */
export const judgeResultSchema = z
  .looseObject({
    model: z.string().check(z.minLength(1)),
    answers: z.record(z.string(), jevAnswerSchema),
    muse: z.record(z.string(), judgeMuseSchema),
    usage: z.looseObject({
      input_tokens: z.int().check(z.nonnegative()),
      output_tokens: z.int().check(z.nonnegative()),
    }),
  })
  .check(
    z.refine((result) => {
      const answered = Object.keys(result.answers)
      const noted = new Set(Object.keys(result.muse))
      return answered.length === noted.size && answered.every((id) => noted.has(id))
    }),
  )
export type JudgeResult = z.infer<typeof judgeResultSchema>

/**
 * The choice alphabet: one letter per option, A–Z, so
 * JUDGE_CHOICE_OPTION_MAX options is all of it. Lane J reads answers through
 * judgeOptionIndex and writes prompts through judgeOptionLetter.
 */
const JUDGE_OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * The 0-based option's letter: 0 is A, 25 is Z. Anything else is a caller
 * bug, refused loudly rather than lettered past Z.
 */
export function judgeOptionLetter(index: number): string {
  const letter =
    Number.isSafeInteger(index) && index >= 0 ? JUDGE_OPTION_LETTERS.at(index) : undefined
  if (letter === undefined) {
    throw new Error(`Judge option index ${String(index)} is outside A–Z`)
  }
  return letter
}

/** The option letter's 0-based index: A is 0, Z is 25. */
export function judgeOptionIndex(letter: string): number {
  const index = letter.length === 1 ? JUDGE_OPTION_LETTERS.indexOf(letter) : -1
  if (index < 0) {
    throw new Error(`Judge option ${JSON.stringify(letter)} is not a letter A–Z`)
  }
  return index
}

export interface JudgeLogMuse {
  readonly source: JudgeSource
  readonly technique: JudgeTechnique
  readonly model: string
  readonly label: JudgeLabel
  readonly partial: boolean
  readonly confidence: number
  readonly reservedCostUsd?: UsdAmount
  readonly settledCostUsd?: UsdAmount
}

export interface JudgeLogSummary {
  readonly ids: readonly string[]
  readonly model: string
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number }
  readonly muse: Readonly<Record<string, JudgeLogMuse>>
}

/**
 * What a judge result may put in the log: ids, source, technique, model,
 * timing and cost only (PLAN.md D77). Never the state, a question, an
 * answer or a probability key: those can carry workspace or user content,
 * and the CLI's own words in them are redacted like any pasted key's
 * surroundings. Timing rides beside this summary at the call site; there is
 * nothing to carry here.
 */
export function judgeLogSummary(result: JudgeResult): JudgeLogSummary {
  const muse: Record<string, JudgeLogMuse> = {}
  for (const [id, meta] of Object.entries(result.muse)) {
    muse[id] = {
      source: meta.source,
      technique: meta.technique,
      model: meta.model,
      label: meta.label,
      partial: meta.partial,
      confidence: meta.confidence,
      ...(meta.reservedCostUsd !== undefined && { reservedCostUsd: meta.reservedCostUsd }),
      ...(meta.settledCostUsd !== undefined && { settledCostUsd: meta.settledCostUsd }),
    }
  }
  return {
    ids: Object.keys(result.answers),
    model: result.model,
    usage: {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
    },
    muse,
  }
}
