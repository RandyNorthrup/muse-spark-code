// Someone else's pull request, or the user's own, checked out into its
// own worktree by the runtime, in every editor (M123, PLAN.md D104).
//
// The user's own pull request goes beside the repository as `pr-<n>`,
// like any worktree. Any other author's goes under the runtime data
// folder's `pr-worktrees/`, exactly as M71 does it (RV71c): added with
// nothing checked out, indexed from the commit, its files written from one
// `cat-file --batch`, the listing refused whole on any bad name, and no
// git runs in the worktree once a byte of the pull request is in it. The
// hold is by location over both roots (VS Code's storage and the runtime
// data folder), and the trust card's release only marks the record; the
// panel (lane U) shows the card.
//
// The confirmed pull request fetch uses the user's Git environment (its
// credential helpers, SSH agent and token variables, as a terminal would,
// with `GIT_TERMINAL_PROMPT=0`, and nothing of ours); every other Git call
// keeps the quiet environment (no credentials, no prompt). Git runs
// through the injected port: lane G owns the shared native runner, so this
// port carries the documented untrusted-lane arguments until integration
// converges them (see `untrustedCheckoutArgs`).
//
// Every git this module starts goes through `runGit` or `startGitBatch`,
// which call the caller's gate and then start the process in the same
// synchronous turn: nothing can change between the check and the spawn
// (PLAN.md M123's lock protocol). A checkout's gate asks that the project
// is still trusted, that Cancel was not pressed, and that the record is
// still exactly this checkout's reservation (its fence).

import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { mkdir, rename, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import {
  GIT_BATCH_KILL_GRACE_MS,
  GIT_OUTPUT_MAX_BYTES,
  GIT_WORKTREE_TIMEOUT_MS,
  HELD_CHECKOUT_MAX_BYTES,
  HELD_CHECKOUT_MAX_ENTRIES,
  HELD_CLEANUP_REMOVE_RETRIES,
  HELD_CLEANUP_TIMEOUT_MS,
  HELD_EXECUTABLE_MODE,
  HELD_FILE_MODE,
  HELD_WRITER_DRAIN_GRACE_MS,
  PENDING_CHECKOUT_RECOVERY_MS,
  UI_TEXT,
  UNTRUSTED_CHECKOUT_MIN_GIT_MINOR,
  WORKTREE_RECORD_SAVE_ATTEMPTS,
} from '../../../shared/constants'
import { fill, formatBytes } from '../../../shared/l10n/text'
import { GitHubClient, isCommitSha, type PullRequest } from '../../../core/git/github'
import { repositoryLabel } from '../../../core/git/githubRemote'
import {
  BlobAnswers,
  heldDestination,
  namedHookOverrides,
  pullRequestCheckoutConfirmation,
} from '../../../core/git/heldCheckoutCore'
import { heldTree, type HeldEntry, unsafePathReason } from '../../../core/git/heldTree'
import {
  pullRequestRefFrom,
  remoteForPullRequest,
  type GitHubRemote,
} from '../../../core/git/pullRequestRef'
import { isPlainRefName } from '../../../core/git/pushPlan'
import { isSamePath } from '../../../core/paths'
import { withoutCredentials } from '../../../core/credentialEnvironment'
import {
  fileIdentityKey,
  identityOf,
  lstatIdentity,
  sameFile,
  statIdentity,
  type FileIdentity,
} from '../../../core/fs/fileIdentity'
import { currentProcessOwner, isProcessOwnerGone } from '../../../core/locks/processOwner'
import { heldWorktreeFolder, type WorktreeRecord } from '../../../core/worktreeConversations'
import {
  worktreeAddDetachedArgs,
  worktreeAddHeldArgs,
  worktreeFolder,
  worktreeRemoveArgs,
} from '../../../core/worktrees'
import { canonicalPath } from '../../../host/canonicalPath'
import { hasGitProgramControls } from '../../../host/git'
import { createFileExclusively } from '../../../host/fsAtomic'
import type { CoreLogger } from '../../../core/logging'
import { redactSecrets } from '../../../core/redact'
import {
  didDropRejectedCredential,
  resolveGitHubCredential,
  type GitHubCredential,
} from '../../../core/git/tokenSource'
import { PullRequestServiceError, type RuntimePullRequestDeps } from './pullRequests'
import {
  holdForRoots,
  isReservationOf,
  recordRevision,
  UnknownWriteError,
  versionOf,
  type Reservation,
  type ReserveResult,
  type TrustTicket,
  type WorktreeRecordStore,
} from './records'

const COMMIT_PEEL = '^{commit}'
// A folder made under a private name beside its place, and one moved
// aside to be removed: a held one's both under the held root, so held like
// the rest.
const FOLDER_STAGING_SUFFIX = '.claiming'
const FOLDER_REMOVING_SUFFIX = '.removing'
const OWN_FOLDER_PREFIX = 'pr-'
const FETCH_HEAD = 'FETCH_HEAD'

function nullDeviceFor(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'NUL' : '/dev/null'
}

/**
 * Every git a held pull request's checkout runs, with these before each
 * command's own: no hooks, no fsmonitor, no replacement objects, no
 * automatic maintenance or garbage collection. Mirrors
 * `UNTRUSTED_CHECKOUT_OPTIONS` (src/host/git/untrustedGit.ts), which lane G
 * owns; the null device is the platform's, as the own-checkout path spells
 * it. Converge on lane G's runner at integration.
 */
function untrustedCheckoutArgs(platform: NodeJS.Platform): readonly string[] {
  return [
    '--no-replace-objects',
    '-c',
    `core.hooksPath=${nullDeviceFor(platform)}`,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
  ]
}

function checkoutRefusal(): Error {
  return new PullRequestServiceError(UI_TEXT.openPullRequestFiltersUnavailable)
}

/**
 * Throws when git may not run now. Synchronous, and called with no await
 * between it and the process start.
 */
export type GitGate = () => void

/** The gates one checkout hands its port. */
export interface CheckoutGates {
  /**
   * Before every git: still trusted, not cancelled, and (once reserved)
   * the record still exactly this checkout's reservation.
   */
  readonly run: GitGate
  /** Before every file a held checkout writes: still trusted, not cancelled. */
  readonly write: GitGate
  /**
   * Before the git that removes what this checkout made: still trusted
   * (Cancel and a lost reservation are why it runs). Refused, the folder
   * is removed without git and its registration is left to git's prune.
   */
  readonly cleanup: GitGate
}

/**
 * One folder this checkout made, told apart from any made later at the
 * same path by its native id and its birth time (Linux reuses a freed
 * inode number at once).
 */
export interface MadeFolder {
  readonly folder: string
  readonly identity: FileIdentity
  readonly bornNs: bigint
  /** Git added the worktree into it: what is inside is git's and this checkout's. */
  hasAdded: boolean
}

export interface PullRequestCheckoutGit {
  /** The pull request's head, fetched with the user's environment (credentials apply). */
  fetch(cwd: string, remote: string, ref: string, gate: GitGate): Promise<void>
  /** What the fetch brought: `FETCH_HEAD` peeled to its commit. */
  readFetchHead(cwd: string, gate: GitGate): Promise<string>
  /**
   * Makes `folder` for this checkout alone: empty, under a private name
   * beside it, then renamed into place, which fails while anything is at
   * the name (`HeldFolderTakenError`).
   */
  claimFolder(folder: string): Promise<MadeFolder>
  /**
   * The user's own pull request, detached, hooks switched off for the new
   * worktree, added into the folder `claim` makes. A failure part way
   * removes what this checkout made.
   */
  addOwnWorktree(
    cwd: string,
    folder: string,
    sha: string,
    gates: CheckoutGates,
    claim: () => Promise<MadeFolder>,
  ): Promise<void>
  /**
   * Someone else's pull request (RV71c): listed and refused whole on any
   * bad name before anything is made, then added with nothing checked out
   * into the folder `claim` makes, indexed from the commit, its files
   * written from one `cat-file --batch`. A failure part way removes what
   * this checkout made (or hands that to `CleanupPendingError.settled`).
   */
  checkOutHeld(
    folder: string,
    sha: string,
    cwd: string,
    gates: CheckoutGates,
    claim: () => Promise<MadeFolder>,
  ): Promise<void>
  /**
   * Removes what this checkout made, and nothing else (again is harmless).
   * True once nothing it made is at the folder. Never throws.
   */
  removeMade(cwd: string, made: MadeFolder, gate: GitGate): Promise<boolean>
  /**
   * The identity (`dev:ino:birth`) a finished checkout records: the folder
   * at `made`'s place, while it is the very folder made; undefined otherwise.
   */
  identityOf(made: MadeFolder): Promise<string | undefined>
}

/** How git runs to completion: options for one process. */
export interface GitRunOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
  readonly timeout: number
  readonly maxBuffer: number
}

