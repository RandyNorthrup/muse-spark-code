// Git and pull requests for one conversation (M71, PLAN.md D49): from
// finished work to an open pull request without leaving the panel.
//
// - Commit and push go through VS Code's git extension (gitExtension.ts),
//   so the user's credential helpers and sign-in prompts apply.
// - A push always asks, in a modal naming the remote, its URL (masked) and
//   the branch, and is never a force (core/git/pushPlan.ts).
// - A pull request is opened on github.com with VS Code's GitHub sign-in.
//   The form is the confirmation: it shows the remote, the branch, the
//   title and the description, all editable, and a credential-shaped string
//   in them stops the request until the user has seen it masked.
// - The pull request is linked to the conversation (pullRequestLinks.ts),
//   and its status and checks are read from GitHub when the conversation
//   shows and when the user asks.
// - A commit message or a pull request's text is generated only when the
//   user asks, as their own turn in the conversation (core/git/gitText.ts);
//   the reply fills the form, and nothing is committed or sent until the
//   user presses the button.
//
// None of it runs in Restricted Mode (git can run programs a repository's
// configuration names, PLAN.md D24) or in a window held on someone else's
// pull request until the user trusts that worktree.

import path from 'node:path'
import type { AgentEvent } from '../../shared/agentEvents'
import {
  PULL_REQUEST_BODY_MAX_CHARS,
  PULL_REQUEST_TITLE_MAX_CHARS,
  GIT_FORM_FILES_SHOWN,
  GIT_PROMPT_COMMITS_MAX,
  STDERR_SHOWN_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import type {
  GitAction,
  GitDraftKind,
  GitForm,
  GitState,
  PullRequestFormFacts,
  PullRequestView,
} from '../../shared/git'
import { fill } from '../../shared/l10n/text'
import { GitHubError, type GitHubClient, repositoryFromFullName } from '../../core/git/github'
import {
  type GitHubRepository,
  githubRepositoryOf,
  maskRemoteUrl,
  repositoryLabel,
} from '../../core/git/githubRemote'
import {
  commitMessageFrom,
  commitMessagePrompt,
  hasCredentialShapes,
  pullRequestPrompt,
  pullRequestTextFrom,
} from '../../core/git/gitText'
import { isPlainRefName, isPlainRefspec, planPush, type PushPlan } from '../../core/git/pushPlan'
import { wireWordForLog } from '../../core/logging'
import { redactSecrets } from '../../core/redact'
import type { WorktreeHold, WorktreeRecord } from '../../core/worktreeConversations'
import type { Logger } from '../logger'
import type {
  ConversationGitPort,
  GitSurface,
  NewPullRequestRequest,
} from '../conversation/conversationController'
import {
  GitUnavailableError,
  openOwnedRepository,
  type CaptureGitOwner,
  type GitChange,
  type GitRepository,
} from './gitExtension'
import type { PullRequestLink, PullRequestLinks } from './pullRequestLinks'

/** What the push modal names: every part of what goes out. */
export interface PushConfirmation {
  readonly remote: string
  /** Credentials masked; undefined when git knows no URL for it. */
  readonly remoteUrl: string | undefined
  readonly branch: string
  readonly target: string
  /** Undefined on a first push. */
  readonly commits: number | undefined
}

/** The complete commit shown in the final consent modal. */
export interface CommitConfirmation {
  readonly message: string
  readonly branch: string
  readonly files: readonly string[]
  readonly includesUnstaged: boolean
}

/** The window's side: shared by every conversation in it. */
export interface GitWindow {
  readonly workspaceRoot: string | undefined
  readonly platform: NodeJS.Platform
  readonly isWorkspaceTrusted: () => boolean
  /** The hold on someone else's pull request; undefined once the user trusted it. */
  readonly hold: () => WorktreeHold | undefined
  /** The worktree record for this window's root, when the extension made it. */
  readonly worktree: () => WorktreeRecord | undefined
  readonly repository: (root: string) => Promise<GitRepository>
  readonly captureGitOwner: CaptureGitOwner
  /**
   * A commit or a push runs the repository's hooks, signing programs and
   * credential helpers, and a hook can write the workspace or leave a process
   * behind. It starts only through the window's admission for workspace
   * processes (M72, PLAN.md D51): trust, the window's closing and the backend's
   * generation are asked at the last moment, and checkpoints' file restore
   * becomes unavailable for this window, as after any command that may write.
   */
  readonly admit: <T>(start: () => Promise<T>) => Promise<T>
  /** VS Code's GitHub sign-in: `ask` may prompt, `silent` only reads one there is. */
  readonly githubToken: (mode: 'ask' | 'silent') => Promise<string | undefined>
  readonly github: GitHubClient
  readonly links: PullRequestLinks
  /** The push modal; true only for an explicit yes. */
  readonly confirmPush: (confirmation: PushConfirmation) => Promise<boolean>
  readonly confirmCommit: (confirmation: CommitConfirmation) => Promise<boolean>
  /** New files are absent from git diff: hash their bytes or link text before commit consent. */
  readonly untrackedFingerprint: (paths: readonly string[], check: () => void) => Promise<string>
  readonly pickRemote: (names: readonly string[]) => Promise<string | undefined>
  /** The held window's "Trust this worktree…": asks, and releases the hold on a yes. */
  readonly confirmWorktreeTrust: () => Promise<void>
  readonly now: () => number
  readonly log: Logger
}

interface Generation {
  readonly id: number
  readonly kind: GitDraftKind
  turnId: string | undefined
}

interface TurnSeen {
  text: string | undefined
  terminal: string | undefined
}

interface Destination {
  readonly repository: GitHubRepository
  readonly defaultBase: string
  /** The head as GitHub's API takes it: `branch`, or `owner:branch` from a fork. */
  readonly apiHead: string
  /** The fork the branch is in, when it is not `repository`. */
  readonly headRepository: string | undefined
}

interface PullRequestTarget {
  readonly repository: GitHubRepository
  readonly plan: PushPlan
  readonly remote: string
  readonly remoteUrl: string
  readonly branch: string
  /** The branch as the remote names it: the pull request's head. */
  readonly head: string
}

const EMPTY_STATE_JSON = '{}'
const COMPLETED_TERMINAL = 'completed'
const AGENT_MESSAGE_KIND = 'agentMessage'
const HEAD_REF = 'HEAD'
const LINE_BREAK = /\r?\n/

/** Immutable comparison: Git's state objects may be replaced or mutated while a dialog waits. */
function changedPaths(changes: readonly GitChange[]): readonly string[] {
  return changes
    .map((change) => change.uri.fsPath)
    .toSorted((left, right) => left.localeCompare(right))
}

function repositoryStamp(repository: GitRepository): string {
  const { HEAD, remotes } = repository.state
  return JSON.stringify({
    root: repository.rootUri.fsPath,
    head: {
      branch: HEAD?.name,
      commit: HEAD?.commit,
      remote: HEAD?.upstream?.remote,
      target: HEAD?.upstream?.name,
      ahead: HEAD?.ahead,
      behind: HEAD?.behind,
    },
    remotes: remotes.map((remote) => ({
      name: remote.name,
      fetchUrl: remote.fetchUrl,
      pushUrl: remote.pushUrl,
    })),
    staged: changedPaths(repository.state.indexChanges),
    unstaged: changedPaths(repository.state.workingTreeChanges),
    untracked: changedPaths(repository.state.untrackedChanges),
  })
}

interface CommitSnapshot {
  readonly stamp: string
  readonly staged: string
  readonly unstaged: string
  readonly untracked: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** git's own words from a failure of the git extension: its stderr, else the message. */
function gitFailureText(error: unknown): string {
  if (isRecord(error) && typeof error['stderr'] === 'string' && error['stderr'].trim() !== '') {
    return redactSecrets(error['stderr'].trim().slice(-STDERR_SHOWN_CHARS))
  }
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

/** The git extension's error code, for the log (never git's text, which can name paths). */
function gitFailureCode(error: unknown): string {
  return isRecord(error) && typeof error['gitErrorCode'] === 'string'
    ? wireWordForLog(error['gitErrorCode'])
    : 'no code'
}

function pushRefusalText(plan: Extract<PushPlan, { ok: false }>): string {
  const texts: Readonly<Record<typeof plan.refusal, string>> = {
    detached: UI_TEXT.gitPushDetached,
    unsafeName: UI_TEXT.gitPushUnsafeName,
    behind: UI_TEXT.gitPushBehind,
    upToDate: UI_TEXT.gitPushUpToDate,
    noRemote: UI_TEXT.gitPushNoRemote,
    // The user dismissed the remote pick.
    chooseRemote: UI_TEXT.gitPushDeclined,
  }
  return texts[plan.refusal]
}

export class ConversationGit implements ConversationGitPort {
  private generation: Generation | undefined
  private generationEpoch = 0
  private observedSessionId: string | undefined
  private readonly turnsSeen = new Map<string, TurnSeen>()
  /** The pull request form's facts, for the generation prompt. */
  private pullRequestForm: PullRequestFormFacts | undefined
  private pullRequestStamp: string | undefined
  private commitForm: CommitSnapshot | undefined
  private link: PullRequestLink | undefined
  /** A pull request opened before the conversation had a session: linked once it does. */
  private pendingLink: PullRequestLink | undefined
  private view: PullRequestView | undefined
  /** Counts status reads, so a slow one never overwrites a newer one. */
  private statusEpoch = 0
  /** What the webview was last sent, so an unchanged state is not sent again. */
  private lastPostedJson = EMPTY_STATE_JSON
  /** A commit, push or pull request operation is running (one at a time). */
  private isOperating = false
  private isDisposed = false
  private operationEpoch = 0
  private checkOperation: (() => void) | undefined

  public constructor(
    private readonly window: GitWindow,
    private readonly surface: GitSurface,
  ) {}

  private currentState(): GitState {
    const hold = this.window.hold()
    const worktree = this.window.worktree()
    const pullRequest = hold?.pullRequest
    return {
      ...(hold !== undefined && {
        hold: {
          isRestricted: !this.window.isWorkspaceTrusted(),
          ...(pullRequest !== undefined && {
            pullRequest: {
              repository: pullRequest.repository,
              number: pullRequest.number,
              title: pullRequest.title,
              author: pullRequest.author,
              url: pullRequest.url,
            },
          }),
        },
      }),
      ...(worktree !== undefined && {
        worktree: {
          repositoryRoot: worktree.repositoryRoot,
          ...(worktree.branch !== undefined && { branch: worktree.branch }),
          ...(worktree.pullRequest !== undefined && {
            pullRequestNumber: worktree.pullRequest.number,
          }),
        },
      }),
      ...(this.view !== undefined && { pullRequest: this.view }),
    }
  }

  /** Why git and pull requests are unavailable here, or undefined. */
  private unavailableReason(): string | undefined {
    if (!this.window.isWorkspaceTrusted()) {
      return UI_TEXT.gitRestricted
    }
    if (this.window.hold() !== undefined) {
      return UI_TEXT.gitHeld
    }
    return this.window.workspaceRoot === undefined ? UI_TEXT.noWorkspaceReason : undefined
  }

  /** A consent belongs to this conversation and trust state, never to a later one. */
  private activityCheck(): () => void {
    const epoch = this.operationEpoch
    const sessionId = this.surface.sessionId()
    return () => {
      if (
        this.isDisposed ||
        epoch !== this.operationEpoch ||
        sessionId !== this.surface.sessionId()
      ) {
        throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
      }
      const reason = this.unavailableReason()
      if (reason !== undefined) {
        throw new GitUnavailableError(reason)
      }
    }
  }

  private checkCurrent(repository?: GitRepository, stamp?: string): void {
    this.checkOperation?.()
    if (repository !== undefined && stamp !== undefined && repositoryStamp(repository) !== stamp) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
  }

  private canPost(): boolean {
    return !this.isDisposed
  }

  private isStatusCurrent(epoch: number): boolean {
    return epoch === this.statusEpoch && this.canPost() && this.unavailableReason() === undefined
  }

  /** The repository, or undefined after saying why there is none. */
  private async usableRepository(): Promise<GitRepository | undefined> {
    const reason = this.unavailableReason()
    const root = this.window.workspaceRoot
    if (reason !== undefined || root === undefined) {
      this.surface.notice('warning', reason ?? UI_TEXT.noWorkspaceReason)
      return undefined
    }
    try {
      const owned = await this.ownedRepository(root, this.checkOperation ?? this.activityCheck())
      this.checkOperation = owned.check
      return owned.repository
    } catch (error: unknown) {
      this.window.log.warn(
        `The git extension could not open the repository (${gitFailureCode(error)})`,
      )
      if (this.canPost()) {
        this.surface.say('warning', `${UI_TEXT.gitUnavailable}: ${gitFailureText(error)}`)
      }
      return undefined
    }
  }

  private async ownedRepository(root: string, check: () => void) {
    return await openOwnedRepository(
      root,
      this.window.platform,
      this.window.repository,
      this.window.captureGitOwner,
      check,
    )
  }

  private relativePath(repository: GitRepository, change: GitChange): string {
    const p = this.window.platform === 'win32' ? path.win32 : path.posix
    return p.relative(repository.rootUri.fsPath, change.uri.fsPath).replaceAll('\\', '/')
  }

  private async openCommitForm(): Promise<void> {
    this.commitForm = undefined
    const repository = await this.usableRepository()
    if (repository === undefined) {
      return
    }
    const { state } = repository
    const unstaged = [...state.workingTreeChanges, ...state.untrackedChanges]
    const files = [
      ...state.indexChanges.map((change) => ({
        path: this.relativePath(repository, change),
        isStaged: true,
      })),
      ...unstaged.map((change) => ({
        path: this.relativePath(repository, change),
        isStaged: false,
      })),
    ]
    if (files.length === 0) {
      this.surface.notice('info', UI_TEXT.gitNothingToCommit)
      return
    }
    this.commitForm = await this.commitSnapshot(repository)
    this.checkCurrent()
    this.surface.post({
      type: 'gitCommitForm',
      form: {
        ...(state.HEAD?.name !== undefined && { branch: state.HEAD.name }),
        staged: state.indexChanges.length,
        unstaged: unstaged.length,
        files: files.slice(0, GIT_FORM_FILES_SHOWN),
        moreFiles: Math.max(files.length - GIT_FORM_FILES_SHOWN, 0),
      },
    })
  }

  /** The push for the current branch, asking which remote when git cannot tell. */
  private async pushPlanFor(repository: GitRepository): Promise<PushPlan> {
    this.checkCurrent()
    const stamp = repositoryStamp(repository)
    const { HEAD, remotes } = repository.state
    const head = {
      branch: HEAD?.name,
      upstream: HEAD?.upstream,
      ahead: HEAD?.ahead,
      behind: HEAD?.behind,
    }
    const plan = planPush(head, remotes)
    if (plan.ok || plan.refusal !== 'chooseRemote') {
      return plan
    }
    const chosen = await this.window.pickRemote(plan.remotes ?? [])
    this.checkCurrent(repository, stamp)
    return chosen === undefined ? plan : planPush(head, remotes, chosen)
  }

  /**
   * Asks, then pushes exactly `plan`: three arguments to the git extension,
   * never a force mode. True when the push went through.
   */
  private async pushWithConfirmation(
    repository: GitRepository,
    plan: Extract<PushPlan, { ok: true }>,
  ): Promise<boolean> {
    this.checkCurrent()
    if (!isPlainRefspec(plan.refspec) || !isPlainRefName(plan.remote)) {
      // planPush never makes one; this is the last line before git.
      this.surface.notice('warning', UI_TEXT.gitPushUnsafeName)
      return false
    }
    const stamp = repositoryStamp(repository)
    const isConfirmed = await this.window.confirmPush({
      remote: plan.remote,
      remoteUrl: plan.remoteUrl === undefined ? undefined : maskRemoteUrl(plan.remoteUrl),
      branch: plan.branch,
      target: plan.target,
      commits: plan.commits,
    })
    this.checkCurrent(repository, stamp)
    if (!isConfirmed) {
      this.surface.notice('info', UI_TEXT.gitPushDeclined)
      return false
    }
    try {
      await this.window.admit(async () => {
        this.checkCurrent(repository, stamp)
        await repository.status()
        this.checkCurrent(repository, stamp)
        await repository.push(plan.remote, plan.refspec, plan.setUpstream)
      })
    } catch (error: unknown) {
      this.window.log.warn(`Push failed (${gitFailureCode(error)})`)
      if (this.canPost()) {
        this.surface.say('error', `${UI_TEXT.gitPushFailed}: ${gitFailureText(error)}`)
      }
      return false
    }
    this.window.log.info('Pushed through the git extension')
    this.surface.notice(
      'info',
      fill(UI_TEXT.gitPushed, { branch: plan.branch, remote: plan.remote }),
    )
    return true
  }

  private async push(): Promise<void> {
    const repository = await this.usableRepository()
    if (repository === undefined) {
      return
    }
    const plan = await this.pushPlanFor(repository)
    if (!plan.ok) {
      this.surface.notice(plan.refusal === 'upToDate' ? 'info' : 'warning', pushRefusalText(plan))
      return
    }
    await this.pushWithConfirmation(repository, plan)
  }

  /** The GitHub repository and branch a pull request would name, or why none. */
  private async pullRequestTarget(
    repository: GitRepository,
  ): Promise<PullRequestTarget | undefined> {
    const plan = await this.pushPlanFor(repository)
    const upstream = repository.state.HEAD?.upstream
    const branch = repository.state.HEAD?.name
    if (branch === undefined || !isPlainRefName(branch)) {
      this.surface.notice(
        'warning',
        branch === undefined ? UI_TEXT.gitPushDetached : UI_TEXT.gitPushUnsafeName,
      )
      return undefined
    }
    if (!plan.ok && plan.refusal !== 'behind' && plan.refusal !== 'upToDate') {
      this.surface.notice('warning', pushRefusalText(plan))
      return undefined
    }
    const remote = plan.ok ? plan.remote : upstream?.remote
    const remoteFacts = repository.state.remotes.find((candidate) => candidate.name === remote)
    const remoteUrl = remoteFacts?.pushUrl ?? remoteFacts?.fetchUrl
    const github = remoteUrl === undefined ? undefined : githubRepositoryOf(remoteUrl)
    if (remote === undefined || remoteUrl === undefined || github === undefined) {
      this.surface.notice('warning', fill(UI_TEXT.gitHubOnly, { remote: remote ?? '' }))
      return undefined
    }
    return {
      repository: github,
      plan,
      remote,
      remoteUrl: maskRemoteUrl(remoteUrl),
      branch,
      head: plan.ok ? plan.target : (upstream?.name ?? branch),
    }
  }

  /** A GitHub token after VS Code's sign-in, or undefined after saying it was not given. */
  private async askedToken(): Promise<string | undefined> {
    const token = await this.window.githubToken('ask')
    this.checkCurrent()
    if (token === undefined) {
      this.surface.notice('info', UI_TEXT.gitHubSignInDeclined)
    }
    return token
  }

  private githubFailure(error: unknown): void {
    if (!this.canPost()) {
      return
    }
    const text = redactSecrets(error instanceof GitHubError ? error.message : String(error))
    // The client logged the status and its kind; GitHub's words are shown only.
    this.surface.say('error', `${UI_TEXT.gitHubFailed}: ${text}`)
  }

  /**
   * Where the pull request opens: the remote's repository, or for a fork the
   * repository it came from, with the branch named `owner:branch` there.
   */
  private async destinationOf(token: string, target: PullRequestTarget): Promise<Destination> {
    const facts = await this.window.github.repositoryFacts(token, target.repository)
    this.checkCurrent()
    const { parent } = facts
    return parent === undefined
      ? {
          repository: target.repository,
          defaultBase: facts.defaultBranch,
          apiHead: target.head,
          headRepository: undefined,
        }
      : {
          repository: parent.repository,
          defaultBase: parent.defaultBranch,
          apiHead: `${target.repository.owner}:${target.head}`,
          headRepository: repositoryLabel(target.repository),
        }
  }

  private async openPullRequestForm(): Promise<void> {
    this.pullRequestForm = undefined
    this.pullRequestStamp = undefined
    const repository = await this.usableRepository()
    if (repository === undefined) {
      return
    }
    const target = await this.pullRequestTarget(repository)
    this.checkCurrent()
    if (target === undefined) {
      return
    }
    const stamp = repositoryStamp(repository)
    const token = await this.askedToken()
    this.checkCurrent(repository, stamp)
    if (token === undefined) {
      return
    }
    let destination: Destination
    try {
      destination = await this.destinationOf(token, target)
      this.checkCurrent(repository, stamp)
      const existing = await this.window.github.openPullRequestFor(
        token,
        destination.repository,
        target.repository.owner,
        target.head,
      )
      this.checkCurrent(repository, stamp)
      if (existing !== undefined) {
        this.surface.notice('info', fill(UI_TEXT.gitPullRequestExists, { number: existing.number }))
        await this.linkPullRequest({
          repository: repositoryLabel(destination.repository),
          number: existing.number,
          url: existing.url,
          title: existing.title,
          linkedAt: this.window.now(),
        })
        return
      }
    } catch (error: unknown) {
      this.githubFailure(error)
      return
    }
    let pushState: PullRequestFormFacts['push'] = 'pushed'
    if (target.plan.ok) {
      pushState = 'needed'
    } else if (target.plan.refusal === 'behind') {
      pushState = 'behind'
    }
    const form: PullRequestFormFacts = {
      repository: repositoryLabel(destination.repository),
      ...(destination.headRepository !== undefined && {
        headRepository: destination.headRepository,
      }),
      remote: target.remote,
      remoteUrl: target.remoteUrl,
      head: target.head,
      base: destination.defaultBase,
      push: pushState,
      ...(target.plan.ok && target.plan.commits !== undefined && { commits: target.plan.commits }),
    }
    this.pullRequestForm = form
    this.pullRequestStamp = stamp
    this.surface.post({ type: 'gitPullRequestForm', form })
  }

  /** What stops a pull request before anything is asked, or undefined. */
  private pullRequestProblem(title: string, body: string, base: string): string | undefined {
    if (title === '') {
      return UI_TEXT.gitTitleEmpty
    }
    if (title.length > PULL_REQUEST_TITLE_MAX_CHARS || body.length > PULL_REQUEST_BODY_MAX_CHARS) {
      return UI_TEXT.gitTextTooLong
    }
    return isPlainRefName(base) ? undefined : UI_TEXT.gitBaseInvalid
  }

  private async linkPullRequest(link: PullRequestLink): Promise<void> {
    this.checkCurrent()
    this.link = link
    this.statusEpoch += 1
    this.view = {
      repository: link.repository,
      number: link.number,
      title: link.title,
      url: link.url,
    }
    this.postState()
    const sessionId = this.surface.sessionId()
    if (sessionId === undefined) {
      this.pendingLink = link
    } else {
      await this.window.links.set(sessionId, link)
      this.checkCurrent()
    }
    await this.refreshStatus('silent')
  }

  /** The linked pull request's state and checks from GitHub; `ask` may prompt for the sign-in. */
  private async refreshStatus(mode: 'silent' | 'ask'): Promise<void> {
    if (this.unavailableReason() !== undefined || this.isDisposed) {
      return
    }
    const link = this.link
    const repository = link === undefined ? undefined : repositoryFromFullName(link.repository)
    if (link === undefined || repository === undefined) {
      return
    }
    const epoch = ++this.statusEpoch
    const base = {
      repository: link.repository,
      number: link.number,
      title: link.title,
      url: link.url,
    }
    const settle = (view: PullRequestView) => {
      if (!this.isStatusCurrent(epoch)) {
        return
      }

      this.view = view
      this.postState()
    }
    const token = await this.window.githubToken(mode)
    if (!this.isStatusCurrent(epoch)) {
      return
    }
    if (token === undefined) {
      settle({ ...base, needsSignIn: true })
      return
    }
    try {
      const pullRequest = await this.window.github.pullRequest(token, repository, link.number)
      if (!this.isStatusCurrent(epoch)) {
        return
      }
      const checks = await this.window.github.checks(token, repository, pullRequest.headSha)
      settle({
        ...base,
        title: pullRequest.title,
        state: pullRequest.state,
        isDraft: pullRequest.isDraft,
        isMerged: pullRequest.isMerged,
        checks: { ...checks, failedNames: [...checks.failedNames], other: [...checks.other] },
        checkedAt: this.window.now(),
      })
    } catch (error: unknown) {
      settle({
        ...base,
        problem: redactSecrets(error instanceof GitHubError ? error.message : String(error)),
        ...(error instanceof GitHubError && error.kind === 'signIn' && { needsSignIn: true }),
      })
    }
  }

  private async commitSnapshot(repository: GitRepository): Promise<CommitSnapshot> {
    this.checkCurrent()
    await repository.status()
    this.checkCurrent()
    const stamp = repositoryStamp(repository)
    const staged = await repository.diff(true)
    this.checkCurrent(repository, stamp)
    const unstaged = await repository.diff(false)
    this.checkCurrent(repository, stamp)
    const untracked = await this.window.untrackedFingerprint(
      changedPaths(repository.state.untrackedChanges),
      () => {
        this.checkCurrent(repository, stamp)
      },
    )
    this.checkCurrent(repository, stamp)
    return { stamp, staged, unstaged, untracked }
  }

  private async commitPrompt(repository: GitRepository, check: () => void): Promise<string> {
    const { state } = repository
    const isStaged = state.indexChanges.length > 0
    const changes = isStaged
      ? state.indexChanges
      : [...state.workingTreeChanges, ...state.untrackedChanges]
    if (changes.length === 0) {
      throw new Error(UI_TEXT.gitNothingToCommit)
    }
    let diff: string
    try {
      check()
      diff = await repository.diff(isStaged)
      check()
    } catch (error: unknown) {
      this.window.log.warn(`A draft's diff could not be read (${gitFailureCode(error)})`)
      throw new Error(UI_TEXT.gitUnavailable, { cause: error })
    }
    return commitMessagePrompt({
      branch: state.HEAD?.name,
      scope: isStaged ? 'staged' : 'all',
      files: changes.map((change) => this.relativePath(repository, change)),
      diff,
    })
  }

  private async pullRequestTextPrompt(
    repository: GitRepository,
    check: () => void,
    base?: string,
  ): Promise<string> {
    const form = this.pullRequestForm
    if (form === undefined) {
      throw new Error(UI_TEXT.gitOpenPullRequestFirst)
    }
    const comparisonBase = base ?? form.base
    if (!isPlainRefName(comparisonBase)) {
      throw new GitUnavailableError(UI_TEXT.gitBaseInvalid)
    }
    const baseRef = `${form.remote}/${comparisonBase}`
    try {
      check()
      const commits = await repository.log({ range: `${baseRef}..${HEAD_REF}` })
      check()
      const changes = await repository.diffBetween(baseRef, HEAD_REF)
      check()
      return pullRequestPrompt({
        head: form.head,
        base: comparisonBase,
        commits: commits
          .slice(0, GIT_PROMPT_COMMITS_MAX)
          .map((commit) => commit.message.split(LINE_BREAK, 1)[0] ?? ''),
        files: changes.map((change) => this.relativePath(repository, change)),
      })
    } catch (error: unknown) {
      check()
      if (error instanceof GitUnavailableError) {
        throw error
      }
      this.window.log.warn(`The branch's commits could not be listed (${gitFailureCode(error)})`)
      return pullRequestPrompt({
        head: form.head,
        base: comparisonBase,
        commits: undefined,
        files: undefined,
        commitsUnavailable: gitFailureText(error),
      })
    }
  }

  private seen(turnId: string): TurnSeen {
    const known = this.turnsSeen.get(turnId)
    if (known !== undefined) {
      return known
    }
    const fresh: TurnSeen = { text: undefined, terminal: undefined }
    this.turnsSeen.set(turnId, fresh)
    return fresh
  }

  /** Once the generation's turn has ended: its last reply, read as a draft. */
  private settleGeneration(): void {
    const generation = this.generation
    const turnId = generation?.turnId
    const seen = turnId === undefined ? undefined : this.turnsSeen.get(turnId)
    if (generation === undefined || seen?.terminal === undefined) {
      return
    }
    this.generation = undefined
    this.turnsSeen.clear()
    const reply = seen.terminal === COMPLETED_TERMINAL ? seen.text : undefined
    if (generation.kind === 'commitMessage') {
      const message = reply === undefined ? undefined : commitMessageFrom(reply)
      if (message !== undefined) {
        this.surface.post({ type: 'gitDraft', draft: { kind: 'commitMessage', message } })
        return
      }
    } else {
      const text = reply === undefined ? undefined : pullRequestTextFrom(reply)
      if (text !== undefined) {
        this.surface.post({ type: 'gitDraft', draft: { kind: 'pullRequest', ...text } })
        return
      }
    }
    this.surface.post({ type: 'gitDraft', draft: { kind: 'failed', forKind: generation.kind } })
    this.surface.notice('warning', UI_TEXT.gitDraftFailed)
  }

  /**
   * Runs `operation` unless another commit, push or pull request operation
   * is running for this conversation: a second press is ignored.
   */
  private async exclusively(operation: () => Promise<void>, form?: GitForm): Promise<void> {
    if (this.isDisposed || this.isOperating) {
      this.window.log.info('A git operation is already running here; the second press is ignored')
      return
    }
    this.isOperating = true
    this.checkOperation = this.activityCheck()
    try {
      this.checkCurrent()
      await operation()
    } catch (error: unknown) {
      if (this.canPost()) {
        this.window.log.warn(`Git operation stopped (${gitFailureCode(error)})`)
        this.surface.say('warning', gitFailureText(error))
        if (form !== undefined) {
          this.surface.post({ type: 'gitDone', form, ok: false })
        }
      }
    } finally {
      this.checkOperation = undefined
      this.isOperating = false
    }
  }

  private async commitNow(message: string, isUnstagedIncluded: boolean): Promise<void> {
    const done = (isOk: boolean) => {
      if (this.canPost()) {
        this.surface.post({ type: 'gitDone', form: 'commit', ok: isOk })
      }
    }
    const trimmed = message.trim()
    if (trimmed === '') {
      this.surface.notice('warning', UI_TEXT.gitCommitMessageEmpty)
      done(false)
      return
    }
    if (hasCredentialShapes(trimmed)) {
      // The form gets the masked text back; the user sees it before anything is kept.
      this.surface.post({
        type: 'gitDraft',
        draft: { kind: 'commitMessage', message: redactSecrets(trimmed) },
      })
      this.surface.notice('warning', UI_TEXT.gitCredentialMasked)
      done(false)
      return
    }
    const repository = await this.usableRepository()
    if (repository === undefined) {
      done(false)
      return
    }
    if (!isUnstagedIncluded && repository.state.indexChanges.length === 0) {
      this.surface.notice('warning', UI_TEXT.gitNothingStaged)
      done(false)
      return
    }
    const snapshot = await this.commitSnapshot(repository)
    if (
      this.commitForm !== undefined &&
      JSON.stringify(snapshot) !== JSON.stringify(this.commitForm)
    ) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
    const changes = isUnstagedIncluded
      ? [
          ...repository.state.indexChanges,
          ...repository.state.workingTreeChanges,
          ...repository.state.untrackedChanges,
        ]
      : repository.state.indexChanges
    if (changes.length === 0) {
      this.surface.notice('warning', UI_TEXT.gitNothingToCommit)
      done(false)
      return
    }
    const isConfirmed = await this.window.confirmCommit({
      message: trimmed,
      branch: repository.state.HEAD?.name ?? HEAD_REF,
      files: [...new Set(changes.map((change) => this.relativePath(repository, change)))],
      includesUnstaged: isUnstagedIncluded,
    })
    this.checkCurrent(repository, snapshot.stamp)
    if (!isConfirmed) {
      done(false)
      return
    }
    // Hooks run here: the last look at the repository happens inside the
    // admission, so nothing changes between it and the call.
    const isCommitted = await this.window.admit(async () => {
      const fresh = await this.commitSnapshot(repository)
      if (JSON.stringify(fresh) !== JSON.stringify(snapshot)) {
        throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
      }
      try {
        this.checkCurrent(repository, fresh.stamp)
        await repository.commit(trimmed, {
          ...(isUnstagedIncluded && { all: true }),
          // VS Code's `git.postCommitCommand` could push or sync: never here.
          postCommitCommand: null,
        })
        return true
      } catch (error: unknown) {
        this.window.log.warn(`Commit failed (${gitFailureCode(error)})`)
        if (this.canPost()) {
          this.surface.say('error', `${UI_TEXT.gitCommitFailed}: ${gitFailureText(error)}`)
        }
        return false
      }
    })
    if (!isCommitted) {
      done(false)
      return
    }
    this.window.log.info('Committed through the git extension')
    this.commitForm = undefined
    const subject = trimmed.split(LINE_BREAK, 1)[0] ?? trimmed
    this.surface.notice(
      'info',
      fill(UI_TEXT.gitCommitted, { subject, branch: repository.state.HEAD?.name ?? HEAD_REF }),
    )
    done(true)
  }

  private async createPullRequestNow(request: NewPullRequestRequest): Promise<void> {
    const done = (isOk: boolean) => {
      if (this.canPost()) {
        this.surface.post({ type: 'gitDone', form: 'pullRequest', ok: isOk })
      }
    }
    const title = request.title.trim()
    const base = request.base.trim()
    const problem = this.pullRequestProblem(title, request.body, base)
    if (problem !== undefined) {
      this.surface.notice('warning', problem)
      done(false)
      return
    }
    if (hasCredentialShapes(title) || hasCredentialShapes(request.body)) {
      // The form gets the masked text back: what goes out is what the user saw.
      this.surface.post({
        type: 'gitDraft',
        draft: {
          kind: 'pullRequest',
          title: redactSecrets(title),
          body: redactSecrets(request.body),
        },
      })
      this.surface.notice('warning', UI_TEXT.gitCredentialMasked)
      done(false)
      return
    }
    const repository = await this.usableRepository()
    const target = repository === undefined ? undefined : await this.pullRequestTarget(repository)
    this.checkCurrent()
    if (repository === undefined || target === undefined) {
      done(false)
      return
    }
    if (target.head !== request.head) {
      this.surface.notice('warning', UI_TEXT.gitBranchChanged)
      done(false)
      return
    }
    const form = this.pullRequestForm
    if (form === undefined) {
      this.surface.notice('warning', UI_TEXT.gitOpenPullRequestFirst)
      done(false)
      return
    }
    const stamp = repositoryStamp(repository)
    if (stamp !== this.pullRequestStamp) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
    const headCommit = repository.state.HEAD?.commit
    // GitHub first (the sign-in, where it opens), so a declined sign-in or
    // an unreachable GitHub leaves nothing pushed.
    const token = await this.askedToken()
    this.checkCurrent(repository, stamp)
    if (token === undefined) {
      done(false)
      return
    }
    let destination: Destination
    try {
      destination = await this.destinationOf(token, target)
      this.checkCurrent(repository, stamp)
    } catch (error: unknown) {
      this.githubFailure(error)
      done(false)
      return
    }
    if (
      form.repository !== repositoryLabel(destination.repository) ||
      form.headRepository !== destination.headRepository ||
      form.remote !== target.remote ||
      form.remoteUrl !== target.remoteUrl ||
      form.head !== target.head
    ) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
    // Then the branch goes up, asking as every push does.
    if (target.plan.ok && !(await this.pushWithConfirmation(repository, target.plan))) {
      done(false)
      return
    }
    this.checkCurrent()
    await repository.status()
    this.checkCurrent()
    const head = repository.state.HEAD
    const remote = repository.state.remotes.find((candidate) => candidate.name === target.remote)
    const url = remote?.pushUrl ?? remote?.fetchUrl
    if (
      head?.name !== target.branch ||
      head.commit !== headCommit ||
      (url === undefined ? undefined : maskRemoteUrl(url)) !== target.remoteUrl ||
      (head.upstream !== undefined &&
        (head.upstream.remote !== target.remote || head.upstream.name !== target.head))
    ) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
    let created
    try {
      created = await this.window.github.createPullRequest(token, destination.repository, {
        title,
        body: request.body,
        head: destination.apiHead,
        base,
        isDraft: request.isDraft,
      })
      this.checkCurrent()
    } catch (error: unknown) {
      this.githubFailure(error)
      done(false)
      return
    }
    this.window.log.info(
      `Opened pull request #${String(created.number)}${request.isDraft ? ' as a draft' : ''}`,
    )
    this.surface.notice(
      'info',
      fill(request.isDraft ? UI_TEXT.gitDraftPullRequestOpened : UI_TEXT.gitPullRequestOpened, {
        number: created.number,
        url: created.url,
      }),
    )
    this.pullRequestForm = undefined
    this.pullRequestStamp = undefined
    done(true)
    await this.linkPullRequest({
      repository: repositoryLabel(destination.repository),
      number: created.number,
      url: created.url,
      title: created.title,
      linkedAt: this.window.now(),
    })
  }

  /**
   * The hold card, the worktree line and the pull request strip, sent when
   * they change; `isSurfaceReady` for a webview that starts with none of them.
   */
  public postState(isSurfaceReady = false): void {
    if (this.isDisposed) {
      return
    }
    const state = this.currentState()
    const json = JSON.stringify(state)
    const previous = isSurfaceReady ? EMPTY_STATE_JSON : this.lastPostedJson
    this.lastPostedJson = json
    if (json !== previous) {
      this.surface.post({ type: 'gitState', state })
    }
  }

  /** The conversation now holds `sessionId` (or none): its linked pull request shows. */
  public sessionChanged(sessionId: string | undefined): void {
    // The first backend session belongs to this same conversation: its PR
    // form/draft can be opened before any model turn. Clear/switch invalidates
    // them; first attachment must preserve them.
    if (
      sessionId === undefined ||
      (this.observedSessionId !== undefined && this.observedSessionId !== sessionId)
    ) {
      this.operationEpoch += 1
      this.commitForm = undefined
      this.pullRequestForm = undefined
      this.pullRequestStamp = undefined
      this.generationFailed()
    }
    this.observedSessionId = sessionId
    if (sessionId === undefined) {
      // A new conversation: nothing of the last one's pull request or draft stays.
      this.pendingLink = undefined
      this.generation = undefined
      this.turnsSeen.clear()
    }
    const pending = this.pendingLink
    if (sessionId !== undefined && pending !== undefined) {
      this.pendingLink = undefined
      void this.window.links.set(sessionId, pending).catch((error: unknown) => {
        this.window.log.warn(`The pull request link could not be kept (${gitFailureCode(error)})`)
      })
    }
    const link = sessionId === undefined ? undefined : this.window.links.get(sessionId)
    this.link = link ?? pending
    this.statusEpoch += 1
    this.view =
      this.link === undefined
        ? undefined
        : {
            repository: this.link.repository,
            number: this.link.number,
            title: this.link.title,
            url: this.link.url,
          }
    this.postState()
    if (this.link !== undefined) {
      void this.refreshStatus('silent').catch((error: unknown) => {
        this.window.log.warn(`The pull request status could not be read (${gitFailureCode(error)})`)
      })
    }
  }

  public async handleAction(action: GitAction): Promise<void> {
    switch (action) {
      case 'openCommit': {
        await this.exclusively(() => this.openCommitForm())
        break
      }
      case 'push': {
        await this.exclusively(() => this.push())
        break
      }
      case 'openPullRequest': {
        await this.exclusively(() => this.openPullRequestForm())
        break
      }
      case 'refreshPullRequest': {
        await this.refreshStatus('silent')
        break
      }
      case 'signInGitHub': {
        await this.refreshStatus('ask')
        break
      }
      case 'trustWorktree': {
        await this.window.confirmWorktreeTrust()
        break
      }
      case 'cancel': {
        this.operationEpoch += 1
        this.commitForm = undefined
        this.pullRequestForm = undefined
        this.pullRequestStamp = undefined
        this.generationFailed()
        break
      }
    }
  }

  public async commit(message: string, isUnstagedIncluded: boolean): Promise<void> {
    await this.exclusively(() => this.commitNow(message, isUnstagedIncluded), 'commit')
  }

  public async createPullRequest(request: NewPullRequestRequest): Promise<void> {
    await this.exclusively(() => this.createPullRequestNow(request), 'pullRequest')
  }

  /**
   * What the model needs beside the user's own message asking for `kind`.
   * Throws with the reason in words when it cannot be built.
   */
  public async promptFor(kind: GitDraftKind, base?: string): Promise<string> {
    const check = this.activityCheck()
    check()
    const reason = this.unavailableReason()
    const root = this.window.workspaceRoot
    if (reason !== undefined || root === undefined) {
      throw new Error(reason ?? UI_TEXT.noWorkspaceReason)
    }
    let repository: GitRepository
    let checkOwned: () => void
    try {
      const owned = await this.ownedRepository(root, check)
      repository = owned.repository
      checkOwned = owned.check
    } catch (error: unknown) {
      // The card says it in fixed words; git's own may name a path, so the log gets its code.
      this.window.log.warn(`A draft's repository could not be read (${gitFailureCode(error)})`)
      throw new Error(UI_TEXT.gitUnavailable, { cause: error })
    }
    const stamp = repositoryStamp(repository)
    if (
      kind === 'pullRequest' &&
      this.pullRequestForm !== undefined &&
      stamp !== this.pullRequestStamp
    ) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
    const checkDraft = () => {
      checkOwned()
      if (repositoryStamp(repository) !== stamp) {
        throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
      }
    }
    const prompt =
      kind === 'commitMessage'
        ? await this.commitPrompt(repository, checkDraft)
        : await this.pullRequestTextPrompt(repository, checkDraft, base)
    checkDraft()
    return prompt
  }

  /** The user's generation message is about to go: its reply is the draft. */
  public generationStarting(kind: GitDraftKind): number {
    this.generationEpoch += 1
    this.generation = { id: this.generationEpoch, kind, turnId: undefined }
    this.turnsSeen.clear()
    return this.generationEpoch
  }

  public isGenerationCurrent(id: number): boolean {
    return this.generation?.id === id && this.canPost()
  }

  /** The message was accepted as `turnId`. */
  public generationSubmitted(turnId: string, id?: number): void {
    if (this.generation === undefined || (id !== undefined && !this.isGenerationCurrent(id))) {
      return
    }
    this.generation.turnId = turnId
    this.settleGeneration()
  }

  /** The message did not go: the form's Generate button comes back. */
  public generationFailed(id?: number): void {
    if (id !== undefined && !this.isGenerationCurrent(id)) {
      return
    }
    const kind = this.generation?.kind
    this.generation = undefined
    this.turnsSeen.clear()
    if (kind !== undefined) {
      this.surface.post({ type: 'gitDraft', draft: { kind: 'failed', forKind: kind } })
    }
  }

  /** The conversation's events, while a generation waits for its reply. */
  public onEvent(event: AgentEvent): void {
    const generation = this.generation
    if (generation === undefined) {
      return
    }
    // Before the acceptance names the turn, every turn is kept (at most the
    // few that end while it is in flight); after, only that one.
    const isWatched = (turnId: string) =>
      generation.turnId === undefined || generation.turnId === turnId
    if (
      event.type === 'itemCompleted' &&
      event.item.kind === AGENT_MESSAGE_KIND &&
      event.item.turnId !== undefined &&
      isWatched(event.item.turnId)
    ) {
      this.seen(event.item.turnId).text = event.item.text
    } else if (event.type === 'turnCompleted' && isWatched(event.turnId)) {
      this.seen(event.turnId).terminal = event.terminal
      this.settleGeneration()
    }
  }

  public dispose(): void {
    this.isDisposed = true
    this.operationEpoch += 1
    this.statusEpoch += 1
    this.generation = undefined
    this.turnsSeen.clear()
  }
}
