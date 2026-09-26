// The Model API backend (PLAN.md D1, M7): sessions held in this process,
// each a replayed conversation on `POST /v1/responses` (stateless reasoning
// replay, `store: false`) with the in-process tool harness, the permission
// engine and the approval / question cards of the transcript. Emits the
// same AgentEvents as the Muse Code host, so nothing above it changes.
// Sessions live for the host's lifetime (this VS Code window).

import { Buffer } from 'node:buffer'
import type {
  AgentEvent,
  ApprovalSubject,
  ItemSnapshot,
  QuestionAnswer,
  TodoItem,
} from '../../../shared/agentEvents'
import {
  AUTH_REQUIRED_ERROR_KIND,
  BACKGROUND_INITIATOR_USER,
  CLARIFICATION_MAX_CHARS,
  CONTEXT_PRESSURE_HIGH,
  CONTEXT_PRESSURE_MEDIUM,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GOAL_OBJECTIVE_MAX_CHARS,
  GOAL_STATUS,
  type GoalCommandVerb,
  type SubagentAction,
  HTTP_UNAUTHORIZED,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_EFFORT_OFF,
  ISO_DATE_LENGTH,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_MAX_RETRIES,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_API_RETRYABLE_STREAM_CODES,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_OUTPUT_ENCODING,
  MODEL_API_OUTPUT_MEDIA_TYPE,
  MODEL_API_SERVER_NAME,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
  MODEL_API_VERSION,
  MODEL_API_WEB_SEARCH_TOOL,
  MODEL_TEXT,
  OUTPUT_REF_PREFIX,
  type PaidFeature,
  QUESTION_OUTCOME_CLARIFIED,
  STORED_SESSION_VERSION,
  SUBAGENT_CAPACITY,
  SUBAGENT_DEPTH,
  SUBAGENT_ID_PREFIX,
  SUBAGENT_MAX_PER_CONVERSATION,
  SUBAGENT_RESULT_READY,
  SUBAGENT_WAIT_DEFAULT_MS,
  SUBAGENT_SUMMARY_MAX_CHARS,
  SUBAGENT_RESULT_TEXT_MAX_CHARS,
  SUBAGENT_TASK_MAX_REQUESTS,
  THINKING_OFF_EFFORT,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
  USER_SHELL_ITEM_KIND,
  USER_SHELL_TIMEOUT_MS,
} from '../../../shared/constants'
import { plural } from '../../../shared/l10n/text'
import { APPROVAL_MODES, type ApprovalMode } from '../../../shared/permissionModes'
import { fill } from '../../../shared/l10n/text'
import {
  modelApiPaidTier,
  type SubagentTaskConfirmation,
  type SubagentUsage,
} from '../../../shared/paid'
import type { SubscriptionUsage } from '../../../shared/usage'
import {
  type AgentHost,
  type AgentSession,
  type ApprovalDecision,
  type CompactOutcome,
  type GoalCommand,
  type GoalCommandOutcome,
  type GoalRefusal,
  GoalRefusedError,
  type HostExit,
  type HostInfo,
  type ListSessionsOptions,
  type LoadedSession,
  type ModelSummary,
  type OutputPage,
  type OutputPageRequest,
  type SessionEventListener,
  type SessionHistoryOutcome,
  type SessionListEvent,
  type SessionPage,
  type SessionRecord,
  type SkillSummary,
  type StartSessionOptions,
  type TurnPart,
  type TurnSubmission,
} from '../../agent/agentBackend'
import type { ContextIo } from '../../context/contextFiles'
import { type SkillDefinition } from '../../context/skills'
import { WorkspaceContext } from '../../context/workspaceContext'
import type { CoreLogger } from '../../logging'
import {
  MissingApiKeyError,
  type ModelApiClient,
  ModelApiError,
  type RetryBudget,
  type RetryNotice,
  type ResponseAttemptGuard,
} from './client'
import {
  applyGoalCommand,
  type GoalContext,
  goalInstructions,
  goalObjectiveProblem,
  type GoalRecord,
  isGoalActive,
  runGoalTool,
  toSessionGoal,
  withTokensUsed,
} from './goals'
import { type EnvironmentFacts, instructionsFor } from './instructions'
import { type ImagePlan, prepareImageCall, runImageCall } from './imageGeneration'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  isProtectedPath,
  paidChoices,
  PermissionEngine,
  type PermissionQuery,
} from './permissions'
import {
  headerOf,
  recordOf,
  type SessionStore,
  type StoredSession,
  type StoredSessionHeader,
} from './sessionStore'
import {
  type Citation,
  citationsOf,
  type CreateResponseBody,
  type FunctionCallItem,
  type IncludeField,
  type InputContentPart,
  type InputItem,
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  isWebSearchCallItem,
  messageText,
  type OutputItem,
  type ResponseObject,
  type StreamEvent,
  type ToolDefinition,
  type Usage,
  type WebSearchCallItem,
} from './schemas'
import {
  classifyTool,
  confineWorkspacePath,
  executeTool,
  parseQuestions,
  type PathResolution,
  readSkillArgs,
  type ShellResult,
  shellOutcome,
  shellText,
  ShellTimeLimit,
  shellToolFor,
  todoWriteArgs,
  toolDefinitions,
  type ToolIo,
  type ToolOutcome,
} from './tools'
import {
  isSubagentTool,
  sendMessageArgs,
  spawnArgs,
  statusArgs,
  type SubagentState,
  targetArgs,
  waitArgs,
} from './subagentTools'

/** Paid state and usage are injected by the host, never read from workspace settings. */
export interface ModelApiPaidHooks {
  /** Whether a paid feature is on: its machine setting and accepted price. */
  readonly isPaidFeatureOn: (feature: PaidFeature) => boolean
  /** Counts attempts and extra-feature uses for the window. */
  readonly notePaidUse: (feature: PaidFeature, units: number) => void
  /** A fresh user decision before an owner-initiated child task. */
  readonly confirmSubagentTask: (task: SubagentTaskConfirmation) => Promise<boolean>
  /** Child token cost is a subset of the parent's conversation estimate. */
  readonly noteSubagentUsage: (modelId: string, usage: SubagentUsage) => void
}

export interface ModelApiHostDeps extends ModelApiPaidHooks {
  readonly client: ModelApiClient
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: ToolIo
  /** What the rules, skills and memory loaders read through (PLAN.md D27). */
  readonly contextIo: ContextIo
  readonly newId: () => string
  /** Epoch milliseconds. */
  readonly now: () => number
  readonly log: CoreLogger
  /** Muse Code's personal skill root (PLAN.md D13); undefined without a home. */
  readonly personalSkillsRoot: string | undefined
  /** VS Code workspace trust: gates rules, skills, memory and the shell (D13). */
  readonly isWorkspaceTrusted: () => boolean
  /** Sessions between windows (D14); undefined without workspace storage. */
  readonly store?: SessionStore | undefined
  /** The git facts for the prompt's environment section (D15), read once per session. */
  readonly describeEnvironment: () => Promise<EnvironmentFacts>
}

const NO_ENVIRONMENT: EnvironmentFacts = { git: undefined }

interface ReplayItem {
  readonly turnId: string
  readonly item: InputItem
  /** The background task whose terminal context this note carries (M46). */
  readonly backgroundTaskId?: string
}

interface PendingNote {
  readonly text: string
  readonly backgroundTaskId?: string
}

interface TranscriptItem {
  readonly turnId: string
  readonly item: ItemSnapshot
}

/** One Model API child: a private session with its own replay and transcript. */
interface ChildRecord {
  readonly id: string
  readonly role: string
  readonly objective: string
  readonly itemId: string
  readonly parentTurnId: string
  readonly session: ModelApiSession
  readonly startedAt: number
  state: SubagentState
  result:
    { readonly summary: string; readonly text?: string; readonly errorKind?: string } | undefined
  terminal: string | undefined
  usage: {
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    reasoningTokens: number
  }
  /** The goal active when this child's current turn began, never a later replacement. */
  chargedGoalId: string | undefined
  readonly waiters: Set<() => void>
  readonly pendingMessages: string[]
  followupAfterStop: string | undefined
  /** New consent waiting for an interrupted prior turn to finish; never persisted. */
  nextTaskGrant: ChildTaskGrant | undefined
  /** Any state change invalidates a modal opened before it. */
  revision: number
}

/** One consented child task; only in memory, never in the session snapshot. */
interface ChildTaskGrant {
  readonly modelId: string
  readonly keyDigest: string
  readonly goalId: string | undefined
  remainingAttempts: number
}

interface QueuedTurn {
  readonly turnId: string
  readonly parts: readonly TurnPart[]
  readonly displayText: string | undefined
  /**
   * Woken by a goal command (M45, PLAN.md D38): its prompt is the model's
   * cue, replayed but not a message of the user's, so the transcript shows
   * no card for it, as Muse Code's goal turns have none (live 2026-09-25).
   */
  readonly isGoalWake: boolean
  /** The accepted user goal command this queued wake must still serve. */
  readonly goalCommandRevision?: number
}

// MSP's words for a goal refusal (captured live 2026-09-25), in the error's text.
const GOAL_REFUSAL_REASONS: Readonly<Record<GoalRefusal, string>> = {
  noGoal: 'missing_goal',
  wrongState: 'invalid_goal_state',
}
// The verbs that wake the agent when they leave the goal active (MSP's wake gate).
const GOAL_WAKING_VERBS: ReadonlySet<GoalCommandVerb> = new Set(['set', 'edit', 'resume'])

interface ActiveTurn {
  readonly turnId: string
  readonly abort: AbortController
  /** Steered input, appended before the next model call. */
  readonly steered: (readonly TurnPart[])[]
  /** A goal accepted after the current model request began needs another round. */
  goalWakePending: boolean
}

interface Pending<T> {
  resolve(value: T): void
  reject(error: Error): void
}

/** How the question card settled a prompt (M16), an explanation included (M46). */
type QuestionReply =
  | { readonly kind: 'answered'; readonly answers: readonly QuestionAnswer[] }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'clarified'; readonly text: string }

/**
 * A tool's result. A shell call the user moved to the background (M46)
 * answers the model at once and carries the command's own end.
 */
interface Performed {
  readonly outcome: ToolOutcome
  readonly running?: Promise<ToolOutcome>
}

/** A permission check and the tool, or the refusal. */
interface CallResult extends Performed {
  readonly isRejected: boolean
}

// A UTF-8 continuation byte is 0b10xxxxxx: it never starts a character.
const UTF8_CONTINUATION_FIRST = 0x80
const UTF8_CONTINUATION_LAST = 0xbf

function isContinuationByte(bytes: Uint8Array, index: number): boolean {
  const byte = bytes[index]
  return byte !== undefined && byte >= UTF8_CONTINUATION_FIRST && byte <= UTF8_CONTINUATION_LAST
}

/** `index` moved back to the first byte of the character it falls in. */
function characterStart(bytes: Uint8Array, index: number): number {
  let start = index
  while (start > 0 && isContinuationByte(bytes, start)) {
    start -= 1
  }
  return start
}

/** The index just past the character that starts at `index`. */
function characterEnd(bytes: Uint8Array, index: number): number {
  let end = index + 1
  while (end < bytes.length && isContinuationByte(bytes, end)) {
    end += 1
  }
  return end
}

interface ApprovalOutcome {
  readonly isApproved: boolean
  readonly feedback: string | undefined
}

/** Where a streamed output item stands while its deltas arrive. */
interface OpenItem {
  readonly ourId: string
  /** A search (M33) is shown as a tool row, marked paid. */
  readonly kind: 'agentMessage' | 'reasoning' | 'webSearch'
  text: string
  readonly summary: string[]
  /** In the transcript as completed: a later sight of the item only updates it. */
  isCompleted: boolean
  /** The sources the completed reply cited, as the transcript has them (M33). */
  citations: readonly Citation[]
}

/** What a search row shows: the query (or page) as its arguments, the results as its output. */
function searchPresentation(item: WebSearchCallItem): {
  readonly args: string
  readonly output: string
} {
  const { action } = item
  let args: Record<string, string> = {}
  if (action?.type === 'search') {
    const queries = action.queries ?? (action.query === undefined ? [] : [action.query])
    args = { query: queries.join(' · ') }
  } else if (typeof action?.url === 'string') {
    args = { url: action.url, ...(action.pattern !== undefined && { pattern: action.pattern }) }
  }
  // The row's result has Muse Code's own `web_search` shape (captured live
  // 2026-09-25), so both backends' searches render as the same list (M43).
  const found = item.results ?? []
  const results =
    found.length > 0
      ? found.map((result) => ({
          url: result.url,
          ...(typeof result.title === 'string' && result.title !== '' && { title: result.title }),
          ...(typeof result.snippet === 'string' &&
            result.snippet !== '' && { snippet: result.snippet }),
        }))
      : (action?.sources ?? []).map((source) => ({ url: source.url }))
  return { args: JSON.stringify(args), output: JSON.stringify({ results }) }
}

/**
 * The searches a call is counted as for the tally. Meta prices search
 * queries and does not say how a call with several queries, or one that
 * opened a page, is counted (research, 2026-09-25): each query counts, and
 * any other call counts once, so the estimate errs high rather than low.
 */
function searchUnits(item: WebSearchCallItem): number {
  const queries = item.action?.type === 'search' ? (item.action.queries?.length ?? 1) : 1
  return Math.max(queries, 1)
}

function isSameCitations(a: readonly Citation[], b: readonly Citation[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (citation, index) => citation.url === b[index]?.url && citation.title === b[index].title,
    )
  )
}

const IN_PROGRESS = 'inProgress'
const COMPLETED = 'completed'
const FAILED = 'failed'
const REJECTED = 'rejected'
const CANCELLED = 'cancelled'
const CHILD_RESULT_STATES: ReadonlySet<SubagentState> = new Set([
  'result_ready',
  'closed',
  'interrupted',
])
const FORWARDED_CHILD_EVENTS: ReadonlySet<AgentEvent['type']> = new Set([
  'turnStarted',
  'itemStarted',
  'itemUpdated',
  'itemCompleted',
  'textDelta',
  'approvalRequested',
  'approvalUpdated',
  'approvalResolved',
])
const IDLE = 'idle'
const RUNNING = 'running'
const NOOP = 'noop'
const ACCEPTED = 'accepted'
const NO_COMPACTABLE_HISTORY = 'no_compactable_history'
const COMPACTION_TURN_ID = 'compaction'
const MODEL_API_ERROR_KIND = 'modelApi'
const TURN_NOT_RUNNING = 'the turn is not running'

/** Re-read mutable abort state after awaits and between returned calls. */
function isAbortRequested(signal: AbortSignal): boolean {
  return signal.aborted
}
const TURN_RUNNING = 'a turn is running'
const SUMMARY_FIELD_PREFIX = 'summary.'
const TEXT_FIELD = 'text'
const OUTPUT_TEXT = 'output_text'
const COMMENTARY_PHASE = 'commentary'
const PRESSURE_LOW = 'low'
const PRESSURE_MEDIUM = 'medium'
const PRESSURE_HIGH = 'high'
const ANSWERED = 'answered'
const DECISION_APPROVED = 'approved'
const DECISION_ABORT = 'abort'
const RESOLVED_BY_USER = 'user'
const NO_UNSUBSCRIBE = (): undefined => undefined
// A child is recorded inside its parent, not in the host's session map.
const NO_CHILD_DISPOSAL = (): undefined => undefined

/** A stream that ended with an error event the docs say to retry (the whole request). */
class RetryableStreamError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'RetryableStreamError'
  }
}

class AbortedError extends Error {
  public constructor() {
    super('cancelled')
    this.name = 'AbortedError'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof MissingApiKeyError ||
    (error instanceof ModelApiError && error.status === HTTP_UNAUTHORIZED)
  )
}

function pressureFor(used: number, window: number): string {
  const fraction = used / window
  if (fraction >= CONTEXT_PRESSURE_HIGH) {
    return PRESSURE_HIGH
  }
  return fraction >= CONTEXT_PRESSURE_MEDIUM ? PRESSURE_MEDIUM : PRESSURE_LOW
}

function toolFailure(reason: string): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
}

/**
 * A transcript brought back or copied into a fork: a background command still
 * running in the original runs only there (or went with its window), so its
 * row here reads interrupted, never running for ever (M46).
 */
function withoutRunning(entries: readonly TranscriptItem[]): readonly TranscriptItem[] {
  return entries.map((entry) =>
    entry.item.status === IN_PROGRESS
      ? { ...entry, item: { ...entry.item, status: TOOL_STATUS_INTERRUPTED } }
      : entry,
  )
}

/** A user message the model reads before its next request (M46). */
function noteItem(text: string): InputItem {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
}

/** What the model is told a question card settled with. */
function questionResultText(reply: QuestionReply): string {
  switch (reply.kind) {
    case 'answered': {
      return `${MODEL_TEXT.answersPrefix}\n${JSON.stringify(reply.answers)}`
    }
    case 'cancelled': {
      return MODEL_TEXT.questionCancelledOutput
    }
    case 'clarified': {
      return `${MODEL_TEXT.clarificationLead}\n${reply.text}`
    }
  }
}

