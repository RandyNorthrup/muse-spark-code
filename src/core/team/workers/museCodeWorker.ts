// A session per task on the window's team host (M96 lane W, PLAN.md D75):
// a `muse serve` started through lane K's launcher and never the
// conversation's; the read-only host started with `--disable-write` and
// `--disable-shell`; the bridge's servers in `config.mcpServers` and the
// user's exclusive servers switched off where step 1 shows how.
//
// Seams: the team host's lifecycle is lane K's (`TeamHostProvider`), the
// bridge's servers are lane B's, the folder is lane I's, and the MSP
// approval payload's mapping to `MuseWorkerApprovalRequest` is the
// integration's. Nothing here guesses an uncaptured wire shape.

import type { SessionMcpServer } from '../../agent/agentBackend'
import { pathModule } from '../../workspaceRoot'
import { confineWorkspacePath, isBelow, type RealPathIo } from '../../workspacePath'
import { isGlobMatch } from '../../backends/modelapi/globLimits'
import { isProtectedPath } from '../../protectedPaths'
import { commandShape, looseWords, type ShellDialect } from '../../backends/modelapi/shellSyntax'
import type { ApprovalMode } from '../../../shared/permissionModes'
import {
  MUSE_DISABLE_SHELL_ARG,
  MUSE_DISABLE_WRITE_ARG,
  MUSE_SERVE_ARGS,
  MUSE_TRUST_WORKSPACE_ARG,
} from '../../../shared/constants'
import { extractTeamReport, type WorkerReportOutcome } from './report'
import type { WorkerRolePolicy, WorkerTask } from './workerTypes'
import { WorkerUntrustedError } from './engineWorker'

/** The window's team host, or its read-only host: never the conversation's. */
export type MuseWorkerHostKind = 'team' | 'readOnly'

/** A `read-only` role runs on the read-only host; every other role on the team host. */
export function hostKindFor(role: WorkerRolePolicy): MuseWorkerHostKind {
  return role.workspaceMode === 'read-only' ? 'readOnly' : 'team'
}

/**
 * The `serve` arguments for a worker host. The read-only host is fixed for
 * its lifetime with `--disable-write` and `--disable-shell` (the 1.4.2
 * capture, research §4.7), so Muse Code itself refuses that worker's file
 * writes and shell. A trusted workspace loads its rules and skills.
 */
export function workerServeArgs(kind: MuseWorkerHostKind, isTrusted: boolean): readonly string[] {
  return [
    ...MUSE_SERVE_ARGS,
    ...(kind === 'readOnly' ? [MUSE_DISABLE_WRITE_ARG, MUSE_DISABLE_SHELL_ARG] : []),
    isTrusted ? MUSE_TRUST_WORKSPACE_ARG : MUSE_DISABLE_SHELL_ARG,
  ]
}

/** The host lane K lends a worker: started through its launcher, in the window's container. */
export interface MuseWorkerHostPort {
  readonly hostId: string
  readonly kind: MuseWorkerHostKind
  readonly startSession: (options: {
    readonly workspaceRoot: string
    readonly modelId: string
    readonly approvalMode: ApprovalMode
    readonly mcpServers: Readonly<Record<string, SessionMcpServer>>
  }) => Promise<MuseWorkerSessionPort>
}

/** Starts (or reuses) the window's team and read-only hosts. Lane K owns the lifecycle. */
export interface TeamHostProvider {
  readonly teamHost: () => Promise<MuseWorkerHostPort>
  readonly readOnlyHost: () => Promise<MuseWorkerHostPort>
}

/** A worker's session: one task, idle when its report is in. */
export interface MuseWorkerSessionPort {
  readonly sessionId: string
  readonly sendPrompt: (text: string) => Promise<{ readonly lastMessage: string | undefined }>
  readonly cancel: () => Promise<void>
}

