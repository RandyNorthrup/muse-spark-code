// The internal agent protocol both backends implement (PLAN.md D1): the
// Muse Code host (MSP over `muse serve`, M2–M6) and the Model API backend
// (direct HTTPS with an in-process tool harness, M7). The conversation
// controller and the webview see only these interfaces and the AgentEvent
// union, never which backend is active.

import type {
  AgentEvent,
  ElicitationReply,
  ItemSnapshot,
  QuestionAnswer,
  RequirementRef,
  SessionGoal,
  TodoItem,
} from '../../shared/agentEvents'
import type { GoalCommandVerb, ModelPricing, SubagentAction } from '../../shared/constants'
import type { PlanUsageRow, SubscriptionUsage } from '../../shared/usage'
export type { QuestionDeferralPort } from '../../shared/questions'
import type {
  ScheduleCadence,
  ScheduledPrompt,
  ScheduleRunConfirmation,
} from '../../shared/schedule'
import type { ApprovalMode } from '../../shared/permissionModes'
import type { SessionExport } from '../export/sessionTransfer'
import type { ExtensionHookDispatch, ExtensionHookEvent } from '../backends/modelapi/extensionHooks'

export type BackendKind = 'museCode' | 'modelApi'

/** Shared empty result; importing it never loads a backend bundle. */
export const NO_EXTENSION_HOOK_DISPATCH: ExtensionHookDispatch = {
  refusedReason: undefined,
  failedReason: undefined,
  messages: [],
  contexts: [],
  displayText: undefined,
  allowedTools: undefined,
  answer: undefined,
  hasAnswer: false,
  output: '',
  keepWorking: false,
  keepReason: undefined,
  attemptFailed: undefined,
}

/** How a backend process ended, as the conversations need to know it (PLAN.md D25). */
export interface HostExit {
  /** For the log and the notice: the code or signal, and what it means. */
  readonly description: string
  /** The extension closed it on purpose (a restart, a sign-out): not a crash. */
  readonly isExpected: boolean
  /** The process refuses to run as configured (a bad setting, an old build): restarting will not help. */
  readonly isPersistent: boolean
}

// The three errors below cross from a host to the conversation controller.
// The Model API host runs from a bundle of its own, loaded on first use
// (M57, PLAN.md D6), which carries its own copy of these classes, so
// `instanceof` misses an error that host threw. Callers test with the
// `is…` guards instead, which read the name and the field every copy sets;
// the lint config refuses `instanceof` on these classes in src/.
const SESSION_NOT_LOADED_ERROR = 'SessionNotLoadedError'
const PROMPT_SETTLED_ERROR = 'PromptSettledError'
const GOAL_REFUSED_ERROR = 'GoalRefusedError'
const MUSE_CODE_FAULT_ERROR = 'MuseCodeFaultError'
const DECISION_NOT_APPLIED_ERROR = 'DecisionNotAppliedError'
const STEER_REFUSED_ERROR = 'SteerRefusedError'

/** An `Error` of either bundle carrying the given name. */
function isNamedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name
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
    this.name = SESSION_NOT_LOADED_ERROR
  }
}

/** Whether a host refused a command for a session it no longer holds. */
export function isSessionNotLoadedError(error: unknown): error is SessionNotLoadedError {
  return (
    isNamedError(error, SESSION_NOT_LOADED_ERROR) &&
    'sessionId' in error &&
    typeof error.sessionId === 'string'
  )
}

/** Why the host refused a decision or answer that arrived too late (PLAN.md D26). */
export type PromptSettledReason = 'alreadySettled' | 'movedOn' | 'gone'

const PROMPT_SETTLED_REASONS: readonly unknown[] = [
  'alreadySettled',
  'movedOn',
  'gone',
] satisfies readonly PromptSettledReason[]

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
    this.name = PROMPT_SETTLED_ERROR
  }
}

/** Whether a host refused a decision or answer because its prompt had settled. */
export function isPromptSettledError(error: unknown): error is PromptSettledError {
  return (
    isNamedError(error, PROMPT_SETTLED_ERROR) &&
    'reason' in error &&
    PROMPT_SETTLED_REASONS.includes(error.reason)
  )
}

