// The runtime Git service (M123 lane G, PLAN.md D104): status, diff,
// commit, push, fetch and worktree checkout through the user's own `git`,
// for every editor outside VS Code (and a VS Code-family host without
// `vscode.git`), behind lane 0's `RuntimeGitDeps`.
//
// - The user's `git` (`RuntimeGitDeps.gitPath`, absolute) runs through the
//   existing bounded runner (`createGitProcess`: output caps, deadlines,
//   M107 admission, whole-tree stop), with explicit argument arrays and no
//   shell. Every argument list passes `assertNativeGitArgs` (a fixed
//   allowlist: the subcommand and every flag are fixed, and any name git
//   would resolve — a remote, a refspec, a ref — is refused unless plain,
//   so `+`, `-`, `:` and whitespace cannot change what goes out). The one
//   value git receives is the commit message, as a single `-m` value.
// - The last line before git is the runner's `beforeRun`, called after
//   admission and the Windows job's preparation with no await before the
//   spawn: the arguments, the operation's signal and owner, the editor's
//   trust and the bound root's identity are all checked there again.
// - Reads keep the quiet environment (no credentials, no prompt). A
//   confirmed push and a pull request fetch are D104's named exception:
//   the user's own environment (`RuntimeGitDeps.userEnvironment`: their
//   credential helpers, SSH agent and token variables, as a terminal would)
//   with `GIT_TERMINAL_PROMPT=0`, and nothing of ours.
// - Hooks and signing run as the user configured them (no `--no-verify`,
//   no `--no-gpg-sign`); nothing is ever force-pushed.
// - The repository root is bound when the service is made: its canonical
//   path and its directory identity (volume and file id). Every operation,
//   and every spawn, refuses a path that now leads elsewhere (a rename and
//   a link or junction in its place, a replacement directory), and git's
//   own toplevel must be that same directory. Working-tree files are read
//   confined by identity (`confinedFiles.ts`). A worktree for someone
//   else's pull request goes under the runtime data folder's
//   `pr-worktrees/`, which must be a real directory there.
// - Mutations (commit, push, fetch, worktree) are serialized per physical
//   repository across every conversation in this process, and each
//   revalidates what its user confirmed inside that lock.
// - Every method takes the caller's operation: its signal (Cancel, a
//   session change, disposal) stops pending git, and its owner check runs
//   after every await and at the spawn.
// - Nothing secret is logged, thrown in clear, or shown: failures carry
//   git's words to the caller, which redacts them before any cut.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  fileIdentityKey,
  identityOf,
  lstatIdentity,
  lstatIdentitySync,
  sameFile,
  statIdentity,
  statIdentitySync,
  type FileIdentity,
} from '../../../core/fs/fileIdentity'
import { canonicalPath, isMissingPath } from '../../../host/canonicalPath'
import { createGitProcess, quietGitEnvironment, type GitProcess } from '../../../host/git'
import {
  commitMessageProblem,
  nativeCommitArgs,
  nativeStageAllArgs,
  type CommitMessageProblem,
} from '../../../core/git/commit'
import { nativeDiffArgs, readNativeDiff, type TruncatedDiff } from '../../../core/git/diff'
import {
  isPlainRefName,
  isPlainRefspec,
  planPush,
  type PushPlan,
  type RemoteFacts,
} from '../../../core/git/pushPlan'
import {
  isReadableRemoteName,
  nativeRemoteNamesArgs,
  nativeStatusArgs,
  readNativeStatus,
  toPushHead,
  type NativeGitContext,
  type NativeStatusSnapshot,
} from '../../../core/git/status'
import { newFileDiff } from '../../../core/git/gitText'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import { GIT_TIMEOUT_MS, PULL_REQUEST_WORKTREES_DIR } from '../../../shared/constants'
import {
  ConfinementError,
  fingerprintConfined,
  readConfinedStart,
  type ConfinedRoot,
} from './confinedFiles'

/** The subcommands the service runs; anything else is refused. */
const NATIVE_GIT_SUBCOMMANDS = [
  'status',
  'diff',
  'commit',
  'push',
  'fetch',
  'rev-parse',
  'config',
  'remote',
  'worktree',
  'add',
] as const

/** `git config --get` reads for the commit consent; named here, never by the user. */
const SIGNING_CONFIG_KEYS = ['commit.gpgsign', 'gpg.format', 'user.signingkey'] as const

