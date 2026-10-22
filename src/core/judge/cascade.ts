// The phase-2a cascade (M98, PLAN.md D77, 2a): the separate source first,
// a same-model follow-up below entropy `JUDGE_CASCADE_CONFIDENCE` or always
// for a high-stakes family, combined with B's fitted profile weights.
//
// Disagreement can only add caution: the combination is a convex blend of
// the two calibrated distributions, so a cautious dissent strictly moves
// caution against the permissive source alone, and no question resolves
// toward one side behind the other's back. A partial or top-1 result cannot
// enter the calibrated combiner. A failed or late separate output leaves
// phase-1 behaviour with the source that answered honestly reported. When
// neither side can combine on a question, the separate answer already in
// hand still stands as it came, and the envelope names the model that
// served the reported answers. Each
// side dispatches through its own injected run, which owns that side's
// admission claim: one side is never billed to the other's claim, and a
// retry or fan-out inside a side keeps that side's claims. The cascade
// itself attempts each side once per request. Pure core, no `vscode`
// import; fakes and fixtures only.

import * as z from 'zod/mini'
import { JUDGE_CASCADE_CONFIDENCE } from '../../shared/constants'
import { sumUsd } from '../../shared/usd'
import { applyCalibration } from './calibration/apply'
import type { CalibrationIdentity, CalibrationLimits } from './calibration/schema'
import { entropyConfidence } from './math'
import { isServedJudgeModel } from './served'
import { techniqueProbabilities, type JudgeTechniqueReceipt } from './sampling'
import {
  judgeCapabilitySchema,
  judgeMuseSchema,
  judgeResultSchema,
  jevAnswerSchema,
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeCapability,
  type JudgeMuse,
  type JudgeOutcome,
  type JudgeProfileIdentity,
  type JudgeQuestion,
  type JudgeRequest,
  type JevAnswer,
} from './schema'

/** One cascade side: an exact source identity, its pinned profile and its dispatch. */
export interface JudgeCascadeSide {
  /** Exact source/model/version/endpoint identity; never inferred. */
  readonly capability: JudgeCapability
  /** B's fitted profile for this side; validated here, never trusted blind. */
  readonly profile: unknown
  /**
  The profile version this selection approved. A reused stale profile
  refuses the combiner, exactly like any other identity mismatch.
  */
  readonly fitVersion: string
  /** P0's named calibration limits. */
  readonly limits: CalibrationLimits
  /**
  The technique this side's own selector chose for the family (a BYO side:
  `chooseByoTechnique`; a SystemOne side: its SystemOne wire). Profiles
  are looked up and qualified under exactly this technique; absent means
  the source supports none, so its evidence never qualifies a mode.
  */
  readonly technique?: JudgeProfileIdentity['technique'] | undefined
  /**
  Response model ids this side may report for its request id (a SystemOne
  alias resolves to a dated model). Absent means exactly the capability's
  model. A surface that checks the serving model reads this set.
  */
  readonly servedModels?: readonly string[] | undefined
  /**
  Dispatch one whole-request attempt with this side's own admission
  claim, settle once, refund only a known non-send. Each invocation is
  that side's own attempt; the cascade calls it at most once per side
  per request.
  */
  readonly run: (request: JudgeRequest, signal: AbortSignal) => Promise<JudgeTechniqueReceipt>
}

export interface JudgeCascadeOptions {
  readonly family: string
  readonly promptVersion: string
  readonly criteriaVersion: string
  /** A high-stakes family always invokes the same-model follow-up. */
  readonly highStakes: boolean
}

export interface JudgeCascadeDependencies {
  readonly same: JudgeCascadeSide
  readonly separate: JudgeCascadeSide
}

type NoAnswer = Extract<JudgeOutcome, { outcome: 'no-answer' }>
type NoAnswerReason = NoAnswer['reason']

// Reuse the captured envelope; parse verdicts/muses independently so an
// unnamed question cannot discard an honest sibling at settlement.
const cascadeAnsweredSchema = z.strictObject({
  outcome: z.literal('answered'),
  result: z.looseObject({
    ...judgeResultSchema.shape,
    answers: z.record(z.string(), z.unknown()),
    muse: z.record(z.string(), z.unknown()),
  }),
})
type CascadeSideResult = z.infer<typeof cascadeAnsweredSchema>['result']

