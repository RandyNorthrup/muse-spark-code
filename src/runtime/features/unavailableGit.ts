// The Git a runtime panel conversation has when there is none to give (M104
// lane B): no git program, a workspace in no repository, or a bundle that
// could not be loaded. It shows no Git state, and every action says why in the
// reason it was made with (a warning in the panel), so a press is never silent.
import type {
  ConversationGitPort,
  GitSurface,
} from '../../host/conversation/conversationController'
import type { Logger } from '../../host/logger'
import { unavailable } from './unavailable'

export function unavailableGit(
  surface: GitSurface,
  reason: string,
  log: Logger,
): ConversationGitPort {
  const showNothing = () => {
    surface.post({ type: 'gitState', state: {} })
  }
  // A press is answered in the panel in words, as a refusal of the repository's own would be.
  const say = (): Promise<void> => {
    surface.notice('warning', reason)
    return Promise.resolve()
  }
  return {
    postState: showNothing,
    sessionChanged: showNothing,
    handleAction: say,
    commit: say,
    createPullRequest: say,
    promptFor: () => Promise.reject(new Error(reason)),
    generationStarting: () => unavailable(),
    isGenerationCurrent: () => false,
    generationSubmitted: showNothing,
    generationFailed: showNothing,
    onEvent: () => {
      log.trace('MHP_GIT_UNAVAILABLE')
    },
    dispose: () => {
      log.trace('MHP_GIT_RELEASED')
    },
  }
}
