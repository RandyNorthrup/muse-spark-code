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

import { JUDGE_CASCADE_CONFIDENCE } from '../../shared/constants'
import { applyCalibration } from './calibration/apply'
import type { CalibrationIdentity, CalibrationLimits } from './calibration/schema'
import { entropyConfidence } from './math'
import { techniqueProbabilities, type JudgeTechniqueReceipt } from './sampling'
import {
  judgeCapabilitySchema,
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeCapability,
  type JudgeMuse,
  type JudgeOutcome,
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
   * The profile version this selection approved. A reused stale profile
   * refuses the combiner, exactly like any other identity mismatch.
   */
  readonly fitVersion: string
  /** P0's named calibration limits. */
  readonly limits: CalibrationLimits
  /**
   * Dispatch one whole-request attempt with this side's own admission
   * claim, settle once, refund only a known non-send. Each invocation is
   * that side's own attempt; the cascade calls it at most once per side
   * per request.
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

function refusal(reason: NoAnswerReason): JudgeOutcome {
  return { outcome: 'no-answer', reason }
}

/**
 * Whether the same-model follow-up runs: always for a high-stakes family,
 * otherwise when any separate confidence falls below
 * `JUDGE_CASCADE_CONFIDENCE`. The confidences are the actual entropy
 * confidences (`1 − H(p)/ln N`), not `|2p − 1|`: at p = 0.92 the prototype
 * gate reads 0.84 (no follow-up at a 0.8 bar) while entropy reads ~0.60
 * (follow-up), one of the 11 asks the specified gate adds over the
 * prototype's 17 (docs/certification/m98-research.md). Throws on an empty
 * or non-finite input rather than guessing a gate.
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
 * Blend calibrated source distributions with their fitted profile weights
 * (normalized weighted mean). Equal raw weights are not a blend: the
 * weights come from B's profiles through `applyCalibration`. Throws on a
 * caller bug (empty, ragged, non-summing, non-finite or unweighted input)
 * rather than emitting a tuned-looking blend.
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

function isSideReady(side: JudgeCascadeSide, model: string | undefined): boolean {
  return (
    typeof side.run === 'function' &&
    side.fitVersion.length > 0 &&
    judgeCapabilitySchema.safeParse(side.capability).success &&
    (model === undefined || model === side.capability.model)
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
  outcome: Extract<JudgeOutcome, { outcome: 'answered' }>['result'],
  side: JudgeCascadeSide,
  id: string,
  question: JudgeQuestion,
  family: string,
  promptVersion: string,
  criteriaVersion: string,
): EligibleAnswer | undefined {
  try {
    const meta = outcome.muse[id]
    const answer = outcome.answers[id]
    if (
      answer === undefined ||
      meta?.source !== side.capability.source ||
      meta.model !== side.capability.model ||
      meta.partial ||
      meta.technique === 'top1'
    ) {
      // Partial and top-1 results cannot enter the calibrated combiner;
      // anything from another source or model is not this side's answer.
      return undefined
    }
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

function isSideOutcome(
  outcome: JudgeOutcome,
  side: JudgeCascadeSide,
  ids: readonly string[],
): outcome is Extract<JudgeOutcome, { outcome: 'answered' }> {
  if (outcome.outcome !== 'answered' || outcome.result.model !== side.capability.model) {
    return false
  }
  const answered = Object.keys(outcome.result.answers)
  return answered.length === ids.length && ids.every((id) => answered.includes(id))
}

/**
 * One side dispatch: a thrown ledger or transport failure is no output from
 * that side (the cascade falls back), never a thrown cascade. Aborts stay
 * visible through the caller's own signal checks.
 */
type SideAttempt =
  | { readonly dispatched: true; readonly receipt: JudgeTechniqueReceipt }
  | { readonly dispatched: false }

async function attemptSide(
  side: JudgeCascadeSide,
  request: JudgeRequest,
  signal: AbortSignal,
): Promise<SideAttempt> {
  try {
    return { dispatched: true, receipt: await side.run(request, signal) }
  } catch {
    return { dispatched: false }
  }
}

/**
 * The blend's masses keyed by alternative, in question order. Built from
 * the question (never from an answer's key order, which the wire may
 * shuffle); `techniqueProbabilities` already proved the masses belong to
 * these alternatives.
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
 * Run the cascade: the separate source first, then the same-model
 * follow-up where the gate asks for it, combined per question with fitted
 * weights. A side that fails, arrives late (aborted) or answers nothing
 * combinable leaves the other side's answer standing with its own honest
 * source; only a question neither side can answer refuses the run. The
 * same model stays the conversation's model throughout: the cascade reads
 * its answers, never reselects it.
 */
export async function cascadeJudge(
  request: JudgeRequest,
  options: JudgeCascadeOptions,
  deps: JudgeCascadeDependencies,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  // Read through a closure: an AbortSignal flips from the outside,
  // so a single read must never narrow the later ones (as sampling does).
  const isAborted = (): boolean => signal.aborted
  try {
    if (isAborted()) {
      return refusal('cancelled')
    }
    const parsed = judgeRequestSchema.safeParse(request)
    if (
      !parsed.success ||
      options.family.length === 0 ||
      options.promptVersion.length === 0 ||
      options.criteriaVersion.length === 0
    ) {
      return refusal('engine-failure')
    }
    const body = parsed.data
    const ids = Object.keys(body.questions)
    const isSeparateReady = isSideReady(deps.separate, body.model)
    const isSameReady = isSideReady(deps.same, body.model)
    if (!isSeparateReady && !isSameReady) {
      return refusal('capability-unavailable')
    }
    const sameFallback = async (): Promise<JudgeOutcome> => {
      if (!isSameReady) {
        return refusal('source-unavailable')
      }
      let receipt: JudgeTechniqueReceipt | undefined
      try {
        receipt = await deps.same.run(body, signal)
      } catch {
        return refusal(isAborted() ? 'cancelled' : 'engine-failure')
      }
      if (isAborted()) {
        return refusal('cancelled')
      }
      if (receipt.outcome.outcome !== 'answered') {
        return receipt.outcome
      }
      return isSideOutcome(receipt.outcome, deps.same, ids)
        ? receipt.outcome
        : refusal('engine-failure')
    }
    if (!isSeparateReady) {
      return await sameFallback()
    }
    const separateAttempt = await attemptSide(deps.separate, body, signal)
    if (isAborted()) {
      return refusal('cancelled')
    }
    if (
      !separateAttempt.dispatched ||
      !isSideOutcome(separateAttempt.receipt.outcome, deps.separate, ids)
    ) {
      // Failed or late separate output: phase-1 behaviour.
      if (separateAttempt.dispatched && separateAttempt.receipt.outcome.outcome === 'answered') {
        return refusal('engine-failure')
      }
      // The separate side failed: the fallback's verdict stands, exactly
      // as the same source alone would report it (phase-1 behaviour).
      return await sameFallback()
    }
    const separate = separateAttempt.receipt
    const separateResult = separateAttempt.receipt.outcome.result
    const eligible = new Map<string, EligibleAnswer>()
    for (const id of ids) {
      const question = body.questions[id]
      if (question === undefined) {
        return refusal('engine-failure')
      }
      const answer = eligibleAnswer(
        separateResult,
        deps.separate,
        id,
        question,
        options.family,
        options.promptVersion,
        options.criteriaVersion,
      )
      if (answer !== undefined) {
        eligible.set(id, answer)
      }
    }
    const confidences = Array.from(eligible.values(), (answer) =>
      entropyConfidence(answer.distribution),
    )
    // PLAN 2a: every high-stakes question invokes same. A separate answer
    // that cannot enter the combiner (partial, top-1, uncalibrated) must
    // not suppress that follow-up, so the high-stakes gate runs before
    // the eligibility short-circuit (an empty confidence list would throw
    // in the gate, and means no follow-up only outside high stakes).
    const isNeedsFollowUp =
      options.highStakes ||
      (confidences.length > 0 && shouldCascadeFollowUp(confidences, options.highStakes))
    if (!isNeedsFollowUp) {
      // The separate source answered, but nothing can enter the combiner:
      // report it as it came rather than manufacturing a blend.
      return separateAttempt.receipt.outcome
    }
    if (!isSameReady) {
      // No eligible same side (a model binding or capability mismatch):
      // report the separate answer rather than dispatching a doomed call.
      return separateAttempt.receipt.outcome
    }
    const sameAttempt = await attemptSide(deps.same, body, signal)
    if (isAborted()) {
      return refusal('cancelled')
    }
    if (!sameAttempt.dispatched || !isSideOutcome(sameAttempt.receipt.outcome, deps.same, ids)) {
      // A failed same follow-up leaves the separate answer standing.
      return separateAttempt.receipt.outcome
    }
    const same = sameAttempt.receipt
    const sameResult = sameAttempt.receipt.outcome.result
    const answers: Record<string, JevAnswer> = {}
    const muse: Record<string, JudgeMuse> = {}
    const inputTokens = separateResult.usage.input_tokens + sameResult.usage.input_tokens
    const outputTokens = separateResult.usage.output_tokens + sameResult.usage.output_tokens
    if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) {
      return refusal('engine-failure')
    }
    for (const id of ids) {
      const question = body.questions[id]
      if (question === undefined) {
        return refusal('engine-failure')
      }
      const separateAnswer = eligible.get(id)
      const sameAnswer = eligibleAnswer(
        sameResult,
        deps.same,
        id,
        question,
        options.family,
        options.promptVersion,
        options.criteriaVersion,
      )
      if (separateAnswer === undefined && sameAnswer === undefined) {
        // Neither side can combine here, but the separate answer already
        // in hand is still real: report it as it came (partial or top-1
        // as the side marked it), never as an engine failure. Only when it
        // really is this separate side's answer; anything else is a broken
        // side, not a combinable miss.
        const standingAnswer = separateResult.answers[id]
        const standingMeta = separateResult.muse[id]
        if (
          standingAnswer === undefined ||
          standingMeta?.source !== deps.separate.capability.source ||
          standingMeta.model !== deps.separate.capability.model
        ) {
          return refusal('engine-failure')
        }
        answers[id] = standingAnswer
        muse[id] = standingMeta
        continue
      }
      if (separateAnswer === undefined || sameAnswer === undefined) {
        // One side alone: pass its answer through untouched, honestly sourced.
        const standing = separateAnswer === undefined ? sameResult : separateResult
        const standingAnswer = standing.answers[id]
        const standingMeta = standing.muse[id]
        if (standingAnswer === undefined || standingMeta === undefined) {
          return refusal('engine-failure')
        }
        answers[id] = standingAnswer
        muse[id] = standingMeta
        continue
      }
      const blend = combineCascadeDistributions([
        { distribution: separateAnswer.calibrated, weight: separateAnswer.weight },
        { distribution: sameAnswer.calibrated, weight: sameAnswer.weight },
      ])
      const probabilities = blendProbabilities(question, blend.distribution)
      const costs = {
        reservedCostUsd: separate.reservedCostUsd + same.reservedCostUsd,
        settledCostUsd: separate.settledCostUsd + same.settledCostUsd,
        uncertainCostUsd: separate.uncertainCostUsd + same.uncertainCostUsd,
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
        model: deps.separate.capability.model,
        // No cascade-level profile exists: M75's held-out paired runs of
        // same-only, separate-only and this cascade must first certify one.
        label: 'uncalibrated',
        confidence: blend.confidence,
        partial: false,
        ...costs,
      }
    }
    // The serving model: every reported muse names the model that answered
    // it (a blend follows the separate convention), so the envelope names
    // the separate model unless every question stands on the same side
    // alone — never the separate model for a same-model answer.
    const isSameOnly = ids.every((id) => muse[id]?.model === deps.same.capability.model)
    const combined = judgeOutcomeSchema.safeParse({
      outcome: 'answered',
      result: {
        model: isSameOnly ? deps.same.capability.model : deps.separate.capability.model,
        answers,
        muse,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      },
    })
    return combined.success ? combined.data : refusal('engine-failure')
  } catch {
    return refusal(isAborted() ? 'cancelled' : 'engine-failure')
  }
}