/**
Whether the same-model follow-up runs: always for a high-stakes family,
otherwise when any separate confidence falls below
`JUDGE_CASCADE_CONFIDENCE`. The confidences are the actual entropy
confidences (`1 − H(p)/ln N`), not `|2p − 1|`: at p = 0.92 the prototype
gate reads 0.84 (no follow-up at a 0.8 bar) while entropy reads ~0.60
(follow-up), one of the 11 asks the specified gate adds over the
prototype's 17 (docs/certification/m98-research.md). Throws on an empty
or non-finite input rather than guessing a gate.
*/
export function shouldCascadeFollowUp(
  confidences: readonly number[],
  isHighStakes: boolean,
): boolean {
  if (confidences.length === 0) {
    throw new RangeError('cascade gate needs at least one confidence')
  }
  for (const confidence of confidences) {
    if (!Number.isFinite(confidence)) {
      throw new RangeError('cascade gate needs finite confidences')
    }
  }
  return isHighStakes || confidences.some((confidence) => confidence < JUDGE_CASCADE_CONFIDENCE)
}

export interface JudgeCascadeBlendInput {
  /** Calibrated masses over the question's alternatives, in order. */
  readonly distribution: readonly number[]
  /** That source's fitted profile weight. */
  readonly weight: number
}

export interface JudgeCascadeBlend {
  readonly distribution: readonly number[]
  /** Always the entropy confidence over the blend, never a vendor value. */
  readonly confidence: number
}

const BLEND_SUM_TOLERANCE = 1e-6

/**
Blend calibrated source distributions with their fitted profile weights
(normalized weighted mean). Equal raw weights are not a blend: the
weights come from B's profiles through `applyCalibration`. Throws on a
caller bug (empty, ragged, non-summing, non-finite or unweighted input)
rather than emitting a tuned-looking blend.
*/
export function combineCascadeDistributions(
  inputs: readonly JudgeCascadeBlendInput[],
): JudgeCascadeBlend {
  const width = inputs[0]?.distribution.length ?? 0
  if (inputs.length === 0 || width < 2) {
    throw new RangeError('cascade blend needs sources over at least two alternatives')
  }
  let weightTotal = 0
  for (const input of inputs) {
    if (input.distribution.length !== width) {
      throw new RangeError('cascade blend needs one distribution per alternative per source')
    }
    if (!Number.isFinite(input.weight) || input.weight <= 0) {
      throw new RangeError('cascade blend needs finite positive fitted weights')
    }
    let total = 0
    for (const mass of input.distribution) {
      if (!Number.isFinite(mass) || mass < 0) {
        throw new RangeError('cascade blend needs finite non-negative masses')
      }
      total += mass
    }
    if (Math.abs(total - 1) > BLEND_SUM_TOLERANCE) {
      throw new RangeError('cascade blend needs distributions that sum to 1')
    }
    weightTotal += input.weight
  }
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
    throw new RangeError('cascade blend needs a finite positive total weight')
  }
  const distribution = Array.from({ length: width }, (_, index) => {
    let mass = 0
    for (const input of inputs) {
      mass += input.weight * (input.distribution[index] ?? 0)
    }
    return mass / weightTotal
  })
  return { distribution, confidence: entropyConfidence(distribution) }
}

/** The model that actually served a side: its accepted reported id, else its request id. */
function servingModel(attempt: SideAttempt, side: JudgeCascadeSide): string {
  return attempt.status === 'answered' ? attempt.result.model : side.capability.model
}

function isSideReady(side: JudgeCascadeSide, model: string | undefined): boolean {
  return (
    typeof side.run === 'function' &&
    side.fitVersion.length > 0 &&
    judgeCapabilitySchema.safeParse(side.capability).success &&
    (model === undefined || isServedJudgeModel(model, side.capability.model, side.servedModels))
  )
}