/** The task's folder is the workspace, not a working copy. */
export class MuseWorkerFolderError extends Error {
  public constructor() {
    super('A Muse Code worker starts in its working copy, never the workspace')
    this.name = 'MuseWorkerFolderError'
  }
}

/** Step 1 has not shown how a session switches a user server off. */
export class MuseWorkerCapturePendingError extends Error {
  public constructor() {
    super('Switching off a user server waits on the step 1 capture')
    this.name = 'MuseWorkerCapturePendingError'
  }
}

/**
 * The session's `config.mcpServers`: the bridge's servers only. The task's
 * folder must be a working copy (or scratch copy) outside the workspace
 * tree; starting in the workspace is refused. `denyUnmatched` (Plan) for a
 * `read-only` role, `promptUnmatched` for every other role.
 */
export async function assertWorkerRoot(input: {
  readonly workspaceRoot: string
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
}): Promise<void> {
  const p = pathModule(input.platform)
  try {
    const [checkout, worker] = await Promise.all([
      input.io.realPath(input.workspaceRoot),
      input.io.realPath(input.folder),
    ])
    if (
      checkout === worker ||
      !p.isAbsolute(checkout) ||
      !p.isAbsolute(worker) ||
      p.relative(checkout, worker) === '' ||
      isBelow(p.relative(checkout, worker), p) ||
      isBelow(p.relative(worker, checkout), p)
    ) {
      throw new MuseWorkerFolderError()
    }
  } catch {
    throw new MuseWorkerFolderError()
  }
}

export async function buildWorkerSessionConfig(input: {
  readonly task: WorkerTask
  readonly role: WorkerRolePolicy
  readonly modelId: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  /** Complete inventory from the host's user-server configuration. */
  readonly exclusiveUserServers: readonly string[]
  readonly bridgeServers: Readonly<Record<string, SessionMcpServer>>
}): Promise<{
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: ApprovalMode
  readonly mcpServers: Readonly<Record<string, SessionMcpServer>>
}> {
  await assertWorkerRoot({ ...input, folder: input.task.folder })
  if (input.role.workspaceMode === 'in-place') {
    throw new MuseWorkerFolderError()
  }
  userServerExclusion(input.exclusiveUserServers)
  return {
    workspaceRoot: input.task.folder,
    modelId: input.modelId,
    approvalMode: input.role.workspaceMode === 'read-only' ? 'denyUnmatched' : 'promptUnmatched',
    mcpServers: input.bridgeServers,
  }
}

/**
 * Switches a user's exclusive servers off for one session. Step 1 captures
 * whether `config.mcpServers` can override or switch off a user-configured
 * server of the same name; until it does, this throws rather than running
 * the worker beside a second copy of a singleton server.
 */
export function userServerExclusion(names: readonly string[]): void {
  if (names.length > 0) {
    throw new MuseWorkerCapturePendingError()
  }
}

/** A git command that would commit, merge, push, fetch, switch or move any ref (D75's fence). */
const REF_MOVING_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'commit',
  'merge',
  'rebase',
  'reset',
  'checkout',
  'switch',
  'update-ref',
  'symbolic-ref',
  'stash',
  'push',
  'pull',
  'fetch',
  'remote',
  'clone',
])

/**
 * Whether the words are a git command the ref guard refuses. Leading `git`
 * flags are skipped; `--git-dir` and `--work-tree` reach another
 * repository and refuse; `branch` and `tag` refuse except their read-only
 * listings.
 */
