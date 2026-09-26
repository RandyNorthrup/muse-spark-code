// The agent's questions (`request_user_input`) in an ACP client (PLAN.md
// D62): a form where the client can show one (`elicitation/create`), and
// otherwise the questions as text, declined so the model carries on and the
// user answers in the next prompt. Pure.

import {
  CreateElicitationResponse,
  type ElicitationPropertySchema,
  type ElicitationSchema,
} from '@agentclientprotocol/sdk'
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

/** The form's answers as the backend takes them; a value that is not an option is free text. */
export function formAnswers(
  questions: readonly Question[],
  response: CreateElicitationResponse,
): readonly QuestionAnswer[] | undefined {
  if (!CreateElicitationResponse.isAccept(response)) {
    return undefined
  }
  const { content } = response
  return questions.flatMap((question): QuestionAnswer[] => {
    const value = content?.[question.id]
    if (Array.isArray(value)) {
      return [{ questionId: question.id, selectedLabels: value }]
    }
    if (typeof value !== 'string') {
      return []
    }
    const isOption = question.options.some((option) => option.label === value)
    return [
      isOption
        ? { questionId: question.id, selectedLabel: value }
        : { questionId: question.id, freeText: value },
    ]
  })
}

/** The questions as a message, for a client without forms. */
export function questionsText(questions: readonly Question[]): string {
  const lines = questions.flatMap((question) => [
    question.question,
    ...question.options.map((option) => `${BULLET}${option.label}`),
  ])
  return [UI_TEXT.acpQuestionAsked, ...lines].join(LINE)
}