interface EligibleAnswer {
  readonly distribution: readonly number[]
  readonly calibrated: readonly number[]
  readonly weight: number
}

function calibratedWeight(applied: { readonly combinationWeight: number }): number | undefined {
  return Number.isFinite(applied.combinationWeight) && applied.combinationWeight > 0
    ? applied.combinationWeight
    : undefined
}

interface AppliedSideMass {
  readonly probability: number
  readonly weight: number
}

/** One mass through this side's profile: the calibrated probability and B's fitted weight. */
function applySideMass(
  side: JudgeCascadeSide,
  identity: CalibrationIdentity,
  mass: number,
): AppliedSideMass | undefined {
  const applied = applyCalibration(side.profile, identity, mass, false, side.limits)
  if (applied.status !== 'calibrated') {
    return undefined
  }
  if (!Number.isFinite(applied.probability) || applied.probability < 0 || applied.probability > 1) {
    return undefined
  }
  const weight = calibratedWeight(applied)
  return weight === undefined ? undefined : { probability: applied.probability, weight }
}

function calibrateSide(
  side: JudgeCascadeSide,
  identity: CalibrationIdentity,
  question: JudgeQuestion,
  distribution: readonly number[],
): EligibleAnswer | undefined {
  try {
    if (question.type === 'noul') {
      // Binary contract: the profile maps p(yes) and p(no) is its
      // complement. Calibrating both masses and renormalizing would erase
      // the fitted positive-class bias correction (two 0.5 masses through
      // a biased profile renormalize back to 0.5).
      if (distribution.length !== 2) {
        return undefined
      }
      const mass = distribution[0]
      if (mass === undefined) {
        return undefined
      }
      const applied = applySideMass(side, identity, mass)
      return applied === undefined
        ? undefined
        : {
            distribution,
            calibrated: [applied.probability, 1 - applied.probability],
            weight: applied.weight,
          }
    }
    // Multi-alternative contract: each alternative's mass gets the same
    // independent binary bias correction, renormalized to a distribution.
    // There is no complement for three or more alternatives, so this is
    // the cascade's stated combiner input (not B's evaluated predictor).
    const calibrated: number[] = []
    let weight: number | undefined
    for (const mass of distribution) {
      const applied = applySideMass(side, identity, mass)
      if (applied === undefined) {
        return undefined
      }
      calibrated.push(applied.probability)
      weight = applied.weight
    }
    if (weight === undefined) {
      return undefined
    }
    let total = 0
    for (const mass of calibrated) {
      total += mass
    }
    return !Number.isFinite(total) || total <= 0
      ? undefined
      : { distribution, calibrated: calibrated.map((mass) => mass / total), weight }
  } catch {
    return undefined
  }
}

function eligibleAnswer(
  outcome: CascadeSideResult,
  side: JudgeCascadeSide,
  id: string,
  question: JudgeQuestion,
  family: string,
  promptVersion: string,
  criteriaVersion: string,
): EligibleAnswer | undefined {
  try {
    const named = namedAnswer(outcome, side, id, question)
    if (named === undefined || named.meta.partial || named.meta.technique === 'top1') {
      // Partial and top-1 results cannot enter the calibrated combiner.
      return undefined
    }
    const { answer, meta } = named
    const distribution = techniqueProbabilities(question, answer)
    if (distribution === undefined) {
      return undefined
    }
    const identity: CalibrationIdentity = {
      source: side.capability.source,
      providerId: side.capability.providerId,
      model: side.capability.model,
      modelVersion: side.capability.modelVersion,
      endpoint: side.capability.endpoint,
      technique: meta.technique,
      family,
      promptVersion,
      criteriaVersion,
      fitVersion: side.fitVersion,
    }
    return calibrateSide(side, identity, question, distribution)
  } catch {
    return undefined
  }
}

/** Dispatch records facts only; settlement alone publishes an outcome. */
type SideAttempt =
  | {
      readonly status: 'answered'
      readonly receipt: JudgeTechniqueReceipt
      readonly result: CascadeSideResult
    }
  | { readonly status: 'failed'; readonly reason: NoAnswerReason; readonly malformed?: true }
  | { readonly status: 'not-run'; readonly reason: 'not-needed' | 'source-unavailable' }

