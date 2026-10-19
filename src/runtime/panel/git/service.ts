// The runtime Git service (M123 lane G, PLAN.md D104): status, diff,
// commit, push, fetch and worktree checkout through the user's own `git`,
// for every editor outside VS Code (and a VS Code-family host without
// `vscode.git`), behind lane 0's `RuntimeGitDeps`.
//
// Every mutation is one bound pipeline (RVM123G2's redesign):
//
//   plan → the user's confirmation → admission → final revalidation → spawn
//
// - Plan: M71's push plan plus what binds it (every push URL as git
//   resolves it, the branch's commit, the configuration files git read); a
//   commit form's stamp (the index's records and the working tree's bytes).
// - Admission: the repository's transaction lock (a file in git's common
//   directory, shared by every editor and runtime process,
//   `transaction.ts`), then the host's admission (M72's checkpoints).
// - Final revalidation, after those waits: the state git reads is sealed
//   first (HEAD, the index, the refs, the configuration files), then the
//   plan is read again and compared whole with what the user confirmed.
// - Spawn: the runner's `beforeRun`, after its own admission and the
//   Windows job's preparation, and again at the Windows helper's payload
//   authorization (READY/GO), synchronously: the arguments, the operation's
//   signal and owner, trust, the root's identity (not a link), the lock
//   still held and the seal intact. Any change refuses (`changed`).
//
// Around it:
// - The user's `git` (`RuntimeGitDeps.gitPath`, absolute) runs through the
//   bounded runner (`createGitProcess`: output caps, M107 admission,
//   whole-tree stop on Cancel or the window's closing; no deadline of ours),
//   with explicit argument arrays and no shell. Every argument list passes `assertNativeGitArgs`.
// - Environments are allow-lists per operation: reads, commits and
//   worktrees get no credential variable; a confirmed push and a pull
//   request fetch get only GIT_PUSH_CREDENTIAL_VARIABLES, as captured at
//   start, with `GIT_TERMINAL_PROMPT=0`. Never a model or provider key.
// - Hooks and signing run as the user configured them; nothing is ever
//   force-pushed.
// - The root is bound when the service is made (canonical path and
//   directory identity, sampled synchronously at construction) and
//   rechecked at every operation and every spawn; working-tree reads are
//   confined by identity (`confinedFiles.ts`).
// - Threat boundary (D104): untrusted repository content, stale state,
//   cancellation, owner changes and secrets are enforced. A same-user
//   process swapping directories between a check and the OS acting on a
//   path is not defeated (path-based APIs cannot close that race); every
//   change a guard detects still refuses.
// - Nothing secret is logged, thrown in clear, or shown: failures carry
//   git's words to the caller, which redacts them before any cut.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
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
import { withoutCredentials } from '../../../core/credentialEnvironment'
import { isWorkspacePath } from '../../../core/executables'
import { isStoreErrorCode } from '../../../host/backend/storeErrors'
import { canonicalPath, isMissingPath } from '../../../host/canonicalPath'
import { createGitProcess, quietGitEnvironment, type GitProcess } from '../../../host/git'
import {
  commitMessageProblem,
  nativeCommitArgs,
  nativeStageAllArgs,
  type CommitMessageProblem,
} from '../../../core/git/commit'
import {
  isRangeSafeRefName,
  nativeBranchFilesArgs,
  nativeBranchLogArgs,
  nativeDiffArgs,
  readNativeDiff,
  remoteBaseRef,
  type TruncatedDiff,
} from '../../../core/git/diff'
import {
  isPlainRefName,
  isPlainRefspec,
  planPush,
  type PushPlan,
  type RemoteFacts,
} from '../../../core/git/pushPlan'
import {
  configOriginsArgs,
  isReadableRemoteName,
  nativeRemoteNamesArgs,
  nativeStatusArgs,
  readConfigFiles,
  readNativeStatus,
  readPushUrls,
  readStatusSnapshot,
  remotePushUrlsArgs,
  toPushHead,
  type NativeGitContext,
  type NativeStatusSnapshot,
} from '../../../core/git/status'
import { newFileDiff } from '../../../core/git/gitText'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import {
  GIT_PUSH_CREDENTIAL_VARIABLES,
  PULL_REQUEST_WORKTREES_DIR,
} from '../../../shared/constants'
import {
  ConfinementError,
  fingerprintConfined,
  readConfinedStart,
  type ConfinedRoot,
} from './confinedFiles'
import {
  acquireRepositoryLock,
  isSealIntact,
  sealOf,
  type RepositoryLock,
  type StateSeal,
} from './transaction'

