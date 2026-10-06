import { QUESTION_REMINDERS_MAX } from '../../shared/constants'
import type { OpenQuestion } from '../../shared/questions'

/** One oldest eligible card per turn; the surface interprets the increment as an expansion request. */
export function nextQuestionReminder(
  questions: readonly OpenQuestion[],
  hasApproval: boolean,
): OpenQuestion | undefined {
  return hasApproval
    ? undefined
    : questions.find(
        (question) => question.state === 'open' && question.reminders < QUESTION_REMINDERS_MAX,
      )
}