function subagentFailure(reason: string): ToolOutcome {
  return {
    output: `Error: ${reason}`,
    visibleOutput: UI_TEXT.agentControlFailed,
    failureReason: UI_TEXT.agentControlFailed,
  }
}

const CHILD_TASK_REFUSALS = [
  'paidOff',
  'consentDeclined',
  'requestLimit',
  'keyChanged',
  'modelChanged',
  'goalEnded',
  'tariffUnknown',
  'planMode',
  'webSearchOff',
] as const
type ChildTaskRefusal = (typeof CHILD_TASK_REFUSALS)[number]

function childTaskMessages(kind: ChildTaskRefusal): {
  readonly model: string
  readonly visible: string
} {
  switch (kind) {
    case 'paidOff': {
      return { model: MODEL_TEXT.subagentPaidOff, visible: UI_TEXT.subagentPaidOff }
    }
    case 'consentDeclined': {
      return { model: MODEL_TEXT.subagentConsentDeclined, visible: UI_TEXT.subagentConsentDeclined }
    }
    case 'requestLimit': {
      const limit = SUBAGENT_TASK_MAX_REQUESTS
      return {
        model: fill(MODEL_TEXT.subagentRequestLimit, { limit }),
        visible: fill(UI_TEXT.subagentRequestLimit, { limit }),
      }
    }
    case 'keyChanged': {
      return { model: MODEL_TEXT.subagentKeyChanged, visible: UI_TEXT.subagentKeyChanged }
    }
    case 'modelChanged': {
      return { model: MODEL_TEXT.subagentModelChanged, visible: UI_TEXT.subagentModelChanged }
    }
    case 'goalEnded': {
      return { model: MODEL_TEXT.subagentGoalEnded, visible: UI_TEXT.subagentGoalEnded }
    }
    case 'tariffUnknown': {
      return { model: MODEL_TEXT.subagentTariffUnknown, visible: UI_TEXT.subagentTariffUnknown }
    }
    case 'planMode': {
      return { model: MODEL_TEXT.subagentPlanMode, visible: UI_TEXT.subagentPlanMode }
    }
    case 'webSearchOff': {
      return { model: MODEL_TEXT.subagentWebSearchOff, visible: UI_TEXT.subagentWebSearchOff }
    }
  }
}

function childTaskFailure(kind: ChildTaskRefusal): ToolOutcome {
  const { model, visible } = childTaskMessages(kind)
  return { output: `Error: ${model}`, visibleOutput: visible, failureReason: visible }
}

class ChildTaskRefusedError extends Error {
  public readonly visible: string

  public constructor(public readonly kind: ChildTaskRefusal) {
    const messages = childTaskMessages(kind)
    super(messages.model)
    this.name = 'ChildTaskRefusedError'
    this.visible = messages.visible
  }
}

function modelChildFailure(
  errorKind: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const kind = CHILD_TASK_REFUSALS.find((candidate) => errorKind === `subagent_${candidate}`)
  return kind === undefined ? fallback : childTaskMessages(kind).model
}

function childStateLabel(state: SubagentState): string {
  switch (state) {
    case 'queued': {
      return UI_TEXT.agentStatuses.queued
    }
    case 'running': {
      return UI_TEXT.agentStatuses.inProgress
    }
    case 'interrupted': {
      return UI_TEXT.agentStatuses.interrupted
    }
    case 'result_ready': {
      return UI_TEXT.agentStatuses.resultReady
    }
    case 'closed': {
      return UI_TEXT.agentStatuses.closed
    }
  }
}

/** A typed `/id arguments`, as the transcript shows it. */
function typedInvocation(selector: string, args: string | undefined): string {
  return `/${selector}${args === undefined ? '' : ` ${args}`}`
}

/**
 * A skill invocation as the model receives it: the host expands the skill's
 * body with the arguments, as Muse Code does for a `skill` input part.
 */
function skillInvocationText(skill: SkillDefinition, args: string | undefined): string {
  return `${MODEL_TEXT.skillInvoked} "${skill.id}". ${MODEL_TEXT.skillArguments} ${args ?? MODEL_TEXT.skillNoArguments}\n\n${skill.body}`
}

function contentPartsFor(
  parts: readonly TurnPart[],
  resolveSkill: (selector: string) => SkillDefinition | undefined,
): InputContentPart[] {
  return parts.map((part) => {
    switch (part.type) {
      case 'text': {
        return { type: 'input_text', text: part.text }
      }
      case 'image': {
        return {
          type: 'input_image',
          image_url: `data:${part.mediaType};base64,${part.base64Data}`,
          detail: 'auto',
        }
      }
      case 'skill': {
        // An unknown selector (the catalogue changed under the palette) goes as typed.
        const skill = resolveSkill(part.selector)
        return {
          type: 'input_text',
          text:
            skill === undefined
              ? typedInvocation(part.selector, part.arguments)
              : skillInvocationText(skill, part.arguments),
        }
      }
    }
  })
}

function typedText(parts: readonly TurnPart[]): string {
  return parts
    .flatMap((part) => {
      switch (part.type) {
        case 'text': {
          return [part.text]
        }
        case 'skill': {
          return [typedInvocation(part.selector, part.arguments)]
        }
        case 'image': {
          return []
        }
      }
    })
    .join('\n')
    .trim()
}