/** How the batch child starts. */
export interface GitStartOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
  readonly timeout: number
  /** Its own process group on POSIX. */
  readonly detached: boolean
}

/**
 * How git processes start: node's, or a test's that records each start.
 * Both start the process before they return.
 */
export interface GitProcessPort {
  /** Runs to completion; resolves with the standard output. */
  run(file: string, args: readonly string[], options: GitRunOptions): Promise<string>
  /** Starts with piped standard streams. */
  start(
    file: string,
    args: readonly string[],
    options: GitStartOptions,
  ): ChildProcessWithoutNullStreams
}

/** Node's processes: explicit argument arrays, no shell, hidden windows. */
export const nodeGitProcesses: GitProcessPort = {
  run: (file, args, options) =>
    new Promise<string>((resolve, reject) => {
      execFile(file, [...args], { ...options, windowsHide: true }, (error, stdout) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        reject(error instanceof Error ? error : new PullRequestServiceError(failureText(error)))
      })
    }),
  start: (file, args, options) => spawn(file, [...args], { ...options, windowsHide: true }),
}

export interface NodePullRequestCheckoutGitOptions {
  readonly gitPath: string
  /** The user's environment, as a terminal would have it (helpers, agent, tokens). */
  readonly userEnv: NodeJS.ProcessEnv
  /** No credentials, no prompt, no optional locks. */
  readonly quietEnv: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  /** Cancel or shutdown stops every git it runs, however quiet it is. */
  readonly signal: AbortSignal
  readonly log: CoreLogger
  /** The held batch's own deadline: `GIT_WORKTREE_TIMEOUT_MS` unless a test shortens it. */
  readonly batchDeadlineMs?: number
  /** Creates one held file (`createFileExclusively`); a test stands a slow disk here. */
  readonly createFile?: typeof createFileExclusively
  /** How git starts (`nodeGitProcesses`); a test records each start here. */
  readonly processes?: GitProcessPort
}

/**
 * The runtime's process environment for the confirmed pull request fetch:
 * the user's credential helpers, SSH agent and token variables stay, as in
 * a terminal, with no prompt; nothing of ours is added (no `http.extra
 * Header`, no credential helper, no token variable). The runtime strips
 * its own credential variables at start, so `env` already holds none.
 */
export function pullRequestFetchEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_TERMINAL_PROMPT: '0' }
}

/**
 * Every other Git call's environment: no credentials, no prompt, no
 * optional locks. The same rule as `quietGitEnvironment` (src/host/git.ts),
 * which lane G owns; converge on its move to core at integration.
 */
export function quietPullRequestEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...withoutCredentials(env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
}

interface NodeGitRunner {
  readonly gitPath: string
  readonly quietEnv: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly signal: AbortSignal
  readonly log: CoreLogger
  readonly batchDeadlineMs: number
  readonly createFile: typeof createFileExclusively
  readonly processes: GitProcessPort
  versionChecked: boolean
}

interface RunHow {
  /** The quiet environment unless named. */
  readonly env?: NodeJS.ProcessEnv
  /** The owner's signal unless named (a cleanup bounds itself). */
  readonly signal?: AbortSignal
}

/**
 * Runs git to completion once `gate` allows it: the gate, then the start,
 * in one synchronous turn. With `startGitBatch`, the only way this module
 * starts git.
 */
function runGit(
  git: NodeGitRunner,
  gate: GitGate,
  args: readonly string[],
  cwd: string,
  how: RunHow = {},
): Promise<string> {
  gate()
  return git.processes.run(git.gitPath, args, {
    cwd,
    env: how.env ?? git.quietEnv,
    signal: how.signal ?? git.signal,
    timeout: GIT_WORKTREE_TIMEOUT_MS,
    maxBuffer: GIT_OUTPUT_MAX_BYTES,
  })
}

/** Starts the batch child once `gate` allows it, in the same synchronous turn. */
function startGitBatch(
  git: NodeGitRunner,
  gate: GitGate,
  args: readonly string[],
  cwd: string,
): ChildProcessWithoutNullStreams {
  gate()
  return git.processes.start(git.gitPath, args, {
    cwd,
    env: git.quietEnv,
    signal: git.signal,
    timeout: GIT_WORKTREE_TIMEOUT_MS,
    // Its own group on POSIX, so the deadline stops the helpers it
    // spawned with it, not just the root.
    detached: git.platform !== 'win32',
  })
}

/**
 * A held checkout's file writers (M123): one operation-local invalidation
 * every publisher observes before each step that touches the disk, and a
 * drain. A failure invalidates first, so no writer starts another step,
 * then waits for the one in flight before anything is cleaned up.
 */
export class HeldWriters {
  private inFlight = 0
  private failure: Error | undefined
  private readonly idle: (() => void)[] = []

  /** Throws once the checkout failed: no publisher takes another step. */
  public check(): void {
    if (this.failure !== undefined) {
      throw this.failure
    }
  }

  public async run(work: () => Promise<void>): Promise<void> {
    this.check()
    this.inFlight += 1
    try {
      await work()
    } finally {
      this.inFlight -= 1
      if (this.inFlight === 0) {
        for (const done of this.idle.splice(0)) {
          done()
        }
      }
    }
  }

  public invalidate(error: Error): void {
    this.failure ??= error
  }

  /** Settles once no writer is in flight; never rejects. */
  public drained(): Promise<void> {
    return this.inFlight === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          this.idle.push(resolve)
        })
  }
}

/**
 * A held checkout failed while a file writer was still in flight past the
 * drain grace. `settled` runs the cleanup once the writer stops and never
 * rejects; until then the record stays pending, so the folder stays held
 * and is never offered or trusted.
 */