/**
 * A fault inside Muse Code that no choice of the user's caused (PLAN.md D26,
 * captured live 2026-10-02 on Muse Code 1.4.2):
 * - `approvalReplay`: every `turn/start` of the session fails with "approval
 *   replay failed: decision stage evidence contains an unrecorded human
 *   resolution" after a turn stopped while a multi-stage approval had a
 *   decided stage. A restart of `muse serve` lets the session run again.
 * - `approvalLedger`: `approval/decide` applied the decision, then answered
 *   "approval decide settlement failed: approval ledger durability fence…"
 *   (meta-models/muse-code-sdk#29); after the replay fault it does so for
 *   every decision of that session.
 */
export type MuseCodeFault = 'approvalReplay' | 'approvalLedger'

const MUSE_CODE_FAULTS: readonly unknown[] = [
  'approvalReplay',
  'approvalLedger',
] satisfies readonly MuseCodeFault[]

export class MuseCodeFaultError extends Error {
  public constructor(
    public readonly fault: MuseCodeFault,
    message: string,
  ) {
    super(message)
    this.name = MUSE_CODE_FAULT_ERROR
  }
}

/** Whether Muse Code failed a command on a fault of its own (`MuseCodeFaultError`). */
export function isMuseCodeFaultError(error: unknown): error is MuseCodeFaultError {
  return (
    isNamedError(error, MUSE_CODE_FAULT_ERROR) &&
    'fault' in error &&
    MUSE_CODE_FAULTS.includes(error.fault)
  )
}

/**
 * A decision that failed, and that the host confirmed did not apply: its
 * stage is still the one waiting. Only then may the card offer the choice
 * again (one decision per stage, PLAN.md D26).
 */
export class DecisionNotAppliedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = DECISION_NOT_APPLIED_ERROR
  }
}

/** Whether a failed decision is known not to have applied. */
export function isDecisionNotAppliedError(error: unknown): error is DecisionNotAppliedError {
  return isNamedError(error, DECISION_NOT_APPLIED_ERROR)
}

/**
 * A steer the backend refused outright, so none of it reached the running
 * turn: Muse Code found no turn to take it (MSP `commandRejected` with a
 * no-turn reason), or the Model API session took nothing. Only then may the
 * message go as a new turn instead. Any other steer failure may have
 * reached the turn, and nothing more is sent (CLI recovery, 2026-10-03).
 */
export class SteerRefusedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = STEER_REFUSED_ERROR
  }
}

/** Whether a steer was refused with nothing taken (a `SteerRefusedError` of either bundle). */
export function isSteerRefusedError(error: unknown): error is SteerRefusedError {
  return isNamedError(error, STEER_REFUSED_ERROR)
}

/**
 * Why a goal command was refused (M45, PLAN.md D38), as MSP's `commandRejected`
 * reasons say it (captured live 2026-09-25): `missing_goal` (there is none)
 * and `invalid_goal_state` (a finished goal cannot be paused, resumed or
 * edited). The Model API backend refuses in the same words.
 */
export type GoalRefusal = 'noGoal' | 'wrongState'

const GOAL_REFUSALS: readonly unknown[] = ['noGoal', 'wrongState'] satisfies readonly GoalRefusal[]

export class GoalRefusedError extends Error {
  public constructor(
    public readonly refusal: GoalRefusal,
    message: string,
  ) {
    super(message)
    this.name = GOAL_REFUSED_ERROR
  }
}

/** Whether a host refused a goal command (a `GoalRefusedError` of either bundle). */
export function isGoalRefusedError(error: unknown): error is GoalRefusedError {
  return (
    isNamedError(error, GOAL_REFUSED_ERROR) &&
    'refusal' in error &&
    GOAL_REFUSALS.includes(error.refusal)
  )
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
  /**
   * A BYO provider's fields (M95, PLAN.md D74): set by the Model API
   * backend's lane from the provider registry; absent on Meta's own models.
   * `pricing` tells the picker and usage how the price reads; per-M-token
   * prices only where the provider prices the model; `trainsOnContent`
   * hides the model in a confidential workspace.
   */
  readonly providerId?: string | undefined
  readonly providerLabel?: string | undefined
  readonly pricing?: ModelPricing | undefined
  readonly inputUsdPerMTokens?: number | undefined
  readonly outputUsdPerMTokens?: number | undefined
  readonly isPinned?: boolean | undefined
  readonly trainsOnContent?: boolean | undefined
  readonly planLimitsUrl?: string | undefined
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
  /** A new conversation kept in a side-chat surface (M53). */
  readonly sideChat?: boolean
}

