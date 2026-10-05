// The ACP client worker (M96 lane W, PLAN.md D75): `initialize`, terminal
// sign-in handoff, `session/new` with `cwd` and the bridge's servers, each
// preset's mode choice, the permission answers, confined `fs/*`, and cancel.
//
// The mode tables come from the research (§4.2–§4.4, docs and source, no
// prompt); step 1's captures confirm them and fill each preset's switch for
// leaving out the user's own MCP servers. A shape the captures have not
// shown is refused, never guessed.

import type { AuthMethod, McpServer } from '@agentclientprotocol/sdk'
import { WORKER_ACP_MAX_PERMISSION_PATHS } from '../../../shared/constants'
import { confineWorkspacePath, type RealPathIo } from '../../workspacePath'
import type { ShellDialect } from '../../backends/modelapi/shellSyntax'
import { buildWorkerPrompt, WorkerUntrustedError, type WorkerFileIo } from './engineWorker'
import { assertWorkerRoot, isWorkerCommandAllowed, isWorkerWriteAllowed } from './museCodeWorker'
import { extractTeamReport, type WorkerReportOutcome } from './report'
import type { WorkerPromptParts, WorkerRolePolicy, WorkerTask } from './workerTypes'

/** An external agent preset (D75's list). */
export type AcpPresetId = 'claude' | 'codex' | 'gemini' | 'copilot' | 'own'

/** A role's shape for mode choice: what the mode must hold. */
export type AcpRoleShape = 'readOnly' | 'writePaths' | 'engineering'

/** Maps a role to its shape: read-only, writes under paths, or the whole branch. */
export function roleShapeFor(role: WorkerRolePolicy): AcpRoleShape {
  if (role.workspaceMode === 'read-only') {
    return 'readOnly'
  }
  return role.writePaths !== undefined && role.writePaths.length > 0 ? 'writePaths' : 'engineering'
}

export interface AcpPreset {
  readonly id: AcpPresetId
  /** The command the host finds on the PATH (lane W's `acpProcess`). */
  readonly command: string
  /** Spawned by default with these arguments. */
  readonly defaultArgs: readonly string[]
  /**
   * The switch that starts the agent without the user's own MCP servers,
   * per preset, from step 1's capture. Absent until captured: without it a
   * worker beside a second copy of a singleton server must not start.
   */
  readonly withoutUserServersSwitch?: readonly string[]
  /**
   * The captured mode per role shape. Absent means the preset has shown no
   * mode that meets the shape, so the role refuses the agent (acceptance 24).
   */
  readonly modes: Readonly<Record<AcpRoleShape, string | undefined>>
  /** Modes that skip asking: never chosen, even advertised (acceptance 24). */
  readonly forbiddenModes: readonly string[]
}

/**
 * The preset table. Claude's and Codex's rows are the research (§4.2, §4.3:
 * Claude's `default` asks before every edit, Codex's `workspace-write` is
 * confined to its `cwd`); the rest wait on step 1's `initialize` records.
 */
export const ACP_PRESETS: Readonly<Record<AcpPresetId, AcpPreset>> = {
  claude: {
    id: 'claude',
    command: 'claude-agent-acp',
    defaultArgs: ['--hide-claude-auth'],
    modes: { readOnly: 'plan', writePaths: 'default', engineering: 'default' },
    forbiddenModes: ['bypassPermissions', 'dontAsk', 'auto'],
  },
  codex: {
    id: 'codex',
    command: 'codex-acp',
    defaultArgs: [],
    modes: { readOnly: 'read-only', writePaths: undefined, engineering: 'workspace-write' },
    forbiddenModes: ['agent-full-access'],
  },
  gemini: {
    id: 'gemini',
    command: 'gemini',
    defaultArgs: ['--acp'],
    modes: { readOnly: undefined, writePaths: undefined, engineering: undefined },
    forbiddenModes: [],
  },
  copilot: {
    id: 'copilot',
    command: 'copilot',
    defaultArgs: ['--acp'],
    modes: { readOnly: undefined, writePaths: undefined, engineering: undefined },
    forbiddenModes: [],
  },
  own: {
    id: 'own',
    command: 'muse-spark-code-acp',
    defaultArgs: [],
    modes: { readOnly: undefined, writePaths: undefined, engineering: undefined },
    forbiddenModes: [],
  },
}

/** No captured mode meets the role, or the agent does not offer it. */
export class AcpModeError extends Error {
  public constructor(
    readonly preset: AcpPresetId,
    readonly shape: AcpRoleShape,
  ) {
    super(`No captured mode lets ${preset} take a ${shape} role`)
    this.name = 'AcpModeError'
  }
}