export class CleanupPendingError extends Error {
  public constructor(
    public readonly failure: Error,
    public readonly settled: Promise<void>,
  ) {
    super(failure.message, { cause: failure })
    this.name = 'CleanupPendingError'
  }
}

/** Whether `work` settles, either way, within `ms`. */
function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false)
    }, ms)
    const done = () => {
      clearTimeout(timer)
      resolve(true)
    }
    void work.then(done).catch(done)
  })
}

/**
 * Stops the batch child and, on POSIX where it leads a process group of
 * its own, the helpers it spawned with it. Windows has no groups: there
 * the root is terminated and the pipes are destroyed, and the operation
 * settles either way (lane G's runner owns whole-tree retirement).
 */
function killBatchTree(child: ChildProcess, platform: NodeJS.Platform): void {
  const pid = child.pid
  if (pid !== undefined && platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // The group is gone already: nothing left to bound.
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // The root is gone already.
  }
}

/** The per-command overrides that switch off every named hook where git runs. */
async function hookOverrides(
  git: NodeGitRunner,
  cwd: string,
  gate: GitGate,
): Promise<readonly string[]> {
  if (!git.versionChecked) {
    // The gate's own refusal stands as it is; git's failure refuses the checkout.
    gate()
    let output: string
    try {
      output = await runGit(git, gate, ['--version'], cwd)
    } catch {
      throw checkoutRefusal()
    }
    if (!hasGitProgramControls(output, UNTRUSTED_CHECKOUT_MIN_GIT_MINOR)) {
      throw checkoutRefusal()
    }
    git.versionChecked = true
  }
  gate()
  let configuration: string
  try {
    configuration = await runGit(
      git,
      gate,
      [...untrustedCheckoutArgs(git.platform), 'config', '--null', '--name-only', '--list'],
      cwd,
    )
  } catch {
    throw checkoutRefusal()
  }
  const overrides = namedHookOverrides(configuration, untrustedCheckoutArgs(git.platform))
  if (overrides === undefined) {
    throw checkoutRefusal()
  }
  return overrides
}

/** Where a path of the commit lands (`heldDestination`), or the refusal. */
async function heldDestinationOf(platform: NodeJS.Platform, folder: string, entryPath: string) {
  const resolution = await heldDestination(platform, folder, entryPath, {
    realPath: canonicalPath,
  })
  if (resolution === undefined) {
    throw new PullRequestServiceError(unsafePathReason(entryPath))
  }
  return resolution
}

function tooLarge(): Error {
  return new PullRequestServiceError(
    fill(UI_TEXT.openPullRequestTooLarge, {
      files: HELD_CHECKOUT_MAX_ENTRIES,
      size: formatBytes(HELD_CHECKOUT_MAX_BYTES),
    }),
  )
}

function unreadable(): Error {
  return new PullRequestServiceError(UI_TEXT.openPullRequestUnreadable)
}

async function writeHeldBlobs(
  git: NodeGitRunner,
  folder: string,
  cwd: string,
  blobs: readonly HeldEntry[],
  gates: CheckoutGates,
): Promise<void> {
  const writers = new HeldWriters()
  // Every step that touches the disk asks both: the owner (Cancel, trust)
  // and this checkout's own failure (its deadline among them).
  const mayWrite = () => {
    writers.check()
    gates.write()
  }
  const answers = new BlobAnswers(
    blobs,
    (entry, bytes) =>
      writers.run(async () => {
        const destination = await heldDestinationOf(git.platform, folder, entry.path)
        mayWrite()
        await git.createFile(destination.absolute, bytes, {
          mode: entry.kind === 'executable' ? HELD_EXECUTABLE_MODE : HELD_FILE_MODE,
          expectedDirectory: path.dirname(destination.checkedAbsolute),
          assertCanWrite: mayWrite,
          platform: git.platform,
          warn: (_stage, _isPublished, error) => {
            git.log.warn(
              `A held checkout left a stage file it could not remove: ${error instanceof Error ? error.message : String(error)}`,
            )
          },
        })
      }),
    unreadable,
  )
  const child = startGitBatch(
    git,
    gates.run,
    [...untrustedCheckoutArgs(git.platform), 'cat-file', '--batch'],
    cwd,
  )
  // Nothing reads the error stream: discard it, so a chatty git can
  // never fill the pipe and stall the batch past its deadline.
  child.stderr.resume()
  // A child that dies before reading its input breaks the pipe: its exit
  // decides the checkout, never an unhandled stream error.
  child.stdin.on('error', () => {
    // The batch's close (a non-zero exit) refuses it.
  })
  child.stdin.write(blobs.map((entry) => `${entry.oid}\n`).join(''))
  child.stdin.end()
  await runBatchChild(child, answers, {
    deadlineMs: git.batchDeadlineMs,
    killGraceMs: GIT_BATCH_KILL_GRACE_MS,
    drainGraceMs: HELD_WRITER_DRAIN_GRACE_MS,
    platform: git.platform,
    signal: git.signal,
    writers,
  })
}

export interface BatchChildOptions {
  /** The batch's own deadline: a root that ignores its signal still ends the checkout. */
  readonly deadlineMs: number
  /** How long a killed batch is observed before the checkout settles anyway. */
  readonly killGraceMs: number
  /** How long a failure waits for a file writer in flight before handing it the cleanup. */
  readonly drainGraceMs: number
  readonly platform: NodeJS.Platform
  /** Cancel or shutdown settles the batch however quiet its child is. */
  readonly signal: AbortSignal
  /** The publishers: a failure invalidates them before anything else. */
  readonly writers: HeldWriters
}

/**
 * Every answer the batch child completes, then its exit — or its death:
 * a failure (the deadline, Cancel, a bad answer) first invalidates the
 * file writers, so none takes another step; then kills the tree, destroys
 * our pipe ends so the reader cannot hang on a helper holding them, and
 * observes the exit and the writer in flight for bounded graces. Drained,
 * it rejects with the failure; a writer still in flight past its grace
 * rejects as `CleanupPendingError`, whose cleanup waits for it. Nothing
 * keeps the checkout pending past both its deadline and Cancel, and no
 * writer outlives the cleanup. Exported so the tests can stand a
 * scripted root with a helper where git would be.
 */
export function runBatchChild(
  child: ChildProcess,
  answers: BlobAnswers,
  options: BatchChildOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const { signal, writers } = options
    let hasSettled = false
    // Attached before the stream is read: the close may already have fired
    // once the last answer is consumed.
    const closed = new Promise<number | null>((done) => {
      child.once('close', done)
    })
    const settleResolve = () => {
      if (hasSettled) {
        return
      }
      hasSettled = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const fail = (error: Error) => {
      if (hasSettled) {
        return
      }
      hasSettled = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', onAbort)
      // First: from here on no publisher starts another step.
      writers.invalidate(error)
      killBatchTree(child, options.platform)
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.stdin?.destroy()
      const hasExited = child.exitCode !== null || child.signalCode !== null
      void (async () => {
        const [, isDrained] = await Promise.all([
          hasExited ? Promise.resolve(true) : settlesWithin(closed, options.killGraceMs),
          settlesWithin(writers.drained(), options.drainGraceMs),
        ])
        reject(isDrained ? error : new CleanupPendingError(error, writers.drained()))
      })()
    }
    const onAbort = () => {
      const reason: unknown = signal.reason
      fail(reason instanceof Error ? reason : new Error('The operation was aborted'))
    }
    // The batch's own deadline, independent of the spawn timeout: a root
    // that ignores its signal still ends the checkout.
    const deadline = setTimeout(() => {
      fail(unreadable())
    }, options.deadlineMs)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    child.on('error', fail)
    void (async () => {
      try {
        await takeChunks(answers, child.stdout)
      } catch (error: unknown) {
        fail(error instanceof Error ? error : unreadable())
        return
      }
      const code = await closed
      if (code !== 0) {
        fail(unreadable())
        return
      }
      try {
        answers.finish()
      } catch (error: unknown) {
        fail(error instanceof Error ? error : unreadable())
        return
      }
      settleResolve()
    })()
  })
}

