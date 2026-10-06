import { normalizeQuestionText } from './key'
import type { Question, QuestionAnswer } from '../../shared/agentEvents'
import {
  CLARIFICATION_MAX_CHARS,
  LATE_ANSWER_QUESTION_MAX_CHARS,
  QUESTION_DELIVERY_MODEL_TEXT,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  openQuestionAnswerSchema,
  type OpenQuestion,
  type OpenQuestionAnswer,
  type QuestionDelivery,
} from '../../shared/questions'

/** The backend's existing question-result formatter, injected to preserve its exact English output. */
export type QuestionAnswerText = (reply: OpenQuestionAnswer) => string

/** Matches the existing Model API tool-result text without loading its engine. */
export function questionAnswerText(reply: OpenQuestionAnswer): string {
  return 'answers' in reply
    ? `${QUESTION_DELIVERY_MODEL_TEXT.answersPrefix}\n${JSON.stringify(reply.answers)}`
    : `${QUESTION_DELIVERY_MODEL_TEXT.clarificationLead}\n${reply.explanation}`
}

export function validatedAnswer(entry: OpenQuestion, raw: OpenQuestionAnswer): OpenQuestionAnswer {
  const reply = openQuestionAnswerSchema.parse(raw)
  if ('explanation' in reply) {
    const explanation = reply.explanation.trim()
    if (explanation === '' || explanation.length > CLARIFICATION_MAX_CHARS)
      throw new Error(UI_TEXT.clarifyNotAccepted)
    return { explanation }
  }
  if (reply.answers.length !== entry.questions.length) throw new Error(UI_TEXT.answerNotAccepted)
  for (const question of entry.questions) {
    const answer = reply.answers.find((candidate) => candidate.questionId === question.id)
    if (answer === undefined) throw new Error(UI_TEXT.answerNotAccepted)
    const labels =
      answer.selectedLabels ?? (answer.selectedLabel === undefined ? [] : [answer.selectedLabel])
    const hasText = answer.freeText !== undefined && answer.freeText.trim() !== ''
    if (
      (answer.selectedLabel !== undefined && answer.selectedLabels !== undefined) ||
      (hasText && labels.length > 0) ||
      (!hasText && labels.length === 0) ||
      new Set(labels).size !== labels.length ||
      labels.some((label) => question.options.every((option) => option.label !== label))
    )
      throw new Error(UI_TEXT.answerNotAccepted)
    if (question.selection.mode === 'single' && labels.length > 1)
      throw new Error(UI_TEXT.answerNotAccepted)
    if (
      !hasText &&
      (labels.length < (question.selection.minSelections ?? 1) ||
        (question.selection.maxSelections !== undefined &&
          labels.length > question.selection.maxSelections))
    )
      throw new Error(UI_TEXT.answerNotAccepted)
  }
  return reply
}

/** Re-asked/coalesced requests can use fresh question IDs for the same normalized question. */
export function answersForRequest(
  entry: OpenQuestion,
  answers: readonly QuestionAnswer[],
  questions: readonly Question[],
): QuestionAnswer[] {
  return entry.questions.map((question, index) => {
    const answer = answers.find((candidate) => candidate.questionId === question.id)
    const current = questions[index]
    if (answer === undefined || current === undefined) throw new Error(UI_TEXT.answerNotAccepted)
    const labelFor = (label: string) => {
      const option = current.options.find(
        (option) => normalizeQuestionText(option.label) === normalizeQuestionText(label),
      )
      if (option === undefined) throw new Error(UI_TEXT.answerNotAccepted)
      return option.label
    }
    return {
      ...answer,
      questionId: current.id,
      ...(answer.selectedLabel !== undefined && { selectedLabel: labelFor(answer.selectedLabel) }),
      ...(answer.selectedLabels !== undefined && {
        selectedLabels: answer.selectedLabels.map((label) => labelFor(label)),
      }),
    }
  })
}

export function lateAnswer(
  entry: OpenQuestion,
  reply: OpenQuestionAnswer,
  formatAnswer: QuestionAnswerText,
): QuestionDelivery {
  return {
    sessionId: entry.sessionId,
    userInputId: entry.userInputId,
    text: fill(QUESTION_DELIVERY_MODEL_TEXT.lateAnswer, {
      id: entry.userInputId,
      question: entry.questions
        .map((question) => question.question)
        .join('\n')
        .slice(0, LATE_ANSWER_QUESTION_MAX_CHARS),
      answer: formatAnswer(reply),
    }),
    displayText: fill(UI_TEXT.questionLateAnswerDisplay, {
      header: entry.questions.map((question) => question.header).join(', '),
    }),
  }
}
