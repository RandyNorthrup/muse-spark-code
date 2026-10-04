// "Open a pull request in a conversation…" (M71, PLAN.md D49): the pull
// request's head is fetched from GitHub through VS Code's git extension
// (credentials apply) and checked out, detached, in a worktree of its own
// that opens in a new window, where a conversation reviews or changes it
// with its host confined to that worktree.
//
// A pull request the user did not author is adversarial content until the
// user says otherwise: its worktree goes under the extension's own storage,
// git never checks it out (heldCheckout.ts writes its files as stored),
// and the window that opens on it is held (core/worktreeConversations.ts)
// until the user trusts that worktree in the extension's own card
// (`confirmWorktreeTrust`), whatever VS Code's trust says. The user's own
// pull request goes beside the repository like any worktree (M32).

import { GIT_WORKTREE_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type GitHubClient, isCommitSha, type PullRequest } from '../../core/git/github'
import { githubRepositoryOf, repositoryLabel } from '../../core/git/githubRemote'
import {
  type GitHubRemote,
  pullRequestRefFrom,
  remoteForPullRequest,
} from '../../core/git/pullRequestRef'
import { isPlainRefName } from '../../core/git/pushPlan'
import { isSameFolder, worktreeAddDetachedArgs, worktreeFolder } from '../../core/worktrees'
import {
  heldWorktreeFolder,
  type WorktreeHold,
  type WorktreeRecord,
} from '../../core/worktreeConversations'
import type { Logger } from '../logger'
import {
  GitUnavailableError,
  openOwnedRepository,
  type CaptureGitOwner,
  type GitRepository,
} from './gitExtension'
import type { HeldCheckout } from './heldCheckout'
import type { WindowHold, WorktreeRegistry } from './worktreeRegistry'

export interface PullRequestCheckoutDeps {
  readonly workspaceRoot: string | undefined
  readonly platform: NodeJS.Platform
  readonly isWorkspaceTrusted: () => boolean
  readonly isHeld: () => boolean
  /** The extension's global storage folder. */
  readonly storageRoot: string
  readonly repository: (root: string) => Promise<GitRepository>
  readonly captureGitOwner: CaptureGitOwner
  /** The extension's own git (git.ts): by absolute path, no prompt. */
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs?: number,
    input?: string,
    beforeRun?: () => void,
  ) => Promise<string>
  /**
   * Someone else's pull request: added with nothing checked out and its
   * files written by the extension (heldCheckout.ts), so no checkout filter,
   * conversion or hook of git's runs on them.
   */
  readonly checkOutHeld: HeldCheckout
  /** Fetch helpers and checkout filters may write: use the window's checkpoint process admission. */
  readonly admit: <T>(start: () => Promise<T>) => Promise<T>
  readonly githubToken: (mode: 'ask' | 'silent') => Promise<string | undefined>
  readonly github: GitHubClient
  readonly registry: WorktreeRegistry
  /** An input box; `validate` answers undefined for a good value. */
  readonly askPullRequest: (
    validate: (value: string) => string | undefined,
  ) => Promise<string | undefined>
  /** A modal; true only for an explicit yes. */
  readonly confirm: (message: string, detail: string, action: string) => Promise<boolean>
  readonly pathExists: (fsPath: string) => boolean
  /** The folder in a new window. */
  readonly openFolder: (fsPath: string) => Promise<void>
  readonly showInformation: (message: string) => void
  readonly showWarning: (message: string) => void
  readonly showError: (message: string) => void
  /** An error with detail another program chose: the detail is shown, not logged. */
  readonly showFailure: (message: string, detail: string) => void
  readonly now: () => number
  readonly log: Logger
}

// GitHub keeps every pull request's head at this ref of the base repository.
function pullHeadRef(number: number): string {
  return `pull/${String(number)}/head`
}

// git's revision suffix for "the commit this names" (gitrevisions(7)).
const COMMIT_PEEL = '^{commit}'