/** Every answer the stream completes, written before git goes on. */
async function takeChunks(
  answers: BlobAnswers,
  stdout: NodeJS.ReadableStream | null,
): Promise<void> {
  if (stdout === null) {
    throw unreadable()
  }
  for await (const chunk of stdout) {
    if (!Buffer.isBuffer(chunk)) {
      throw unreadable()
    }
    await answers.take(chunk)
  }
}

/**
 * Adds the worktree into `made` once `gate` allows it. Only once git
 * succeeded is what is inside git's and this checkout's: a refused or
 * failed add leaves the folder to be removed only while empty.
 */
async function addWorktree(
  git: NodeGitRunner,
  gate: GitGate,
  args: readonly string[],
  cwd: string,
  made: MadeFolder,
): Promise<void> {
  await runGit(git, gate, args, cwd)
  made.hasAdded = true
}

/**
 * The runtime's git for pull request checkouts over its own processes:
 * explicit argument arrays, output caps and deadlines, no shell.
 */
export function createNodePullRequestCheckoutGit(
  options: NodePullRequestCheckoutGitOptions,
): PullRequestCheckoutGit {
  const git: NodeGitRunner = {
    gitPath: options.gitPath,
    quietEnv: options.quietEnv,
    platform: options.platform,
    signal: options.signal,
    log: options.log,
    batchDeadlineMs: options.batchDeadlineMs ?? GIT_WORKTREE_TIMEOUT_MS,
    createFile: options.createFile ?? createFileExclusively,
    processes: options.processes ?? nodeGitProcesses,
    versionChecked: false,
  }
  const cleanUp = async (cwd: string, made: MadeFolder, gate: GitGate, error: unknown) => {
    // Cleanup runs after Cancel too: Cancel must never leave the pull
    // request's files behind. Only once no writer is in flight, and only
    // ever the folder this checkout made.
    if (error instanceof CleanupPendingError) {
      throw new CleanupPendingError(
        error.failure,
        removeMadeAfter(error.settled, git, cwd, made, gate),
      )
    }
    await removeMadeFolder(git, cwd, made, gate)
    throw error
  }
  return {
    fetch: async (cwd, remote, ref, gate) => {
      await runGit(git, gate, ['fetch', remote, ref], cwd, { env: options.userEnv })
    },
    readFetchHead: async (cwd, gate) => {
      const head = await runGit(
        git,
        gate,
        ['rev-parse', '--verify', `${FETCH_HEAD}${COMMIT_PEEL}`],
        cwd,
      )
      return head
    },
    claimFolder: (folder) => claimCheckoutFolder(folder),
    addOwnWorktree: async (cwd, folder, sha, gates, claim) => {
      const made = await claim()
      try {
        // A relative core.hooksPath can resolve to executable code from
        // this PR in the new worktree; the trust card has not approved that code.
        await addWorktree(
          git,
          gates.run,
          [
            '-c',
            `core.hooksPath=${nullDeviceFor(options.platform)}`,
            ...worktreeAddDetachedArgs(folder, sha),
          ],
          cwd,
          made,
        )
      } catch (error: unknown) {
        await cleanUp(cwd, made, gates.cleanup, error)
      }
    },
    checkOutHeld: async (folder, sha, cwd, gates, claim) => {
      if (!isCommitSha(sha)) {
        throw new PullRequestServiceError(UI_TEXT.openPullRequestFetchFailed)
      }
      let listing: string
      try {
        const overrides = await hookOverrides(git, cwd, gates.run)
        listing = await runGit(
          git,
          gates.run,
          [...overrides, 'ls-tree', '-r', '-z', '--full-tree', '--long', sha],
          cwd,
        )
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        ) {
          throw tooLarge()
        }
        throw error
      }
      const tree = heldTree(listing, options.platform)
      if (!tree.ok) {
        throw new PullRequestServiceError(tree.reason)
      }
      const overrides = await hookOverrides(git, cwd, gates.run)
      // The folder, made by this checkout alone under the hold that claims
      // its record: its identity is the proof every cleanup checks.
      const made = await claim()
      try {
        await addWorktree(
          git,
          gates.run,
          [...overrides, ...worktreeAddHeldArgs(folder, sha)],
          cwd,
          made,
        )
        // In the worktree, so named hooks its own configuration defines are found and switched off.
        const worktreeOverrides = await hookOverrides(git, folder, gates.run)
        await runGit(git, gates.run, [...worktreeOverrides, 'read-tree', sha], folder)
        for (const entry of tree.entries) {
          if (entry.kind !== 'submodule') {
            continue
          }
          // A submodule: an empty folder, made where its path says and nowhere else.
          const destination = await heldDestinationOf(options.platform, folder, entry.path)
          gates.write()
          await mkdir(destination.absolute, { recursive: true })
          if (
            !isSamePath(
              await canonicalPath(destination.absolute),
              destination.checkedAbsolute,
              options.platform,
            )
          ) {
            throw new PullRequestServiceError(unsafePathReason(entry.path))
          }
        }
        const blobs = tree.entries.filter((entry) => entry.kind !== 'submodule')
        if (blobs.length > 0) {
          await writeHeldBlobs(git, folder, cwd, blobs, gates)
        }
      } catch (error: unknown) {
        await cleanUp(cwd, made, gates.cleanup, error)
      }
    },
    removeMade: (cwd, made, gate) => removeMadeFolder(git, cwd, made, gate),
    identityOf: async (made) =>
      (await isMadeFolder(made.folder, made)) ? await folderIdentityOf(made.folder) : undefined,
  }
}

/** Another checkout took this one's reservation over: it keeps nothing it made. */
export class ReservationLostError extends PullRequestServiceError {
  public constructor(folder: string) {
    super(`${UI_TEXT.gitOperationChanged} ${folder}`)
    this.name = 'ReservationLostError'
  }
}

/** The folder was there already, or appeared: this checkout made nothing. */
export class HeldFolderTakenError extends PullRequestServiceError {
  public constructor(folder: string) {
    super(`${UI_TEXT.worktreeFolderExists} ${folder}`)
    this.name = 'HeldFolderTakenError'
  }
}

async function isPresent(target: string): Promise<boolean> {
  try {
    await lstatIdentity(target)
    return true
  } catch {
    return false
  }
}

function madeFolderOf(folder: string, stats: BigIntStats): MadeFolder {
  return { folder, identity: identityOf(stats), bornNs: stats.birthtimeNs, hasAdded: false }
}

/**
 * Makes the checkout's folder for this checkout alone: an empty folder
 * under a private random name beside it (so its identity can only be this
 * checkout's), renamed into place, which fails while anything is at the
 * name. Git adds the worktree into that empty folder, keeping its identity.
 */