/** A tool's argument JSON as an object; an empty one when it is not an object. */
function parsedArguments(argsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function argumentsOf(call: FunctionCallItem): Record<string, unknown> {
  return parsedArguments(call.arguments)
}

function pick(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** A shell call's command line, from its arguments (as they came when they name none). */
function commandOf(argsJson: string): string {
  return pick(parsedArguments(argsJson), 'command') ?? argsJson
}

/**
 * The paid feature a tool call bills (M34): its row is marked paid and its
 * card names the price. Undefined for every free tool.
 */
function paidFeatureOf(toolName: string): PaidFeature | undefined {
  return imageKindOf(toolName) === undefined ? undefined : 'imageGeneration'
}

/** Which image call a tool makes (M34, M44); undefined for every other tool. */
function imageKindOf(toolName: string): ImagePlan['kind'] | undefined {
  switch (toolName) {
    case MODEL_API_TOOLS.generateImage: {
      return 'generate'
    }
    case MODEL_API_TOOLS.editImage: {
      return 'edit'
    }
    default: {
      return undefined
    }
  }
}

/** What the approval card is about, in the MSP subject vocabulary. */
function subjectFor(
  call: FunctionCallItem,
  platform: NodeJS.Platform,
  childTask?: SubagentTaskConfirmation,
): ApprovalSubject {
  const args = argumentsOf(call)
  if (childTask !== undefined) {
    return {
      kind: 'paidTool',
      toolName: call.name,
      paidFeature: 'subagents',
      target: childTask.role,
      modelId: childTask.modelId,
      requestLimit: childTask.attemptLimit,
    }
  }
  if (call.name === shellToolFor(platform).name) {
    return { kind: 'shell', command: pick(args, 'command') ?? call.arguments }
  }
  const paidFeature = paidFeatureOf(call.name)
  const path = pick(args, 'path')
  // Never a `fileWrite`: Edit automatically answers those itself (D24), and
  // a paid call is always the user's to accept (D30).
  if (paidFeature !== undefined) {
    return {
      kind: 'paidTool',
      toolName: call.name,
      paidFeature,
      ...(path !== undefined && { path }),
    }
  }
  return path === undefined
    ? { kind: 'tool', toolName: call.name }
    : { kind: 'fileWrite', path, toolName: call.name }
}

/** Resolves with the awaited value, or rejects as soon as the turn is cancelled. */
function waitFor<T>(signal: AbortSignal, register: (pending: Pending<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError())
      return
    }
    const onAbort = () => {
      reject(new AbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    register({
      resolve: (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      reject: (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    })
  })
}

export class ModelApiSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  private readonly replay: ReplayItem[] = []
  private readonly transcript: TranscriptItem[] = []
  private readonly turnIds: string[] = []
  private readonly outputs = new Map<string, string>()
  private readonly permissions: PermissionEngine
  /** The rules, skills and memory of the workspace (PLAN.md D13). */
  private readonly context: WorkspaceContext
  /** The git facts of the prompt's environment section (D15), read on the first turn. */
  private environment: EnvironmentFacts | undefined
  private readonly pendingApprovals = new Map<string, Pending<ApprovalDecision>>()
  /** Live cards for a second surface joining while a decision is still pending. */
  private readonly pendingApprovalEvents = new Map<
    string,
    Extract<AgentEvent, { type: 'approvalRequested' }>
  >()
  private readonly pendingQuestions = new Map<string, Pending<QuestionReply>>()
  /**
   * Shell calls running in the foreground, by row: what moves each to the
   * background (M46, PLAN.md D39).
   */
  private readonly foregroundShells = new Map<string, () => void>()
  /** Commands running in the background, and the user's own `!` commands, by row: their stops. */
  private readonly backgroundShells = new Map<string, AbortController>()
  private readonly userShells = new Map<string, AbortController>()
  /**
   * What the model should read before its next request (a background command
   * ended, the user ran one) while a turn or a compaction holds the replay.
   */
  private readonly pendingNotes: PendingNote[] = []
  private readonly queuedTurns: QueuedTurn[] = []
  private readonly children = new Map<string, ChildRecord>()
  private readonly spawnCommands = new Map<string, string>()
  private readonly pendingChildResults: string[] = []
  private childTaskGrant: ChildTaskGrant | undefined
  private readonly admitChildAttempt = (
    keyDigest: string | undefined,
    body: CreateResponseBody,
  ): void => {
    const grant = this.childTaskGrant
    const parent = this.parentSession
    if (grant === undefined || parent === undefined || this.isDisposed || parent.isDisposed) {
      throw new ChildTaskRefusedError('consentDeclined')
    }
    const refusal = parent.childGrantRefusal(grant, keyDigest, this.modelId)
    if (refusal !== undefined) {
      throw new ChildTaskRefusedError(refusal)
    }
    if (
      body.tools.some((tool) => tool.type === MODEL_API_WEB_SEARCH_TOOL) &&
      !this.deps.isPaidFeatureOn('webSearch')
    ) {
      throw new ChildTaskRefusedError('webSearchOff')
    }
    grant.remainingAttempts -= 1
    this.deps.notePaidUse('subagents', 1)
  }
  private active: ActiveTurn | undefined
  /** Each file as the model last read or wrote it, for `write_file`'s check (D27). */
  private readonly seenFiles = new Map<string, string>()
  /** The compaction in flight (D26): it holds the session like a turn. */
  private compacting: AbortController | undefined
  private effort: string = DEFAULT_EFFORT
  private todos: readonly TodoItem[] = []
  /** The session goal (M45, PLAN.md D38), in Muse Code's own record shape. */
  private goal: GoalRecord | undefined
  /** Accepted user goal commands invalidate goal tools from older requests. */
  private goalCommandRevision = 0
  /** Model calls since the goal last moved: the step probe's count (D38). */
  private goalSteps = 0
  private usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  private firstPrompt: string | undefined
  private isDisposed = false
  /** The surfaces holding this session: closing one must not cancel another's turn. */
  private holders = 1
  public modelId: string
  public name: string | undefined
  public createdAt: string
  public lastActivityAt: string
  public turnCount = 0
  public status: string = IDLE
  public forkedFrom: string | undefined

  public constructor(
    public readonly sessionId: string,
    modelId: string,
    approvalMode: ApprovalMode,
    private readonly deps: ModelApiHostDeps,
    private readonly onChanged: () => void,
    private readonly onDispose: () => void,
    private readonly isSubagent = false,
    private readonly parentSession?: ModelApiSession,
  ) {
    this.modelId = modelId
    this.permissions = new PermissionEngine(approvalMode)
    this.context = new WorkspaceContext({
      io: deps.contextIo,
      workspaceRoot: deps.workspaceRoot,
      platform: deps.platform,
      personalSkillsRoot: deps.personalSkillsRoot,
      isWorkspaceTrusted: deps.isWorkspaceTrusted,
      warn: (message) => {
        deps.log.warn(`Workspace context: ${message}`)
      },
    })
    this.createdAt = new Date(deps.now()).toISOString()
    this.lastActivityAt = this.createdAt
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private touch(): void {
    this.lastActivityAt = new Date(this.deps.now()).toISOString()
    this.onChanged()
  }

  /** Never throws: a describer that fails leaves the section at "no git". */
  private async loadEnvironment(): Promise<EnvironmentFacts> {
    try {
      return await this.deps.describeEnvironment()
    } catch (error: unknown) {
      this.deps.log.warn(`The environment could not be described: ${describe(error)}`)
      return NO_ENVIRONMENT
    }
  }

  private drainChildResults(): void {
    for (const text of this.pendingChildResults.splice(0)) {
      this.replay.push({
        turnId: this.turnIds.at(-1) ?? this.sessionId,
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      })
    }
  }

  private body(): CreateResponseBody {
    this.drainChildResults()
    const shell = shellToolFor(this.deps.platform)
    const hasShell = this.deps.isWorkspaceTrusted()
    const context = this.context.sections()
    const goalSection = goalInstructions(this.goal, this.goalSteps)
    return {
      model: this.modelId,
      input: this.replay.map((entry) => entry.item),
      instructions: instructionsFor({
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        shellToolName: shell.name,
        shellName: shell.shellName,
        hasShell,
        today: new Date(this.deps.now()).toISOString().slice(0, ISO_DATE_LENGTH),
        environment: this.environment ?? NO_ENVIRONMENT,
        context,
        // Pinned while the goal is active (M45, PLAN.md D38).
        ...(goalSection !== undefined && { goalSection }),
      }),
      tools: this.tools(hasShell, context.skills.length > 0),
      tool_choice: 'auto',
      reasoning: {
        effort: this.effort === THINKING_OFF_EFFORT ? MODEL_API_EFFORT_OFF : this.effort,
        summary: 'auto',
      },
      stream: true,
      store: false,
      include: this.includes(),
      max_output_tokens: MODEL_API_MAX_OUTPUT_TOKENS,
      prompt_cache_key: this.sessionId,
    }
  }

  /** The in-process tools, and Meta's web search while that paid feature is on (M33). */
  private tools(hasShell: boolean, hasSkills: boolean): readonly ToolDefinition[] {
    const own = toolDefinitions(this.deps.platform, {
      hasShell,
      hasSkills,
      hasImageGeneration: this.deps.isPaidFeatureOn('imageGeneration'),
      hasSubagents: !this.isSubagent && this.deps.isPaidFeatureOn('subagents'),
      isSubagent: this.isSubagent,
    })
    return this.deps.isPaidFeatureOn('webSearch')
      ? [...own, { type: MODEL_API_WEB_SEARCH_TOOL }]
      : own
  }

  /** The encrypted reasoning always; the search results while search is on, for the rows. */
  private includes(): readonly IncludeField[] {
    return this.deps.isPaidFeatureOn('webSearch')
      ? ['reasoning.encrypted_content', 'web_search_call.results']
      : ['reasoning.encrypted_content']
  }

  private recordTranscript(turnId: string, item: ItemSnapshot): void {
    this.transcript.push({ turnId, item })
  }

  /** Replaces a recorded item's snapshot (a reply whose sources arrived with the response). */
  private rerecordTranscript(item: ItemSnapshot): void {
    const index = this.transcript.findLastIndex((entry) => entry.item.itemId === item.itemId)
    const entry = this.transcript[index]
    if (entry !== undefined) {
      this.transcript[index] = { turnId: entry.turnId, item }
    }
  }

  private appendUserMessage(
    turnId: string,
    parts: readonly TurnPart[],
    displayText: string | undefined,
  ): void {
    this.replay.push({
      turnId,
      item: { type: 'message', role: 'user', content: this.contentParts(parts) },
    })
    const text = displayText ?? typedText(parts)
    this.firstPrompt ??= text
    const attachments = parts.flatMap((part) =>
      part.type === 'image'
        ? [{ type: 'image', mediaType: part.mediaType, width: part.width, height: part.height }]
        : [],
    )
    this.recordTranscript(turnId, {
      itemId: this.deps.newId(),
      kind: 'userMessage',
      status: COMPLETED,
      turnId,
      text,
      ...(attachments.length > 0 && { attachments }),
    })
  }

  /** What a goal operation needs from the session (M45). */
  private goalContext(): GoalContext {
    return { sessionId: this.sessionId, now: this.deps.now(), newId: this.deps.newId }
  }

  /**
   * Replaces the goal. The panel hears of it only when what it shows
   * changed, as MSP's change gate emits nothing for an identical adoption;
   * true when it did.
   */
  private replaceGoal(goal: GoalRecord | undefined): boolean {
    const before = this.goal === undefined ? null : toSessionGoal(this.goal)
    const after = goal === undefined ? null : toSessionGoal(goal)
    this.goal = goal
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return false
    }
    this.emit({ type: 'goalChanged', goal: after })
    return true
  }

  /** Stop leaves an unfinished goal paused, including when it stops compaction. */
  private pauseGoalAfterStop(): void {
    if (!isGoalActive(this.goal)) {
      return
    }
    this.replaceGoal({
      ...this.goal,
      status: GOAL_STATUS.paused,
      updated_at_ms: this.deps.now(),
    })
    this.touch()
  }

  /** A goal tool's call (M45): Muse Code's rules and result shape. */
  private runGoal(call: FunctionCallItem): ToolOutcome {
    const result = runGoalTool(call.name, call.arguments, this.goal, this.goalContext())
    if (result.goal !== this.goal) {
      // The goal moved (created, progressed, closed): the step probe starts over.
      this.goalSteps = 0
      this.replaceGoal(result.goal)
      this.touch()
    }
    return result.outcome
  }

  /** An internal cue for a fresh goal turn, without a user-message card. */
  private queuedGoalWake(): QueuedTurn {
    return {
      turnId: this.deps.newId(),
      parts: [{ type: 'text', text: MODEL_TEXT.goalWake }],
      displayText: undefined,
      isGoalWake: true,
      goalCommandRevision: this.goalCommandRevision,
    }
  }

  /**
   * The cue a goal command gives when it wakes the agent (D38): the running
   * turn's id when one runs (its next call sees the goal), else a new turn,
   * queued behind a compaction. Only an active goal wakes anything.
   */
  private wakeFor(command: GoalCommand): string | undefined {
    if (!GOAL_WAKING_VERBS.has(command.verb) || !isGoalActive(this.goal)) {
      return undefined
    }
    if (this.active !== undefined) {
      if (this.active.abort.signal.aborted) {
        // Stop already ended that turn's chance to make another request.
        const queued = this.queuedGoalWake()
        this.queuedTurns.push(queued)
        return queued.turnId
      }
      this.active.goalWakePending = true
      return this.active.turnId
    }
    const queued = this.queuedGoalWake()
    if (this.compacting === undefined) {
      void this.runTurn(queued)
    } else {
      this.queuedTurns.push(queued)
    }
    return queued.turnId
  }

  /**
   * A goal turn's cue (M45): replayed for the model, and not recorded as a
   * message of the user's. A session whose first turn it is takes the
   * objective as its title.
   */
  private appendGoalWake(turnId: string, parts: readonly TurnPart[]): void {
    this.replay.push({
      turnId,
      item: { type: 'message', role: 'user', content: this.contentParts(parts) },
    })
    this.firstPrompt ??= this.goal?.objective
  }

  private noteUsage(usage: Usage | null | undefined, chargedGoalId: string | undefined): void {
    if (usage === null || usage === undefined) {
      return
    }
    // What the goal used counts against its budget (M45); a budget spent
    // stops the goal, and the panel hears of that.
    if (chargedGoalId !== undefined && this.goal?.goal_id === chargedGoalId) {
      const spent = withTokensUsed(
        this.goal,
        usage.input_tokens + usage.output_tokens,
        this.deps.now(),
      )
      this.replaceGoal(spent)
    }
    this.usage = {
      inputTokens: this.usage.inputTokens + usage.input_tokens,
      outputTokens: this.usage.outputTokens + usage.output_tokens,
      cachedTokens: this.usage.cachedTokens + (usage.input_tokens_details?.cached_tokens ?? 0),
      reasoningTokens:
        this.usage.reasoningTokens + (usage.output_tokens_details?.reasoning_tokens ?? 0),
    }
    if (this.isSubagent) {
      this.deps.noteSubagentUsage(this.modelId, {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      })
    }
    this.emit({ type: 'tokenUsage', ...this.usage, modelId: this.modelId })
    this.noteContext(usage.input_tokens + usage.output_tokens)
  }

  private noteContext(usedTokens: number): void {
    this.emit({
      type: 'contextUsage',
      usedTokens,
      windowTokens: MODEL_API_CONTEXT_WINDOW,
      pressure: pressureFor(usedTokens, MODEL_API_CONTEXT_WINDOW),
    })
  }

  /** The streamed item's tracking entry, created on first sight. */
  private openItem(
    open: Map<string, OpenItem>,
    wireId: string,
    kind: OpenItem['kind'],
    turnId: string,
  ): OpenItem {
    const existing = open.get(wireId)
    if (existing !== undefined) {
      return existing
    }
    const entry: OpenItem = {
      ourId: this.deps.newId(),
      kind,
      text: '',
      summary: [],
      isCompleted: false,
      citations: [],
    }
    open.set(wireId, entry)
    this.emit({ type: 'itemStarted', item: this.startedSnapshot(entry, turnId) })
    return entry
  }

  private startedSnapshot(entry: OpenItem, turnId: string): ItemSnapshot {
    const common = { itemId: entry.ourId, status: IN_PROGRESS, turnId }
    switch (entry.kind) {
      case 'agentMessage': {
        return { ...common, kind: entry.kind, text: '' }
      }
      case 'reasoning': {
        return { ...common, kind: entry.kind, summary: [] }
      }
      case 'webSearch': {
        return {
          ...common,
          kind: 'toolCall',
          tool: MODEL_API_WEB_SEARCH_TOOL,
          args: '{}',
          paid: 'webSearch',
        }
      }
    }
  }

  /** A search's row completed (M33): its query and results, marked paid, and counted. */
  private completeSearch(entry: OpenItem, item: WebSearchCallItem, turnId: string): void {
    const isFailed = item.status === FAILED
    const { args, output } = searchPresentation(item)
    const completed: ItemSnapshot = {
      itemId: entry.ourId,
      kind: 'toolCall',
      status: isFailed ? FAILED : COMPLETED,
      turnId,
      tool: MODEL_API_WEB_SEARCH_TOOL,
      args,
      visibleOutput: output,
      paid: 'webSearch',
      ...(isFailed && { failureReason: UI_TEXT.webSearchFailed }),
    }
    entry.isCompleted = true
    this.emit({ type: 'itemCompleted', item: completed })
    this.recordTranscript(turnId, completed)
    // A failed search is not counted: Meta bills the queries it ran.
    if (!isFailed) {
      this.deps.notePaidUse('webSearch', searchUnits(item))
    }
  }

  private completedSnapshot(entry: OpenItem, turnId: string): ItemSnapshot {
    return entry.kind === 'agentMessage'
      ? {
          itemId: entry.ourId,
          kind: entry.kind,
          status: COMPLETED,
          turnId,
          text: entry.text,
          ...(entry.citations.length > 0 && { citations: [...entry.citations] }),
        }
      : {
          itemId: entry.ourId,
          kind: entry.kind,
          status: COMPLETED,
          turnId,
          summary: [...entry.summary],
        }
  }

  private completeItem(entry: OpenItem, turnId: string): void {
    const item = this.completedSnapshot(entry, turnId)
    entry.isCompleted = true
    this.emit({ type: 'itemCompleted', item })
    this.recordTranscript(turnId, item)
  }

  /**
   * The sources of a completed reply as the whole response has them (M33):
   * Meta's cookbook says citations are complete only once the stream ends.
   */
  private settleCitations(entry: OpenItem, citations: readonly Citation[], turnId: string): void {
    if (isSameCitations(entry.citations, citations)) {
      return
    }
    entry.citations = citations
    const item = this.completedSnapshot(entry, turnId)
    this.emit({ type: 'itemUpdated', item })
    this.rerecordTranscript(item)
  }

  /** One streamed event applied to the transcript; the response when terminal. */
  private applyStreamEvent(
    event: StreamEvent,
    open: Map<string, OpenItem>,
    turnId: string,
    chargedGoalId: string | undefined,
  ): ResponseObject | undefined {
    switch (event.type) {
      case 'response.output_item.added': {
        const { item } = event
        const wireId = item.id ?? String(event.output_index ?? open.size)
        if (isMessageItem(item) || isReasoningItem(item)) {
          const kind = isMessageItem(item) ? 'agentMessage' : 'reasoning'
          this.openItem(open, wireId, kind, turnId)
        } else if (isWebSearchCallItem(item)) {
          this.openItem(open, wireId, 'webSearch', turnId)
        }
        return undefined
      }
      case 'response.output_text.delta': {
        const entry = this.openItem(open, event.item_id, 'agentMessage', turnId)
        entry.text += event.delta
        this.emit({ type: 'textDelta', itemId: entry.ourId, field: TEXT_FIELD, delta: event.delta })
        return undefined
      }
      case 'response.reasoning_summary_text.delta': {
        const entry = this.openItem(open, event.item_id, 'reasoning', turnId)
        const index = event.summary_index ?? 0
        while (entry.summary.length <= index) {
          entry.summary.push('')
        }
        entry.summary[index] = `${entry.summary[index] ?? ''}${event.delta}`
        this.emit({
          type: 'textDelta',
          itemId: entry.ourId,
          field: `${SUMMARY_FIELD_PREFIX}${String(index)}`,
          delta: event.delta,
        })
        return undefined
      }
      case 'response.output_item.done': {
        this.finishStreamedItem(event.item, event.output_index, open, turnId)
        return undefined
      }
      case 'response.completed': {
        return event.response
      }
      case 'response.incomplete': {
        this.deps.log.warn(
          `Model API response ${event.response.id} incomplete: ${event.response.incomplete_details?.reason ?? 'no reason'}`,
        )
        return event.response
      }
      case 'response.failed': {
        this.noteUsage(event.response.usage, chargedGoalId)
        const failure = event.response.error
        throw new ModelApiError(
          failure?.message ?? 'The response failed',
          0,
          undefined,
          failure?.code ?? undefined,
        )
      }
      case 'error': {
        // The instance shut down or was overloaded mid-reply: the docs say to
        // send the whole request again.
        if (
          event.code !== undefined &&
          event.code !== null &&
          MODEL_API_RETRYABLE_STREAM_CODES.has(event.code)
        ) {
          throw new RetryableStreamError(event.message, event.code)
        }
        throw new ModelApiError(event.message, 0, undefined, event.code ?? undefined)
      }
      default: {
        return undefined
      }
    }
  }

  /**
   * What a stream cut short left open, settled before the request is sent
   * again or the turn fails: a reply or a thought keeps what it showed, a
   * search row is marked interrupted (not counted: it did not finish). The
   * replay takes nothing from it; the retried response is the one kept.
   */
  private settleCutShort(open: Map<string, OpenItem>, turnId: string): void {
    for (const entry of open.values()) {
      if (entry.isCompleted) {
        continue
      }
      if (entry.kind === 'webSearch') {
        entry.isCompleted = true
        const item: ItemSnapshot = {
          ...this.startedSnapshot(entry, turnId),
          status: TOOL_STATUS_INTERRUPTED,
        }
        this.emit({ type: 'itemCompleted', item })
        this.recordTranscript(turnId, item)
      } else {
        this.completeItem(entry, turnId)
      }
    }
  }

  /** `response.output_item.done`: the final text or summary of a streamed item. */
  private finishStreamedItem(
    item: OutputItem,
    outputIndex: number | undefined,
    open: Map<string, OpenItem>,
    turnId: string,
  ): void {
    const wireId = item.id ?? String(outputIndex ?? open.size)
    if (isMessageItem(item)) {
      const entry = this.openItem(open, wireId, 'agentMessage', turnId)
      const text = messageText(item)
      entry.text = text === '' ? entry.text : text
      entry.citations = citationsOf(item)
      this.completeItem(entry, turnId)
    } else if (isWebSearchCallItem(item)) {
      const entry = this.openItem(open, wireId, 'webSearch', turnId)
      if (!entry.isCompleted) {
        this.completeSearch(entry, item, turnId)
      }
    } else if (isReasoningItem(item)) {
      const entry = this.openItem(open, wireId, 'reasoning', turnId)
      const summary = (item.summary ?? []).map((part) => part.text)
      if (summary.length > 0) {
        entry.summary.splice(0, entry.summary.length, ...summary)
      }
      this.completeItem(entry, turnId)
    }
  }

  /**
   * One model call: streams the reply into the transcript, returns the calls
   * to run. The HTTP retries inside each attempt and the whole-stream
   * retries share one budget (the review of PR #28), so a call never sends
   * more requests than its retry notices announce.
   */
  private async streamOnce(
    turnId: string,
    signal: AbortSignal,
  ): Promise<{
    readonly calls: readonly FunctionCallItem[]
    readonly goalCommandRevision: number
  }> {
    const budget: RetryBudget = { retriesUsed: 0 }
    for (;;) {
      const open = new Map<string, OpenItem>()
      try {
        return await this.streamAttempt(turnId, signal, open, budget)
      } catch (error: unknown) {
        // What a failed attempt showed stays in the history, the last one's
        // too (the review of PR #28); a Stop is the turn's own business.
        if (!signal.aborted) {
          this.settleCutShort(open, turnId)
        }
        if (
          !(error instanceof RetryableStreamError) ||
          signal.aborted ||
          budget.retriesUsed >= MODEL_API_MAX_RETRIES
        ) {
          throw error
        }
        const attempt = budget.retriesUsed
        budget.retriesUsed += 1
        const delayMs = this.deps.client.retryDelayMs(attempt)
        this.emit({
          type: 'turnRetry',
          turnId,
          attempt: attempt + 1,
          maxAttempts: MODEL_API_MAX_RETRIES + 1,
          retryDelayMs: delayMs,
          reason: `${error.code}: ${error.message}`,
        })
        this.deps.log.warn(
          `Model API stream ended with ${error.code}; sending the request again in ${String(delayMs)} ms`,
        )
        await this.deps.client.waitBeforeRetry(delayMs, signal)
      }
    }
  }

  /** One model call's stream, applied to the transcript. */
  private async streamAttempt(
    turnId: string,
    signal: AbortSignal,
    open: Map<string, OpenItem>,
    budget: RetryBudget,
  ): Promise<{
    readonly calls: readonly FunctionCallItem[]
    readonly goalCommandRevision: number
  }> {
    let final: ResponseObject | undefined
    // An HTTP or whole-stream retry gets its own snapshot: the goal may have
    // changed between attempts, but a reply never charges a newly set goal.
    const chargedGoalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    const goalCommandRevision = this.goalCommandRevision
    // A retried request is announced in the transcript, as Muse Code's are (D25).
    const onRetry = (notice: RetryNotice) => {
      this.emit({
        type: 'turnRetry',
        turnId,
        attempt: notice.attempt,
        maxAttempts: notice.maxAttempts,
        retryDelayMs: notice.delayMs,
        reason: notice.reason,
      })
    }
    const requestBody = this.body()
    const admitAttempt: ResponseAttemptGuard | undefined = this.isSubagent
      ? (keyDigest) => {
          this.admitChildAttempt(keyDigest, requestBody)
        }
      : undefined
    const responseStream = this.deps.client.streamResponse(
      requestBody,
      signal,
      onRetry,
      budget,
      admitAttempt,
    )
    for await (const event of responseStream) {
      final = this.applyStreamEvent(event, open, turnId, chargedGoalId) ?? final
    }
    if (final === undefined) {
      throw new ModelApiError(
        'The stream ended without a completed response',
        0,
        undefined,
        undefined,
      )
    }
    return {
      calls: this.adoptOutput(turnId, final, open, chargedGoalId),
      goalCommandRevision,
    }
  }

  /**
   * Keeps the completed output for replay and returns its function calls. A
   * search the stream never finished is completed (and counted) here, and a
   * reply's sources are settled from the whole response (M33).
   */
  private adoptOutput(
    turnId: string,
    response: ResponseObject,
    open: Map<string, OpenItem>,
    chargedGoalId: string | undefined,
  ): readonly FunctionCallItem[] {
    const calls: FunctionCallItem[] = []
    // A reasoning item must be followed by a message or a call before the
    // next user message, or the next request is a 400 (protocols/responses).
    let isReasoningLast = false
    for (const [index, item] of response.output.entries()) {
      const wireId = item.id ?? String(index)
      if (isMessageItem(item)) {
        isReasoningLast = false
        this.replay.push({
          turnId,
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: OUTPUT_TEXT, text: messageText(item) }],
            // Text before a tool call goes back as commentary: as a final
            // answer before a `function_call` it is a 400 (the docs'
            // conversation structure), and dropping it costs quality.
            ...(item.phase === COMMENTARY_PHASE && { phase: COMMENTARY_PHASE }),
          },
        })
        const entry = open.get(wireId)
        if (entry?.isCompleted === true) {
          this.settleCitations(entry, citationsOf(item), turnId)
        }
      } else if (isWebSearchCallItem(item)) {
        this.replay.push({
          turnId,
          item: {
            type: 'web_search_call',
            ...(item.id !== undefined && { id: item.id }),
            status: item.status ?? COMPLETED,
            ...(item.action !== undefined && { action: item.action }),
          },
        })
        const entry = this.openItem(open, wireId, 'webSearch', turnId)
        if (!entry.isCompleted) {
          this.completeSearch(entry, item, turnId)
        }
      } else if (isReasoningItem(item)) {
        // Only replayable with its encrypted content; a bare summary is
        // dropped. Replayed, it needs its summary, empty or not (the docs).
        if (typeof item.encrypted_content === 'string') {
          this.replay.push({ turnId, item: { ...item, summary: item.summary ?? [] } })
          isReasoningLast = true
        }
      } else if (isFunctionCallItem(item)) {
        isReasoningLast = false
        this.replay.push({ turnId, item })
        calls.push(item)
      }
    }
    // A reply that was reasoning alone gets a minimal assistant message after
    // it, as the docs say, so the next user message is not a 400.
    if (isReasoningLast) {
      this.replay.push({
        turnId,
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: OUTPUT_TEXT, text: MODEL_TEXT.reasoningOnlyReply }],
        },
      })
    }
    this.noteUsage(response.usage, chargedGoalId)
    return calls
  }

  private async askApproval(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    query: PermissionQuery,
    childTask?: SubagentTaskConfirmation,
  ): Promise<ApprovalOutcome> {
    const approvalId = this.deps.newId()
    const request: Extract<AgentEvent, { type: 'approvalRequested' }> = {
      type: 'approvalRequested',
      approvalId,
      itemId,
      toolName: call.name,
      rawArgs: call.arguments,
      requirementId: { approvalId, sourceIndex: 0 },
      subject: subjectFor(call, this.deps.platform, childTask),
      availableChoices: [
        ...(childTask !== undefined || query.toolClass === 'paid'
          ? paidChoices()
          : choicesFor(call.name, query.command)),
      ],
      isJudgeEscalated: false,
      isProtectedWrite: query.isProtected === true,
    }
    let decision: ApprovalDecision
    try {
      decision = await waitFor<ApprovalDecision>(signal, (pending) => {
        this.pendingApprovals.set(approvalId, pending)
        this.pendingApprovalEvents.set(approvalId, request)
        this.emit(request)
      })
    } finally {
      this.pendingApprovalEvents.delete(approvalId)
      this.pendingApprovals.delete(approvalId)
    }
    const isOffered = request.availableChoices.some(
      (choice) => choice.choiceId === decision.choiceId,
    )
    if (isOffered && decision.choiceId === APPROVAL_CHOICE_IDS.allowSession) {
      this.permissions.allowForSession(call.name, query.command)
    }
    // Only the two allow choices this card offered approve; anything else refuses.
    const isApproved =
      isOffered &&
      (decision.choiceId === APPROVAL_CHOICE_IDS.allowOnce ||
        decision.choiceId === APPROVAL_CHOICE_IDS.allowSession)
    this.emit({
      type: 'approvalResolved',
      approvalId,
      itemId,
      decision: isApproved ? DECISION_APPROVED : DECISION_ABORT,
      resolvedBy: RESOLVED_BY_USER,
    })
    return { isApproved, feedback: decision.feedback }
  }

  private async askUser(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const questions = parseQuestions(call.arguments)
    if (typeof questions === 'string') {
      return { output: `Error: ${questions}`, visibleOutput: questions, failureReason: questions }
    }
    const userInputId = this.deps.newId()
    this.emit({ type: 'questionRequested', userInputId, itemId, questions: [...questions] })
    let reply: QuestionReply
    try {
      reply = await waitFor<QuestionReply>(signal, (pending) => {
        this.pendingQuestions.set(userInputId, pending)
      })
    } finally {
      this.pendingQuestions.delete(userInputId)
    }
    // Settled as Muse Code settles it (captured 2026-09-25, M46): an
    // explanation is `clarified` with no answers and the text beside them.
    const outcomes: Readonly<Record<QuestionReply['kind'], string>> = {
      answered: ANSWERED,
      cancelled: CANCELLED,
      clarified: QUESTION_OUTCOME_CLARIFIED,
    }
    this.emit({
      type: 'questionSettled',
      userInputId,
      outcome: outcomes[reply.kind],
      answers: reply.kind === 'answered' ? [...reply.answers] : [],
      ...(reply.kind === 'clarified' && { clarification: reply.text }),
    })
    const text = questionResultText(reply)
    return { output: text, visibleOutput: text }
  }

  /** Settles a waiting question card with `reply`. */
  private settleQuestion(userInputId: string, reply: QuestionReply): Promise<void> {
    const pending = this.pendingQuestions.get(userInputId)
    if (pending === undefined) {
      return Promise.reject(new Error(`question ${userInputId} is not pending`))
    }
    pending.resolve(reply)
    return Promise.resolve()
  }

  private writeTodos(call: FunctionCallItem): ToolOutcome {
    let raw: unknown
    try {
      raw = JSON.parse(call.arguments)
    } catch {
      raw = undefined
    }
    const parsed = todoWriteArgs.safeParse(raw)
    if (!parsed.success) {
      const reason = 'invalid task list'
      return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
    }
    this.todos = parsed.data.items
    this.emit({ type: 'todoChanged', items: [...this.todos] })
    const summary = `${String(this.todos.length)} tasks`
    return { output: summary, visibleOutput: summary }
  }

  private contentParts(parts: readonly TurnPart[]): InputContentPart[] {
    return contentPartsFor(parts, (selector) => this.context.skill(selector))
  }

  /** `read_skill`: the body of a catalogue skill, by id; never a path. */
  private readSkill(call: FunctionCallItem): ToolOutcome {
    const parsed = readSkillArgs.safeParse(argumentsOf(call))
    if (!parsed.success) {
      return toolFailure('invalid arguments: id is required')
    }
    const skill = this.context.skill(parsed.data.id)
    if (skill === undefined) {
      return toolFailure(`${MODEL_TEXT.skillNotFound} ${parsed.data.id}`)
    }
    return {
      output: `Skill ${skill.id}: ${skill.description}\n\n${skill.body}`,
      visibleOutput: `Loaded skill ${skill.id} (${skill.source})`,
    }
  }

  /**
   * An image call checked (M34, M44): the feature on, the arguments, the
   * output path and every source. Found before the card, so nothing is asked
   * or billed for an image that could not be made, and again after it.
   */
  private async imagePlan(
    call: FunctionCallItem,
  ): Promise<
    | { readonly ok: true; readonly plan: ImagePlan }
    | { readonly ok: false; readonly reason: string }
  > {
    const kind = imageKindOf(call.name)
    if (kind === undefined || !this.deps.isPaidFeatureOn('imageGeneration')) {
      return { ok: false, reason: MODEL_TEXT.imageGenerationOff }
    }
    return await prepareImageCall(kind, argumentsOf(call), {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      io: this.deps.io,
    })
  }

  /** `generate_image` and `edit_image`, after the card: the image, written as a new file, and counted. */
  private async makeImage(call: FunctionCallItem, signal: AbortSignal): Promise<ToolOutcome> {
    const prepared = await this.imagePlan(call)
    if (!prepared.ok) {
      return toolFailure(prepared.reason)
    }
    return await runImageCall(prepared.plan, {
      client: this.deps.client,
      io: this.deps.io,
      signal,
      isStillOn: () => this.deps.isPaidFeatureOn('imageGeneration'),
      onBilled: () => {
        this.deps.notePaidUse('imageGeneration', 1)
      },
    })
  }

  /** Where an edit-family call writes, confined (links resolved), or why it cannot. */
  private async editTarget(call: FunctionCallItem): Promise<PathResolution | undefined> {
    const given = pick(argumentsOf(call), 'path')
    return given === undefined
      ? undefined
      : await confineWorkspacePath(this.deps.workspaceRoot, given, this.deps.platform, this.deps.io)
  }

  /** A tool that named a path may have entered a directory with its own rules file. */
  private async touchPath(call: FunctionCallItem): Promise<void> {
    const given = pick(argumentsOf(call), 'path')
    if (given === undefined) {
      return
    }
    const resolved = await confineWorkspacePath(
      this.deps.workspaceRoot,
      given,
      this.deps.platform,
      this.deps.io,
    )
    if (resolved.ok) {
      await this.context.touch(resolved.relative)
    }
  }

  /**
   * The shell tool, movable to the background while it runs (M46, PLAN.md
   * D39). Until it moves, the turn's Stop ends it and its time limit holds;
   * once moved, the call answers the model at once, the command runs on with
   * no limit, and only its own stop (its row, Stop all, the session closing)
   * ends it.
   */
  private async runShellCall(
    itemId: string,
    call: FunctionCallItem,
    turnSignal: AbortSignal,
  ): Promise<Performed> {
    const stop = new AbortController()
    const onTurnStop = () => {
      stop.abort()
    }
    if (turnSignal.aborted) {
      stop.abort()
    }
    turnSignal.addEventListener('abort', onTurnStop, { once: true })
    const limit = new ShellTimeLimit()
    const running = executeTool(call.name, call.arguments, {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      io: this.deps.io,
      signal: stop.signal,
      limit,
      seen: this.seenFiles,
    })
    const moved = Promise.withResolvers<undefined>()
    this.foregroundShells.set(itemId, () => {
      moved.resolve(undefined)
    })
    let finished: ToolOutcome | undefined
    try {
      finished = await Promise.race([running, moved.promise])
    } finally {
      this.foregroundShells.delete(itemId)
      turnSignal.removeEventListener('abort', onTurnStop)
    }
    if (finished !== undefined) {
      return { outcome: finished }
    }
    limit.lift()
    this.backgroundShells.set(itemId, stop)
    return { outcome: { output: MODEL_TEXT.shellMovedToBackground, visibleOutput: '' }, running }
  }

  /** The Agent map's row is the durable parent-side account of a child. */
  private childSnapshot(child: ChildRecord): ItemSnapshot {
    const isDone = child.state === 'result_ready' || child.state === 'closed'
    let status: ItemSnapshot['status'] = IN_PROGRESS
    if (child.state === 'interrupted') {
      status = CANCELLED
    } else if (isDone) {
      status = child.terminal ?? COMPLETED
    }
    return {
      itemId: child.itemId,
      kind: 'subagent',
      turnId: child.parentTurnId,
      status,
      role: child.role,
      objective: child.objective,
      subagentId: child.id,
      childSessionId: child.session.sessionId,
      depth: SUBAGENT_DEPTH,
      controlStatus: child.state === 'result_ready' ? SUBAGENT_RESULT_READY : child.state,
      ...(isDone && { durationMs: this.deps.now() - child.startedAt }),
      usage: child.usage,
      paid: 'subagents',
      ...(child.result !== undefined && { result: child.result }),
    }
  }

  private updateChild(child: ChildRecord): void {
    child.revision += 1
    const item = this.childSnapshot(child)
    this.rerecordTranscript(item)
    this.emit({ type: 'itemUpdated', item })
    this.touch()
    for (const wake of child.waiters) {
      wake()
    }
  }

  /** Charge only the goal that owned this child turn, never a replacement. */
  private chargeChildGoal(child: ChildRecord, spentTokens: number): void {
    if (spentTokens <= 0 || child.chargedGoalId === undefined) {
      return
    }
    const goal = this.goal
    if (goal?.goal_id !== child.chargedGoalId) {
      return
    }
    this.replaceGoal(withTokensUsed(goal, spentTokens, this.deps.now()))
  }

  private childEvent(child: ChildRecord, event: AgentEvent): void {
    if (event.type === 'turnStarted') {
      child.chargedGoalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    } else if (event.type === 'tokenUsage') {
      const latest = child.session.usage
      const inputDelta = latest.inputTokens - child.usage.inputTokens
      const outputDelta = latest.outputTokens - child.usage.outputTokens
      this.chargeChildGoal(child, inputDelta + outputDelta)
      this.usage = {
        inputTokens: this.usage.inputTokens + inputDelta,
        outputTokens: this.usage.outputTokens + outputDelta,
        cachedTokens: this.usage.cachedTokens + latest.cachedTokens - child.usage.cachedTokens,
        reasoningTokens:
          this.usage.reasoningTokens + latest.reasoningTokens - child.usage.reasoningTokens,
      }
      child.usage = { ...latest }
      this.emit({ type: 'tokenUsage', ...this.usage, modelId: this.modelId })
      this.updateChild(child)
      return
    }
    if (event.type === 'turnCompleted') {
      child.chargedGoalId = undefined
      child.session.childTaskGrant = undefined
      if (child.nextTaskGrant !== undefined) {
        child.session.childTaskGrant = child.nextTaskGrant
        child.nextTaskGrant = undefined
      }
      child.terminal = event.terminal
      if (child.state !== 'closed' && child.state !== 'interrupted') {
        child.state = 'result_ready'
      }
      const reply = child.session.transcript.findLast(
        (entry) => entry.turnId === event.turnId && entry.item.kind === 'agentMessage',
      )
      const isTaskRefusal = event.errorKind?.startsWith('subagent_') === true
      const text =
        (isTaskRefusal ? event.reason : (reply?.item.text ?? event.reason)) ??
        MODEL_TEXT.subagentNoReply
      const modelText = isTaskRefusal ? (modelChildFailure(event.errorKind, text) ?? text) : text
      child.result = {
        summary: text.slice(0, SUBAGENT_SUMMARY_MAX_CHARS),
        ...(text !== '' && { text: text.slice(0, SUBAGENT_RESULT_TEXT_MAX_CHARS) }),
        ...(event.errorKind !== undefined && { errorKind: event.errorKind }),
      }
      this.pendingChildResults.push(
        `${MODEL_TEXT.subagentResult}\n${child.id}: ${JSON.stringify({ ...child.result, summary: modelText.slice(0, SUBAGENT_SUMMARY_MAX_CHARS), text: modelText.slice(0, SUBAGENT_RESULT_TEXT_MAX_CHARS) })}`,
      )
      this.emit(event)
      this.updateChild(child)
      if (child.followupAfterStop !== undefined) {
        child.pendingMessages.push(child.followupAfterStop)
        child.followupAfterStop = undefined
        child.state = 'queued'
      }
      this.startQueuedChildren()
      return
    }
    if (FORWARDED_CHILD_EVENTS.has(event.type)) {
      this.emit(event)
    }
  }

  private installChildGrant(child: ChildRecord, grant: ChildTaskGrant): void {
    if (child.session.activeTurnId === undefined) {
      child.session.childTaskGrant = grant
    } else {
      child.nextTaskGrant = grant
    }
  }

  /** Every new task buys a fresh bounded grant; a running note does not. */
  private childTaskFor(call: FunctionCallItem): SubagentTaskConfirmation | undefined {
    if (call.name === MODEL_API_SUBAGENT_TOOLS.spawn) {
      const parsed = spawnArgs.safeParse(argumentsOf(call))
      return parsed.success
        ? {
            role: parsed.data.role,
            objective: parsed.data.objective,
            modelId: this.modelId,
            attemptLimit: SUBAGENT_TASK_MAX_REQUESTS,
          }
        : undefined
    }
    if (call.name !== MODEL_API_SUBAGENT_TOOLS.sendMessage) {
      return undefined
    }
    const parsed = sendMessageArgs.safeParse(argumentsOf(call))
    const child = parsed.success ? this.childById(parsed.data.subagent_id) : undefined
    if (
      child === undefined ||
      child.state === 'closed' ||
      child.state === 'queued' ||
      (child.state === 'running' && parsed.success && parsed.data.interrupt !== true)
    ) {
      return undefined
    }
    return {
      role: child.role,
      objective: parsed.success ? parsed.data.message : child.objective,
      modelId: this.modelId,
      attemptLimit: SUBAGENT_TASK_MAX_REQUESTS,
    }
  }

  private childGrantRefusal(
    grant: ChildTaskGrant,
    keyDigest: string | undefined,
    childModelId: string,
  ): ChildTaskRefusal | undefined {
    if (this.isDisposed) {
      return 'consentDeclined'
    }
    if (this.permissions.currentMode === 'denyUnmatched') {
      return 'planMode'
    }
    if (!this.deps.isPaidFeatureOn('subagents')) {
      return 'paidOff'
    }
    if (modelApiPaidTier(grant.modelId) === undefined) {
      return 'tariffUnknown'
    }
    if (childModelId !== grant.modelId || this.modelId !== grant.modelId) {
      return 'modelChanged'
    }
    if (keyDigest !== grant.keyDigest) {
      return 'keyChanged'
    }
    if (
      grant.goalId !== undefined &&
      (!isGoalActive(this.goal) || this.goal.goal_id !== grant.goalId)
    ) {
      return 'goalEnded'
    }
    return grant.remainingAttempts <= 0 ? 'requestLimit' : undefined
  }

  private async prepareChildGrant(): Promise<ChildTaskGrant> {
    if (!this.deps.isPaidFeatureOn('subagents')) {
      throw new ChildTaskRefusedError('paidOff')
    }
    if (this.goal?.status === GOAL_STATUS.budgetLimited) {
      throw new ChildTaskRefusedError('goalEnded')
    }
    if (modelApiPaidTier(this.modelId) === undefined) {
      throw new ChildTaskRefusedError('tariffUnknown')
    }
    return {
      modelId: this.modelId,
      keyDigest: await this.deps.client.currentKeyDigest(),
      goalId: isGoalActive(this.goal) ? this.goal.goal_id : undefined,
      remainingAttempts: SUBAGENT_TASK_MAX_REQUESTS,
    }
  }

  private async validateChildGrant(grant: ChildTaskGrant): Promise<void> {
    let keyDigest: string | undefined
    try {
      keyDigest = await this.deps.client.currentKeyDigest()
    } catch (error: unknown) {
      if (!(error instanceof MissingApiKeyError)) {
        throw error
      }
    }
    const reason = this.childGrantRefusal(grant, keyDigest, grant.modelId)
    if (reason !== undefined) {
      throw new ChildTaskRefusedError(reason)
    }
  }

  /** A user-owned follow-up or reopen gets one native price decision. */
  private async confirmOwnerChildTask(
    child: ChildRecord,
    objective: string,
  ): Promise<ChildTaskGrant> {
    try {
      const grant = await this.prepareChildGrant()
      const isAccepted = await this.deps.confirmSubagentTask({
        role: child.role,
        objective,
        modelId: grant.modelId,
        attemptLimit: SUBAGENT_TASK_MAX_REQUESTS,
      })
      if (!isAccepted) {
        throw new ChildTaskRefusedError('consentDeclined')
      }
      await this.validateChildGrant(grant)
      return grant
    } catch (error: unknown) {
      if (error instanceof ChildTaskRefusedError) {
        throw new Error(error.visible, { cause: error })
      }
      throw error
    }
  }

  /** The exact task text sent after queued notes are added to a child turn. */
  private queuedChildTask(child: ChildRecord, additions: readonly string[]): string {
    const parts = child.session.turnCount === 0 ? [child.objective, ...additions] : additions
    return parts.join('\n\n') || MODEL_TEXT.subagentResume
  }

  /** Starts queued children in spawn order, bounded by the Model API capacity. */
  private startQueuedChildren(): void {
    if (this.isDisposed) {
      return
    }
    let active = 0
    for (const entry of this.children.values()) {
      if (entry.state === 'running' || entry.session.activeTurnId !== undefined) {
        active += 1
      }
    }
    for (const child of this.children.values()) {
      if (active >= SUBAGENT_CAPACITY) {
        return
      }
      if (child.state !== 'queued' || child.session.activeTurnId !== undefined) {
        continue
      }
      const grant = child.session.childTaskGrant
      const refusal =
        grant === undefined
          ? 'consentDeclined'
          : this.childGrantRefusal(grant, grant.keyDigest, child.session.modelId)
      if (refusal !== undefined) {
        const messages = childTaskMessages(refusal)
        child.state = 'closed'
        child.terminal = FAILED
        child.result = {
          summary: messages.visible,
          text: messages.visible,
          errorKind: `subagent_${refusal}`,
        }
        child.pendingMessages.length = 0
        child.session.childTaskGrant = undefined
        this.pendingChildResults.push(
          `${MODEL_TEXT.subagentResult}\n${child.id}: ${JSON.stringify({ summary: messages.model, text: messages.model, errorKind: `subagent_${refusal}` })}`,
        )
        this.updateChild(child)
        continue
      }
      active += 1
      child.state = 'running'
      child.result = undefined
      child.terminal = undefined
      const additions = child.pendingMessages.splice(0)
      const task = this.queuedChildTask(child, additions)
      this.updateChild(child)
      void child.session.sendTurn(
        [{ type: 'text', text: `${MODEL_TEXT.subagentObjective}\n\n${task}` }],
        task,
      )
    }
  }

  private spawnChild(
    call: FunctionCallItem,
    turnId: string,
    grant: ChildTaskGrant | undefined,
  ): ToolOutcome {
    if (grant === undefined) {
      return childTaskFailure('consentDeclined')
    }
    const parsed = spawnArgs.safeParse(argumentsOf(call))
    if (!parsed.success) {
      return subagentFailure('invalid subagent_spawn arguments')
    }
    if (parsed.data.worktree_isolation !== undefined && parsed.data.worktree_isolation !== false) {
      return subagentFailure('worktree isolation is unavailable on this backend')
    }
    const prior =
      parsed.data.command_id === undefined
        ? undefined
        : this.spawnCommands.get(parsed.data.command_id)
    if (prior !== undefined) {
      const child = this.childById(prior)
      if (child !== undefined) {
        if (child.role !== parsed.data.role || child.objective !== parsed.data.objective) {
          return subagentFailure('command_id was already used for a different spawn')
        }
        return {
          output: JSON.stringify({
            subagent_id: child.id,
            state: child.state,
            child_session_id: child.session.sessionId,
          }),
          visibleOutput: `${child.role}: ${childStateLabel(child.state)}`,
        }
      }
    }
    if (this.children.size >= SUBAGENT_MAX_PER_CONVERSATION) {
      return subagentFailure('subagent limit reached for this conversation')
    }
    const id = `${SUBAGENT_ID_PREFIX}${String(this.children.size + 1)}`
    const child = new ModelApiSession(
      `${this.sessionId}:${id}`,
      this.modelId,
      this.permissions.currentMode,
      this.deps,
      () => {
        this.touch()
      },
      NO_CHILD_DISPOSAL,
      true,
      this,
    )
    child.childTaskGrant = grant
    const record: ChildRecord = {
      id,
      role: parsed.data.role,
      objective: parsed.data.objective,
      itemId: this.deps.newId(),
      parentTurnId: turnId,
      session: child,
      startedAt: this.deps.now(),
      state: 'queued',
      result: undefined,
      terminal: undefined,
      usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
      chargedGoalId: undefined,
      waiters: new Set(),
      pendingMessages: [],
      followupAfterStop: undefined,
      nextTaskGrant: undefined,
      revision: 0,
    }
    child.onEvent((event) => {
      this.childEvent(record, event)
    })
    this.children.set(id, record)
    if (parsed.data.command_id !== undefined) {
      this.spawnCommands.set(parsed.data.command_id, id)
    }
    const row = this.childSnapshot(record)
    this.recordTranscript(turnId, row)
    this.emit({ type: 'itemStarted', item: row })
    this.startQueuedChildren()
    return {
      output: JSON.stringify({
        subagent_id: id,
        state: record.state,
        child_session_id: child.sessionId,
      }),
      visibleOutput: `${record.role}: ${childStateLabel(record.state)}`,
    }
  }

  private childById(id: string): ChildRecord | undefined {
    return this.children.get(id)
  }

  private async waitForChild(
    child: ChildRecord,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    if (signal.aborted) {
      throw new AbortedError()
    }
    if (CHILD_RESULT_STATES.has(child.state)) {
      return {
        output: JSON.stringify({ subagent_id: child.id, state: child.state, result: child.result }),
        visibleOutput: child.result?.summary ?? childStateLabel(child.state),
      }
    }
    const state = await new Promise<'ready' | 'timeout' | 'aborted'>((resolve) => {
      const finish = (value: 'ready' | 'timeout' | 'aborted') => {
        clearTimeout(timer)
        child.waiters.delete(wake)
        signal.removeEventListener('abort', abort)
        resolve(value)
      }
      const wake = () => {
        if (CHILD_RESULT_STATES.has(child.state)) {
          finish('ready')
        }
      }
      const abort = () => {
        finish('aborted')
      }
      const timer = setTimeout(() => {
        finish('timeout')
      }, timeoutMs)
      child.waiters.add(wake)
      signal.addEventListener('abort', abort, { once: true })
      wake()
    })
    if (state === 'aborted') {
      throw new AbortedError()
    }
    return {
      output: JSON.stringify({
        subagent_id: child.id,
        state: child.state,
        timed_out: state === 'timeout',
        result: child.result,
      }),
      visibleOutput: child.result?.summary ?? childStateLabel(child.state),
    }
  }

  private async runSubagentTool(
    turnId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    grant?: ChildTaskGrant,
  ): Promise<ToolOutcome> {
    if (this.isSubagent) {
      return subagentFailure('a subagent cannot spawn or control other subagents')
    }
    const args = argumentsOf(call)
    if (call.name === MODEL_API_SUBAGENT_TOOLS.spawn) {
      return this.spawnChild(call, turnId, grant)
    }
    if (call.name === MODEL_API_SUBAGENT_TOOLS.status) {
      const parsed = statusArgs.safeParse(args)
      if (!parsed.success) {
        return subagentFailure('invalid subagent_status arguments')
      }
      if (parsed.data.subagent_id !== undefined && !this.children.has(parsed.data.subagent_id)) {
        return subagentFailure('unknown subagent')
      }
      const children: {
        subagent_id: string
        role: string
        objective: string
        state: SubagentState
        result: ChildRecord['result']
      }[] = []
      for (const child of this.children.values()) {
        if (parsed.data.subagent_id !== undefined && child.id !== parsed.data.subagent_id) {
          continue
        }
        const statusFilter = parsed.data.status_filter
        if (statusFilter && statusFilter !== 'all' && child.state !== statusFilter) {
          continue
        }
        children.push({
          subagent_id: child.id,
          role: child.role,
          objective: child.objective,
          state: child.state,
          result: child.result,
        })
      }
      return {
        output: JSON.stringify({ subagents: children }),
        visibleOutput: plural(UI_TEXT.agentsCount, children.length),
      }
    }
    if (call.name === MODEL_API_SUBAGENT_TOOLS.wait) {
      const parsed = waitArgs.safeParse(args)
      if (!parsed.success) {
        return subagentFailure('invalid subagent_wait arguments')
      }
      const child = this.childById(parsed.data.subagent_id)
      return child === undefined
        ? subagentFailure('unknown subagent')
        : await this.waitForChild(child, parsed.data.timeout_ms ?? SUBAGENT_WAIT_DEFAULT_MS, signal)
    }
    if (call.name === MODEL_API_SUBAGENT_TOOLS.sendMessage) {
      const parsed = sendMessageArgs.safeParse(args)
      if (!parsed.success) {
        return subagentFailure('invalid subagent_send_message arguments')
      }
      const child = this.childById(parsed.data.subagent_id)
      if (child === undefined || child.state === 'closed') {
        return subagentFailure('subagent is unavailable')
      }
      const isNewTask =
        (parsed.data.interrupt === true && child.state === 'running') ||
        child.state === 'interrupted' ||
        child.state === 'result_ready'
      if (isNewTask) {
        if (grant === undefined) {
          return childTaskFailure('consentDeclined')
        }
        this.installChildGrant(child, grant)
      }
      if (parsed.data.interrupt === true && child.state === 'running') {
        child.followupAfterStop = parsed.data.message
        child.state = 'interrupted'
        await child.session.cancel()
      } else if (child.state === 'running') {
        const activeTurnId = child.session.activeTurnId
        if (activeTurnId === undefined) {
          return subagentFailure('subagent turn is settling; retry the message')
        }
        await child.session.steer(activeTurnId, [{ type: 'text', text: parsed.data.message }])
      } else {
        child.pendingMessages.push(parsed.data.message)
        child.state = 'queued'
        this.startQueuedChildren()
      }
      this.updateChild(child)
      return {
        output: JSON.stringify({ subagent_id: child.id, state: child.state }),
        visibleOutput: childStateLabel(child.state),
      }
    }
    const parsed = targetArgs.safeParse(args)
    if (!parsed.success) {
      return subagentFailure('invalid subagent target')
    }
    const child = this.childById(parsed.data.subagent_id)
    if (child === undefined) {
      return subagentFailure('unknown subagent')
    }
    if (call.name === MODEL_API_SUBAGENT_TOOLS.readResult) {
      if (child.state !== 'result_ready') {
        return subagentFailure('subagent result is not ready')
      }
      child.state = 'closed'
      this.updateChild(child)
      return {
        output: JSON.stringify({ subagent_id: child.id, result: child.result }),
        visibleOutput: child.result?.summary ?? '',
      }
    }
    if (call.name === MODEL_API_SUBAGENT_TOOLS.cancel) {
      child.revision += 1
      child.pendingMessages.length = 0
      child.followupAfterStop = undefined
      child.nextTaskGrant = undefined
      child.session.childTaskGrant = undefined
      child.terminal ??= CANCELLED
      child.state = 'closed'
      await child.session.cancel()
      this.updateChild(child)
      this.startQueuedChildren()
      return {
        output: JSON.stringify({ subagent_id: child.id, state: child.state }),
        visibleOutput: childStateLabel(child.state),
      }
    }
    return subagentFailure(`unknown tool ${call.name}`)
  }

  private async perform(
    turnId: string,
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
    childGrant?: ChildTaskGrant,
  ): Promise<Performed> {
    if (isSubagentTool(call.name)) {
      return { outcome: await this.runSubagentTool(turnId, call, signal, childGrant) }
    }
    switch (call.name) {
      case MODEL_API_TOOLS.askUser: {
        return { outcome: await this.askUser(itemId, call, signal) }
      }
      case MODEL_API_TOOLS.todoWrite: {
        return { outcome: this.writeTodos(call) }
      }
      case MODEL_API_TOOLS.readSkill: {
        return { outcome: this.readSkill(call) }
      }
      case MODEL_API_TOOLS.generateImage:
      case MODEL_API_TOOLS.editImage: {
        return { outcome: await this.makeImage(call, signal) }
      }
      case MODEL_API_TOOLS.createGoal:
      case MODEL_API_TOOLS.updateGoal:
      case MODEL_API_TOOLS.reportProgress: {
        if (goalCommandRevision !== this.goalCommandRevision) {
          return {
            outcome: {
              output: `Error: ${MODEL_TEXT.goalRequestSuperseded}`,
              visibleOutput: UI_TEXT.goalRequestSuperseded,
              failureReason: UI_TEXT.goalRequestSuperseded,
            },
          }
        }
        return { outcome: this.runGoal(call) }
      }
      case MODEL_API_TOOLS.getGoal: {
        return { outcome: this.runGoal(call) }
      }
      case shellToolFor(this.deps.platform).name: {
        return await this.runShellCall(itemId, call, signal)
      }
      default: {
        return {
          outcome: await executeTool(call.name, call.arguments, {
            workspaceRoot: this.deps.workspaceRoot,
            platform: this.deps.platform,
            io: this.deps.io,
            signal,
            seen: this.seenFiles,
          }),
        }
      }
    }
  }

  /** The permission check and, when it allows, the tool itself. May throw (an abort, an I/O error). */
  private async decideAndRun(
    turnId: string,
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
  ): Promise<CallResult> {
    const toolClass = classifyTool(call.name)
    if (toolClass === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    if (
      this.isSubagent &&
      (isSubagentTool(call.name) ||
        call.name === MODEL_API_TOOLS.askUser ||
        call.name === MODEL_API_TOOLS.todoWrite ||
        call.name === MODEL_API_TOOLS.createGoal ||
        call.name === MODEL_API_TOOLS.getGoal ||
        call.name === MODEL_API_TOOLS.updateGoal ||
        call.name === MODEL_API_TOOLS.reportProgress)
    ) {
      return { outcome: subagentFailure('tool unavailable to a subagent'), isRejected: true }
    }
    const childTask = this.childTaskFor(call)
    if (childTask === undefined && call.name === MODEL_API_SUBAGENT_TOOLS.spawn) {
      return { outcome: subagentFailure('invalid subagent_spawn arguments'), isRejected: true }
    }
    if (toolClass === 'shell' && !this.deps.isWorkspaceTrusted()) {
      // Restricted Mode (PLAN.md D13): the tool is not offered, and a model
      // that calls it anyway is refused, never prompted.
      return { outcome: toolFailure(MODEL_TEXT.shellRestrictedMode), isRejected: true }
    }
    if (toolClass === 'paid') {
      const prepared = await this.imagePlan(call)
      if (!prepared.ok) {
        return { outcome: toolFailure(prepared.reason), isRejected: false }
      }
    }
    const target =
      toolClass === 'edit' || toolClass === 'paid' ? await this.editTarget(call) : undefined
    if (target?.ok === false) {
      // A path the tool would refuse anyway is refused before any card.
      return { outcome: toolFailure(target.reason), isRejected: false }
    }
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: childTask === undefined ? toolClass : 'spawn',
      command: toolClass === 'shell' ? pick(argumentsOf(call), 'command') : undefined,
      isProtected: target?.ok === true && isProtectedPath(target.canonical),
    }
    const verdict = this.permissions.verdict(query)
    if (verdict === 'deny') {
      return {
        outcome: toolFailure(`${call.name} ${MODEL_TEXT.toolRefusedByMode}`),
        isRejected: true,
      }
    }
    let childGrant: ChildTaskGrant | undefined
    if (childTask !== undefined) {
      try {
        childGrant = await this.prepareChildGrant()
      } catch (error: unknown) {
        if (error instanceof ChildTaskRefusedError) {
          return { outcome: childTaskFailure(error.kind), isRejected: true }
        }
        throw error
      }
    }
    if (verdict === 'ask') {
      const approval = await this.askApproval(itemId, call, signal, query, childTask)
      if (!approval.isApproved) {
        if (childTask !== undefined) {
          return { outcome: childTaskFailure('consentDeclined'), isRejected: true }
        }
        const reason = `${call.name} ${MODEL_TEXT.toolRejectedByUser}`
        const feedback = approval.feedback === undefined ? '' : `\nUser: ${approval.feedback}`
        return {
          outcome: {
            output: `Error: ${reason}${feedback}`,
            visibleOutput: reason,
            failureReason: reason,
          },
          isRejected: true,
        }
      }
    }
    if (childGrant !== undefined) {
      try {
        await this.validateChildGrant(childGrant)
      } catch (error: unknown) {
        if (error instanceof ChildTaskRefusedError) {
          return { outcome: childTaskFailure(error.kind), isRejected: true }
        }
        throw error
      }
    }
    return {
      ...(await this.perform(turnId, itemId, call, signal, goalCommandRevision, childGrant)),
      isRejected: false,
    }
  }

  /**
   * The row and the replay entry of a finished call. Every function call the
   * model made gets its output here, whatever happened (PLAN.md D26): a call
   * left without one makes the stored conversation invalid for every later
   * request, the compaction included.
   */
  private finishCall(
    turnId: string,
    started: ItemSnapshot,
    call: FunctionCallItem,
    outcome: ToolOutcome,
    status: string,
  ): void {
    const { itemId } = started
    const outputRef = outcome.patch === undefined ? undefined : `${OUTPUT_REF_PREFIX}${itemId}`
    if (outputRef !== undefined && outcome.patch !== undefined) {
      this.outputs.set(outputRef, outcome.patch.document)
    }
    const completed: ItemSnapshot = {
      ...started,
      status,
      visibleOutput: outcome.visibleOutput,
      ...(outcome.failureReason !== undefined && { failureReason: outcome.failureReason }),
      ...(outputRef !== undefined &&
        outcome.patch !== undefined && {
          patchRef: { id: outputRef, byteLen: Buffer.byteLength(outcome.patch.document) },
          patchSummary: outcome.patch.summary,
        }),
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.rerecordTranscript(completed)
    this.replay.push({
      turnId,
      item: { type: 'function_call_output', call_id: call.call_id, output: outcome.output },
    })
  }

  /** Permission check, execution and the transcript row for one tool call. */
  private async runCall(
    turnId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
  ): Promise<void> {
    const itemId = this.deps.newId()
    const paid = this.childTaskFor(call) === undefined ? paidFeatureOf(call.name) : 'subagents'
    const started: ItemSnapshot = {
      itemId,
      kind: 'toolCall',
      status: IN_PROGRESS,
      turnId,
      tool: call.name,
      args: call.arguments,
      ...(paid !== undefined && { paid }),
    }
    this.recordTranscript(turnId, started)
    this.emit({ type: 'itemStarted', item: started })
    let result: CallResult
    try {
      result = await this.decideAndRun(turnId, itemId, call, signal, goalCommandRevision)
    } catch (error: unknown) {
      if (error instanceof AbortedError || signal.aborted) {
        this.finishCall(
          turnId,
          started,
          call,
          toolFailure(MODEL_TEXT.toolCancelledByStop),
          CANCELLED,
        )
        throw new AbortedError()
      }
      // A tool that threw (a disk error, a directory for a file) is a failed
      // call the model is told about, not the end of the turn.
      result = { outcome: toolFailure(describe(error)), isRejected: false }
    }
    await this.touchPath(call)
    const { outcome, isRejected, running } = result
    if (running !== undefined) {
      this.continueInBackground(turnId, started, call, outcome, running)
      return
    }
    let status = COMPLETED
    if (outcome.failureReason !== undefined) {
      status = isRejected ? REJECTED : FAILED
    }
    this.finishCall(turnId, started, call, outcome, status)
  }

  /**
   * A shell call the user moved to the background (M46): the model gets its
   * answer now and the turn goes on; the row stays running, marked, and is
   * kept in the history as it is, until the command ends.
   */
  private continueInBackground(
    turnId: string,
    started: ItemSnapshot,
    call: FunctionCallItem,
    outcome: ToolOutcome,
    running: Promise<ToolOutcome>,
  ): void {
    const moved: ItemSnapshot = {
      ...started,
      background: true,
      backgroundInitiator: BACKGROUND_INITIATOR_USER,
    }
    this.emit({ type: 'itemUpdated', item: moved })
    this.rerecordTranscript(moved)
    this.replay.push({
      turnId,
      item: { type: 'function_call_output', call_id: call.call_id, output: outcome.output },
    })
    void running
      .catch((error: unknown) => toolFailure(describe(error)))
      .then((final) => {
        this.endInBackground(moved, call, final)
      })
  }

  /** A background command ended (M46): its row completes and the model hears how. */
  private endInBackground(moved: ItemSnapshot, call: FunctionCallItem, final: ToolOutcome): void {
    const stop = this.backgroundShells.get(moved.itemId)
    this.backgroundShells.delete(moved.itemId)
    let status = COMPLETED
    if (stop?.signal.aborted === true) {
      status = CANCELLED
    } else if (final.failureReason !== undefined) {
      status = FAILED
    }
    const completed: ItemSnapshot = {
      ...moved,
      status,
      visibleOutput: final.visibleOutput,
      ...(final.failureReason !== undefined && { failureReason: final.failureReason }),
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.rerecordTranscript(completed)
    this.noteForModel(
      `${MODEL_TEXT.backgroundEndedLead}\n$ ${commandOf(call.arguments)}\n${final.output}`,
      moved.itemId,
    )
  }

  /** The turn a note or a user shell's row belongs to: the latest, or the conversation's base. */
  private latestTurnId(): string {
    // Before any turn it belongs to the base, as a compaction's summary does:
    // every fork keeps it.
    return this.turnIds.at(-1) ?? COMPACTION_TURN_ID
  }

  /**
   * Something the model reads before its next request (M46): straight into
   * the replay while nothing holds it, else when the running turn next asks
   * or ends (a compaction: when it ends).
   */
  private noteForModel(text: string, backgroundTaskId?: string): void {
    const note: PendingNote = { text, ...(backgroundTaskId !== undefined && { backgroundTaskId }) }
    if (this.active !== undefined || this.compacting !== undefined) {
      this.pendingNotes.push(note)
      return
    }
    this.replay.push({
      turnId: this.latestTurnId(),
      item: noteItem(text),
      ...(backgroundTaskId !== undefined && { backgroundTaskId }),
    })
    this.touch()
  }

  /** The notes held while the replay was busy, into it under `turnId`; true when there were any. */
  private settleNotes(turnId: string): boolean {
    const notes = this.pendingNotes.splice(0)
    for (const note of notes) {
      this.replay.push({
        turnId,
        item: noteItem(note.text),
        ...(note.backgroundTaskId !== undefined && { backgroundTaskId: note.backgroundTaskId }),
      })
    }
    return notes.length > 0
  }

  /** The user's `!` command (M46): run, shown as its row, and told to the model. */
  private async runUserShellCommand(
    started: ItemSnapshot,
    command: string,
    stop: AbortController,
  ): Promise<void> {
    const startedAt = this.deps.now()
    let result: ShellResult
    try {
      result = await this.deps.io.runShell(
        command,
        this.deps.workspaceRoot,
        USER_SHELL_TIMEOUT_MS,
        stop.signal,
      )
    } catch (error: unknown) {
      result = {
        stdout: '',
        stderr: describe(error),
        exitCode: null,
        isTimedOut: false,
        isCancelled: false,
      }
    } finally {
      this.userShells.delete(started.itemId)
    }
    const outcome = shellOutcome(result, USER_SHELL_TIMEOUT_MS)
    // As Muse Code's rows read (captured 2026-09-25): exit 0 completed, any
    // other failed; one the user stopped reads stopped.
    let status = result.exitCode === 0 ? COMPLETED : FAILED
    if (stop.signal.aborted) {
      status = CANCELLED
    }
    const completed: ItemSnapshot = {
      ...started,
      status,
      visibleOutput: shellText(result),
      durationMs: this.deps.now() - startedAt,
      ...(result.exitCode !== null && { exitCode: result.exitCode }),
      ...(outcome.failureReason !== undefined && { failureReason: outcome.failureReason }),
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.rerecordTranscript(completed)
    this.noteForModel(`${MODEL_TEXT.userShellLead}\n$ ${command}\n${outcome.output}`)
  }

  /** Calls kept from running still get an output for valid replay. */
  private skipCalls(
    turnId: string,
    calls: readonly FunctionCallItem[],
    reason: string = MODEL_TEXT.toolCancelledByStop,
  ): void {
    for (const call of calls) {
      this.replay.push({
        turnId,
        item: {
          type: 'function_call_output',
          call_id: call.call_id,
          output: `Error: ${reason}`,
        },
      })
    }
  }

  private drainSteered(turn: ActiveTurn): void {
    // What ended or ran meanwhile first (M46), then what the user added.
    this.settleNotes(turn.turnId)
    for (const parts of turn.steered.splice(0)) {
      const text = typedText(parts)
      this.replay.push({
        turnId: turn.turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: MODEL_TEXT.steeredPrefix },
            ...this.contentParts(parts),
          ],
        },
      })
      this.recordTranscript(turn.turnId, {
        itemId: this.deps.newId(),
        kind: 'userMessage',
        status: COMPLETED,
        turnId: turn.turnId,
        text,
      })
    }
  }

  /** Accepted steering that missed this turn's last request becomes user turns. */
  private queuedSteered(turn: ActiveTurn): QueuedTurn[] {
    return turn.steered.splice(0).map((parts) => ({
      turnId: this.deps.newId(),
      parts,
      displayText: undefined,
      isGoalWake: false,
    }))
  }

  /** A busy goal command was not in the request already in flight. */
  private drainGoalWake(turn: ActiveTurn): void {
    if (!turn.goalWakePending) {
      return
    }
    turn.goalWakePending = false
    if (!isGoalActive(this.goal)) {
      return
    }
    this.replay.push({
      turnId: turn.turnId,
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: MODEL_TEXT.goalWake }],
      },
    })
  }

  private async loop(turn: ActiveTurn): Promise<void> {
    const { signal } = turn.abort
    for (let round = 0; round < MODEL_API_MAX_TOOL_ROUNDS; round += 1) {
      if (isAbortRequested(signal)) {
        throw new AbortedError()
      }
      this.drainSteered(turn)
      this.drainGoalWake(turn)
      const wasBudgetLimited = this.goal?.status === GOAL_STATUS.budgetLimited
      const { calls, goalCommandRevision } = await this.streamOnce(turn.turnId, signal)
      if (isAbortRequested(signal)) {
        // A buffered completed response may arrive after Stop. Its calls
        // still need outputs for valid replay, but no work or steering runs.
        this.skipCalls(turn.turnId, calls)
        throw new AbortedError()
      }
      if (!wasBudgetLimited && this.goal?.status === GOAL_STATUS.budgetLimited) {
        this.skipCalls(turn.turnId, calls, MODEL_TEXT.goalBudgetReached)
        this.queuedTurns.unshift(...this.queuedSteered(turn))
        return
      }
      // One more model call without progress toward the goal (the step probe, D38).
      if (isGoalActive(this.goal)) {
        this.goalSteps += 1
      }
      if (calls.length === 0) {
        // A message typed while the final answer streamed gets its own round
        // instead of being accepted and dropped (D26).
        if (turn.steered.length === 0 && !(turn.goalWakePending && isGoalActive(this.goal))) {
          return
        }
        continue
      }
      for (const [index, call] of calls.entries()) {
        if (isAbortRequested(signal)) {
          this.skipCalls(turn.turnId, calls.slice(index))
          throw new AbortedError()
        }
        try {
          await this.runCall(turn.turnId, call, signal, goalCommandRevision)
        } catch (error: unknown) {
          this.skipCalls(turn.turnId, calls.slice(index + 1))
          throw error
        }
      }
    }
    // Input accepted during the last permitted round still needs a request
    // that sees it. Steered messages belonged to this turn, so run them
    // before separately queued messages; a goal cue follows them.
    const overflow = this.queuedSteered(turn)
    if (turn.goalWakePending && isGoalActive(this.goal)) {
      overflow.push(this.queuedGoalWake())
    }
    if (overflow.length > 0) {
      this.queuedTurns.unshift(...overflow)
    }
    throw new Error(`stopped after ${String(MODEL_API_MAX_TOOL_ROUNDS)} tool rounds`)
  }

  private async runTurn(queued: QueuedTurn): Promise<void> {
    const turn: ActiveTurn = {
      turnId: queued.turnId,
      abort: new AbortController(),
      steered: [],
      goalWakePending: false,
    }
    this.active = turn
    this.status = RUNNING
    this.turnIds.push(turn.turnId)
    this.emit({ type: 'turnStarted', turnId: turn.turnId })
    this.emit({ type: 'sessionStatus', status: RUNNING })
    // The context comes first so a skill invocation can be expanded (D13);
    // it never throws, so the user message always follows.
    await this.context.load()
    this.environment ??= await this.loadEnvironment()
    // Pending background output and user shell commands precede this turn.
    this.settleNotes(turn.turnId)
    this.drainChildResults()
    if (queued.isGoalWake) {
      this.appendGoalWake(turn.turnId, queued.parts)
    } else {
      this.appendUserMessage(turn.turnId, queued.parts, queued.displayText)
    }
    this.touch()
    const startedAt = this.deps.now()
    let terminal = COMPLETED
    let reason: string | undefined
    let errorKind: string | undefined
    try {
      await this.loop(turn)
    } catch (error: unknown) {
      if (turn.abort.signal.aborted) {
        terminal = CANCELLED
      } else {
        terminal = FAILED
        reason = error instanceof ChildTaskRefusedError ? error.visible : describe(error)
        if (error instanceof ChildTaskRefusedError) {
          errorKind = `subagent_${error.kind}`
        } else {
          errorKind = isAuthFailure(error) ? AUTH_REQUIRED_ERROR_KIND : MODEL_API_ERROR_KIND
        }
        this.deps.log.warn(`Model API turn ${turn.turnId} failed: ${reason}`)
      }
    }
    // `loop` returns only with nothing steered left (D26), and `steer` is
    // refused once `active` is cleared, so no input is lost between the two.
    // A note that arrived during the last reply is kept for the next request (M46).
    this.settleNotes(turn.turnId)
    this.active = undefined
    this.status = IDLE
    this.turnCount += 1
    this.emit({
      type: 'turnCompleted',
      turnId: turn.turnId,
      terminal,
      ...(reason !== undefined && { reason }),
      ...(errorKind !== undefined && { errorKind }),
      durationMs: this.deps.now() - startedAt,
    })
    this.emit({ type: 'sessionStatus', status: IDLE })
    this.touch()
    this.startNextQueued()
  }

  /** The next queued turn, once nothing (a turn, a compaction) is running. */
  private startNextQueued(): void {
    if (this.active !== undefined || this.compacting !== undefined) {
      return
    }
    for (;;) {
      const next = this.queuedTurns.shift()
      if (next === undefined) {
        return
      }
      if (
        next.isGoalWake &&
        (!isGoalActive(this.goal) || next.goalCommandRevision !== this.goalCommandRevision)
      ) {
        this.emit({
          type: 'turnWithdrawn',
          turnId: next.turnId,
          reason: UI_TEXT.goalWakeWithdrawn,
        })
        continue
      }
      void this.runTurn(next)
      return
    }
  }

  /** The text a stream event contributes to a collected reply; throws on failure. */
  private collectedText(event: StreamEvent, chargedGoalId: string | undefined): string {
    switch (event.type) {
      case 'response.output_text.delta': {
        return event.delta
      }
      case 'response.failed': {
        this.noteUsage(event.response.usage, chargedGoalId)
        throw new ModelApiError(
          event.response.error?.message ?? 'The response failed',
          0,
          undefined,
          undefined,
        )
      }
      case 'error': {
        throw new ModelApiError(event.message, 0, undefined, event.code ?? undefined)
      }
      case 'response.completed': {
        this.noteUsage(event.response.usage, chargedGoalId)
        return ''
      }
      case 'response.incomplete': {
        this.noteUsage(event.response.usage, chargedGoalId)
        this.deps.log.warn(
          `Model API compaction response ${event.response.id} incomplete: ${event.response.incomplete_details?.reason ?? 'no reason'}`,
        )
        throw new ModelApiError('response.incomplete', 0, undefined, 'response_incomplete')
      }
      default: {
        return ''
      }
    }
  }

  /** Collects the reply text of one model call without touching the transcript. */
  private async collectText(
    body: CreateResponseBody,
    signal: AbortSignal,
    chargedGoalId: string | undefined,
  ): Promise<string> {
    let text = ''
    let isComplete = false
    const admitAttempt: ResponseAttemptGuard | undefined = this.isSubagent
      ? (keyDigest) => {
          this.admitChildAttempt(keyDigest, body)
        }
      : undefined
    const responseStream = this.deps.client.streamResponse(
      body,
      signal,
      undefined,
      undefined,
      admitAttempt,
    )
    for await (const event of responseStream) {
      isComplete ||= event.type === 'response.completed'
      text += this.collectedText(event, chargedGoalId)
    }
    if (!isComplete) {
      throw new ModelApiError(
        'The stream ended without a completed response',
        0,
        undefined,
        undefined,
      )
    }
    return text
  }

  /** The summary call of `compact`, and the replay it leaves behind. */
  private async runCompaction(signal: AbortSignal): Promise<CompactOutcome> {
    const chargedGoalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    const body: CreateResponseBody = {
      ...this.body(),
      input: [
        ...this.replay.map((entry) => entry.item),
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: MODEL_TEXT.compactionPrompt }],
        },
      ],
      tools: [],
      include: ['reasoning.encrypted_content'],
    }
    const summary = await this.collectText(body, signal, chargedGoalId)
    this.replay.splice(0, this.replay.length, {
      turnId: COMPACTION_TURN_ID,
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `${MODEL_TEXT.compactionPrefix}\n\n${summary}` }],
      },
    })
    const item: ItemSnapshot = {
      itemId: this.deps.newId(),
      kind: 'compaction',
      status: COMPLETED,
      fallbackText: UI_TEXT.compactionDone,
    }
    this.emit({ type: 'itemCompleted', item })
    this.recordTranscript(COMPACTION_TURN_ID, item)
    this.touch()
    // The new context size is a courtesy: the compaction stands if it cannot be counted.
    const { stream: _stream, ...countable } = this.body()
    try {
      this.noteContext(await this.deps.client.countInputTokens(countable))
    } catch (error: unknown) {
      this.deps.log.warn(`The compacted context could not be counted: ${describe(error)}`)
    }
    return { status: ACCEPTED, reason: undefined }
  }

  // --- AgentSession ---

  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    for (const request of this.pendingApprovalEvents.values()) {
      listener({ ...request, isReplayed: true })
    }
    for (const child of this.children.values()) {
      for (const request of child.session.pendingApprovalEvents.values()) {
        listener({ ...request, isReplayed: true })
      }
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  public get approvalMode(): ApprovalMode {
    return this.permissions.currentMode
  }

  public sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission> {
    const turnId = this.isSubagent ? `${this.sessionId}:${this.deps.newId()}` : this.deps.newId()
    const queued: QueuedTurn = { turnId, parts, displayText, isGoalWake: false }
    // A compaction is a turn too (D26): a message sent during one waits for it.
    if (this.active === undefined && this.compacting === undefined) {
      void this.runTurn(queued)
      return Promise.resolve({ turnId, disposition: 'started' })
    }
    this.queuedTurns.push(queued)
    return Promise.resolve({ turnId, disposition: 'queued' })
  }

  public steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<string> {
    if (this.active?.turnId !== expectedTurnId || this.active.abort.signal.aborted) {
      return Promise.reject(new Error(TURN_NOT_RUNNING))
    }
    this.active.steered.push(parts)
    return Promise.resolve(expectedTurnId)
  }

  /**
   * Stop: the running turn or compaction is aborted, and each queued message
   * is ended with a reason instead of vanishing (D26).
   */
  public cancel(): Promise<void> {
    for (const dropped of this.queuedTurns.splice(0)) {
      this.emit({
        type: 'turnWithdrawn',
        turnId: dropped.turnId,
        reason: UI_TEXT.queuedTurnDropped,
      })
    }
    if (this.active !== undefined || this.compacting !== undefined) {
      // Pause the goal Stop targeted now. A replacement accepted while an
      // aborted turn unwinds must remain active and get its own wake.
      this.pauseGoalAfterStop()
    }
    this.active?.abort.abort()
    if (this.compacting !== undefined) {
      this.compacting.abort()
    }
    return Promise.resolve()
  }

  public setModel(modelId: string): Promise<void> {
    this.modelId = modelId
    this.emit({ type: 'modelChanged', modelId })
    this.touch()
    return Promise.resolve()
  }

  public setReasoningEffort(reasoningEffort: string): Promise<void> {
    if (reasoningEffort === '') {
      return Promise.reject(new Error('reasoning effort must not be empty'))
    }
    this.effort = reasoningEffort
    this.touch()
    return Promise.resolve()
  }

  public setApprovalMode(mode: string): Promise<void> {
    if (!(APPROVAL_MODES as readonly string[]).includes(mode)) {
      return Promise.reject(new Error(`unknown approval mode ${mode}`))
    }
    this.permissions.setMode(mode as ApprovalMode)
    for (const child of this.children.values()) {
      void child.session.setApprovalMode(mode)
    }
    this.touch()
    return Promise.resolve()
  }

  /**
   * Summarises the conversation with one model call and replays only the
   * summary from then on, as `/compact` does in Muse Code.
   */
  public async compact(): Promise<CompactOutcome> {
    if (this.replay.length === 0) {
      return { status: NOOP, reason: NO_COMPACTABLE_HISTORY }
    }
    if (this.active !== undefined || this.compacting !== undefined) {
      throw new Error(TURN_RUNNING)
    }
    // Running like a turn (D26): Stop ends it, and messages sent meanwhile queue.
    const abort = new AbortController()
    this.compacting = abort
    this.status = RUNNING
    this.emit({ type: 'sessionStatus', status: RUNNING })
    try {
      return await this.runCompaction(abort.signal)
    } catch (error: unknown) {
      if (abort.signal.aborted) {
        return { status: CANCELLED, reason: UI_TEXT.compactionStopped }
      }
      throw error
    } finally {
      this.compacting = undefined
      // Notes that arrived during the summary follow it (M46), and are kept.
      if (this.settleNotes(this.latestTurnId())) {
        this.touch()
      }
      this.status = IDLE
      this.emit({ type: 'sessionStatus', status: IDLE })
      // A rejected compaction still spent tokens. Save after it settles;
      // normal turns wait for every function call's output before saving.
      this.touch()
      this.startNextQueued()
    }
  }

  public decideApproval(decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(decision.approvalId)
    if (pending === undefined) {
      for (const child of this.children.values()) {
        if (child.session.pendingApprovals.has(decision.approvalId)) {
          return child.session.decideApproval(decision)
        }
      }
      return Promise.reject(new Error(`approval ${decision.approvalId} is not pending`))
    }
    if (!isKnownChoice(decision.choiceId)) {
      return Promise.reject(new Error(`unknown choice ${decision.choiceId}`))
    }
    pending.resolve(decision)
    return Promise.resolve()
  }

  /** A submitted card answers every question; none at all is a Cancel (M16). */
  public answerQuestions(userInputId: string, answers: readonly QuestionAnswer[]): Promise<void> {
    return this.settleQuestion(
      userInputId,
      answers.length === 0 ? { kind: 'cancelled' } : { kind: 'answered', answers },
    )
  }

  /** Decline the prompt (M16): the tool resolves with no answers and tells the model so. */
  public cancelQuestions(userInputId: string): Promise<void> {
    return this.settleQuestion(userInputId, { kind: 'cancelled' })
  }

  /** Explain instead of choosing (M46): the tool returns the text, as Muse Code's clarify does. */
  public clarifyQuestions(userInputId: string, text: string): Promise<void> {
    const trimmed = text.trim()
    return trimmed === '' || trimmed.length > CLARIFICATION_MAX_CHARS
      ? Promise.reject(
          new Error(`an explanation is 1 to ${String(CLARIFICATION_MAX_CHARS)} characters`),
        )
      : this.settleQuestion(userInputId, { kind: 'clarified', text: trimmed })
  }

  /** The running shell call `taskId` goes on in the background (M46). */
  public moveToBackground(taskId: string): Promise<void> {
    const move = this.foregroundShells.get(taskId)
    if (move === undefined) {
      return Promise.reject(new Error(UI_TEXT.taskNotRunning))
    }
    move()
    return Promise.resolve()
  }

  /** Stops a background command, or the user's own `!` command, by its row (M46). */
  public stopTask(taskId: string): Promise<void> {
    const stop = this.backgroundShells.get(taskId) ?? this.userShells.get(taskId)
    if (stop === undefined) {
      return Promise.reject(new Error(UI_TEXT.taskNotRunning))
    }
    stop.abort()
    return Promise.resolve()
  }

  /** Every background command, as Muse Code's `task/stopAll`; the user's own run on (M46). */
  public stopAllTasks(): Promise<void> {
    for (const stop of this.backgroundShells.values()) {
      stop.abort()
    }
    return Promise.resolve()
  }

  /**
   * The user's `!` command (M46): refused in Restricted Mode like the shell
   * tool (PLAN.md D13); otherwise it runs at once, outside any turn, through
   * the shell tool's runner.
   */
  public runUserShell(command: string): Promise<void> {
    if (!this.deps.isWorkspaceTrusted()) {
      return Promise.reject(new Error(UI_TEXT.userShellRestricted))
    }
    const started: ItemSnapshot = {
      itemId: this.deps.newId(),
      kind: USER_SHELL_ITEM_KIND,
      status: IN_PROGRESS,
      commandText: command,
    }
    const stop = new AbortController()
    this.userShells.set(started.itemId, stop)
    this.recordTranscript(this.latestTurnId(), started)
    this.touch()
    this.emit({ type: 'itemStarted', item: started })
    void this.runUserShellCommand(started, command, stop)
    return Promise.resolve()
  }

  /** Owner controls for Model API children (M48, PLAN.md D45). */
  public async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    const child = this.childById(subagentId)
    if (child === undefined) {
      throw new Error(`unknown subagent ${subagentId}`)
    }
    switch (action) {
      case 'readResult': {
        if (child.state !== 'result_ready') {
          throw new Error('subagent result is not ready')
        }
        child.state = 'closed'

        break
      }
      case 'reopen':
      case 'resume': {
        if (child.state !== 'closed' && child.state !== 'interrupted') {
          throw new Error('subagent cannot resume from this state')
        }
        const stateBeforeConsent = child.state
        const revisionBeforeConsent = child.revision
        const taskBeforeConsent = this.queuedChildTask(child, [
          ...child.pendingMessages,
          MODEL_TEXT.subagentResume,
        ])
        const grant = await this.confirmOwnerChildTask(child, taskBeforeConsent)
        if (
          this.isDisposed ||
          child.state !== stateBeforeConsent ||
          child.revision !== revisionBeforeConsent ||
          this.queuedChildTask(child, [...child.pendingMessages, MODEL_TEXT.subagentResume]) !==
            taskBeforeConsent
        ) {
          throw new Error(UI_TEXT.subagentConsentDeclined)
        }
        this.installChildGrant(child, grant)
        child.pendingMessages.push(MODEL_TEXT.subagentResume)
        child.state = 'queued'
        this.startQueuedChildren()

        break
      }
      case 'interrupt': {
        if (child.state !== 'running') {
          throw new Error('subagent is not running')
        }
        child.state = 'interrupted'
        await child.session.cancel()

        break
      }
      default: {
        child.revision += 1
        if (action === 'stop') {
          child.terminal ??= CANCELLED
        }
        child.pendingMessages.length = 0
        child.followupAfterStop = undefined
        child.nextTaskGrant = undefined
        child.session.childTaskGrant = undefined
        child.state = 'closed'
        await child.session.cancel()
        this.startQueuedChildren()
      }
    }
    this.updateChild(child)
  }

  public async messageSubagent(
    subagentId: string,
    body: string,
    isFollowup: boolean,
  ): Promise<void> {
    const child = this.childById(subagentId)
    if (child === undefined || child.state === 'closed') {
      throw new Error(`subagent ${subagentId} is unavailable`)
    }
    if (body.trim() === '') {
      throw new Error('subagent message is empty')
    }
    if (isFollowup && child.state === 'running') {
      throw new Error('subagent is still running')
    }
    if (!isFollowup && child.state === 'running') {
      const turnId = child.session.activeTurnId
      if (turnId === undefined) {
        throw new Error('subagent turn is settling; retry the message')
      }
      await child.session.steer(turnId, [{ type: 'text', text: body }])
    } else {
      if (child.state !== 'queued') {
        const stateBeforeConsent = child.state
        const revisionBeforeConsent = child.revision
        const taskBeforeConsent = this.queuedChildTask(child, [...child.pendingMessages, body])
        const grant = await this.confirmOwnerChildTask(child, taskBeforeConsent)
        if (
          this.isDisposed ||
          child.state !== stateBeforeConsent ||
          child.revision !== revisionBeforeConsent ||
          this.queuedChildTask(child, [...child.pendingMessages, body]) !== taskBeforeConsent
        ) {
          throw new Error(UI_TEXT.subagentConsentDeclined)
        }
        this.installChildGrant(child, grant)
      }
      child.pendingMessages.push(body)
      child.state = 'queued'
      this.startQueuedChildren()
    }
    this.updateChild(child)
  }

  /**
   * The user's goal verbs (M45, PLAN.md D38), with MSP's rules and
   * refusals: a set, edit or resume that leaves the goal active wakes a
   * turn when nothing runs, as `goal/*` does; nothing else starts one.
   */
  public controlGoal(command: GoalCommand): Promise<GoalCommandOutcome> {
    const problem = goalObjectiveProblem(command)
    if (problem !== undefined) {
      const detail =
        problem === 'empty'
          ? UI_TEXT.goalObjectiveMissing
          : fill(UI_TEXT.goalObjectiveTooLong, { limit: GOAL_OBJECTIVE_MAX_CHARS })
      return Promise.reject(new Error(`goal/${command.verb}: ${detail}`))
    }
    const applied = applyGoalCommand(this.goal, command, this.goalContext())
    if (typeof applied === 'string') {
      return Promise.reject(
        new GoalRefusedError(
          applied,
          `goal/${command.verb} rejected: ${GOAL_REFUSAL_REASONS[applied]}`,
        ),
      )
    }
    this.replaceGoal(applied.goal)
    this.goalCommandRevision += 1
    if (command.verb === 'set' || command.verb === 'resume') {
      this.goalSteps = 0
    }
    this.touch()
    return Promise.resolve({ turnId: this.wakeFor(command) })
  }

  public readOutput(request: OutputPageRequest): Promise<OutputPage> {
    const content = this.outputs.get(request.outputRef)
    if (content === undefined) {
      return Promise.reject(new Error(`unknown output ${request.outputRef}`))
    }
    const bytes = Buffer.from(content, MODEL_API_OUTPUT_ENCODING)
    // Pages start and end on character boundaries, as the CLI serves them (D26):
    // a character split across two pages would decode as U+FFFD in both.
    const start = characterStart(bytes, Math.min(request.offsetBytes, bytes.length))
    let end = characterStart(bytes, Math.min(start + request.lengthBytes, bytes.length))
    if (end <= start && start < bytes.length) {
      end = characterEnd(bytes, start)
    }
    const slice = bytes.subarray(start, end)
    return Promise.resolve({
      content: slice.toString(MODEL_API_OUTPUT_ENCODING),
      encoding: MODEL_API_OUTPUT_ENCODING,
      mediaType: MODEL_API_OUTPUT_MEDIA_TYPE,
      offsetBytes: start,
      byteLen: slice.length,
      eof: end >= bytes.length,
    })
  }

  public async listSkills(): Promise<readonly SkillSummary[]> {
    await this.context.load()
    return this.context
      .sections()
      .skills.filter((skill) => skill.isUserInvocable)
      .map((skill) => ({
        selector: skill.id,
        displayName: skill.name,
        description: skill.description,
        argumentHint: skill.argumentHint,
      }))
  }

  /** Re-reads the skill roots after their files changed; `skillsChanged` when the catalogue did. */
  public async refreshSkills(): Promise<void> {
    if (await this.context.refreshSkills()) {
      this.emit({ type: 'skillsChanged' })
    }
  }

  public rename(name: string): Promise<string | undefined> {
    this.name = name
    this.emit({ type: 'sessionNamed', name })
    this.touch()
    return Promise.resolve(name)
  }

  /** One more surface holds this session (a second panel resumed it, PLAN.md D25). */
  public retain(): void {
    this.holders += 1
  }

  /** Releases a surface's hold; the last one stops the turn and forgets the session. */
  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.holders -= 1
    if (this.holders > 0) {
      return
    }
    this.isDisposed = true
    void this.cancel()
    // Nothing is left running unwatched (M46): the background commands and
    // the user's own go with the session.
    for (const stop of [...this.backgroundShells.values(), ...this.userShells.values()]) {
      stop.abort()
    }
    for (const child of this.children.values()) {
      child.session.disposeAll()
    }
    this.listeners.clear()
    this.onDispose()
  }

  /** The host is closing: the session goes whoever still holds it. */
  public disposeAll(): void {
    this.holders = 1
    this.dispose()
  }

  // --- host-side views ---

  /** The turn running now, for a surface that loads this session mid-turn (D26). */
  public get activeTurnId(): string | undefined {
    return this.active?.turnId
  }

  public record(): SessionRecord {
    return {
      sessionId: this.sessionId,
      ...(this.name !== undefined && { name: this.name }),
      ...(this.firstPrompt !== undefined && {
        title: this.firstPrompt,
        firstUserPrompt: this.firstPrompt,
      }),
      createdAt: this.createdAt,
      updatedAt: this.lastActivityAt,
      lastActivityAt: this.lastActivityAt,
      status: this.status,
      turnCount: this.turnCount,
      forkedFrom: this.forkedFrom === undefined ? null : { sessionId: this.forkedFrom },
      workspaceRoot: this.deps.workspaceRoot,
    }
  }

  public history(): SessionHistoryOutcome {
    return {
      mode: 'inline',
      items: this.transcript.map((entry) => entry.item),
      name: this.name,
      todos: [...this.todos],
      goal: this.goal === undefined ? null : toSessionGoal(this.goal),
    }
  }

  /** Everything a window needs to bring this session back (D14). */
  public snapshot(): StoredSession {
    return {
      version: STORED_SESSION_VERSION,
      sessionId: this.sessionId,
      workspaceRoot: this.deps.workspaceRoot,
      modelId: this.modelId,
      approvalMode: this.permissions.currentMode,
      effort: this.effort,
      ...(this.name !== undefined && { name: this.name }),
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      turnIds: [...this.turnIds],
      ...(this.forkedFrom !== undefined && { forkedFrom: this.forkedFrom }),
      ...(this.firstPrompt !== undefined && { firstPrompt: this.firstPrompt }),
      todos: [...this.todos],
      ...(this.goal !== undefined && { goal: this.goal }),
      replay: [...this.replay],
      transcript: [...this.transcript],
      outputs: Object.fromEntries(this.outputs),
      usage: { ...this.usage },
      ...(this.spawnCommands.size > 0 && { spawnCommands: Object.fromEntries(this.spawnCommands) }),
      ...(this.pendingChildResults.length > 0 && {
        pendingChildResults: [...this.pendingChildResults],
      }),
      ...(this.children.size > 0 && {
        children: Array.from(this.children.values(), (child) => ({
          id: child.id,
          role: child.role,
          objective: child.objective,
          itemId: child.itemId,
          parentTurnId: child.parentTurnId,
          startedAt: child.startedAt,
          state: child.state,
          ...(child.result !== undefined && { result: child.result }),
          ...(child.terminal !== undefined && { terminal: child.terminal }),
          pendingMessages: [...child.pendingMessages],
          session: child.session.snapshot(),
        })),
      }),
    }
  }

  /** Fills a fresh session from its stored form; the session is idle afterwards. */
  public adopt(stored: StoredSession): void {
    this.replay.push(...stored.replay)
    this.transcript.push(...withoutRunning(stored.transcript))
    this.turnIds.push(...stored.turnIds)
    // A background command its window took with it (M46): the model, told it
    // runs on, hears that it ended and its output was lost.
    for (const { item } of stored.transcript) {
      if (item.status === IN_PROGRESS && item.background === true) {
        this.replay.push({
          turnId: this.latestTurnId(),
          item: noteItem(`${MODEL_TEXT.backgroundLostLead}\n$ ${commandOf(item.args ?? '')}`),
          backgroundTaskId: item.itemId,
        })
      }
    }
    for (const [ref, content] of Object.entries(stored.outputs)) {
      this.outputs.set(ref, content)
    }
    this.effort = stored.effort
    this.name = stored.name
    this.todos = [...stored.todos]
    this.goal = stored.goal
    this.firstPrompt = stored.firstPrompt
    this.forkedFrom = stored.forkedFrom
    this.createdAt = stored.createdAt
    this.lastActivityAt = stored.lastActivityAt
    this.turnCount = stored.turnIds.length
    this.usage = { ...stored.usage }
    this.status = IDLE
    this.pendingChildResults.push(...(stored.pendingChildResults ?? []))
    const savedCommands = Object.entries(stored.spawnCommands ?? {})
    for (const [commandId, childId] of savedCommands) {
      this.spawnCommands.set(commandId, childId)
    }
    const savedChildren = stored.children ?? []
    for (const saved of savedChildren) {
      const session = new ModelApiSession(
        saved.session.sessionId,
        saved.session.modelId,
        saved.session.approvalMode,
        this.deps,
        () => {
          this.touch()
        },
        NO_CHILD_DISPOSAL,
        true,
        this,
      )
      session.adopt(saved.session)
      const record: ChildRecord = {
        id: saved.id,
        role: saved.role,
        objective: saved.objective,
        itemId: saved.itemId,
        parentTurnId: saved.parentTurnId,
        session,
        startedAt: saved.startedAt,
        state: saved.state === 'running' || saved.state === 'queued' ? 'interrupted' : saved.state,
        result: saved.result,
        terminal: saved.terminal,
        usage: { ...saved.session.usage },
        chargedGoalId: undefined,
        waiters: new Set(),
        pendingMessages: [...saved.pendingMessages],
        followupAfterStop: undefined,
        nextTaskGrant: undefined,
        revision: 0,
      }
      session.onEvent((event) => {
        this.childEvent(record, event)
      })
      this.children.set(record.id, record)
      this.rerecordTranscript(this.childSnapshot(record))
    }
  }

  /** Copies the turns through `lastTurnId` (all of them when absent) into `target`. */
  public copyInto(target: ModelApiSession, lastTurnId: string | undefined): void {
    const cut =
      lastTurnId === undefined ? this.turnIds.length - 1 : this.turnIds.indexOf(lastTurnId)
    if (cut === -1) {
      throw new Error(`invalid fork boundary for session ${this.sessionId}: unknown turn`)
    }
    const kept = new Set(this.turnIds.slice(0, cut + 1))
    kept.add(COMPACTION_TURN_ID)
    target.replay.push(...this.replay.filter((entry) => kept.has(entry.turnId)))
    const retained = this.transcript.filter((entry) => kept.has(entry.turnId))
    target.transcript.push(...withoutRunning(retained))
    target.turnIds.push(...this.turnIds.slice(0, cut + 1))
    const copiedNotes = new Set(
      target.replay.flatMap((entry) =>
        entry.backgroundTaskId === undefined ? [] : [entry.backgroundTaskId],
      ),
    )
    for (const { item } of retained) {
      if (item.background !== true || copiedNotes.has(item.itemId)) {
        continue
      }
      const recorded = this.replay.findLast((entry) => entry.backgroundTaskId === item.itemId)
      const pending = this.pendingNotes.findLast((note) => note.backgroundTaskId === item.itemId)
      const command = commandOf(item.args ?? '')
      const fallback =
        item.status === IN_PROGRESS
          ? `${MODEL_TEXT.backgroundLostLead}\n$ ${command}`
          : `${MODEL_TEXT.backgroundEndedLead}\n$ ${command}\n${item.visibleOutput ?? ''}`
      target.replay.push({
        turnId: target.latestTurnId(),
        item: recorded?.item ?? noteItem(pending?.text ?? fallback),
        backgroundTaskId: item.itemId,
      })
      copiedNotes.add(item.itemId)
    }
    target.turnCount = target.turnIds.length
    target.firstPrompt = this.firstPrompt
    target.forkedFrom = this.sessionId
    target.effort = this.effort
    // The goal as it stands goes with the fork (M45): a goal has no history
    // to cut, so a fork from an earlier turn gets today's goal too.
    target.goal = this.goal
    for (const child of this.children.values()) {
      if (!kept.has(child.parentTurnId)) {
        continue
      }
      const sessionId = `${target.sessionId}:${child.id}`
      const session = new ModelApiSession(
        sessionId,
        child.session.modelId,
        child.session.approvalMode,
        this.deps,
        () => {
          target.touch()
        },
        NO_CHILD_DISPOSAL,
        true,
        target,
      )
      session.adopt({ ...child.session.snapshot(), sessionId })
      const cloned: ChildRecord = {
        ...child,
        session,
        state: 'closed',
        usage: { ...child.usage },
        chargedGoalId: undefined,
        waiters: new Set(),
        pendingMessages: [],
        followupAfterStop: undefined,
        nextTaskGrant: undefined,
        revision: 0,
      }
      session.onEvent((event) => {
        target.childEvent(cloned, event)
      })
      target.children.set(cloned.id, cloned)
      target.rerecordTranscript(target.childSnapshot(cloned))
    }
    for (const [ref, content] of this.outputs) {
      target.outputs.set(ref, content)
    }
  }

  /** Child transcripts are read through the host, not listed as conversations. */
  public childHistory(sessionId: string): SessionHistoryOutcome | undefined {
    for (const child of this.children.values()) {
      if (child.session.sessionId === sessionId) {
        return child.session.history()
      }
    }
    return undefined
  }
}