export function isRefMovingGitCommand(words: readonly string[]): boolean {
  let index = 0
  if (!/(?:^|[/\\])git(?:\.exe)?$/i.test(words[index] ?? '')) {
    return false
  }
  index += 1
  while (index < words.length) {
    const word: string | undefined = words[index]
    if (
      word === undefined ||
      word === '-C' ||
      word === '-c' ||
      word === '--config-env' ||
      word === '--exec-path' ||
      word === '--git-dir' ||
      word === '--work-tree' ||
      word.startsWith('-C') ||
      word.startsWith('-c') ||
      word.startsWith('--config-env=') ||
      word.startsWith('--exec-path=') ||
      word.startsWith('--git-dir=') ||
      word.startsWith('--work-tree=')
    ) {
      return true
    }
    if (!word.startsWith('-')) {
      break
    }
    if (!GIT_SAFE_GLOBAL_FLAGS.has(word)) {
      return true
    }
    index += 1
  }
  const subcommand: string | undefined = words[index]
  if (subcommand === undefined || REF_MOVING_SUBCOMMANDS.has(subcommand)) {
    return true
  }
  if (subcommand === 'branch' || subcommand === 'tag') {
    const rest = words.slice(index + 1)
    const readOnly = subcommand === 'branch' ? GIT_BRANCH_LIST_FLAGS : GIT_TAG_LIST_FLAGS
    return rest.some((word) => !readOnly.has(word))
  }
  if (subcommand === 'worktree') {
    return words[index + 1] !== 'list'
  }
  // Unknown aliases/subcommands may execute arbitrary code or move refs.
  return !GIT_READ_SUBCOMMANDS.has(subcommand)
}

const GIT_SAFE_GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  '--no-pager',
  '--paginate',
  '--no-optional-locks',
  '--literal-pathspecs',
])
const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'diff',
  'log',
  'show',
  'blame',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'for-each-ref',
  'cat-file',
  'check-ignore',
  'describe',
  'help',
  'version',
])

const GIT_BRANCH_LIST_FLAGS: ReadonlySet<string> = new Set([
  '--list',
  '--show-current',
  '-a',
  '--all',
  '--contains',
  '--merged',
  '--no-merged',
  '-v',
  '-vv',
])

const GIT_TAG_LIST_FLAGS: ReadonlySet<string> = new Set(['-l', '--list', '-n'])

/** An approval a worker's session raises, mapped from the host's payload by the integration. */
export type MuseWorkerApprovalRequest =
  | { readonly kind: 'shellCommand'; readonly command: string }
  | { readonly kind: 'writeFile'; readonly path: string }
  | { readonly kind: 'other'; readonly tool: string }

/** `deny` is answered without asking; `askUser` becomes the user's labelled card. */
export type MuseWorkerApprovalAnswer = 'deny' | 'askUser'

/**
 * Answers a worker session's approval by the role's policy. Denied without
 * asking: a command for a role without the shell, a git command the ref
 * guard refuses, and for a `read-only` role any write and any command off
 * the read-only list. Everything else goes to the user, labelled.
 */
export async function isWorkerWriteAllowed(
  input: {
    readonly role: WorkerRolePolicy
    readonly folder: string
    readonly platform: NodeJS.Platform
    readonly io: RealPathIo
  },
  given: string,
): Promise<boolean> {
  if (
    given.trim() === '' ||
    input.role.workspaceMode === 'read-only' ||
    !input.role.toolGroups.includes('write')
  ) {
    return false
  }
  const confined = await confineWorkspacePath(input.folder, given, input.platform, input.io)
  if (!confined.ok || isProtectedPath(confined.relative) || isProtectedPath(confined.canonical)) {
    return false
  }
  return (
    input.role.writePaths === undefined ||
    input.role.writePaths.some((pattern) => {
      try {
        return isGlobMatch(confined.canonical, pattern)
      } catch {
        return false
      }
    })
  )
}

export async function classifyMuseWorkerApproval(input: {
  readonly role: WorkerRolePolicy
  readonly request: MuseWorkerApprovalRequest
  readonly dialect: ShellDialect
  /** Lane 0's `TEAM_READ_ONLY_COMMANDS`, injected until it lands. */
  readonly readOnlyCommands: ReadonlySet<string>
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  readonly testCommands?: ReadonlySet<string>
}): Promise<MuseWorkerApprovalAnswer> {
  const { request } = input
  if (request.kind === 'writeFile') {
    return (await isWorkerWriteAllowed(input, request.path)) ? 'askUser' : 'deny'
  }
  if (request.kind === 'shellCommand') {
    return isWorkerCommandAllowed({ ...input, command: request.command }) ? 'askUser' : 'deny'
  }
  return 'deny'
}