async function claimCheckoutFolder(folder: string): Promise<MadeFolder> {
  const parent = path.dirname(folder)
  await mkdir(parent, { recursive: true })
  const staging = path.join(
    parent,
    `.${path.basename(folder)}.${randomUUID()}${FOLDER_STAGING_SUFFIX}`,
  )
  await mkdir(staging)
  let made: MadeFolder
  try {
    made = madeFolderOf(folder, await lstatIdentity(staging))
    if (await isPresent(folder)) {
      throw new HeldFolderTakenError(folder)
    }
    await rename(staging, folder)
  } catch (error: unknown) {
    try {
      // Still ours under its private name: empty, so never more than it.
      await rmdir(staging)
    } catch {
      // Renamed into place already, or gone.
    }
    if (error instanceof HeldFolderTakenError || (await isPresent(folder))) {
      throw new HeldFolderTakenError(folder)
    }
    throw error
  }
  return made
}

/** The folder at `target` is the very one this checkout made (not a link to it). */
async function isMadeFolder(target: string, made: MadeFolder): Promise<boolean> {
  try {
    const seen = await lstatIdentity(target)
    return seen.isDirectory() && sameFile(seen, made.identity) && seen.birthtimeNs === made.bornNs
  } catch {
    return false
  }
}

/**
 * What this checkout made, and only that: anything else at the name (a
 * folder another process put there, a replacement made while this one
 * ran) is left alone. Once git added its worktree, that is removed through
 * git while `gate` allows (no hooks, no filters, quiet; git refuses a
 * folder that is not this repository's worktree; bounded by its own
 * timeout, not the owner's signal, so Cancel still cleans up); refused,
 * the registration is left to git's prune. Whatever is left is moved aside
 * under a private name, checked to be that very folder, then removed:
 * whole once git added it, else only while empty (anything in it then is
 * not this checkout's). Runs once per made folder; asked again, it answers
 * the same. True once nothing this checkout made is left. Never throws.
 */
function removeMadeFolder(
  git: NodeGitRunner,
  cwd: string,
  made: MadeFolder,
  gate: GitGate,
): Promise<boolean> {
  let removal = REMOVALS.get(made)
  if (removal === undefined) {
    removal = isMadeGoneOnceRemoved(git, cwd, made, gate)
    REMOVALS.set(made, removal)
  }
  return removal
}

const REMOVALS = new WeakMap<MadeFolder, Promise<boolean>>()

async function isMadeGoneOnceRemoved(
  git: NodeGitRunner,
  cwd: string,
  made: MadeFolder,
  gate: GitGate,
): Promise<boolean> {
  const { folder } = made
  if (!(await isMadeFolder(folder, made))) {
    if (await isPresent(folder)) {
      git.log.warn(`A checkout left a folder it did not make alone: ${folder}`)
    }
    return true
  }
  if (made.hasAdded) {
    try {
      // --force: without it git first runs `git status` in the worktree,
      // through the filters this checkout never ran.
      await runGit(
        git,
        gate,
        [...untrustedCheckoutArgs(git.platform), ...worktreeRemoveArgs(folder, true)],
        cwd,
        { signal: AbortSignal.timeout(HELD_CLEANUP_TIMEOUT_MS) },
      )
    } catch (error: unknown) {
      git.log.warn(`A checkout's worktree was not removed by git: ${failureText(error)}`)
    }
  }
  if (!(await isPresent(folder))) {
    return true
  }
  const aside = path.join(
    path.dirname(folder),
    `.${path.basename(folder)}.${randomUUID()}${FOLDER_REMOVING_SUFFIX}`,
  )
  try {
    await rename(folder, aside)
  } catch (error: unknown) {
    git.log.warn(`A checkout's folder was left after it failed: ${failureText(error)}`)
    return false
  }
  if (!(await isMadeFolder(aside, made))) {
    // Another folder took its place: not this checkout's to remove; back
    // under its name while that is free. Nothing this checkout made is there.
    await putBack(aside, folder)
    git.log.warn(`A checkout's folder was replaced while it ran: ${folder}`)
    return true
  }
  try {
    await (made.hasAdded
      ? rm(aside, { recursive: true, force: true, maxRetries: HELD_CLEANUP_REMOVE_RETRIES })
      : rmdir(aside))
    return true
  } catch (error: unknown) {
    // Something in it is not this checkout's (or is held open): kept, back
    // under its name while that is free, else under its private name.
    await putBack(aside, folder)
    git.log.warn(`A checkout's folder was left after it failed: ${failureText(error)}`)
    return false
  }
}

/** A folder moved aside goes back under its name while that is free. Never throws. */
async function putBack(aside: string, folder: string): Promise<void> {
  if (await isPresent(folder)) {
    return
  }
  try {
    await rename(aside, folder)
  } catch {
    // Left under its private name, held like the rest of the held root.
  }
}

/** The same, once the writer still in flight has stopped (`drained` never rejects). */
async function removeMadeAfter(
  drained: Promise<void>,
  git: NodeGitRunner,
  cwd: string,
  made: MadeFolder,
  gate: GitGate,
): Promise<void> {
  await drained
  await removeMadeFolder(git, cwd, made, gate)
}

/**
 * The folder's identity (`dev:ino:birth`, links resolved): the birth time
 * tells a folder made again at the same path apart even where the system
 * reuses its inode number (Linux). Undefined when it is not a folder.
 */
async function folderIdentityOf(folder: string): Promise<string | undefined> {
  try {
    const seen = await statIdentity(folder)
    const key = seen.isDirectory() ? fileIdentityKey(seen) : undefined
    return key === undefined ? undefined : `${key}:${seen.birthtimeNs.toString()}`
  } catch {
    return undefined
  }
}

export interface RuntimeCheckoutDeps extends RuntimePullRequestDeps {
  readonly records: WorktreeRecordStore
  /** Roots whose `pr-worktrees/` hold foreign pull requests: VS Code's storage and the data folder. */
  readonly heldRoots: readonly string[]
  readonly git: PullRequestCheckoutGit
  readonly pathExists: (fsPath: string) => boolean
}

export type OpenPullRequestResult =
  | { readonly ok: true; readonly folder: string; readonly held: boolean; readonly number: number }
  | { readonly ok: false; readonly reason: string; readonly needsSignIn?: true }

/** What a completion came to: in effect, refused, or not known (the store failing). */
type Completion = 'completed' | 'refused' | 'unknown'

// GitHub keeps every pull request's head at this ref of the base repository.
function pullHeadRef(number: number): string {
  return `pull/${String(number)}/head`
}

