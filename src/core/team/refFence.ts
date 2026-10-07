// The team's ref fence (M96 lane I, PLAN.md D75): the ref guard that refuses
// a worker's git commands at call admission, the read-only shell list with
// its refused options, the credential-free worker environment, and the
// `agents/` ref check (with the reflog push check that catches a local push
// into the user's repository).
//
// Pure: no git, no file system, no `vscode`. Lane T (tools) and lane W
// (workers) call the classifiers at admission; the read-only command list
// itself is lane 0's `TEAM_READ_ONLY_COMMANDS`, which callers pass in
// through `ReadOnlyCommandEntry` (the temporary seam until lane 0 lands).

import { classifyWorkerGitCommand } from './workers/workerFence'
export { classifyWorkerGitCommand } from './workers/workerFence'

import { commandShape } from '../backends/modelapi/shellSyntax'
import { pathModule } from '../workspaceRoot'

/** A refusal at call admission: what was refused, and the stable reason. */
export interface TeamRefusal {
  /** The exact command or argument list that was refused. */
  readonly command: string
  /** Stable reason code; messages are built by the caller. */
  readonly reason: string
}

export type RefFenceVerdict =
  { readonly allowed: true } | ({ readonly allowed: false } & TeamRefusal)

function refused(
  command: string,
  reason: string,
): Extract<RefFenceVerdict, { readonly allowed: false }> {
  return { allowed: false, command, reason }
}

/** A task's branch: `agents/<role>/<task-id>`. */
export const TEAM_AGENTS_BRANCH_PREFIX = 'agents'
const TEAM_AGENTS_REF_PREFIX = 'refs/heads/agents/'

/** A refusal the fence itself raises (bad names, breached refs). */
export class TeamRefError extends Error {
  public constructor(
    public readonly code: 'badName' | 'refBreach',
    message: string,
  ) {
    super(message)
    this.name = 'TeamRefError'
  }
}

export function isTeamRefError(value: unknown): value is TeamRefError {
  return value instanceof Error && value.name === 'TeamRefError'
}

// git check-ref-format, condensed: no empty segment, no `..`, no ASCII
// control, none of `~ ^ : ? * [ \` and no `@{`, no leading or trailing
// slash or dot, no trailing `.lock`, no leading dash.
const BAD_SEGMENT = /[~^:?*[\\\]]/
const DOUBLE_DOT = '..'
const REFLOG_SUFFIX = '@{'
const LOCK_SUFFIX = '.lock'
// check-ref-format refuses ASCII controls, the space, and DEL.
const ASCII_SPACE_MAX = 0x20
const ASCII_DELETE = 0x7f

function hasBadName(value: string): boolean {
  if (value.includes(DOUBLE_DOT) || value.includes(REFLOG_SUFFIX) || value.endsWith(LOCK_SUFFIX)) {
    return true
  }
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code === ASCII_DELETE || code <= ASCII_SPACE_MAX) {
      return true
    }
  }
  return false
}

function isBranchSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    !segment.includes('/') &&
    !segment.startsWith('-') &&
    !segment.startsWith('.') &&
    !segment.endsWith('.') &&
    !BAD_SEGMENT.test(segment) &&
    !hasBadName(segment)
  )
}

/**
 * `agents/<role>/<task-id>`, validated branch-safe. Throws `TeamRefError`
 * (`badName`) for anything that is not two clean segments: the fence is
 * fail-closed, and a bad name never becomes a ref.
 */
export function teamBranchName(role: string, taskId: string): string {
  if (!isBranchSegment(role) || !isBranchSegment(taskId)) {
    throw new TeamRefError('badName', `Refused team branch for role ${role} and task ${taskId}`)
  }
  return `${TEAM_AGENTS_BRANCH_PREFIX}/${role}/${taskId}`
}

