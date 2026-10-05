// The phase-1 same-model techniques (M98, D77): logprobs over distinct
// alternatives, binary-from-top-1 under its floor with a stated fallback,
// and the stated-confidence parser. Pure; the model call itself is lane S.
// No `vscode` import.

import * as z from 'zod/mini'
import type { AnswerMaterial, JudgeQuestionKind, JudgeTechnique } from './judge'
import { canonicalAnswerToken, renormalizeAlternatives, type LogprobAlternative } from './math'

/**
 * What a captured capability record says about logprobs: a real top-k, a
 * chosen token only, a refusal, or a silently dropped parameter (xAI, Z.ai).
 */
export type LogprobCapability = 'topk' | 'top1' | 'refused' | 'dropped'

/** The per-model capability the technique choice reads (D77). */
export interface ModelJudgeCapability {
  readonly logprobs: LogprobCapability
}

/**
 * Choose the technique from the captured capability, never per provider.
 * A top-1 estimate is excluded from choice, score and calibrated uses, so
 * non-noul questions on a top-1 model use stated confidence.
 */
export function selectTechnique(
  capability: ModelJudgeCapability,
  kind: JudgeQuestionKind,
): JudgeTechnique {
  switch (capability.logprobs) {
    case 'topk': {
      return 'logprobs'
    }
    case 'top1': {
      return kind === 'noul' ? 'top1' : 'stated'
    }
    case 'refused':
    case 'dropped': {
      return 'stated'
    }
  }
}

const logprobCandidateSchema = z.object({ token: z.string(), logprob: z.number() })
const logprobFieldSchema = z.array(logprobCandidateSchema)

/**
 * Read the top-k field of a response. Undefined means the engine cannot
 * answer from logprobs: a missing or dropped field (xAI, Z.ai), a wrong
 * shape, or an empty list. An engine failure, never read as certainty.
 */
export function parseLogprobCandidates(field: unknown): LogprobAlternative[] | undefined {
  const parsed = logprobFieldSchema.safeParse(field)
  return !parsed.success || parsed.data.length === 0 ? undefined : parsed.data
}

// Answer tokens are one option letter A–Z, or one level digit 0–9 (D77);
// the request bounds (lane 0's schema) mirror these keyspaces.
const OPTION_LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const LEVEL_DIGITS = '0123456789'

function alternativeCount(kind: JudgeQuestionKind, optionCount: number): number {
  if (kind === 'noul') {
    return 2
  }
  if (!Number.isSafeInteger(optionCount) || optionCount < 2) {
    throw new RangeError('logprob questions need at least two alternatives')
  }
  if (kind === 'choice' && optionCount > OPTION_LETTERS.length) {
    throw new RangeError('choice logprobs address at most 26 options by letter')
  }
  if (kind === 'score' && optionCount > LEVEL_DIGITS.length) {
    throw new RangeError('score logprobs address at most 10 levels by digit')
  }
  return optionCount
}

function indexKeyOf(
  kind: JudgeQuestionKind,
  optionCount: number,
): (canonical: string) => string | undefined {
  return (canonical: string): string | undefined => {
    if (kind === 'noul') {
      if (canonical === 'yes') {
        return '0'
      }
      return canonical === 'no' ? '1' : undefined
    }
    if (kind === 'choice') {
      const index = OPTION_LETTERS.indexOf(canonical)
      return index !== -1 && index < optionCount ? String(index) : undefined
    }
    const level = LEVEL_DIGITS.indexOf(canonical)
    return level !== -1 && level < optionCount ? String(level) : undefined
  }
}

export type LogprobMaterial =
  | { readonly outcome: 'answer'; readonly material: AnswerMaterial }
  | { readonly outcome: 'engine-failure' }

export interface LogprobInputs {
  readonly kind: JudgeQuestionKind
  /** Choice option count (2–26) or score level count (2–10); ignored for noul. */
  readonly optionCount: number
  readonly candidates: readonly LogprobAlternative[]
}

/**
 * Answer from a top-k: the renormalized mass of the distinct answer tokens.
 * `partial` when fewer distinct alternatives were seen than offered. No
 * answer token among the top-k is an engine failure.
 */
export function materialForLogprobs(inputs: LogprobInputs): LogprobMaterial {
  const alternatives = alternativeCount(inputs.kind, inputs.optionCount)
  const renormalized = renormalizeAlternatives(
    inputs.candidates,
    indexKeyOf(inputs.kind, alternatives),
  )
  if (renormalized.seenKeys.length === 0) {
    return { outcome: 'engine-failure' }
  }
  const probabilities: number[] = []
  for (let index = 0; index < alternatives; index += 1) {
    probabilities.push(renormalized.probabilities.get(String(index)) ?? 0)
  }
  return {
    outcome: 'answer',
    material: {
      probabilities,
      vendorConfidence: undefined,
      partial: renormalized.seenKeys.length < alternatives,
      residualMass: renormalized.residualMass,
      technique: 'logprobs',
    },
  }
}