export class ModelApiHost implements AgentHost {
  private readonly sessions = new Map<string, ModelApiSession>()
  /** What the store holds for this workspace, kept current as sessions change. */
  private readonly stored = new Map<string, StoredSessionHeader>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  /** Saves run one after another; a failure is logged and never surfaces. */
  private saving: Promise<void> = Promise.resolve()
  public readonly info: HostInfo = {
    kind: 'modelApi',
    serverName: MODEL_API_SERVER_NAME,
    serverVersion: MODEL_API_VERSION,
    grantedCapabilities: [],
    canEditSessions: true,
  }

  public constructor(private readonly deps: ModelApiHostDeps) {}

  private announce(session: ModelApiSession): void {
    for (const listener of this.listListeners) {
      listener({ type: 'changed', record: session.record() })
    }
  }

  private persist(session: ModelApiSession): void {
    const { store } = this.deps
    if (store === undefined) {
      return
    }
    const snapshot = session.snapshot()
    // A turn-start user message can be saved, but a function call without
    // its output cannot be replayed after a crash. Goal/settings touches
    // during a pending tool still announce live; the settled touch saves.
    const answered = new Set(
      snapshot.replay.flatMap((entry) =>
        entry.item.type === 'function_call_output' ? [entry.item.call_id] : [],
      ),
    )
    if (
      snapshot.replay.some(
        (entry) => entry.item.type === 'function_call' && !answered.has(entry.item.call_id),
      )
    ) {
      return
    }
    this.stored.set(snapshot.sessionId, headerOf(snapshot))
    const previous = this.saving
    this.saving = (async () => {
      await previous
      try {
        await store.save(snapshot)
      } catch (error: unknown) {
        this.deps.log.warn(`Session ${snapshot.sessionId} was not saved: ${describe(error)}`)
      }
    })()
  }