function failureText(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

/** What the checkout protocol needs of the service (`RuntimeCheckoutDeps` gives it). */
export type CheckoutProtocolDeps = Pick<
  RuntimeCheckoutDeps,
  | 'records'
  | 'git'
  | 'pathExists'
  | 'isTrusted'
  | 'signal'
  | 'log'
  | 'now'
  | 'confirm'
  | 'openFolder'
  | 'repositoryRoot'
>

/**
 * The checkout protocol (PLAN.md M123): reserve, claim, git through the
 * gate, complete; or offer, refuse, supersede. Separate from the service
 * so a test can stand every interleaving of several windows running it.
 */
export class PullRequestCheckoutProtocol {
  public constructor(private readonly deps: CheckoutProtocolDeps) {}

  private checkTrust(): void {
    if (!this.deps.isTrusted()) {
      throw new PullRequestServiceError(UI_TEXT.gitRestricted)
    }
    this.deps.signal.throwIfAborted()
  }

  /** The result to return when trust went or Cancel was pressed; undefined otherwise. */
  private refusalIfUntrusted(): OpenPullRequestResult | undefined {
    try {
      this.checkTrust()
      return undefined
    } catch (error: unknown) {
      return { ok: false, reason: failureText(error) }
    }
  }

  /**
   * Whether a new checkout may replace `current`: its folder is gone, and
   * it finished; or it is pending and its process is provably gone (no
   * such process, or its id now names a process that started at another
   * time); or it has been pending longer than any step before the folder
   * takes (a crash whose id was reused by a process whose start time
   * cannot be read). The supersede itself checks the folder absent again
   * under its hold, and names exactly the version read.
   */
  private async mayTakeOver(folder: string, current: WorktreeRecord): Promise<boolean> {
    return (
      !this.deps.pathExists(folder) &&
      (current.isCheckoutPending !== true ||
        this.deps.now() - current.createdAt > PENDING_CHECKOUT_RECOVERY_MS ||
        (current.pendingOwner !== undefined && (await isProcessOwnerGone(current.pendingOwner))))
    )
  }

  /**
   * Claims, runs git and completes for one reservation. Every git goes
   * through the gate (trust, Cancel, the reservation's fence); a
   * completion refused (another checkout's record names the folder now, or
   * none does) removes exactly what this checkout made.
   */
  private async checkOutReserved(
    folder: string,
    number: number,
    isOwn: boolean,
    headSha: string,
    reserved: Reservation,
  ): Promise<OpenPullRequestResult> {
    const cwd = this.deps.repositoryRoot
    const changed: OpenPullRequestResult = { ok: false, reason: UI_TEXT.gitOperationChanged }
    // The reservation the gate checks: the claimed one once claimed.
    let held = reserved
    // A claim whose landing is not known: the record is one of these.
    let unknownClaims: readonly Reservation[] = []
    const owned = (): readonly Reservation[] => [...unknownClaims, held]
    let made: MadeFolder | undefined
    const gates: CheckoutGates = {
      run: () => {
        this.checkTrust()
        if (!this.deps.records.holdsSync(held)) {
          throw new ReservationLostError(folder)
        }
      },
      write: () => {
        this.checkTrust()
      },
      cleanup: () => {
        if (!this.deps.isTrusted()) {
          throw new PullRequestServiceError(UI_TEXT.gitRestricted)
        }
      },
    }
    const claim = async (): Promise<MadeFolder> => {
      this.checkTrust()
      const claimed = await this.deps.records.claim(held, () => this.deps.git.claimFolder(folder))
      if (claimed.status === 'refused') {
        throw new ReservationLostError(folder)
      }
      if (claimed.status === 'unknown') {
        unknownClaims = claimed.reservations
        throw claimed.error
      }
      held = claimed.reservation
      if (claimed.status === 'failed') {
        throw claimed.error
      }
      made = claimed.made
      return claimed.made
    }
    try {
      this.checkTrust()
      await (isOwn
        ? this.deps.git.addOwnWorktree(cwd, folder, headSha, gates, claim)
        : this.deps.git.checkOutHeld(folder, headSha, cwd, gates, claim))
    } catch (error: unknown) {
      if (error instanceof ReservationLostError) {
        // Another checkout took this reservation over: that one owns the
        // record, and nothing this one made stays (the port removed it).
        this.deps.log.warn(`A checkout lost its reservation to another: ${folder}`)
      }
      await this.settleFailure(made, owned(), error, gates.cleanup)
      if (error instanceof ReservationLostError) {
        return changed
      }
      return {
        ok: false,
        reason:
          error instanceof HeldFolderTakenError
            ? `${UI_TEXT.worktreeFolderExists} ${folder}`
            : `${UI_TEXT.worktreeAddFailed}: ${failureText(error)}`,
      }
    }
    // The folder made, still that very folder: its identity is what trust binds to.
    const identity = made === undefined ? undefined : await this.deps.git.identityOf(made)
    if (identity === undefined) {
      this.deps.log.warn(`A checkout's folder is no longer the one it made: ${folder}`)
      await this.discardWithMade(made, owned(), gates.cleanup)
      return { ok: false, reason: `${UI_TEXT.worktreeAddFailed}: ${folder}` }
    }
    if ((await this.settleComplete(held, identity)) !== 'completed') {
      // Refused or not known: what this checkout made goes, and with it
      // its record while that is still its own.
      this.deps.log.warn(`A finished checkout's record was no longer its own: ${folder}`)
      await this.discardWithMade(made, owned(), gates.cleanup)
      return changed
    }
    // Finished and recorded (held, offered again later); opened only while trusted.
    const refusal = this.refusalIfUntrusted()
    if (refusal !== undefined) {
      return refusal
    }
    this.deps.log.info(
      `Pull request #${String(number)} checked out in a worktree${isOwn ? '' : ', held'}`,
    )
    await this.deps.openFolder(folder)
    return { ok: true, folder, held: !isOwn, number }
  }

  /** A failed checkout's record, settled as its failure allows. Never throws. */
  private async settleFailure(
    made: MadeFolder | undefined,
    reservations: readonly Reservation[],
    error: unknown,
    gate: GitGate,
  ): Promise<void> {
    if (error instanceof CleanupPendingError) {
      // A writer is still in flight: the record stays pending (held, never
      // offered or trusted) until its cleanup has run.
      this.deps.log.warn('A failed checkout is still writing; it stays held')
      void this.discardAfter(error.settled, made, reservations, gate)
      return
    }
    await this.discardWithMade(made, reservations, gate)
  }

  /**
   * A failed checkout's record goes once nothing it made is left: one that
   * never made its folder (refused, or the folder was someone else's) goes
   * at once; one whose folder could not be removed stays pending, so the
   * folder stays held, is never offered again and can never be trusted.
   * Only ever this checkout's own reservation, by the latest fence it may
   * hold (`reservations`: a claim whose landing is not known first, then
   * the one known), each a compare-and-swap, never a record that moved on.
   * Never throws.
   */
  private async discardWithMade(
    made: MadeFolder | undefined,
    reservations: readonly Reservation[],
    gate: GitGate,
  ): Promise<void> {
    const isGone =
      made === undefined || (await this.deps.git.removeMade(this.deps.repositoryRoot, made, gate))
    if (!isGone) {
      this.deps.log.warn('A failed checkout left its folder; it stays held')
      return
    }
    await this.discardOwn(reservations)
  }

  /** The first of `reservations` the record still is, discarded. Never throws. */
  private async discardOwn(reservations: readonly Reservation[]): Promise<void> {
    for (const reservation of reservations) {
      try {
        if (await this.deps.records.discard(reservation)) {
          return
        }
      } catch {
        this.deps.log.warn(
          `A failed checkout's record could not be discarded: ${reservation.folder}`,
        )
      }
    }
  }

  /** The same, once a failed checkout's late cleanup has run. Never throws. */
  private async discardAfter(
    settled: Promise<void>,
    made: MadeFolder | undefined,
    reservations: readonly Reservation[],
    gate: GitGate,
  ): Promise<void> {
    try {
      await settled
    } catch {
      // The cleanup never rejects; what is left decides either way.
    }
    await this.discardWithMade(made, reservations, gate)
  }

  /**
   * pending → ready for exactly the reservation claimed. A completion the
   * store could not confirm re-reads: the reserved checkout ready means it
   * landed; the record no longer this reservation's means refused.
   */
  private async settleComplete(reservation: Reservation, identity: string): Promise<Completion> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (await this.deps.records.complete(reservation, identity)) {
          return 'completed'
        }
      } catch {
        // The store is busy: the re-read below decides.
      }
      let current: WorktreeRecord | undefined
      try {
        current = await this.deps.records.recordFor(reservation.folder)
      } catch {
        if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
          return 'unknown'
        }
        continue
      }
      if (current?.checkoutId === reservation.checkoutId && current.isCheckoutPending !== true) {
        return 'completed'
      }
      if (!isReservationOf(current, reservation)) {
        return 'refused'
      }
      if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
        return 'unknown'
      }
    }
  }

  /** A finished checkout, offered again as it is, never taken over. */
  public async offerExistingCheckout(
    folder: string,
    number: number,
    existing: WorktreeRecord,
  ): Promise<OpenPullRequestResult> {
    const shouldReopen = await this.deps.confirm(
      fill(UI_TEXT.openPullRequestExisting, { number }),
      folder,
      UI_TEXT.worktreeOpen,
    )
    const refusal = this.refusalIfUntrusted()
    if (refusal !== undefined) {
      return refusal
    }
    if (shouldReopen) {
      await this.deps.openFolder(folder)
      return { ok: true, folder, held: existing.isHeld, number }
    }
    return { ok: false, reason: UI_TEXT.gitPushDeclined }
  }

  /**
   * Validate → act → persist for one checkout: reserve the folder's
   * record, claim it (the folder made under the same hold), run git, then
   * complete exactly the reservation claimed. A reserve that finds another
   * checkout there follows what is there — a checkout in flight is refused
   * honestly, a finished one is offered again, and only a finished record
   * whose folder is gone (or a pending one whose process is gone or whose
   * reservation is stale, its folder gone) is taken over, at exactly the
   * version read and only while the folder is still absent under the
   * hold. Nothing here overwrites a record it did not read, and nothing
   * restores an older one.
   */
  public async reserveAndCheckout(
    folder: string,
    remote: GitHubRemote,
    number: number,
    pullRequest: PullRequest,
    isOwn: boolean,
  ): Promise<OpenPullRequestResult> {
    const owner = await currentProcessOwner()
    const makeRecord = (): WorktreeRecord => ({
      // Recorded before the folder exists, so no window ever sees it unrecorded.
      folder,
      repositoryRoot: this.deps.repositoryRoot,
      createdAt: this.deps.now(),
      checkoutId: randomUUID(),
      pendingOwner: owner,
      pullRequest: {
        repository: repositoryLabel(remote.repository),
        number,
        url: pullRequest.url,
        title: pullRequest.title,
        author: pullRequest.author.login,
        headSha: pullRequest.headSha,
        isAuthoredByUser: isOwn,
      },
      isHeld: !isOwn,
      isCheckoutPending: true,
    })
    const changed: OpenPullRequestResult = { ok: false, reason: UI_TEXT.gitOperationChanged }
    const isFolderAbsent = () => !this.deps.pathExists(folder)
    for (let attempt = 1; ; attempt += 1) {
      const record = makeRecord()
      let reserved: ReserveResult
      try {
        reserved = await this.deps.records.reserve(record)
        const current = reserved.ok ? undefined : reserved.current
        if (current !== undefined) {
          if (current.isCheckoutPending !== true && this.deps.pathExists(folder)) {
            return await this.offerExistingCheckout(folder, number, current)
          }
          if (!(await this.mayTakeOver(folder, current))) {
            // Another checkout owns this folder right now.
            return changed
          }
          reserved = await this.deps.records.supersede(
            folder,
            versionOf(current),
            record,
            isFolderAbsent,
          )
        }
      } catch (error: unknown) {
        if (error instanceof UnknownWriteError) {
          // The reservation may have landed: it goes, so it never blocks the
          // folder (nothing was made for it).
          // Only reserve/supersede mutate in this try; the store retains
          // their ReserveResult attempts in this error. instanceof erases
          // that generic (M123P9, PLAN.md §8).
          const results = error.results as readonly ReserveResult[]
          await this.discardOwn(
            results.flatMap((result) => (result.ok ? [result.reservation] : [])),
          )
        }
        return changed
      }
      if (reserved.ok) {
        return await this.checkOutReserved(
          folder,
          number,
          isOwn,
          pullRequest.headSha,
          reserved.reservation,
        )
      }
      // The record moved under the reserve: the next attempt reads it again.
      if (attempt >= WORKTREE_RECORD_SAVE_ATTEMPTS) {
        return changed
      }
    }
  }
}