/** The agent advertised a mode that skips asking: never chosen. */
export class AcpForbiddenModeError extends Error {
  public constructor(readonly mode: string) {
    super(`A worker never takes the ${mode} mode`)
    this.name = 'AcpForbiddenModeError'
  }
}

/**
 * Chooses the preset's captured mode for the role's shape. The mode must be
 * one the agent advertises in `initialize`; a forbidden mode is refused even
 * when advertised. Anything else is `AcpModeError`, never a neighbouring mode.
 */
export function chooseAcpMode(
  preset: AcpPreset,
  shape: AcpRoleShape,
  advertisedModes: readonly string[],
): string {
  const mode = preset.modes[shape]
  if (mode === undefined) {
    throw new AcpModeError(preset.id, shape)
  }
  if (preset.forbiddenModes.includes(mode)) {
    throw new AcpForbiddenModeError(mode)
  }
  if (!advertisedModes.includes(mode)) {
    throw new AcpModeError(preset.id, shape)
  }
  return mode
}

/** A tool call the agent asks about, in the SDK's shape. */
export interface AcpPermissionToolCall {
  readonly toolCallId: string
  readonly title: string
  readonly kind?: string | null | undefined
  readonly locations?: readonly { readonly path: string }[]
  readonly rawInput?: unknown
}

/** A permission option the agent offers. Only the once kinds reach the user. */
export interface AcpPermissionOption {
  readonly optionId: string
  readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

/**
 * Picks the once option for the verdict. `allow_always` is never forwarded:
 * the agent must never store an "always" the extension cannot see.
 */
export function pickOnceOption(
  options: readonly AcpPermissionOption[],
  shouldAllow: boolean,
): string | undefined {
  const wanted = shouldAllow ? 'allow_once' : 'reject_once'
  return options.find((option) => option.kind === wanted)?.optionId
}

/**
 * Collects the paths a permission request names: `locations`, plus absolute
 * paths in `rawInput` down to two levels. Past the cap the request is
 * unresolvable, so it is rejected rather than half-checked.
 */
export interface ExtractedRequestPaths {
  readonly paths: readonly string[]
  /** Past the cap the request is unresolvable, so the caller rejects it rather than half-checking. */
  readonly isTruncated: boolean
}

const ACP_WRITE_KINDS: ReadonlySet<string> = new Set(['edit', 'delete', 'move'])

export function extractRequestPaths(rawInput: unknown): ExtractedRequestPaths {
  const paths: string[] = []
  let isTruncated = false
  const visit = (value: unknown, depth: number, isPath = false): void => {
    if (isTruncated) {
      return
    }
    if (paths.length >= WORKER_ACP_MAX_PERMISSION_PATHS) {
      isTruncated = true
      return
    }
    if (typeof value === 'string') {
      if (
        isPath ||
        value.startsWith('/') ||
        /^[a-zA-Z]:[\\/]/.test(value) ||
        value.startsWith('\\\\')
      ) {
        paths.push(value)
      }
      return
    }
    if (value === null || typeof value !== 'object') return
    if (depth <= 0) {
      isTruncated = true
      return
    }
    for (const [key, entry] of Object.entries(value)) {
      visit(
        entry,
        depth - 1,
        isPath ||
          /^(?:path|paths|file|files|file_?path|source|destination|old_?path|new_?path)$/i.test(
            key,
          ),
      )
    }
  }
  visit(rawInput, 2)
  return { paths, isTruncated }
}

export type AcpPermissionVerdict =
  | { readonly action: 'allowOnce' }
  | { readonly action: 'rejectOnce' }
  | { readonly action: 'askUser' }

export interface AcpPermissionInput {
  readonly role: WorkerRolePolicy
  /** The task's working copy or scratch copy: every path must resolve inside it. */
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  readonly dialect: ShellDialect
  /** Lane 0's `TEAM_READ_ONLY_COMMANDS`, injected until it lands. */
  readonly readOnlyCommands: ReadonlySet<string>
  readonly testCommands?: ReadonlySet<string>
  readonly toolCall: AcpPermissionToolCall
}

/**
 * Answers a `session/request_permission` by the role's policy. Rejected
 * without asking: paths outside the working copy (links followed), an edit
 * outside `write-paths`, an `execute` for a role without the shell, a git
 * command the ref guard refuses, a `fetch` for a role without the network,
 * and for a `read-only` role any edit and any command off the read-only
 * list. Everything else becomes the user's card.
 */
export async function answerAcpPermission(
  input: AcpPermissionInput,
): Promise<AcpPermissionVerdict> {
  const { role, toolCall } = input
  const extracted = extractRequestPaths(toolCall.rawInput)
  if (extracted.isTruncated) {
    return { action: 'rejectOnce' }
  }
  const candidates = [
    ...(toolCall.locations ?? []).map((location) => location.path),
    ...extracted.paths,
  ]
  for (const candidate of candidates) {
    const confined = await confineWorkspacePath(input.folder, candidate, input.platform, input.io)
    if (!confined.ok) {
      return { action: 'rejectOnce' }
    }
  }
  const kind = toolCall.kind ?? 'other'
  const isWrite = ACP_WRITE_KINDS.has(kind)
  if (isWrite && (candidates.length === 0 || role.workspaceMode === 'read-only')) {
    return { action: 'rejectOnce' }
  }
  if (isWrite && !(await isWithinWritePaths(input, candidates))) {
    return { action: 'rejectOnce' }
  }
  if (kind === 'execute') {
    return { action: isCommandAllowed(input) ? 'askUser' : 'rejectOnce' }
  }
  if (isWrite) return { action: 'askUser' }
  if (kind === 'fetch')
    return { action: role.toolGroups.includes('webFetch') ? 'askUser' : 'rejectOnce' }
  return {
    action:
      (kind === 'read' || kind === 'search') &&
      role.toolGroups.includes('read') &&
      candidates.length > 0
        ? 'askUser'
        : 'rejectOnce',
  }
}

async function isWithinWritePaths(
  input: Pick<AcpPermissionInput, 'role' | 'folder' | 'platform' | 'io'>,
  candidates: readonly string[],
): Promise<boolean> {
  for (const candidate of candidates) {
    if (!(await isWorkerWriteAllowed(input, candidate))) return false
  }
  return candidates.length > 0
}

/** Whether the role may run the command in the request's raw input. */
function isCommandAllowed(input: AcpPermissionInput): boolean {
  const command = commandTextOf(input.toolCall.rawInput)
  return command !== undefined && isWorkerCommandAllowed({ ...input, command })
}

/** The command a raw input carries, when it names one plainly. */
function commandTextOf(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null) {
    return undefined
  }
  return 'command' in rawInput && typeof rawInput.command === 'string'
    ? rawInput.command
    : undefined
}