/**
 * A PDF sent whole (M54, PLAN.md D47): the Model API's `input_file`. MSP
 * 1.3.0 has no such part (meta-models/muse-code-sdk#48), so the Muse Code
 * host refuses it rather than send what `turn/start` rejects.
 */
export interface DocumentPart {
  readonly type: 'file'
  readonly base64Data: string
  readonly mediaType: string
  readonly name: string
  readonly sizeBytes: number
  /** Read from the page tree when cheap (core/pdf.ts); undefined when unknown. */
  readonly pageCount: number | undefined
}

/** An image part (MSP `TurnInputPart` of type `image`). */
export interface ImagePart {
  readonly type: 'image'
  readonly base64Data: string
  readonly mediaType: string
  readonly width: number
  readonly height: number
}

/** An explicitly picked, bounded UTF-8 file, carried as named text (M54). */
export interface TextFilePart {
  readonly type: 'textFile'
  readonly name: string
  readonly mediaType: string
  readonly text: string
  readonly sizeBytes: number
}

/** One ordered content part of a turn (MSP `TurnInputPart`, and the Model API's document). */
export type TurnPart =
  | ImagePart
  | DocumentPart
  | TextFilePart
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'skill'; readonly selector: string; readonly arguments?: string }

/** An image a turn sent, as the backend kept it (M53): what a rewind puts back in the composer. */
export interface SentImage {
  readonly mediaType: string
  readonly base64Data: string
}

export interface TurnSubmission {
  readonly turnId: string
  /** `started`, `queued` or `steered` (open on the wire). */
  readonly disposition: string
  /** Backend-reserved transcript user ID for exact live-card replay (Model API). */
  readonly userMessageId?: string
}

/**
 * A message accepted as queued or steered (M87, PLAN.md D66), named as its
 * submission was acknowledged: what `withdrawQueued` takes back.
 */
export interface QueuedMessageRef {
  readonly turnId: string
  /** The backend's user item id for it (the Model API's); undefined where none was given. */
  readonly userMessageId: string | undefined
  /** The submission's `disposition`: `queued` or `steered`, as the backend said it. */
  readonly disposition: string
}

/**
 * What withdrawing did (M87): `withdrawn`, with the images the message
 * carried (undefined where the backend keeps no bytes, an empty list for a
 * message with none), or `tooLate`: the message already reached a request.
 */
export type WithdrawOutcome =
  | { readonly status: 'withdrawn'; readonly images: readonly SentImage[] | undefined }
  | { readonly status: 'tooLate' }

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
  readonly sideChat?: boolean
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
  /**
   * Its history came from an imported file (M84, PLAN.md D49): the panel
   * opens it in a mode that asks, whatever the initial mode.
   */
  readonly imported?: boolean
}

export interface SessionPage {
  readonly sessions: readonly SessionRecord[]
  readonly nextCursor: string | undefined
}

