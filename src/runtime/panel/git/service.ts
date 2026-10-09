// The runtime Git service (M123 lane G, PLAN.md D104): status, diff,
// commit, push, fetch and worktree checkout through the user's own `git`,
// for every editor outside VS Code (and a VS Code-family host without
// `vscode.git`), behind lane 0's `RuntimeGitDeps`.
//
// - The user's `git` runs by absolute path through the existing bounded
//   runner (`createGitProcess`, D24 resolution, output caps, deadlines,
//   whole-tree stop), with explicit argument arrays and no shell. Every
//   argument list passes `assertNativeGitArgs` (a fixed allowlist: the
//   subcommand and every flag are fixed, and any name git would resolve
//   — a remote, a refspec, a ref — is refused unless plain, so `+`, `-`,
//   `:` and whitespace cannot change what goes out). The one value git
//   receives is the commit message, as a single `-m` value.
// - Reads keep the quiet environment (no credentials, no prompt). A
//   confirmed push and a pull request fetch are D104's named exception:
//   the user's own environment (credential helpers, SSH agent, token
//   variables, as a terminal would) with `GIT_TERMINAL_PROMPT=0`, and
//   nothing of ours: no `http.extraHeader`, no credential helper of ours,
//   no token variable.
// - Hooks and signing run as the user configured them (no `--no-verify`,
//   no `--no-gpg-sign`); nothing is ever force-pushed.
// - Paths stay in the workspace: the root is resolved (links and
//   junctions seen through) and every write path confined under it; a
//   worktree for someone else's pull request goes under the runtime data
//   folder's `pr-worktrees/` (lane P's checkout builds on `addWorktree`).
// - Trust, owner and lifetime are rechecked after every await: the
//   editor's trust, the conversation's session, and the window's signal.
// - Nothing secret is logged, thrown in clear, or shown: failures carry
//   git's words to the caller, which redacts and caps them for the panel.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { canonicalPath } from '../../../host/canonicalPath'
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
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import { GIT_TIMEOUT_MS, PULL_REQUEST_WORKTREES_DIR } from '../../../shared/constants'

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

