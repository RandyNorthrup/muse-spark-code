// M123's native Git route in its own bundle (PLAN.md D6, D104 §1):
// dist/nativeGit.js, required the first time a conversation opens in a VS
// Code-family host without the `vscode.git` extension (Arduino IDE 2, some
// forks). VS Code with its Git extension never loads it, so the window's
// conversation Git bundle stays within its budget. The adapter is made here
// synchronously, in the installed language, as conversationGitEntry.ts
// makes M71's.
import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import type {
  ConversationGitPort,
  GitSurface,
} from '../../../host/conversation/conversationController'
import { createRuntimeGit } from './adapter'

export function createNativeGit(
  surface: GitSurface,
  deps: RuntimeGitDeps,
  table: UiText,
  locale: string,
): ConversationGitPort {
  setUiText(table, locale)
  return createRuntimeGit(surface, deps)
}
