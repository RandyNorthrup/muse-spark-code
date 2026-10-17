import { type UsdAmount } from '../../../shared/usd'
// One judge batch's answers from its reply text (M98 lane S, PLAN.md D77):
// the shared stated-confidence settle both backends run after their call.
// The reply's JSON value is decoded (the whole text, or its outermost object
// when the model adds words around it), read per question through lane J's
// stated parser, and assembled into labelled answers. A missing field is a
// failure, never certainty; only a `noul` at or above the advisory threshold
// settles `caution`, since phase 1's only use is the Auto risk advisory and a
// "safe" answer leaves every verdict unchanged. Pure; no `vscode` import.

import { JUDGE_ADVISORY_THRESHOLD } from '../../../shared/constants'
import { assembleAnswer, type JudgeAnswer, type JudgeQuestion } from '../judge'
import { materialForStated } from '../techniques'

/** Why a batch settled without answers. Reason codes, never model text. */
export type BatchSettleFailure =
  'unparseable' | 'missing-field' | 'bad-shape' | 'bad-range' | 'bad-length' | 'empty-distribution'

export type BatchSettleResult =
  | {
      readonly status: 'answered'
      readonly answers: readonly JudgeAnswer[]
      readonly outcome: 'caution' | 'none'
    }
  | { readonly status: 'failure'; readonly failure: BatchSettleFailure }

export interface SettleBatchInputs {
  readonly questions: readonly JudgeQuestion[]
  /** The batch's question ids in order, for aligning the one shared response. */
  readonly questionIds: readonly string[]
  /** The model's reply text for the batch. */
  readonly replyText: string
  /** The model that answered (the conversation's own model). */
  readonly model: string
  /** A `noul` needs at least this p(yes) to settle `caution`. */
  readonly advisoryThreshold?: number | undefined
  readonly reservedCostUsd?: UsdAmount | undefined
  readonly settledCostUsd?: UsdAmount | undefined
}

/**
 * Decode the reply's JSON value: the whole trimmed text, or its outermost
 * `{...}` span when the model adds words around the object. Undefined when
 * neither parses to an object.
 */
export function decodeJudgeReply(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  const direct = parseObject(trimmed)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const span = start === -1 || end <= start ? undefined : trimmed.slice(start, end + 1)
  return direct ?? (span === undefined ? undefined : parseObject(span))
}

function parseObject(text: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return undefined
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function optionCountOf(question: JudgeQuestion): number {
  return question.options?.length ?? 0
}

/**
 * Settle one batch: every question reads the one shared stated response. The
 * response carries a single answer shape (lane J's parser), so a batch holds
 * questions of one kind; a question whose kind the response cannot answer
 * fails the batch. The first failure wins; nothing settles partially.
 */
export function settleBatch(inputs: SettleBatchInputs): BatchSettleResult {
  if (inputs.questions.length === 0 || inputs.questionIds.length !== inputs.questions.length) {
    throw new RangeError('judge batches settle one answer per question')
  }
  const [first, ...rest] = inputs.questions
  if (first === undefined || rest.some((question) => question.kind !== first.kind)) {
    // One batch shares one stated response, which carries a single answer
    // shape: the caller plans one batch per question kind.
    throw new RangeError('judge batches settle questions of one kind')
  }
  const threshold = inputs.advisoryThreshold ?? JUDGE_ADVISORY_THRESHOLD
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('judge caution needs a threshold within [0, 1]')
  }
  const response = decodeJudgeReply(inputs.replyText)
  if (response === undefined) {
    return { status: 'failure', failure: 'unparseable' }
  }
  const answers: JudgeAnswer[] = []
  for (const question of inputs.questions) {
    const material = materialForStated({
      kind: question.kind,
      optionCount: optionCountOf(question),
      response,
    })
    if (material.outcome !== 'answer') {
      return { status: 'failure', failure: material.failure }
    }
    answers.push(
      assembleAnswer({
        question,
        material: material.material,
        model: inputs.model,
        reservedCostUsd: inputs.reservedCostUsd,
        settledCostUsd: inputs.settledCostUsd,
      }),
    )
  }
  const outcome: 'caution' | 'none' = answers.some(
    (answer) => answer.kind === 'noul' && answer.pYes >= threshold,
  )
    ? 'caution'
    : 'none'
  return { status: 'answered', answers, outcome }
}