async function attemptSide(
  side: JudgeCascadeSide,
  request: JudgeRequest,
  signal: AbortSignal,
): Promise<SideAttempt> {
  try {
    const receipt = await side.run(request, signal)
    const refused = judgeOutcomeSchema.safeParse(receipt.outcome)
    if (refused.success && refused.data.outcome === 'no-answer') {
      return { status: 'failed', reason: refused.data.reason }
    }
    const parsed = cascadeAnsweredSchema.safeParse(receipt.outcome)
    if (!parsed.success) return { status: 'failed', reason: 'engine-failure', malformed: true }
    const result = parsed.data.result
    const ids = Object.keys(request.questions)
    const answered = Object.keys(result.answers)
    return !isServedJudgeModel(result.model, side.capability.model, side.servedModels) ||
      answered.length !== ids.length ||
      ids.some((id) => !answered.includes(id))
      ? { status: 'failed', reason: 'engine-failure', malformed: true }
      : { status: 'answered', receipt, result }
  } catch {
    return { status: 'failed', reason: 'engine-failure' }
  }
}

interface CascadeAttempts {
  request?: JudgeRequest
  separate: SideAttempt
  same: SideAttempt
  reason?: NoAnswerReason
}

async function collectCascadeAttempts(
  request: JudgeRequest,
  options: JudgeCascadeOptions,
  deps: JudgeCascadeDependencies,
  signal: AbortSignal,
): Promise<CascadeAttempts> {
  const isAborted = (): boolean => signal.aborted
  const attempts: CascadeAttempts = {
    separate: { status: 'not-run', reason: 'source-unavailable' },
    same: { status: 'not-run', reason: 'source-unavailable' },
  }
  if (isAborted()) return { ...attempts, reason: 'cancelled' }
  const parsed = judgeRequestSchema.safeParse(request)
  if (
    !parsed.success ||
    options.family.length === 0 ||
    options.promptVersion.length === 0 ||
    options.criteriaVersion.length === 0
  ) {
    return { ...attempts, reason: 'engine-failure' }
  }
  const body = parsed.data
  attempts.request = body
  const isSeparateReady =
    deps.separate.capability.source === 'separate' && isSideReady(deps.separate, body.model)
  const isSameReady = deps.same.capability.source === 'same' && isSideReady(deps.same, body.model)
  if (!isSeparateReady && !isSameReady) {
    return { ...attempts, reason: 'capability-unavailable' }
  }
  if (isSeparateReady) {
    attempts.separate = await attemptSide(deps.separate, body, signal)
  }
  if (isAborted()) return attempts
  if (attempts.separate.status === 'failed' && attempts.separate.malformed === true) {
    return { ...attempts, reason: 'engine-failure' }
  }
  if (attempts.separate.status === 'answered') {
    const confidences: number[] = []
    for (const [id, question] of Object.entries(body.questions)) {
      const answer = eligibleAnswer(
        attempts.separate.result,
        deps.separate,
        id,
        question,
        options.family,
        options.promptVersion,
        options.criteriaVersion,
      )
      if (answer !== undefined) confidences.push(entropyConfidence(answer.distribution))
    }
    const isNeedsFollowUp =
      options.highStakes ||
      (confidences.length > 0 && shouldCascadeFollowUp(confidences, options.highStakes))
    if (!isNeedsFollowUp) {
      attempts.same = { status: 'not-run', reason: 'not-needed' }
      return attempts
    }
  }
  if (isSameReady) {
    attempts.same = await attemptSide(deps.same, body, signal)
  } else if (attempts.separate.status !== 'answered') {
    attempts.reason = 'source-unavailable'
  }
  return attempts
}

