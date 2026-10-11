// The ACP client worker (M96 lane W, PLAN.md D75): `initialize`, terminal
// sign-in handoff, `session/new` with `cwd` and the bridge's servers, each
// preset's mode choice, the permission answers, confined `fs/*`, and cancel.
//
// The mode tables come from the research (§4.2–§4.4, docs and source, no
// prompt); step 1's captures confirm them and fill each preset's switch for
// leaving out the user's own MCP servers. A shape the captures have not
// shown is refused, never guessed.

import { WORKER_CANCEL_GRACE_MS } from '../../../shared/constants'
import type { AuthMethod, McpServer } from '@agentclientprotocol/sdk'
import type { ShellDialect } from '../../backends/modelapi/shellSyntax'
import { buildWorkerPrompt, WorkerUntrustedError, type WorkerFileIo } from './engineWorker'
import { awaitWorkerAction, WorkerCancelledError } from './museCodeWorker'
import { reportForStop, type WorkerReportOutcome } from './report'
import {
  assertWorkerRoot,
  requireAcpNativeIsolation,
  confineWorkerPath,
  isCheckedWorkerWriteAllowed,
  withWorkerFile,
  recheckWorkerRoot,
  type WorkerRootGrant,
  type WorkerFenceIo,
} from './workerFence'
export { AcpNativeServersError, answerAcpPermission, extractRequestPaths } from './workerFence'
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

export type AcpPermissionVerdict =
  | { readonly action: 'allowOnce' }
  | { readonly action: 'rejectOnce' }
  | { readonly action: 'askUser' }

export interface AcpPermissionInput {
  readonly grant?: WorkerRootGrant
  readonly role: WorkerRolePolicy
  /** The task's working copy or scratch copy: every path must resolve inside it. */
  readonly folder: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  readonly dialect: ShellDialect
  /** Lane 0's `TEAM_READ_ONLY_COMMANDS`, injected until it lands. */
  readonly readOnlyCommands: ReadonlySet<string>
  readonly testCommands?: ReadonlySet<string>
  readonly toolCall: AcpPermissionToolCall
}

/** Confines an `fs/*` path to the working copy, links followed. */
export async function confineAcpFsPath(input: {
  readonly folder: string
  readonly workspaceRoot: string
  readonly given: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
}): Promise<{ readonly ok: true; readonly absolute: string } | { readonly ok: false }> {
  const confined = await confineWorkerPath(input, input.given)
  return confined.ok ? { ok: true, absolute: confined.absolute } : { ok: false }
}

export interface AcpFsInput {
  readonly role: WorkerRolePolicy
  readonly folder: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  readonly grant?: WorkerRootGrant
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
  try {
    return await withWorkerFile(input, given, false, async (handle) => {
      const content = await handle.read(Number.MAX_SAFE_INTEGER)
      return content === undefined ? { error: 'unreadable' } : { content }
    })
  } catch {
    return { error: 'outside the working copy' }
  }
}

