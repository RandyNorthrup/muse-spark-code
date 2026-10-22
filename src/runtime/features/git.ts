import { ConversationGit, type GitWindow } from '../../host/git/conversationGit'
import type {
  ConversationGitPort,
  GitSurface,
} from '../../host/conversation/conversationController'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeFeatureLifetime } from './lifetime'
import { logRejection } from '../../host/logger'

export interface RuntimeGitDeps extends GitWindow {
  readonly assertCurrent: () => void
  readonly beforeWorkspaceProcessStart: (signal: AbortSignal) => Promise<void>
  readonly cancelPrompts: () => void
  /** Native repository processes are cancelled and drained by their owning adapter. */
  readonly drain: () => Promise<void>
}

/** One conversation's existing Git flow, fenced at native process entry and prompt return. */
export function createRuntimeGit(
  deps: RuntimeGitDeps,
  surface: GitSurface,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, deps.cancelPrompts)
  const check = () => {
    lifetime.check()
    if (!deps.isWorkspaceTrusted()) throw new Error(UI_TEXT.gitRestricted)
  }
  async function current<T>(work: () => Promise<T>): Promise<T> {
    check()
    const result = await work()
    check()
    return result
  }
  const git = new ConversationGit(
    {
      ...deps,
      isWorkspaceTrusted: () => {
        try {
          check()
          return true
        } catch {
          return false
        }
      },
      admit: (start) =>
        current(async () => {
          await deps.beforeWorkspaceProcessStart(lifetime.signal)
          check()
          return await deps.admit(() => current(start))
        }),
      confirmPush: (confirmation) => current(() => deps.confirmPush(confirmation)),
      confirmCommit: (confirmation) => current(() => deps.confirmCommit(confirmation)),
      githubToken: (mode) => current(() => deps.githubToken(mode)),
      pickRemote: (names) => current(() => deps.pickRemote(names)),
      confirmWorktreeTrust: () => current(deps.confirmWorktreeTrust),
    },
    surface,
  )
  let closing: Promise<void> | undefined
  const dispose = () => {
    git.dispose()
    closing ??= (async () => {
      try {
        await lifetime.dispose()
      } finally {
        await deps.drain()
      }
    })()
    return closing
  }
  const port: ConversationGitPort = {
    postState: (isReady) => {
      lifetime.check()
      git.postState(isReady)
    },
    sessionChanged: (id) => {
      lifetime.check()
      git.sessionChanged(id)
    },
    handleAction: (action) => lifetime.track(() => git.handleAction(action)),
    commit: (message, include) => lifetime.track(() => git.commit(message, include)),
    createPullRequest: (request) => lifetime.track(() => git.createPullRequest(request)),
    promptFor: (kind, base) => lifetime.track(() => git.promptFor(kind, base)),
    generationStarting: (kind) => {
      lifetime.check()
      return git.generationStarting(kind)
    },
    isGenerationCurrent: (id) => !lifetime.signal.aborted && git.isGenerationCurrent(id),
    generationSubmitted: (turn, id) => {
      lifetime.check()
      git.generationSubmitted(turn, id)
    },
    generationFailed: (id) => {
      lifetime.check()
      git.generationFailed(id)
    },
    onEvent: (event) => {
      lifetime.check()
      git.onEvent(event)
    },
    dispose: () => {
      void dispose().catch(logRejection(deps.log, 'portable Git release'))
    },
  }
  return {
    git: port,
    dispose,
  }
}
