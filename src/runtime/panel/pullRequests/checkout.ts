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

import { execFile, spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  GIT_OUTPUT_MAX_BYTES,
  GIT_WORKTREE_TIMEOUT_MS,
  HELD_CHECKOUT_MAX_BYTES,
  HELD_CHECKOUT_MAX_ENTRIES,
  HELD_EXECUTABLE_MODE,
  HELD_FILE_MODE,
  UI_TEXT,
  UNTRUSTED_CHECKOUT_MIN_GIT_MINOR,
} from '../../../shared/constants'
import { fill, formatBytes } from '../../../shared/l10n/text'
import { GitHubClient, isCommitSha, type PullRequest } from '../../../core/git/github'
import { repositoryLabel } from '../../../core/git/githubRemote'
import { BlobAnswers, pullRequestCheckoutConfirmation } from '../../../core/git/heldCheckoutCore'
import { foldName, heldTree, type HeldEntry, unsafePathReason } from '../../../core/git/heldTree'
import {
  pullRequestRefFrom,
  remoteForPullRequest,
  type GitHubRemote,
} from '../../../core/git/pullRequestRef'
import { isPlainRefName } from '../../../core/git/pushPlan'
import { isSamePath } from '../../../core/paths'
import { withoutCredentials } from '../../../core/credentialEnvironment'
import { heldWorktreeFolder, type WorktreeRecord } from '../../../core/worktreeConversations'
import {
  worktreeAddDetachedArgs,
  worktreeAddHeldArgs,
  worktreeFolder,
} from '../../../core/worktrees'
import { confineWorkspacePath } from '../../../core/workspacePath'
import { canonicalPath } from '../../../host/canonicalPath'
import { createFileExclusively } from '../../../host/fsAtomic'
import type { CoreLogger } from '../../../core/logging'
import { redactSecrets } from '../../../core/redact'
import { resolveGitHubCredential, type GitHubCredential } from '../../../core/git/tokenSource'
import { PullRequestServiceError, type RuntimePullRequestDeps } from './pullRequests'
import { holdForRoots, type WorktreeRecordStore } from './records'

const COMMIT_PEEL = '^{commit}'
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

/** A hook configuration name the overrides below cannot spell. */
const HOOK_KEY = /^hook\.(.+)\.(?:command|event|enabled)$/iu
const NUL = '\0'

function checkoutRefusal(): Error {
  return new PullRequestServiceError(UI_TEXT.openPullRequestFiltersUnavailable)
}

/** Whether `output` of `git --version` takes per-command program controls. */
function hasProgramControls(output: string): boolean {
  const version = /^git version (\d+)\.(\d+)/u.exec(output)
  const major = Number(version?.[1])
  const minor = Number(version?.[2])
  return (
    Number.isSafeInteger(major) &&
    Number.isSafeInteger(minor) &&
    (major > 2 || (major === 2 && minor >= UNTRUSTED_CHECKOUT_MIN_GIT_MINOR))
  )
}

export interface PullRequestCheckoutGit {
  /** The pull request's head, fetched with the user's environment (credentials apply). */
  fetch(cwd: string, remote: string, ref: string, check: () => void): Promise<void>
  /** What the fetch brought: `FETCH_HEAD` peeled to its commit. */
  readFetchHead(cwd: string, check: () => void): Promise<string>
  /** The user's own pull request, detached, hooks switched off for the new worktree. */
  addOwnWorktree(cwd: string, folder: string, sha: string, check: () => void): Promise<void>
  /**
   * Someone else's pull request (RV71c): listed and refused whole on any
   * bad name, added with nothing checked out, indexed from the commit, its
   * files written from one `cat-file --batch`. A failure part way leaves no
   * worktree.
   */
  checkOutHeld(folder: string, sha: string, cwd: string, check: () => void): Promise<void>
}