  private create(
    modelId: string,
    approvalMode: ApprovalMode,
    sessionId: string = this.deps.newId(),
  ): ModelApiSession {
    const session = new ModelApiSession(
      sessionId,
      modelId,
      approvalMode,
      this.deps,
      () => {
        this.persist(session)
        this.announce(session)
      },
      () => {
        this.sessions.delete(sessionId)
      },
    )
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * A stored session read whole (D26: the window keeps only headers). The
   * saves queued before it run first, so the file holds what this window
   * last wrote.
   */
  private async storedSession(sessionId: string): Promise<StoredSession> {
    const { store } = this.deps
    if (store !== undefined && this.stored.has(sessionId)) {
      await this.saving
      const stored = await store.load(sessionId)
      if (stored !== undefined) {
        return stored
      }
    }
    throw new Error(`session ${sessionId} is not held by this window`)
  }

  /** The live session, or the stored one brought back into this window. */
  private async revive(sessionId: string): Promise<ModelApiSession> {
    const live = this.sessions.get(sessionId)
    if (live !== undefined) {
      live.retain()
      return live
    }
    const stored = await this.storedSession(sessionId)
    // Another surface may have brought it back while the file was read.
    const revived = this.sessions.get(sessionId)
    if (revived !== undefined) {
      revived.retain()
      return revived
    }
    const session = this.create(stored.modelId, stored.approvalMode, sessionId)
    session.adopt(stored)
    return session
  }

  private loaded(session: ModelApiSession): LoadedSession {
    return {
      session,
      record: session.record(),
      history: session.history(),
      activeTurnId: session.activeTurnId,
    }
  }

  /** Reads the store once; this window's sessions then include the stored ones. */
  public async load(): Promise<void> {
    const { store } = this.deps
    if (store === undefined) {
      return
    }
    const sessions = await store.list()
    for (const stored of sessions) {
      if (stored.workspaceRoot === this.deps.workspaceRoot) {
        this.stored.set(stored.sessionId, stored)
      }
    }
  }

  /** Resolves once every queued save has run (tests, and the manager before it forgets the host). */
  public flush(): Promise<void> {
    return this.saving
  }

  public onExit(_listener: (exit: HostExit) => void): () => void {
    // No process behind this host: nothing ever exits.
    return NO_UNSUBSCRIBE
  }

  public async listModels(sessionId?: string): Promise<readonly ModelSummary[]> {
    const ids = await this.deps.client.listModels()
    const active = sessionId === undefined ? undefined : this.sessions.get(sessionId)?.modelId
    return ids
      .filter((id) => id.startsWith(MODEL_API_MODEL_PREFIX))
      .map((id) => ({
        modelId: id,
        displayLabel: id,
        contextLimit: MODEL_API_CONTEXT_WINDOW,
        isDefault: id === DEFAULT_MODEL_ID,
        isActive: id === active,
      }))
  }

  public startSession(options: StartSessionOptions): Promise<AgentSession> {
    if (!(APPROVAL_MODES as readonly string[]).includes(options.approvalMode)) {
      return Promise.reject(new Error(`unknown approval mode ${options.approvalMode}`))
    }
    const session = this.create(options.modelId, options.approvalMode as ApprovalMode)
    this.announce(session)
    return Promise.resolve(session)
  }

  public listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const records = Array.from(this.sessions.values(), (session) => session.record())
    for (const [sessionId, stored] of this.stored) {
      if (!this.sessions.has(sessionId)) {
        records.push(recordOf(stored))
      }
    }
    const sessions = records
      .filter((record) => record.workspaceRoot === options.workspaceRoot)
      .toSorted(
        (a, b) =>
          Date.parse(b.lastActivityAt ?? b.updatedAt) - Date.parse(a.lastActivityAt ?? a.updatedAt),
      )
      .slice(0, options.limit)
    return Promise.resolve({ sessions, nextCursor: undefined })
  }