/** A worktree name: one path segment, never an option or a traversal. */
const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/
/** `worktree add` takes its flags, the path and the commit: nothing else. */
const WORKTREE_ADD_ARGUMENTS = 5
const ALREADY_EXISTS = 'EEXIST'

function haveSameArgs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((arg, index) => arg === right[index])
}

/**
 * The fixed argument allowlist: the subcommand and every flag are fixed,
 * and any name git resolves is refused unless plain. Throws on anything
 * else, including an unknown subcommand. Lane P reuses this for the pull
 * request fetch and the held checkout's reads.
 */
export function assertNativeGitArgs(args: readonly string[]): void {
  const [subcommand, ...rest] = args
  if (
    subcommand === undefined ||
    !(NATIVE_GIT_SUBCOMMANDS as readonly string[]).includes(subcommand)
  ) {
    throw new Error(`Refused git arguments: ${subcommand ?? '(none)'}`)
  }
  switch (subcommand) {
    case 'status': {
      if (!haveSameArgs(args, nativeStatusArgs())) {
        throw new Error('Refused git status arguments')
      }
      break
    }
    case 'remote': {
      if (!haveSameArgs(args, nativeRemoteNamesArgs())) {
        throw new Error('Refused git remote arguments')
      }
      break
    }
    case 'diff': {
      if (!haveSameArgs(args, nativeDiffArgs(true)) && !haveSameArgs(args, nativeDiffArgs(false))) {
        throw new Error('Refused git diff arguments')
      }
      break
    }
    case 'add': {
      if (!haveSameArgs(args, nativeStageAllArgs())) {
        throw new Error('Refused git add arguments')
      }
      break
    }
    case 'rev-parse': {
      if (!haveSameArgs(args, ['rev-parse', '--show-toplevel'])) {
        throw new Error('Refused git rev-parse arguments')
      }
      break
    }
    case 'config': {
      // The signing keys, or `remote.<name>.url|pushurl` for a readable
      // name: fixed shapes, with the name rechecked, never free text.
      const [flag, key] = rest
      const remoteKey = /^remote\.(.+)\.(url|pushurl)$/.exec(key ?? '')
      const isSigning = (SIGNING_CONFIG_KEYS as readonly string[]).includes(key ?? '')
      if (
        flag !== '--get' ||
        rest.length !== 2 ||
        (!isSigning && (remoteKey === null || !isReadableRemoteName(remoteKey[1] ?? '')))
      ) {
        throw new Error('Refused git config arguments')
      }
      break
    }
    case 'commit': {
      // The message is one `-m` value; anything else in its place is refused.
      if (rest.length !== 2 || rest[0] !== '-m' || typeof rest[1] !== 'string') {
        throw new Error('Refused git commit arguments')
      }
      break
    }
    case 'push': {
      const withUpstream = rest[0] === '-u' ? rest.slice(1) : rest
      const [remote, refspec] = withUpstream
      if (
        remote === undefined ||
        refspec === undefined ||
        withUpstream.length !== 2 ||
        !isPlainRefName(remote) ||
        !isPlainRefspec(refspec)
      ) {
        throw new Error('Refused git push arguments')
      }
      break
    }
    case 'fetch': {
      const [remote, ref] = rest
      if (
        remote === undefined ||
        !isPlainRefName(remote) ||
        (ref !== undefined && !isPlainRefName(ref)) ||
        rest.length > 2
      ) {
        throw new Error('Refused git fetch arguments')
      }
      break
    }
    case 'worktree': {
      const [action, noCheckout, detach, wtPath, commit] = rest
      if (
        action !== 'add' ||
        noCheckout !== '--no-checkout' ||
        detach !== '--detach' ||
        wtPath === undefined ||
        commit === undefined ||
        (!path.posix.isAbsolute(wtPath) && !path.win32.isAbsolute(wtPath)) ||
        !isPlainRefName(commit) ||
        rest.length !== WORKTREE_ADD_ARGUMENTS
      ) {
        throw new Error('Refused git worktree arguments')
      }
      break
    }
  }
}

/** A confirmed push or pull request fetch keeps the user's Git environment (D104). */
export function nativePushEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, GIT_TERMINAL_PROMPT: '0' }
}

