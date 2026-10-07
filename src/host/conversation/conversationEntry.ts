// The conversation implementation loads when the first chat surface needs it.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { ConversationController, type ConversationDeps } from './conversationController'
export { questionAnswerText } from '../../core/questions/lateAnswer'
export { createHostQuestionStore } from '../questions/questionStorage'
import { questionAnswerText } from '../../core/questions/lateAnswer'
import { questionClock, questionsDeferAfterSeconds } from '../questions/questionStore'
import type { QuestionStore } from '../../shared/questions'

export function questionsForHost(store: QuestionStore): NonNullable<ConversationDeps['questions']> {
  return {
    store,
    clock: questionClock(),
    deferAfterSeconds: questionsDeferAfterSeconds,
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