  /** A conversation or one of its private child transcripts (M48). */
  public async readSession(sessionId: string): Promise<SessionHistoryOutcome> {
    const live = this.sessions.get(sessionId)
    if (live !== undefined) {
      return live.history()
    }
    for (const parent of this.sessions.values()) {
      const child = parent.childHistory(sessionId)
      if (child !== undefined) {
        return child
      }
    }
    let source: StoredSession
    if (this.stored.has(sessionId)) {
      source = await this.storedSession(sessionId)
    } else {
      const childMarker = `:${SUBAGENT_ID_PREFIX}`
      const separator = sessionId.lastIndexOf(childMarker)
      const parentId = separator === -1 ? sessionId : sessionId.slice(0, separator)
      const stored = await this.storedSession(parentId)
      const child = stored.children?.find((entry) => entry.session.sessionId === sessionId)
      if (child === undefined) {
        throw new Error(`session ${sessionId} is not held by this window`)
      }
      source = child.session
    }
    return {
      mode: 'inline',
      items: source.transcript.map((entry) => entry.item),
      name: source.name,
      todos: source.todos,
      goal: source.goal === undefined ? null : toSessionGoal(source.goal),
    }
  }

  public async resumeSession(sessionId: string, _modelId: string): Promise<LoadedSession> {
    return this.loaded(await this.revive(sessionId))
  }