export interface NodePullRequestCheckoutGitOptions {
  readonly gitPath: string
  /** The user's environment, as a terminal would have it (helpers, agent, tokens). */
  readonly userEnv: NodeJS.ProcessEnv
  /** No credentials, no prompt, no optional locks. */
  readonly quietEnv: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly log: CoreLogger
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

function runText(
  gitPath: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      gitPath,
      [...args],
      {
        cwd,
        env,
        timeout: GIT_WORKTREE_TIMEOUT_MS,
        maxBuffer: GIT_OUTPUT_MAX_BYTES,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        reject(error instanceof Error ? error : new PullRequestServiceError(failureText(error)))
      },
    )
  })
}

interface NodeGitRunner {
  readonly gitPath: string
  readonly quietEnv: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly log: CoreLogger
  versionChecked: boolean
  text(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string>
}

/** The per-command overrides that switch off every named hook where git runs. */
async function hookOverrides(
  git: NodeGitRunner,
  cwd: string,
  check: () => void,
): Promise<readonly string[]> {
  if (!git.versionChecked) {
    let output: string
    try {
      output = await git.text(['--version'], cwd, git.quietEnv)
    } catch {
      throw checkoutRefusal()
    }
    if (!hasProgramControls(output)) {
      throw checkoutRefusal()
    }
    git.versionChecked = true
  }
  check()
  let configuration: string
  try {
    configuration = await git.text(
      [...untrustedCheckoutArgs(git.platform), 'config', '--null', '--name-only', '--list'],
      cwd,
      git.quietEnv,
    )
  } catch {
    throw checkoutRefusal()
  }
  check()
  // New Git can configure named hooks independently of core.hooksPath.
  const hooks = new Set(
    configuration.split(NUL).flatMap((name) => {
      const hook = HOOK_KEY.exec(name)?.[1]
      return hook === undefined ? [] : [hook]
    }),
  )
  // -c splits at its first '='; such subsection names cannot be represented
  // by these per-command overrides. Never guess an escape.
  if ([...hooks].some((name) => name.includes('=') || /\p{Cc}/u.test(name))) {
    throw checkoutRefusal()
  }
  return [
    ...untrustedCheckoutArgs(git.platform),
    ...[...hooks].flatMap((hook) => [
      '-c',
      `hook.${hook}.enabled=false`,
      '-c',
      `hook.${hook}.event=`,
    ]),
  ]
}

/** Where a path of the commit lands: inside the worktree, spelled as stored. */
async function heldDestinationOf(platform: NodeJS.Platform, folder: string, entryPath: string) {
  const resolution = await confineWorkspacePath(folder, entryPath, platform, {
    realPath: canonicalPath,
  })
  if (
    !resolution.ok ||
    foldName(resolution.canonical, platform) !== foldName(resolution.relative, platform)
  ) {
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
  check: () => void,
): Promise<void> {
  const answers = new BlobAnswers(
    blobs,
    async (entry, bytes) => {
      const destination = await heldDestinationOf(git.platform, folder, entry.path)
      check()
      await createFileExclusively(destination.absolute, bytes, {
        mode: entry.kind === 'executable' ? HELD_EXECUTABLE_MODE : HELD_FILE_MODE,
        expectedDirectory: path.dirname(destination.checkedAbsolute),
        assertCanWrite: check,
        platform: git.platform,
        warn: (_stage, _isPublished, error) => {
          git.log.warn(
            `A held checkout left a stage file it could not remove: ${error instanceof Error ? error.message : String(error)}`,
          )
        },
      })
    },
    unreadable,
  )
  check()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      git.gitPath,
      [...untrustedCheckoutArgs(git.platform), 'cat-file', '--batch'],
      { cwd, env: git.quietEnv, windowsHide: true },
    )
    let hasFailed = false
    const fail = (error: Error) => {
      if (hasFailed) {
        return
      }
      hasFailed = true
      child.kill()
      reject(error)
    }
    child.on('error', fail)
    // Attached before the stream is read: the close may already have fired
    // once the last answer is consumed.
    const closed = new Promise<number | null>((done) => child.on('close', done))
    child.stdin.write(blobs.map((entry) => `${entry.oid}\n`).join(''))
    child.stdin.end()
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
      resolve()
    })()
  })
}

