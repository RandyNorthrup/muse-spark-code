// SystemOne reuses P0's captured Jev schemas. Chat follows localJudgeCapture.json.
import * as z from 'zod/mini'
import { Usd } from '../../../shared/usd'
import { entropyConfidence } from '../math'
import { materialForLogprobs } from '../techniques'
import {
  judgeResultSchema,
  jevAnswerSchema,
  type JudgeMuse,
  type JudgeRequest,
  type JudgeQuestion,
  type JudgeResult,
} from '../schema'

const ollamaAnswerSchema = z.union([
  z.looseObject({ type: z.literal('noul'), noul: z.number().check(z.minimum(0), z.maximum(1)) }),
  jevAnswerSchema,
])
const vendorSchema = z.looseObject({
  model: z.string().check(z.minLength(1)),
  answers: z.record(z.string(), ollamaAnswerSchema),
  usage: z.looseObject({
    input_tokens: z.int().check(z.nonnegative()),
    output_tokens: z.int().check(z.nonnegative()),
  }),
})
const chatSchema = z.looseObject({
  model: z.string().check(z.minLength(1)),
  done: z.literal(true),
  message: z.looseObject({ role: z.literal('assistant'), content: z.string() }),
  prompt_eval_count: z.int().check(z.nonnegative()),
  eval_count: z.literal(1),
  logprobs: z
    .array(
      z.looseObject({
        token: z.string(),
        logprob: z.number().check(z.maximum(0)),
        top_logprobs: z
          .array(z.looseObject({ token: z.string(), logprob: z.number().check(z.maximum(0)) }))
          .check(z.minLength(1)),
      }),
    )
    .check(z.minLength(1), z.maxLength(1)),
})

function hasSameKeys(actual: object, expected: readonly string[]): boolean {
  const keys = Object.keys(actual)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

function questionKeys(question: JudgeQuestion): string[] {
  if (question.type === 'noul') return ['true', 'false']
  return question.type === 'choice'
    ? Object.keys(question.criteria)
    : question.criteria.map((_level, index) => String(index))
}

/** Align every answer; extra vendor fields stay on the returned wire object. */
export function localSystemOneResult(
  value: unknown,
  request: JudgeRequest,
  model: string,
): JudgeResult {
  const response = vendorSchema.parse(value)
  if (response.model !== model || !hasSameKeys(response.answers, Object.keys(request.questions)))
    throw new Error('invalid-local-alignment')
  const muse: Record<string, JudgeMuse> = {}
  const answers: Record<string, unknown> = {}
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = response.answers[id]
    if (answer?.type !== question.type) throw new Error('invalid-local-answer')
    const alternatives = questionKeys(question)
    // Ollama's captured noul omits probabilities. P0's internal contract
    // requires them; retain its native fields and derive the two binary masses.
    const distribution =
      answer.type === 'noul' ? { true: answer.noul, false: 1 - answer.noul } : answer.probabilities
    if (!hasSameKeys(distribution, alternatives)) throw new Error('invalid-local-distribution')
    const entries = new Map(Object.entries(distribution))
    const probabilities = alternatives.map((key) => entries.get(key) ?? 0)
    // Tolerate floating-point summation error only; do not manufacture
    // probability mass for missing or malformed alternatives.
    const total = probabilities.reduce((sum, p) => sum + p, 0)
    if (total <= 0 || Math.abs(total - 1) > Number.EPSILON * alternatives.length * 100)
      throw new Error('invalid-local-distribution')
    if (answer.type === 'choice' && !alternatives.includes(answer.choice))
      throw new Error('invalid-local-answer')
    if (
      answer.type === 'score' &&
      (question.type !== 'score' ||
        answer.score < 0 ||
        answer.score > alternatives.length - 1 ||
        !hasSameKeys(answer.legend, alternatives) ||
        question.criteria.some((level, index) => answer.legend[String(index)] !== level) ||
        // The score is the expectation of the ordered level distribution.
        // Scale summation tolerance by both the term count and level range.
        Math.abs(answer.score - probabilities.reduce((sum, p, index) => sum + p * index, 0)) >
          Number.EPSILON * alternatives.length ** 2 * 100)
    )
      throw new Error('invalid-local-answer')
    muse[id] = {
      source: 'separate',
      technique: 'systemone',
      model,
      label: 'uncalibrated',
      confidence: entropyConfidence(probabilities),
      partial: false,
      reservedCostUsd: Usd.from(0).toAmount(),
      settledCostUsd: Usd.from(0).toAmount(),
      ...(answer.type !== 'noul' && { vendorConfidence: answer.confidence }),
    }
    answers[id] = { ...answer, probabilities: distribution }
  }
  return judgeResultSchema.parse({ ...response, answers, muse })
}

/** One-token local logprobs; choice and score tokens keep P0's A–Z/0–9 rules. */
export function localChatResult(value: unknown, request: JudgeRequest, model: string): JudgeResult {
  const response = chatSchema.parse(value)
  if (response.model !== model || Object.keys(request.questions).length !== 1)
    throw new Error('invalid-local-alignment')
  const entry = Object.entries(request.questions)[0]
  const token = response.logprobs[0]
  if (!entry || !token) throw new Error('invalid-local-answer')
  const [id, question] = entry
  const keys = questionKeys(question)
  const material = materialForLogprobs({
    kind: question.type,
    optionCount: keys.length,
    candidates: token.top_logprobs,
  })
  if (material.outcome !== 'answer') throw new Error('invalid-local-logprobs')
  const probabilities = Object.fromEntries(
    keys.map((key, index) => [key, material.material.probabilities[index] ?? 0]),
  )
  const meta: JudgeMuse = {
    source: 'separate',
    technique: 'logprob',
    model,
    label: 'uncalibrated',
    confidence: entropyConfidence(material.material.probabilities),
    partial: material.material.partial,
    reservedCostUsd: Usd.from(0).toAmount(),
    settledCostUsd: Usd.from(0).toAmount(),
  }
  let answer
  if (question.type === 'noul')
    answer = { type: 'noul', noul: probabilities['true'], probabilities }
  else if (question.type === 'choice') {
    // Chat prompts map criteria in A–Z order, even for a sparse set of letters.
    let winner = 0
    for (let index = 1; index < keys.length; index++)
      if (
        (material.material.probabilities[index] ?? 0) >
        (material.material.probabilities[winner] ?? 0)
      )
        winner = index
    answer = { type: 'choice', choice: keys[winner], confidence: meta.confidence, probabilities }
  } else
    answer = {
      type: 'score',
      score: material.material.probabilities.reduce((sum, p, index) => sum + p * index, 0),
      confidence: meta.confidence,
      probabilities,
      legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])),
    }
  return judgeResultSchema.parse({
    model,
    answers: { [id]: answer },
    muse: { [id]: meta },
    usage: { input_tokens: response.prompt_eval_count, output_tokens: response.eval_count },
  })
}
