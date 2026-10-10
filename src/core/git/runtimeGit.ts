// What the runtime's Git and pull request adapter is built from (M123,
// PLAN.md D104): the runtime side of the controller's ConversationGitPort,
// which stays unchanged. Lane G's `createRuntimeGit(surface: GitSurface,
// deps: RuntimeGitDeps): ConversationGitPort` sits beside the VS Code
// adapter; lane P supplies the link store. Every editor outside VS Code (and
// a VS Code-family host without `vscode.git`) gets Git through these.
//
// Types only: nothing here runs.

import type { CoreLogger } from '../logging'
import type { GitHubTokenSource } from './tokenSource'

/** Which pull request a conversation opened (M71's link, kept by the runtime). */
export interface PullRequestLinkRecord {
  /** `owner/name` on github.com. */
  readonly repository: string
  readonly number: number
  readonly url: string
  readonly title: string
  /** Epoch ms, for dropping the oldest past PULL_REQUEST_LINKS_KEPT. */
  readonly linkedAt: number
}

/**
 * The runtime's per-user link store, keyed by the canonical repository root
 * and the session id. It keeps the newest PULL_REQUEST_LINKS_KEPT links of
 * each root; session export and import carry a link through it.
 */
export interface PullRequestLinkStore {
  get(repositoryRoot: string, sessionId: string): Promise<PullRequestLinkRecord | undefined>
  set(repositoryRoot: string, sessionId: string, link: PullRequestLinkRecord): Promise<void>
}

/** Everything a push sends, shown before it runs (M71's push modal, D104). */
export interface RuntimePushConfirmation {
  readonly remote: string
  /** Credentials masked; undefined when git knows no URL for it. */
  readonly remoteUrl: string | undefined
  readonly branch: string
  /** The branch on the remote. */
  readonly target: string
  /** Undefined on a first push. */
  readonly commits: number | undefined
}

export interface RuntimeGitDeps {
  /**
   * The repository's root as the host approved it (canonical: realpath,
   * `/` separators). The service binds to this directory's identity when
   * it is made and refuses a replacement at the same path.
   */
  readonly repositoryRoot: string
  /**
   * The user's own `git`, an absolute path resolved as `resolveExecutable`
   * does; every native git and the terminal command run this one.
   */
  readonly gitPath: string
  /** D104's sources; `resolveGitHubCredential` orders them. */
  readonly tokenSources: readonly GitHubTokenSource[]
  readonly links: PullRequestLinkStore
  /** The editor's trust (MHP `workspace/trust`, or the runtime's record); checked after every await. */
  readonly isTrusted: () => boolean
  /**
   * The push modal: the remote and its (masked) URL, the branch and its
   * target, the commit count, never a force, and that hooks and credential
   * helpers run. True only for an explicit yes; nothing is pushed before it.
   */
  readonly confirmPush: (confirmation: RuntimePushConfirmation) => Promise<boolean>
  /** M71's remote pick for a first push when git cannot tell; undefined when dismissed. */
  readonly pickRemote: (names: readonly string[]) => Promise<string | undefined>
  /**
   * D104's named exception: the user's own environment for the confirmed
   * push and the pull request fetch only (credential helpers, SSH agent,
   * token variables, as a terminal would). The standalone runtime returns
   * what it captured at start, before it took credentials out of its own
   * environment (`runtimeGitUserEnvironment`); an editor host its process
   * environment. Every other git keeps the quiet environment.
   */
  readonly userEnvironment: () => NodeJS.ProcessEnv
  /**
   * A host whose checkpoints must learn of a command that may write the
   * workspace (VS Code's M72 admission): commit and push run hooks.
   */
  readonly admitWorkspaceCommand?: (<T>(start: () => Promise<T>) => Promise<T>) | undefined
  /** A push that needs typed credentials: the same command in the editor's terminal (MHP `terminal/create`). */
  readonly openInTerminal: (command: readonly string[], cwd: string) => Promise<void>
  /** A held pull request worktree (MHP `workspace/openFolder`). */
  readonly openFolder: (path: string) => Promise<void>
  /** GitHub's pages only (MHP `ui/openExternal`). */
  readonly openExternal: (url: string) => Promise<void>
  /** The runtime data folder; held checkouts go under its `pr-worktrees/`. */
  readonly dataFolder: string
  /** `muse-spark-code/<version>`, as the REST client sends it. */
  readonly userAgent: string
  /** Aborts with the window, a change of owner or shutdown. */
  readonly signal: AbortSignal
  readonly log: CoreLogger
}
