// The agent's questions (`request_user_input`) in an ACP client (PLAN.md
// D62): a form where the client can show one (`elicitation/create`), and
// otherwise the questions as text, declined so the model carries on and the
// user answers in the next prompt. The client's answer is parsed before use
// (AGENTS.md rule 7): the ACP SDK checks what the agent receives, not what a
// request of its own gets back. Pure.

import type { ElicitationPropertySchema, ElicitationSchema } from '@agentclientprotocol/sdk'
import * as z from 'zod/mini'
import type { Question, QuestionAnswer } from '../shared/agentEvents'
import { UI_TEXT } from '../shared/constants'

const MULTIPLE_SELECTION = 'multiple'
const LINE = '\n'
const BULLET = '- '

function enumOptions(question: Question) {
  return question.options.map((option) => ({
    const: option.label,
    title: option.label,
    ...(option.description !== undefined && { description: option.description }),
  }))
}

function questionProperty(question: Question): ElicitationPropertySchema {
  const titled = { title: question.header, description: question.question }
  if (question.selection.mode === MULTIPLE_SELECTION) {
    return {
      type: 'array',
      ...titled,
      items: { anyOf: enumOptions(question) },
      ...(question.selection.minSelections !== undefined && {
        minItems: question.selection.minSelections,
      }),
      ...(question.selection.maxSelections !== undefined && {
        maxItems: question.selection.maxSelections,
      }),
    }
  }
  return question.options.length === 0
    ? { type: 'string', ...titled }
    : { type: 'string', ...titled, oneOf: enumOptions(question) }
}

/** One form field per question, each required, as the card asks for an answer to each. */
export function questionForm(questions: readonly Question[]): ElicitationSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      questions.map((question) => [question.id, questionProperty(question)]),
    ),
    required: questions.map((question) => question.id),
  }
}

// The client's answer: accepted with the form's values (ACP allows none, or
// null), or declined or cancelled. Anything else is no answer.
const elicitationResponseSchema = z.union([
  z.object({
    action: z.literal('accept'),
    content: z.optional(z.nullable(z.record(z.string(), z.unknown()))),
  }),
  z.object({ action: z.enum(['decline', 'cancel']) }),
])
const textSchema = z.string()
const labelsSchema = z.array(z.string())

/**
 * One question's answer as the form asked for it, or undefined: a single
 * choice one of its options, free text (non-blank) only where it has none,
 * and a multiple choice distinct options, as many as it allows.
 */
function answerOf(question: Question, value: unknown): QuestionAnswer | undefined {
  const labels = new Set(question.options.map((option) => option.label))
  if (question.selection.mode === MULTIPLE_SELECTION) {
    const parsed = labelsSchema.safeParse(value)
    if (!parsed.success) {
      return undefined
    }
    const picked = parsed.data
    const min = question.selection.minSelections ?? 1
    const max = question.selection.maxSelections ?? labels.size
    const isValid =
      new Set(picked).size === picked.length &&
      picked.every((label) => labels.has(label)) &&
      picked.length >= min &&
      picked.length <= max
    return isValid ? { questionId: question.id, selectedLabels: picked } : undefined
  }
  const parsed = textSchema.safeParse(value)
  if (!parsed.success) {
    return undefined
  }
  if (labels.size === 0) {
    return parsed.data.trim() === ''
      ? undefined
      : { questionId: question.id, freeText: parsed.data }
  }
  return labels.has(parsed.data)
    ? { questionId: question.id, selectedLabel: parsed.data }
    : undefined
}

/**
 * The form's answers as the backend takes them, or undefined when the form
 * was not accepted or any answer is not one the form allowed: the question
 * is then declined, and nothing is answered by a guess (D62).
 */
export function formAnswers(
  questions: readonly Question[],
  raw: unknown,
): readonly QuestionAnswer[] | undefined {
  const response = elicitationResponseSchema.safeParse(raw)
  if (!response.success || response.data.action !== 'accept') {
    return undefined
  }
  const content = response.data.content ?? {}
  const answers: QuestionAnswer[] = []
  for (const question of questions) {
    const answer = answerOf(
      question,
      Object.hasOwn(content, question.id) ? content[question.id] : undefined,
    )
    if (answer === undefined) {
      return undefined
    }
    answers.push(answer)
  }
  return answers
}

/** The questions as a message, for a client without forms. */
export function questionsText(questions: readonly Question[]): string {
  const lines = questions.flatMap((question) => [
    question.question,
    ...question.options.map((option) => `${BULLET}${option.label}`),
  ])
  return [UI_TEXT.acpQuestionAsked, ...lines].join(LINE)
}
