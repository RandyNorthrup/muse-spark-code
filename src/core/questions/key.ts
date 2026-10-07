import type { Question } from '../../shared/agentEvents'

export function normalizeQuestionText(text: string): string {
  return text.normalize('NFC').trim().replaceAll(/\s+/gu, ' ').toLowerCase()
}

/** IDs, descriptions and headers do not change the answer a question asks for. */
export function questionKey(questions: readonly Question[]): string {
  return JSON.stringify(
    questions.map((question) => [
      normalizeQuestionText(question.question),
      [...new Set(question.options.map((option) => normalizeQuestionText(option.label)))].toSorted(
        (a, b) => Number(a > b) - Number(a < b),
      ),
    ]),
  )
}
