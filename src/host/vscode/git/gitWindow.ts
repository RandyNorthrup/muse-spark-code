// The VS Code side of M71 (PLAN.md D49), built once per window: the push
// modal, the remote pick, the pull request number box, the confirmations,
// the new window, and the pieces every conversation's git shares. It ships
// in dist/conversationGit.js (PLAN.md D6) and is built there, the first time
// a conversation or the pull request command asks, from activation's
// primitives (`createGitFeatures`).

import { existsSync } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, readlink } from 'node:fs/promises'
import * as vscode from 'vscode'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  GIT_PUSH_CREDENTIAL_VARIABLES,
  UI_TEXT,
} from '../../../shared/constants'
import { withoutCredentials } from '../../../core/credentialEnvironment'
import { fill } from '../../../shared/l10n/text'
import { signInFailureText } from '../../../core/git/deviceFlow'
import { GitHubClient, GitHubError, type GitHubClientDeps } from '../../../core/git/github'
import type { GitHubSignIn } from '../../../core/git/githubSignIn'
import { newFileDiff } from '../../../core/git/gitText'
import { pushConfirmationText } from '../../../core/git/pushConfirmation'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import { processGitPath, type GitProcess } from '../../git'
import type { SecretStore } from '../../auth/credentialStore'
import type { Logger } from '../../logger'
import { loggedPopups } from '../popups'
import { newWindowActions } from '../worktreeFeatures'
import { windowGitHubSignIn } from './githubSession'
import { createHeldCheckout } from '../../git/heldCheckout'
import {
  type LinkMemento,
  PullRequestLinks,
  pullRequestLinkStoreOf,
} from '../../git/pullRequestLinks'
import { untrustedGitRunner } from '../../git/untrustedGit'
import {
  windowWorktreeState,
  type CommitConfirmation,
  type GitWindow,
  type PushConfirmation,
  type UntrackedFile,
} from '../../git/conversationGit'
import {
  captureGitOwner,
  GitUnavailableError,
  isGitExtensionInstalled,
  loadGitApi,
  repositoryAt,
  type CheckoutRepository,
  type GitRepository,
} from './gitExtension'
import { nativeGitLoader } from '../../git/nativeGitBundle'
import { nativeCheckoutRepository } from '../../git/nativeRepository'
import {
  confirmWorktreeTrust,
  openPullRequestInConversation,
  type PullRequestCheckoutDeps,
} from '../../git/pullRequestCheckout'
import type { WindowHold, WorktreeRegistry } from '../../git/worktreeRegistry'

export interface GitWindowDeps {
  readonly workspaceRoot: string | undefined
  readonly storageRoot: string
  readonly hold: WindowHold
  readonly registry: WorktreeRegistry
  readonly links: PullRequestLinks
  readonly github: GitHubClient
  /** The window's GitHub sign-in over D104's sources (M123): every GitHub call's credential. */
  readonly githubSignIn: GitHubSignIn
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
  /** `muse-spark-code/<version>`, as the REST client sends it (M123's native route). */
  readonly userAgent: string
  /** Aborts with the window: the native route's git stops with it (M123). */
  readonly signal: AbortSignal
  /** dist/nativeGit.js: M123's native route, loaded only where `vscode.git` is missing. */
  readonly nativeGitBundlePath: string
  /** The checkout's repository through the user's own git, where `vscode.git` is missing (M123). */
  readonly nativeCheckoutRepository: (root: string) => Promise<CheckoutRepository>
  readonly log: Logger
}

export interface GitWindowFeatures {
  readonly window: GitWindow
  openPullRequestInConversation(): Promise<void>
}

/**
What activation hands the bundle for the window's git and pull requests:
its own primitives only. The GitHub client, the sign-in reader, the
pull request links and the held checkout are made here, beside the code
that throws and checks their errors.
*/
export interface GitFeaturesDeps extends Omit<
  GitWindowDeps,
  'links' | 'github' | 'githubSignIn' | 'checkOutHeld' | 'nativeCheckoutRepository'
> {
  /** VS Code's secret storage: where Muse Spark's own GitHub sign-in keeps its token (M123). */
  readonly secrets: SecretStore
  /** The workspace state the conversations' pull request links are kept in. */
  readonly workspaceState: LinkMemento
  /** VS Code's proxy-aware fetch, as it stands at each request (M56, D43). */
  readonly fetch: GitHubClientDeps['fetch']
  /** `muse-spark-code/<version>`: GitHub refuses a request without one. */
  readonly userAgent: string
  /** git with binary stdout (git.ts `createGitProcess`), for the held checkout. */
  readonly gitProcess: GitProcess
  /** What the held checkout's git runs with, its untrusted lane too: the window's environment. */
  readonly env: NodeJS.ProcessEnv
}

/** The window's git features from activation's primitives (M71). */
export function createGitFeatures(deps: GitFeaturesDeps): GitWindowFeatures {
  const { workspaceState, fetch, userAgent, gitProcess, env, secrets, ...windowDeps } = deps
  return createGitWindow({
    ...windowDeps,
    userAgent,
    links: new PullRequestLinks(workspaceState),
    github: new GitHubClient({ fetch, userAgent, log: deps.log }),
    githubSignIn: windowGitHubSignIn({ secrets, fetch, userAgent, log: deps.log }),
    nativeCheckoutRepository: nativeCheckoutRepository({
      gitProcess,
      env,
      signal: deps.signal,
    }),
    // Someone else's pull request: no git checkout; the extension writes its files (M71).
    checkOutHeld: createHeldCheckout({
      platform: process.platform,
      runGit: untrustedGitRunner(env),
      gitProcess,
      env,
      log: deps.log,
    }),
  })
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

/**
A file start's gone-or-unreadable vocabulary: the file left to the file
list. Anything else is not this row's to hide.
*/
const FILE_START_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EPERM',
  'ELOOP',
  'ENAMETOOLONG',
  'EBUSY',
])