/** `refs/heads/agents/<role>/<task-id>` for a branch this module named. */
export function teamAgentsRef(branch: string): string {
  if (!branch.startsWith(`${TEAM_AGENTS_BRANCH_PREFIX}/`)) {
    throw new TeamRefError('badName', `Refused team ref for branch ${branch}`)
  }
  const rest = branch.slice(TEAM_AGENTS_BRANCH_PREFIX.length + 1)
  const [role, taskId] = rest.split('/', 2)
  if (role === undefined || taskId === undefined || rest.split('/').length !== 2) {
    throw new TeamRefError('badName', `Refused team ref for branch ${branch}`)
  }
  if (!isBranchSegment(role) || !isBranchSegment(taskId)) {
    throw new TeamRefError('badName', `Refused team ref for branch ${branch}`)
  }
  return `${TEAM_AGENTS_REF_PREFIX}${branch.slice(TEAM_AGENTS_BRANCH_PREFIX.length + 1)}`
}

// ---------------------------------------------------------------------------
// The ref guard: a worker's git command, refused at call admission.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The read-only shell list with its refused options.
// ---------------------------------------------------------------------------

/**
 * One entry of the read-only command list (the shape lane 0's
 * `TEAM_READ_ONLY_COMMANDS` fills): an exact Git argv shape and the
 * entry's own refused options.
 */
export interface ReadOnlyCommandEntry {
  readonly command: string
  /** Exact arguments after the executable, supplied by the trusted host. */
  readonly argv: readonly string[]
  readonly refusedOptions?: readonly string[] | undefined
}

export interface ReadOnlyShellOptions {
  readonly platform: NodeJS.Platform
  readonly readOnly: readonly ReadOnlyCommandEntry[]
  /** Absolute Git path already resolved and trusted by the host. */
  readonly trustedGitPath: string
}

/** Admission returns the invocation to execFile, never a shell string. */
export function classifyReadOnlyShellCommand(
  command: string,
  options: ReadOnlyShellOptions,
):
  | Extract<RefFenceVerdict, { readonly allowed: false }>
  | { readonly allowed: true; readonly executable: string; readonly args: readonly string[] } {
  const shape = commandShape(command, options.platform === 'win32' ? 'powershell' : 'bash')
  if (!shape.isPlain) {
    return refused(command, shape.reason === 'redirection' ? 'shellRedirect' : 'notReadOnly')
  }
  if (shape.commands.length !== 1) {
    return refused(command, 'notReadOnly')
  }
  const tokens = shape.commands[0] ?? []
  const executable = tokens[0] ?? ''
  const p = pathModule(options.platform)
  if (
    !p.isAbsolute(options.trustedGitPath) ||
    (executable !== 'git' && executable !== options.trustedGitPath)
  ) {
    return refused(command, 'notReadOnly')
  }
  const args = tokens.slice(1)
  const guard = classifyWorkerGitCommand(args)
  if (!guard.allowed) {
    return guard
  }
  const entry = options.readOnly.find(
    (candidate) =>
      candidate.command === 'git' &&
      candidate.argv.length === args.length &&
      candidate.argv.every((arg, index) => arg === args[index]),
  )
  if (entry === undefined) {
    return refused(command, 'notReadOnly')
  }
  const refusedOptions = new Set(entry.refusedOptions)
  const end = args.indexOf('--')
  if (
    args
      .slice(0, end === -1 ? undefined : end)
      .some((arg) => refusedOptions.has(arg.split('=', 1)[0] ?? arg))
  ) {
    return refused(command, 'refusedOption')
  }
  return { allowed: true, executable: options.trustedGitPath, args: ['--no-pager', ...args] }
}

// ---------------------------------------------------------------------------
// The credential-free worker environment.
// ---------------------------------------------------------------------------

const WORKER_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
])
const WORKER_ENV_BLOCKED = /^(?:GIT_|SSH_|LD_|DYLD_|NODE_|BASH_ENV$|ENV$|.*ASKPASS$)/i

/**
 * The environment a worker process starts with: no git credentials (no
 * helper, no prompt, no askpass, no agent socket, an `ssh` that refuses, no
 * user or system configuration that could name credentials), and no
 * credential variable except the names the agent's profile passes through.
 * Returns a fresh object; the input is never mutated.
 */