/**
 * "Open a pull request in a conversation…": the pull request's head is
 * fetched with the user's Git environment and checked out, detached, in a
 * worktree of its own that opens through `workspace/openFolder`. Only an
 * explicit confirmation checks anything out; an existing checkout is
 * offered again as it is, never taken over.
 */
export class RuntimePullRequestCheckout {
  /** One opening per destination folder: overlapping opens queue behind it. */
  private readonly admissions = new Map<string, Promise<void>>()

  private readonly protocol: PullRequestCheckoutProtocol

  public constructor(private readonly deps: RuntimeCheckoutDeps) {
    this.protocol = new PullRequestCheckoutProtocol(deps)
  }

  private checkTrust(): void {
    if (!this.deps.isTrusted()) {
      throw new PullRequestServiceError(UI_TEXT.gitRestricted)
    }
    this.deps.signal.throwIfAborted()
  }

  private withFolderLock<T>(folder: string, work: () => Promise<T>): Promise<T> {
    const previous = this.admissions.get(folder) ?? Promise.resolve()
    const next = (async (): Promise<T> => {
      await previous
      return await work()
    })()
    const turn = (async (): Promise<void> => {
      try {
        await next
      } catch {
        // A failed opening releases the next queued one.
      }
    })()
    this.admissions.set(folder, turn)
    return (async (): Promise<T> => {
      try {
        return await next
      } finally {
        if (this.admissions.get(folder) === turn) {
          this.admissions.delete(folder)
        }
      }
    })()
  }

