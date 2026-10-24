// The conversation implementation loads when the first chat surface needs it.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { ConversationController, type ConversationDeps } from './conversationController'
export { questionAnswerText } from '../../core/questions/lateAnswer'
export { createHostQuestionStore } from '../questions/questionStorage'
import { questionClock } from '../questions/questionStorage'
import { questionAnswerText } from '../../core/questions/lateAnswer'
import type { QuestionStore } from '../../shared/questions'

/** The editor's own setting supplies when an unanswered question is deferred. */
export function questionsForHost(
  store: QuestionStore,
  deferAfterSeconds: () => number,
): NonNullable<ConversationDeps['questions']> {
  return {
    store,
    clock: questionClock(),
    deferAfterSeconds,
    formatAnswer: questionAnswerText,
  }
}

export function createConversation(
  deps: ConversationDeps,
  table: UiText,
  locale: string,
): ConversationController {
  setUiText(table, locale)
  return new ConversationController(deps)
}
