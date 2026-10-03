// The VS Code side of M71 (PLAN.md D49), built once per window: the push
// modal, the remote pick, the pull request number box, the confirmations,
// the new window, and the pieces every conversation's git shares.

import { existsSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, readlink } from 'node:fs/promises'
import * as vscode from 'vscode'
import { BOUNDED_FILE_READ_CHUNK_BYTES, UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { GitHubClient } from '../../core/git/github'
import { newFileDiff } from '../../core/git/gitText'
import type { Logger } from '../logger'
import { loggedPopups } from '../popups'
import { newWindowActions } from '../worktreeFeatures'
import type {
  CommitConfirmation,
  GitWindow,
  PushConfirmation,
  UntrackedFile,
} from './conversationGit'
import {
  captureGitOwner,
  GitUnavailableError,
  loadGitApi,
  repositoryAt,
  type GitRepository,
} from './gitExtension'
import {
  confirmWorktreeTrust,
  openPullRequestInConversation,
  type PullRequestCheckoutDeps,
} from './pullRequestCheckout'
import type { PullRequestLinks } from './pullRequestLinks'
import type { WindowHold, WorktreeRegistry } from './worktreeRegistry'

export interface GitWindowDeps {
  readonly workspaceRoot: string | undefined
  readonly storageRoot: string
  readonly hold: WindowHold
  readonly registry: WorktreeRegistry
  readonly links: PullRequestLinks
  readonly github: GitHubClient
  readonly githubToken: (mode: 'ask' | 'silent') => Promise<string | undefined>
  readonly runGit: PullRequestCheckoutDeps['runGit']
  readonly checkOutHeld: PullRequestCheckoutDeps['checkOutHeld']
  /** This activation still owns the window, including across native metadata waits. */
  readonly isCurrent: () => boolean
  /** The window's admission for a process that may write the workspace (M72): hooks run in a commit or a push. */
  readonly admit: GitWindow['admit']
  /** Stops the backends, so the next message starts them with the new trust. */
  readonly restartBackends: (reason: string) => Promise<void>
  /** Tells every conversation in the window that the hold is gone. */
  readonly holdReleased: () => void
  readonly log: Logger
}

export interface GitWindowFeatures {
  readonly window: GitWindow
  openPullRequestInConversation(): Promise<void>
}

/** Git diff omits new files; fingerprint their content without loading whole files into memory. */
export async function fingerprintUntracked(
  paths: readonly string[],
  check: () => void,
): Promise<string> {
  const hash = createHash('sha256')
  for (const file of paths) {
    check()
    const metadata = await lstat(file)
    check()
    hash.update(JSON.stringify({ file, mode: metadata.mode, size: metadata.size }))
    if (metadata.isSymbolicLink()) {
      hash.update(await readlink(file))
      check()
      continue
    }
    if (!metadata.isFile()) {
      throw new GitUnavailableError(UI_TEXT.gitUnavailable)
    }
    const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try {
      check()
      const buffer = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES)
      let bytesRead: number
      do {
        ;({ bytesRead } = await handle.read(buffer, 0, buffer.length, null))
        check()
        hash.update(buffer.subarray(0, bytesRead))
      } while (bytesRead !== 0)
    } finally {
      await handle.close()
    }
    check()
  }
  return hash.digest('hex')
}

/** Up to `max` bytes from the start of a regular file; undefined for a link or anything else. */
async function fileStart(
  file: string,
  max: number,
): Promise<{ readonly bytes: Buffer; readonly size: number } | undefined> {
  const metadata = await lstat(file)
  if (!metadata.isFile()) {
    return undefined
  }
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const bytes = Buffer.alloc(Math.min(max, metadata.size))
    let filled = 0
    while (filled < bytes.length) {
      const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, filled)
      if (bytesRead === 0) {
        break
      }
      filled += bytesRead
    }
    return { bytes: bytes.subarray(0, filled), size: metadata.size }
  } finally {
    await handle.close()
  }
}

/**
 * New files' contents for the commit prompt, at most `maxBytes` read in all.
 * A file that is gone, unreadable, a link or a folder is left to the file list.
 */
export async function untrackedDiff(
  files: readonly UntrackedFile[],
  maxBytes: number,
  check: () => void,
): Promise<string> {
  const parts: string[] = []
  let room = maxBytes
  for (const file of files) {
    if (room <= 0) {
      break
    }
    check()
    let start: Awaited<ReturnType<typeof fileStart>>
    try {
      start = await fileStart(file.path, room)
    } catch {
      start = undefined
    }
    check()
    if (start === undefined) {
      continue
    }
    room -= start.bytes.length
    parts.push(newFileDiff(file.label, start.bytes, start.size))
  }
  return parts.join('\n')
}