/** The same command in the editor's terminal, for finishing a failed push there. */
export function nativePushTerminalCommand(
  plan: Extract<PushPlan, { ok: true }>,
): readonly string[] {
  return ['git', ...nativePushArgs(plan)]
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
 * aborted window or owner; `changed` a moved repository or form;
 * `untrusted` a lost trust; `refused` an argument git must not see.
 */
export type NativeGitRefusal = 'untrusted' | 'changed' | 'refused' | 'closed'

export function refusalOf(error: unknown): NativeGitRefusal | undefined {
  if (error instanceof CommitRefusedError) {
    return undefined
  }
  if (error instanceof Error) {
    const reason = error.message
    switch (reason) {
      case 'untrusted':
      case 'changed':
      case 'refused': {
        return reason
      }
      default: {
        break
      }
    }
    if (error.name === 'AbortError') {
      return 'closed'
    }
  }
  return undefined
}

/** The form's stamp: what the commit rechecks before staging anything. */
export function statusStamp(snapshot: NativeStatusSnapshot): string {
  return JSON.stringify({
    oid: snapshot.headOid,
    branch: snapshot.branch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    staged: snapshot.staged,
    unstaged: snapshot.unstaged,
    untracked: snapshot.untracked,
  })
}

/** `/` separators for comparing paths on every platform (CI runs on Windows). */
function slashed(folder: string): string {
  return folder.replaceAll('\\', '/').replace(/\/+$/, '')
}

export interface NativeGitServiceOptions {
  /** The bounded runner; the production `createGitProcess` wiring unless a test passes its own. */
  readonly run?: GitProcess | undefined
}

/**
 * Git behind lane 0's `RuntimeGitDeps`, for lanes P and U, the ACP agent
 * and `exec` to build on. Every method rechecks the signal and the
 * editor's trust after every await, runs confined to the resolved root,
 * and asserts the argument allowlist at the last line before git.
 */
export class NativeGitService {
  private readonly run: GitProcess

  /** Reads through the quiet environment; the context names the confined root. */
  private readonly quietRun: GitProcess = (args, options) =>
    this.spawn(
      args,
      {
        cwd: options.cwd,
        env: quietGitEnvironment(process.env),
        signal: this.deps.signal,
      },
      false,
    )

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
      })
  }

  private checkEntry(): void {
    this.deps.signal.throwIfAborted()
    if (!this.deps.isTrusted()) {
      throw new Error('untrusted')
    }
  }

  private quiet(cwd: string): NativeGitContext {
    return {
      cwd,
      env: quietGitEnvironment(process.env),
      signal: this.deps.signal,
    }
  }

  private user(cwd: string): NativeGitContext {
    return {
      cwd,
      env: nativePushEnvironment(process.env),
      signal: this.deps.signal,
    }
  }

  private async spawn(
    args: readonly string[],
    context: NativeGitContext,
    isUserEnvironment: boolean,
  ): Promise<Buffer> {
    assertNativeGitArgs(args)
    this.checkEntry()
    try {
      return await this.run(args, {
        cwd: context.cwd,
        env: context.env,
        timeoutMs: GIT_TIMEOUT_MS,
        signal: this.deps.signal,
        ...(isUserEnvironment && { isUserEnvironment: true }),
      })
    } catch (error: unknown) {
      // Fixed words only: git's own text (paths, remotes, accounts) goes to
      // the caller, which redacts and caps it for the panel.
      const [subcommand] = args
      this.deps.log.warn(`git ${subcommand ?? 'unknown'} failed`)
      throw error
    }
  }

  private quietSpawn(args: readonly string[], cwd: string): Promise<Buffer> {
    return this.spawn(args, this.quiet(cwd), false)
  }

  private userSpawn(args: readonly string[], cwd: string): Promise<Buffer> {
    return this.spawn(args, this.user(cwd), true)
  }

  /**
   * The confined repository root: resolved through links and junctions,
   * and verified against git's own toplevel, so a replaced or moved
   * repository is refused rather than written through.
   */
  public async resolveRoot(): Promise<string> {
    this.checkEntry()
    const cwd = await canonicalPath(this.deps.repositoryRoot)
    this.checkEntry()
    const toplevelBytes = await this.quietSpawn(['rev-parse', '--show-toplevel'], cwd)
    const toplevel = toplevelBytes.toString('utf8').trim()
    this.checkEntry()
    const canonicalTop = await canonicalPath(toplevel)
    this.checkEntry()
    const isSameRoot =
      process.platform === 'win32'
        ? slashed(canonicalTop).toLowerCase() === slashed(cwd).toLowerCase()
        : slashed(canonicalTop) === slashed(cwd)
    if (!isSameRoot) {
      throw new Error('changed')
    }
    return cwd
  }

  /** The status snapshot and the remotes git knows, in the quiet environment. */
  public async status(): Promise<{
    readonly snapshot: NativeStatusSnapshot
    readonly remotes: RemoteFacts[]
  }> {
    const cwd = await this.resolveRoot()
    const { snapshot, remotes } = await readNativeStatus(this.quietRun, this.quiet(cwd))
    this.checkEntry()
    return { snapshot, remotes }
  }

  /** The staged or unstaged diff, bounded and binary-safe. */
  public async diff(isStaged: boolean, maxBytes: number): Promise<TruncatedDiff> {
    const cwd = await this.resolveRoot()
    const truncated = await readNativeDiff(this.quietRun, this.quiet(cwd), isStaged, maxBytes)
    this.checkEntry()
    return truncated
  }

  /**
   * Commits `message`: validates it, rechecks the repository against
   * `expectedStamp` (the form's), stages everything for an unstaged
   * commit, and runs the user's hooks and signer. The caller's press is
   * the confirmation (lane U's form shows the message and the files, as
   * the VS Code confirm modal does there).
   */
  public async commit(
    message: string,
    isUnstagedIncluded: boolean,
    expectedStamp?: string,
  ): Promise<{ readonly branch: string; readonly subject: string }> {
    const trimmed = message.trim()
    const problem = commitMessageProblem(message)
    if (problem !== undefined) {
      throw new CommitRefusedError(problem, trimmed)
    }
    const cwd = await this.resolveRoot()
    const { snapshot } = await readNativeStatus(this.quietRun, this.quiet(cwd))
    this.checkEntry()
    if (expectedStamp !== undefined && statusStamp(snapshot) !== expectedStamp) {
      throw new Error('changed')
    }
    if (!isUnstagedIncluded && snapshot.staged.length === 0) {
      throw new CommitRefusedError('nothingStaged', trimmed)
    }
    if (snapshot.staged.length + snapshot.unstaged.length + snapshot.untracked.length === 0) {
      throw new CommitRefusedError('nothingToCommit', trimmed)
    }
    if (isUnstagedIncluded) {
      await this.quietSpawn(nativeStageAllArgs(), cwd)
      this.checkEntry()
    }
    await this.quietSpawn(nativeCommitArgs(trimmed), cwd)
    this.checkEntry()
    const fresh = await readNativeStatus(this.quietRun, this.quiet(cwd))
    this.checkEntry()
    return {
      branch: fresh.snapshot.branch ?? 'HEAD',
      subject: trimmed.split(/\r?\n/, 1)[0] ?? trimmed,
    }
  }

  /** The push for the current branch, or why M71's push plan refuses it. */
  public async planPush(): Promise<PushPlan> {
    const cwd = await this.resolveRoot()
    const { snapshot, remotes } = await readNativeStatus(this.quietRun, this.quiet(cwd))
    this.checkEntry()
    const head = toPushHead(snapshot, remotes)
    return head.ok ? planPush(head.head, remotes) : { ok: false, refusal: 'noRemote' }
  }

  /**
   * Pushes exactly `plan` (a second plain-name check at the last line
   * before git; never a force mode) in the user's own Git environment.
   * Throws the failure for the caller to show and to offer in the
   * editor's terminal.
   */
  public async push(plan: Extract<PushPlan, { ok: true }>): Promise<void> {
    this.checkEntry()
    if (!isPlainRefspec(plan.refspec) || !isPlainRefName(plan.remote)) {
      throw new Error('refused')
    }
    const cwd = await this.resolveRoot()
    await this.userSpawn(nativePushArgs(plan), cwd)
    this.checkEntry()
    this.deps.log.info('Pushed through the native service')
  }

  /** A pull request fetch in the user's own Git environment (lane P). */
  public async fetch(remote: string, ref?: string): Promise<void> {
    this.checkEntry()
    const cwd = await this.resolveRoot()
    await this.userSpawn(nativeFetchArgs(remote, ref), cwd)
    this.checkEntry()
  }

  /**
   * A held checkout's worktree (lane P): `name` is one safe segment under
   * the runtime data folder's `pr-worktrees/`, resolved and confined
   * before anything runs. Returns the confined path.
   */
  public async addWorktree(name: string, commit: string): Promise<string> {
    this.checkEntry()
    if (!WORKTREE_NAME.test(name) || !isPlainRefName(commit)) {
      throw new Error('refused')
    }
    const parent = await canonicalPath(path.join(this.deps.dataFolder, PULL_REQUEST_WORKTREES_DIR))
    this.checkEntry()
    const wtPath = await canonicalPath(path.join(parent, name))
    this.checkEntry()
    if (!slashed(wtPath).startsWith(`${slashed(parent)}/`)) {
      throw new Error('changed')
    }
    const cwd = await this.resolveRoot()
    await this.quietSpawn(nativeWorktreeAddArgs(wtPath, commit), cwd)
    this.checkEntry()
    return wtPath
  }
}
