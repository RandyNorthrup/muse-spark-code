import type { UsageRecording } from '../../usage/recording'
// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import { Buffer } from 'node:buffer'
import { type Connection, MspError, ProtocolError } from '@muse-code/sdk'
import * as z from 'zod/mini'
import {
  type AgentEvent,
  type QuestionAnswer,
  type RequirementRef,
  requirementRefSchema,
  type SessionGoal,
} from '../../../shared/agentEvents'
import {
  APPROVAL_REJECT_ATTEMPTS,
  APPROVAL_REJECT_DEADLINE_MS,
  CLARIFICATION_FORMAT,
  GOAL_RECOVERY_MAX_PAGES,
  GOAL_RECOVERY_PAGE_LIMIT,
  JSON_RPC_ERRORS,
  MILLISECONDS_PER_SECOND,
  MSP_ATTACHMENT_FRAME_BUDGET_BYTES,
  MSP_COMMAND_ATTEMPTS,
  MSP_COMMAND_TIMEOUT_MS,
  MSP_FRAME_LIMIT_BYTES,
  MSP_LONG_COMMAND_TIMEOUT_MS,
  MSP_LONG_COMMANDS,
  MSP_RETRY_BASE_DELAY_MS,
  MSP_RETRY_MAX_DELAY_MS,
  MSP_RETRYABLE_REFUSALS,
  MSP_SESSION_LIST_MAX_LIMIT,
  MSP_STEER_NO_TURN_REASONS,
  MSP_UNRESPONSIVE_MISSES,
  MSP_UNRESPONSIVE_SILENCE_MS,
  MSP_USER_SHELL_CAPABILITY,
  MUSE_APPROVAL_LEDGER_FAULT,
  MUSE_APPROVAL_REPLAY_FAULT,
  MUSE_EVENT_LOG_FAULT,
  MUSE_EXIT_PERSISTENT_CODES,
  type SubagentAction,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { DeadlineError, withDeadline } from '../../timeouts'
import { textFileInput } from '../../textAttachment'
import {
  type SubscriptionUsage,
  subscriptionUsageSchema,
  usageReadResultSchema,
} from '../../../shared/usage'
import {
  type AgentHost,
  type AgentSession,
  type ApprovalDecision,
  type CompactOutcome,
  type GoalCommand,
  type GoalCommandOutcome,
  type GoalRefusal,
  type HostExit,
  type HostInfo,
  type ListSessionsOptions,
  type LoadedSession,
  type ModelSummary,
  type MuseCodeFault,
  type OutputPage,
  type OutputPageRequest,
  type QueuedMessageRef,
  type SessionEventListener,
  type SessionHistoryOutcome,
  type SessionListEvent,
  type SessionMcpServer,
  type SessionPage,
  type SkillSummary,
  type StartSessionOptions,
  type TurnPart,
  type TurnSubmission,
  type WithdrawOutcome,
  DecisionNotAppliedError,
  GoalRefusedError,
  isPromptSettledError,
  MuseCodeFaultError,
  PromptSettledError,
  type PromptSettledReason,
  SessionNotLoadedError,
  SteerRefusedError,
} from '../../agent/agentBackend'

import type { CoreLogger } from '../../logging'
import { notify } from '../../events/notify'
import {
  MALFORMED_PARAMS,
  mapNotification,
  type MappedNotification,
  type MuseCodeLifecycleEvent,
  type MuseCodeLifecycleReader,
  UNKNOWN_METHOD,
  type WireNotification,
} from './mapNotification'
import { failureForLog } from './logText'
import { redactSecrets } from '../../../shared/redact'
import { PromptLedger } from './promptLedger'
import { submitMuseFeedback, type FeedbackOutcomeReader, type FeedbackRequest } from './feedback'
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

export interface MuseCodeEffortInfo {
  readonly variants?: readonly string[] | 'unknown'
  readonly reasoningEffortVariants?: readonly {
    readonly tier: string
    readonly description?: string
  }[]
  readonly defaultReasoningEffort?: string
}

export interface MuseCodeModelSummary extends ModelSummary, MuseCodeEffortInfo {}

/** Readers are injected only after their raw frames have captured zod schemas. */
export interface MuseCodeFeaturePorts {
  readonly feedback?: FeedbackOutcomeReader
  readonly lifecycle?: MuseCodeLifecycleReader
  readonly modelEfforts?: {
    parseModel(row: unknown): MuseCodeEffortInfo
  }
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
// One of them, as far as a failed decision's check reads it.
const pendingStageSchema = z.object({
  approvalId: z.string(),
  currentRequirementId: requirementRefSchema,
})

// The stage token a stale refusal names (`approvalRequirementStale`'s
// `currentRequirementId`, msp.d.ts ErrorData).
const REQUIREMENT_STALE = 'approvalRequirementStale'
const MSP_INTERNAL = 'internal'
// The Reject choice Muse Code offers on every stage (captured 2026-10-02).
const REJECT_DECISION = 'abort'

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

// `turn/unqueue` (M87), captured live 2026-10-04: the ack, and the
// `commandRejected` reasons for a turn that launched or was reclaimed already.
const turnUnqueueResultSchema = z.object({ turnId: z.string(), status: z.string() })
const QUEUED_DISPOSITION = 'queued'
const UNQUEUE_LAUNCHED = 'run_active'
const UNQUEUE_ALREADY_WON = 'already_applied'
const TOO_LATE: WithdrawOutcome = { status: 'tooLate' }

/** The `data.reason` of a `turn/unqueue` refusal; undefined for any other failure. */
function unqueueRefusal(error: unknown): string | undefined {
  if (!(error instanceof MspError) || error.kind !== COMMAND_REJECTED) {
    return undefined
  }
  const reason = error.data['reason']
  return typeof reason === 'string' ? reason : undefined
}

const modelListResultSchema = z.object({
  models: z.array(
    z.looseObject({
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

// An approval mode above the host's ceiling (M56, PLAN.md D43): MSP answers
// `session/start` and `session/setApprovalMode` with `commandRejected` and
// this reason, "approval mode exceeds or is incomparable with the sealed
// startup mode or the managed approval-mode set" (captured 2026-09-25).
const APPROVAL_MODE_CEILING = 'approval_mode_ceiling'

/** A refused approval mode as a reason the user can act on; anything else unchanged. */
function ceilingOr(error: unknown): unknown {
  return error instanceof MspError &&
    error.kind === COMMAND_REJECTED &&
    error.data['reason'] === APPROVAL_MODE_CEILING
    ? new Error(UI_TEXT.approvalModeCeiling, { cause: error })
    : error
}

/** A late decision or answer as a `PromptSettledError`; anything else unchanged. */
function settledOr(error: unknown): unknown {
  if (!(error instanceof MspError)) {
    return error
  }
  const reason = PROMPT_SETTLED_KINDS.get(error.kind)
  return reason === undefined ? error : new PromptSettledError(reason, error.message)
}

const FAULT_MARKERS: Readonly<Record<MuseCodeFault, string>> = {
  approvalReplay: MUSE_APPROVAL_REPLAY_FAULT,
  approvalLedger: MUSE_APPROVAL_LEDGER_FAULT,
}

/** Muse Code's own approval fault as a `MuseCodeFaultError`; anything else unchanged. */
function faultOr(error: unknown, fault: MuseCodeFault): unknown {
  return error instanceof MspError &&
    error.kind === MSP_INTERNAL &&
    error.message.includes(FAULT_MARKERS[fault])
    ? new MuseCodeFaultError(fault, error.message)
    : error
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
  /** Deletion's admission and terminal notification; defaults to the long command deadline. */
  readonly deleteTerminalMs?: number
  /** The watchdog's silence (`MSP_UNRESPONSIVE_SILENCE_MS` unless a test shortens it). */
  readonly unresponsiveSilenceMs?: number
}

const DEFAULT_TIMEOUTS: CommandTimeouts = {
  normalMs: MSP_COMMAND_TIMEOUT_MS,
  longMs: MSP_LONG_COMMAND_TIMEOUT_MS,
}

/**
 * Whether `muse serve` still answers at all (the unresponsive-host watchdog,
 * CLI recovery 2026-10-03). Every frame from it (an answer, an event, a
 * server request) is heard here and clears the count. A command that
 * misses its deadline counts once; at `MSP_UNRESPONSIVE_MISSES` in a row
 * with nothing heard for the silence, Muse Code is not answering: that is
 * logged and told once, and new commands fail at once until a frame comes.
 */
class HostLiveness {
  private lastHeardAt = Date.now()
  private misses = 0
  private isSilent = false

  public constructor(
    private readonly silenceMs: number,
    private readonly log: CoreLogger,
    private readonly onUnresponsive: () => void,
  ) {}

  public get isUnresponsive(): boolean {
    return this.isSilent
  }

  /** A frame arrived from `muse serve`. */
  public heard(): void {
    this.lastHeardAt = Date.now()
    this.misses = 0
    if (!this.isSilent) {
      return
    }
    this.isSilent = false
    this.log.info('Muse Code answers again; commands are sent again')
  }

  /** A command missed its deadline. */
  public missed(method: string): void {
    this.misses += 1
    const silentMs = Date.now() - this.lastHeardAt
    if (this.isSilent || this.misses < MSP_UNRESPONSIVE_MISSES || silentMs < this.silenceMs) {
      return
    }
    this.isSilent = true
    this.log.warn(
      `Muse Code is not answering: ${String(this.misses)} commands in a row missed their deadline (the last ${method}) and nothing came from it for ${String(Math.round(silentMs / MILLISECONDS_PER_SECOND))} s; new commands fail at once until it answers or restarts`,
    )
    this.onUnresponsive()
  }
}

/** What every command on one connection shares: its deadlines, its log and its watchdog. */
interface CommandChannel {
  readonly connection: Connection
  readonly timeouts: CommandTimeouts
  readonly log: CoreLogger
  readonly liveness: HostLiveness
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

/**
 * A card that waits on the user, an approval or a question: shown again to a
 * later surface, it is marked replayed, so it is never approved on its own
 * and raises no new notice (M82).
 */
function isPendingPrompt(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'approvalRequested' | 'questionRequested' }> {
  return event.type === 'approvalRequested' || event.type === 'questionRequested'
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * A turn's parts as MSP takes them. `TurnInputPart` is text, image or skill
 * in 1.3.0. Text files are named text parts; PDFs are refused because an
 * unknown type is `invalidParams` (msp.d.ts, M54, sdk issue #48).
 */
function mspInput(parts: readonly TurnPart[]): readonly TurnPart[] {
  const input: TurnPart[] = []
  let attachmentBytes = 0
  for (const part of parts) {
    if (part.type === 'file') {
      throw new Error(UI_TEXT.pdfNeedsModelApi)
    }
    const inputPart: TurnPart =
      part.type === 'textFile' ? { type: 'text', text: textFileInput(part) } : part
    if (part.type === 'image' || part.type === 'textFile') {
      attachmentBytes +=
        part.type === 'image'
          ? Buffer.byteLength(part.base64Data) +
            Buffer.byteLength(JSON.stringify({ ...part, base64Data: '' }))
          : Buffer.byteLength(JSON.stringify(inputPart))
      if (attachmentBytes > MSP_ATTACHMENT_FRAME_BUDGET_BYTES) {
        throw new Error(UI_TEXT.textFilesOverBudget)
      }
    }
    input.push(inputPart)
  }
  return input
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
  channel: CommandChannel,
  method: string,
  params: Record<string, unknown>,
  commandId: string,
): Promise<Record<string, unknown>> {
  const { log } = channel
  const commandParams = { ...params, commandId }
  // The host drops an oversized frame without answering it (D26).
  const frame = JSON.stringify({ ...FRAME_ENVELOPE, method, params: commandParams })
  if (Buffer.byteLength(frame) > MSP_FRAME_LIMIT_BYTES) {
    throw new Error(UI_TEXT.commandTooLarge)
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      const ack = await answered(channel, method, commandParams)
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
        `${method} refused (${failureForLog(error)}); attempt ${String(attempt + 1)} in ${String(delayMs)} ms`,
      )
      await pause(delayMs)
    }
  }
}

/**
 * One request's answer, heard by the watchdog: a result, or an error the
 * host wrote. A late answer, after its deadline, is heard too.
 */
async function answered(
  channel: CommandChannel,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const answer = await channel.connection.request(method, params)
    channel.liveness.heard()
    return answer
  } catch (error: unknown) {
    if (error instanceof MspError) {
      channel.liveness.heard()
    }
    throw error
  }
}

/**
 * A request with a deadline, refused at once while Muse Code is not
 * answering (the watchdog); a missed deadline counts toward that.
 */
async function requestWithin<T>(
  channel: CommandChannel,
  method: string,
  timeoutMs: number,
  request: () => Promise<T>,
): Promise<T> {
  if (channel.liveness.isUnresponsive) {
    channel.log.info(`${method} was not sent: Muse Code is not answering`)
    throw new Error(UI_TEXT.museCodeNotAnswering)
  }
  try {
    return await withDeadline(
      request(),
      timeoutMs,
      `Muse Code did not answer ${method} within ${String(Math.round(timeoutMs / MILLISECONDS_PER_SECOND))} s`,
    )
  } catch (error: unknown) {
    if (error instanceof DeadlineError) {
      channel.liveness.missed(method)
    }
    throw error
  }
}

/**
 * One MSP command with a deadline. `sessionNotLoaded` (the host evicted or
 * closed the session) becomes a `SessionNotLoadedError` the controller
 * answers by resuming the session.
 */
async function commandWithin(
  channel: CommandChannel,
  method: string,
  params: Record<string, unknown>,
  commandId: string = channel.connection.mintCommandId(),
): Promise<unknown> {
  const { log, timeouts } = channel
  const timeoutMs = MSP_LONG_COMMANDS.has(method) ? timeouts.longMs : timeouts.normalMs
  const startedAt = Date.now()
  try {
    const answer = await requestWithin(channel, method, timeoutMs, () =>
      sendCommand(channel, method, params, commandId),
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

/** Each cumulative MSP report is journaled immediately as a known delta. */
export class MuseUsageDeltas {
  private baseline: { inputTokens: number; outputTokens: number } | undefined
  private startedAt: number | undefined
  private currentModel: string
  public constructor(
    private readonly recording: UsageRecording,
    private readonly sessionId: string,
    modelId: string,
    isNew: boolean,
    private readonly now: () => number = Date.now,
  ) {
    this.currentModel = modelId
    if (isNew) this.baseline = { inputTokens: 0, outputTokens: 0 }
  }
  public receive(event: AgentEvent, isReplay = false): void {
    if (isReplay) {
      if (event.type === 'tokenUsage')
        this.baseline = { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
      return
    }
    if (event.type === 'turnStarted') {
      this.startedAt = this.now()
      return
    }
    if (event.type === 'turnCompleted') {
      this.startedAt = undefined
      return
    }
    if (event.type === 'modelChanged') {
      this.currentModel = event.modelId
      return
    }
    if (event.type !== 'tokenUsage') return
    const next = { inputTokens: event.inputTokens, outputTokens: event.outputTokens }
    const prior = this.baseline
    this.baseline = next
    if (event.modelId !== undefined) this.currentModel = event.modelId
    if (
      prior === undefined ||
      next.inputTokens < prior.inputTokens ||
      next.outputTokens < prior.outputTokens
    )
      return
    const input = next.inputTokens - prior.inputTokens
    const output = next.outputTokens - prior.outputTokens
    if (input === 0 && output === 0) return
    const at = this.now()
    const startedAt = this.startedAt ?? at
    this.recording.note(
      { input_tokens: input, output_tokens: output },
      {
        backend: 'museCode',
        provider: 'museCode',
        model: this.currentModel,
        session: this.sessionId,
        kind: 'turn',
        pricing: { kind: 'plan' },
        startedAt,
        durationMs: Math.max(0, at - startedAt),
        outcome: 'incomplete',
      },
    )
  }
}

export class MuseSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  /** One card per prompt and stage, and the open ones for a late listener (D26). */
  private readonly prompts = new PromptLedger()
  /** A stage's callers share its eventual result, and Stop waits for it. */
  private readonly decisionsInFlight = new Map<string, Promise<void>>()
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
  /** Told when Muse Code reports this session's event log failed (CLI recovery). */
  private readonly logDamagedListeners = new Set<() => void>()
  /**
   * Queued turns `turn/unqueued` withdrew (M87): MSP's authoritative removal,
   * which a lost or failed `turn/unqueue` ack does not undo.
   */
  private readonly unqueuedTurns = new Set<string>()
  private readonly log: CoreLogger
  private readonly timeouts: CommandTimeouts

  public constructor(
    public readonly sessionId: string,
    public modelId: string,
    private readonly channel: CommandChannel,
    private readonly onDispose: () => void,
    /** The host granted `userShell` at the handshake (M46): `!` commands may run. */
    private readonly canRunUserShell: boolean,
    private readonly usageDeltas?: MuseUsageDeltas,
  ) {
    this.log = channel.log
    this.timeouts = channel.timeouts
  }

  /** One MSP command against this session with a freshly minted commandId. */
  private async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      return await commandWithin(this.channel, method, { sessionId: this.sessionId, ...params })
    } catch (error: unknown) {
      this.noteLogFault(error)
      throw error
    }
  }

  /**
   * Muse Code 1.4.2 answers every message of a session whose event log
   * failed with that failure (the owner's session of 2026-10-02/03): the
   * conversation is told, which takes no new message in it after this.
   */
  private noteLogFault(error: unknown): void {
    if (!(error instanceof MspError) || !error.message.includes(MUSE_EVENT_LOG_FAULT)) {
      return
    }
    this.log.warn(
      `Muse Code reported session ${this.sessionId}'s event log failed (${failureForLog(error)}); the session takes no new message`,
    )
    notify(this.logDamagedListeners, undefined, this.log, 'museCode.logDamaged', (event) => {
      this.reportListenerFailure(event)
    })
  }

  private finishDispose(): void {
    this.isDisposed = true
    this.listeners.clear()
    this.logDamagedListeners.clear()
    notify([this.onDispose], undefined, this.log, 'museCode.disposed', (event) => {
      this.reportListenerFailure(event)
    })
  }

  /**
   * A Stop under a multi-stage approval with a stage already decided rejects
   * its waiting stage first, through `approval/decide`: a turn cancelled
   * under such an approval leaves Muse Code 1.4.2 refusing every later
   * `turn/start` of the session (the `approvalReplay` fault, captured live
   * 2026-10-02), while one whose approval was rejected first runs on.
   */
  private async rejectPartlyDecided(): Promise<void> {
    // A click locks the stage before its command settles. Let the host's
    // answer and stage update land before deciding what Stop must reject.
    while (this.decisionsInFlight.size > 0) {
      await Promise.allSettled(this.decisionsInFlight.values())
    }
    for (const approval of this.prompts.partlyDecided()) {
      await this.rejectWaitingStage(approval.approvalId)
    }
  }

  private async rejectWaitingStage(approvalId: string): Promise<void> {
    for (let attempt = 0; attempt < APPROVAL_REJECT_ATTEMPTS; attempt += 1) {
      const approval = this.prompts.pending(approvalId)
      const reject = approval?.availableChoices.find(
        (choice) => choice.decision === REJECT_DECISION,
      )
      if (approval === undefined || reject === undefined) {
        return
      }
      this.log.info(
        `Stop: approval ${approvalId} stage ${String(approval.requirementId.sourceIndex)} is rejected before the turn stops`,
      )
      // Bounded: a Stop never waits long on a host that does not answer.
      const deadlineMs = Math.min(APPROVAL_REJECT_DEADLINE_MS, this.timeouts.normalMs)
      try {
        await withDeadline(
          this.decideApproval({
            approvalId,
            choiceId: reject.choiceId,
            requirementId: approval.requirementId,
          }),
          deadlineMs,
          `the reject before the Stop did not answer within ${String(deadlineMs)} ms`,
        )
        return
      } catch (error: unknown) {
        // A stage that moved on is now the ledger's: rejected on the next pass.
        if (!isPromptSettledError(error) || error.reason !== 'movedOn') {
          this.log.warn(
            `Stop: rejecting approval ${approvalId} failed: ${failureForLog(error)}; the turn stops anyway`,
          )
          return
        }
      }
    }
  }

  /** The single wire decision whose outcome every caller of this stage sees. */
  private async sendApprovalDecision(decision: ApprovalDecision): Promise<void> {
    const { approvalId, requirementId } = decision
    let ack: unknown
    try {
      ack = await this.command('approval/decide', {
        approvalId,
        choiceId: decision.choiceId,
        requirementId,
        ...(decision.feedback !== undefined && { feedback: decision.feedback }),
      })
    } catch (error: unknown) {
      throw await this.decisionFailed(requirementId, error)
    }
    // `terminal: true` closed the whole approval; a trailing stage update the
    // host can still send for it must not reopen the card (the facade's #37538).
    if (approvalDecideResultSchema.safeParse(ack).data?.terminal === true) {
      this.prompts.close(approvalId)
    }
  }

  /** What a failed `approval/decide` means for its card (PLAN.md D26). */
  private async decisionFailed(requirementId: RequirementRef, error: unknown): Promise<unknown> {
    const { approvalId } = requirementId
    if (error instanceof MspError && error.kind === REQUIREMENT_STALE) {
      // The stage moved on. The refusal names the stage the host waits on;
      // the card goes there when Muse Code does not say so itself.
      const waiting = requirementRefSchema.safeParse(error.data['currentRequirementId'])
      const update = waiting.success ? this.prompts.advanceTo(waiting.data) : undefined
      if (update !== undefined) {
        this.log.info(
          `Approval ${approvalId} stage ${String(requirementId.sourceIndex)} was stale; the card moves to stage ${String(update.requirementId.sourceIndex)}, where Muse Code waits`,
        )
        this.emit(update)
      }
      return settledOr(error)
    }
    const settled = settledOr(error)
    if (isPromptSettledError(settled)) {
      this.prompts.close(approvalId)
      return settled
    }
    const fault = faultOr(error, 'approvalLedger')
    if (fault !== error) {
      // The decision applied (#29, and every decision after the replay
      // fault); the card follows the host's resolve.
      return fault
    }
    // No answer (the deadline, a closed connection): the command may still
    // be queued in a busy Muse Code and apply later. On 2026-10-02 one sent
    // at 23:49:40 was taken in at 23:52:33, after two more for the same
    // stage, sent from a card reopened at each deadline, which it refused as
    // stale. The stage stays decided; the card follows the host's events.
    if (!(error instanceof MspError)) {
      this.log.info(
        `Approval ${approvalId} stage ${String(requirementId.sourceIndex)}: no answer; it may still apply, so it is not offered again`,
      )
      return error
    }
    if (await this.isStillWaiting(requirementId)) {
      this.prompts.unmarkDecided(requirementId)
      return new DecisionNotAppliedError(error.message)
    }
    return error
  }

  /**
   * Whether the host, which answered the decision with a refusal, still
   * waits on this very stage: then the decision did not apply and may be
   * made again. A check that fails cannot tell, and the stage stays decided.
   */
  private async isStillWaiting(requirementId: RequirementRef): Promise<boolean> {
    let pending: z.infer<typeof listPendingResultSchema>
    try {
      pending = listPendingResultSchema.parse(await this.command('approval/listPending', {}))
    } catch (error: unknown) {
      this.log.warn(`approval/listPending after a failed decision failed: ${failureForLog(error)}`)
      return false
    }
    return pending.approvals.some((params) => {
      const parsed = pendingStageSchema.safeParse(params)
      return (
        parsed.success &&
        parsed.data.approvalId === requirementId.approvalId &&
        parsed.data.currentRequirementId.sourceIndex === requirementId.sourceIndex
      )
    })
  }

  /**
   * What a failed `turn/steer` means for its message (CLI recovery,
   * 2026-10-03). On 2026-10-02 a steer Muse Code answered after the 60 s
   * deadline had been taken for a refusal and sent again as a new turn, and
   * Muse Code applied both. So only a refusal that says no turn was there is
   * a `SteerRefusedError`; no answer (the deadline, a closed connection) is
   * said as such; any other refusal keeps its own words.
   */
  private steerFailure(expectedTurnId: string, error: unknown): unknown {
    if (error instanceof MspError) {
      const reason = error.data['reason']
      const isNoTurn =
        typeof reason === 'string' &&
        error.kind === COMMAND_REJECTED &&
        MSP_STEER_NO_TURN_REASONS.has(reason)
      return isNoTurn ? new SteerRefusedError(error.message) : faultOr(error, 'approvalReplay')
    }
    if (error instanceof DeadlineError || error instanceof ProtocolError) {
      this.log.warn(
        `turn/steer into turn ${expectedTurnId} got no answer (${failureForLog(error)}); it may still reach the turn, so the message is not sent again`,
      )
      return new Error(UI_TEXT.steerUnconfirmed, { cause: error })
    }
    return error
  }

  /** Muse Code reported this session's event log failed (`noteLogFault`). */
  public onLogDamaged(listener: () => void): () => void {
    this.logDamagedListeners.add(listener)
    return () => {
      this.logDamagedListeners.delete(listener)
    }
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
      notify(
        [listener],
        isPendingPrompt(event) ? { ...event, isReplayed: true } : event,
        this.log,
        'museCode.replay',
        (diagnostic) => {
          this.reportListenerFailure(diagnostic)
        },
      )
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** @internal Called by the host dispatcher. */
  public receive(mapped: MappedNotification, isReplay = false): void {
    if ('closedApprovalId' in mapped) {
      this.prompts.close(mapped.closedApprovalId)
      return
    }
    this.usageDeltas?.receive(mapped.event, isReplay)
    if (mapped.event.type === 'turnWithdrawn') {
      this.unqueuedTurns.add(mapped.event.turnId)
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
    notify(this.listeners, admitted, this.log, 'museCode.event', (event) => {
      this.reportListenerFailure(event)
    })
  }

  /** @internal Diagnostic delivery cannot recursively report a broken observer. */
  public reportListenerFailure(event: AgentEvent): void {
    notify(this.listeners, event, this.log, 'backend.diagnostic')
  }

  /** Submit one user turn; queued behind a running turn by host default. */
  /**
   * Submit a turn. `displayText` is the transcript's presentation form of the
   * prompt (MSP: durable, never model-visible), used when the parts carry
   * more than the user typed (editor context, M5).
   */
  public async sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission> {
    let ack: unknown
    try {
      ack = await this.command('turn/start', {
        input: mspInput(parts),
        ...(displayText !== undefined && { displayText }),
      })
    } catch (error: unknown) {
      throw faultOr(error, 'approvalReplay')
    }
    const result = turnStartResultSchema.parse(ack)
    return { turnId: result.turnId, disposition: result.disposition ?? DEFAULT_DISPOSITION }
  }

  /**
   * Inject input into the turn believed to be running. The host rejects the
   * steer when that turn is no longer the running one, so input meant for one
   * turn never leaks into the next. That refusal is a `SteerRefusedError`,
   * after which the caller may send the input as a new turn; a steer with no
   * answer may still reach the turn, and fails in words that say so.
   */
  public async steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<TurnSubmission> {
    const input = mspInput(parts)
    let result: unknown
    try {
      result = await this.command('turn/steer', { expectedTurnId, input })
    } catch (error: unknown) {
      throw this.steerFailure(expectedTurnId, error)
    }
    return { turnId: turnSteerResultSchema.parse(result).turnId, disposition: 'steered' }
  }

  /**
   * Take back a submit acknowledged `queued` before it launches (M87, PLAN.md
   * D66): MSP `turn/unqueue`. A steered message is in the running turn
   * already, which `turn/unqueue` does not reach: too late. As captured live
   * on 2026-10-04 (docs/certification/m87-c.md), the ack is admission and the
   * race at once (`turn/unqueued` follows, or comes first); a reclaim after
   * the launch is refused `run_active`, and one already won `already_applied`
   * (it will not run either way). Once `turn/unqueued` named the turn, a
   * timed-out or failed ack still reports the withdrawal (the review of lane
   * C); any other failure or refusal fails as Muse Code said it. Muse Code
   * keeps no image bytes, so none come back.
   */
  public async withdrawQueued(ref: QueuedMessageRef): Promise<WithdrawOutcome> {
    if (ref.disposition !== QUEUED_DISPOSITION) {
      return TOO_LATE
    }
    try {
      turnUnqueueResultSchema.parse(await this.command('turn/unqueue', { turnId: ref.turnId }))
    } catch (error: unknown) {
      const reason = unqueueRefusal(error)
      if (reason === UNQUEUE_LAUNCHED) {
        return TOO_LATE
      }
      // `turn/unqueued` can come before the ack (captured): once it came, a
      // timed-out or failed ack still means the message was taken back.
      if (reason !== UNQUEUE_ALREADY_WON && !this.unqueuedTurns.has(ref.turnId)) {
        throw error
      }
    }
    return { status: 'withdrawn', images: undefined }
  }

  /** Ask the host to stop the running turn gracefully. */
  public async cancel(): Promise<void> {
    await this.rejectPartlyDecided()
    await this.command('turn/cancel', {})
  }

  /** Stop the running turn immediately. */
  public async interrupt(): Promise<void> {
    await this.rejectPartlyDecided()
    await this.command('turn/interrupt', {})
  }

  /** Durable model selection; applies from the next model call. */
  public async setModel(modelId: string): Promise<void> {
    await this.command('session/setModel', { model: { modelId } })
    this.modelId = modelId
  }

  /** The session's standing reasoning-effort default (wire vocabulary). */
  public async setReasoningEffort(reasoningEffort: string): Promise<void> {
    await this.command('session/setReasoningEffort', { reasoningEffort })
  }

  /** Select one of the host's preconfigured approval modes. */
  public async setApprovalMode(mode: string): Promise<void> {
    try {
      await this.command('session/setApprovalMode', { mode })
    } catch (error: unknown) {
      throw ceilingOr(error)
    }
  }

  /** Summarise older context; `status` is `noop` with a reason when nothing to do. */
  public async compact(): Promise<CompactOutcome> {
    const result = compactResultSchema.parse(await this.command('session/compact', {}))
    return { status: result.status, reason: result.reason }
  }

  /**
   * Answer a gated tool call: one decision per stage (PLAN.md D26).
   * `requirementId` is the stage token from the request; a stale one is
   * rejected by the host, never silently applied. A second decision for a
   * stage already decided is not sent (a repeated click, a re-rendered card,
   * a second surface), nor one for a stage the approval has left.
   */
  public async decideApproval(decision: ApprovalDecision): Promise<void> {
    const { approvalId, requirementId } = decision
    const key = `${approvalId}\u{0}${String(requirementId.sourceIndex)}`
    const inFlight = this.decisionsInFlight.get(key)
    if (inFlight !== undefined) {
      await inFlight
      return
    }
    const stage = `approval ${approvalId} stage ${String(requirementId.sourceIndex)}`
    if (this.prompts.isClosed(approvalId)) {
      throw new PromptSettledError('alreadySettled', `${stage}: the approval is closed`)
    }
    if (this.prompts.isDecided(requirementId)) {
      this.log.info(`A second decision for ${stage} was not sent: one was sent already`)
      return
    }
    const waiting = this.prompts.pending(approvalId)?.requirementId
    if (waiting !== undefined && waiting.sourceIndex !== requirementId.sourceIndex) {
      // The card is behind the ledger: the update that moves it is on its way.
      this.log.info(
        `A decision for ${stage} was not sent: the approval waits on stage ${String(waiting.sourceIndex)}`,
      )
      throw new PromptSettledError('movedOn', `${stage}: the approval moved on`)
    }
    this.prompts.markDecided(requirementId)
    const pending = this.sendApprovalDecision(decision)
    this.decisionsInFlight.set(key, pending)
    try {
      await pending
    } finally {
      this.decisionsInFlight.delete(key)
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

  /** M46's captured clarification settles the tool; only our reserved ids display Deferred. */
  public async deferQuestions(userInputId: string): Promise<void> {
    const bundle = await import('../../questions/deferralEntry')
    await bundle.deferMuseQuestions(
      this,
      userInputId,
      () => this.prompts.markQuestionDeferred(userInputId),
      () => {
        this.prompts.unmarkQuestionDeferred(userInputId)
      },
      this.timeouts.normalMs,
      UI_TEXT.questionAnswerUncertain,
    )
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

  /** Captured owner verbs on a child (M18); M48's uncaptured verbs stay unavailable. */
  public async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    if (action === 'reopen' || action === 'readResult') {
      throw new Error(`subagent/${action}`)
    }
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
    const result = await this.command('item/readOutput', {
      itemId: request.itemId,
      outputRef: request.outputRef,
      offsetBytes: request.offsetBytes,
      lengthBytes: request.lengthBytes,
    })
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
    const result = await this.command('skill/list', {})
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
        `task/stopAll before releasing session ${this.sessionId} failed: ${failureForLog(error)}`,
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
  /** Injected once by the editor/runtime before hosts are constructed. */
  public static usageRecording: UsageRecording | undefined
  private readonly observedUsage = new Set<number>()
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: HostExit) => void>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  private readonly lifecycleListeners = new Set<(event: MuseCodeLifecycleEvent) => void>()
  private readonly deletionTerminalListeners = new Set<(event: MuseCodeLifecycleEvent) => void>()
  private readonly deletionStopped = new AbortController()
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
  /** Told once each time Muse Code stops answering (the watchdog, CLI recovery). */
  private readonly unresponsiveListeners = new Set<() => void>()
  /** The deadlines, log and watchdog every command on this connection shares. */
  private readonly channel: CommandChannel
  public readonly info: MuseHostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
    private readonly timeouts: CommandTimeouts = DEFAULT_TIMEOUTS,
    private readonly features: MuseCodeFeaturePorts = {},
    private readonly usageRecording = MuseCodeHost.usageRecording,
  ) {
    this.channel = {
      connection: host.connection,
      timeouts,
      log,
      liveness: new HostLiveness(
        timeouts.unresponsiveSilenceMs ?? MSP_UNRESPONSIVE_SILENCE_MS,
        log,
        () => {
          notify(
            this.unresponsiveListeners,
            undefined,
            this.log,
            'museCode.unresponsive',
            (event) => {
              this.reportListenerFailure(event)
            },
          )
        },
      ),
    }
    const parsed = initializeResultSchema.parse(host.initializeResult)
    const serverVersion = parsed.serverInfo.version
    this.info = {
      kind: 'museCode',
      serverName: parsed.serverInfo.name,
      serverVersion,
      museHome: parsed.museHome,
      grantedCapabilities: parsed.grantedCapabilities ?? [],
      // Muse Code refuses `session/rename` and `session/fork` on Windows
      // (meta-models/muse-code-sdk#30, #31): verified on 1.3.0 (2026-09-22)
      // and 1.4.0 (2026-09-27). No release has fixed them, so every version
      // is limited there until one is verified (D26). A 1.3.0 ceiling showed
      // the failing actions again on 1.4.0 (0.9.1, release-0.9.1.md).
      canEditSessions: parsed.platformOs !== WINDOWS_OS,
    }
    this.log.info(
      `MSP host on ${parsed.platformOs ?? 'an unreported OS'}, schema v${String(parsed.schema?.version ?? 'unreported')} ${parsed.schema?.fingerprint ?? ''}, sessions ${parsed.sessionDurability ?? DURABLE_SESSIONS}`,
    )
    if (parsed.sessionDurability !== undefined && parsed.sessionDurability !== DURABLE_SESSIONS) {
      this.log.warn(
        `This muse serve keeps ${parsed.sessionDurability} sessions: History and resume will not find them after it exits, and Muse Code 1.3.0 sent such a host's turns to no client (PLAN.md D43)`,
      )
    }
    // The SDK's connection keeps one handler; a throw inside it would end the
    // read loop and leave the connection deaf without a word (D25).
    host.connection.onNotification((notification) => {
      this.channel.liveness.heard()
      try {
        this.dispatch(notification)
      } catch (error: unknown) {
        this.log.error(`MSP ${notification.method} could not be handled: ${failureForLog(error)}`)
      }
    })
    host.connection.onServerRequest((request) => {
      this.channel.liveness.heard()
      return this.serverRequest(request)
    })
    // A dropped or unreadable frame gets fixed words, never its content.
    host.connection.onProtocolError(() => {
      this.log.warn('MSP protocol error (frame not logged)')
    })
    // A connection that ends while the process lives (a framing violation)
    // is as good as dead: the process is closed so the exit is reported.
    void host.connection.closed.then(() => {
      this.deletionStopped.abort(new Error(UI_TEXT.sessionDeleteConnectionClosed))
      if (this.isClosing) {
        return
      }
      this.log.warn('The MSP connection closed while muse serve was running; closing it')
      void this.host.close()
    })
    void host.exited.then((exit) => {
      this.deletionStopped.abort(new Error(UI_TEXT.sessionDeleteHostExited))
      const described = describeExit(exit, this.isClosing)
      if (described.isExpected) {
        this.log.info(`muse serve exited as asked (${described.description})`)
      } else {
        this.log.warn(`muse serve exited (${described.description})`)
      }
      notify(this.exitListeners, described, this.log, 'museCode.exit', (event) => {
        this.reportListenerFailure(event)
      })
    })
  }

  private reportListenerFailure(event: AgentEvent): void {
    for (const session of this.sessions.values()) {
      session.reportListenerFailure(event)
    }
  }

  /** One notification: a host-level event, or a session's. */
  private dispatch(notification: WireNotification): void {
    if (this.dispatchHostEvent(notification.method, notification.params)) {
      return
    }
    this.deliver(notification)
  }

  /** A session's notification to its handle; false when nothing can show it. */
  private deliver(notification: WireNotification, isReplay = false): boolean {
    const mapped = mapNotification(notification)
    if (mapped === UNKNOWN_METHOD || mapped === MALFORMED_PARAMS) {
      this.noteUnmapped(notification.method, mapped)
      return false
    }
    const admitted: MappedNotification =
      isReplay && 'event' in mapped && isPendingPrompt(mapped.event)
        ? { ...mapped, event: { ...mapped.event, isReplayed: true } }
        : mapped
    const session = this.sessions.get(admitted.sessionId)
    if (session !== undefined) {
      session.receive(admitted, isReplay)
      return true
    }
    if (this.opening > 0) {
      const waiting = this.unclaimed.get(admitted.sessionId) ?? []
      waiting.push(admitted)
      this.unclaimed.set(admitted.sessionId, waiting)
      return true
    }
    this.log.warn(`MSP event ${notification.method} for unknown session ${admitted.sessionId}`)
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
    return await commandWithin(this.channel, method, params)
  }

  /**
   * Host-level notifications bypass the per-session routing: the list
   * stream (`sessionListStream` grant) is about stored sessions, loaded here
   * or not, and `usage/changed` is about the account. True when the method
   * was one of them.
   */
  private dispatchHostEvent(method: string, params: unknown): boolean {
    if (
      this.features.lifecycle !== undefined &&
      (method === 'session/started' || method === 'session/deleteCompleted')
    ) {
      const event = this.features.lifecycle.parseNotification({ method, params })
      if (event.type === 'started') {
        notify(
          this.listListeners,
          { type: 'changed', record: event.record },
          this.log,
          'museCode.list',
        )
      }
      if (event.type === 'deleteCompleted' && event.outcome === 'completed') {
        this.sessions.get(event.sessionId)?.disposeAll()
      }
      notify(this.deletionTerminalListeners, event, this.log, 'museCode.deleteTerminal')
      notify(this.lifecycleListeners, event, this.log, 'museCode.lifecycle')
      return true
    }
    if (method === USAGE_CHANGED) {
      const parsed = subscriptionUsageSchema.safeParse(params)
      if (parsed.success) {
        const usage = parsed.data
        if (!this.observedUsage.has(usage.observedAtMs)) {
          this.observedUsage.add(usage.observedAtMs)
          this.usageRecording?.limit({
            backend: 'museCode',
            provider: 'museCode',
            source: 'museCode',
            observedAt: usage.observedAtMs,
            windows: [
              {
                id: 'window',
                usedPercent: usage.window.usedPercent,
                resetsAt: usage.window.resetsAtMs,
                windowMins: usage.window.windowDurationMins,
              },
              {
                id: 'weekly',
                usedPercent: usage.weekly.usedPercent,
                resetsAt: usage.weekly.resetsAtMs,
              },
            ],
          })
        }
        notify(this.usageListeners, parsed.data, this.log, 'museCode.usage', (event) => {
          this.reportListenerFailure(event)
        })
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
    notify(this.listListeners, event, this.log, 'museCode.list', (diagnostic) => {
      this.reportListenerFailure(diagnostic)
    })
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
  private track(
    record: { readonly sessionId: string },
    modelId: string,
    isNew = false,
  ): MuseSession {
    const existing = this.sessions.get(record.sessionId)
    if (existing !== undefined) {
      // A second surface on the same session: closing one must not deafen the other.
      existing.retain()
      return existing
    }
    const handle = new MuseSession(
      record.sessionId,
      modelId,
      this.channel,
      () => {
        this.sessions.delete(record.sessionId)
      },
      this.info.grantedCapabilities.includes(MSP_USER_SHELL_CAPABILITY),
      this.usageRecording === undefined
        ? undefined
        : new MuseUsageDeltas(this.usageRecording, record.sessionId, modelId, isNew),
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
        this.deliver({ method: 'approval/requested', params }, true)
      }
      for (const params of pending.userInputs) {
        this.deliver({ method: 'userInput/requested', params })
      }
    } catch (error: unknown) {
      this.log.warn(
        `approval/listPending after resuming ${sessionId} failed: ${failureForLog(error)}`,
      )
    }
  }

  private mcpConfig(
    mcpServers: Readonly<Record<string, SessionMcpServer>> | undefined,
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
            'command' in server
              ? {
                  transport: 'stdio',
                  command: server.command,
                  args: server.args,
                  env: server.env,
                  mode: 'optional',
                }
              : {
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
      const raw = await requestWithin(this.channel, VIEW_PAGE, this.timeouts.normalMs, () =>
        answered(this.channel, VIEW_PAGE, {
          sessionId,
          limit: GOAL_RECOVERY_PAGE_LIMIT,
          direction: 'backward',
          ...(cursor !== undefined && { cursor }),
        }),
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

  /**
   * Told once each time Muse Code stops answering (the watchdog): commands
   * missed their deadlines and nothing came from it for a while. It answers
   * again on its own only if a frame arrives; the window restarts it.
   */
  public onUnresponsive(listener: () => void): () => void {
    this.unresponsiveListeners.add(listener)
    return () => {
      this.unresponsiveListeners.delete(listener)
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

  /** Includes every returned deletion outcome; only known terminals settle a command. */
  public onMuseCodeLifecycleEvent(listener: (event: MuseCodeLifecycleEvent) => void): () => void {
    this.lifecycleListeners.add(listener)
    return () => {
      this.lifecycleListeners.delete(listener)
    }
  }

  /** The caller confirms permanent deletion before invoking this operation. */
  public async deleteSession(sessionId: string): Promise<MuseCodeLifecycleEvent> {
    const reader = this.features.lifecycle
    if (reader === undefined) throw new Error(UI_TEXT.memoryDeleteAction)
    const signal = this.deletionStopped.signal
    signal.throwIfAborted()
    const commandId = this.channel.connection.mintCommandId()
    const deletion: {
      state:
        | { phase: 'pending' }
        | { phase: 'terminalValidated'; event: MuseCodeLifecycleEvent }
        | { phase: 'reported' }
    } = { state: { phase: 'pending' } }
    // Arm before dispatch: the notification can be in the same read as admission.
    let onTerminal: ((event: MuseCodeLifecycleEvent) => void) | undefined
    const terminal = new Promise<MuseCodeLifecycleEvent>((resolve) => {
      onTerminal = (event) => {
        if (
          deletion.state.phase !== 'pending' ||
          event.type !== 'deleteCompleted' ||
          event.sessionId !== sessionId ||
          event.commandId !== commandId ||
          (event.outcome !== 'completed' && event.outcome !== 'failed')
        ) {
          return
        }
        deletion.state = { phase: 'terminalValidated', event }
        resolve(event)
      }
      this.deletionTerminalListeners.add(onTerminal)
    })
    let onAbort: (() => void) | undefined
    const stopped = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error(UI_TEXT.sessionDeleteHostClosed))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      return await withDeadline(
        Promise.race([
          (async () => {
            reader.parseDeleteAdmission(
              await commandWithin(this.channel, 'session/delete', { sessionId }, commandId),
              commandId,
            )
            return await terminal
          })(),
          stopped,
        ]),
        this.timeouts.deleteTerminalMs ?? this.timeouts.longMs,
        UI_TEXT.sessionDeleteTimedOut,
      )
    } catch (error: unknown) {
      // Dispatch validated the terminal before shutdown; async admission may still be resuming.
      if (deletion.state.phase === 'terminalValidated') return deletion.state.event
      throw error
    } finally {
      deletion.state = { phase: 'reported' }
      if (onTerminal !== undefined) this.deletionTerminalListeners.delete(onTerminal)
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
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
    mcpServers?: Readonly<Record<string, SessionMcpServer>>,
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
  public async listModels(sessionId?: string): Promise<readonly MuseCodeModelSummary[]> {
    const result = await this.command('model/list', {
      ...(sessionId !== undefined && { sessionId }),
    })
    return modelListResultSchema.parse(result).models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      contextLimit: model.contextLimit ?? undefined,
      isDefault: model.isDefault,
      isActive: model.isActive ?? false,
      ...this.features.modelEfforts?.parseModel(model),
    }))
  }

  /** Registered literal secrets remain in the host; only the scrubbed note is previewed. */
  public previewFeedbackNote(note: string): string {
    return redactSecrets(note, this.features.feedback?.secretLiterals?.() ?? [])
  }

  /** The user's confirmed disclosure choices; send once, never replay an upload. */
  public async submitFeedback(input: FeedbackRequest): Promise<string> {
    const reader = this.features.feedback
    if (reader === undefined || !this.info.grantedCapabilities.includes('feedback')) {
      throw new Error(UI_TEXT.feedbackFailed)
    }
    return await submitMuseFeedback(
      input,
      {
        scrubNote: (note) => Promise.resolve(this.previewFeedbackNote(note)),
        submit: async (request) =>
          reader.parseOutcome(
            await requestWithin(this.channel, 'feedback/submit', this.timeouts.normalMs, () => {
              // The registry may change during the async scrub. Recheck it in
              // the dispatch tick and send only the preview the person approved.
              const note = this.previewFeedbackNote(request.note)
              if (note !== request.note) throw new Error(UI_TEXT.feedbackFailed)
              return answered(this.channel, 'feedback/submit', { ...request, note })
            }),
          ),
      },
      input.note,
    )
  }

  public async startSession(options: StartSessionOptions): Promise<MuseSession> {
    return await this.opened(async () => {
      let result: unknown
      try {
        result = await this.command('session/start', {
          workspaceRoot: options.workspaceRoot,
          modelId: options.modelId,
          approvalMode: options.approvalMode,
          ...this.mcpConfig(options.mcpServers),
        })
      } catch (error: unknown) {
        throw ceilingOr(error)
      }
      const { session } = sessionStartResultSchema.parse(result)
      return this.track(session, session.modelId ?? options.modelId, true)
    })
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public async close(): Promise<void> {
    // The exit that follows is the extension's own (D25).
    this.isClosing = true
    this.deletionStopped.abort(new Error(UI_TEXT.sessionDeleteHostClosed))
    // Close the process first: the host emits session/statusChanged for every
    // loaded session on the way down, and those must still find their session.
    try {
      await this.host.close()
    } finally {
      for (const session of this.sessions.values()) {
        session.disposeAll()
      }
    }
  }
}
