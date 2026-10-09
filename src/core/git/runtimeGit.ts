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

export interface RuntimeGitDeps {
  /** The repository's canonical root (realpath, `/` separators). */
  readonly repositoryRoot: string
  /** The user's own `git`, an absolute path resolved as `resolveExecutable` does. */
  readonly gitPath: string
  /** D104's sources; `resolveGitHubCredential` orders them. */
  readonly tokenSources: readonly GitHubTokenSource[]
  readonly links: PullRequestLinkStore
  /** The editor's trust (MHP `workspace/trust`, or the runtime's record); checked after every await. */
  readonly isTrusted: () => boolean
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