/** The subcommands the service runs; anything else is refused. */
const NATIVE_GIT_SUBCOMMANDS = [
  'status',
  'diff',
  'log',
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

/** Where the root, its git directory and the shared (common) one are. */
const REV_PARSE_ARGS = ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir']
/** One line for each of those three. */
const REV_PARSE_LINES = 3

/** A worktree name: one path segment, never an option or a traversal. */
const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/
/** `worktree add` takes its flags, the path and the commit: nothing else. */
const WORKTREE_ADD_ARGUMENTS = 5
const ALREADY_EXISTS = 'EEXIST'
/** `HEAD` naming a branch, as git writes it (gitrepository-layout(5)). */
const SYMBOLIC_HEAD = /^ref: refs\/heads\/(.+)$/

function haveSameArgs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((arg, index) => arg === right[index])
}

/** The `config` reads the service makes: a signing key, a readable remote's URL, or the origins. */
function isAllowedConfigRead(rest: readonly string[]): boolean {
  if (haveSameArgs(['config', ...rest], configOriginsArgs())) {
    return true
  }
  const [flag, key] = rest
  const remoteKey = /^remote\.(.+)\.(url|pushurl)$/.exec(key ?? '')
  const isSigning = (SIGNING_CONFIG_KEYS as readonly string[]).includes(key ?? '')
  return (
    flag === '--get' &&
    rest.length === 2 &&
    (isSigning || (remoteKey !== null && isReadableRemoteName(remoteKey[1] ?? '')))
  )
}

/** A pull request base as `refs/remotes/<remote>/<base>`, range-safe in every segment. */
function isRemoteBaseRef(ref: string | undefined): boolean {
  const prefix = remoteBaseRef('', '').slice(0, -1)
  const name = ref?.startsWith(prefix) === true ? ref.slice(prefix.length) : ''
  return name.includes('/') && isRangeSafeRefName(name)
}

/** The fixed flags before a branch read's names: every argument but the last one (log) or two (diff). */
const BRANCH_LOG_NAMES = 1
const BRANCH_FILES_NAMES = 2

/** The draft prompt's reads of a pull request's branch: its commit subjects, or its changed files. */
function isAllowedBranchRead(args: readonly string[]): boolean {
  const range = '..HEAD'
  const last = args.at(-1) ?? ''
  if (args[0] === 'log') {
    const base = last.endsWith(range) ? last.slice(0, -range.length) : undefined
    return (
      isRemoteBaseRef(base) &&
      haveSameArgs(
        args.slice(0, -BRANCH_LOG_NAMES),
        nativeBranchLogArgs('r', 'b').slice(0, -BRANCH_LOG_NAMES),
      )
    )
  }
  return (
    last === 'HEAD' &&
    isRemoteBaseRef(args.at(-BRANCH_FILES_NAMES)) &&
    haveSameArgs(
      args.slice(0, -BRANCH_FILES_NAMES),
      nativeBranchFilesArgs('r', 'b').slice(0, -BRANCH_FILES_NAMES),
    )
  )
}