/** Exactly what `git push` receives: the remote, the refspec, `-u` on a first push. */
export function nativePushArgs(plan: Extract<PushPlan, { ok: true }>): readonly string[] {
  return plan.setUpstream
    ? ['push', '-u', plan.remote, plan.refspec]
    : ['push', plan.remote, plan.refspec]
}

/** The same command in the editor's terminal, with the same `git`, for finishing a failed push there. */
export function nativePushTerminalCommand(
  plan: Extract<PushPlan, { ok: true }>,
  gitPath: string,
): readonly string[] {
  return [gitPath, ...nativePushArgs(plan)]
}

/** Exactly what a pull request fetch receives (lane P): the remote, then the ref. */
export function nativeFetchArgs(remote: string, ref?: string): readonly string[] {
  return ref === undefined ? ['fetch', remote] : ['fetch', remote, ref]
}

/** A held checkout's worktree (lane P): detached, without checking files out yet. */
export function nativeWorktreeAddArgs(wtPath: string, commit: string): readonly string[] {
  return ['worktree', 'add', '--no-checkout', '--detach', wtPath, commit]
}

/** Why a commit did not run; the adapter answers each in the panel's words. */
export class CommitRefusedError extends Error {
  public constructor(
    public readonly problem: CommitMessageProblem | 'nothingStaged' | 'nothingToCommit',
    public readonly trimmed: string,
  ) {
    super(problem)
    this.name = 'CommitRefusedError'
  }
}

/**
 * A reason word the service throws (for the log, as `tokenSource.ts`
 * does): the adapter shows each in the panel's words. `closed` is an
 * aborted window or operation (Cancel, a session change, disposal);
 * `changed` a moved repository, root or form; `untrusted` a lost trust;
 * `refused` an argument git must not see.
 */
export type NativeGitRefusal = 'untrusted' | 'changed' | 'refused' | 'closed'

/** A refusal: nothing ran past the check that threw it. */
export class NativeGitRefusalError extends Error {
  public constructor(public readonly reason: NativeGitRefusal) {
    super(reason)
    this.name = 'NativeGitRefusalError'
  }
}

export function refusalOf(error: unknown): NativeGitRefusal | undefined {
  if (error instanceof NativeGitRefusalError) {
    return error.reason
  }
  if (error instanceof ConfinementError) {
    return 'changed'
  }
  return error instanceof Error && error.name === 'AbortError' ? 'closed' : undefined
}

/**
 * What a caller's operation adds to the window's: its own signal (Cancel,
 * a session change, disposal) and its owner check (the conversation's
 * epoch and session), run after every await and at the spawn.
 */
export interface NativeGitOperation {
  readonly signal?: AbortSignal | undefined
  readonly check?: (() => void) | undefined
}

/** One operation's combined signal and check. */
interface Guard {
  readonly signal: AbortSignal
  readonly check: () => void
}

/** The root the service bound to when it was made. */
interface BoundRoot extends ConfinedRoot {
  /** The physical repository, for the per-repository lock. */
  readonly key: string
}

/** A commit form's facts and its stamp. */
export interface StampedStatus {
  readonly snapshot: NativeStatusSnapshot
  readonly remotes: RemoteFacts[]
  readonly stamp: string
}

/** `/` separators for comparing paths on every platform (CI runs on Windows). */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/').replace(/\/+$/, '')
}

/**
 * The root as approved now: its canonical path and its directory identity,
 * or undefined when it cannot be bound (every operation then refuses).
 */
async function bindRoot(root: string): Promise<BoundRoot | undefined> {
  try {
    const canonical = await canonicalPath(root)
    const stats = await statIdentity(canonical)
    const key = fileIdentityKey(stats)
    return key !== undefined && stats.isDirectory()
      ? { path: canonical, identity: identityOf(stats), key }
      : undefined
  } catch {
    return undefined
  }
}

/** The tail of each physical repository's mutation queue, shared by every conversation here. */
const repositoryQueues = new Map<string, Promise<void>>()

/** A promise that settles when `signal` aborts (it never rejects), or never. */
function abortOf(signal: AbortSignal, listening: AbortSignal): Promise<void> {
  // Node 20 (VS Code 1.99's host) has no Promise.withResolvers: the
  // executor installs the listener directly.
  return new Promise<void>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true, signal: listening },
    )
  })
}