/** Full role commands, plain syntax, and refused options bind both adapters. */
export function isWorkerCommandAllowed(input: {
  readonly role: WorkerRolePolicy
  readonly command: string
  readonly dialect: ShellDialect
  readonly readOnlyCommands: ReadonlySet<string>
  readonly testCommands?: ReadonlySet<string>
}): boolean {
  const shape = commandShape(input.command, input.dialect)
  if (!shape.isPlain || shape.commands.length !== 1 || hasRefMove(input.command, input.dialect)) {
    return false
  }
  if (input.role.workspaceMode !== 'read-only' && input.role.toolGroups.includes('shell')) {
    return true
  }
  const words = shape.commands[0] ?? []
  const hasMatchingCommand = (commands: ReadonlySet<string>): boolean =>
    [...commands].some((command) => {
      const permitted = commandShape(command, input.dialect)
      if (!permitted.isPlain || permitted.commands.length !== 1) return false
      const prefix = permitted.commands[0] ?? []
      return prefix.length > 0 && prefix.every((word, index) => words[index] === word)
    })
  return input.role.toolGroups.includes('readOnlyShell') &&
    hasMatchingCommand(input.readOnlyCommands)
    ? words.every((word) =>
        ['--output', '-o', '--ext-diff', '--textconv', '-c', '--exec-path'].every(
          (option) =>
            !(
              word === option ||
              word.startsWith(`${option}=`) ||
              (option === '-o' && word.startsWith('-o'))
            ),
        ),
      )
    : input.role.workspaceMode !== 'read-only' &&
        input.role.toolGroups.includes('testShell') &&
        hasMatchingCommand(input.testCommands ?? new Set())
}

/**
 * Whether any run of the command line moves a ref: `looseWords` reads
 * wider than the shell, so a nested `$(git push)` is seen too.
 */
export function hasRefMove(command: string, dialect: ShellDialect): boolean {
  return looseWords(command, dialect).some((words) => isRefMovingGitCommand(words))
}

export interface MuseCodeWorkerDeps {
  readonly task: WorkerTask
  readonly role: WorkerRolePolicy
  readonly prompt: string
  readonly modelId: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  readonly exclusiveUserServers: readonly string[]
  readonly isTrusted: boolean
  readonly bridgeServers: Readonly<Record<string, SessionMcpServer>>
  readonly hosts: TeamHostProvider
}

/**
 * Runs one Muse Code worker's task: a session per task on the window's team
 * host (the read-only host for a `read-only` role, never the
 * conversation's), in the task's folder, with the bridge's servers. The
 * worker ends its last message with the `muse-team-report` block.
 */
export async function runMuseCodeWorker(deps: MuseCodeWorkerDeps): Promise<{
  readonly sessionId: string
  readonly report: WorkerReportOutcome
  readonly cancel: () => Promise<void>
}> {
  if (!deps.isTrusted) {
    throw new WorkerUntrustedError()
  }
  const config = await buildWorkerSessionConfig({
    task: deps.task,
    role: deps.role,
    modelId: deps.modelId,
    workspaceRoot: deps.workspaceRoot,
    platform: deps.platform,
    io: deps.io,
    exclusiveUserServers: deps.exclusiveUserServers,
    bridgeServers: deps.bridgeServers,
  })
  const kind = hostKindFor(deps.role)
  const host = kind === 'readOnly' ? await deps.hosts.readOnlyHost() : await deps.hosts.teamHost()
  const session = await host.startSession(config)
  const { lastMessage } = await session.sendPrompt(deps.prompt)
  return {
    sessionId: session.sessionId,
    report: extractTeamReport(lastMessage ?? ''),
    cancel: () => session.cancel(),
  }
}