  public async forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
  ): Promise<LoadedSession> {
    // Copying needs no hold on a live source; a stored one is revived only for the copy.
    const live = this.sessions.get(sessionId)
    const source = live ?? (await this.revive(sessionId))
    const fork = this.create(modelId, source.approvalMode)
    try {
      source.copyInto(fork, lastTurnId)
      this.persist(fork)
    } catch (error: unknown) {
      fork.dispose()
      throw error
    } finally {
      if (live === undefined) {
        source.dispose()
      }
    }
    this.announce(fork)
    return this.loaded(fork)
  }

  public onSessionListEvent(listener: (event: SessionListEvent) => void): () => void {
    this.listListeners.add(listener)
    return () => {
      this.listListeners.delete(listener)
    }
  }

  /** A key has no subscription window: the dialog shows token totals instead. */
  public readUsage(): Promise<SubscriptionUsage | undefined> {
    return Promise.resolve(undefined)
  }

  public onUsageChanged(_listener: (usage: SubscriptionUsage) => void): () => void {
    return NO_UNSUBSCRIBE
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  /** The skill files changed on disk: every session re-reads its catalogue. */
  public async refreshSkills(): Promise<void> {
    await Promise.all(Array.from(this.sessions.values(), (session) => session.refreshSkills()))
  }

  public async close(): Promise<void> {
    // Disposing removes the entry; a Map iterator tolerates that.
    for (const session of this.sessions.values()) {
      session.disposeAll()
    }
    await this.saving
  }
}