/** Waits for `previous` unless `signal` aborts first (then `closed`). */
async function turnOf(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  const listening = new AbortController()
  try {
    await Promise.race([previous, abortOf(signal, listening.signal)])
  } finally {
    listening.abort()
  }
  if (signal.aborted) {
    throw new NativeGitRefusalError('closed')
  }
}

/** The queue's tail after this turn: the previous one, then this one's end. */
async function after(previous: Promise<void>, done: Promise<void>): Promise<void> {
  await previous
  await done
}

/**
 * Runs `work` alone among this process's mutations of the repository
 * `key`, in order. A caller cancelled while waiting leaves the queue and
 * never runs.
 */
async function serialized<T>(key: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const previous = repositoryQueues.get(key) ?? Promise.resolve()
  const finished = new AbortController()
  const tail = after(previous, abortOf(finished.signal, new AbortController().signal))
  repositoryQueues.set(key, tail)
  try {
    await turnOf(previous, signal)
    return await work()
  } finally {
    finished.abort()
    if (repositoryQueues.get(key) === tail) {
      repositoryQueues.delete(key)
    }
  }
}

function isSamePlan(
  left: Extract<PushPlan, { ok: true }>,
  right: Extract<PushPlan, { ok: true }>,
): boolean {
  return (
    left.remote === right.remote &&
    left.remoteUrl === right.remoteUrl &&
    left.branch === right.branch &&
    left.target === right.target &&
    left.refspec === right.refspec &&
    left.setUpstream === right.setUpstream &&
    left.commits === right.commits
  )
}

export interface NativeGitServiceOptions {
  /** The bounded runner; the production `createGitProcess` wiring unless a test passes its own. */
  readonly run?: GitProcess | undefined
}

/** The bound root's identity now, or `changed` when it cannot be read. */
async function identityNow(target: string): Promise<FileIdentity> {
  try {
    return identityOf(await statIdentity(target))
  } catch {
    throw new NativeGitRefusalError('changed')
  }
}

/**
 * Git behind lane 0's `RuntimeGitDeps`, for lanes P and U, the ACP agent
 * and `exec` to build on. Every method rechecks the operation, the signal
 * and the editor's trust after every await and at the spawn, runs in the
 * bound root, and asserts the argument allowlist at the last line before git.
 */
export class NativeGitService {
  private readonly run: GitProcess
  /** The directory approved when the service was made; undefined when it could not be bound. */
  private readonly bound: Promise<BoundRoot | undefined>

  public constructor(
    private readonly deps: RuntimeGitDeps,
    options: NativeGitServiceOptions = {},
  ) {
    this.run =
      options.run ??
      createGitProcess({
        platform: process.platform,
        env: process.env,
        fileExists: existsSync,
        spawn,
        // The git the host resolved, never another one on PATH.
        executable: deps.gitPath,
      })
    // The directory approved now is the one every later operation must find.
    this.bound = bindRoot(deps.repositoryRoot)
  }

  private guard(operation: NativeGitOperation = {}): Guard {
    const signal =
      operation.signal === undefined
        ? this.deps.signal
        : AbortSignal.any([this.deps.signal, operation.signal])
    return {
      signal,
      check: () => {
        if (signal.aborted) {
          throw new NativeGitRefusalError('closed')
        }
        if (!this.deps.isTrusted()) {
          throw new NativeGitRefusalError('untrusted')
        }
        operation.check?.()
      },
    }
  }

  /** The spawn's last line (the runner's `beforeRun`): synchronous, after admission. */
  private atSpawn(args: readonly string[], root: BoundRoot, guard: Guard): () => void {
    return () => {
      assertNativeGitArgs(args)
      guard.check()
      let identity: FileIdentity
      try {
        identity = identityOf(statIdentitySync(root.path))
      } catch {
        throw new NativeGitRefusalError('changed')
      }
      if (!sameFile(identity, root.identity)) {
        throw new NativeGitRefusalError('changed')
      }
    }
  }