/** A verdict belongs to this question and the side/model that actually served it. */
function namedAnswer(
  result: CascadeSideResult | undefined,
  side: JudgeCascadeSide,
  id: string,
  question: JudgeQuestion,
): { readonly answer: JevAnswer; readonly meta: JudgeMuse } | undefined {
  if (result === undefined) return undefined
  const parsedAnswer = jevAnswerSchema.safeParse(result.answers[id])
  const parsedMeta = judgeMuseSchema.safeParse(result.muse[id])
  if (!parsedAnswer.success || !parsedMeta.success) return undefined
  const answer = parsedAnswer.data
  const meta = parsedMeta.data
  return meta.source !== side.capability.source ||
    !isServedJudgeModel(meta.model, side.capability.model, side.servedModels) ||
    techniqueProbabilities(question, answer) === undefined
    ? undefined
    : { answer, meta }
}

/**
The blend's masses keyed by alternative, in question order. Built from
the question (never from an answer's key order, which the wire may
shuffle); `techniqueProbabilities` already proved the masses belong to
these alternatives.
*/
function blendProbabilities(
  question: JudgeQuestion,
  distribution: readonly number[],
): Record<string, number> {
  if (question.type === 'noul') {
    return { true: distribution[0] ?? 0, false: distribution[1] ?? 0 }
  }
  const labels =
    question.type === 'choice'
      ? Object.keys(question.criteria)
      : question.criteria.map((_, index) => String(index))
  return Object.fromEntries(labels.map((label, index) => [label, distribution[index] ?? 0]))
}

