// M71's bundle (PLAN.md D6): the conversations' Git adapter and the window's
// git and pull request features, each constructed synchronously with its
// installed language. Everything that throws or checks a Git or GitHub error
// lives here, so the adapter recognises its own window's errors.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { ConversationGitPort, GitSurface } from '../conversation/conversationController'
import { ConversationGit, type ConversationGitErrorTypes, type GitWindow } from './conversationGit'
import {
  createGitFeatures as gitFeaturesFrom,
  type GitFeaturesDeps,
  type GitWindowFeatures,
} from './gitWindow'

/** `errorTypes` only for a test's window from another module copy; the bundle's own otherwise. */
export function createConversationGit(
  window: GitWindow,
  surface: GitSurface,
  table: UiText,
  locale: string,
  errorTypes?: ConversationGitErrorTypes,
): ConversationGitPort {
  setUiText(table, locale)
  return new ConversationGit(window, surface, errorTypes)
}

export function createGitFeatures(
  deps: GitFeaturesDeps,
  table: UiText,
  locale: string,
): GitWindowFeatures {
  setUiText(table, locale)
  return gitFeaturesFrom(deps)
}
