// The conversation implementation loads when the first chat surface needs it.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { ConversationController, type ConversationDeps } from './conversationController'

export function createConversation(
  deps: ConversationDeps,
  table: UiText,
  locale: string,
): ConversationController {
  setUiText(table, locale)
  return new ConversationController(deps)
}