/** What a resumed or forked session's history yields for the transcript. */
export interface SessionHistoryOutcome {
  /** `inline`, `snapshot`, `anchoredSnapshot` or `none` (then `items` is empty). */
  readonly mode: string
  readonly sideChat?: boolean
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
  /**
   * A `/review` turn run as the built-in Reviewer, with its own prompt and
   * only the tools that read (M70, PLAN.md D49). The Model API backend has
   * one; Muse Code, which has no Reviewer the extension can pick, reviews
   * with an ordinary turn held in Plan mode instead.
   */
  readonly review?: (parts: readonly TurnPart[], displayText: string) => Promise<TurnSubmission>
  /**
   * Inject input into the running turn. A `SteerRefusedError` says none of
   * it was taken (no turn to steer); any other failure may have reached it.
   */
  steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<TurnSubmission>
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
   * M112: continue without guessing, preserving the question for a late answer.
   * Resolve only once the tool call is settled. Q binds both backend hosts;
   * the registry takes this method through its required injected port.
   */
  deferQuestions(userInputId: string): Promise<void>
  /**
   * Settle an MCP elicitation form (M91 lane M): accept with validated
   * values, or decline or cancel. Absent where the backend never asks
   * (Muse Code answers its own elicitations itself).
   */
  settleElicitation?: (elicitationId: string, reply: ElicitationReply) => Promise<void>
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
  /** Extension-owned schedules only. Muse Code's native cron has no MSP control verbs (M52). */
  readonly schedules?: {
    create(cadence: ScheduleCadence, prompt: string): Promise<ScheduledPrompt>
    list(): Promise<readonly ScheduledPrompt[]>
    cancel(id: string): Promise<boolean>
    /** Admit one due occurrence after host-side price confirmation. */
    run(
      id: string,
      occurrenceMs: number,
      confirmed: ScheduleRunConfirmation,
    ): Promise<TurnSubmission>
  }
  readOutput(request: OutputPageRequest): Promise<OutputPage>
  listSkills(): Promise<readonly SkillSummary[]>
  /** Resolves to the canonical name, or undefined when it arrives as an event. */
  rename(name: string): Promise<string | undefined>
  /**
   * The images a turn of this session sent, where the backend keeps them
   * (M53, PLAN.md D46): the Model API's replay holds them. Muse Code echoes
   * attachment metadata only (MSP `Item.attachments`), so its sessions do
   * not offer this and a rewind warns that the bytes cannot be restored.
   */
  readonly sentImages?: (turnId: string, itemId: string) => readonly SentImage[] | undefined
  /**
   * Replace the todo list from outside a turn (M79): a plan's steps before
   * its first turn. The Model API backend keeps the list itself. MSP 1.3.0
   * has no such command (the list is `session/todoListChanged`, written by
   * the model's own tool), so Muse Code sessions do not offer it.
   */
  readonly setTodos?: (items: readonly TodoItem[]) => void
  /**
   * Fire one extension hook event from the session's own snapshot (M91):
   * the Model API backend runs its spark-hooks.json snapshot outside any
   * turn (a Best-of-N worktree, an idling teammate, a message about to
   * show). Hook context has no turn to join, so only the decision comes
   * back. Sessions without such a point leave it absent, and the operation
   * proceeds as before.
   */
  readonly fireExtensionHook?: (
    event: ExtensionHookEvent,
    fields: Readonly<Record<string, unknown>>,
    matcherValue?: string,
  ) => Promise<ExtensionHookDispatch>
  /**
   * Told when the backend reports this session's own event log failed, so
   * it can take no new message (CLI recovery): Muse Code 1.4.2 answered a
   * command with "event log failed: …". The Model API keeps no such log.
   */
  readonly onLogDamaged?: (listener: () => void) => () => void
  /**
   * Take back a message before the model has it (M87, PLAN.md D66): the
   * Model API removes it from its queue or the running turn's steered input;
   * Muse Code sends `turn/unqueue` for a submit acknowledged `queued`. It
   * resolves `tooLate` once the message reached a request. A session
   * without it offers no Edit: the controller refuses before asking.
   */
  readonly withdrawQueued?: (ref: QueuedMessageRef) => Promise<WithdrawOutcome>
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
  /** Stored output in its own session, without loading it (M119). */
  readSessionOutput(sessionId: string, request: OutputPageRequest): Promise<OutputPage>
  resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpServer>>,
    options?: { readonly requireSideChat?: boolean },
  ): Promise<LoadedSession>
  forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
    options?: { readonly sideChat?: boolean },
  ): Promise<LoadedSession>
  onSessionListEvent(listener: (event: SessionListEvent) => void): () => void
  /**
   * The subscription usage the host last observed (M8); undefined when there
   * is none: a key-billed backend, or a CLI that has not seen a usage frame
   * yet (it reports one after a turn).
   */
  readUsage(): Promise<SubscriptionUsage | undefined>
  readPlanUsage?(): readonly PlanUsageRow[]
  /** A fresh observation arrived (MSP `usage/changed`). */
  onUsageChanged(listener: (usage: SubscriptionUsage) => void): () => void
  /**
   * Resume a parsed export as a new session (M84, PLAN.md D49): the host
   * sanitizes it (fresh ids, the caller's asking mode and model, no rules,
   * goals, schedules or patches, each imported turn untrusted data) and
   * loads it. Only the Model API backend offers it.
   */
  readonly importSession?:
    | ((
        doc: SessionExport,
        options: { readonly approvalMode: ApprovalMode; readonly modelId: string },
      ) => Promise<LoadedSession>)
    | undefined
  readonly sessionCount: number
  close(): Promise<void>
}
