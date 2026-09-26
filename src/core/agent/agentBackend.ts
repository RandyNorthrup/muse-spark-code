// The internal agent protocol both backends implement (PLAN.md D1): the
// Muse Code host (MSP over `muse serve`, M2–M6) and the Model API backend
// (direct HTTPS with an in-process tool harness, M7). The conversation
// controller and the webview see only these interfaces and the AgentEvent
// union, never which backend is active.

import type {
  AgentEvent,
  ItemSnapshot,
  QuestionAnswer,
  RequirementRef,
  SessionGoal,
  TodoItem,
} from '../../shared/agentEvents'
import type { GoalCommandVerb, SubagentAction } from '../../shared/constants'
import type { SubscriptionUsage } from '../../shared/usage'

export type BackendKind = 'museCode' | 'modelApi'

/** How a backend process ended, as the conversations need to know it (PLAN.md D25). */
export interface HostExit {
  /** For the log and the notice: the code or signal, and what it means. */
  readonly description: string
  /** The extension closed it on purpose (a restart, a sign-out): not a crash. */
  readonly isExpected: boolean
  /** The process refuses to run as configured (a bad setting, an old build): restarting will not help. */
  readonly isPersistent: boolean
}

/**
 * A command named a session the host no longer holds (MSP `sessionNotLoaded`:
 * evicted, or closed by the host). The caller resumes it and retries.
 */
export class SessionNotLoadedError extends Error {
  public constructor(
    public readonly sessionId: string,
    message: string,
  ) {
    super(message)
    this.name = 'SessionNotLoadedError'
  }
}

/** Why the host refused a decision or answer that arrived too late (PLAN.md D26). */
export type PromptSettledReason = 'alreadySettled' | 'movedOn' | 'gone'

/**
 * The prompt was answered elsewhere, advanced to another stage, or is no
 * longer pending when this decision or answer arrived. Nothing is wrong: the
 * card follows the host's own resolve / update events.
 */
export class PromptSettledError extends Error {
  public constructor(
    public readonly reason: PromptSettledReason,
    message: string,
  ) {
    super(message)
    this.name = 'PromptSettledError'
  }
}

/**
 * Why a goal command was refused (M45, PLAN.md D38), as MSP's `commandRejected`
 * reasons say it (captured live 2026-09-25): `missing_goal` (there is none)
 * and `invalid_goal_state` (a finished goal cannot be paused, resumed or
 * edited). The Model API backend refuses in the same words.
 */
export type GoalRefusal = 'noGoal' | 'wrongState'

export class GoalRefusedError extends Error {
  public constructor(
    public readonly refusal: GoalRefusal,
    message: string,
  ) {
    super(message)
    this.name = 'GoalRefusedError'
  }
}

/** A goal command (M45): MSP `goal/<verb>`; `set` and `edit` carry the objective. */
export type GoalCommand =
  | { readonly verb: Extract<GoalCommandVerb, 'set' | 'edit'>; readonly objective: string }
  | { readonly verb: Extract<GoalCommandVerb, 'pause' | 'resume' | 'clear'> }

/** What a goal command started: the turn it woke or joined, when it names one. */
export interface GoalCommandOutcome {
  readonly turnId: string | undefined
}

export interface HostInfo {
  readonly kind: BackendKind
  readonly serverName: string
  readonly serverVersion: string
  /** Capabilities the host granted at handshake (`sessionMcp`, …). */
  readonly grantedCapabilities: readonly string[]
  /** False where the host is known to refuse `rename` and `forkSession` (D26). */
  readonly canEditSessions: boolean
}

export interface ModelSummary {
  readonly modelId: string
  readonly displayLabel: string
  readonly contextLimit: number | undefined
  readonly isDefault: boolean
  readonly isActive: boolean
}

export interface SkillSummary {
  readonly selector: string
  readonly displayName: string
  readonly description: string
  readonly argumentHint: string | undefined
}