export function workerEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  passthrough: readonly string[] = [],
): NodeJS.ProcessEnv {
  const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null'
  const kept = new Set(passthrough.map((name) => name.toUpperCase()))
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase()
    if (
      value !== undefined &&
      !WORKER_ENV_BLOCKED.test(upper) &&
      (WORKER_ENV_ALLOWLIST.has(upper) || kept.has(upper))
    ) {
      out[name] = value
    }
  }
  out['GIT_TERMINAL_PROMPT'] = '0'
  out['GIT_SSH_COMMAND'] = 'false'
  out['GIT_CONFIG_COUNT'] = '2'
  out['GIT_CONFIG_KEY_0'] = 'credential.helper'
  out['GIT_CONFIG_VALUE_0'] = ''
  out['GIT_CONFIG_KEY_1'] = 'core.askpass'
  out['GIT_CONFIG_VALUE_1'] = ''
  out['GIT_CONFIG_NOSYSTEM'] = '1'
  out['GIT_CONFIG_GLOBAL'] = nullDevice
  out['GIT_CONFIG_SYSTEM'] = nullDevice
  return out
}

// ---------------------------------------------------------------------------
// The `agents/` ref check.
// ---------------------------------------------------------------------------

/** Absent ref value, as breach reports show it. */
export const ABSENT_REF_VALUE = '(absent)'

export type AgentsRefCheck =
  | { readonly breach: false }
  | {
      readonly breach: true
      readonly ref: string
      readonly oldValue: string
      readonly newValue: string
    }

/**
 * The value the extension last wrote for an `agents/` ref, against what is
 * there now. Any other value stops the task and refuses its merge, naming
 * the ref and both values. Refs the user or VS Code moves (a commit, a
 * fetch) live outside `agents/` and are never a breach.
 */
export function checkAgentsRef(
  ref: string,
  expected: string | undefined,
  actual: string | undefined,
): AgentsRefCheck {
  if (expected === actual) {
    return { breach: false }
  }
  return {
    breach: true,
    ref,
    oldValue: expected ?? ABSENT_REF_VALUE,
    newValue: actual ?? ABSENT_REF_VALUE,
  }
}

/**
 * Per-task ref tracking. Each task records only the `agents/` refs the
 * extension wrote for it, so two writers running at once never trip each
 * other's fence: a move of another task's ref is simply not this fence's
 * ref.
 */
export class RefFence {
  private readonly lastWritten = new Map<string, string | undefined>()

  /** The extension wrote `ref` (or removed it, with `undefined`). */
  public recordWrite(ref: string, value: string | undefined): void {
    this.lastWritten.set(ref, value)
  }

  /** Check a ref this task owns against its current value. */
  public check(ref: string, actual: string | undefined): AgentsRefCheck {
    if (!this.lastWritten.has(ref)) {
      return {
        breach: true,
        ref,
        oldValue: ABSENT_REF_VALUE,
        newValue: actual ?? ABSENT_REF_VALUE,
      }
    }
    return checkAgentsRef(ref, this.lastWritten.get(ref), actual)
  }

  /** Every owned ref, for the end-of-task check. */
  public ownedRefs(): readonly string[] {
    return Array.from(this.lastWritten.keys(), (ref) => ref)
  }
}

/**
 * Whether a reflog subject shows `receive-pack` wrote the ref: a script the
 * worker started found the user's repository through the shared clone's
 * alternates and pushed into it without credentials. Subjects come from
 * `git log -g --format=%gs`.
 */
export function isReflogPush(subject: string): boolean {
  return subject.split(':', 1)[0]?.trim().toLowerCase() === 'push'
}

/** The refs whose reflog holds a push entry: each is a breach. */
export function findPushedRefs(
  reflogs: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  return Object.keys(reflogs).filter((ref) =>
    (reflogs[ref] ?? []).some((subject) => isReflogPush(subject)),
  )
}