// The user's own pull request goes beside the repository as `<repo>.worktrees/pr-<n>`.
const OWN_FOLDER_PREFIX = 'pr-'

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The repository's GitHub remotes, with the repository each names. */
function githubRemotes(repository: GitRepository): readonly GitHubRemote[] {
  return repository.state.remotes.flatMap((remote) => {
    const url = remote.fetchUrl ?? remote.pushUrl
    const github = url === undefined ? undefined : githubRepositoryOf(url)
    return github === undefined ? [] : [{ name: remote.name, repository: github }]
  })
}

/** What the confirmation says about where the pull request goes and how it is held. */
function confirmationDetail(pullRequest: PullRequest, isOwn: boolean): string {
  const from =
    pullRequest.headRepository === undefined
      ? pullRequest.headRef
      : `${pullRequest.headRepository}:${pullRequest.headRef}`
  return [
    pullRequest.title,
    fill(UI_TEXT.openPullRequestBy, { author: pullRequest.author.login }),
    fill(UI_TEXT.openPullRequestBranches, { head: from, base: pullRequest.baseRef }),
    isOwn ? UI_TEXT.openPullRequestOwnDetail : UI_TEXT.openPullRequestHeldDetail,
    ...(isOwn ? [] : [UI_TEXT.openPullRequestUnfilteredDetail]),
    UI_TEXT.gitCommandConsequences,
  ].join('\n')
}

/** Why the flow cannot start here, or undefined. */
function startProblem(deps: PullRequestCheckoutDeps): string | undefined {
  if (!deps.isWorkspaceTrusted()) {
    return UI_TEXT.gitRestricted
  }
  if (deps.isHeld()) {
    return UI_TEXT.gitHeld
  }
  return deps.workspaceRoot === undefined ? UI_TEXT.worktreeNoWorkspace : undefined
}

export async function openPullRequestInConversation(deps: PullRequestCheckoutDeps): Promise<void> {
  const problem = startProblem(deps)
  const root = deps.workspaceRoot
  if (problem !== undefined || root === undefined) {
    deps.showWarning(problem ?? UI_TEXT.worktreeNoWorkspace)
    return
  }
  let repository: GitRepository
  let canonicalRoot: string
  let checkOwner: () => void
  const checkTrust = () => {
    const currentProblem = startProblem(deps)
    if (currentProblem !== undefined) {
      throw new GitUnavailableError(currentProblem)
    }
  }
  try {
    const owned = await openOwnedRepository(
      root,
      deps.platform,
      deps.repository,
      deps.captureGitOwner,
      checkTrust,
    )
    canonicalRoot = owned.cwd
    repository = owned.repository
    checkOwner = owned.check
  } catch (error: unknown) {
    deps.showFailure(UI_TEXT.gitUnavailable, failureText(error))
    return
  }
  const remotes = JSON.stringify(repository.state.remotes)
  const repositoryRoot = repository.rootUri.fsPath
  const check = () => {
    checkOwner()
    if (
      !isSameFolder(repository.rootUri.fsPath, repositoryRoot, deps.platform) ||
      JSON.stringify(repository.state.remotes) !== remotes
    ) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
  }
  try {
    const typed = await deps.askPullRequest((value) =>
      pullRequestRefFrom(value).ok ? undefined : UI_TEXT.openPullRequestInvalid,
    )
    check()
    const ref = typed === undefined ? undefined : pullRequestRefFrom(typed)
    if (!ref?.ok) {
      return
    }
    const remote = remoteForPullRequest(
      githubRemotes(repository),
      ref.repository,
      repository.state.HEAD?.upstream?.remote,
    )
    if (remote === undefined) {
      deps.showWarning(
        ref.repository === undefined
          ? UI_TEXT.openPullRequestNoRemote
          : fill(UI_TEXT.openPullRequestOtherRepository, {
              repository: repositoryLabel(ref.repository),
            }),
      )
      return
    }
    const token = await deps.githubToken('ask')
    check()
    if (token === undefined) {
      deps.showInformation(UI_TEXT.gitHubSignInDeclined)
      return
    }
    let pullRequest: PullRequest
    let isOwn: boolean
    try {
      const [found, user] = await Promise.all([
        deps.github.pullRequest(token, remote.repository, ref.number),
        deps.github.currentUser(token),
      ])
      check()
      pullRequest = found
      isOwn = found.author.id === user.id
    } catch (error: unknown) {
      deps.showFailure(UI_TEXT.gitHubFailed, failureText(error))
      return
    }
    await checkOut(deps, {
      root,
      cwd: canonicalRoot,
      repository,
      remote,
      pullRequest,
      isOwn,
      check,
    })
  } catch (error: unknown) {
    deps.showFailure(UI_TEXT.openPullRequestFetchFailed, failureText(error))
  }
}