/** A per-session MCP server over streamable HTTP (MSP `SessionMcpServerConfig`). */
export interface SessionMcpHttpServer {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

/** A per-session MCP server the host starts as a child process (MSP `stdio`; M63c, an ACP client's). */
export interface SessionMcpStdioServer {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export type SessionMcpServer = SessionMcpHttpServer | SessionMcpStdioServer

export interface StartSessionOptions {
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: string
  /** Tool servers, keyed by name: the IDE's, or an ACP client's; needs the `sessionMcp` grant. */
  readonly mcpServers?: Readonly<Record<string, SessionMcpServer>>
}

/** One ordered content part of a turn (MSP `TurnInputPart`). */
export type TurnPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image'
      readonly base64Data: string
      readonly mediaType: string
      readonly width: number
      readonly height: number
    }
  | { readonly type: 'skill'; readonly selector: string; readonly arguments?: string }

export interface TurnSubmission {
  readonly turnId: string
  /** `started`, `queued` or `steered` (open on the wire). */
  readonly disposition: string
}

export interface CompactOutcome {
  readonly status: string
  readonly reason: string | undefined
}

export interface ApprovalDecision {
  readonly approvalId: string
  readonly choiceId: string
  readonly requirementId: RequirementRef
  /** Only for choices with `acceptsFeedback`; delivered to the model. */
  readonly feedback?: string
}

export interface OutputPageRequest {
  readonly itemId: string
  readonly outputRef: string
  readonly offsetBytes: number
  readonly lengthBytes: number
}

export interface OutputPage {
  readonly content: string
  readonly encoding: string
  readonly mediaType: string
  readonly offsetBytes: number
  readonly byteLen: number
  readonly eof: boolean
}

export type SessionEventListener = (event: AgentEvent) => void

export interface ListSessionsOptions {
  readonly workspaceRoot: string
  readonly limit: number
  readonly cursor?: string
}

/** A stored session as the host lists it (the MSP `Session` object, narrowed). */
export interface SessionRecord {
  readonly sessionId: string
  readonly name?: string | undefined
  readonly title?: string | undefined
  readonly firstUserPrompt?: string | undefined
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastActivityAt?: string | undefined
  readonly branch?: string | undefined
  readonly status: string
  readonly turnCount: number
  readonly forkedFrom?: { readonly sessionId: string } | null | undefined
  readonly workspaceRoot?: string | null | undefined
}

export interface SessionPage {
  readonly sessions: readonly SessionRecord[]
  readonly nextCursor: string | undefined
}

/** What a resumed or forked session's history yields for the transcript. */
export interface SessionHistoryOutcome {
  /** `inline`, `snapshot`, `anchoredSnapshot` or `none` (then `items` is empty). */
  readonly mode: string
  readonly items: readonly ItemSnapshot[]
  readonly name: string | undefined
  readonly todos: readonly TodoItem[]
  /**
   * The session goal (M45): `null` when the history says there is none,
   * undefined when it cannot say (Muse Code's inline history carries no
   * goal; its snapshot does).
   */
  readonly goal?: SessionGoal | null
}

/** A session loaded by resume or minted by fork (M6). */
export interface LoadedSession {
  readonly session: AgentSession
  readonly record: SessionRecord
  readonly history: SessionHistoryOutcome
  /** The turn running in the session as it was loaded, if any (D26). */
  readonly activeTurnId: string | undefined
}

/** A stored session changed (a full row) or was unloaded. */
export type SessionListEvent =
  | { readonly type: 'changed'; readonly record: SessionRecord }
  | { readonly type: 'closed'; readonly sessionId: string; readonly reason: string }

/** One live conversation on a host. */
export interface AgentSession {
  readonly sessionId: string
  readonly modelId: string
  onEvent(listener: SessionEventListener): () => void
  /**
   * Submit a turn. `displayText` is the transcript's presentation form of
   * the prompt, used when the parts carry more than the user typed (M5).
   */
  sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission>
  /** Inject input into the running turn; rejects when it is no longer running. */
  steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<string>
  cancel(): Promise<void>
  setModel(modelId: string): Promise<void>
  /** The session's standing reasoning-effort default (wire vocabulary). */
  setReasoningEffort(reasoningEffort: string): Promise<void>
  /** One of the four MSP approval modes (shared/permissionModes.ts). */
  setApprovalMode(mode: string): Promise<void>
  compact(): Promise<CompactOutcome>
  decideApproval(decision: ApprovalDecision): Promise<void>
  answerQuestions(userInputId: string, answers: readonly QuestionAnswer[]): Promise<void>
  /** Decline the prompt: the tool call resolves with a cancelled result the model sees (M16). */
  cancelQuestions(userInputId: string): Promise<void>
  /**
   * Answer with an explanation instead of the options (MSP `userInput/clarify`,
   * M46): the model reads it and decides again.
   */
  clarifyQuestions(userInputId: string, text: string): Promise<void>
  /**
   * Move a running tool call to the background, its row's id naming it (MSP
   * `task/background`, the TUI's Ctrl+B, M46): the turn goes on without it.
   */
  moveToBackground(taskId: string): Promise<void>
  /** Stop one background task (`task/stop`), or every one (`task/stopAll`), M46. */
  stopTask(taskId: string): Promise<void>
  stopAllTasks(): Promise<void>
  /**
   * The user's own shell command, the TUI's `!` (MSP `session/userShell`,
   * M46): it runs outside any turn, its row arrives as a `userShell` item,
   * and the model sees it with its next request.
   */
  runUserShell(command: string): Promise<void>
  /** An owner command on a native subagent (M18): MSP `subagent/<action>`. */
  controlSubagent(subagentId: string, action: SubagentAction): Promise<void>
  /** A note to a running subagent (`subagent/sendMessage`) or a follow-up task for one that finished (`subagent/followupTask`), M18. */
  messageSubagent(subagentId: string, body: string, isFollowup: boolean): Promise<void>
  /**
   * The session goal's verbs (M45, PLAN.md D38): MSP `goal/<verb>`. Admission
   * only: the goal itself arrives as `goalChanged`. A refusal is a
   * `GoalRefusedError`.
   */
  controlGoal(command: GoalCommand): Promise<GoalCommandOutcome>
  readOutput(request: OutputPageRequest): Promise<OutputPage>
  listSkills(): Promise<readonly SkillSummary[]>
  /** Resolves to the canonical name, or undefined when it arrives as an event. */
  rename(name: string): Promise<string | undefined>
  dispose(): void
}

/** One backend process or connection, multiplexing sessions. */
export interface AgentHost {
  readonly info: HostInfo
  onExit(listener: (exit: HostExit) => void): () => void
  listModels(sessionId?: string): Promise<readonly ModelSummary[]>
  startSession(options: StartSessionOptions): Promise<AgentSession>
  listSessions(options: ListSessionsOptions): Promise<SessionPage>
  /** A session's transcript without loading it (a subagent's child session, M14). */
  readSession(
    sessionId: string,
    options?: { readonly recoverGoal?: boolean },
  ): Promise<SessionHistoryOutcome>
  resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpServer>>,
  ): Promise<LoadedSession>
  forkSession(sessionId: string, modelId: string, lastTurnId?: string): Promise<LoadedSession>
  onSessionListEvent(listener: (event: SessionListEvent) => void): () => void
  /**
   * The subscription usage the host last observed (M8); undefined when there
   * is none: a key-billed backend, or a CLI that has not seen a usage frame
   * yet (it reports one after a turn).
   */
  readUsage(): Promise<SubscriptionUsage | undefined>
  /** A fresh observation arrived (MSP `usage/changed`). */
  onUsageChanged(listener: (usage: SubscriptionUsage) => void): () => void
  readonly sessionCount: number
  close(): Promise<void>
}
