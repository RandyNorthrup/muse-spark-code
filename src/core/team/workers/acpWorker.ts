// The ACP client worker (M96 lane W, PLAN.md D75): `initialize`, terminal
// sign-in handoff, `session/new` with `cwd` and the bridge's servers, each
// preset's mode choice, the permission answers, confined `fs/*`, and cancel.
//
// The mode tables come from the research (§4.2–§4.4, docs and source, no
// prompt); step 1's captures confirm them and fill each preset's switch for
// leaving out the user's own MCP servers. A shape the captures have not
// shown is refused, never guessed.

import type { AuthMethod, McpServer } from '@agentclientprotocol/sdk'
import { type WorkerRootGrant } from './workerFence'

/** An external agent preset (D75's list). */
export type AcpPresetId = 'claude' | 'codex' | 'gemini' | 'copilot' | 'own'

/** A role's shape for mode choice: what the mode must hold. */
type AcpRoleShape = 'readOnly' | 'writePaths' | 'engineering'

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