/**
The only publisher. Every path checks named verdicts, keeps honest answers,
records follow-up facts and names the serving model; no receipt passes through.
*/
function settleCascade(
  attempts: CascadeAttempts,
  options: JudgeCascadeOptions,
  deps: JudgeCascadeDependencies,
  signal: AbortSignal,
): JudgeOutcome {
  const refusal = (reason: NoAnswerReason): JudgeOutcome => ({ outcome: 'no-answer', reason })
  try {
    if (signal.aborted) return refusal('cancelled')
    if (attempts.reason !== undefined) return refusal(attempts.reason)
    const body = attempts.request
    if (body === undefined) return refusal('engine-failure')
    const { separate, same } = attempts
    const answers: Record<string, JevAnswer> = {}
    const muse: Record<string, JudgeMuse> = {}
    const refusedQuestions: string[] = []
    const describeAttempt = (attempt: SideAttempt, side: JudgeCascadeSide) => {
      if (attempt.status !== 'answered') return { status: attempt.status, reason: attempt.reason }
      const isNamed = Object.entries(body.questions).some(
        ([id, question]) => namedAnswer(attempt.result, side, id, question) !== undefined,
      )
      return isNamed ? { status: 'answered' } : { status: 'failed', reason: 'engine-failure' }
    }
    for (const [id, question] of Object.entries(body.questions)) {
      const separateNamed = namedAnswer(
        separate.status === 'answered' ? separate.result : undefined,
        deps.separate,
        id,
        question,
      )
      const sameNamed = namedAnswer(
        same.status === 'answered' ? same.result : undefined,
        deps.same,
        id,
        question,
      )
      const eligible = (attempt: SideAttempt, side: JudgeCascadeSide) =>
        attempt.status === 'answered'
          ? eligibleAnswer(
              attempt.result,
              side,
              id,
              question,
              options.family,
              options.promptVersion,
              options.criteriaVersion,
            )
          : undefined
      const separateAnswer = eligible(separate, deps.separate)
      const sameAnswer = eligible(same, deps.same)
      if (separateAnswer === undefined || sameAnswer === undefined) {
        // Both real bodies: combinable wins; otherwise only the original
        // separate verdict stands. A foreign fallback is refused per question.
        let standing = separateNamed ?? sameNamed
        if (separate.status === 'answered' && same.status === 'answered') {
          standing = sameAnswer === undefined ? separateNamed : sameNamed
        }
        if (standing === undefined) {
          refusedQuestions.push(id)
          continue
        }
        answers[id] = standing.answer
        muse[id] = standing.meta
        continue
      }
      if (separate.status !== 'answered' || same.status !== 'answered') {
        return refusal('engine-failure')
      }
      const blend = combineCascadeDistributions([
        { distribution: separateAnswer.calibrated, weight: separateAnswer.weight },
        { distribution: sameAnswer.calibrated, weight: sameAnswer.weight },
      ])
      const probabilities = blendProbabilities(question, blend.distribution)
      const costs = {
        reservedCostUsd: sumUsd(separate.receipt.reservedCostUsd, same.receipt.reservedCostUsd),
        settledCostUsd: sumUsd(separate.receipt.settledCostUsd, same.receipt.settledCostUsd),
        uncertainCostUsd: sumUsd(separate.receipt.uncertainCostUsd, same.receipt.uncertainCostUsd),
      }
      if (question.type === 'noul') {
        answers[id] = {
          type: 'noul',
          noul: blend.distribution[0] ?? 0,
          probabilities: {
            true: blend.distribution[0] ?? 0,
            false: blend.distribution[1] ?? 0,
          },
        }
      } else if (question.type === 'choice') {
        const letters = Object.keys(question.criteria)
        const winner = blend.distribution.indexOf(Math.max(...blend.distribution))
        answers[id] = {
          type: 'choice',
          choice: letters[winner] ?? '',
          confidence: blend.confidence,
          probabilities,
        }
      } else {
        answers[id] = {
          type: 'score',
          score: blend.distribution.reduce((sum, mass, index) => sum + mass * index, 0),
          confidence: blend.confidence,
          probabilities,
          legend: Object.fromEntries(
            question.criteria.map((label, index) => [String(index), label]),
          ),
        }
      }
      muse[id] = {
        source: 'both',
        technique: 'cascade',
        model: servingModel(separate, deps.separate),
        // No cascade-level profile exists: M75's held-out paired runs of
        // same-only, separate-only and this cascade must first certify one.
        label: 'uncalibrated',
        confidence: blend.confidence,
        partial: false,
        ...costs,
      }
    }
    if (Object.keys(answers).length === 0) {
      if (separate.status === 'answered' || same.status === 'answered') {
        return refusal('engine-failure')
      }
      return refusal(same.status === 'failed' ? same.reason : 'source-unavailable')
    }
    const results = [separate, same].flatMap((attempt) =>
      attempt.status === 'answered' ? [attempt.result] : [],
    )
    if (results.length === 0) return refusal('engine-failure')
    const inputTokens = results.reduce((sum, result) => sum + result.usage.input_tokens, 0)
    const outputTokens = results.reduce((sum, result) => sum + result.usage.output_tokens, 0)
    if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
      return refusal('engine-failure')
    }
    const isSameOnly = Object.values(muse).every((meta) => meta.source === 'same')
    // The published envelope names only fields with a defined settlement
    // rule: the serving model, the settled answers and muse, the summed
    // token counts, and the cascade facts. Loose keys on either side's body
    // (a reported cost, a goal status, extra usage keys) have no combination
    // rule, so none is copied: no spread from a side that did not serve
    // the verdict.
    const combined = judgeOutcomeSchema.safeParse({
      outcome: 'answered',
      result: {
        model: isSameOnly ? servingModel(same, deps.same) : servingModel(separate, deps.separate),
        answers,
        muse,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        cascade: {
          separate: describeAttempt(separate, deps.separate),
          same: describeAttempt(same, deps.same),
          refusedQuestions,
        },
      },
    })
    return combined.success ? combined.data : refusal('engine-failure')
  } catch {
    return refusal(signal.aborted ? 'cancelled' : 'engine-failure')
  }
}

/** Separate first, optional same-model follow-up, then exactly one settlement. */
export async function cascadeJudge(
  request: JudgeRequest,
  options: JudgeCascadeOptions,
  deps: JudgeCascadeDependencies,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  let attempts: CascadeAttempts
  try {
    attempts = await collectCascadeAttempts(request, options, deps, signal)
  } catch {
    attempts = {
      separate: { status: 'not-run', reason: 'source-unavailable' },
      same: { status: 'not-run', reason: 'source-unavailable' },
      reason: signal.aborted ? 'cancelled' : 'engine-failure',
    }
  }
  return settleCascade(attempts, options, deps, signal)
}