async function isModalConfirmed(message: string, detail: string, action: string): Promise<boolean> {
  return (
    (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action
  )
}

/** Every part of a push, in the modal that asks for it; never a force. */
async function isPushConfirmed(confirmation: PushConfirmation): Promise<boolean> {
  const detail = [
    fill(UI_TEXT.gitPushRemoteLine, {
      remote: confirmation.remote,
      url: confirmation.remoteUrl ?? UI_TEXT.gitPushNoUrl,
    }),
    fill(UI_TEXT.gitPushBranchLine, { branch: confirmation.branch, target: confirmation.target }),
    confirmation.commits === undefined
      ? UI_TEXT.gitPushFirstPush
      : plural(UI_TEXT.gitPushCommits, confirmation.commits),
    UI_TEXT.gitPushNeverForce,
    UI_TEXT.gitCommandConsequences,
  ].join('\n')
  return await isModalConfirmed(
    fill(UI_TEXT.gitPushConfirm, { branch: confirmation.branch, remote: confirmation.remote }),
    detail,
    UI_TEXT.gitPushAction,
  )
}

async function isCommitConfirmed(confirmation: CommitConfirmation): Promise<boolean> {
  return await isModalConfirmed(
    UI_TEXT.gitCommitConfirm,
    [
      confirmation.message,
      fill(UI_TEXT.gitOnBranch, { branch: confirmation.branch }),
      confirmation.includesUnstaged ? UI_TEXT.gitIncludeUnstaged : UI_TEXT.gitFileStaged,
      ...confirmation.files.map((file) => JSON.stringify(file)),
      UI_TEXT.gitCommandConsequences,
    ].join('\n\n'),
    UI_TEXT.gitCommitAction,
  )
}

/** The repository at `root` through VS Code's git extension. */
async function repository(root: string): Promise<GitRepository> {
  return await repositoryAt(await loadGitApi(), root)
}

export function createGitWindow(deps: GitWindowDeps): GitWindowFeatures {
  let isCheckingOut = false
  const popups = loggedPopups(deps.log)
  const window: GitWindow = {
    workspaceRoot: deps.workspaceRoot,
    platform: process.platform,
    isWorkspaceTrusted: () => deps.isCurrent() && vscode.workspace.isTrusted,
    hold: () => deps.hold.current,
    worktree: () =>
      deps.workspaceRoot === undefined ? undefined : deps.registry.recordFor(deps.workspaceRoot),
    repository,
    captureGitOwner,
    admit: deps.admit,
    githubToken: deps.githubToken,
    github: deps.github,
    links: deps.links,
    confirmPush: isPushConfirmed,
    confirmCommit: isCommitConfirmed,
    untrackedFingerprint: fingerprintUntracked,
    untrackedDiff,
    pickRemote: async (names) =>
      await vscode.window.showQuickPick([...names], {
        title: UI_TEXT.gitPickRemoteTitle,
        placeHolder: UI_TEXT.gitPickRemotePlaceholder,
      }),
    confirmWorktreeTrust: () =>
      confirmWorktreeTrust({
        hold: deps.hold,
        registry: deps.registry,
        workspaceRoot: deps.workspaceRoot,
        confirm: isModalConfirmed,
        restartBackends: () => deps.restartBackends('the held worktree was trusted in the card'),
        holdReleased: deps.holdReleased,
        now: () => Date.now(),
        log: deps.log,
      }),
    now: () => Date.now(),
    log: deps.log,
  }
  const checkoutDeps = (): PullRequestCheckoutDeps => ({
    workspaceRoot: deps.workspaceRoot,
    platform: process.platform,
    isWorkspaceTrusted: () => deps.isCurrent() && vscode.workspace.isTrusted,
    isHeld: () => deps.hold.isHeld,
    storageRoot: deps.storageRoot,
    repository,
    captureGitOwner,
    runGit: deps.runGit,
    checkOutHeld: deps.checkOutHeld,
    admit: deps.admit,
    githubToken: deps.githubToken,
    github: deps.github,
    registry: deps.registry,
    askPullRequest: async (validate) =>
      await vscode.window.showInputBox({
        title: UI_TEXT.openPullRequestTitle,
        placeHolder: UI_TEXT.openPullRequestPlaceholder,
        ignoreFocusOut: true,
        validateInput: validate,
      }),
    confirm: isModalConfirmed,
    pathExists: existsSync,
    ...newWindowActions,
    ...popups,
    now: () => Date.now(),
    log: deps.log,
  })
  return {
    window,
    async openPullRequestInConversation() {
      if (isCheckingOut) {
        deps.log.info('A pull request checkout is already running; the second press is ignored')
        return
      }
      isCheckingOut = true
      try {
        await openPullRequestInConversation(checkoutDeps())
      } finally {
        isCheckingOut = false
      }
    },
  }
}