/** Serves `fs/write_text_file`: a `read-only` role never writes, and writers stay under `write-paths`. */
export async function acpFsWrite(
  input: AcpFsInput,
  given: string,
  content: string,
): Promise<{ readonly ok: true } | { readonly error: string }> {
  try {
    return await withWorkerFile(input, given, true, async (handle, confined) => {
      if (!isCheckedWorkerWriteAllowed(input.role, confined))
        return {
          error:
            input.role.workspaceMode === 'read-only'
              ? 'the role is read-only'
              : 'outside the write paths',
        }
      await handle.write(content)
      return { ok: true }
    })
  } catch {
    return { error: 'outside the working copy' }
  }
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
    readonly grant: WorkerRootGrant
  }) => Promise<{
    readonly sessionId: string
    readonly advertisedModes: readonly string[]
    readonly currentMode?: string
  }>
  /** `session/set_config_option`, category `mode`; throws `AcpMethodNotFoundError` when absent. */
  readonly setConfigOption: (sessionId: string, value: string) => Promise<void>
  /** Deprecated `session/set_mode`, for agents that predate config options. */
  readonly setMode: (sessionId: string, mode: string) => Promise<void>
  /** Selects and reads back the current model; absence/mismatch is an error. */
  readonly setModel: (sessionId: string, modelId: string) => Promise<string>
  readonly checkMode: (sessionId: string, mode: string) => void
  readonly prompt: (
    sessionId: string,
    text: string,
  ) => Promise<{ readonly stopReason: string; readonly lastMessage: string | undefined }>
  readonly cancel: (sessionId: string) => Promise<void>
  readonly close: () => void
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
  readonly modelId: string
  readonly workspaceRoot: string
  /** Set only by a launcher that applied the captured native-server exclusion switch. */
  readonly nativeServersExcluded: boolean
  readonly isTrusted: boolean
  readonly io: WorkerFileIo
  readonly platform: NodeJS.Platform
  /** The bridge's servers for `session/new` (lane B). */
  readonly bridgeServers: readonly McpServer[]
  readonly connection: AcpAgentConnection
  readonly signal: AbortSignal
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
}> {
  let sessionId: string | undefined
  try {
    deps.signal.throwIfAborted()
    if (!deps.isTrusted) throw new WorkerUntrustedError()
    const grant = await awaitWorkerAction(deps.signal, () =>
      assertWorkerRoot({ ...deps, folder: deps.task.folder }),
    )
    const folder = grant.absolute
    requireAcpNativeIsolation(deps.nativeServersExcluded)
    const initialized = await awaitWorkerAction(deps.signal, () => deps.connection.initialize())
    if (initialized.protocolVersion !== 1)
      throw new Error('The ACP worker requires protocol version 1')
    const opened = await awaitWorkerAction(deps.signal, async () => {
      await recheckWorkerRoot({ ...deps, folder: deps.task.folder }, grant)
      const response = await deps.connection.sessionNew({
        cwd: folder,
        mcpServers: deps.bridgeServers,
        grant,
      })
      if (deps.signal.aborted) {
        void deps.connection.cancel(response.sessionId).catch(() => {
          /* Cleanup still follows when the peer is gone. */
        })
        throw new WorkerCancelledError()
      }
      return response
    })
    sessionId = opened.sessionId
    if (opened.currentMode !== undefined && deps.preset.forbiddenModes.includes(opened.currentMode))
      throw new AcpForbiddenModeError(opened.currentMode)
    const activeId = sessionId
    const mode = chooseAcpMode(deps.preset, roleShapeFor(deps.role), opened.advertisedModes)
    try {
      await awaitWorkerAction(deps.signal, () => deps.connection.setConfigOption(activeId, mode))
    } catch (error: unknown) {
      if (!(error instanceof AcpMethodNotFoundError)) throw error
      await awaitWorkerAction(deps.signal, () => deps.connection.setMode(activeId, mode))
    }
    const selectedModel = await awaitWorkerAction(deps.signal, () =>
      deps.connection.setModel(activeId, deps.modelId),
    )
    if (selectedModel !== deps.modelId || selectedModel.trim() === '')
      throw new AcpModelSelectionError()
    deps.connection.checkMode(activeId, mode)
    const prompt = await awaitWorkerAction(deps.signal, () =>
      buildWorkerPrompt(
        deps.prompt,
        { ...deps.task, folder },
        deps.io,
        deps.platform,
        deps.workspaceRoot,
        false,
        grant,
      ),
    )
    await recheckWorkerRoot({ ...deps, folder: deps.task.folder }, grant)
    deps.connection.checkMode(activeId, mode)
    const { lastMessage, stopReason } = await awaitWorkerAction(deps.signal, () =>
      deps.connection.prompt(activeId, prompt),
    )
    await recheckWorkerRoot({ ...deps, folder: deps.task.folder }, grant)
    return { sessionId: activeId, report: reportForStop(lastMessage ?? '', stopReason) }
  } catch (error: unknown) {
    if (sessionId !== undefined) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            deps.connection.cancel(sessionId),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, WORKER_CANCEL_GRACE_MS)
            }),
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      } catch {
        /* Finally closes an unreachable peer. */
      }
    }
    throw asAcpError(error)
  } finally {
    deps.connection.close()
  }
}

/** Offered-model membership cannot prove which model actually ran. */
export class AcpModelSelectionError extends Error {
  public constructor() {
    super('The ACP worker did not confirm its selected model')
    this.name = 'AcpModelSelectionError'
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
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return code === 'auth_required' ? new AcpAuthRequiredError([]) : error
}