/** Confines an `fs/*` path to the working copy, links followed. */
export async function confineAcpFsPath(input: {
  readonly folder: string
  readonly given: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
}): Promise<{ readonly ok: true; readonly absolute: string } | { readonly ok: false }> {
  const confined = await confineWorkspacePath(input.folder, input.given, input.platform, input.io)
  return confined.ok ? { ok: true, absolute: confined.absolute } : { ok: false }
}

export interface AcpFsInput {
  readonly role: WorkerRolePolicy
  readonly folder: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  readonly readTextFile: (absolutePath: string) => Promise<string | undefined>
  readonly writeTextFile: (absolutePath: string, content: string) => Promise<void>
}

/**
 * Serves `fs/read_text_file` inside the working copy only. Client file
 * methods enforce nothing on agents with their own tools (research §4.5);
 * the confinement still binds every agent that routes through them.
 */
export async function acpFsRead(
  input: AcpFsInput,
  given: string,
): Promise<{ readonly content: string } | { readonly error: string }> {
  const confined = await confineAcpFsPath({ ...input, given })
  if (!confined.ok) {
    return { error: 'outside the working copy' }
  }
  const content = await input.readTextFile(confined.absolute)
  return content === undefined ? { error: 'unreadable' } : { content }
}

/** Serves `fs/write_text_file`: a `read-only` role never writes, and writers stay under `write-paths`. */
export async function acpFsWrite(
  input: AcpFsInput,
  given: string,
  content: string,
): Promise<{ readonly ok: true } | { readonly error: string }> {
  const confined = await confineAcpFsPath({ ...input, given })
  if (!confined.ok) {
    return { error: 'outside the working copy' }
  }
  if (input.role.workspaceMode === 'read-only') {
    return { error: 'the role is read-only' }
  }
  if (!(await isWithinWritePaths(input, [given]))) {
    return { error: 'outside the write paths' }
  }
  await input.writeTextFile(confined.absolute, content)
  return { ok: true }
}