interface CheckoutPlan {
  /** Original workspace name: own-PR location and stored display semantics. */
  readonly root: string
  /** Captured physical execution directory, independent of the workspace alias. */
  readonly cwd: string
  readonly repository: GitRepository
  readonly remote: GitHubRemote
  readonly pullRequest: PullRequest
  readonly isOwn: boolean
  readonly check: () => void
}

async function checkOut(deps: PullRequestCheckoutDeps, plan: CheckoutPlan): Promise<void> {
  const { root, cwd, repository, remote, pullRequest, isOwn, check } = plan
  const folder = isOwn
    ? worktreeFolder(root, `${OWN_FOLDER_PREFIX}${String(pullRequest.number)}`, deps.platform)
    : heldWorktreeFolder(deps.storageRoot, remote.repository, pullRequest.number, deps.platform)
  if (deps.pathExists(folder)) {
    // Checked out before: offered again as it is. A folder the extension did
    // not make, or a checkout that never finished (the window closed while
    // it wrote), is never taken over or opened.
    const existing = deps.registry.recordFor(folder)
    if (existing === undefined || existing.isCheckoutPending === true) {
      deps.showError(`${UI_TEXT.worktreeFolderExists} ${folder}`)
    } else if (
      await deps.confirm(
        fill(UI_TEXT.openPullRequestExisting, { number: pullRequest.number }),
        folder,
        UI_TEXT.worktreeOpen,
      )
    ) {
      check()
      await deps.openFolder(folder)
    }
    return
  }
  const isConfirmed = await deps.confirm(
    fill(UI_TEXT.openPullRequestConfirm, { number: pullRequest.number }),
    confirmationDetail(pullRequest, isOwn),
    UI_TEXT.openPullRequestAction,
  )
  check()
  if (!isConfirmed) {
    return
  }
  if (!isCommitSha(pullRequest.headSha)) {
    deps.showFailure(UI_TEXT.gitHubFailed, pullRequest.headSha)
    return
  }
  // A remote named like an option would read as one where git receives it.
  if (!isPlainRefName(remote.name)) {
    deps.showWarning(UI_TEXT.gitPushUnsafeName)
    return
  }
  try {
    check()
    // Through VS Code's git extension, so the user's credentials reach a private repository.
    await deps.admit(async () => {
      check()
      await repository.fetch({ remote: remote.name, ref: pullHeadRef(pullRequest.number) })
    })
    check()
    // The head GitHub named must be what came: a push in between is refused, not guessed.
    const fetched = await deps.runGit(
      ['rev-parse', '--verify', `FETCH_HEAD${COMMIT_PEEL}`],
      cwd,
      undefined,
      undefined,
      check,
    )
    check()
    if (fetched.trim() !== pullRequest.headSha) {
      throw new GitUnavailableError(UI_TEXT.gitOperationChanged)
    }
  } catch (error: unknown) {
    deps.log.warn(`Fetching pull request #${String(pullRequest.number)} failed`)
    deps.showFailure(UI_TEXT.openPullRequestFetchFailed, failureText(error))
    return
  }
  const record: WorktreeRecord = {
    folder,
    repositoryRoot: root,
    createdAt: deps.now(),
    pullRequest: {
      repository: repositoryLabel(remote.repository),
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      author: pullRequest.author.login,
      headSha: pullRequest.headSha,
      isAuthoredByUser: isOwn,
    },
    isHeld: !isOwn,
    isCheckoutPending: true,
  }
  // Recorded before the folder exists, so no window ever sees it unrecorded;
  // pending until the checkout finished.
  const previous = await deps.registry.put(record)
  try {
    await deps.admit(async () => {
      check()
      await (isOwn
        ? deps.runGit(
            // A relative core.hooksPath can resolve to executable code from
            // this PR in the new worktree; the trust card has not approved that code.
            [
              '-c',
              `core.hooksPath=${deps.platform === 'win32' ? 'NUL' : '/dev/null'}`,
              ...worktreeAddDetachedArgs(folder, pullRequest.headSha),
            ],
            cwd,
            GIT_WORKTREE_TIMEOUT_MS,
            undefined,
            check,
          )
        : deps.checkOutHeld(folder, pullRequest.headSha, cwd, check))
    })
    await deps.registry.complete(folder, record.createdAt)
  } catch (error: unknown) {
    await deps.registry.remove(folder, record.createdAt, previous)
    deps.showFailure(UI_TEXT.worktreeAddFailed, failureText(error))
    return
  }
  check()
  deps.log.info(
    `Pull request #${String(pullRequest.number)} checked out in a worktree${isOwn ? '' : ', held'}`,
  )
  await deps.openFolder(folder)
  check()
  deps.showInformation(
    fill(isOwn ? UI_TEXT.openPullRequestOpened : UI_TEXT.openPullRequestOpenedHeld, {
      number: pullRequest.number,
    }),
  )
}