/** The chosen token and its probability for binary-from-top-1. */
export interface Top1Reading {
  readonly token: string
  readonly probability: number
}

export type Top1Material =
  | { readonly outcome: 'answer'; readonly material: AnswerMaterial }
  | { readonly outcome: 'fallback-to-stated' }

/**
 * Binary-from-top-1, valid only for a noul whose top-1 token is a yes or
 * no variant at or above the floor (`JUDGE_TOP1_MIN_PROB`, lane 0). The
 * value is p for "yes", 1 − p for "no": the residual 1 − p is attributed
 * to the other answer although it may hold other tokens, so the floor
 * bounds that error at 1 − floor and the label stays "approximate
 * (top-1)". Anything else — a non-noul, a non-answer token, a corrupt or
 * under-floor probability — falls back to stated confidence; the RVM98
 * counterexample (no at 0.60 with yes at 0.10) falls back.
 */
export function materialForTop1(
  kind: JudgeQuestionKind,
  reading: Top1Reading,
  floor: number,
): Top1Material {
  if (!(floor > 0) || !(floor <= 1) || !Number.isFinite(floor)) {
    throw new RangeError('top-1 floor must be within (0, 1]')
  }
  const fallback = { outcome: 'fallback-to-stated' } as const
  if (kind !== 'noul') {
    return fallback
  }
  const canonical = canonicalAnswerToken(reading.token)
  const isYes = canonical === 'yes'
  if (!isYes && canonical !== 'no') {
    return fallback
  }
  const probability = reading.probability
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || probability < floor) {
    return fallback
  }
  const pYes = isYes ? probability : 1 - probability
  return {
    outcome: 'answer',
    material: {
      probabilities: [pYes, 1 - pYes],
      vendorConfidence: undefined,
      partial: false,
      residualMass: 1 - probability,
      technique: 'top1',
    },
  }
}

const noulStatedSchema = z.object({ answer: z.enum(['yes', 'no']), confidence: z.number() })
const distributionStatedSchema = z.object({ probabilities: z.array(z.number()) })

/** Why a stated-confidence response cannot be used. Never user text. */
export type StatedParseFailure =
  'missing-field' | 'bad-shape' | 'bad-range' | 'bad-length' | 'empty-distribution'

export type StatedMaterial =
  | { readonly outcome: 'answer'; readonly material: AnswerMaterial }
  | { readonly outcome: 'failure'; readonly failure: StatedParseFailure }

function hasMissingField(value: object, keys: readonly string[]): boolean {
  return keys.some((key) => !Object.hasOwn(value, key))
}

export interface StatedInputs {
  readonly kind: JudgeQuestionKind
  /** Choice option count or score level count; ignored for noul. */
  readonly optionCount: number
  /** The model's decoded JSON value. */
  readonly response: unknown
}

/**
 * Parse one structured stated-confidence response: `{answer, confidence
 * 0–100}` for a noul, or a 100-point `{probabilities}` distribution for a
 * choice or score. Values are normalized by us, exactly like logprob
 * masses; only shape violations fail. A missing field is a failure, never
 * read as certainty.
 */
export function materialForStated(inputs: StatedInputs): StatedMaterial {
  const failure = (reason: StatedParseFailure): StatedMaterial => ({
    outcome: 'failure',
    failure: reason,
  })
  if (inputs.kind === 'noul') {
    const parsed = noulStatedSchema.safeParse(inputs.response)
    if (!parsed.success) {
      if (typeof inputs.response !== 'object' || inputs.response === null) {
        return failure('bad-shape')
      }
      return failure(
        hasMissingField(inputs.response, ['answer', 'confidence']) ? 'missing-field' : 'bad-shape',
      )
    }
    const { answer, confidence } = parsed.data
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      return failure('bad-range')
    }
    const pYes = answer === 'yes' ? confidence / 100 : 1 - confidence / 100
    return {
      outcome: 'answer',
      material: {
        probabilities: [pYes, 1 - pYes],
        vendorConfidence: undefined,
        partial: false,
        residualMass: 0,
        technique: 'stated',
      },
    }
  }
  const parsed = distributionStatedSchema.safeParse(inputs.response)
  if (!parsed.success) {
    if (typeof inputs.response !== 'object' || inputs.response === null) {
      return failure('bad-shape')
    }
    return failure(
      hasMissingField(inputs.response, ['probabilities']) ? 'missing-field' : 'bad-shape',
    )
  }
  const { probabilities } = parsed.data
  if (probabilities.length !== inputs.optionCount) {
    return failure('bad-length')
  }
  let total = 0
  for (const value of probabilities) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return failure('bad-range')
    }
    total += value
  }
  if (total <= 0) {
    return failure('empty-distribution')
  }
  return {
    outcome: 'answer',
    material: {
      probabilities: probabilities.map((value) => value / total),
      vendorConfidence: undefined,
      partial: false,
      residualMass: 0,
      technique: 'stated',
    },
  }
}