/** Every answer the stream completes, written before git goes on. */
async function takeChunks(answers: BlobAnswers, stdout: NodeJS.ReadableStream): Promise<void> {
  for await (const chunk of stdout) {
    if (!Buffer.isBuffer(chunk)) {
      throw unreadable()
    }
    await answers.take(chunk)
  }
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
    log: options.log,
    versionChecked: false,
    text: (args, cwd, env) => runText(options.gitPath, args, cwd, env),
  }
  return {
    fetch: async (cwd, remote, ref, check) => {
      check()
      await runText(options.gitPath, ['fetch', remote, ref], cwd, options.userEnv)
    },
    readFetchHead: (cwd, check) => {
      check()
      return runText(
        options.gitPath,
        ['rev-parse', '--verify', `${FETCH_HEAD}${COMMIT_PEEL}`],
        cwd,
        options.quietEnv,
      )
    },
    addOwnWorktree: async (cwd, folder, sha, check) => {
      check()
      await runText(
        options.gitPath,
        // A relative core.hooksPath can resolve to executable code from
        // this PR in the new worktree; the trust card has not approved that code.
        [
          '-c',
          `core.hooksPath=${nullDeviceFor(options.platform)}`,
          ...worktreeAddDetachedArgs(folder, sha),
        ],
        cwd,
        options.quietEnv,
      )
    },
    checkOutHeld: async (folder, sha, cwd, check) => {
      if (!isCommitSha(sha)) {
        throw new PullRequestServiceError(UI_TEXT.openPullRequestFetchFailed)
      }
      let listing: string
      try {
        const overrides = await hookOverrides(git, cwd, check)
        check()
        listing = await git.text(
          [...overrides, 'ls-tree', '-r', '-z', '--full-tree', '--long', sha],
          cwd,
          git.quietEnv,
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
      const overrides = await hookOverrides(git, cwd, check)
      check()
      await git.text([...overrides, ...worktreeAddHeldArgs(folder, sha)], cwd, git.quietEnv)
      try {
        // In the worktree, so named hooks its own configuration defines are found and switched off.
        const worktreeOverrides = await hookOverrides(git, folder, check)
        check()
        await git.text([...worktreeOverrides, 'read-tree', sha], folder, git.quietEnv)
        for (const entry of tree.entries) {
          if (entry.kind !== 'submodule') {
            continue
          }
          // A submodule: an empty folder, made where its path says and nowhere else.
          const destination = await heldDestinationOf(options.platform, folder, entry.path)
          check()
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
          await writeHeldBlobs(git, folder, cwd, blobs, check)
        }
      } catch (error: unknown) {
        try {
          check()
          // --force: without it git first runs `git status` in the
          // worktree, through the filters this checkout never ran.
          await git.text(['worktree', 'remove', '--force', folder], cwd, git.quietEnv)
        } catch (error_: unknown) {
          options.log.warn(
            `A held checkout's worktree was left after it failed: ${error_ instanceof Error ? error_.message : String(error_)}`,
          )
        }
        throw error
      }
    },
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
  | { readonly ok: false; readonly reason: string }

// GitHub keeps every pull request's head at this ref of the base repository.
function pullHeadRef(number: number): string {
  return `pull/${String(number)}/head`
}

function failureText(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

/**
 * "Open a pull request in a conversation…": the pull request's head is
 * fetched with the user's Git environment and checked out, detached, in a
 * worktree of its own that opens through `workspace/openFolder`. Only an
 * explicit confirmation checks anything out; an existing checkout is
 * offered again as it is, never taken over.
 */
export class RuntimePullRequestCheckout {
  public constructor(private readonly deps: RuntimeCheckoutDeps) {}

  private checkTrust(): void {
    if (!this.deps.isTrusted()) {
      throw new PullRequestServiceError(UI_TEXT.gitRestricted)
    }
    this.deps.signal.throwIfAborted()
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
      return { ok: false, reason: `${UI_TEXT.gitHubFailed}: ${failureText(error)}` }
    }
    const folder = isOwn
      ? worktreeFolder(
          this.deps.repositoryRoot,
          `${OWN_FOLDER_PREFIX}${String(number)}`,
          this.deps.platform,
        )
      : heldWorktreeFolder(this.deps.dataFolder, remote.repository, number, this.deps.platform)
    if (this.deps.pathExists(folder)) {
      // Checked out before: offered again as it is. A folder this service
      // did not make, or a checkout that never finished, is never taken
      // over or opened.
      const existing = await this.deps.records.recordFor(folder)
      if (existing === undefined || existing.isCheckoutPending === true) {
        return { ok: false, reason: `${UI_TEXT.worktreeFolderExists} ${folder}` }
      }
      const shouldReopen = await this.deps.confirm(
        fill(UI_TEXT.openPullRequestExisting, { number }),
        folder,
        UI_TEXT.worktreeOpen,
      )
      this.checkTrust()
      if (shouldReopen) {
        await this.deps.openFolder(folder)
        return { ok: true, folder, held: existing.isHeld, number }
      }
      return { ok: false, reason: UI_TEXT.gitPushDeclined }
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
      return { ok: false, reason: `${UI_TEXT.gitHubFailed}: ${redactSecrets(pullRequest.headSha)}` }
    }
    // A remote named like an option would read as one where git receives it.
    if (!isPlainRefName(remote.name)) {
      return { ok: false, reason: UI_TEXT.gitPushUnsafeName }
    }
    const cwd = this.deps.repositoryRoot
    try {
      this.checkTrust()
      // Through the user's environment, so its credentials reach a private repository.
      await this.deps.git.fetch(cwd, remote.name, pullHeadRef(number), () => {
        this.checkTrust()
      })
      this.checkTrust()
      // The head GitHub named must be what came: a push in between is refused, not guessed.
      const fetched = await this.deps.git.readFetchHead(cwd, () => {
        this.checkTrust()
      })
      this.checkTrust()
      if (fetched.trim() !== pullRequest.headSha) {
        return { ok: false, reason: UI_TEXT.gitOperationChanged }
      }
    } catch (error: unknown) {
      this.deps.log.warn(`Fetching pull request #${String(number)} failed`)
      return { ok: false, reason: `${UI_TEXT.openPullRequestFetchFailed}: ${failureText(error)}` }
    }
    const record: WorktreeRecord = {
      folder,
      repositoryRoot: this.deps.repositoryRoot,
      createdAt: this.deps.now(),
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
    }
    // Recorded before the folder exists, so no window ever sees it unrecorded.
    const previous = await this.deps.records.put(record)
    try {
      this.checkTrust()
      if (isOwn) {
        await this.deps.git.addOwnWorktree(cwd, folder, pullRequest.headSha, () => {
          this.checkTrust()
        })
      } else {
        await this.deps.git.checkOutHeld(folder, pullRequest.headSha, cwd, () => {
          this.checkTrust()
        })
      }
      await this.deps.records.complete(folder, record.createdAt)
    } catch (error: unknown) {
      await this.deps.records.remove(folder, record.createdAt, previous)
      return { ok: false, reason: `${UI_TEXT.worktreeAddFailed}: ${failureText(error)}` }
    }
    this.checkTrust()
    this.deps.log.info(
      `Pull request #${String(number)} checked out in a worktree${isOwn ? '' : ', held'}`,
    )
    await this.deps.openFolder(folder)
    return { ok: true, folder, held: !isOwn, number }
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
   * The held-worktree card's "Trust this worktree…": the confirmation
   * itself lives in the panel (lane U); here the record is marked, so the
   * hold by location lets that very worktree go.
   */
  public async releaseHold(
    folder: string,
  ): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    try {
      this.checkTrust()
    } catch (error: unknown) {
      return { ok: false, reason: failureText(error) }
    }
    const released = await this.deps.records.release(folder, this.deps.now())
    if (released !== undefined) {
      this.deps.log.info('The held worktree was trusted in the card')
    }
    return released === undefined
      ? { ok: false, reason: UI_TEXT.gitOperationChanged }
      : { ok: true }
  }
}
