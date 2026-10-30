// The runtime panel's Git and pull requests (M104 lane B, PLAN.md D104): the
// native route (`createRuntimeGit`) over the editor's own services. The
// repository is git's toplevel of the workspace, found with the user's own
// `git`; the push question, the remote pick, every other confirmation, the
// terminal for a push that needs typed credentials and GitHub's pages are
// MHP requests (`ui/confirm`, `ui/pick`, `terminal/create`, `ui/openExternal`),
// so a person answers them in their editor. The GitHub sign-in is one object
// for the connection, over the device flow and the opt-in `gh` login (there is
// no editor session to borrow), so every conversation's card shows one account.
//
// - No `git` on the absolute entries of PATH, or a workspace in no
//   repository, is no Git for the panel: it shows none, and each press says why.
// - Trust is the editor's, read at every await by the service; a workspace
//   the person has not trusted never runs git.
// - A pull request's held worktree (D104 §3) and the checkpoints' admission
//   of a command that may write the workspace are not composed here: no card
//   shows a hold, and no command is admitted by a checkpoint store.
// - The push's environment is the runtime's own with no credential variable
//   but the Git routes, captured now (D104's named exception).
// - Pull request links are the connection's workspace storage, read when the
//   panel opens and kept by session id.

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { withoutCredentials } from '../../../core/credentialEnvironment'
import { GitHubSignIn } from '../../../core/git/githubSignIn'
import { pushConfirmationText } from '../../../core/git/pushConfirmation'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import type { SecretStore } from '../../../host/auth/credentialStore'
import { canonicalPath } from '../../../host/canonicalPath'
import type {
  ConversationGitPort,
  GitSurface,
} from '../../../host/conversation/conversationController'
import { isGitExitError, processGitPath } from '../../../host/git'
import {
  PullRequestLinks,
  pullRequestLinkStoreOf,
  type LinkMemento,
} from '../../../host/git/pullRequestLinks'
import type { Logger } from '../../../host/logger'
import { GIT_PUSH_CREDENTIAL_VARIABLES, UI_TEXT } from '../../../shared/constants'
import type { HostServices } from '../../../shared/hostApi/methods'
import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'
import { githubAccountLogin, runtimeGitHubSources } from '../../github/githubSources'
import { unavailableGit } from '../../features/unavailableGit'
import { createRuntimeGit } from './adapter'

export interface PanelGitPorts {
  readonly host: HostServices
  readonly workspaceRoot: string
  /** The user's own git with an explicit working directory (`processGitRunner`). */
  readonly runGit: (args: readonly string[], cwd: string) => Promise<string>
  readonly isTrusted: () => boolean
  /** Where the device flow keeps its token pair. */
  readonly secrets: SecretStore
  readonly fetch: typeof globalThis.fetch
  /** `muse-spark-code/<version>`, as the REST client sends it. */
  readonly userAgent: string
  /** `museSpark.github.useGhLogin` as the person set it in their own settings, as last read. */
  readonly useGhLogin: () => boolean
  /** The workspace storage the pull request links are kept in. */
  readonly links: {
    read(): Promise<unknown>
    write(value: unknown): Promise<void>
  }
  readonly dataFolder: string
  /** Ends with the connection. */
  readonly signal: AbortSignal
  readonly log: Logger
}

export interface PanelGit {
  /** False when there is no git or no repository: every conversation's Git then says why. */
  readonly isAvailable: boolean
  /** One conversation's Git adapter over the connection's repository and sign-in. */
  createGit(surface: GitSurface): ConversationGitPort
  /** Ends a sign-in the connection waits on. */
  dispose(): void
}

/** The workspace's repository root as git names it, or undefined in no repository. */
async function repositoryRootOf(ports: PanelGitPorts): Promise<string | undefined> {
  try {
    const shown = await ports.runGit(['rev-parse', '--show-toplevel'], ports.workspaceRoot)
    return await canonicalPath(path.resolve(shown.trim()))
  } catch (error: unknown) {
    // NARROW: git's own "not a repository" is a workspace with no Git; anything else is not ours to hide.
    if (isGitExitError(error)) return undefined
    throw error
  }
}