  private async spawn(
    args: readonly string[],
    root: BoundRoot,
    guard: Guard,
    isUserEnvironment: boolean,
  ): Promise<Buffer> {
    assertNativeGitArgs(args)
    guard.check()
    try {
      return await this.run(args, {
        cwd: root.path,
        env: isUserEnvironment
          ? nativePushEnvironment(this.deps.userEnvironment())
          : quietGitEnvironment(process.env),
        timeoutMs: GIT_TIMEOUT_MS,
        signal: guard.signal,
        beforeRun: this.atSpawn(args, root, guard),
        ...(isUserEnvironment && { isUserEnvironment: true }),
      })
    } catch (error: unknown) {
      if (error instanceof NativeGitRefusalError) {
        throw error
      }
      if (guard.signal.aborted) {
        // Cancel or the window stopped it: never reported as git's failure.
        throw new NativeGitRefusalError('closed')
      }
      // Fixed words only: git's own text (paths, remotes, accounts) goes to
      // the caller, which redacts it before any cut.
      const [subcommand] = args
      this.deps.log.warn(`git ${subcommand ?? 'unknown'} failed`)
      throw error
    }
  }

  /** The quiet runner over the bound root, for the core readers. */
  private reader(root: BoundRoot, guard: Guard): GitProcess {
    return (args) => this.spawn(args, root, guard, false)
  }

  private context(root: BoundRoot, guard: Guard): NativeGitContext {
    return { cwd: root.path, env: {}, signal: guard.signal }
  }

  /** Mutations run through the host's admission when it has one (M72's checkpoints). */
  private async admitted<T>(start: () => Promise<T>): Promise<T> {
    const admit = this.deps.admitWorkspaceCommand
    return admit === undefined ? await start() : await admit(start)
  }

  private async rootFor(guard: Guard): Promise<BoundRoot> {
    guard.check()
    const root = await this.bound
    guard.check()
    if (root === undefined) {
      throw new NativeGitRefusalError('changed')
    }
    // The path still leads to the bound directory: a rename with a link or
    // junction in its place, or a replacement directory, is refused.
    let current: string
    try {
      current = await canonicalPath(this.deps.repositoryRoot)
    } catch {
      throw new NativeGitRefusalError('changed')
    }
    const identity = await identityNow(current)
    guard.check()
    if (slashed(current) !== slashed(root.path) || !sameFile(identity, root.identity)) {
      throw new NativeGitRefusalError('changed')
    }
    // git's own toplevel is that same directory, by identity.
    const toplevelBytes = await this.spawn(['rev-parse', '--show-toplevel'], root, guard, false)
    const toplevel = await identityNow(toplevelBytes.toString('utf8').trim())
    guard.check()
    if (!sameFile(toplevel, root.identity)) {
      throw new NativeGitRefusalError('changed')
    }
    return root
  }

  private async stamped(root: BoundRoot, guard: Guard): Promise<StampedStatus> {
    const { snapshot, remotes } = await readNativeStatus(
      this.reader(root, guard),
      this.context(root, guard),
    )
    guard.check()
    const worktree = await fingerprintConfined(
      root,
      [...snapshot.unstaged, ...snapshot.untracked],
      guard.check,
    )
    guard.check()
    const stamp = JSON.stringify({
      oid: snapshot.headOid,
      branch: snapshot.branch,
      upstream: snapshot.upstream,
      ahead: snapshot.ahead,
      behind: snapshot.behind,
      // The index's object names and modes beside each path: other bytes
      // staged under the same name change the stamp.
      records: snapshot.records,
      // The working tree's bytes behind every unstaged and new file.
      worktree,
    })
    return { snapshot, remotes, stamp }
  }

  private async planIn(root: BoundRoot, guard: Guard, chosenRemote?: string): Promise<PushPlan> {
    const { snapshot, remotes } = await readNativeStatus(
      this.reader(root, guard),
      this.context(root, guard),
    )
    guard.check()
    const head = toPushHead(snapshot, remotes)
    return head.ok ? planPush(head.head, remotes, chosenRemote) : { ok: false, refusal: 'noRemote' }
  }

