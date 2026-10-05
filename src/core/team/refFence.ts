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

/** A refusal at call admission: what was refused, and the stable reason. */
export interface TeamRefusal {
  /** The exact command or argument list that was refused. */
  readonly command: string
  /** Stable reason code; messages are built by the caller. */
  readonly reason: string
}

export type RefFenceVerdict =
  { readonly allowed: true } | ({ readonly allowed: false } & TeamRefusal)

function refused(command: string, reason: string): RefFenceVerdict {
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

/** Global git options a worker may pass before the subcommand. */
const ALLOWED_GIT_GLOBALS = new Set([
  '--no-pager',
  '--no-replace-objects',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
])
/** The only short global flag a worker needs: pager off is the host's own. */
const PAGINATE_SHORT = '-p'

/** A global option that smuggles repository configuration into the call. */
const CONFIG_OPTIONS = new Set(['-c', '--config', '--config-env'])
/** A global option that points git at another repository. */
const REPO_DIR_OPTIONS = ['--git-dir', '--work-tree', '--super-prefix']
/** Help and version output: no repository needed, nothing moved. */
const HELP_OPTIONS = new Set(['--help', '--version', 'help'])

/** Subcommands that never move a ref, reach another repository or write. */
const ALLOWED_GIT_COMMANDS = new Set([
  'status',
  'log',
  'show',
  'diff',
  'grep',
  'blame',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'rev-list',
  'cat-file',
  'show-ref',
  'for-each-ref',
  'count-objects',
  'fsck',
  'verify-pack',
  'verify-commit',
  'verify-tag',
  'hash-object',
  'check-ref-format',
  'check-ignore',
  'check-attr',
  'check-mailmap',
  'name-rev',
  'describe',
  'merge-base',
  'shortlog',
  'var',
  'version',
])

const REFUSED_COMMIT_COMMANDS = new Set([
  'commit',
  'merge',
  'rebase',
  'reset',
  'revert',
  'cherry-pick',
  'cherry',
  'checkout',
  'switch',
  'restore',
  'am',
  'apply', // `apply` writes the worktree from a patch; workers edit with tools.
])
const REFUSED_REF_COMMANDS = new Set([
  'branch',
  'tag',
  'update-ref',
  'symbolic-ref',
  'notes',
  'replace',
])
const REFUSED_REMOTE_COMMANDS = new Set([
  'fetch',
  'pull',
  'push',
  'remote',
  'clone',
  'ls-remote',
  'submodule',
  'archive', // `archive --remote=` reaches another repository.
  'bundle',
])
const REFUSED_STATE_COMMANDS = new Set(['stash', 'worktree', 'bisect', 'config'])

/** `branch`/`tag` list flags: anything else (a name, `-f`, `-d`) moves refs. */
const LIST_ONLY_FLAGS = new Set([
  '--list',
  '--all',
  '--remotes',
  '--verbose',
  '--color',
  '--no-color',
  '--column',
  '--no-column',
  '--sort',
  '--format',
  '--contains',
  '--no-contains',
  '--merged',
  '--no-merged',
  '--points-at',
])
const LIST_ONLY_SHORT = new Set(['-l', '-a', '-r', '-v'])

/**
 * A worker's `git` argument list, refused at call admission. Every git
 * command that commits, merges, rebases, resets, checks out or switches,
 * moves or deletes a branch or tag, edits a ref, adds or removes a
 * worktree, stashes, reaches another repository, or smuggles configuration
 * (`-c credential.helper=…`, `--git-dir`, `-C <elsewhere>`) is refused.
 * Unknown subcommands are refused too: the guard is fail-closed.
 */
export function classifyWorkerGitCommand(args: readonly string[]): RefFenceVerdict {
  const words = [...args]
  if (words[0] === 'git') {
    words.shift()
  }
  const command = words.join(' ')
  let index = 0
  // Global options before the subcommand.
  while (index < words.length) {
    const token = words[index] ?? ''
    if (CONFIG_OPTIONS.has(token)) {
      return refused(command, 'gitConfig')
    }
    if (token === '-C' || REPO_DIR_OPTIONS.some((option) => token.startsWith(option))) {
      return refused(command, 'outsideRepo')
    }
    if (token === '--' || token === '-' || !token.startsWith('-')) {
      break
    }
    if (token.startsWith('--')) {
      const name = token.split('=', 1)[0] ?? token
      if (!ALLOWED_GIT_GLOBALS.has(name)) {
        return refused(command, 'gitOption')
      }
      index += 1
      continue
    }
    if (token !== PAGINATE_SHORT) {
      return refused(command, 'gitOption')
    }
    index += 1
  }
  const subcommand = words[index] ?? ''
  if (subcommand === '' || HELP_OPTIONS.has(subcommand)) {
    return { allowed: true }
  }
  if (subcommand === '--') {
    return refused(command, 'unknownGitCommand')
  }
  if (REFUSED_COMMIT_COMMANDS.has(subcommand)) {
    return refused(command, 'gitCommit')
  }
  if (REFUSED_REF_COMMANDS.has(subcommand)) {
    const isListable = subcommand === 'branch' || subcommand === 'tag'
    return isListable && isListOnly(words.slice(index + 1))
      ? checkGitOptions(words.slice(index + 1), command)
      : refused(command, 'gitRefMove')
  }
  if (REFUSED_REMOTE_COMMANDS.has(subcommand)) {
    return refused(command, 'gitRemote')
  }
  if (REFUSED_STATE_COMMANDS.has(subcommand)) {
    return refused(command, 'gitState')
  }
  return ALLOWED_GIT_COMMANDS.has(subcommand)
    ? checkGitOptions(words.slice(index + 1), command)
    : refused(command, 'unknownGitCommand')
}

/** `branch`/`tag` with only list flags and no ref names. */
function isListOnly(rest: readonly string[]): boolean {
  for (const token of rest) {
    if (token === '--' || token === '-' || !token.startsWith('-')) {
      return false
    }
    if (token.startsWith('--')) {
      const name = token.split('=', 1)[0] ?? token
      if (name !== '--list' && !LIST_ONLY_FLAGS.has(name)) {
        return false
      }
      continue
    }
    for (const flag of token.slice(1)) {
      if (!LIST_ONLY_SHORT.has(`-${flag}`)) {
        return false
      }
    }
  }
  return true
}

/** An option that writes a file (`git diff --output=…`) is refused. */
const WRITE_OPTIONS = new Set(['--output'])

function checkGitOptions(rest: readonly string[], command: string): RefFenceVerdict {
  const end = rest.indexOf('--')
  const options = rest.slice(0, end === -1 ? undefined : end)
  for (const token of options) {
    if (token === '-' || !token.startsWith('-')) {
      continue
    }
    const name = token.split('=', 1)[0] ?? token
    if (WRITE_OPTIONS.has(name)) {
      return refused(command, 'refusedOption')
    }
  }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// The read-only shell list with its refused options.
// ---------------------------------------------------------------------------

/**
 * One entry of the read-only command list (the shape lane 0's
 * `TEAM_READ_ONLY_COMMANDS` fills): the executable, an optional git-style
 * subcommand, and the entry's own refused options.
 */
export interface ReadOnlyCommandEntry {
  readonly command: string
  readonly subcommand?: string | undefined
  readonly refusedOptions?: readonly string[] | undefined
}

export interface ReadOnlyShellOptions {
  readonly platform: NodeJS.Platform
  /** Lane 0's read-only list, injected until it lands. */
  readonly readOnly: readonly ReadOnlyCommandEntry[]
}

/** PowerShell cmdlets that write, whatever their arguments. */
const WRITE_CMDLETS = new Set([
  'set-content',
  'add-content',
  'clear-content',
  'out-file',
  'new-item',
  'copy-item',
  'move-item',
  'remove-item',
  'rename-item',
  'set-item',
  'tee-object',
  'set-clipboard',
])

/** Characters that separate shell segments (doubled `&&`/`||` count once). */
const SEPARATOR_CHARS = new Set([';', '&', '|'])
const QUOTE_CHARS = new Set(['"', "'"])
const BLANK_CHARS = new Set([' ', '\t'])

/** Split a command line on unquoted `;`, `&&`, `||`, `|` and `&`. */
function splitSegments(command: string): readonly string[][] {
  const segments: string[][] = [[]]
  let current = ''
  let quote: string | undefined
  const push = (): void => {
    if (current === '') {
      return
    }

    segments.at(-1)?.push(current)
    current = ''
  }
  let index = 0
  while (index < command.length) {
    const char = command[index] ?? ''
    if (quote !== undefined) {
      current += char
      if (char === quote) {
        quote = undefined
      }
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      index += 1
      continue
    }
    if (SEPARATOR_CHARS.has(char)) {
      push()
      // `&&` and `||` are one separator, not two.
      if (
        index + 1 < command.length &&
        command[index + 1] === char &&
        (char === '&' || char === '|')
      ) {
        index += 1
      }
      segments.push([])
      index += 1
      continue
    }
    current += char
    index += 1
  }
  push()
  return segments.map((tokens) => tokens.flatMap((token) => splitTokens(token)))
}

/** Whitespace split that keeps quoted spans whole (quotes retained). */
function splitTokens(segment: string): readonly string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | undefined
  const push = (): void => {
    if (current === '') {
      return
    }

    tokens.push(current)
    current = ''
  }
  for (const char of segment) {
    if (quote !== undefined) {
      current += char
      if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (QUOTE_CHARS.has(char)) {
      quote = char
      current += char
      continue
    }
    if (BLANK_CHARS.has(char)) {
      push()
      continue
    }
    current += char
  }
  push()
  return tokens
}

/** A token quoted on both ends (the quotes are still attached). */
function isQuoted(token: string): boolean {
  return (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  )
}

/** `2>&1` duplicates a descriptor; anything else with `>` writes a file. */
const REDIRECT_DUPLICATE = /^\d*>&\d+$/

function isRedirect(token: string): boolean {
  return (
    !isQuoted(token) &&
    !REDIRECT_DUPLICATE.test(token) &&
    (token.startsWith('>') ||
      token === '>|' ||
      token === '<>' ||
      token === '&>' ||
      /^\d+>/.test(token) ||
      token.startsWith('&>'))
  )
}

function executableBase(word: string, platform: NodeJS.Platform): string {
  const bare = word.replaceAll(/["']/g, '').split('/').at(-1)?.split('\\').at(-1) ?? ''
  const noExtension = bare.replace(/\.(?:exe|cmd|bat|ps1|com)$/i, '')
  return platform === 'win32' ? noExtension.toLowerCase() : noExtension
}

function isSameCommand(entry: string, actual: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? entry.toLowerCase() === actual.toLowerCase() : entry === actual
}

/**
 * A shell command for a `read-only` role. Every `;`/`&&`/`||`/`|` segment
 * must be on the read-only list: a redirect (`echo x > f`), a write cmdlet
 * (`Set-Content`), a refused option (`git diff --output=…`), a git command
 * the ref guard refuses, or anything off the list is refused, never asked.
 */
export function classifyReadOnlyShellCommand(
  command: string,
  options: ReadOnlyShellOptions,
): RefFenceVerdict {
  const segments = splitSegments(command).filter((tokens) => tokens.length > 0)
  if (segments.length === 0) {
    return refused(command, 'notReadOnly')
  }
  for (const tokens of segments) {
    const verdict = classifySegment(tokens.join(' '), tokens, options)
    if (!verdict.allowed) {
      return verdict
    }
  }
  return { allowed: true }
}

function classifySegment(
  command: string,
  tokens: readonly string[],
  options: ReadOnlyShellOptions,
): RefFenceVerdict {
  for (const token of tokens) {
    if (isRedirect(token)) {
      return refused(command, 'shellRedirect')
    }
  }
  const executable = executableBase(tokens[0] ?? '', options.platform)
  if (executable === '') {
    return refused(command, 'notReadOnly')
  }
  if (WRITE_CMDLETS.has(executable.toLowerCase())) {
    return refused(command, 'writeCommand')
  }
  if (isSameCommand('git', executable, options.platform)) {
    const guard = classifyWorkerGitCommand(tokens)
    if (!guard.allowed) {
      return guard
    }
  }
  const entry = options.readOnly.find(
    (candidate) =>
      isSameCommand(candidate.command, executable, options.platform) &&
      (candidate.subcommand === undefined || tokens[1] === candidate.subcommand),
  )
  // A bare `git` match without the subcommand still needs its subcommand
  // named: `git` alone on the list does not admit `git push`.
  if (entry === undefined) {
    return refused(command, 'notReadOnly')
  }
  if (entry.subcommand === undefined && isSameCommand('git', executable, options.platform)) {
    return refused(command, 'notReadOnly')
  }
  const refusedOptions = new Set<string>(['--output', ...(entry.refusedOptions ?? [])])
  const rest = tokens.slice(1)
  const end = rest.indexOf('--')
  const flags = rest.slice(0, end === -1 ? undefined : end)
  for (const token of flags) {
    if (token === '-' || isQuoted(token) || !token.startsWith('-')) {
      continue
    }
    const name = token.split('=', 1)[0] ?? token
    if (refusedOptions.has(name)) {
      return refused(command, 'refusedOption')
    }
  }
  return { allowed: true }
}

// ---------------------------------------------------------------------------
// The credential-free worker environment.
// ---------------------------------------------------------------------------

const CREDENTIAL_NAME = /api[_-]?key|token|secret|password|credentials?/i

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
  const kept = new Set(passthrough)
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      continue
    }
    if (kept.has(name)) {
      out[name] = value
      continue
    }
    if (
      name === 'SSH_AUTH_SOCK' ||
      name === 'GIT_ASKPASS' ||
      name === 'SSH_ASKPASS' ||
      CREDENTIAL_NAME.test(name)
    ) {
      continue
    }
    out[name] = value
  }
  out['GIT_TERMINAL_PROMPT'] = '0'
  out['GIT_ASKPASS'] = ''
  out['SSH_ASKPASS'] = ''
  out['GIT_SSH_COMMAND'] = 'muse-spark-refuses-ssh'
  out['GIT_CONFIG_COUNT'] = '2'
  out['GIT_CONFIG_KEY_0'] = 'credential.helper'
  out['GIT_CONFIG_VALUE_0'] = ''
  out['GIT_CONFIG_KEY_1'] = 'core.askpass'
  out['GIT_CONFIG_VALUE_1'] = ''
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