export interface TrustConfirmationDeps {
  readonly hold: WindowHold
  readonly registry: WorktreeRegistry
  readonly workspaceRoot: string | undefined
  readonly confirm: (message: string, detail: string, action: string) => Promise<boolean>
  /** Restarts the backends, so the next message loads the project's configuration. */
  readonly restartBackends: () => Promise<void>
  /** Every conversation's card and composer hear the hold is gone. */
  readonly holdReleased: () => void
  readonly now: () => number
  readonly log: Logger
}

function trustDetail(hold: WorktreeHold): string {
  const pullRequest = hold.pullRequest
  return [
    ...(pullRequest === undefined
      ? []
      : [
          fill(UI_TEXT.worktreeTrustPullRequest, {
            number: pullRequest.number,
            author: pullRequest.author,
          }),
        ]),
    UI_TEXT.worktreeTrustDetail,
    UI_TEXT.worktreeTrustOtherExtensions,
  ].join('\n\n')
}

/** The held-worktree card's "Trust this worktree…": asks, then lets the hold go. */
export async function confirmWorktreeTrust(deps: TrustConfirmationDeps): Promise<void> {
  const hold = deps.hold.current
  if (hold === undefined) {
    return
  }
  const isTrusted = await deps.confirm(
    UI_TEXT.worktreeTrustConfirm,
    trustDetail(hold),
    UI_TEXT.worktreeTrustAction,
  )
  if (!isTrusted || deps.hold.current !== hold) {
    return
  }
  const record = deps.registry.recordFor(hold.folder)
  await deps.registry.put({
    folder: hold.folder,
    repositoryRoot: record?.repositoryRoot ?? deps.workspaceRoot ?? hold.folder,
    createdAt: record?.createdAt ?? deps.now(),
    ...(record?.branch !== undefined && { branch: record.branch }),
    ...(record?.pullRequest !== undefined && { pullRequest: record.pullRequest }),
    isHeld: false,
    trustConfirmedAt: deps.now(),
  })
  deps.hold.release()
  deps.log.info('The held worktree was trusted in the card; restarting the backends')
  await deps.restartBackends()
  deps.holdReleased()
}