  /**
   * The storage parent for held checkouts: `pr-worktrees/` directly under
   * the resolved data folder, made if missing, and a real directory there
   * (never a link or junction that leads elsewhere). Links above the data
   * folder itself are the user's own layout and are resolved, not refused.
   */
  private async worktreeParent(guard: Guard): Promise<ConfinedRoot> {
    const storage = await canonicalPath(this.deps.dataFolder)
    guard.check()
    const parent = path.join(storage, PULL_REQUEST_WORKTREES_DIR)
    try {
      await mkdir(parent)
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === ALREADY_EXISTS)) {
        throw error
      }
    }
    guard.check()
    const held = await lstatIdentity(parent)
    const resolved = await canonicalPath(parent)
    const reached = await identityNow(resolved)
    guard.check()
    if (
      held.isSymbolicLink() ||
      !held.isDirectory() ||
      slashed(resolved) !== slashed(parent) ||
      !sameFile(reached, identityOf(held))
    ) {
      throw new NativeGitRefusalError('changed')
    }
    return { path: parent, identity: identityOf(held) }
  }

  /** The guard plus: the storage parent is still the real directory confined before. */
  private parentHeld(guard: Guard, parent: ConfinedRoot): Guard {
    return {
      signal: guard.signal,
      check: () => {
        guard.check()
        let isHeld: boolean
        try {
          const stats = lstatIdentitySync(parent.path)
          isHeld =
            !stats.isSymbolicLink() &&
            stats.isDirectory() &&
            sameFile(identityOf(stats), parent.identity)
        } catch {
          isHeld = false
        }
        if (!isHeld) {
          throw new NativeGitRefusalError('changed')
        }
      },
    }
  }

  /**
   * The bound repository root, verified again: resolved through links and
   * junctions, the same directory (by identity) as when the service was
   * made, and git's own toplevel.
   */
  public async resolveRoot(operation?: NativeGitOperation): Promise<string> {
    const root = await this.rootFor(this.guard(operation))
    return root.path
  }

  /** The root as bound, unverified: only where a command is shown or a link keyed, never run. */
  public async boundRoot(): Promise<string> {
    const root = await this.bound
    return root?.path ?? this.deps.repositoryRoot
  }

  /** The status snapshot and the remotes git knows, in the quiet environment. */
  public async status(operation?: NativeGitOperation): Promise<{
    readonly snapshot: NativeStatusSnapshot
    readonly remotes: RemoteFacts[]
  }> {
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    const read = await readNativeStatus(this.reader(root, guard), this.context(root, guard))
    guard.check()
    return read
  }

  /**
   * The commit form's facts and its stamp: what the commit rechecks,
   * inside the repository's lock, before staging anything.
   */
  public async formStatus(operation?: NativeGitOperation): Promise<StampedStatus> {
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    return await this.stamped(root, guard)
  }

  /** The staged or unstaged diff, bounded and binary-safe. */
  public async diff(
    isStaged: boolean,
    maxBytes: number,
    operation?: NativeGitOperation,
  ): Promise<TruncatedDiff> {
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    const truncated = await readNativeDiff(
      this.reader(root, guard),
      this.context(root, guard),
      isStaged,
      maxBytes,
    )
    guard.check()
    return truncated
  }

  /**
   * New files' starts for a commit-message prompt, as a diff would show
   * them, within `maxBytes` read in all; each read confined to the bound
   * root by identity. A link, a folder or a vanished file stays a
   * file-list entry.
   */
  public async newFileParts(
    files: readonly string[],
    maxBytes: number,
    operation?: NativeGitOperation,
  ): Promise<string> {
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    const parts: string[] = []
    let room = maxBytes
    for (const file of files) {
      if (room <= 0) {
        break
      }
      let start: Awaited<ReturnType<typeof readConfinedStart>>
      try {
        start = await readConfinedStart(root, file, room, guard.check)
      } catch (error: unknown) {
        // A swapped ancestor or a lost owner refuses the prompt; an
        // unreadable file (permissions) only stays out of it.
        if (refusalOf(error) !== undefined) {
          throw error
        }
        start = undefined
      }
      guard.check()
      if (start === undefined) {
        continue
      }
      room -= start.bytes.length
      parts.push(newFileDiff(file, start.bytes, start.size))
    }
    return parts.join('\n')
  }

  /**
   * Commits `message`: validates it, and inside the repository's lock
   * rechecks the repository against `expectedStamp` (the form's: the
   * status records with the index's object names, and the working tree's
   * bytes), stages everything for an unstaged commit, and runs the user's
   * hooks and signer. The caller's press is the confirmation.
   */
  public async commit(
    message: string,
    isUnstagedIncluded: boolean,
    expectedStamp?: string,
    operation?: NativeGitOperation,
  ): Promise<{ readonly branch: string; readonly subject: string }> {
    const trimmed = message.trim()
    const problem = commitMessageProblem(message)
    if (problem !== undefined) {
      throw new CommitRefusedError(problem, trimmed)
    }
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    return await serialized(root.key, guard.signal, async () => {
      guard.check()
      const { snapshot, stamp } = await this.stamped(root, guard)
      if (expectedStamp !== undefined && stamp !== expectedStamp) {
        throw new NativeGitRefusalError('changed')
      }
      if (!isUnstagedIncluded && snapshot.staged.length === 0) {
        throw new CommitRefusedError('nothingStaged', trimmed)
      }
      if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length === 0) {
        throw new CommitRefusedError('nothingToCommit', trimmed)
      }
      await this.admitted(async () => {
        if (isUnstagedIncluded) {
          await this.spawn(nativeStageAllArgs(), root, guard, false)
          guard.check()
        }
        await this.spawn(nativeCommitArgs(trimmed), root, guard, false)
      })
      // The commit is made: it lands on the branch read inside the lock, and
      // a Cancel after it never turns it into a failure.
      return {
        branch: snapshot.branch ?? 'HEAD',
        subject: trimmed.split(/\r?\n/, 1)[0] ?? trimmed,
      }
    })
  }

  /**
   * The push for the current branch, or why M71's push plan refuses it.
   * `chosenRemote` is the user's pick for a first push when git cannot
   * tell (`chooseRemote` names the choices).
   */
  public async planPush(chosenRemote?: string, operation?: NativeGitOperation): Promise<PushPlan> {
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    return await this.planIn(root, guard, chosenRemote)
  }

  /**
   * Pushes exactly `plan`, the one the user confirmed: planned again inside
   * the repository's lock and refused (`changed`) unless identical, a
   * second plain-name check at the last line before git, never a force
   * mode, in the user's own Git environment. Throws the failure for the
   * caller to show and to offer in the editor's terminal.
   */
  public async push(
    plan: Extract<PushPlan, { ok: true }>,
    operation?: NativeGitOperation,
  ): Promise<void> {
    const guard = this.guard(operation)
    guard.check()
    if (!isPlainRefspec(plan.refspec) || !isPlainRefName(plan.remote)) {
      throw new NativeGitRefusalError('refused')
    }
    const root = await this.rootFor(guard)
    await serialized(root.key, guard.signal, async () => {
      guard.check()
      const fresh = await this.planIn(root, guard, plan.remote)
      if (!fresh.ok || !isSamePlan(fresh, plan)) {
        throw new NativeGitRefusalError('changed')
      }
      await this.admitted(() => this.spawn(nativePushArgs(plan), root, guard, true))
    })
    // The push went out: a Cancel after it never turns it into a failure.
    this.deps.log.info('Pushed through the native service')
  }

  /** A pull request fetch in the user's own Git environment (lane P). */
  public async fetch(remote: string, ref?: string, operation?: NativeGitOperation): Promise<void> {
    const guard = this.guard(operation)
    guard.check()
    const root = await this.rootFor(guard)
    await serialized(root.key, guard.signal, async () => {
      await this.spawn(nativeFetchArgs(remote, ref), root, guard, true)
    })
    guard.check()
  }

  /**
   * A held checkout's worktree (lane P): `name` is one safe segment under
   * the runtime data folder's `pr-worktrees/`, confined before anything
   * runs and again at the spawn. Returns the confined path.
   */
  public async addWorktree(
    name: string,
    commit: string,
    operation?: NativeGitOperation,
  ): Promise<string> {
    const guard = this.guard(operation)
    guard.check()
    if (!WORKTREE_NAME.test(name) || !isPlainRefName(commit)) {
      throw new NativeGitRefusalError('refused')
    }
    const parent = await this.worktreeParent(guard)
    const wtPath = path.join(parent.path, name)
    let isTaken = true
    try {
      await lstatIdentity(wtPath)
    } catch (error: unknown) {
      if (!isMissingPath(error)) {
        throw error
      }
      isTaken = false
    }
    if (isTaken) {
      // Something already sits there: git would refuse it, and a link would lead elsewhere.
      throw new NativeGitRefusalError('changed')
    }
    const root = await this.rootFor(guard)
    const args = nativeWorktreeAddArgs(wtPath, commit)
    await serialized(root.key, guard.signal, async () => {
      await this.spawn(args, root, this.parentHeld(guard, parent), false)
    })
    guard.check()
    return wtPath
  }
}