  private async checkOutWith(
    credential: GitHubCredential,
    remote: GitHubRemote,
    number: number,
  ): Promise<OpenPullRequestResult> {
    const client = new GitHubClient({
      fetch: credential.fetch,
      userAgent: this.deps.userAgent,
      log: this.deps.log,
      ...(this.deps.baseUrl !== undefined && { baseUrl: this.deps.baseUrl }),
    })
    let pullRequest: PullRequest
    let isOwn: boolean
    try {
      const [found, user] = await Promise.all([
        client.pullRequest(credential.bearer, remote.repository, number),
        client.currentUser(credential.bearer),
      ])
      this.checkTrust()
      pullRequest = found
      isOwn = found.author.id === user.id
    } catch (error: unknown) {
      const isSignIn = await didDropRejectedCredential(this.deps.tokenSources, credential, error)
      return {
        ok: false,
        reason: `${UI_TEXT.gitHubFailed}: ${failureText(error)}`,
        ...(isSignIn && { needsSignIn: true }),
      }
    }
    const folder = isOwn
      ? worktreeFolder(
          this.deps.repositoryRoot,
          `${OWN_FOLDER_PREFIX}${String(number)}`,
          this.deps.platform,
        )
      : heldWorktreeFolder(this.deps.dataFolder, remote.repository, number, this.deps.platform)
    // Overlapping opens of one pull request queue here: the second sees
    // the finished checkout instead of racing its record.
    return await this.withFolderLock(folder, async () => {
      if (this.deps.pathExists(folder)) {
        // Checked out before: offered again as it is. A folder this service
        // did not make, or a checkout that never finished, is never taken
        // over or opened.
        const existing = await this.deps.records.recordFor(folder)
        return existing === undefined || existing.isCheckoutPending === true
          ? { ok: false, reason: `${UI_TEXT.worktreeFolderExists} ${folder}` }
          : await this.protocol.offerExistingCheckout(folder, number, existing)
      }
      const isConfirmed = await this.deps.confirm(
        fill(UI_TEXT.openPullRequestConfirm, { number }),
        pullRequestCheckoutConfirmation(pullRequest, isOwn),
        UI_TEXT.openPullRequestAction,
      )
      this.checkTrust()
      if (!isConfirmed) {
        return { ok: false, reason: UI_TEXT.gitPushDeclined }
      }
      if (!isCommitSha(pullRequest.headSha)) {
        return {
          ok: false,
          reason: `${UI_TEXT.gitHubFailed}: ${redactSecrets(pullRequest.headSha)}`,
        }
      }
      // A remote named like an option would read as one where git receives it.
      if (!isPlainRefName(remote.name)) {
        return { ok: false, reason: UI_TEXT.gitPushUnsafeName }
      }
      const cwd = this.deps.repositoryRoot
      const gate = () => {
        this.checkTrust()
      }
      try {
        // Through the user's environment, so its credentials reach a private repository.
        await this.deps.git.fetch(cwd, remote.name, pullHeadRef(number), gate)
        // The head GitHub named must be what came: a push in between is refused, not guessed.
        const fetched = await this.deps.git.readFetchHead(cwd, gate)
        this.checkTrust()
        if (fetched.trim() !== pullRequest.headSha) {
          return { ok: false, reason: UI_TEXT.gitOperationChanged }
        }
      } catch (error: unknown) {
        this.deps.log.warn(`Fetching pull request #${String(number)} failed`)
        return { ok: false, reason: `${UI_TEXT.openPullRequestFetchFailed}: ${failureText(error)}` }
      }
      return await this.protocol.reserveAndCheckout(folder, remote, number, pullRequest, isOwn)
    })
  }

  public async open(
    typed: string,
    remotes: readonly GitHubRemote[],
    trackedRemote: string | undefined,
  ): Promise<OpenPullRequestResult> {
    try {
      this.checkTrust()
    } catch (error: unknown) {
      return { ok: false, reason: failureText(error) }
    }
    const records = await this.deps.records.list()
    if (
      holdForRoots([this.deps.repositoryRoot], this.deps.heldRoots, records, this.deps.platform) !==
      undefined
    ) {
      return { ok: false, reason: UI_TEXT.gitHeld }
    }
    const ref = pullRequestRefFrom(typed)
    if (!ref.ok) {
      return { ok: false, reason: UI_TEXT.openPullRequestInvalid }
    }
    const remote = remoteForPullRequest(remotes, ref.repository, trackedRemote)
    if (remote === undefined) {
      return {
        ok: false,
        reason:
          ref.repository === undefined
            ? UI_TEXT.openPullRequestNoRemote
            : fill(UI_TEXT.openPullRequestOtherRepository, {
                repository: repositoryLabel(ref.repository),
              }),
      }
    }
    const credential = await resolveGitHubCredential(this.deps.tokenSources, {
      mode: 'ask',
      signal: this.deps.signal,
      now: this.deps.now,
    })
    try {
      this.checkTrust()
    } catch (error: unknown) {
      return { ok: false, reason: failureText(error) }
    }
    return credential === undefined
      ? { ok: false, reason: UI_TEXT.gitHubSignInDeclined }
      : await this.checkOutWith(credential, remote, ref.number)
  }

  /**
   * What the held-worktree card shows for `folder`, and the ticket its
   * confirmation hands back: one finished, untrusted checkout whose folder
   * is still the very folder it finished in. Undefined otherwise (pending,
   * trusted already, gone, or made again at the same path).
   */
  public async trustTicket(folder: string): Promise<TrustTicket | undefined> {
    let record: WorktreeRecord | undefined
    try {
      record = await this.deps.records.recordFor(folder)
    } catch {
      return undefined
    }
    if (
      record === undefined ||
      record.isCheckoutPending === true ||
      record.trustConfirmedAt !== undefined ||
      record.checkoutId === undefined ||
      record.folderIdentity === undefined ||
      record.pullRequest === undefined ||
      (await folderIdentityOf(record.folder)) !== record.folderIdentity
    ) {
      return undefined
    }
    return {
      folder: record.folder,
      checkoutId: record.checkoutId,
      revision: recordRevision(record),
      fence: record.fence,
      headSha: record.pullRequest.headSha,
      folderIdentity: record.folderIdentity,
      pullRequest: record.pullRequest,
    }
  }

  /**
   * The held-worktree card's "Trust this worktree…": the confirmation
   * itself lives in the panel (lane U), which hands back the ticket it
   * showed; here exactly that checkout is marked, once, so the hold by
   * location lets that very worktree go. A ticket for a checkout replaced,
   * re-made, still pending or already trusted releases nothing.
   */
  public async releaseHold(
    ticket: TrustTicket,
  ): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    try {
      this.checkTrust()
    } catch (error: unknown) {
      return { ok: false, reason: failureText(error) }
    }
    // The folder must still be the one the checkout finished in.
    if ((await folderIdentityOf(ticket.folder)) !== ticket.folderIdentity) {
      return { ok: false, reason: UI_TEXT.gitOperationChanged }
    }
    // Trust or the window may have ended during that read (RVINTM123):
    // asked again now, under the store's hold, and just before the
    // release lands. One that landed stays a success.
    const isLive = (): boolean => this.deps.isTrusted() && !this.deps.signal.aborted
    const ended = (): { readonly ok: false; readonly reason: string } | undefined => {
      try {
        this.checkTrust()
        return undefined
      } catch (error: unknown) {
        return { ok: false, reason: failureText(error) }
      }
    }
    const endedBefore = ended()
    if (endedBefore !== undefined) {
      return endedBefore
    }
    // A release the store cannot persist, or one that no longer matches
    // the record, reads as changed: the card shows the checkout again.
    let released: WorktreeRecord | undefined
    try {
      released = await this.deps.records.release(ticket, this.deps.now(), isLive)
    } catch {
      return ended() ?? { ok: false, reason: UI_TEXT.gitOperationChanged }
    }
    if (released === undefined) {
      return ended() ?? { ok: false, reason: UI_TEXT.gitOperationChanged }
    }
    this.deps.log.info('The held worktree was trusted in the card')
    return { ok: true }
  }
}
