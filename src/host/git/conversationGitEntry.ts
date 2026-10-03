// The same Git adapter, constructed synchronously with its installed language.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { ConversationGitPort, GitSurface } from '../conversation/conversationController'
import { ConversationGit, type ConversationGitErrorTypes, type GitWindow } from './conversationGit'

export function createConversationGit(
  window: GitWindow,
  surface: GitSurface,
  table: UiText,
  locale: string,
  errorTypes: ConversationGitErrorTypes,
): ConversationGitPort {
  setUiText(table, locale)
  return new ConversationGit(window, surface, errorTypes)
}