function isFileStartError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    FILE_START_CODES.has(error.code)
  )
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
New files' contents for the commit prompt, at most `maxBytes` read in all.
A file that is gone, unreadable, a link or a folder is left to the file list.
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
    } catch (error: unknown) {
      if (!isFileStartError(error)) {
        throw error
      }
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
  const { message, detail } = pushConfirmationText(confirmation)
  return await isModalConfirmed(message, detail, UI_TEXT.gitPushAction)
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

/**
A failed native push's command in the editor's terminal: git itself, no
shell to quote for, in exactly `env` (`strictEnv`): the user's
environment with no credential variable but the Git routes (RVM123G2 R3).
*/
function gitTerminalOpener(
  env: NodeJS.ProcessEnv,
): (command: readonly string[], cwd: string) => Promise<void> {
  return (command, cwd) => {
    const [shellPath, ...shellArgs] = command
    if (shellPath !== undefined) {
      vscode.window
        .createTerminal({
          name: UI_TEXT.gitPushAction,
          cwd,
          shellPath,
          shellArgs: [...shellArgs],
          env,
          strictEnv: true,
        })
        .show()
    }
    return Promise.resolve()
  }
}

/**
M123's native route over this window (PLAN.md D104), for a host without
the `vscode.git` extension: the user's git on PATH, the window's trust,
hold, admission and pull request links, VS Code's push modal and remote
pick, and the extension host's own environment for the push (the one VS
Code's git extension would use), captured now with no credential
variable but the Git routes. Undefined with no folder or no git.
*/
function nativeGitDeps(deps: GitWindowDeps, window: GitWindow): RuntimeGitDeps | undefined {
  const root = deps.workspaceRoot
  if (root === undefined) {
    return undefined
  }
  const gitPath = processGitPath(root)
  if (gitPath === undefined) {
    return undefined
  }
  const userEnvironment = withoutCredentials(process.env, GIT_PUSH_CREDENTIAL_VARIABLES)
  return {
    repositoryRoot: root,
    gitPath,
    // The same sign-in as the Git extension route: one card, one account.
    github: deps.githubSignIn,
    links: pullRequestLinkStoreOf(deps.links),
    isTrusted: () => window.isWorkspaceTrusted() && deps.hold.current === undefined,
    // The same card and worktree line as the Git extension route.
    worktreeState: () => windowWorktreeState(window),
    confirmWorktreeTrust: window.confirmWorktreeTrust,
    confirmPush: isPushConfirmed,
    confirm: isModalConfirmed,
    pickRemote: window.pickRemote,
    userEnvironment: () => userEnvironment,
    admitWorkspaceCommand: deps.admit,
    openInTerminal: gitTerminalOpener(userEnvironment),
    openFolder: newWindowActions.openFolder,
    openExternal: async (url) => {
      await vscode.env.openExternal(vscode.Uri.parse(url))
    },
    dataFolder: deps.storageRoot,
    userAgent: deps.userAgent,
    signal: deps.signal,
    log: deps.log,
  }
}

export function createGitWindow(deps: GitWindowDeps): GitWindowFeatures {
  let isCheckingOut = false
  const popups = loggedPopups(deps.log)
  // M123's native route, loaded the first time a conversation needs it.
  const nativeBundle = nativeGitLoader({ bundlePath: deps.nativeGitBundlePath, log: deps.log })
  // A token per GitHub call, in D104's order. A sign-in that failed is said
  // in its fixed words (the conversation's own adapter says it in the panel).
  const githubToken = async (mode: 'ask' | 'silent'): Promise<string | undefined> => {
    try {
      const credential = await deps.githubSignIn.credential(mode, deps.signal)
      return credential?.bearer
    } catch (error: unknown) {
      if (!deps.signal.aborted) {
        popups.showWarning(signInFailureText(error) ?? UI_TEXT.githubSignIn.cancelled)
      }
      return undefined
    }
  }
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
    githubToken,
    githubSignIn: deps.githubSignIn,
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
    // A VS Code-family host without `vscode.git` (M123, D104 §1).
    nativeGit: () => {
      const native = nativeGitDeps(deps, window)
      return native === undefined ? undefined : { deps: native, bundle: nativeBundle }
    },
  }
  const checkoutDeps = (): PullRequestCheckoutDeps => ({
    workspaceRoot: deps.workspaceRoot,
    platform: process.platform,
    isWorkspaceTrusted: () => deps.isCurrent() && vscode.workspace.isTrusted,
    isHeld: () => deps.hold.isHeld,
    storageRoot: deps.storageRoot,
    // VS Code's Git where it is installed; the user's own git where it is not.
    repository: isGitExtensionInstalled() ? repository : deps.nativeCheckoutRepository,
    captureGitOwner,
    runGit: deps.runGit,
    checkOutHeld: deps.checkOutHeld,
    admit: deps.admit,
    githubToken,
    // A 401 drops the refused credential at its source, as every other
    // GitHub call of the window does (conversationGit.ts `dropRejected`).
    dropRejectedGitHubToken: (token, error) => {
      if (error instanceof GitHubError && error.kind === 'signIn') {
        void deps.githubSignIn.rejectedBearer(token).catch(() => {
          deps.log.warn('A refused GitHub sign-in could not be dropped')
        })
      }
    },
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