/** A connection with no Git to give: each conversation's Git says `reason` to every press. */
function unavailablePanelGit(reason: string, log: Logger): PanelGit {
  return {
    isAvailable: false,
    createGit: (surface) => unavailableGit(surface, reason, log),
    dispose: () => {
      log.trace('MHP_GIT_RELEASED')
    },
  }
}

/**
The Git and pull requests of one runtime panel connection; with no git or no
repository, one that says so. Its words are in the installed language.
*/
export async function openPanelGit(
  ports: PanelGitPorts,
  table: UiText,
  locale: string,
): Promise<PanelGit> {
  setUiText(table, locale)
  const { host, signal, log } = ports
  // Git can run programs a repository's configuration names: none starts in a workspace the editor does not trust.
  if (!ports.isTrusted()) return unavailablePanelGit(UI_TEXT.gitRestricted, log)
  const gitPath = processGitPath(ports.workspaceRoot)
  if (gitPath === undefined) {
    log.info('MHP_GIT_NOT_FOUND')
    return unavailablePanelGit(UI_TEXT.gitProgramMissing, log)
  }
  const repositoryRoot = await repositoryRootOf(ports)
  if (repositoryRoot === undefined) {
    log.info('MHP_GIT_NO_REPOSITORY')
    return unavailablePanelGit(UI_TEXT.gitWorkspaceNotRepository, log)
  }
  const openExternal = async (url: string): Promise<void> => {
    await host.request('ui/openExternal', { uri: url }, signal)
  }
  const github = new GitHubSignIn({
    sources: (present) =>
      runtimeGitHubSources(
        {
          store: ports.secrets,
          fetch: ports.fetch,
          openExternal,
          // Only the person's own setting counts, never the repository's.
          setting: () => ({ globalValue: ports.useGhLogin() }),
        },
        present,
      ),
    now: Date.now,
    login: githubAccountLogin(ports),
    log,
  })
  let stored = await ports.links.read()
  const memento: LinkMemento = {
    get: () => stored,
    update: async (_key, value) => {
      stored = value
      await ports.links.write(value)
    },
  }
  const links = pullRequestLinkStoreOf(new PullRequestLinks(memento))
  const userEnvironment = withoutCredentials(process.env, GIT_PUSH_CREDENTIAL_VARIABLES)
  /** An explicit yes in the editor; a dismissed question is a no. */
  const isConfirmed = async (title: string, message: string, action: string): Promise<boolean> => {
    const accept = 1
    const answer = await host.request(
      'ui/confirm',
      { title, message, choices: [{ id: accept, title: action }] },
      signal,
    )
    return answer === accept
  }
  const deps: RuntimeGitDeps = {
    repositoryRoot,
    gitPath,
    github,
    links,
    isTrusted: ports.isTrusted,
    worktreeState: () => ({}),
    confirmWorktreeTrust: () => Promise.resolve(),
    confirmPush: async (confirmation) => {
      const { message, detail } = pushConfirmationText(confirmation)
      return await isConfirmed(message, detail, UI_TEXT.gitPushAction)
    },
    confirm: isConfirmed,
    pickRemote: async (names) => {
      const picked = await host.request(
        'ui/pick',
        {
          title: UI_TEXT.gitPickRemoteTitle,
          placeholder: UI_TEXT.gitPickRemotePlaceholder,
          items: names.map((name) => ({ id: name, title: name })),
          multiple: false,
        },
        signal,
      )
      const first = picked?.[0]
      return typeof first === 'string' ? first : undefined
    },
    userEnvironment: () => userEnvironment,
    openInTerminal: async (command, cwd) => {
      const [executable, ...args] = command
      if (executable === undefined) return
      const { terminalId } = await host.request(
        'terminal/create',
        { cwd: pathToFileURL(cwd).href, executable, args, env: {} },
        signal,
      )
      await host.request('terminal/show', { terminalId }, signal)
    },
    openFolder: async (folder) => {
      await host.request(
        'workspace/openFolder',
        { uri: pathToFileURL(folder).href, newWindow: true },
        signal,
      )
    },
    openExternal,
    dataFolder: ports.dataFolder,
    userAgent: ports.userAgent,
    signal,
    log,
  }
  return {
    isAvailable: true,
    createGit: (surface) => createRuntimeGit(surface, deps),
    dispose: () => {
      github.cancel()
    },
  }
}
