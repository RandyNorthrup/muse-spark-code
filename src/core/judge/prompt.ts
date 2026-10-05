// The state-first prompt builder and batch planner (M98, D77). Pure: the
// state is never split, pending questions split across requests each
// carrying the full state, and an over-context state is refused outright.
// All model-facing wording is injected (it lives in MODEL_TEXT, lane 0), so
// this file holds structure only. No `vscode` import.

import type { JudgeQuestion } from './judge'

/**
 * Model-facing wording for one batch. Injected by the caller (lane S):
 * text the model reads lives in MODEL_TEXT, never as literals here.
 */
export interface JudgePromptWording {
  readonly systemInstruction: string
  readonly stateLabel: string
  readonly questionLabel: string
  /**
   * Render one answerable alternative: an option letter (choice), a level
   * digit (score), or null for a noul, which answers yes or no.
   */
  readonly formatAlternative: (letter: string | undefined, label: string) => string
}

export interface JudgePromptBatch {
  readonly system: string
  readonly user: string
  /**
   * The batch's question ids in order, for aligning responses. Never sent
   * to the model (as Jev).
   */
  readonly questionIds: readonly string[]
}

/** Why a batch plan was refused. A reason code; lane U says it. */
export type JudgePromptRefusal = 'over-context'

export type JudgeBatchPlan =
  | { readonly refused?: undefined; readonly batches: readonly JudgePromptBatch[] }
  | { readonly refused: JudgePromptRefusal; readonly batches?: undefined }

export interface PlanJudgeBatchesInputs {
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
  readonly wording: JudgePromptWording
  /** Questions per request; the state is never split. */
  readonly maxQuestionsPerBatch: number
  /**
   * The model's loaded context window in tokens (a ceiling only, D77).
   * The token joystick is injected: lane S measures with the model's own
   * counter.
   */
  readonly contextTokenLimit: number
  readonly measureTokens: (text: string) => number
}

// Answer tokens are one option letter A–Z, or one level digit 0–9 (D77);
// the request bounds (lane 0's schema) mirror these keyspaces.
const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LEVEL_DIGIT_COUNT = 10

function alternativeLetter(kind: JudgeQuestion['kind'], index: number): string {
  if (kind === 'choice') {
    const letter: string | undefined = OPTION_LETTERS[index]
    if (letter === undefined) {
      throw new RangeError('choice prompts address at most 26 options by letter')
    }
    return letter
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= LEVEL_DIGIT_COUNT) {
    throw new RangeError('score prompts address at most 10 levels by digit')
  }
  return String(index)
}

function renderQuestionText(question: JudgeQuestion, wording: JudgePromptWording): string {
  if (question.kind === 'noul') {
    if (question.options !== undefined && question.options.length > 0) {
      throw new RangeError('judge noul questions take no options')
    }
    return question.text
  }
  if (question.options === undefined || question.options.length === 0) {
    throw new RangeError(`judge ${question.kind} questions need options to render`)
  }
  const lines = question.options.map((option, index) =>
    wording.formatAlternative(alternativeLetter(question.kind, index), option),
  )
  return `${question.text}\n${lines.join('\n')}`
}

function measuredTokens(measure: (text: string) => number, text: string): number {
  const tokens = measure(text)
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new RangeError('judge token measurement must be finite and non-negative')
  }
  return tokens
}

/**
 * Plan the requests for one state and its pending questions. Every batch
 * carries the full state; only questions split. A state that plus the
 * longest question exceeds the model's context is refused with an explicit
 * no-answer (`over-context`) instead of being trimmed or split.
 */
export function planJudgeBatches(inputs: PlanJudgeBatchesInputs): JudgeBatchPlan {
  if (inputs.questions.length === 0) {
    throw new RangeError('judge batch planning needs at least one question')
  }
  if (!Number.isSafeInteger(inputs.maxQuestionsPerBatch) || inputs.maxQuestionsPerBatch < 1) {
    throw new RangeError('judge batches hold at least one question')
  }
  const stateTokens = measuredTokens(inputs.measureTokens, inputs.stateText)
  let longestQuestionTokens = 0
  const rendered = inputs.questions.map((question) => {
    const text = renderQuestionText(question, inputs.wording)
    longestQuestionTokens = Math.max(
      longestQuestionTokens,
      measuredTokens(inputs.measureTokens, text),
    )
    return { id: question.id, text }
  })
  if (stateTokens + longestQuestionTokens > inputs.contextTokenLimit) {
    return { refused: 'over-context' }
  }
  const batches: JudgePromptBatch[] = []
  for (let start = 0; start < rendered.length; start += inputs.maxQuestionsPerBatch) {
    const slice = rendered.slice(start, start + inputs.maxQuestionsPerBatch)
    const body = slice
      .map((question) => `${inputs.wording.questionLabel}${question.text}`)
      .join('\n')
    batches.push({
      system: inputs.wording.systemInstruction,
      user: `${inputs.wording.stateLabel}${inputs.stateText}\n${body}`,
      questionIds: slice.map((question) => question.id),
    })
  }
  return { batches }
}