/** The agent side the runner drives; the SDK adapter lives in lane W's `acpProcess`. */
export interface AcpAgentConnection {
  readonly initialize: () => Promise<{
    readonly protocolVersion: number
    readonly authMethods: readonly AuthMethod[]
  }>
  readonly sessionNew: (params: {
    readonly cwd: string
    readonly mcpServers: readonly McpServer[]
  }) => Promise<{ readonly sessionId: string; readonly advertisedModes: readonly string[] }>
  /** `session/set_config_option`, category `mode`; throws `AcpMethodNotFoundError` when absent. */
  readonly setConfigOption: (sessionId: string, value: string) => Promise<void>
  /** Deprecated `session/set_mode`, for agents that predate config options. */
  readonly setMode: (sessionId: string, mode: string) => Promise<void>
  readonly prompt: (
    sessionId: string,
    text: string,
  ) => Promise<{ readonly stopReason: string; readonly lastMessage: string | undefined }>
  readonly cancel: (sessionId: string) => Promise<void>
  readonly close: () => void
}

/** Native user-server exclusion is a required launcher admission condition. */
export class AcpNativeServersError extends Error {
  public constructor() {
    super('An ACP worker requires captured native-server isolation')
    this.name = 'AcpNativeServersError'
  }
}

/** The agent's `authenticate` must not run for a terminal method (research §4.1). */
export class AcpAuthRequiredError extends Error {
  public constructor(readonly methods: readonly AuthMethod[]) {
    super('The external agent needs a sign-in first')
    this.name = 'AcpAuthRequiredError'
  }
}

export interface AcpWorkerDeps {
  readonly task: WorkerTask
  readonly role: WorkerRolePolicy
  readonly preset: AcpPreset
  readonly prompt: WorkerPromptParts
  readonly modelId?: string
  readonly workspaceRoot: string
  /** Set only by a launcher that applied the captured native-server exclusion switch. */
  readonly nativeServersExcluded: boolean
  readonly isTrusted: boolean
  readonly io: WorkerFileIo
  readonly platform: NodeJS.Platform
  /** The bridge's servers for `session/new` (lane B). */
  readonly bridgeServers: readonly McpServer[]
  readonly connection: AcpAgentConnection
}

/**
 * Runs one external worker's task: `initialize`, `session/new` with the
 * working copy as `cwd` and the bridge's servers, the preset's captured mode
 * for the role's shape, then the prompt. A terminal sign-in surfaces as
 * `AcpAuthRequiredError` for the host's terminal flow; no vendor credential
 * file is ever read.
 */
export async function runAcpWorker(deps: AcpWorkerDeps): Promise<{
  readonly sessionId: string
  readonly report: WorkerReportOutcome
  readonly cancel: () => Promise<void>
}> {
  if (!deps.isTrusted) {
    throw new WorkerUntrustedError()
  }
  await assertWorkerRoot({ ...deps, folder: deps.task.folder })
  if (deps.role.workspaceMode === 'in-place' || !deps.nativeServersExcluded) {
    throw new AcpNativeServersError()
  }
  try {
    await deps.connection.initialize()
  } catch (error: unknown) {
    throw asAcpError(error)
  }
  let sessionId: string
  let advertisedModes: readonly string[]
  try {
    ;({ sessionId, advertisedModes } = await deps.connection.sessionNew({
      cwd: deps.task.folder,
      mcpServers: deps.bridgeServers,
    }))
  } catch (error: unknown) {
    throw asAcpError(error)
  }
  const mode = chooseAcpMode(deps.preset, roleShapeFor(deps.role), advertisedModes)
  try {
    await deps.connection.setConfigOption(sessionId, mode)
  } catch (error: unknown) {
    if (error instanceof AcpMethodNotFoundError) {
      await deps.connection.setMode(sessionId, mode)
    } else {
      throw asAcpError(error)
    }
  }
  const prompt = await buildWorkerPrompt(deps.prompt, deps.task, deps.io, deps.platform)
  let lastMessage: string | undefined
  try {
    ;({ lastMessage } = await deps.connection.prompt(sessionId, prompt))
  } catch (error: unknown) {
    throw asAcpError(error)
  }
  return {
    sessionId,
    report: extractTeamReport(lastMessage ?? ''),
    cancel: () => deps.connection.cancel(sessionId),
  }
}

/** A wire shape the captures have not shown. */
export class AcpMethodNotFoundError extends Error {
  public constructor(readonly method: string) {
    super(`The agent does not serve ${method}`)
    this.name = 'AcpMethodNotFoundError'
  }
}

/** Maps the adapter's errors: `auth_required` becomes the sign-in handoff, never a retry. */
export function asAcpError(error: unknown): unknown {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { readonly code?: unknown }).code
      : undefined
  return code === 'auth_required' ? new AcpAuthRequiredError([]) : error
}
