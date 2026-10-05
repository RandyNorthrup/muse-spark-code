// Shared judge types and answer assembly (M98, D77, phase 1: same model).
// The zod request/answer/`muse` schemas and the named limits live in lane 0;
// this file holds the plan-named shapes those schemas bound, plus the pure
// assembly of a technique result into a labelled answer. No `vscode` import.

import { entropyConfidence } from './math'

/** Phase-1 question kinds, exactly TypeSafe's and Ollama's shapes (D77). */
export type JudgeQuestionKind = 'noul' | 'choice' | 'score'

export interface JudgeQuestion {
  /** Local id, never sent to a model (as Jev). */
  readonly id: string
  readonly kind: JudgeQuestionKind
  readonly text: string
  /**
   * Choice option labels (2–26) or score level labels (2–10). Absent for
   * noul, whose alternatives are yes and no.
   */
  readonly options?: readonly string[] | undefined
}

/** How one answer was produced. Per-model capability records choose (D77). */
export type JudgeTechnique = 'logprobs' | 'top1' | 'stated'

/**
 * The plan-named result labels. Phase 1 emits only "uncalibrated" and
 * "approximate (top-1)"; the calibrated labels wait for phase-2b profiles.
 */
export type JudgeLabel =
  'calibrated (logprob)' | 'calibrated (stated)' | 'uncalibrated' | 'approximate (top-1)'

/** Which model judged. Phase 1 is the conversation's own model only. */
export type JudgeSource = 'same'

/**
 * What a technique hands to assembly: one probability per alternative of
 * the question, in alternative order, summing to 1.
 */
export interface AnswerMaterial {
  readonly probabilities: readonly number[]
  /** The backend's own value, kept as-is and never mixed with ours. */
  readonly vendorConfidence?: number | undefined
  /**
   * Fewer distinct semantic alternatives were seen than the question
   * offers (case and leading-space variants count as one).
   */
  readonly partial: boolean
  /**
   * 1 minus the total answer-token mass. 0 for stated confidence, which
   * distributes over every alternative by construction.
   */
  readonly residualMass: number
  readonly technique: JudgeTechnique
}

/** The `muse` sibling: our additions beside byte-compatible `answers` (D77). */
export interface JudgeMuseMeta {
  readonly source: JudgeSource
  readonly technique: JudgeTechnique
  readonly model: string
  readonly label: JudgeLabel
  /** Always `1 − H(p)/ln N`, computed by us. */
  readonly confidence: number
  readonly vendorConfidence?: number | undefined
  readonly partial: boolean
  readonly reservedCostUsd?: number | undefined
  readonly settledCostUsd?: number | undefined
}

interface JudgeAnswerBase {
  readonly questionId: string
  readonly kind: JudgeQuestionKind
  readonly muse: JudgeMuseMeta
}

/** A noul answer carries p(yes). */
export interface JudgeNoulAnswer extends JudgeAnswerBase {
  readonly kind: 'noul'
  readonly pYes: number
}

/** A choice answer carries the winning option and every probability. */
export interface JudgeChoiceAnswer extends JudgeAnswerBase {
  readonly kind: 'choice'
  readonly optionIndex: number
  readonly probabilities: readonly number[]
}

/** A score answer carries the expected level and every probability. */
export interface JudgeScoreAnswer extends JudgeAnswerBase {
  readonly kind: 'score'
  readonly expectedLevel: number
  readonly probabilities: readonly number[]
}

export type JudgeAnswer = JudgeNoulAnswer | JudgeChoiceAnswer | JudgeScoreAnswer

/**
 * Phase-1 label for a technique: binary-from-top-1 is "approximate
 * (top-1)"; logprobs and stated confidence are "uncalibrated" until a
 * phase-2b profile exists (D77).
 */
export function labelForTechnique(technique: JudgeTechnique): JudgeLabel {
  return technique === 'top1' ? 'approximate (top-1)' : 'uncalibrated'
}

// How far assembled probabilities may stray from summing to 1 (float error
// from the techniques' own renormalization, never a model value).
const DISTRIBUTION_SUM_TOLERANCE = 1e-6

function checkDistribution(probabilities: readonly number[], alternatives: number): void {
  if (probabilities.length !== alternatives) {
    throw new RangeError(
      `judge answer needs one probability per alternative: ${String(probabilities.length)} for ${String(alternatives)}`,
    )
  }
  let total = 0
  for (const probability of probabilities) {
    if (!Number.isFinite(probability) || probability < 0) {
      throw new RangeError('judge answer needs finite non-negative probabilities')
    }
    total += probability
  }
  if (Math.abs(total - 1) > DISTRIBUTION_SUM_TOLERANCE) {
    throw new RangeError('judge answer probabilities must sum to 1')
  }
}

function checkOptions(question: JudgeQuestion, kind: 'choice' | 'score'): readonly string[] {
  if (question.options === undefined || question.options.length === 0) {
    throw new RangeError(`judge ${kind} question needs options`)
  }
  return question.options
}

export interface AssembleAnswerInputs {
  readonly question: JudgeQuestion
  readonly material: AnswerMaterial
  readonly model: string
  readonly reservedCostUsd?: number | undefined
  readonly settledCostUsd?: number | undefined
}

/**
 * Assemble one labelled answer from a technique result. Our confidence is
 * always the entropy formula over the material's distribution; the
 * backend's own value rides along untouched as `vendorConfidence`.
 */
export function assembleAnswer(inputs: AssembleAnswerInputs): JudgeAnswer {
  const { question, material, model } = inputs
  const muse: JudgeMuseMeta = {
    source: 'same',
    technique: material.technique,
    model,
    label: labelForTechnique(material.technique),
    confidence: entropyConfidence(material.probabilities),
    vendorConfidence: material.vendorConfidence,
    partial: material.partial,
    reservedCostUsd: inputs.reservedCostUsd,
    settledCostUsd: inputs.settledCostUsd,
  }
  switch (question.kind) {
    case 'noul': {
      checkDistribution(material.probabilities, 2)
      const pYes = material.probabilities[0]
      if (pYes === undefined) {
        throw new RangeError('judge noul answer needs p(yes)')
      }
      return { questionId: question.id, kind: 'noul', pYes, muse }
    }
    case 'choice': {
      const options = checkOptions(question, 'choice')
      checkDistribution(material.probabilities, options.length)
      let optionIndex = 0
      for (let index = 1; index < material.probabilities.length; index += 1) {
        if ((material.probabilities[index] ?? 0) > (material.probabilities[optionIndex] ?? 0)) {
          optionIndex = index
        }
      }
      return {
        questionId: question.id,
        kind: 'choice',
        optionIndex,
        probabilities: material.probabilities,
        muse,
      }
    }
    case 'score': {
      const levels = checkOptions(question, 'score')
      checkDistribution(material.probabilities, levels.length)
      let expectedLevel = 0
      for (let index = 0; index < material.probabilities.length; index += 1) {
        expectedLevel += index * (material.probabilities[index] ?? 0)
      }
      return {
        questionId: question.id,
        kind: 'score',
        expectedLevel,
        probabilities: material.probabilities,
        muse,
      }
    }
  }
}