/** `remote`, or `remote get-url --push --all <plain name>`. */
function isAllowedRemoteRead(args: readonly string[]): boolean {
  if (haveSameArgs(args, nativeRemoteNamesArgs())) {
    return true
  }
  const name = args.at(-1) ?? ''
  return isPlainRefName(name) && haveSameArgs(args, remotePushUrlsArgs(name))
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
      if (!isAllowedRemoteRead(args)) {
        throw new Error('Refused git remote arguments')
      }
      break
    }
    case 'diff': {
      if (
        !haveSameArgs(args, nativeDiffArgs(true)) &&
        !haveSameArgs(args, nativeDiffArgs(false)) &&
        !isAllowedBranchRead(args)
      ) {
        throw new Error('Refused git diff arguments')
      }
      break
    }
    case 'log': {
      if (!isAllowedBranchRead(args)) {
        throw new Error('Refused git log arguments')
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
      if (!haveSameArgs(args, REV_PARSE_ARGS)) {
        throw new Error('Refused git rev-parse arguments')
      }
      break
    }
    case 'config': {
      if (!isAllowedConfigRead(rest)) {
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

/**
 * A confirmed push's or a pull request fetch's environment (D104's named
 * exception): the user's, without any credential variable but the Git
 * routes GIT_PUSH_CREDENTIAL_VARIABLES names, and never a prompt.
 */
export function nativePushEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...withoutCredentials(env, GIT_PUSH_CREDENTIAL_VARIABLES), GIT_TERMINAL_PROMPT: '0' }
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
/**
 * The git the host resolved (`RuntimeGitDeps.gitPath`) as createGitProcess's
 * locator: used only when absolute, so a relative name never runs a
 * workspace's own `git` (D24); undefined otherwise, so the run fails as git
 * missing.
 */
export function fixedGitLocator(
  platform: NodeJS.Platform,
  executable: string,
  workspace?: {
    readonly workspaceRoot: string
    readonly realpath?: (filePath: string) => string
  },
): () => string | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix
  return () =>
    !p.isAbsolute(executable) ||
    (workspace !== undefined && isWorkspacePath(platform, workspace, executable))
      ? undefined
      : executable
}

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
 * `changed` a moved repository, root, plan or form; `untrusted` a lost
 * trust; `refused` an argument git must not see.
 */
export type NativeGitRefusal = 'untrusted' | 'changed' | 'refused' | 'closed'

/** A refusal: nothing ran past the check that threw it. */
export class NativeGitRefusalError extends Error {
  public constructor(
    public readonly reason: NativeGitRefusal,
    options?: { cause?: unknown },
  ) {
    super(reason, options)
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

/** The root as verified for an operation: the bound directory, and git's directories for it. */
interface BoundRepository extends ConfinedRoot {
  /** This worktree's git directory: HEAD and the index. */
  readonly gitDir: string
  /** The shared git directory: configuration, refs and the transaction lock. */
  readonly commonDir: string
}

/** A mutation's hold: the verified repository, the operation, and the lock. */
interface Held {
  readonly repo: BoundRepository
  readonly guard: Guard
  readonly lock: RepositoryLock
}

/** A commit form's facts and its stamp. */
export interface StampedStatus {
  readonly snapshot: NativeStatusSnapshot
  readonly remotes: RemoteFacts[]
  readonly stamp: string
}

/**
 * A push the user confirms: M71's plan plus what binds it (RVM123G2 R2).
 * The final revalidation compares all of it with a fresh plan.
 */
export type NativePushPlan = Extract<PushPlan, { ok: true }> & {
  /** Every URL the push goes to, as git resolves it (rewrites applied); what the confirmation shows. */
  readonly pushUrls: readonly string[]
  /** The branch's commit: the commits that go end here. */
  readonly headOid: string | undefined
  /** The configuration files git read for it: sealed until the push starts. */
  readonly configFiles: readonly string[]
}

/** A plan to confirm, or M71's refusal. */
export type NativePushPlanResult = NativePushPlan | Extract<PushPlan, { ok: false }>

/** `/` separators for comparing paths on every platform (CI runs on Windows). */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/').replace(/\/+$/, '')
}

/**
 * A store error that leaves a path unreadable: missing, denied or
 * unresolvable. Anything else (a bug above the store) is not a probe's
 * answer to give.
 */
export function isUnreadableStoreError(error: unknown): boolean {
  return (
    isMissingPath(error) ||
    isStoreErrorCode(error, 'EACCES') ||
    isStoreErrorCode(error, 'EPERM') ||
    isStoreErrorCode(error, 'ELOOP') ||
    isStoreErrorCode(error, 'EISDIR')
  )
}

/** The approved directory's identity now, synchronously; undefined when it cannot be read. */
function identityAtConstruction(root: string): FileIdentity | undefined {
  try {
    return identityOf(statIdentitySync(root))
  } catch (error: unknown) {
    // Unreadable now: the service is not bound, and every operation refuses.
    if (!isUnreadableStoreError(error)) throw error
    return undefined
  }
}

/**
 * The root as approved: its canonical path and its directory identity,
 * which must be the identity sampled synchronously when the service was
 * made (RVM123G2 R6: a replacement after construction never binds), or
 * undefined (every operation then refuses).
 */
async function bindRoot(
  root: string,
  approved: FileIdentity | undefined,
): Promise<ConfinedRoot | undefined> {
  if (approved === undefined) {
    return undefined
  }
  try {
    const canonical = await canonicalPath(root)
    const stats = await statIdentity(canonical)
    return fileIdentityKey(stats) !== undefined &&
      stats.isDirectory() &&
      sameFile(identityOf(stats), approved)
      ? { path: canonical, identity: approved }
      : undefined
  } catch (error: unknown) {
    // Swept or revoked between construction and the bind: not bound.
    if (!isUnreadableStoreError(error)) throw error
    return undefined
  }
}

function isSamePlan(left: NativePushPlan, right: NativePushPlan): boolean {
  return (
    left.remote === right.remote &&
    left.remoteUrl === right.remoteUrl &&
    left.branch === right.branch &&
    left.target === right.target &&
    left.refspec === right.refspec &&
    left.setUpstream === right.setUpstream &&
    left.commits === right.commits &&
    left.headOid === right.headOid &&
    haveSameArgs(left.pushUrls, right.pushUrls) &&
    haveSameArgs(left.configFiles, right.configFiles)
  )
}

/** A ref's loose file under the shared git directory (`refs/heads/x/y` → its path). */
function refFile(commonDir: string, ...ref: readonly string[]): string {
  return path.join(commonDir, 'refs', ...ref.flatMap((part) => part.split('/')))
}

/** The branch HEAD names now (read synchronously from its file), or undefined (detached). */
function headBranch(gitDir: string): string | undefined {
  try {
    return SYMBOLIC_HEAD.exec(readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim())?.[1]
  } catch (error: unknown) {
    // No HEAD to read (a linked worktree keeps it elsewhere): detached.
    if (!isUnreadableStoreError(error)) throw error
    return undefined
  }
}

/**
 * What the service reads of the host's deps: the bound root and its git,
 * the window's signal and trust, the push's environment, the host's
 * admission, the data folder for held checkouts, and the log.
 */
export type NativeGitServiceDeps = Pick<
  RuntimeGitDeps,
  | 'repositoryRoot'
  | 'gitPath'
  | 'signal'
  | 'isTrusted'
  | 'userEnvironment'
  | 'admitWorkspaceCommand'
  | 'dataFolder'
  | 'log'
>

export interface NativeGitServiceOptions {
  /** The bounded runner; the production `createGitProcess` wiring unless a test passes its own. */
  readonly run?: GitProcess | undefined
}

/** The bound root's identity now, or `changed` when it cannot be read. */
async function identityNow(target: string): Promise<FileIdentity> {
  try {
    return identityOf(await statIdentity(target))
  } catch (error: unknown) {
    // Unreadable now: the bound directory changed out from under the call.
    if (!isUnreadableStoreError(error)) throw error
    throw new NativeGitRefusalError('changed', { cause: error })
  }
}

/** Throws `changed` unless `isSame`. */
function expectSame(isSame: boolean): void {
  if (!isSame) {
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
  private readonly bound: Promise<ConfinedRoot | undefined>

  public constructor(
    private readonly deps: NativeGitServiceDeps,
    options: NativeGitServiceOptions = {},
  ) {
    this.run =
      options.run ??
      createGitProcess({
        platform: process.platform,
        env: process.env,
        fileExists: existsSync,
        realpath: realpathSync,
        spawn,
        // The git the host resolved, never another one on PATH; refused
        // when it names the bound repository itself.
        locate: fixedGitLocator(process.platform, deps.gitPath, {
          workspaceRoot: deps.repositoryRoot,
          realpath: realpathSync,
        }),
      })
    // The directory approved now is the one every later operation must
    // find: its identity is taken in this same tick.
    this.bound = bindRoot(deps.repositoryRoot, identityAtConstruction(deps.repositoryRoot))
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

  /**
   * The spawn's last line (the runner's `beforeRun`, and the Windows
   * helper's payload authorization): synchronous, after every wait.
   */
  private atSpawn(
    args: readonly string[],
    root: ConfinedRoot,
    guard: Guard,
    held: (() => void) | undefined,
  ): () => void {
    return () => {
      assertNativeGitArgs(args)
      guard.check()
      let isRoot: boolean
      try {
        // The bound path is still a real directory (never a link or
        // junction, even to the same one), and the same directory.
        const entry = lstatIdentitySync(root.path)
        isRoot =
          !entry.isSymbolicLink() &&
          entry.isDirectory() &&
          sameFile(identityOf(statIdentitySync(root.path)), root.identity)
      } catch {
        isRoot = false
      }
      expectSame(isRoot)
      held?.()
    }
  }

  private async runGit(
    args: readonly string[],
    root: ConfinedRoot,
    guard: Guard,
    isUserEnvironment: boolean,
    held?: () => void,
  ): Promise<Buffer> {
    assertNativeGitArgs(args)
    guard.check()
    try {
      return await this.run(args, {
        cwd: root.path,
        env: isUserEnvironment
          ? nativePushEnvironment(this.deps.userEnvironment())
          : quietGitEnvironment(process.env),
        // No deadline of ours: a push, a fetch or a commit's hooks take what
        // they take, as in VS Code's own Git; Cancel and the window stop it.
        timeoutMs: undefined,
        signal: guard.signal,
        beforeRun: this.atSpawn(args, root, guard, held),
        ...(isUserEnvironment && { credentialRoutes: GIT_PUSH_CREDENTIAL_VARIABLES }),
      })
    } catch (error: unknown) {
      if (error instanceof NativeGitRefusalError) {
        throw error
      }
      if (guard.signal.aborted) {
        // Cancel or the window stopped it: never reported as git's failure.
        throw new NativeGitRefusalError('closed', { cause: error })
      }
      // Fixed words only: git's own text (paths, remotes, accounts) goes to
      // the caller, which redacts it before any cut.
      const [subcommand] = args
      this.deps.log.warn(`git ${subcommand ?? 'unknown'} failed`)
      throw error
    }
  }

  /** The quiet runner over the bound root, for the core readers. */
  private reader(root: ConfinedRoot, guard: Guard): GitProcess {
    return (args) => this.runGit(args, root, guard, false)
  }

  private context(root: ConfinedRoot, guard: Guard): NativeGitContext {
    return { cwd: root.path, env: {}, signal: guard.signal }
  }

  private async rootFor(guard: Guard): Promise<BoundRepository> {
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
    } catch (error: unknown) {
      // Unresolvable now: the bound directory changed out from under the call.
      if (!isUnreadableStoreError(error)) throw error
      throw new NativeGitRefusalError('changed', { cause: error })
    }
    const identity = await identityNow(current)
    guard.check()
    expectSame(slashed(current) === slashed(root.path) && sameFile(identity, root.identity))
    // git's own toplevel is that same directory, by identity.
    const directories = await this.runGit(REV_PARSE_ARGS, root, guard, false)
    const [toplevel = '', gitDir = '', commonDir = ''] = directories
      .toString('utf8')
      .split(/\r?\n/, REV_PARSE_LINES)
    const reached = await identityNow(toplevel)
    guard.check()
    expectSame(sameFile(reached, root.identity) && gitDir !== '' && commonDir !== '')
    return { ...root, gitDir, commonDir: path.resolve(root.path, commonDir) }
  }

  /**
   * The files a payload's git reads, for the seal: HEAD and the index of
   * this worktree, the branch HEAD names, packed and loose refs, the
   * reftable list, the repository's configuration, and `extra` (a push's
   * refs and every configuration file git named).
   */
  private sealNow(repo: BoundRepository, extra: readonly string[] = []): StateSeal {
    const branch = headBranch(repo.gitDir)
    return sealOf([
      path.join(repo.gitDir, 'HEAD'),
      path.join(repo.gitDir, 'index'),
      path.join(repo.gitDir, 'config.worktree'),
      path.join(repo.commonDir, 'config'),
      path.join(repo.commonDir, 'packed-refs'),
      path.join(repo.commonDir, 'reftable', 'tables.list'),
      ...(branch === undefined ? [] : [refFile(repo.commonDir, 'heads', branch)]),
      ...extra,
    ])
  }

  /** The payload's last check, at the spawn: the lock still this transaction's, the seal intact. */
  private stillSealed(held: Held, seal: StateSeal): () => void {
    return () => {
      expectSame(held.lock.isHeldSync() && isSealIntact(seal))
    }
  }

  /**
   * One transaction: the repository's lock (waiting while any editor or
   * runtime process holds it), then the host's admission, then `work`,
   * which revalidates after both. The lock goes whatever happens.
   */
  private async transaction<T>(
    repo: BoundRepository,
    guard: Guard,
    work: (held: Held) => Promise<T>,
  ): Promise<T> {
    const lock = await acquireRepositoryLock(repo.commonDir, guard.signal, guard.check)
    try {
      guard.check()
      const admit = this.deps.admitWorkspaceCommand
      const start = (): Promise<T> => work({ repo, guard, lock })
      return admit === undefined ? await start() : await admit(start)
    } finally {
      await lock.release()
    }
  }

  private async stamped(
    root: ConfinedRoot,
    guard: Guard,
  ): Promise<StampedStatus & { readonly worktree: string }> {
    const { snapshot, remotes } = await readNativeStatus(
      this.reader(root, guard),
      this.context(root, guard),
    )
    guard.check()
    const worktree = await this.worktreeOf(root, guard, snapshot)
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
    return { snapshot, remotes, stamp, worktree }
  }

  /** The digest of the working tree's bytes behind the snapshot's unstaged and new files. */
  private async worktreeOf(
    root: ConfinedRoot,
    guard: Guard,
    snapshot: NativeStatusSnapshot,
  ): Promise<string> {
    const digest = await fingerprintConfined(
      root,
      [...snapshot.unstaged, ...snapshot.untracked],
      guard.check,
    )
    guard.check()
    return digest
  }

  private async planIn(
    repo: BoundRepository,
    guard: Guard,
    chosenRemote?: string,
  ): Promise<NativePushPlanResult> {
    const run = this.reader(repo, guard)
    const context = this.context(repo, guard)
    const { snapshot, remotes } = await readNativeStatus(run, context)
    guard.check()
    const head = toPushHead(snapshot, remotes)
    const plan = head.ok
      ? planPush(head.head, remotes, chosenRemote)
      : ({ ok: false, refusal: 'noRemote' } as const)
    if (!plan.ok) {
      return plan
    }
    const [pushUrls, configFiles] = await Promise.all([
      readPushUrls(run, context, plan.remote),
      readConfigFiles(run, context),
    ])
    guard.check()
    return { ...plan, pushUrls, headOid: snapshot.headOid, configFiles }
  }

  /** The plan as confirmed, read again now: anything else is `changed`. */
  private async replanned(
    repo: BoundRepository,
    guard: Guard,
    plan: NativePushPlan,
  ): Promise<void> {
    const fresh = await this.planIn(repo, guard, plan.remote)
    expectSame(fresh.ok && isSamePlan(fresh, plan))
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
      // Made since the last call: the held parent is already there.
      if (!isStoreErrorCode(error, ALREADY_EXISTS)) throw error
    }
    guard.check()
    const held = await lstatIdentity(parent)
    const resolved = await canonicalPath(parent)
    const reached = await identityNow(resolved)
    guard.check()
    expectSame(
      !held.isSymbolicLink() &&
        held.isDirectory() &&
        slashed(resolved) === slashed(parent) &&
        sameFile(reached, identityOf(held)),
    )
    return { path: parent, identity: identityOf(held) }
  }

  /** The storage parent is still the real directory confined before (synchronous). */
  private parentHeld(parent: ConfinedRoot): void {
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
    expectSame(isHeld)
  }

  /**
   * The form as confirmed, revalidated after every wait: the state sealed
   * first, then the stamp read again and compared (or taken as it is when
   * the caller confirmed none).
   */
  private async confirmedForm(
    held: Held,
    expectedStamp: string | undefined,
  ): Promise<{
    readonly snapshot: NativeStatusSnapshot
    readonly worktree: string
    readonly seal: StateSeal
  }> {
    const seal = this.sealNow(held.repo)
    const { snapshot, stamp, worktree } = await this.stamped(held.repo, held.guard)
    expectSame(expectedStamp === undefined || stamp === expectedStamp)
    return { snapshot, worktree, seal }
  }

  /**
   * After `add -A`: exactly the confirmed changes are staged, with the
   * confirmed bytes (sealed first, then read): nothing else staged, the
   * same HEAD, the files the form showed still holding those bytes, and
   * nothing left unstaged or new (a submodule's own content excepted), so
   * the index holds them. Otherwise `changed`: the staging stays, and
   * nothing is committed.
   */
  private async stagedAsConfirmed(
    held: Held,
    before: NativeStatusSnapshot,
    confirmedWorktree: string,
  ): Promise<StateSeal> {
    const { repo, guard } = held
    const seal = this.sealNow(repo)
    const after = await readStatusSnapshot(this.reader(repo, guard), this.context(repo, guard))
    guard.check()
    const worktree = await this.worktreeOf(repo, guard, before)
    const shown = new Set([...before.staged, ...before.unstaged, ...before.untracked])
    expectSame(
      worktree === confirmedWorktree &&
        after.headOid === before.headOid &&
        after.branch === before.branch &&
        after.untracked.length === 0 &&
        after.unstaged.every((file) => after.submodules.includes(file)) &&
        after.staged.every((file) => shown.has(file)),
    )
    return seal
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

  /** The root as bound, unverified: only where a link is keyed, never where anything runs. */
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
   * The commit form's facts and its stamp: what the commit revalidates,
   * after the lock and the admission, before staging anything.
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
        // unreadable file (missing, permissions) only stays out of it, and
        // any other read failure is not this prompt's answer to give.
        if (refusalOf(error) !== undefined) {
          throw error
        }
        if (!isUnreadableStoreError(error)) throw error
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
   * Commits `message`: validates it, then in one transaction revalidates
   * the form against `expectedStamp` (the status records with the index's
   * object names, and the working tree's bytes), stages everything for an
   * unstaged commit and checks that what got staged is what was shown, and
   * runs the user's hooks and signer. The caller's press is the confirmation.
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
    const repo = await this.rootFor(guard)
    return await this.transaction(repo, guard, async (held) => {
      const { snapshot, worktree, seal } = await this.confirmedForm(held, expectedStamp)
      if (!isUnstagedIncluded && snapshot.staged.length === 0) {
        throw new CommitRefusedError('nothingStaged', trimmed)
      }
      if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length === 0) {
        throw new CommitRefusedError('nothingToCommit', trimmed)
      }
      let commitSeal = seal
      if (isUnstagedIncluded) {
        await this.runGit(nativeStageAllArgs(), repo, guard, false, this.stillSealed(held, seal))
        commitSeal = await this.stagedAsConfirmed(held, snapshot, worktree)
      }
      await this.runGit(
        nativeCommitArgs(trimmed),
        repo,
        guard,
        false,
        this.stillSealed(held, commitSeal),
      )
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
  public async planPush(
    chosenRemote?: string,
    operation?: NativeGitOperation,
  ): Promise<NativePushPlanResult> {
    const guard = this.guard(operation)
    const repo = await this.rootFor(guard)
    return await this.planIn(repo, guard, chosenRemote)
  }

  /**
   * Pushes exactly `plan`, the one the user confirmed: in one transaction,
   * the push's state sealed, the plan read again and compared whole, and
   * the seal and lock checked at the last line before git (never a force
   * mode, in the user's own Git environment). Throws the failure for the
   * caller to show and to offer in the editor's terminal.
   */
  public async push(plan: NativePushPlan, operation?: NativeGitOperation): Promise<void> {
    const guard = this.guard(operation)
    guard.check()
    if (!isPlainRefspec(plan.refspec) || !isPlainRefName(plan.remote)) {
      throw new NativeGitRefusalError('refused')
    }
    const repo = await this.rootFor(guard)
    await this.transaction(repo, guard, async (held) => {
      const seal = this.sealNow(repo, [
        refFile(repo.commonDir, 'heads', plan.branch),
        refFile(repo.commonDir, 'remotes', plan.remote, plan.target),
        ...plan.configFiles,
      ])
      await this.replanned(repo, guard, plan)
      await this.runGit(nativePushArgs(plan), repo, guard, true, this.stillSealed(held, seal))
    })
    // The push went out: a Cancel after it never turns it into a failure.
    this.deps.log.info('Pushed through the native service')
  }

  /**
   * The bound root for finishing a failed push in the editor's terminal
   * (RVM123G2 R5): the same directory, git's own toplevel, and the push
   * plan still exactly the one confirmed. Otherwise `changed`.
   */
  public async confirmedPushRoot(
    plan: NativePushPlan,
    operation?: NativeGitOperation,
  ): Promise<string> {
    const guard = this.guard(operation)
    const repo = await this.rootFor(guard)
    await this.replanned(repo, guard, plan)
    return repo.path
  }

  /**
   * What a pull request's draft prompt names (M71's `pullRequestPrompt`):
   * the subjects of the branch's commits since `remote/base` (at most
   * GIT_PROMPT_COMMITS_MAX) and the files it changed. When git has no
   * `remote/base` yet, the base is fetched first, in the user's Git
   * environment and through the repository's transaction, as M71 does.
   */
  public async branchSince(
    remote: string,
    base: string,
    operation?: NativeGitOperation,
  ): Promise<{ readonly subjects: readonly string[]; readonly files: readonly string[] }> {
    if (!isPlainRefName(remote) || !isRangeSafeRefName(base)) {
      throw new NativeGitRefusalError('refused')
    }
    const guard = this.guard(operation)
    const root = await this.rootFor(guard)
    let log: Buffer
    try {
      log = await this.runGit(nativeBranchLogArgs(remote, base), root, guard, false)
    } catch (error: unknown) {
      if (refusalOf(error) !== undefined) {
        throw error
      }
      await this.fetch(remote, base, operation)
      log = await this.runGit(nativeBranchLogArgs(remote, base), root, guard, false)
    }
    const files = await this.runGit(nativeBranchFilesArgs(remote, base), root, guard, false)
    guard.check()
    return {
      subjects: log
        .toString('utf8')
        .split(/\r?\n/)
        .filter((line) => line !== ''),
      files: files
        .toString('utf8')
        .split('\0')
        .filter((file) => file !== ''),
    }
  }

  /** A pull request fetch in the user's own Git environment (lane P), in one transaction. */
  public async fetch(remote: string, ref?: string, operation?: NativeGitOperation): Promise<void> {
    const guard = this.guard(operation)
    guard.check()
    const repo = await this.rootFor(guard)
    await this.transaction(repo, guard, async (held) => {
      const seal = this.sealNow(repo)
      await this.runGit(
        nativeFetchArgs(remote, ref),
        repo,
        guard,
        true,
        this.stillSealed(held, seal),
      )
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
    // Something already sits there: git would refuse it, and a link would lead elsewhere.
    expectSame(!isTaken)
    const repo = await this.rootFor(guard)
    const args = nativeWorktreeAddArgs(wtPath, commit)
    await this.transaction(repo, guard, async (held) => {
      const seal = this.sealNow(repo)
      const stillSealed = this.stillSealed(held, seal)
      await this.runGit(args, repo, guard, false, () => {
        this.parentHeld(parent)
        stillSealed()
      })
    })
    guard.check()
    return wtPath
  }
}
