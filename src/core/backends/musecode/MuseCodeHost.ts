// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import { Buffer } from 'node:buffer'
import { type Connection, MspError } from '@muse-code/sdk'
import * as z from 'zod/mini'
import type { AgentEvent, QuestionAnswer, SessionGoal } from '../../../shared/agentEvents'
import {
  CLARIFICATION_FORMAT,
  GOAL_RECOVERY_MAX_PAGES,
  GOAL_RECOVERY_PAGE_LIMIT,
  JSON_RPC_ERRORS,
  MILLISECONDS_PER_SECOND,
  MSP_COMMAND_ATTEMPTS,
  MSP_COMMAND_TIMEOUT_MS,
  MSP_FRAME_LIMIT_BYTES,
  MSP_LONG_COMMAND_TIMEOUT_MS,
  MSP_LONG_COMMANDS,
  MSP_RETRY_BASE_DELAY_MS,
  MSP_RETRY_MAX_DELAY_MS,
  MSP_RETRYABLE_REFUSALS,
  MSP_SESSION_LIST_MAX_LIMIT,
  MSP_USER_SHELL_CAPABILITY,
  MUSE_EXIT_PERSISTENT_CODES,
  type SubagentAction,
  UI_TEXT,
  WINDOWS_SESSION_EDITS_LIMITED_MAX_VERSION,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { withDeadline } from '../../timeouts'
import {
  type SubscriptionUsage,
  subscriptionUsageSchema,
  usageReadResultSchema,
} from '../../../shared/usage'
import type {
  AgentHost,
  AgentSession,
  ApprovalDecision,
  CompactOutcome,
  GoalCommand,
  GoalCommandOutcome,
  GoalRefusal,
  HostExit,
  HostInfo,
  ListSessionsOptions,
  LoadedSession,
  ModelSummary,
  OutputPage,
  OutputPageRequest,
  SessionEventListener,
  SessionHistoryOutcome,
  SessionListEvent,
  SessionMcpHttpServer,
  SessionPage,
  SkillSummary,
  StartSessionOptions,
  TurnPart,
  TurnSubmission,
} from '../../agent/agentBackend'
import {
  GoalRefusedError,
  PromptSettledError,
  type PromptSettledReason,
  SessionNotLoadedError,
} from '../../agent/agentBackend'
import type { CoreLogger } from '../../logging'
import {
  MALFORMED_PARAMS,
  mapNotification,
  type MappedNotification,
  UNKNOWN_METHOD,
  type WireNotification,
} from './mapNotification'
import { PromptLedger } from './promptLedger'
import { isVersionAtMost } from './sandbox'
import {
  historyOutcome,
  sessionClosedSchema,
  type SessionEnvelope,
  sessionEnvelopeSchema,
  sessionListChangedSchema,
  sessionListResultSchema,
  sessionRenameResultSchema,
} from './sessionRecords'

/** What the SDK's `SpawnedMspConnection` provides, narrowed to what we use. */
export interface MspHost {
  readonly connection: Connection
  readonly initializeResult: unknown
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>
  close(): Promise<unknown>
}

/** The MSP host's identity plus what the extension logs about it. */
export interface MuseHostInfo extends HostInfo {
  readonly museHome: string
}

const SESSION_LIST_CHANGED = 'session/listChanged'
const SESSION_CLOSED = 'session/closed'
const USAGE_CHANGED = 'usage/changed'
const USAGE_READ = 'usage/read'
// A resume asks for the folded snapshot (M45): the same items as `inline`
// plus the session's name, todo list and goal, which inline history lacks
// and which no notification repeats after a resume (captured 2026-09-25).
const HISTORY_PREFERENCE_SNAPSHOT = 'snapshot'
const VIEW_PAGE = 'view/page'

// Captured from Muse Code 1.3.0 on 2026-09-25: backward pages return
// ascending unframed notifications and a nullable cursor for the next page.
const viewPageResultSchema = z.object({
  events: z.array(z.object({ method: z.string(), params: z.record(z.string(), z.unknown()) })),
  nextCursor: z.nullable(z.string()),
})

const initializeResultSchema = z.object({
  serverInfo: z.object({ name: z.string(), version: z.string() }),
  museHome: z.string(),
  grantedCapabilities: z.optional(z.array(z.string())),
  // Logged once per start (D26); `platformOs` also gates rename and fork.
  platformOs: z.optional(z.string()),
  schema: z.optional(
    z.object({ version: z.optional(z.number()), fingerprint: z.optional(z.string()) }),
  ),
  // Absent reads as `durable` (msp.d.ts InitializeResult.sessionDurability).
  sessionDurability: z.optional(z.string()),
})

const WINDOWS_OS = 'windows'
const DURABLE_SESSIONS = 'durable'

const approvalDecideResultSchema = z.object({ terminal: z.optional(z.boolean()) })

// `approval/listPending`: the payloads of `session/resume`'s pending pointers.
const listPendingResultSchema = z.object({
  approvals: z.array(z.record(z.string(), z.unknown())),
  userInputs: z.array(z.record(z.string(), z.unknown())),
})

const sessionStartResultSchema = z.object({
  session: z.object({ sessionId: z.string(), modelId: z.nullable(z.string()) }),
})

const turnStartResultSchema = z.object({
  turnId: z.string(),
  status: z.string(),
  disposition: z.optional(z.string()),
})

const turnSteerResultSchema = z.object({ turnId: z.string(), status: z.string() })

const compactResultSchema = z.object({ status: z.string(), reason: z.optional(z.string()) })

// The shared `goal/*` ack (msp.d.ts GoalCommandResult): `turnId` names the
// turn a set, edit or resume woke (idle) or joined (busy); pause and clear
// never name one (captured live 2026-09-25, M45).
const goalCommandResultSchema = z.object({ status: z.string(), turnId: z.optional(z.string()) })

// A goal command's refusal (live 2026-09-25): `commandRejected` with
// `data.reason` `missing_goal` (no goal) or `invalid_goal_state` (a finished
// goal paused, resumed or edited).
const COMMAND_REJECTED = 'commandRejected'
const GOAL_REFUSALS: ReadonlyMap<string, GoalRefusal> = new Map([
  ['missing_goal', 'noGoal'],
  ['invalid_goal_state', 'wrongState'],
])

/** A goal refusal as a `GoalRefusedError`; anything else unchanged. */
function goalRefusalOr(error: unknown): unknown {
  if (!(error instanceof MspError) || error.kind !== COMMAND_REJECTED) {
    return error
  }
  const reason = error.data['reason']
  const refusal = typeof reason === 'string' ? GOAL_REFUSALS.get(reason) : undefined
  return refusal === undefined ? error : new GoalRefusedError(refusal, error.message)
}

const modelListResultSchema = z.object({
  models: z.array(
    z.object({
      modelId: z.string(),
      displayLabel: z.string(),
      contextLimit: z.nullable(z.number()),
      isDefault: z.boolean(),
      isActive: z.optional(z.boolean()),
    }),
  ),
})

const skillListResultSchema = z.object({
  skills: z.array(
    z.object({
      selector: z.string(),
      displayName: z.string(),
      description: z.string(),
      argumentHint: z.optional(z.string()),
    }),
  ),
})

const readOutputResultSchema = z.object({
  content: z.string(),
  encoding: z.string(),
  mediaType: z.string(),
  offsetBytes: z.number(),
  byteLen: z.number(),
  eof: z.boolean(),
})

const DEFAULT_DISPOSITION = 'started'

// The host mirrors a live approval or question as a JSON-RPC server request,
// and re-issues every pending one that way right after `session/resume`
// (tdd SS5.6). The answer is a presentation receipt (msp.d.ts
// RequestReceipt): `{}` says a surface shows or will show the prompt, the
// decision still travels as `approval/decide` / `userInput/answer`, and an
// error means "could not present", so the host re-issues it on the next
// subscribe. Each request is shown as the notification it mirrors (D26).
const PROMPT_SERVER_REQUESTS: ReadonlyMap<string, string> = new Map([
  ['approval/request', 'approval/requested'],
  ['userInput/request', 'userInput/requested'],
])
const PRESENTED: Record<string, never> = {}

const SESSION_NOT_LOADED = 'sessionNotLoaded'

// MSP refusals of a decision or answer that arrived after the prompt had
// moved (D26): nothing is wrong, and the card follows the host's own events.
const PROMPT_SETTLED_KINDS: ReadonlyMap<string, PromptSettledReason> = new Map([
  ['approvalAlreadyResolved', 'alreadySettled'],
  ['userInputAlreadySettled', 'alreadySettled'],
  ['approvalRequirementStale', 'movedOn'],
  ['approvalNotFound', 'gone'],
  ['userInputNotFound', 'gone'],
])

/** A late decision or answer as a `PromptSettledError`; anything else unchanged. */
function settledOr(error: unknown): unknown {
  if (!(error instanceof MspError)) {
    return error
  }
  const reason = PROMPT_SETTLED_KINDS.get(error.kind)
  return reason === undefined ? error : new PromptSettledError(reason, error.message)
}

// A `task/*` command naming a task that is not (or no longer) there, as
// Muse Code 1.3.0 refuses it (captured 2026-09-25, M46): `commandRejected`
// with the reason `invalid_target`.
const INVALID_TARGET = 'invalid_target'

/** A refused `task/*` command in the user's words when the task is gone; anything else unchanged. */
function taskRefusalOr(error: unknown): unknown {
  return error instanceof MspError &&
    error.kind === COMMAND_REJECTED &&
    error.data['reason'] === INVALID_TARGET
    ? new Error(UI_TEXT.taskNotRunning)
    : error
}

// `item/readOutput` encodings: text media is always utf8, binary media base64.
const BASE64_ENCODING = 'base64'
const UTF8_ENCODING = 'utf8'
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

// The worst-case JSON-RPC envelope around a command's params, for the size check.
const FRAME_ENVELOPE = { jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER }

/** How long a command may wait (PLAN.md D25); overridable for tests. */
export interface CommandTimeouts {
  readonly normalMs: number
  readonly longMs: number
}

const DEFAULT_TIMEOUTS: CommandTimeouts = {
  normalMs: MSP_COMMAND_TIMEOUT_MS,
  longMs: MSP_LONG_COMMAND_TIMEOUT_MS,
}

/** An MSP refusal that admitted nothing, so the same command may be sent again. */
function isRetryableRefusal(error: unknown): boolean {
  return (
    error instanceof MspError &&
    MSP_RETRYABLE_REFUSALS.some(
      (refusal) => refusal.code === error.code && refusal.kind === error.kind,
    )
  )
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * `Connection.command` without its memory (PLAN.md D26). The SDK keeps the
 * canonical payload of every command for the connection's life, an image
 * turn's base64 included, to check replays across reconnects this
 * extension never makes, so a long session's memory only grew. The same
 * contract otherwise: the command id rides in the params, the ack must echo
 * it, and a refusal that admitted nothing (`overloaded`, `backpressured`)
 * is retried with the same id after a short, growing, jittered wait.
 */
async function sendCommand(
  connection: Connection,
  log: CoreLogger,
  method: string,
  params: Record<string, unknown>,
  commandId: string,
): Promise<Record<string, unknown>> {
  const commandParams = { ...params, commandId }
  // The host drops an oversized frame without answering it (D26).
  const frame = JSON.stringify({ ...FRAME_ENVELOPE, method, params: commandParams })
  if (Buffer.byteLength(frame) > MSP_FRAME_LIMIT_BYTES) {
    throw new Error(UI_TEXT.commandTooLarge)
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      const ack = await connection.request(method, commandParams)
      if (ack['commandId'] !== undefined && ack['commandId'] !== commandId) {
        throw new Error(`${method} ack did not echo its commandId ${commandId}`)
      }
      return ack
    } catch (error: unknown) {
      if (!isRetryableRefusal(error) || attempt >= MSP_COMMAND_ATTEMPTS) {
        throw error
      }
      const ceiling = Math.min(MSP_RETRY_MAX_DELAY_MS, MSP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
      const delayMs = Math.floor(Math.random() * (ceiling + 1))
      log.warn(
        `${method} refused (${error instanceof Error ? error.message : String(error)}); attempt ${String(attempt + 1)} in ${String(delayMs)} ms`,
      )
      await pause(delayMs)
    }
  }
}

/**
 * One MSP command with a deadline. `sessionNotLoaded` (the host evicted or
 * closed the session) becomes a `SessionNotLoadedError` the controller
 * answers by resuming the session.
 */
async function commandWithin(
  connection: Connection,
  timeouts: CommandTimeouts,
  log: CoreLogger,
  method: string,
  params: Record<string, unknown>,
  commandId: string = connection.mintCommandId(),
): Promise<unknown> {
  const timeoutMs = MSP_LONG_COMMANDS.has(method) ? timeouts.longMs : timeouts.normalMs
  const startedAt = Date.now()
  try {
    const answer = await withDeadline(
      sendCommand(connection, log, method, params, commandId),
      timeoutMs,
      `Muse Code did not answer ${method} within ${String(Math.round(timeoutMs / MILLISECONDS_PER_SECOND))} s`,
    )
    log.trace(`${method} answered in ${String(Date.now() - startedAt)} ms`)
    return answer
  } catch (error: unknown) {
    log.trace(`${method} failed after ${String(Date.now() - startedAt)} ms`)
    const sessionId = params['sessionId']
    if (
      typeof sessionId === 'string' &&
      error instanceof MspError &&
      error.kind === SESSION_NOT_LOADED
    ) {
      throw new SessionNotLoadedError(sessionId, error.message)
    }
    throw error
  }
}

/** A process exit as the conversations see it (D25). */
export function describeExit(
  exit: { readonly code: number | null; readonly signal: string | null },
  isExpected: boolean,
): HostExit {
  if (exit.code === null) {
    return {
      description: fill(UI_TEXT.museStoppedBySignal, {
        signal: exit.signal ?? UI_TEXT.museUnknownSignal,
      }),
      isExpected,
      isPersistent: false,
    }
  }
  // Exit codes are ids, not amounts: no digit grouping.
  const code = String(exit.code)
  const meaning = Object.entries(UI_TEXT.museExitMeanings).find(([known]) => known === code)?.[1]
  return meaning === undefined
    ? {
        description: fill(UI_TEXT.museExitedWithCode, { code }),
        isExpected,
        isPersistent: false,
      }
    : {
        description: fill(UI_TEXT.museExitMeaning, { meaning, code }),
        isExpected,
        isPersistent: MUSE_EXIT_PERSISTENT_CODES.has(exit.code),
      }
}

export class MuseSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  /** One card per prompt and stage, and the open ones for a late listener (D26). */
  private readonly prompts = new PromptLedger()
  /**
   * What arrived before anyone listened (D26): the events right after
   * `session/resume` (the re-issued prompts, a running turn's stream) land
   * before the surface that asked for the session has attached. Held until
   * the first listener, released with the handle.
   */
  private early: AgentEvent[] | undefined = []
  /** The surfaces holding this handle (PLAN.md D25): the last release disposes it. */
  private holders = 1
  private isDisposed = false

  public constructor(
    public readonly sessionId: string,
    public readonly modelId: string,
    private readonly connection: Connection,
    private readonly onDispose: () => void,
    private readonly log: CoreLogger,
    /** The host granted `userShell` at the handshake (M46): `!` commands may run. */
    private readonly canRunUserShell: boolean,
    private readonly timeouts: CommandTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  /** One MSP command against this session with a freshly minted commandId. */
  private async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    return await commandWithin(this.connection, this.timeouts, this.log, method, {
      sessionId: this.sessionId,
      ...params,
    })
  }

  private finishDispose(): void {
    this.isDisposed = true
    this.listeners.clear()
    this.onDispose()
  }

  /** One more surface holds this handle (a second panel resumed the same session). */
  public retain(): void {
    this.holders += 1
  }

  /**
   * The first listener gets what arrived before it; a later one (a second
   * surface on the same session) gets the prompts still open, which the
   * host will not announce again.
   */
  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    const backlog = this.early ?? this.prompts.open()
    this.early = undefined
    for (const event of backlog) {
      listener(event)
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** @internal Called by the host dispatcher. */
  public receive(mapped: MappedNotification): void {
    if ('closedApprovalId' in mapped) {
      this.prompts.close(mapped.closedApprovalId)
      return
    }
    this.emit(mapped.event)
  }

  /** @internal An event for this session's listeners, once, in arrival order. */
  public emit(event: AgentEvent): void {
    if (this.isDisposed) {
      return
    }
    const admitted = this.prompts.admit(event)
    if (admitted === undefined) {
      return
    }
    if (this.early !== undefined) {
      this.early.push(admitted)
      return
    }
    for (const listener of this.listeners) {
      listener(admitted)
    }
  }

  /** Submit one user turn; queued behind a running turn by host default. */
  /**
   * Submit a turn. `displayText` is the transcript's presentation form of the
   * prompt (MSP: durable, never model-visible), used when the parts carry
   * more than the user typed (editor context, M5).
   */
  public async sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission> {
    const result = turnStartResultSchema.parse(
      await this.command('turn/start', {
        input: parts,
        ...(displayText !== undefined && { displayText }),
      }),
    )
    return { turnId: result.turnId, disposition: result.disposition ?? DEFAULT_DISPOSITION }
  }

  /**
   * Inject input into the turn believed to be running. The host rejects the
   * steer when that turn is no longer the running one, so input meant for one
   * turn never leaks into the next; callers fall back to `sendTurn`.
   */
  public async steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<string> {
    const result = await this.command('turn/steer', { expectedTurnId, input: parts })
    return turnSteerResultSchema.parse(result).turnId
  }

  /** Ask the host to stop the running turn gracefully. */
  public async cancel(): Promise<void> {
    await this.command('turn/cancel', {})
  }

  /** Stop the running turn immediately. */
  public async interrupt(): Promise<void> {
    await this.command('turn/interrupt', {})
  }

  /** Durable model selection; applies from the next model call. */
  public async setModel(modelId: string): Promise<void> {
    await this.command('session/setModel', { model: { modelId } })
  }

  /** The session's standing reasoning-effort default (wire vocabulary). */
  public async setReasoningEffort(reasoningEffort: string): Promise<void> {
    await this.command('session/setReasoningEffort', { reasoningEffort })
  }

  /** Select one of the host's preconfigured approval modes. */
  public async setApprovalMode(mode: string): Promise<void> {
    await this.command('session/setApprovalMode', { mode })
  }

  /** Summarise older context; `status` is `noop` with a reason when nothing to do. */
  public async compact(): Promise<CompactOutcome> {
    const result = compactResultSchema.parse(await this.command('session/compact', {}))
    return { status: result.status, reason: result.reason }
  }

  /**
   * Answer a gated tool call. `requirementId` is the stage token from the
   * request; a stale one is rejected by the host, never silently applied.
   */
  public async decideApproval(decision: ApprovalDecision): Promise<void> {
    let ack: unknown
    try {
      ack = await this.command('approval/decide', {
        approvalId: decision.approvalId,
        choiceId: decision.choiceId,
        requirementId: decision.requirementId,
        ...(decision.feedback !== undefined && { feedback: decision.feedback }),
      })
    } catch (error: unknown) {
      throw settledOr(error)
    }
    // `terminal: true` closed the whole approval; a trailing stage update the
    // host can still send for it must not reopen the card (the facade's #37538).
    if (approvalDecideResultSchema.safeParse(ack).data?.terminal === true) {
      this.prompts.close(decision.approvalId)
    }
  }

  /** Answer every question of a `request_user_input` prompt. */
  public async answerQuestions(
    userInputId: string,
    answers: readonly QuestionAnswer[],
  ): Promise<void> {
    try {
      await this.command('userInput/answer', { userInputId, answers: [...answers] })
    } catch (error: unknown) {
      throw settledOr(error)
    }
  }

  /** Decline a `request_user_input` prompt (`userInput/cancel`, M16). */
  public async cancelQuestions(userInputId: string): Promise<void> {
    try {
      await this.command('userInput/cancel', { userInputId })
    } catch (error: unknown) {
      throw settledOr(error)
    }
  }

  /** Explain instead of choosing (`userInput/clarify`, M46): the model decides again. */
  public async clarifyQuestions(userInputId: string, text: string): Promise<void> {
    try {
      await this.command('userInput/clarify', {
        userInputId,
        clarification: { format: CLARIFICATION_FORMAT, content: text },
      })
    } catch (error: unknown) {
      throw settledOr(error)
    }
  }

  /** `task/background` (M46): the running tool call goes on without its turn waiting. */
  public async moveToBackground(taskId: string): Promise<void> {
    try {
      await this.command('task/background', { taskId })
    } catch (error: unknown) {
      throw taskRefusalOr(error)
    }
  }

  /** `task/stop` (M46): one background task, by its row's id. */
  public async stopTask(taskId: string): Promise<void> {
    try {
      await this.command('task/stop', { taskId })
    } catch (error: unknown) {
      throw taskRefusalOr(error)
    }
  }

  /** `task/stopAll` (M46): every background task; accepted over none too. */
  public async stopAllTasks(): Promise<void> {
    await this.command('task/stopAll', {})
  }

  /**
   * `session/userShell` (M46): the command runs at once, outside any turn;
   * its row and output arrive as a `userShell` item.
   */
  public async runUserShell(command: string): Promise<void> {
    if (!this.canRunUserShell) {
      throw new Error(UI_TEXT.userShellNotGranted)
    }
    await this.command('session/userShell', { commandText: command })
  }

  /** `subagent/interrupt`, `stop`, `resume` or `close` on a child (M18). */
  public async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    await this.command(`subagent/${action}`, { subagentId })
  }

  /** `subagent/sendMessage` (a note while it runs) or `subagent/followupTask` (M18). */
  public async messageSubagent(
    subagentId: string,
    body: string,
    isFollowup: boolean,
  ): Promise<void> {
    await this.command(isFollowup ? 'subagent/followupTask' : 'subagent/sendMessage', {
      subagentId,
      body,
    })
  }

  /**
   * `goal/set`, `edit`, `pause`, `resume` or `clear` (M45, PLAN.md D38).
   * An idle set, edit or resume wakes a goal-driving turn, which then
   * arrives as its own `turn/started`; the goal arrives as
   * `session/goalChanged`.
   */
  public async controlGoal(command: GoalCommand): Promise<GoalCommandOutcome> {
    let ack: unknown
    try {
      ack = await this.command(
        `goal/${command.verb}`,
        command.verb === 'set' || command.verb === 'edit' ? { objective: command.objective } : {},
      )
    } catch (error: unknown) {
      throw goalRefusalOr(error)
    }
    return { turnId: goalCommandResultSchema.parse(ack).turnId }
  }

  /** One page of a stored tool output or patch document (`item/readOutput`). */
  public async readOutput(request: OutputPageRequest): Promise<OutputPage> {
    const result = await commandWithin(
      this.connection,
      this.timeouts,
      this.log,
      'item/readOutput',
      {
        sessionId: this.sessionId,
        itemId: request.itemId,
        outputRef: request.outputRef,
        offsetBytes: request.offsetBytes,
        lengthBytes: request.lengthBytes,
      },
    )
    const page = readOutputResultSchema.parse(result)
    if (page.encoding !== BASE64_ENCODING) {
      return page
    }
    // Binary media arrives base64 (tdd SS4.7.4): shown only if it is text after all.
    let text: string
    try {
      text = STRICT_UTF8.decode(Buffer.from(page.content, BASE64_ENCODING))
    } catch {
      throw new Error(`${UI_TEXT.outputIsBinary} (${page.mediaType})`)
    }
    return { ...page, content: text, encoding: UTF8_ENCODING }
  }

  /**
   * Set the durable session name; resolves to the canonical name the host
   * settled, or undefined when it will arrive as `session/nameChanged`.
   * Muse Code 1.3.0 refuses this on Windows (UnsupportedPlatform, PLAN.md M6).
   */
  public async rename(name: string): Promise<string | undefined> {
    const result = sessionRenameResultSchema.parse(await this.command('session/rename', { name }))
    return result.name
  }

  /** The user-invocable skills in this session's workspace and plugins. */
  public async listSkills(): Promise<readonly SkillSummary[]> {
    const result = await commandWithin(this.connection, this.timeouts, this.log, 'skill/list', {
      sessionId: this.sessionId,
    })
    return skillListResultSchema.parse(result).skills.map((skill) => ({
      selector: skill.selector,
      displayName: skill.displayName,
      description: skill.description,
      argumentHint: skill.argumentHint,
    }))
  }

  /** Releases this surface's hold; the last one forgets the session (D25). */
  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.holders -= 1
    if (this.holders > 0) {
      return
    }
    // The CLI process can outlive this handle. Stop its work while the
    // connection is still open, even when the turn that started it has ended.
    void this.stopAllTasks().catch((error: unknown) => {
      this.log.warn(
        `task/stopAll before releasing session ${this.sessionId} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    this.finishDispose()
  }

  /** The host is closing: the handle goes whoever still holds it. */
  public disposeAll(): void {
    if (this.isDisposed) {
      return
    }
    // The process has already closed, so there is no session command to send.
    this.holders = 0
    this.finishDispose()
  }
}

export class MuseCodeHost implements AgentHost {
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: HostExit) => void>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  private readonly usageListeners = new Set<(usage: SubscriptionUsage) => void>()
  /** Set by `close()`: the exit that follows is the extension's, not a crash (D25). */
  private isClosing = false
  /**
   * Session starts, resumes and forks in flight (D26). The SDK hands every
   * frame of one read to the handlers before the awaiting command resumes,
   * so the prompts re-issued right after a resume answer arrive before the
   * handle exists. While one is in flight, events for an unknown session
   * wait here for `track`.
   */
  private opening = 0
  private readonly unclaimed = new Map<string, MappedNotification[]>()
  /** Methods already logged as unshown or malformed: one line each per host (D26). */
  private readonly loggedMethods = new Set<string>()
  public readonly info: MuseHostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
    private readonly timeouts: CommandTimeouts = DEFAULT_TIMEOUTS,
  ) {
    const parsed = initializeResultSchema.parse(host.initializeResult)
    const serverVersion = parsed.serverInfo.version
    this.info = {
      kind: 'museCode',
      serverName: parsed.serverInfo.name,
      serverVersion,
      museHome: parsed.museHome,
      grantedCapabilities: parsed.grantedCapabilities ?? [],
      canEditSessions: !(
        parsed.platformOs === WINDOWS_OS &&
        isVersionAtMost(serverVersion, WINDOWS_SESSION_EDITS_LIMITED_MAX_VERSION)
      ),
    }
    this.log.info(
      `MSP host on ${parsed.platformOs ?? 'an unreported OS'}, schema v${String(parsed.schema?.version ?? 'unreported')} ${parsed.schema?.fingerprint ?? ''}, sessions ${parsed.sessionDurability ?? DURABLE_SESSIONS}`,
    )
    if (parsed.sessionDurability !== undefined && parsed.sessionDurability !== DURABLE_SESSIONS) {
      this.log.warn(
        `This muse serve keeps ${parsed.sessionDurability} sessions: History and resume will not find them after it exits`,
      )
    }
    // The SDK's connection keeps one handler; a throw inside it would end the
    // read loop and leave the connection deaf without a word (D25).
    host.connection.onNotification((notification) => {
      try {
        this.dispatch(notification)
      } catch (error: unknown) {
        this.log.error(`MSP ${notification.method} could not be handled: ${String(error)}`)
      }
    })
    host.connection.onServerRequest((request) => this.serverRequest(request))
    // A dropped or unreadable frame is logged by kind, never with its content.
    host.connection.onProtocolError((error) => {
      this.log.warn(`MSP protocol error: ${error.message}`)
    })
    // A connection that ends while the process lives (a framing violation)
    // is as good as dead: the process is closed so the exit is reported.
    void host.connection.closed.then(() => {
      if (this.isClosing) {
        return
      }
      this.log.warn('The MSP connection closed while muse serve was running; closing it')
      void this.host.close()
    })
    void host.exited.then((exit) => {
      const described = describeExit(exit, this.isClosing)
      if (described.isExpected) {
        this.log.info(`muse serve exited as asked (${described.description})`)
      } else {
        this.log.warn(`muse serve exited (${described.description})`)
      }
      for (const listener of this.exitListeners) {
        listener(described)
      }
    })
  }

  /** One notification: a host-level event, or a session's. */
  private dispatch(notification: WireNotification): void {
    if (this.dispatchHostEvent(notification.method, notification.params)) {
      return
    }
    this.deliver(notification)
  }

  /** A session's notification to its handle; false when nothing can show it. */
  private deliver(notification: WireNotification): boolean {
    const mapped = mapNotification(notification)
    if (mapped === UNKNOWN_METHOD || mapped === MALFORMED_PARAMS) {
      this.noteUnmapped(notification.method, mapped)
      return false
    }
    const session = this.sessions.get(mapped.sessionId)
    if (session !== undefined) {
      session.receive(mapped)
      return true
    }
    if (this.opening > 0) {
      const waiting = this.unclaimed.get(mapped.sessionId) ?? []
      waiting.push(mapped)
      this.unclaimed.set(mapped.sessionId, waiting)
      return true
    }
    this.log.warn(`MSP event ${notification.method} for unknown session ${mapped.sessionId}`)
    return false
  }

  /** Once per method: the extension does not show it, or it failed its schema. */
  private noteUnmapped(
    method: string,
    outcome: typeof UNKNOWN_METHOD | typeof MALFORMED_PARAMS,
  ): void {
    if (this.loggedMethods.has(method)) {
      return
    }
    this.loggedMethods.add(method)
    if (outcome === MALFORMED_PARAMS) {
      this.log.warn(`MSP ${method} had an unexpected shape and was ignored (logged once)`)
    } else {
      this.log.info(`MSP ${method} is not shown by this extension (logged once)`)
    }
  }

  /** A server request: a prompt shown as the notification it mirrors, answered with the receipt. */
  private serverRequest(request: {
    readonly method: string
    readonly params?: Record<string, unknown> | undefined
  }): Promise<Record<string, unknown>> {
    const mirrored = PROMPT_SERVER_REQUESTS.get(request.method)
    if (mirrored === undefined) {
      this.log.warn(`Unsupported MSP server request ${request.method}; refusing`)
      return Promise.reject(
        new MspError({
          code: JSON_RPC_ERRORS.methodNotFound,
          message: `method not found: ${request.method}`,
          data: { kind: 'methodNotFound' },
        }),
      )
    }
    return this.deliver({ method: mirrored, params: request.params })
      ? Promise.resolve(PRESENTED)
      : Promise.reject(new Error(`no surface can show ${request.method}`))
  }

  /**
   * Runs a session start, resume or fork with early events held for its
   * handle (D26); whatever no handle claimed by the end is logged and dropped.
   */
  private async opened<T>(open: () => Promise<T>): Promise<T> {
    this.opening += 1
    try {
      return await open()
    } finally {
      this.opening -= 1
      if (this.opening === 0) {
        for (const [sessionId, waiting] of this.unclaimed) {
          this.log.warn(
            `${String(waiting.length)} MSP events for session ${sessionId} arrived while it was opening and no handle claimed them`,
          )
        }
        this.unclaimed.clear()
      }
    }
  }

  private async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    return await commandWithin(this.host.connection, this.timeouts, this.log, method, params)
  }

  /**
   * Host-level notifications bypass the per-session routing: the list
   * stream (`sessionListStream` grant) is about stored sessions, loaded here
   * or not, and `usage/changed` is about the account. True when the method
   * was one of them.
   */
  private dispatchHostEvent(method: string, params: unknown): boolean {
    if (method === USAGE_CHANGED) {
      const parsed = subscriptionUsageSchema.safeParse(params)
      if (parsed.success) {
        for (const listener of this.usageListeners) {
          listener(parsed.data)
        }
      } else {
        this.warnShape(method)
      }
      return true
    }
    if (method !== SESSION_LIST_CHANGED && method !== SESSION_CLOSED) {
      return false
    }
    const event = this.parseListEvent(method, params)
    if (event === undefined) {
      this.warnShape(method)
      return true
    }
    for (const listener of this.listListeners) {
      listener(event)
    }
    return true
  }

  private warnShape(method: string): void {
    this.log.warn(`MSP ${method} had an unexpected shape; ignored`)
  }

  private parseListEvent(method: string, params: unknown): SessionListEvent | undefined {
    if (method === SESSION_LIST_CHANGED) {
      const parsed = sessionListChangedSchema.safeParse(params)
      return parsed.success ? { type: 'changed', record: parsed.data.session } : undefined
    }
    const parsed = sessionClosedSchema.safeParse(params)
    return parsed.success
      ? { type: 'closed', sessionId: parsed.data.sessionId, reason: parsed.data.reason }
      : undefined
  }

  /** Registers the handle for a session this connection now holds. */
  private track(record: { readonly sessionId: string }, modelId: string): MuseSession {
    const existing = this.sessions.get(record.sessionId)
    if (existing !== undefined) {
      // A second surface on the same session: closing one must not deafen the other.
      existing.retain()
      return existing
    }
    const handle = new MuseSession(
      record.sessionId,
      modelId,
      this.host.connection,
      () => {
        this.sessions.delete(record.sessionId)
      },
      this.log,
      this.info.grantedCapabilities.includes(MSP_USER_SHELL_CAPABILITY),
      this.timeouts,
    )
    this.sessions.set(record.sessionId, handle)
    const waiting = this.unclaimed.get(record.sessionId) ?? []
    for (const mapped of waiting) {
      handle.receive(mapped)
    }
    this.unclaimed.delete(record.sessionId)
    return handle
  }

  private loaded(envelope: SessionEnvelope, modelId: string): LoadedSession {
    return {
      session: this.track(envelope.session, modelId),
      record: envelope.session,
      history: historyOutcome(envelope),
      activeTurnId: envelope.session.activeTurnId ?? undefined,
    }
  }

  /**
   * The pending prompts a resume's pointers name, pulled with
   * `approval/listPending` (the documented dual of the re-issued requests,
   * tdd SS5.7), so the cards appear however the re-issue was delivered; the
   * ledger shows each once (D26).
   */
  private async presentPending(sessionId: string): Promise<void> {
    try {
      const pending = listPendingResultSchema.parse(
        await this.command('approval/listPending', { sessionId }),
      )
      for (const params of pending.approvals) {
        this.deliver({ method: 'approval/requested', params })
      }
      for (const params of pending.userInputs) {
        this.deliver({ method: 'userInput/requested', params })
      }
    } catch (error: unknown) {
      this.log.warn(`approval/listPending after resuming ${sessionId} failed: ${String(error)}`)
    }
  }

  private mcpConfig(
    mcpServers: Readonly<Record<string, SessionMcpHttpServer>> | undefined,
  ): Record<string, unknown> {
    if (mcpServers === undefined) {
      return {}
    }
    return {
      config: {
        mcpServers: Object.fromEntries(
          Object.entries(mcpServers).map(([name, server]) => [
            name,
            // `optional`: a tool-server hiccup never blocks the session.
            {
              transport: 'streamableHttp',
              url: server.url,
              headers: server.headers,
              mode: 'optional',
            },
          ]),
        ),
      },
    }
  }

  /** Last durable goal event at the view head; an empty history means no goal. */
  private async goalFromView(sessionId: string): Promise<SessionGoal | null> {
    let cursor: string | undefined
    for (let page = 0; page < GOAL_RECOVERY_MAX_PAGES; page += 1) {
      const raw = await withDeadline(
        this.host.connection.request(VIEW_PAGE, {
          sessionId,
          limit: GOAL_RECOVERY_PAGE_LIMIT,
          direction: 'backward',
          ...(cursor !== undefined && { cursor }),
        }),
        this.timeouts.normalMs,
        `Muse Code did not answer ${VIEW_PAGE} while recovering the goal`,
      )
      const result = viewPageResultSchema.parse(raw)
      for (const frame of result.events.toReversed()) {
        if (frame.method !== 'session/goalChanged') {
          continue
        }
        const mapped = mapNotification(frame)
        if (
          typeof mapped === 'string' ||
          !('event' in mapped) ||
          mapped.sessionId !== sessionId ||
          mapped.event.type !== 'goalChanged'
        ) {
          throw new Error('Muse Code returned an invalid goal event in view history')
        }
        return mapped.event.goal
      }
      if (result.nextCursor === null) {
        return null
      }
      if (result.nextCursor === cursor) {
        throw new Error('Muse Code repeated a view history cursor')
      }
      cursor = result.nextCursor
    }
    throw new Error('Muse Code view history exceeded the goal recovery limit')
  }

  public onExit(listener: (exit: HostExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /** The subscription window the CLI last observed; absent until a turn has run. */
  public async readUsage(): Promise<SubscriptionUsage | undefined> {
    const result = await this.command(USAGE_READ, {})
    return usageReadResultSchema.parse(result).usage
  }

  public onUsageChanged(listener: (usage: SubscriptionUsage) => void): () => void {
    this.usageListeners.add(listener)
    return () => {
      this.usageListeners.delete(listener)
    }
  }

  /** Stored-session changes on this host (needs the `sessionListStream` grant). */
  public onSessionListEvent(listener: (event: SessionListEvent) => void): () => void {
    this.listListeners.add(listener)
    return () => {
      this.listListeners.delete(listener)
    }
  }

  /** One page of this workspace's stored sessions, newest activity first. */
  public async listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const result = await this.command('session/list', {
      workspaceRoot: options.workspaceRoot,
      limit: Math.min(options.limit, MSP_SESSION_LIST_MAX_LIMIT),
      ...(options.cursor !== undefined && { cursor: options.cursor }),
    })
    const page = sessionListResultSchema.parse(result)
    return { sessions: page.sessions, nextCursor: page.nextCursor ?? undefined }
  }

  /**
   * Load a stored session on this connection with its history as a folded
   * snapshot where the host's budget allows (the served mode is reported):
   * the items, and the name, todo list and goal beside them (M45).
   * `modelId` is the caller's standing selection: the record's own
   * `modelId` is the metadata fold's and not to be trusted (PLAN.md M6).
   */
  public async resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpHttpServer>>,
  ): Promise<LoadedSession> {
    const { loaded, hasPending } = await this.opened(async () => {
      const envelope = sessionEnvelopeSchema.parse(
        await this.command('session/resume', {
          sessionId,
          history: HISTORY_PREFERENCE_SNAPSHOT,
          ...this.mcpConfig(mcpServers),
        }),
      )
      return {
        loaded: this.loaded(envelope, modelId),
        hasPending: (envelope.pendingRequests ?? []).length > 0,
      }
    })
    if (hasPending) {
      await this.presentPending(sessionId)
    }
    if (loaded.history.goal === undefined) {
      try {
        return {
          ...loaded,
          history: { ...loaded.history, goal: await this.goalFromView(sessionId) },
        }
      } catch {
        // A page failure must not strand an attached session after resume.
        this.log.warn('Muse Code could not recover the goal from view history after resume')
      }
    }
    return loaded
  }

  /** A point-in-time read with items, without loading the session. */
  public async readSession(
    sessionId: string,
    options?: { readonly recoverGoal?: boolean },
  ): Promise<SessionHistoryOutcome> {
    const result = await this.command('session/read', {
      sessionId,
      excludeItems: false,
    })
    const history = historyOutcome(sessionEnvelopeSchema.parse(result))
    return options?.recoverGoal === true && history.goal === undefined
      ? { ...history, goal: await this.goalFromView(sessionId) }
      : history
  }

  /**
   * Copy a session's completed turns (through `lastTurnId`, or all of them)
   * into a new session, loaded here. Muse Code 1.3.0 refuses this on
   * Windows ("invalid fork boundary ... WriteFailed", PLAN.md M6).
   */
  public async forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
  ): Promise<LoadedSession> {
    if (!this.info.canEditSessions) {
      throw new Error(UI_TEXT.sessionEditsUnsupported)
    }
    return await this.opened(async () => {
      const result = await this.command('session/fork', {
        sessionId,
        ...(lastTurnId !== undefined && { cutPoint: { lastTurnId } }),
      })
      return this.loaded(sessionEnvelopeSchema.parse(result), modelId)
    })
  }

  /** The visible model catalogue; with a session id the active row is flagged. */
  public async listModels(sessionId?: string): Promise<readonly ModelSummary[]> {
    const result = await this.command('model/list', {
      ...(sessionId !== undefined && { sessionId }),
    })
    return modelListResultSchema.parse(result).models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      contextLimit: model.contextLimit ?? undefined,
      isDefault: model.isDefault,
      isActive: model.isActive ?? false,
    }))
  }

  public async startSession(options: StartSessionOptions): Promise<MuseSession> {
    return await this.opened(async () => {
      const result = await this.command('session/start', {
        workspaceRoot: options.workspaceRoot,
        modelId: options.modelId,
        approvalMode: options.approvalMode,
        ...this.mcpConfig(options.mcpServers),
      })
      const { session } = sessionStartResultSchema.parse(result)
      return this.track(session, session.modelId ?? options.modelId)
    })
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public async close(): Promise<void> {
    // The exit that follows is the extension's own (D25).
    this.isClosing = true
    // Close the process first: the host emits session/statusChanged for every
    // loaded session on the way down, and those must still find their session.
    await this.host.close()
    for (const session of this.sessions.values()) {
      session.disposeAll()
    }
  }
}
