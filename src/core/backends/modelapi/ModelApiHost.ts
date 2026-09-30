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
  CHECK_FIX_MAX_ROUNDS,
  type CheckCommandSetting,
  type CheckSkip,
  CLARIFICATION_MAX_CHARS,
  BASE64_DATA_URL_OVERHEAD_CHARS,
  CONTEXT_PRESSURE_HIGH,
  CONTEXT_PRESSURE_MEDIUM,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GOAL_OBJECTIVE_MAX_CHARS,
  GOAL_STATUS,
  type GoalCommandVerb,
  type SubagentAction,
  HTTP_UNAUTHORIZED,
  HOOK_MAX_STOP_CONTINUATIONS,
  HOOK_NOTIFICATION_DELAY_MS,
  HOOK_SESSION_END_TIMEOUT_MS,
  IDE_MCP_SERVER_NAME,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_EFFORT_OFF,
  ISO_DATE_LENGTH,
  MODEL_API_MAX_OUTPUT_TOKENS,
  CODE_INTEL_TOOLS,
  type CodeIntelTool,
  MODEL_API_MAX_RETRIES,
  MODEL_API_MAX_TOOL_ROUNDS,
  MAX_ENCODED_MEDIA_CHARS,
  MAX_MODEL_API_TEXT_ATTACHMENT_BYTES,
  MEMORY_INDEX_FILE,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_PDF_PAGE_IMAGES,
  MODEL_API_HOOK_PROVIDER,
  MODEL_API_RETRYABLE_STREAM_CODES,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_OUTPUT_ENCODING,
  MODEL_API_OUTPUT_MEDIA_TYPE,
  MODEL_API_SERVER_NAME,
  MODEL_API_SCHEDULED_TOOL,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
  WEB_FETCH_SUBJECT_KIND,
  MODEL_API_VERSION,
  MODEL_API_WEB_SEARCH_TOOL,
  MODEL_TEXT,
  REPO_MAP_PROMPT_TRIES,
  OUTPUT_REF_PREFIX,
  SCHEDULE_LIFETIME_MS,
  SCHEDULE_MAX_INTERVAL_MS,
  SCHEDULE_MAX_JOBS_PER_SESSION,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_POLL_INTERVAL_MS,
  SHELL_DEFAULT_TIMEOUT_MS,
  type PaidFeature,
  QUESTION_OUTCOME_CLARIFIED,
  type PromptCacheRetention,
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
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
  USER_SHELL_ITEM_KIND,
  USER_SHELL_TIMEOUT_MS,
  VERIFY_COMMAND_RULE_KEY,
  VERIFY_NOTE_MAX_CHARS,
  VERIFY_SHOWN_FILES_MAX,
  VERIFY_TOOLS,
} from '../../../shared/constants'
import { fill, plural } from '../../../shared/l10n/text'
import { APPROVAL_MODES, type ApprovalMode } from '../../../shared/permissionModes'
import {
  modelApiPaidTier,
  type PaidUseRequest,
  type SubagentTaskConfirmation,
  type SubagentUsage,
} from '../../../shared/paid'
import type { SubscriptionUsage } from '../../../shared/usage'
import {
  scheduleCadenceSchema,
  scheduleViewOf,
  type ScheduleCadence,
  type ScheduledPrompt,
  type ScheduleRunConfirmation,
  type ScheduleStore,
} from '../../../shared/schedule'
import {
  type AgentHost,
  type AgentSession,
  type ApprovalDecision,
  type CompactOutcome,
  type DocumentPart,
  type GoalCommand,
  type GoalCommandOutcome,
  type GoalRefusal,
  GoalRefusedError,
  type HostExit,
  type HostInfo,
  type ImagePart,
  type ListSessionsOptions,
  type LoadedSession,
  type ModelSummary,
  type OutputPage,
  type OutputPageRequest,
  type SentImage,
  type SessionEventListener,
  type SessionHistoryOutcome,
  type SessionMcpHttpServer,
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
import { textFileInput } from '../../textAttachment'
import { isProtectedPath } from '../../protectedPaths'
import { confineWorkspacePath } from '../../workspacePath'
import { pathModule } from '../../workspaceRoot'
import { type CheckScope, type RunSnapshot, VerifyLedger } from './verifyLedger'
import { WorkspaceEdits, type WorkspaceEditRecorder } from '../../verify/workspaceEdits'
import { fingerprint } from '../../verify/fingerprint'
import type { McpTool } from '../../mcp'
import type { WebFetcher, WebFetchResult } from '../../web/webFetch'
import type { WebFetchFailure } from '../../web/fetchFailure'
import { approvalHost, checkPageUrl } from '../../web/pageUrl'
import type { MemoryStore } from '../../memory/memoryStore'
import type { CodeIntelDeps } from '../../codeIntel/codeIntelQuery'
import { codeIntelToolOf } from '../../codeIntel/definitions'
import type { LanguageServiceHost } from '../../codeIntel/languageService'
import type { RenamePlanResult } from '../../codeIntel/rename'
import { repoMapSection } from '../../codeIntel/repoMap'
import {
  applyRename,
  isProtectedRename,
  planRenameCall,
  renameCardPath,
  renameHookFiles,
  renameRefused,
  runCodeIntelRead,
} from './codeIntelCalls'
import {
  type ConfirmedModelRequest,
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
  isGoalActive,
  runGoalTool,
  toSessionGoal,
  withTokensUsed,
} from './goals'
import type { GoalRecord } from './goalRecord'
import { type EnvironmentFacts, instructionsFor } from './instructions'
import {
  dispatchHooks,
  matchingHooks,
  type HookDefinition,
  type HookDispatch,
  type HookEvent,
  toolMatcherNames,
} from './hooks'
import { postModelCallFields, preModelCallFields } from './modelCallHooks'
import { nextScheduleFire } from './schedules'
import { toolHookInput, toolHookOutput } from './toolHookPayload'
import { type ImagePlan, imageUseRequest, prepareImageCall, runImageCall } from './imageGeneration'
import { promptCacheKey } from './promptCache'
import { MediaBudget } from './mediaBudget'
import { mcpFunctionDefinition, mcpFunctionName } from './mcp/functions'
import type { McpPoolSnapshot, McpToolRef, McpToolSource } from './mcp/pool'
import { isMemoryTool, type PlacedMemoryCall, placeMemoryCall, runMemoryCall } from './memoryTools'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  PermissionEngine,
  type PermissionQuery,
  type PermissionVerdict,
  type ToolClass,
  verdictFor,
} from './permissions'
import {
  headerOf,
  recordOf,
  type SessionStore,
  type StoredReplayItem,
  type StoredSession,
  type StoredSessionHeader,
} from './sessionStore'
import {
  type Citation,
  citationsOf,
  type CreateResponseBody,
  type FunctionCallItem,
  type FunctionOutputPart,
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
  type EditFormatter,
  executeTool,
  parseQuestions,
  readSkillArgs,
  webFetchArgs,
  type ShellResult,
  shellOutcome,
  shellText,
  ShellTimeLimit,
  shellToolFor,
  todoWriteArgs,
  toolDefinitions,
  type ToolIo,
  type ToolOutcome,
  type VisibleFile,
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
import {
  authorizeThenGuard,
  type CheckRun,
  checksSection,
  finishedCheck,
  skippedCheck,
  skipReason,
  type VerifyHooks,
  outcomeOf,
} from './verifyLoop'
import { parseRunChecks, thenRunOf } from './verifyTools'
import { checkCommandLine, checkTimeoutMs } from '../../verify/checkCommands'
import { isCodeLoading } from '../../verify/codeFiles'
import {
  DiagnosticsHistory,
  type EditedFile,
  type FileDiagnostics,
  type PendingReport,
} from '../../verify/diagnosticsReport'

/** Paid state and usage are injected by the host, never read from workspace settings. */
export interface ModelApiPaidHooks {
  /** Whether a paid feature is on: its machine setting and accepted price. */
  readonly isPaidFeatureOn: (feature: PaidFeature) => boolean
  /** Counts attempts and extra-feature uses for the window. */
  readonly notePaidUse: (feature: PaidFeature, units: number) => void
  /**
   * The popup before a paid use (M58, PLAN.md D48): true when it is allowed
   * always in this workspace or allowed now. `requiresAsking` asks even then.
   * `sessionId` is the conversation the use is for (a child task's parent),
   * so a host serving several conversations to one client, as the ACP
   * agent's does (D62), asks in the right one.
   */
  readonly allowsPaidUse: (
    request: PaidUseRequest,
    requiresAsking: boolean,
    sessionId: string,
  ) => Promise<boolean>
  /** Whether the feature is allowed always in this workspace, asking nothing. */
  readonly isPaidUseRemembered: (feature: PaidFeature) => boolean
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
  /** Whether a paid feature is on (M33–M35, PLAN.md D30): its setting, and its price accepted. */
  readonly isPaidFeatureOn: (feature: PaidFeature) => boolean
  /** Counts paid uses for the window's tally: searches made, images returned. */
  readonly notePaidUse: (feature: PaidFeature, units: number) => void
  /** `museSpark.modelApiPromptCacheRetention`, read per request (M56, PLAN.md D43). */
  readonly promptCacheRetention: () => PromptCacheRetention
  /** A smaller replay cap for focused media-budget verification. */
  readonly mediaBudgetMaxEncodedChars?: number
  /** Extension-owned, workspace-local schedules; absent without workspace storage. */
  readonly scheduleStore?: ScheduleStore | undefined
  /** SHA-256 digest of the current SecretStorage key, never its plaintext. */
  readonly getAccountId: () => Promise<string | undefined>
  /** A fresh snapshot at each session start (M51); disabled means empty. */
  readonly loadHooks?: () => Promise<readonly HookDefinition[]>
  /** Machine hook opt-in is checked again for every dispatch. */
  readonly isHooksEnabled?: (() => boolean) | undefined
  /** Tests can shorten the six-second Notification delay without waiting. */
  readonly hookNotificationDelayMs?: number | undefined
  /** The MCP servers of Muse Code's settings (M50, PLAN.md D42), closed with the host. */
  readonly mcpServers?: McpToolSource | undefined
  /**
   * The extension's own IDE tools (`getDiagnostics`), offered in process as
   * `mcp__ide__<tool>`, the names Muse Code sessions see them by (M50).
   */
  readonly ideTools?: readonly McpTool[] | undefined
  /**
   * Muse Code's memory (M49, PLAN.md D41): the memory tools and the
   * session-start snapshot; undefined leaves them out.
   */
  readonly memory: MemoryStore | undefined
  /**
   * The verify loop (M68, PLAN.md D49): the settings and the editor's
   * diagnostics and formatter; undefined leaves it out.
   */
  readonly verify?: VerifyHooks | undefined
  /** Process/window-owned notices; tests constructing a host directly may leave this out. */
  readonly workspaceEdits?: WorkspaceEdits | undefined
  /** An alias's persisted/displayed workspace identity; runtime tool paths stay canonical. */
  readonly sessionWorkspaceRoot?: string | undefined
  /**
   * The window's web fetch (M69, PLAN.md D49): resolved, checked and pinned
   * in the activation bundle; undefined leaves `web_fetch` out.
   */
  readonly webFetch?: WebFetcher | undefined
  /**
   * VS Code's language services (M67, PLAN.md D49): the code intelligence
   * tools; undefined leaves them out.
   */
  readonly codeIntel?: LanguageServiceHost | undefined
  /** `museSpark.modelApiRepoMap`, read per turn: the repo map in the system prompt (M67). */
  readonly isRepoMapInPrompt?: (() => boolean) | undefined
}

const NO_ENVIRONMENT: EnvironmentFacts = { git: undefined }

/** A request before its prompt-cache fields are added (M56). */
type UnkeyedBody = Omit<CreateResponseBody, 'prompt_cache_key' | 'prompt_cache_retention'>

interface ReplayItem {
  readonly turnId: string
  readonly item: InputItem
  readonly userMessageId?: string
  /** The background task whose terminal context this note carries (M46). */
  readonly backgroundTaskId?: string
}

/** A tool-read file until a completed model request has actually carried its media part. */
interface PendingReadFile {
  readonly path: string
  readonly lead: InputContentPart
  readonly media: InputContentPart
  readonly encodedChars: number
  readonly slots: number
}

type FunctionImagePart = Extract<FunctionOutputPart, { readonly type: 'input_image' }>

function turnMediaEncodedChars(part: ImagePart | DocumentPart): number {
  return BASE64_DATA_URL_OVERHEAD_CHARS + part.mediaType.length + part.base64Data.length
}

function turnMediaSlots(part: ImagePart | DocumentPart): number {
  return part.type === 'image'
    ? 1
    : Math.min(part.pageCount ?? MODEL_API_PDF_PAGE_IMAGES, MODEL_API_PDF_PAGE_IMAGES)
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
  /**
   * Whether the task may search the web (M58): the parent turn's answer to
   * the web search popup, or for a task the user starts, the feature allowed
   * always in this workspace. A child never asks for itself.
   */
  readonly isWebSearchAllowed: boolean
}

interface QueuedTurn {
  readonly turnId: string
  readonly parts: readonly TurnPart[]
  readonly displayText: string | undefined
  readonly userMessageId?: string
  /** In memory only: the model and key identity accepted for a scheduled run. */
  readonly confirmedRequest?: ConfirmedModelRequest
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
  readonly confirmedRequest?: ConfirmedModelRequest
  /** Steered input, appended before the next model call. */
  readonly steered: { readonly parts: readonly TurnPart[]; readonly userMessageId: string }[]
  /** Named text accepted for this turn, including steers already drained into replay. */
  acceptedTextAttachmentBytes: number
  modelFailure?: unknown
  /** A goal accepted after the current model request began needs another round. */
  goalWakePending: boolean
  /** The prompt's answer to the web search popup (M58); false until it is asked. */
  isWebSearchAllowed: boolean
}

interface HookToolResult {
  readonly record: Readonly<Record<string, unknown>>
  readonly stopReason: string | undefined
}

interface StreamedCall {
  readonly calls: readonly FunctionCallItem[]
  readonly goalCommandRevision: number
  readonly postContexts: readonly string[]
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
  /**
   * What the hooks of the shell commands a call ran (then_run, run_checks,
   * M68) add: replayed after the call's output, a stop ending the turn.
   */
  readonly hookEffects?: HookEffects
}

/** What a check covers: the files passed to it, or the whole project (M68). */
function checkScope(check: CheckCommandSetting, files: readonly EditedFile[]): CheckScope {
  return check.changedFiles === true && files.length > 0 ? files : 'project'
}

/** What the user's tool hooks said about the commands a step ran (M68). */
interface HookEffects {
  readonly contexts: string[]
  readonly messages: string[]
  stopReason: string | undefined
}

function newHookEffects(): HookEffects {
  return { contexts: [], messages: [], stopReason: undefined }
}

/** A check or then_run command, before its hooks and its permission path (M68). */
interface VerifyCommand {
  readonly line: string
  /** What "always allow in this session" is keyed on. */
  readonly ruleCommand: string
  readonly description: string
  readonly timeoutMs: number
  /** A hook demanded a question for the call that carries it. */
  readonly isForced: boolean
  /** then_run's: the file still holds what the edit left. */
  readonly guard?: () => Promise<boolean>
}

type CommandOutcome =
  | { readonly kind: 'skipped'; readonly skip: CheckSkip; readonly detail?: string }
  | { readonly kind: 'ran'; readonly line: string; readonly result: ShellResult }

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
  readonly deniedByHook?: boolean
}

/** A call's outcome, and whether the mode or the user refused it. */
interface CallResult {
  readonly outcome: ToolOutcome
  readonly isRejected: boolean
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
// A replayed picture (`contentPartsFor`): `data:<media type>;base64,<data>`.
const DATA_URL = /^data:([^;,]+);base64,(.+)$/s
const MODEL_API_ERROR_KIND = 'modelApi'
const TURN_NOT_RUNNING = 'the turn is not running'

/** Re-read mutable abort state after awaits and between returned calls. */
function isAbortRequested(signal: AbortSignal): boolean {
  return signal.aborted
}
const TURN_RUNNING = 'a turn is running'
// The description a `then_run` command's card and hooks see (M68).
const THEN_RUN_DESCRIPTION = 'then_run: the command an edit runs right after it'
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
// A verify report whose diagnostics could not be read moves no history (M68).
const NOTHING_TO_COMMIT = (): undefined => undefined
// A child is recorded inside its parent, not in the host's session map.
const NO_CHILD_DISPOSAL = (): undefined => undefined

/**
 * A replay with a call still waiting for its output cannot be replayed
 * after a crash — neither the parent's nor, nested in its snapshot, a
 * child's (the review of PR #35).
 */
function hasUnansweredCall(replay: readonly StoredReplayItem[]): boolean {
  const answered = new Set(
    replay.flatMap((entry) =>
      entry.item.type === 'function_call_output' ? [entry.item.call_id] : [],
    ),
  )
  return replay.some(
    (entry) => entry.item.type === 'function_call' && !answered.has(entry.item.call_id),
  )
}

function hasUnansweredSessionCall(snapshot: StoredSession): boolean {
  return (
    hasUnansweredCall(snapshot.replay) ||
    (snapshot.children ?? []).some((child) => hasUnansweredCall(child.session.replay))
  )
}

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

class HookStoppedError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'HookStoppedError'
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

/** A web fetch that did not happen: the model's reason, the row's in the user's language. */
function webFetchRefusal(failure: WebFetchFailure): ToolOutcome {
  return {
    output: `Error: ${failure.reason}`,
    visibleOutput: failure.visibleReason,
    failureReason: failure.visibleReason,
  }
}

/** A web fetch refused in Restricted Mode: the model's reason, the row's in the user's language. */
function webFetchRestricted(): CallResult {
  return {
    outcome: {
      output: `Error: ${MODEL_TEXT.webFetchRestrictedMode}`,
      visibleOutput: UI_TEXT.webFetchRestrictedMode,
      failureReason: UI_TEXT.webFetchRestrictedMode,
    },
    isRejected: true,
  }
}

/** What the model and the row receive for a web fetch (M69). */
function webFetchOutcome(result: WebFetchResult): ToolOutcome {
  return result.kind === 'failed'
    ? webFetchRefusal(result.failure)
    : {
        output: result.text,
        visibleOutput: result.kind === 'moved' ? result.visibleText : result.text,
      }
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

/** A refused tool call, with the user's answer when they gave one. */
function refusedOutcome(
  call: FunctionCallItem,
  feedback: string | undefined,
  isDeniedByHook = false,
): ToolOutcome {
  const reason = `${call.name} ${isDeniedByHook ? MODEL_TEXT.toolRejectedByHook : MODEL_TEXT.toolRejectedByUser}`
  const withFeedback = feedback === undefined ? '' : `\nUser: ${feedback}`
  return {
    output: `Error: ${reason}${withFeedback}`,
    visibleOutput: reason,
    failureReason: reason,
  }
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

/** An image or a PDF as Meta reads it: inline, as a data URL (M54 for the PDF). */
function mediaPartFor(part: ImagePart | DocumentPart): InputContentPart {
  const dataUrl = `data:${part.mediaType};base64,${part.base64Data}`
  return part.type === 'image'
    ? { type: 'input_image', image_url: dataUrl, detail: 'auto' }
    : { type: 'input_file', filename: part.name, file_data: dataUrl }
}

/** What the user card lists for a message's images and PDFs (no bytes). */
function attachmentsOf(parts: readonly TurnPart[]): NonNullable<ItemSnapshot['attachments']> {
  return parts.flatMap((part): NonNullable<ItemSnapshot['attachments']> => {
    switch (part.type) {
      case 'image': {
        return [
          { type: 'image', mediaType: part.mediaType, width: part.width, height: part.height },
        ]
      }
      case 'file':
      case 'textFile': {
        return [
          {
            type: 'file',
            mediaType: part.mediaType,
            name: part.name,
            sizeBytes: part.sizeBytes,
            ...(part.type === 'file' &&
              part.pageCount !== undefined && { pageCount: part.pageCount }),
          },
        ]
      }
      default: {
        return []
      }
    }
  })
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
      case 'textFile': {
        return { type: 'input_text', text: textFileInput(part) }
      }
      case 'image':
      case 'file': {
        return mediaPartFor(part)
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

/** Model-facing named text, including its file-name wrapper. */
function textAttachmentBytes(parts: readonly TurnPart[]): number {
  let bytes = 0
  for (const part of parts) {
    if (part.type !== 'textFile') {
      continue
    }
    bytes += Buffer.byteLength(textFileInput(part))
  }
  return bytes
}

/** Reject an aggregate named-text payload before it can enter replay or an HTTP request. */
function textAttachmentBudgetError(bytes: number): Error | undefined {
  return bytes > MAX_MODEL_API_TEXT_ATTACHMENT_BYTES
    ? new Error(UI_TEXT.textFilesOverModelApiBudget)
    : undefined
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
        case 'image':
        case 'file':
        case 'textFile': {
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
 * The paid feature a tool call bills (M34): its row is marked paid, and the
 * paid-use popup asks before it (M58). Undefined for every free tool.
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

/**
 * A tool that is not one of the harness's own (M50): the extension's IDE
 * tool, run in process, or an MCP server's.
 */
type ExternalTool =
  | { readonly kind: 'ide'; readonly tool: McpTool }
  | { readonly kind: 'mcp'; readonly ref: McpToolRef }

/** The IDE tool's function name: `mcp__ide__<tool>`, as Muse Code sessions call it. */
function ideFunctionName(tool: McpTool): string {
  return mcpFunctionName(IDE_MCP_SERVER_NAME, tool.name, new Set())
}

function clipOutput(text: string): string {
  return text.length > TOOL_OUTPUT_MAX_CHARS
    ? `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}${TOOL_OUTPUT_CLIP_MARKER}`
    : text
}

/** What the MCP servers' state says to the user, each keyed so it is said once per session. */
function mcpNotices(snapshot: McpPoolSnapshot): readonly { key: string; text: string }[] {
  const { fault } = snapshot
  if (fault !== undefined) {
    switch (fault.kind) {
      case 'keys': {
        return [{ key: 'fault:keys', text: UI_TEXT.mcpNoServersKeys }]
      }
      case 'mode': {
        const servers = fault.servers.join(', ')
        return [{ key: `fault:mode:${servers}`, text: fill(UI_TEXT.mcpNoServersMode, { servers }) }]
      }
      case 'unreadable': {
        return [
          {
            key: `fault:unreadable:${fault.reason}`,
            text: fill(UI_TEXT.mcpNoServersUnreadable, { reason: fault.reason }),
          },
        ]
      }
    }
  }
  // A required server's failure fails the turn and says why there.
  return snapshot.servers.flatMap((server) =>
    server.state.status === 'failed' && !server.isRequired
      ? [
          {
            key: `server:${server.name}:${server.state.reason}`,
            text: fill(UI_TEXT.mcpServerUnavailable, {
              name: server.name,
              reason: server.state.reason,
            }),
          },
        ]
      : [],
  )
}

/**
 * What the approval card is about, in the MSP subject vocabulary. A paid
 * call never gets a card: the paid-use popup asks instead (M58).
 */
function subjectFor(
  call: FunctionCallItem,
  platform: NodeJS.Platform,
  isExternal: boolean,
): ApprovalSubject {
  const args = argumentsOf(call)
  if (call.name === shellToolFor(platform).name) {
    return { kind: 'shell', command: pick(args, 'command') ?? call.arguments }
  }
  // An MCP tool is a tool, whatever its arguments say: never a `fileWrite`,
  // which Edit automatically would answer by itself (D24).
  if (isExternal) {
    return { kind: 'tool', toolName: call.name }
  }
  const path = pick(args, 'path')
  return path === undefined
    ? { kind: 'tool', toolName: call.name }
    : { kind: 'fileWrite', path, toolName: call.name }
}

/** `work`'s value, or an `AbortedError` as soon as the turn is stopped; `work` runs on. */
async function unlessStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new AbortedError()
  }
  let onAbort: () => void = NO_UNSUBSCRIBE
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new AbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, stopped])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
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
  /** The real last turn summarized by an accepted compaction, not inferred from replay gaps. */
  private compactedThroughTurnId: string | undefined
  private readonly outputs = new Map<string, string>()
  private readonly permissions: PermissionEngine
  /** The rules, skills and memory of the workspace (PLAN.md D13). */
  private readonly context: WorkspaceContext
  /** The git facts of the prompt's environment section (D15), read on the first turn. */
  private environment: EnvironmentFacts | undefined
  /**
   * The repo map of the prompt (M67), made on a turn that has it on and kept
   * for the session once it has text, so the prompt's prefix stays the same.
   * A try that failed or came out empty is not kept; a few are made, on
   * later turns, before the session goes without.
   */
  private repoMapText: string | undefined
  private repoMapTries = 0
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
  private hookStarted = false
  private hookEnded = false
  private readonly pendingHookContexts: string[] = []
  private readonly pendingHookMessages: string[] = []
  private hookStartStopReason: string | undefined
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
      !(grant.isWebSearchAllowed && this.deps.isPaidFeatureOn('webSearch'))
    ) {
      throw new ChildTaskRefusedError('webSearchOff')
    }
    grant.remainingAttempts -= 1
    this.deps.notePaidUse('subagents', 1)
  }
  private active: ActiveTurn | undefined
  /** Each file as the model last read or wrote it, for `write_file`'s check (D27). */
  private readonly seenFiles = new Map<string, string>()
  /** Each edited file's diagnostics at its last check, to say what changed (M68). */
  private readonly diagnosticsHistory = new DiagnosticsHistory()
  /** The verify loop's record since the user's last input (M68; `verifyLedger.ts`). */
  private readonly ledger = new VerifyLedger()
  /** Rename plans made for a call's PreToolUse hooks, which the call then writes (M67). */
  private readonly hookRenamePlans = new WeakMap<FunctionCallItem, Promise<RenamePlanResult>>()
  /** Keeps each request within the page and encoded-media budgets (M54, PLAN.md D47). */
  private readonly budget: MediaBudget
  private mediaNoticeSent = false
  /**
   * The PDFs and images `read_file` read this round (M54): they follow the
   * round's outputs in a user message, where Meta reads them.
   */
  private readonly readFiles: VisibleFile[] = []
  /** Synthetic tool-read media still waiting for a completed model request. */
  private readonly readFileMessages = new WeakMap<ReplayItem, readonly PendingReadFile[]>()
  /** Function-output images awaiting their first completed model request. */
  private readonly pendingOutputMedia = new Map<ReplayItem, readonly FunctionImagePart[]>()
  /** The MCP notices this session has shown (M50): each is said once. */
  private readonly announcedMcp = new Set<string>()
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
  private scheduleTimer: ReturnType<typeof setInterval> | undefined
  private usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  private firstPrompt: string | undefined
  private isDisposed = false
  /** The surfaces holding this session: closing one must not cancel another's turn. */
  private holders = 1
  public readonly schedules?: {
    create: (cadence: ScheduleCadence, prompt: string) => Promise<ScheduledPrompt>
    list: () => Promise<readonly ScheduledPrompt[]>
    cancel: (id: string) => Promise<boolean>
    run: (
      id: string,
      occurrenceMs: number,
      confirmed: ScheduleRunConfirmation,
    ) => Promise<TurnSubmission>
  }
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
    private readonly onPersisted: () => Promise<void>,
    private readonly onDispose: () => void,
    private readonly isSubagent = false,
    private readonly parentSession?: ModelApiSession,
    private readonly childSubagentId?: string,
    private readonly hooks: readonly HookDefinition[] = [],
    private readonly hookStartSource: 'startup' | 'resume' | 'fork' = 'startup',
    private readonly isSideChat = false,
    private readonly workspaceEdits = new WorkspaceEdits(),
  ) {
    this.workspaceEdits.add(this.ledger)
    this.modelId = modelId
    this.permissions = new PermissionEngine(approvalMode)
    this.budget = new MediaBudget(deps.mediaBudgetMaxEncodedChars)
    const { memory } = deps
    this.context = new WorkspaceContext({
      io: deps.contextIo,
      workspaceRoot: deps.workspaceRoot,
      platform: deps.platform,
      personalSkillsRoot: deps.personalSkillsRoot,
      isWorkspaceTrusted: deps.isWorkspaceTrusted,
      loadMemory: memory === undefined ? undefined : () => memory.snapshot(),
      warn: (message) => {
        deps.log.warn(`Workspace context: ${message}`)
      },
    })
    this.createdAt = new Date(deps.now()).toISOString()
    this.lastActivityAt = this.createdAt
    if (deps.store !== undefined && deps.scheduleStore !== undefined) {
      this.schedules = {
        create: (cadence, prompt) => this.createSchedule(cadence, prompt),
        list: () => this.listSchedules(),
        cancel: (id) => this.cancelSchedule(id),
        run: (id, occurrenceMs, confirmed) => this.runSchedule(id, occurrenceMs, confirmed),
      }
    }
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

  private hookPayload(
    event: HookEvent,
    turnId: string | undefined,
    fields: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>> {
    return {
      hook_event_name: event,
      session_id: this.sessionId,
      ...(turnId !== undefined && { turn_id: turnId }),
      cwd: this.deps.workspaceRoot,
      transcript_path: null,
      model: this.modelId,
      model_provider: 'meta',
      permission_mode: this.permissions.currentMode,
      ...fields,
    }
  }

  private appendHookContexts(turnId: string, contexts: readonly string[]): void {
    for (const context of contexts) {
      this.replay.push({
        turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: context }],
        },
      })
    }
  }

  /** The hooks that run for this session: none in a side chat or with the opt-in off (M51). */
  private enabledHooks(): readonly HookDefinition[] {
    return this.isSideChat || this.deps.isHooksEnabled?.() === false ? [] : this.hooks
  }

  /**
   * A call's arguments as its PreToolUse hooks see them. A rename also names
   * the files it would write (M67), planned only when a hook would run and
   * the mode allows the edit at all; the call then writes that same plan
   * (`decideAndRunRename`), so a hook never allows one set of files while
   * another is written.
   */
  private async preToolInput(
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const args = argumentsOf(call)
    const deps = this.codeIntelDeps()
    if (
      deps === undefined ||
      signal.aborted ||
      call.name !== CODE_INTEL_TOOLS.renameSymbol ||
      matchingHooks(this.enabledHooks(), 'PreToolUse', toolMatcherNames(call.name)).length === 0 ||
      this.verdictWithHook({ toolName: call.name, toolClass: 'edit' }, false) === 'deny'
    ) {
      return toolHookInput(args)
    }
    const planning = planRenameCall(call.arguments, deps)
    this.hookRenamePlans.set(call, planning)
    try {
      const planned = await unlessStopped(planning, signal)
      return toolHookInput(planned.ok ? { ...args, files: renameHookFiles(planned.plan) } : args)
    } catch {
      // A Stop, or the provider's own refusal: the call itself then ends with
      // its row and its output (a Stop's included), which a throw from here,
      // before the row exists, would leave without one (D26).
      return toolHookInput(args)
    }
  }

  private async runHooks(
    event: HookEvent,
    turnId: string | undefined,
    fields: Readonly<Record<string, unknown>>,
    matcher: string | readonly string[] | undefined,
    signal: AbortSignal | undefined,
    shouldReplayContext = true,
    shouldShowMessages = true,
  ): Promise<HookDispatch> {
    const result = await dispatchHooks(
      this.enabledHooks(),
      event,
      this.hookPayload(event, turnId, fields),
      matcher,
      this.deps.io,
      signal,
      (warning) => {
        this.deps.log.warn(`Model API hooks: ${warning}`)
      },
    )
    if (shouldShowMessages) {
      for (const message of result.messages) {
        this.emit({ type: 'backendNotice', level: 'info', text: message })
      }
    }
    if (turnId !== undefined && shouldReplayContext) {
      this.appendHookContexts(turnId, result.contexts)
    }
    return result
  }

  /** Pre-call veto and context use the same boundary for turns and compaction. */
  private async beforeModelCall(
    turnId: string,
    body: CreateResponseBody,
    requestId: string,
    attempt: number,
    step: number,
    signal: AbortSignal,
  ): Promise<void> {
    const pre = await this.runHooks(
      'PreLLMCall',
      turnId,
      preModelCallFields(body, requestId, attempt, step),
      MODEL_API_HOOK_PROVIDER,
      signal,
      false,
    )
    if (pre.blockedReason !== undefined) {
      throw new HookStoppedError(pre.blockedReason)
    }
    this.appendHookContexts(turnId, pre.contexts)
  }

  private async collectStartHooks(
    source: 'startup' | 'resume' | 'fork' | 'compact',
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const start = await this.runHooks(
      'SessionStart',
      undefined,
      { source },
      source,
      signal,
      false,
      false,
    )
    this.pendingHookContexts.push(...start.contexts)
    this.pendingHookMessages.push(...start.messages)
    if (source === 'compact') {
      // Manual compaction has no running turn to stop. The next user turn is
      // unrelated and must not inherit a veto from this completed operation.
      if (start.stopReason !== undefined) {
        this.pendingHookMessages.push(start.stopReason)
      }
    } else {
      this.hookStartStopReason = start.stopReason
    }
  }

  /** What the code intelligence tools work with (M67); undefined without language services. */
  private codeIntelDeps(): CodeIntelDeps | undefined {
    const { codeIntel } = this.deps
    return codeIntel === undefined
      ? undefined
      : {
          service: codeIntel,
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
          io: this.deps.io,
          now: this.deps.now,
        }
  }

  /**
   * Whether this request's prompt carries the repo map (M67): the setting
   * on, now, in a trusted workspace only, since the map repeats the
   * workspace's file paths and names in every request's instructions.
   */
  private isRepoMapOn(): boolean {
    return (
      this.deps.codeIntel !== undefined &&
      this.deps.isWorkspaceTrusted() &&
      this.deps.isRepoMapInPrompt?.() === true
    )
  }

  /** The map this session's prompt carries: a child's is its parent's, never one of its own. */
  private promptRepoMap(): string | undefined {
    if (!this.isRepoMapOn()) {
      return undefined
    }
    return this.isSubagent ? this.parentSession?.promptRepoMap() : this.repoMapText
  }

  /**
   * The repo map for the prompt (M67) while the setting is on. Never throws:
   * a map that cannot be made is logged and the prompt goes without it. Only
   * a map with text is kept; a try that failed or came out empty counts, and
   * after `REPO_MAP_PROMPT_TRIES` the session stops trying. A Stop ends the
   * lookups at once and does not count. A child task never builds one.
   */
  private async loadRepoMap(signal: AbortSignal): Promise<void> {
    const deps = this.codeIntelDeps()
    if (
      deps === undefined ||
      this.isSubagent ||
      this.repoMapText !== undefined ||
      this.repoMapTries >= REPO_MAP_PROMPT_TRIES ||
      !this.isRepoMapOn()
    ) {
      return
    }
    try {
      const text = await repoMapSection(deps, signal)
      if (!signal.aborted) {
        this.repoMapTries += 1
        this.repoMapText = text
      }
    } catch (error: unknown) {
      if (!signal.aborted) {
        this.repoMapTries += 1
      }
      this.deps.log.warn(`The repo map for the prompt could not be made: ${describe(error)}`)
    }
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

  /**
   * A request with its prompt-cache key and retention (M56, PLAN.md D43):
   * the key is computed from the request's own prefix, so a compaction,
   * which sends no tools, gets a key of its own.
   */
  private keyed(request: UnkeyedBody): CreateResponseBody {
    return {
      ...request,
      prompt_cache_key: promptCacheKey(request),
      prompt_cache_retention: this.deps.promptCacheRetention(),
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
    // Memory is the workspace context's (D13): offered in a trusted workspace only (D41).
    const hasMemory = hasShell && this.deps.memory !== undefined
    const context = this.context.sections()
    const goalSection = goalInstructions(this.goal, this.goalSteps)
    const repoMap = this.promptRepoMap()
    const input = this.budget.fit(this.replay.map((entry) => entry.item))
    if (this.budget.omitted && !this.mediaNoticeSent) {
      this.emit({ type: 'backendNotice', level: 'warning', text: UI_TEXT.olderMediaOmitted })
      this.mediaNoticeSent = true
    }
    return this.keyed({
      model: this.modelId,
      input,
      instructions: instructionsFor({
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        shellToolName: shell.name,
        shellName: shell.shellName,
        hasShell,
        hasMemory,
        hasWebFetch: this.isWebFetchOffered(hasShell),
        hasCodeIntel: this.deps.codeIntel !== undefined,
        today: new Date(this.deps.now()).toISOString().slice(0, ISO_DATE_LENGTH),
        environment: this.environment ?? NO_ENVIRONMENT,
        context,
        verify: {
          isDiagnosticsOn: this.deps.verify?.isDiagnosticsOn() === true,
          checks: this.checkCommands(),
        },
        ...(repoMap !== undefined && { repoMap }),
        // Pinned while the goal is active (M45, PLAN.md D38).
        ...(goalSection !== undefined && { goalSection }),
      }),
      tools: this.tools(hasShell, context.skills.length > 0, hasMemory),
      tool_choice: 'auto',
      reasoning: {
        effort: this.effort === THINKING_OFF_EFFORT ? MODEL_API_EFFORT_OFF : this.effort,
        summary: 'auto',
      },
      stream: true,
      store: false,
      include: this.includes(),
      max_output_tokens: MODEL_API_MAX_OUTPUT_TOKENS,
    })
  }

  /** Retain only what a completed request carried; History keeps its file chips separately. */
  private commitFittedReplay(
    requestReplay: readonly ReplayItem[],
    fittedInput: readonly InputItem[],
  ): boolean {
    if (requestReplay.length !== fittedInput.length) {
      this.deps.log.warn('Model API media fit changed replay length; durable replacement skipped')
      return false
    }
    let hasChanged = false
    for (const [index, entry] of requestReplay.entries()) {
      const fitted = fittedInput[index]
      if (fitted === undefined || fitted === entry.item) {
        continue
      }
      const currentIndex = this.replay.indexOf(entry)
      if (currentIndex === -1) {
        continue
      }
      this.replay[currentIndex] = { ...entry, item: fitted }
      // Any tracked media not sent was replaced by budget text, so it has no
      // bytes left for a later Stop to scrub from this replay entry.
      this.readFileMessages.delete(entry)
      hasChanged = true
    }
    return hasChanged
  }

  /** The user's check commands as they stand now (M68); none without the verify loop. */
  private checkCommands(): readonly CheckCommandSetting[] {
    return this.deps.verify?.checkCommands() ?? []
  }

  /** In-process, IDE, MCP and paid search tools offered to this request. */
  private tools(
    hasShell: boolean,
    hasSkills: boolean,
    hasMemory: boolean,
  ): readonly ToolDefinition[] {
    const own = toolDefinitions(this.deps.platform, {
      hasShell,
      hasSkills,
      hasImageGeneration: this.deps.isPaidFeatureOn('imageGeneration'),
      hasSubagents: !this.isSubagent && this.deps.isPaidFeatureOn('subagents'),
      isSubagent: this.isSubagent,
      hasMemory,
      checks: this.checkCommands(),
      // Trusted workspaces only, as the shell (M69).
      hasWebFetch: this.isWebFetchOffered(hasShell),
      hasCodeIntel: this.deps.codeIntel !== undefined,
    })
    const ide = (this.deps.ideTools ?? []).map(
      (tool) => mcpFunctionDefinition(ideFunctionName(tool), tool).definition,
    )
    const mcp = hasShell ? (this.deps.mcpServers?.definitions() ?? []) : []
    const offered = [...own, ...ide, ...mcp]
    return this.isWebSearchOffered() ? [...offered, { type: MODEL_API_WEB_SEARCH_TOOL }] : offered
  }

  /**
   * Web fetch (M69): in a trusted workspace (`hasShell`) with the window's
   * fetch, and not in a side chat, whose Plan mode refuses every fetch.
   */
  private isWebFetchOffered(hasShell: boolean): boolean {
    return hasShell && this.deps.webFetch !== undefined && !this.isSideChat
  }

  /**
   * Meta's search, billed per search, rides on the turn's requests only while
   * the feature is on and this prompt's popup allowed it (M58).
   */
  private isWebSearchOffered(): boolean {
    return this.active?.isWebSearchAllowed === true && this.deps.isPaidFeatureOn('webSearch')
  }

  /**
   * The web search popup, once per prompt before its first request (M58,
   * PLAN.md D48). Meta runs the searches inside the response, so the popup
   * cannot come before each search; Deny sends the prompt without the tool.
   * A child task never asks: its grant carries its parent's answer.
   */
  private async webSearchConsent(signal: AbortSignal): Promise<boolean> {
    if (!this.deps.isPaidFeatureOn('webSearch')) {
      return false
    }
    return this.isSubagent
      ? this.childTaskGrant?.isWebSearchAllowed === true
      : await unlessStopped(
          this.deps.allowsPaidUse({ feature: 'webSearch' }, false, this.askingSessionId),
          signal,
        )
  }

  /** The IDE tool or MCP server tool a function name is, when it is one (M50). */
  private externalTool(name: string): ExternalTool | undefined {
    const tool = this.deps.ideTools?.find((candidate) => ideFunctionName(candidate) === name)
    if (tool !== undefined) {
      return { kind: 'ide', tool }
    }
    const ref = this.deps.mcpServers?.find(name)
    return ref === undefined ? undefined : { kind: 'mcp', ref }
  }

  /**
   * The MCP servers, started (or already running) before the turn's first
   * request (M50): each new problem is said once as a notice, and a required
   * server that is not running fails the turn, as Muse Code aborts its run.
   */
  private async prepareMcp(signal: AbortSignal): Promise<void> {
    const servers = this.deps.mcpServers
    if (servers === undefined) {
      return
    }
    await unlessStopped(servers.start(), signal)
    const snapshot = servers.snapshot()
    for (const notice of mcpNotices(snapshot)) {
      if (this.announcedMcp.has(notice.key)) {
        continue
      }
      this.announcedMcp.add(notice.key)
      this.emit({ type: 'backendNotice', level: 'warning', text: notice.text })
    }
    const requiredFailure = this.requiredMcpFailure(snapshot)
    if (requiredFailure !== undefined) {
      throw requiredFailure
    }
  }

  private requiredMcpFailure(snapshot: McpPoolSnapshot | undefined): Error | undefined {
    const required = snapshot?.servers.find(
      (server) => server.isRequired && server.state.status === 'failed',
    )
    return required?.state.status === 'failed'
      ? new Error(
          fill(UI_TEXT.mcpRequiredFailed, { name: required.name, reason: required.state.reason }),
        )
      : undefined
  }

  /** Final synchronous check after key retrieval, before each response POST or retry. */
  private responseAttemptGuard(body: CreateResponseBody): ResponseAttemptGuard | undefined {
    if (this.deps.mcpServers === undefined && !this.isSubagent) {
      return undefined
    }
    return (keyDigest) => {
      const required = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
      if (required !== undefined) {
        throw required
      }
      if (this.isSubagent) {
        this.admitChildAttempt(keyDigest, body)
      }
    }
  }

  /** The encrypted reasoning always; the search results while search is offered, for the rows. */
  private includes(): readonly IncludeField[] {
    return this.isWebSearchOffered()
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
    reservedUserMessageId?: string,
  ): void {
    const itemId = reservedUserMessageId ?? this.deps.newId()
    this.replay.push({
      turnId,
      userMessageId: itemId,
      item: { type: 'message', role: 'user', content: this.contentParts(parts) },
    })
    const text = displayText ?? typedText(parts)
    this.firstPrompt ??= text
    const attachments = attachmentsOf(parts)
    this.recordTranscript(turnId, {
      itemId,
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
    step: number,
    confirmedRequest?: ConfirmedModelRequest,
  ): Promise<StreamedCall> {
    const budget: RetryBudget = { retriesUsed: 0 }
    for (;;) {
      const open = new Map<string, OpenItem>()
      try {
        return await this.streamAttempt(turnId, signal, open, budget, step, confirmedRequest)
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
    step: number,
    confirmedRequest?: ConfirmedModelRequest,
  ): Promise<StreamedCall> {
    const requestId = this.deps.newId()
    const attempt = budget.retriesUsed + 1
    await this.beforeModelCall(turnId, this.body(), requestId, attempt, step, signal)
    const requiredAfterPreHook = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
    if (requiredAfterPreHook !== undefined) {
      throw requiredAfterPreHook
    }
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
    const body = this.body()
    const requestReplay = [...this.replay]
    let final: ResponseObject | undefined
    const admitAttempt = this.responseAttemptGuard(body)
    const responseStream = this.deps.client.streamResponse(
      body,
      signal,
      onRetry,
      budget,
      admitAttempt,
      confirmedRequest,
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
    this.markReadFileMediaDelivered(turnId, body.input)
    const wasFitted = this.commitFittedReplay(requestReplay, body.input)
    this.markOutputMediaDelivered(requestReplay, body.input)
    const calls = this.adoptOutput(turnId, final, open, chargedGoalId)
    if (wasFitted) {
      this.touch()
    }
    const post = await this.runHooks(
      'PostLLMCall',
      turnId,
      postModelCallFields(body, final, requestId, attempt, step, this.sessionId),
      MODEL_API_HOOK_PROVIDER,
      signal,
      false,
    )
    const requiredAfterPostHook = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
    if (requiredAfterPostHook !== undefined) {
      this.skipCalls(turnId, calls, MODEL_TEXT.mcpRequiredUnavailable)
      throw requiredAfterPostHook
    }
    if (post.blockedReason !== undefined) {
      // Muse Code's isolated echo capture ended its run on a PostLLM block.
      // Stop here, pairing calls so a later session can still replay them.
      this.skipCalls(turnId, calls, post.blockedReason)
      throw new HookStoppedError(post.blockedReason)
    }
    return { calls, goalCommandRevision, postContexts: post.contexts }
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

  /**
   * The `Notification` hook for a question left waiting (M51): run once
   * after the delay unless the question is answered or the turn stops
   * first. Returns what ends the wait.
   */
  private notifyWhileAsking(call: FunctionCallItem, signal: AbortSignal): () => void {
    if (this.hooks.every((entry) => entry.event !== 'Notification')) {
      return NO_UNSUBSCRIBE
    }
    const notificationAbort = new AbortController()
    const onTurnAbort = () => {
      notificationAbort.abort()
    }
    signal.addEventListener('abort', onTurnAbort, { once: true })
    const notification = setTimeout(() => {
      void this.runHooks(
        'Notification',
        this.active?.turnId,
        {
          notification_type: 'permission_prompt',
          title: call.name,
          message: call.arguments,
        },
        'permission_prompt',
        notificationAbort.signal,
      ).catch((error: unknown) => {
        this.deps.log.warn(`Model API Notification hook failed: ${describe(error)}`)
      })
    }, this.deps.hookNotificationDelayMs ?? HOOK_NOTIFICATION_DELAY_MS)
    return () => {
      clearTimeout(notification)
      notificationAbort.abort()
      signal.removeEventListener('abort', onTurnAbort)
    }
  }

  /**
   * The user's decision on a call: an approval card, or for a paid call
   * (an image, a subagent task) the paid-use popup (M58, PLAN.md D48),
   * which asks in every mode unless the feature is allowed always in this
   * workspace. A hook's "allow" never answers for a protected write, a web
   * fetch (its URL can carry the conversation to the host; M69) or a paid
   * call; a hook may still deny them, and one that demands a question asks
   * even then.
   */
  private async askApproval(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    query: PermissionQuery,
    question: { readonly card: ApprovalSubject } | { readonly paid: PaidUseRequest },
    requiresUserApproval = false,
  ): Promise<ApprovalOutcome> {
    const hook = await this.runHooks(
      'PermissionRequest',
      this.active?.turnId,
      { tool_name: call.name, tool_input: toolHookInput(argumentsOf(call)) },
      toolMatcherNames(call.name),
      signal,
      false,
    )
    if (hook.blockedReason !== undefined) {
      return { isApproved: false, feedback: hook.blockedReason, deniedByHook: true }
    }
    if ('paid' in question) {
      const stopNotifying = this.notifyWhileAsking(call, signal)
      try {
        const isAllowed = await unlessStopped(
          this.deps.allowsPaidUse(question.paid, requiresUserApproval, this.askingSessionId),
          signal,
        )
        return { isApproved: isAllowed, feedback: undefined }
      } finally {
        stopNotifying()
      }
    }
    const isHookAllowEnough =
      !requiresUserApproval && query.isProtected !== true && query.toolClass !== 'network'
    if (isHookAllowEnough && hook.approvalDecision === 'allow') {
      return { isApproved: true, feedback: undefined }
    }
    const approvalId = this.deps.newId()
    const request: Extract<AgentEvent, { type: 'approvalRequested' }> = {
      type: 'approvalRequested',
      approvalId,
      itemId,
      toolName: call.name,
      rawArgs: call.arguments,
      requirementId: { approvalId, sourceIndex: 0 },
      subject: question.card,
      availableChoices: [...choicesFor(call.name, query.command)],
      isJudgeEscalated: requiresUserApproval,
      isProtectedWrite: query.isProtected === true,
    }
    let decision: ApprovalDecision
    const stopNotifying = this.notifyWhileAsking(call, signal)
    try {
      decision = await waitFor<ApprovalDecision>(signal, (pending) => {
        this.pendingApprovals.set(approvalId, pending)
        this.pendingApprovalEvents.set(approvalId, request)
        this.emit(request)
      })
    } finally {
      this.pendingApprovalEvents.delete(approvalId)
      this.pendingApprovals.delete(approvalId)
      stopNotifying()
    }
    const isOffered = request.availableChoices.some(
      (choice) => choice.choiceId === decision.choiceId,
    )
    if (isOffered && decision.choiceId === APPROVAL_CHOICE_IDS.allowSession) {
      this.permissions.allowForSession(query.toolName, query.command)
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
    let reply: QuestionReply
    try {
      // Pending before it is shown, as an approval card is: an answer given
      // as the card arrives must find it (the live sweep, 2026-09-27).
      reply = await waitFor<QuestionReply>(signal, (pending) => {
        this.pendingQuestions.set(userInputId, pending)
        this.emit({ type: 'questionRequested', userInputId, itemId, questions: [...questions] })
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
    const content = contentPartsFor(parts, (selector) => this.context.skill(selector))
    // The budget learns each PDF's pages from its attachment, not its bytes (M54).
    for (const [index, part] of parts.entries()) {
      const sent = content[index]
      if (part.type === 'file' && sent?.type === 'input_file') {
        this.budget.note(sent, part.pageCount)
      }
    }
    return content
  }

  /**
   * The PDFs and images `read_file` read this round, in one user message
   * after the round's outputs (M54, PLAN.md D47): Meta reads images only in
   * user messages (image-understanding), and a message there between two
   * of a response's outputs would split them.
   */
  private appendReadFiles(turnId: string, isRoundComplete: boolean): void {
    const files = this.readFiles.splice(0)
    if (files.length === 0) {
      return
    }
    const pending: PendingReadFile[] = []
    const content = files.flatMap((file): InputContentPart[] => {
      if (!isRoundComplete) {
        return [
          {
            type: 'input_text',
            text: fill(MODEL_TEXT.toolFileNotDelivered, { path: file.path }),
          },
        ]
      }
      const [sent] = this.contentParts([file.part])
      if (sent === undefined) {
        return []
      }
      const lead: InputContentPart = {
        type: 'input_text',
        text: fill(MODEL_TEXT.toolFileFollows, { path: file.path }),
      }
      pending.push({
        path: file.path,
        lead,
        media: sent,
        encodedChars: turnMediaEncodedChars(file.part),
        slots: turnMediaSlots(file.part),
      })
      return [lead, sent]
    })
    const replay: ReplayItem = { turnId, item: { type: 'message', role: 'user', content } }
    this.replay.push(replay)
    if (pending.length > 0) {
      this.readFileMessages.set(replay, pending)
    }
  }

  /** Only media present in a completed request has reached the model. */
  private markReadFileMediaDelivered(turnId: string, input: readonly InputItem[]): void {
    const sent = new Set(
      input.flatMap((item) =>
        item.type === 'message' && item.role === 'user' ? item.content : [],
      ),
    )
    for (const replay of this.replay) {
      if (replay.turnId !== turnId) {
        continue
      }
      const pending = this.readFileMessages.get(replay)
      if (pending === undefined) {
        continue
      }
      const remaining = pending.filter((file) => !sent.has(file.media))
      if (remaining.length === 0) {
        this.readFileMessages.delete(replay)
      } else {
        this.readFileMessages.set(replay, remaining)
      }
    }
  }

  /** A completed request delivers or durably omits pending function-output images. */
  private markOutputMediaDelivered(
    requestReplay: readonly ReplayItem[],
    input: readonly InputItem[],
  ): void {
    const sent = new Set(
      input.flatMap((item) =>
        item.type === 'function_call_output' && typeof item.output !== 'string' ? item.output : [],
      ),
    )
    for (const entry of requestReplay) {
      const pending = this.pendingOutputMedia.get(entry)
      if (pending === undefined) {
        continue
      }
      const remaining = pending.filter((part) => !sent.has(part))
      if (remaining.length === 0 || !this.replay.includes(entry)) {
        this.pendingOutputMedia.delete(entry)
      } else {
        this.pendingOutputMedia.set(entry, remaining)
      }
    }
  }

  /** A stopped or failed turn replaces only media no completed request carried. */
  private dropUndeliveredMedia(turnId: string): void {
    for (const [index, replay] of this.replay.entries()) {
      if (replay.turnId !== turnId || replay.item.type !== 'message') {
        continue
      }
      const pending = this.readFileMessages.get(replay)
      if (pending === undefined) {
        continue
      }
      const leads = new Map(pending.map((file) => [file.lead, file.path]))
      const media = new Set(pending.map((file) => file.media))
      const content = replay.item.content.flatMap((part): InputContentPart[] => {
        const filePath = leads.get(part)
        if (filePath !== undefined) {
          return [
            { type: 'input_text', text: fill(MODEL_TEXT.toolFileNotDelivered, { path: filePath }) },
          ]
        }
        return media.has(part) ? [] : [part]
      })
      this.replay[index] = {
        ...replay,
        item: {
          ...replay.item,
          content,
        },
      }
      this.readFileMessages.delete(replay)
    }
    for (const [replay, pending] of this.pendingOutputMedia) {
      if (replay.turnId !== turnId) {
        continue
      }
      const index = this.replay.indexOf(replay)
      if (
        index !== -1 &&
        replay.item.type === 'function_call_output' &&
        typeof replay.item.output !== 'string'
      ) {
        const media = new Set<FunctionOutputPart>(pending)
        const output = replay.item.output.map((part): FunctionOutputPart =>
          media.has(part)
            ? { type: 'input_text', text: MODEL_TEXT.toolOutputImageNotDelivered }
            : part,
        )
        this.replay[index] = { ...replay, item: { ...replay.item, output } }
      }
      this.pendingOutputMedia.delete(replay)
    }
  }

  /** Media awaiting the next request: tool outputs, read files and accepted steering. */
  private queuedMediaUsage(): { readonly chars: number; readonly slots: number } {
    let chars = 0
    let slots = 0
    for (const file of this.readFiles) {
      chars += turnMediaEncodedChars(file.part)
      slots += turnMediaSlots(file.part)
    }
    for (const replay of this.replay) {
      const pending = this.readFileMessages.get(replay) ?? []
      for (const file of pending) {
        chars += file.encodedChars
        slots += file.slots
      }
    }
    for (const images of this.pendingOutputMedia.values()) {
      for (const image of images) {
        chars += image.image_url.length
        slots += 1
      }
    }
    const steers = this.active?.steered ?? []
    for (const steer of steers) {
      for (const part of steer.parts) {
        if (part.type !== 'image' && part.type !== 'file') {
          continue
        }
        chars += turnMediaEncodedChars(part)
        slots += turnMediaSlots(part)
      }
    }
    return { chars, slots }
  }

  private canQueueMedia(chars: number, slots: number): boolean {
    const queued = this.queuedMediaUsage()
    const limit = this.deps.mediaBudgetMaxEncodedChars ?? MAX_ENCODED_MEDIA_CHARS
    return queued.chars + chars <= limit && queued.slots + slots <= MODEL_API_MEDIA_PER_REQUEST
  }

  /** Reserve all current-batch visual outputs before their tool row reports success. */
  private canQueueToolMedia(outcome: ToolOutcome): boolean {
    const newImages = outcome.outputParts?.filter((part) => part.type === 'input_image') ?? []
    const chars =
      (outcome.visibleFile === undefined ? 0 : turnMediaEncodedChars(outcome.visibleFile.part)) +
      newImages.reduce((total, image) => total + image.image_url.length, 0)
    const slots =
      (outcome.visibleFile === undefined ? 0 : turnMediaSlots(outcome.visibleFile.part)) +
      newImages.length
    return this.canQueueMedia(chars, slots)
  }

  private canQueueSteeredMedia(parts: readonly TurnPart[]): boolean {
    let chars = 0
    let slots = 0
    for (const part of parts) {
      if (part.type !== 'image' && part.type !== 'file') {
        continue
      }
      chars += turnMediaEncodedChars(part)
      slots += turnMediaSlots(part)
    }
    return slots === 0 || this.canQueueMedia(chars, slots)
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

  /** `generate_image` and `edit_image`, using the approved source bytes and destination. */
  private async makeImage(plan: ImagePlan, signal: AbortSignal): Promise<ToolOutcome> {
    for (const path of [plan.target, ...plan.sources]) {
      const current = await confineWorkspacePath(
        this.deps.workspaceRoot,
        path.absolute,
        this.deps.platform,
        this.deps.io,
      )
      if (!current.ok || current.checkedAbsolute !== path.checkedAbsolute) {
        return toolFailure(MODEL_TEXT.pathChangedAfterApproval)
      }
    }
    return await runImageCall(plan, {
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
  private async editTarget(
    call: FunctionCallItem,
  ): Promise<Awaited<ReturnType<typeof confineWorkspacePath>> | undefined> {
    const given = pick(argumentsOf(call), 'path')
    return given === undefined
      ? undefined
      : await confineWorkspacePath(this.deps.workspaceRoot, given, this.deps.platform, this.deps.io)
  }

  /** A tool that named a path may have entered a directory with its own rules file. */
  private async touchPath(call: FunctionCallItem): Promise<void> {
    const given = pick(argumentsOf(call), 'path')
    // A memory note's path is under its scope's root, not the workspace (M49).
    if (given === undefined || isMemoryTool(call.name)) {
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
    // Not `Promise.withResolvers`: VS Code 1.99 and 1.100 run Node 20 (PLAN.md M62).
    const moved = new Promise<undefined>((resolve) => {
      this.foregroundShells.set(itemId, () => {
        resolve(undefined)
      })
    })
    let finished: ToolOutcome | undefined
    try {
      finished = await Promise.race([running, moved])
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

  /** The IDE tool in process, or the MCP server's tool over its connection (M50). */
  private async performExternal(
    external: ExternalTool,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    if (external.kind === 'ide') {
      const text = clipOutput(await external.tool.call(argumentsOf(call), signal))
      return { output: text, visibleOutput: text }
    }
    const servers = this.deps.mcpServers
    if (servers === undefined) {
      return toolFailure(`${call.name} ${MODEL_TEXT.mcpToolUnavailable}`)
    }
    const outcome = await servers.call(call.name, call.arguments, signal)
    return {
      output: outcome.output,
      visibleOutput: outcome.visibleOutput,
      ...(outcome.outputParts !== undefined && { outputParts: outcome.outputParts }),
      ...(outcome.failureReason !== undefined && { failureReason: outcome.failureReason }),
    }
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
      isWebSearchAllowed:
        this.active?.isWebSearchAllowed ?? this.deps.isPaidUseRemembered('webSearch'),
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

  /** A user-owned follow-up or reopen gets the paid-use popup (M58). */
  private async confirmOwnerChildTask(
    child: ChildRecord,
    objective: string,
  ): Promise<ChildTaskGrant> {
    try {
      const grant = await this.prepareChildGrant()
      const isAccepted = await this.deps.allowsPaidUse(
        {
          feature: 'subagents',
          task: {
            role: child.role,
            objective,
            modelId: grant.modelId,
            attemptLimit: SUBAGENT_TASK_MAX_REQUESTS,
          },
        },
        false,
        this.askingSessionId,
      )
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
      this.isSideChat ? 'denyUnmatched' : this.permissions.currentMode,
      this.deps,
      () => {
        this.touch()
      },
      // A child snapshot lives in its parent's stored session.
      () => this.onPersisted(),
      NO_CHILD_DISPOSAL,
      true,
      this,
      id,
      this.hooks,
      'startup',
      this.isSideChat,
      this.workspaceEdits,
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
    approvedTarget?: { readonly absolute: string; readonly checkedAbsolute: string },
    approvedImagePlan?: ImagePlan,
  ): Promise<Performed> {
    const external = this.externalTool(call.name)
    if (external !== undefined) {
      return { outcome: await this.performExternal(external, call, signal) }
    }
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
        return {
          outcome:
            approvedImagePlan === undefined
              ? toolFailure(MODEL_TEXT.imageGenerationOff)
              : await this.makeImage(approvedImagePlan, signal),
        }
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
      case VERIFY_TOOLS.runChecks: {
        return await this.runChecksCall(itemId, call, signal)
      }
      default: {
        const intelTool = codeIntelToolOf(call.name)
        if (intelTool !== undefined && intelTool !== 'renameSymbol') {
          return { outcome: await this.readCode(intelTool, call, signal) }
        }
        const formatter = this.formatter()
        return {
          outcome: await executeTool(call.name, call.arguments, {
            workspaceRoot: this.deps.workspaceRoot,
            platform: this.deps.platform,
            io: this.deps.io,
            signal,
            seen: this.seenFiles,
            ...(approvedTarget !== undefined && { approvedTarget }),
            ...(formatter !== undefined && { formatter }),
          }),
        }
      }
    }
  }

  /**
   * Format on edit (M68), while it is on: the editor's formatter over what an
   * edit wrote. Never over a file the editor's tools run as code, and not at
   * all once the conversation wrote one since the user's message (the M68
   * review). A formatter that fails leaves the edit as written and is
   * logged; it never fails the edit.
   */
  private formatter(): EditFormatter | undefined {
    const verify = this.deps.verify
    if (verify?.isFormatOnEdit() !== true) {
      return undefined
    }
    const warn = (message: string) => {
      this.deps.log.warn(message)
    }
    return {
      format: async (target, text) => {
        if (
          this.ledger.codeFile !== undefined ||
          isCodeLoading(target.relative) ||
          isCodeLoading(target.canonical)
        ) {
          return
        }
        try {
          return await verify.formatAfterEdit(target.checkedAbsolute, text)
        } catch (error: unknown) {
          warn(`Format on edit failed; the edit stays as written: ${describe(error)}`)
          return
        }
      },
      warn,
    }
  }

  /** Whether the conversation edited, since the user's message, a file that decides what `command` runs. */
  private changesWhatRunsNow(command: string): boolean {
    return this.ledger.changesWhatRuns(command)
  }

  /**
   * Whether a command may run now, by the shell tool's own permission path
   * (M68, PLAN.md D49): never where the mode refuses a shell command, and
   * with the shell's approval card wherever a shell command would ask,
   * "always allow in this session" keyed on `ruleCommand` under the verify
   * loop's own key (`VERIFY_COMMAND_RULE_KEY`), apart from the shell tool's
   * rules. A hook that demanded a question (`isForced`) gets one; a
   * session rule does not answer once the conversation edited a file that
   * may decide what `ruleCommand` runs, judged on the command the rule is
   * keyed on, a hook's rewrite included (PR #54, fourth Codex round). A
   * hook's denial is told apart from the user's Reject, each with its words
   * (the M68 review). Undefined when it may run, else why not.
   */
  private async authorizeCommand(
    itemId: string,
    request: VerifyCommand,
    signal: AbortSignal,
  ): Promise<{ readonly skip: CheckSkip; readonly detail?: string } | undefined> {
    const shell = shellToolFor(this.deps.platform)
    // Keyed apart from the shell tool: a check's grant never answers for the
    // model's own shell call of the same command (PR #54, fourth Codex round).
    const query: PermissionQuery = {
      toolName: VERIFY_COMMAND_RULE_KEY,
      toolClass: 'shell',
      command: request.ruleCommand,
    }
    const permitted = this.changesWhatRunsNow(request.ruleCommand)
      ? verdictFor(this.permissions.currentMode, 'shell')
      : this.permissions.verdict(query)
    const verdict = permitted === 'allow' && request.isForced ? 'ask' : permitted
    if (verdict === 'deny') {
      return { skip: 'refused' }
    }
    if (verdict === 'allow') {
      return undefined
    }
    // The card and the PermissionRequest hook see it as the shell call it is.
    const call: FunctionCallItem = {
      type: 'function_call',
      call_id: this.deps.newId(),
      name: shell.name,
      arguments: JSON.stringify({ command: request.line, description: request.description }),
    }
    const approval = await this.askApproval(
      itemId,
      call,
      signal,
      query,
      { card: { kind: 'shell', command: request.line } },
      request.isForced,
    )
    if (approval.isApproved) {
      return undefined
    }
    return {
      skip: approval.deniedByHook === true ? 'hookDenied' : 'rejected',
      ...(approval.feedback !== undefined && { detail: approval.feedback }),
    }
  }

  /**
   * A check or then_run command by the shell tool's own path (M68, the M68
   * review): Restricted Mode refuses; the user's PreToolUse hooks see it as a
   * call of the shell tool and may block it, demand a question or rewrite
   * it; the permission path above; then_run's guard; the run; then the
   * PostToolUse or PostToolUseFailure hooks. What the hooks add for the
   * model, and a hook's stop, go into `effects` for the caller to place
   * after the output they follow.
   */
  private async runVerifyCommand(
    itemId: string,
    request: VerifyCommand,
    signal: AbortSignal,
    effects: HookEffects,
  ): Promise<CommandOutcome> {
    if (!this.deps.isWorkspaceTrusted()) {
      return { kind: 'skipped', skip: 'restricted' }
    }
    const shell = shellToolFor(this.deps.platform)
    const turnId = this.active?.turnId
    const toolUseId = this.deps.newId()
    const matcher = toolMatcherNames(shell.name)
    const pre = await this.runHooks(
      'PreToolUse',
      turnId,
      {
        tool_name: shell.name,
        tool_input: toolHookInput({ command: request.line, description: request.description }),
        tool_use_id: toolUseId,
      },
      matcher,
      signal,
      false,
    )
    effects.contexts.push(...pre.contexts)
    if (pre.blockedReason !== undefined) {
      return { kind: 'skipped', skip: 'hookDenied', detail: pre.blockedReason }
    }
    let { line, ruleCommand } = request
    if (pre.updatedInput !== undefined) {
      const updated = pre.updatedInput['command']
      if (typeof updated !== 'string' || updated.trim() === '') {
        return { kind: 'skipped', skip: 'hookDenied', detail: MODEL_TEXT.hookInputNoCommand }
      }
      line = updated
      ruleCommand = updated
    }
    const authorized: VerifyCommand = {
      ...request,
      line,
      ruleCommand,
      isForced: request.isForced || pre.forceApproval,
    }
    const refusal = await authorizeThenGuard({
      isRuleLapsed: () => this.changesWhatRunsNow(ruleCommand),
      authorize: () => this.authorizeCommand(itemId, authorized, signal),
      ...(request.guard !== undefined && { guard: request.guard }),
    })
    if (refusal !== undefined) {
      return { kind: 'skipped', ...refusal }
    }
    const startedAt = this.deps.now()
    const result = await this.runCommand(line, request.timeoutMs, signal)
    const ran = shellOutcome(result, request.timeoutMs)
    const input = toolHookInput({ command: line, description: request.description })
    const post = await this.runHooks(
      ran.failureReason === undefined ? 'PostToolUse' : 'PostToolUseFailure',
      turnId,
      ran.failureReason === undefined
        ? {
            tool_name: shell.name,
            tool_input: input,
            tool_use_id: toolUseId,
            tool_response: toolHookOutput(ran.output),
          }
        : {
            tool_name: shell.name,
            tool_input: input,
            tool_use_id: toolUseId,
            error: toolHookOutput(ran.failureReason),
            is_interrupt: false,
            duration_ms: this.deps.now() - startedAt,
          },
      matcher,
      signal,
      false,
    )
    effects.contexts.push(...post.contexts)
    if (post.stopReason !== undefined) {
      effects.stopReason ??= post.stopReason
    } else if (post.blockedReason !== undefined) {
      effects.messages.push(post.blockedReason)
    }
    return { kind: 'ran', line, result }
  }

  /**
   * One check: skipped when the fix loop stopped the checks or the user
   * rejected it since their message; its line (paths refused when they
   * cannot be passed safely), the files by the canonical names confinement
   * gave them; then the command's path above, a Reject remembered, and just
   * before it runs each file must still be where confinement found it (the
   * Codex review of PR #54). Its output takes `maxChars` of the note's
   * budget.
   */
  private async runCheck(
    itemId: string,
    check: CheckCommandSetting,
    files: readonly EditedFile[],
    signal: AbortSignal,
    effects: HookEffects,
    maxChars: number,
  ): Promise<CheckRun> {
    if (this.ledger.isStopped) {
      return skippedCheck(check, 'stopped')
    }
    if (this.ledger.isRejected(check.name)) {
      return skippedCheck(check, 'rejected')
    }
    const built = checkCommandLine(
      check,
      files.map((file) => file.relative),
      this.deps.platform,
    )
    if (!built.ok) {
      return skippedCheck(check, 'unsafePath')
    }
    const timeoutMs = checkTimeoutMs(check)
    // The state the check starts on: an edit made while it runs leaves it behind.
    const startedOn = this.ledger.snapshot(check.name, checkScope(check, files))
    const outcome = await this.runVerifyCommand(
      itemId,
      {
        line: built.line,
        ruleCommand: check.command,
        description: check.name,
        timeoutMs,
        isForced: false,
        ...(check.changedFiles === true &&
          files.length > 0 && { guard: () => this.areStillWhereConfined(files) }),
      },
      signal,
      effects,
    )
    if (outcome.kind === 'skipped') {
      if (outcome.skip === 'rejected') {
        this.ledger.reject(check.name)
      }
      return skippedCheck(check, outcome.skip, outcome.detail)
    }
    const run = finishedCheck(check, outcome.line, outcome.result, timeoutMs, maxChars)
    this.ledger.record(run.summary.outcome, startedOn)
    return run
  }

  /**
   * A check or `then_run` command, as the shell tool runs one (M68). A shell
   * that cannot start is a failed run the model is told about, as the user's
   * own `!` command is (M46), not the end of the turn.
   */
  private async runCommand(
    line: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<ShellResult> {
    try {
      return await this.deps.io.runShell(line, this.deps.workspaceRoot, timeoutMs, signal)
    } catch (error: unknown) {
      return {
        stdout: '',
        stderr: describe(error),
        exitCode: null,
        isTimedOut: false,
        isCancelled: false,
      }
    }
  }

  /**
   * The checks in order; a Stop ends the run, and a hook that ended the turn
   * (`continue: false`) ends it with what finished (the Codex review of PR
   * #54): the checks after it do not run.
   */
  private async runChecks(
    itemId: string,
    checks: readonly CheckCommandSetting[],
    files: readonly EditedFile[],
    signal: AbortSignal,
    effects: HookEffects,
    maxChars: number,
  ): Promise<readonly CheckRun[]> {
    const runs: CheckRun[] = []
    for (const check of checks) {
      if (isAbortRequested(signal)) {
        throw new AbortedError()
      }
      if (effects.stopReason !== undefined) {
        break
      }
      runs.push(await this.runCheck(itemId, check, files, signal, effects, maxChars))
    }
    return runs
  }

  /** The files that still exist: only those reach a check (the M68 review). */
  private async existingFiles(files: readonly EditedFile[]): Promise<readonly EditedFile[]> {
    const exists = await Promise.all(
      files.map(async (file) => {
        try {
          return await this.deps.io.pathExists(file.absolute)
        } catch (error: unknown) {
          this.deps.log.warn(`Verify: ${file.relative} could not be looked up: ${describe(error)}`)
          return false
        }
      }),
    )
    return files.filter((_file, index) => exists[index] === true)
  }

  /**
   * Whether each file's canonical name still leads to the real path
   * confinement gave it: a link or junction retargeted since, or a folder
   * swapped for one, would hand the check another file (the Codex review of
   * PR #54). Content may change (an earlier check may fix a file); the check
   * then reports on the file as it is.
   */
  private async areStillWhereConfined(files: readonly EditedFile[]): Promise<boolean> {
    const p = pathModule(this.deps.platform)
    try {
      const real = await Promise.all(
        files.map((file) => this.deps.io.realPath(p.join(this.deps.workspaceRoot, file.relative))),
      )
      return files.every((file, index) => real[index] === file.absolute)
    } catch (error: unknown) {
      this.deps.log.warn(`Verify: a checked file could not be resolved again: ${describe(error)}`)
      return false
    }
  }

  /**
   * `run_checks` (M68): the checks the model names (all of them by default)
   * over the files it names (each must exist in the workspace), or those
   * edited since the user's message, with the same ledger as the automatic
   * step: the fix loop's stop and the user's rejections hold, a Reject is
   * remembered, and each run is recorded against the state it ran on, so
   * the round judges it and does not run it again while it is current.
   */
  private async runChecksCall(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<Performed> {
    const configured = this.checkCommands()
    if (configured.length === 0) {
      return { outcome: toolFailure(MODEL_TEXT.runChecksNone) }
    }
    const parsed = parseRunChecks(call.arguments)
    if (!parsed.ok) {
      return { outcome: toolFailure(parsed.reason) }
    }
    const names = parsed.args.names ?? configured.map((check) => check.name)
    const unknown = names.find((name) => configured.every((check) => check.name !== name))
    if (unknown !== undefined) {
      return {
        outcome: toolFailure(
          fill(MODEL_TEXT.runChecksUnknown, {
            name: unknown,
            names: configured.map((check) => check.name).join(', '),
          }),
        ),
      }
    }
    const isEditedScope = parsed.args.paths === undefined
    const files: EditedFile[] = []
    if (isEditedScope) {
      files.push(...(await this.existingFiles(this.ledger.editedFiles())))
    } else {
      const named = parsed.args.paths ?? []
      for (const given of named) {
        const resolved = await confineWorkspacePath(
          this.deps.workspaceRoot,
          given,
          this.deps.platform,
          this.deps.io,
        )
        if (!resolved.ok) {
          return { outcome: toolFailure(resolved.reason) }
        }
        if (!(await this.deps.io.pathExists(resolved.checkedAbsolute))) {
          return {
            outcome: toolFailure(
              fill(MODEL_TEXT.runChecksMissingPath, { path: resolved.relative }),
            ),
          }
        }
        files.push({ relative: resolved.canonical, absolute: resolved.checkedAbsolute })
      }
    }
    const selected = configured.filter((check) => names.includes(check.name))
    const effects = newHookEffects()
    const share = Math.floor(VERIFY_NOTE_MAX_CHARS / Math.max(selected.length, 1))
    const runs = await this.runChecks(itemId, selected, files, signal, effects, share)
    const section = checksSection(runs)
    return {
      outcome: {
        output: `${MODEL_TEXT.runChecksLead}\n\n${section}`,
        visibleOutput: section,
        verifySummary: {
          files: files.map((file) => file.relative),
          checks: runs.map((run) => run.summary),
        },
      },
      hookEffects: effects,
    }
  }

  /**
   * The mode's verdict on a call, and the card when it asks: the refusal, or
   * undefined when the call may run.
   */
  private async judge(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    query: PermissionQuery,
    subject: ApprovalSubject,
    shouldForceApproval = false,
  ): Promise<CallResult | undefined> {
    const verdict = this.verdictWithHook(query, shouldForceApproval)
    if (verdict === 'deny') {
      return this.refusedByMode(call)
    }
    if (verdict === 'allow') {
      return undefined
    }
    const approval = await this.askApproval(
      itemId,
      call,
      signal,
      query,
      { card: subject },
      shouldForceApproval,
    )
    return approval.isApproved
      ? undefined
      : {
          outcome: refusedOutcome(call, approval.feedback, approval.deniedByHook === true),
          isRejected: true,
        }
  }

  /** A hook may add a card to an allow, never override a mode's denial. */
  private verdictWithHook(query: PermissionQuery, shouldForceApproval: boolean): PermissionVerdict {
    const permitted = this.permissions.verdict(query)
    return permitted === 'allow' && shouldForceApproval ? 'ask' : permitted
  }

  private refusedByMode(call: FunctionCallItem): CallResult {
    return {
      outcome: toolFailure(`${call.name} ${MODEL_TEXT.toolRefusedByMode}`),
      isRejected: true,
    }
  }

  /**
   * A memory call (M49, PLAN.md D41): its note placed before any card (a
   * refused path asks nothing); a write judged as an edit, never a
   * protected one, its card naming the note.
   */
  private async decideAndRunMemory(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    toolClass: ToolClass,
    shouldForceApproval: boolean,
  ): Promise<CallResult> {
    const { memory } = this.deps
    if (memory === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return { outcome: toolFailure(MODEL_TEXT.memoryRestrictedMode), isRejected: true }
    }
    const placed = await placeMemoryCall(memory, call.name, call.arguments)
    if (!placed.ok) {
      return { outcome: toolFailure(placed.reason), isRejected: false }
    }
    if (toolClass !== 'read' || shouldForceApproval) {
      const subject: ApprovalSubject =
        toolClass === 'read'
          ? { kind: 'tool', toolName: call.name }
          : { kind: 'fileWrite', path: placed.value.place.display, toolName: call.name }
      const refusal = await this.judge(
        itemId,
        call,
        signal,
        { toolName: call.name, toolClass, isProtected: false },
        subject,
        shouldForceApproval,
      )
      if (refusal !== undefined) {
        return refusal
      }
      // The card was open: a swapped directory would redirect the write, so
      // the note is located again after the approval (review of PR #36).
      const replaced = await placeMemoryCall(memory, call.name, call.arguments)
      return {
        outcome: replaced.ok
          ? await this.runPlacedMemoryCall(memory, replaced.value)
          : toolFailure(replaced.reason),
        isRejected: false,
      }
    }
    return { outcome: await this.runPlacedMemoryCall(memory, placed.value), isRejected: false }
  }

  /** Memory writes can change a check's named input, including a new note's index. */
  private async runPlacedMemoryCall(
    memory: MemoryStore,
    placed: PlacedMemoryCall,
  ): Promise<ToolOutcome> {
    if (placed.call.tool === 'read') {
      return await runMemoryCall(memory, placed)
    }
    const paths = [placed.place.absolute]
    if (placed.call.tool === 'add') {
      const index = await memory.locate(placed.place.scope, MEMORY_INDEX_FILE)
      if (index.ok) {
        paths.push(index.value.absolute)
      }
    }
    const completions: (() => void)[] = []
    try {
      for (const path of paths) {
        const target = await confineWorkspacePath(
          this.deps.workspaceRoot,
          path,
          this.deps.platform,
          this.deps.io,
        )
        if (target.ok) {
          completions.push(
            this.workspaceEdits.beginEdit(
              { relative: target.canonical, absolute: target.checkedAbsolute },
              [target.relative, target.canonical],
            ),
          )
        }
      }
      return await runMemoryCall(memory, placed)
    } finally {
      for (const complete of completions) {
        complete()
      }
    }
  }

  /**
   * A web fetch (M69, PLAN.md D49): refused in Restricted Mode, and for a
   * URL the fetch would refuse anyway, before any card; then judged as a
   * network tool per host, its card naming the URL as it will be fetched.
   * The fetch itself resolves, checks and pins every hop.
   */
  private async decideAndRunWebFetch(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    shouldForceApproval: boolean,
  ): Promise<CallResult> {
    const fetchPage = this.deps.webFetch
    if (fetchPage === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return webFetchRestricted()
    }
    const parsed = webFetchArgs.safeParse(argumentsOf(call))
    if (!parsed.success) {
      return { outcome: toolFailure('invalid arguments: url is required'), isRejected: false }
    }
    const checked = checkPageUrl(parsed.data.url)
    if (!checked.ok) {
      return { outcome: webFetchRefusal(checked.failure), isRejected: false }
    }
    const url = checked.url.href
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: 'network',
      command: approvalHost(checked.url),
    }
    const refusal = await this.judge(
      itemId,
      call,
      signal,
      query,
      { kind: WEB_FETCH_SUBJECT_KIND, target: url, toolName: call.name },
      shouldForceApproval,
    )
    if (refusal !== undefined) {
      return refusal
    }
    // The card or a hook was awaited: the turn may have stopped, the
    // workspace lost its trust, or the mode turned to one that refuses.
    const withdrawn = this.webFetchWithdrawn(call, query, signal)
    if (withdrawn !== undefined) {
      return withdrawn
    }
    const result = await fetchPage(url, signal, () => this.isWebFetchStillAllowed(query))
    // Asked again once the page is in: it reaches the model only while web
    // fetch is still allowed.
    return (
      this.webFetchWithdrawn(call, query, signal) ?? {
        outcome: webFetchOutcome(result),
        isRejected: false,
      }
    )
  }

  /** Whether what allowed a web fetch still holds: trust, and a mode that does not refuse it. */
  private isWebFetchStillAllowed(query: PermissionQuery): boolean {
    return this.deps.isWorkspaceTrusted() && this.permissions.verdict(query) !== 'deny'
  }

  /** The refusal for a web fetch no longer allowed after an await; throws when the turn stopped. */
  private webFetchWithdrawn(
    call: FunctionCallItem,
    query: PermissionQuery,
    signal: AbortSignal,
  ): CallResult | undefined {
    if (signal.aborted) {
      throw new AbortedError()
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return webFetchRestricted()
    }
    return this.permissions.verdict(query) === 'deny' ? this.refusedByMode(call) : undefined
  }

  /** A read-only code intelligence call (M67): a read in every mode, stopped by Stop. */
  private async readCode(
    tool: Exclude<CodeIntelTool, 'renameSymbol'>,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const deps = this.codeIntelDeps()
    return deps === undefined
      ? toolFailure(`unknown tool ${call.name}`)
      : await unlessStopped(runCodeIntelRead(tool, call.arguments, deps, signal), signal)
  }

  /**
   * `rename_symbol` (M67, PLAN.md D49): the edit planned and checked before
   * any card (a refused rename asks nothing), judged as an edit whose card
   * names its files (protected if any file is, D24), then written file by
   * file after every file is checked again.
   */
  private async decideAndRunRename(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    shouldForceApproval: boolean,
  ): Promise<CallResult> {
    const deps = this.codeIntelDeps()
    if (deps === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    // Plan refuses every edit: the language service is not even asked then.
    if (this.verdictWithHook({ toolName: call.name, toolClass: 'edit' }, false) === 'deny') {
      return this.refusedByMode(call)
    }
    // The plan the PreToolUse hooks were shown, if they were: it is the one
    // written, each file checked again for its content after the card. A
    // hook's new arguments are a new call object, planned afresh.
    const planning = this.hookRenamePlans.get(call) ?? planRenameCall(call.arguments, deps)
    this.hookRenamePlans.delete(call)
    const planned = await unlessStopped(planning, signal)
    if (!planned.ok) {
      return { outcome: renameRefused(planned), isRejected: false }
    }
    const { plan } = planned
    const refusal = await this.judge(
      itemId,
      call,
      signal,
      { toolName: call.name, toolClass: 'edit', isProtected: isProtectedRename(plan) },
      { kind: 'fileWrite', path: renameCardPath(plan), toolName: call.name },
      shouldForceApproval,
    )
    if (refusal !== undefined) {
      return refusal
    }
    // Every planned name lapses stale grants before the rechecks await I/O.
    // Only successful native writes enter this session's automatic check round.
    const completions: (() => void)[] = []
    try {
      for (const file of plan.files) {
        completions.push(
          this.workspaceEdits.beginEdit(
            { relative: file.canonical, absolute: file.checkedAbsolute },
            [file.relative, file.canonical],
          ),
        )
      }
      const outcome = await applyRename(plan, {
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        io: this.deps.io,
        seen: this.seenFiles,
        signal,
        onWritten: (file) => {
          this.noteEdited(file)
        },
      })
      return { outcome, isRejected: false }
    } finally {
      for (const complete of completions) {
        complete()
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
    shouldForceApproval = false,
  ): Promise<CallResult> {
    const external = this.externalTool(call.name)
    if (external !== undefined && this.isSideChat) {
      return {
        outcome: toolFailure(`${call.name} ${MODEL_TEXT.toolRefusedByMode}`),
        isRejected: true,
      }
    }
    // The IDE tool reads VS Code's Problems panel: a read, in every mode.
    let toolClass: ToolClass | undefined = classifyTool(call.name)
    if (external !== undefined) {
      toolClass = external.kind === 'ide' ? 'read' : 'mcp'
    }
    if (toolClass === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    if (isMemoryTool(call.name)) {
      return await this.decideAndRunMemory(itemId, call, signal, toolClass, shouldForceApproval)
    }
    if (toolClass === 'network') {
      return await this.decideAndRunWebFetch(itemId, call, signal, shouldForceApproval)
    }
    if (call.name === CODE_INTEL_TOOLS.renameSymbol) {
      return await this.decideAndRunRename(itemId, call, signal, shouldForceApproval)
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
    if ((toolClass === 'shell' || toolClass === 'mcp') && !this.deps.isWorkspaceTrusted()) {
      // Restricted Mode (PLAN.md D13): the tool is not offered, and a model
      // that calls it anyway is refused, never prompted.
      const reason =
        toolClass === 'mcp' ? MODEL_TEXT.mcpRestrictedMode : MODEL_TEXT.shellRestrictedMode
      return { outcome: toolFailure(reason), isRejected: true }
    }
    let approvedImagePlan: ImagePlan | undefined
    if (toolClass === 'paid') {
      const prepared = await this.imagePlan(call)
      if (!prepared.ok) {
        return { outcome: toolFailure(prepared.reason), isRejected: false }
      }
      approvedImagePlan = prepared.plan
    }
    const target = toolClass === 'edit' ? await this.editTarget(call) : undefined
    if (target?.ok === false) {
      // A path the tool would refuse anyway is refused before any card.
      return { outcome: toolFailure(target.reason), isRejected: false }
    }
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: childTask === undefined ? toolClass : 'spawn',
      command: toolClass === 'shell' ? pick(argumentsOf(call), 'command') : undefined,
      isProtected:
        target?.ok === true
          ? isProtectedPath(target.canonical)
          : approvedImagePlan !== undefined && isProtectedPath(approvedImagePlan.target.canonical),
      isReadOnly: external?.kind === 'mcp' && external.ref.isReadOnly,
    }
    const verdict = this.verdictWithHook(query, shouldForceApproval)
    if (verdict === 'deny') {
      return this.refusedByMode(call)
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
      let paid: PaidUseRequest | undefined
      if (childTask !== undefined) {
        paid = { feature: 'subagents', task: childTask }
      } else if (approvedImagePlan !== undefined) {
        paid = imageUseRequest(approvedImagePlan)
      }
      const approval = await this.askApproval(
        itemId,
        call,
        signal,
        query,
        paid === undefined
          ? { card: subjectFor(call, this.deps.platform, toolClass === 'mcp') }
          : { paid },
        // A protected write never happens without a question (D24), even
        // when its feature is allowed always.
        shouldForceApproval || (paid !== undefined && query.isProtected === true),
      )
      if (!approval.isApproved) {
        if (childTask !== undefined && approval.deniedByHook !== true) {
          return { outcome: childTaskFailure('consentDeclined'), isRejected: true }
        }
        return {
          outcome: refusedOutcome(call, approval.feedback, approval.deniedByHook === true),
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
    // Every live session hears the names before perform can write or format.
    // Completion advances their state again, including on a failed write.
    const completeEdit =
      target?.ok === true
        ? this.workspaceEdits.beginEdit(
            { relative: target.canonical, absolute: target.checkedAbsolute },
            [target.relative, target.canonical],
          )
        : undefined
    let performed: Performed
    try {
      performed = await this.perform(
        turnId,
        itemId,
        call,
        signal,
        goalCommandRevision,
        childGrant,
        target?.ok === true ? target : undefined,
        approvedImagePlan,
      )
    } finally {
      completeEdit?.()
    }
    if (target?.ok !== true) {
      return { ...performed, isRejected: false }
    }
    const isEdited =
      performed.outcome.patch !== undefined && performed.outcome.failureReason === undefined
    if (isEdited) {
      this.noteEdited(target)
    }
    const command = thenRunOf(call.arguments)
    if (command === undefined) {
      return { ...performed, isRejected: false }
    }
    if (!isEdited) {
      return {
        outcome: {
          ...performed.outcome,
          output: `${performed.outcome.output}\n${MODEL_TEXT.thenRunEditFailed}`,
        },
        isRejected: false,
      }
    }
    return {
      ...(await this.thenRun(
        itemId,
        target,
        command,
        performed.outcome,
        signal,
        shouldForceApproval,
      )),
      isRejected: false,
    }
  }

  /**
   * A file an edit tool wrote (M68): a new state of it in the ledger, checked
   * after this round, the runs on its earlier state no longer counting, and
   * remembered since the user's input.
   */
  private noteEdited(target: {
    readonly relative: string
    readonly absolute: string
    readonly canonical: string
    readonly checkedAbsolute: string
  }): void {
    // By the real path and canonical name confinement found at the edit, with
    // what the edit left: nothing later follows a link retargeted since, and
    // the editor reads the file only while it still holds that (the Codex
    // review of PR #54).
    const fingerprint = this.seenFiles.get(target.absolute)
    const file: EditedFile = {
      relative: target.canonical,
      absolute: target.checkedAbsolute,
      ...(fingerprint !== undefined && { fingerprint }),
    }
    this.ledger.noteEdit(file, [target.relative, target.canonical])
  }

  /**
   * A then_run that ran a configured check's own command, as the check itself
   * would run it, is a run of that check on the state the edit left (M68;
   * PR #54's reviews): it counts for the fix loop, and the round does not run
   * the check again. Not for a check that takes the changed files (the
   * then_run passed none). It ran under the shell's cap, not the check's: a
   * pass counts only when the check's cap is no shorter, a time-out only
   * when it is no longer (Grok's review); a failure is a failure either way.
   */
  private noteCheckCommandRun(
    line: string,
    result: ShellResult,
    startedOn: ReadonlyMap<string, RunSnapshot>,
  ): void {
    const outcome = outcomeOf(result)
    for (const check of this.checkCommands()) {
      const cap = checkTimeoutMs(check)
      const snapshot = startedOn.get(check.name)
      const isSameRun =
        snapshot !== undefined &&
        check.command === line.trim() &&
        check.changedFiles !== true &&
        (outcome !== 'passed' || cap >= SHELL_DEFAULT_TIMEOUT_MS) &&
        (outcome !== 'timedOut' || cap <= SHELL_DEFAULT_TIMEOUT_MS)
      if (isSameRun) {
        this.ledger.record(outcome, snapshot)
      }
    }
  }

  /**
   * An edit's `then_run` (M68, SoL-Pi's Action Fusion, reimplemented): the
   * command by the shell tool's path, hooks included (the M68 review), run
   * only if the file still holds what the edit left (formatted, when format
   * on edit is on); its result is the call's second one.
   */
  private async thenRun(
    itemId: string,
    target: { readonly absolute: string; readonly checkedAbsolute: string },
    command: string,
    edit: ToolOutcome,
    signal: AbortSignal,
    isForced: boolean,
  ): Promise<Performed> {
    const effects = newHookEffects()
    // The state a check of the same command would start on, taken before it runs.
    const startedOn = new Map(
      this.checkCommands().map((check) => [
        check.name,
        this.ledger.snapshot(check.name, 'project'),
      ]),
    )
    let ran: CommandOutcome
    try {
      ran = await this.runVerifyCommand(
        itemId,
        {
          line: command,
          ruleCommand: command,
          description: THEN_RUN_DESCRIPTION,
          timeoutMs: SHELL_DEFAULT_TIMEOUT_MS,
          isForced,
          guard: () => this.isAsEdited(target),
        },
        signal,
        effects,
      )
    } catch (error: unknown) {
      if (!(error instanceof AbortedError) && !isAbortRequested(signal)) {
        throw error
      }
      // Stopped at its hooks or its card: the edit happened, so the call keeps
      // its result and its diff; the turn ends when the loop sees the stop.
      return {
        outcome: {
          ...edit,
          output: `${edit.output}\n\n${fill(MODEL_TEXT.thenRunNotRun, { reason: MODEL_TEXT.toolCancelledByStop })}`,
          thenRun: { command, outcome: 'cancelled', output: '' },
        },
        hookEffects: effects,
      }
    }
    if (ran.kind === 'skipped') {
      const reason = skipReason(ran.skip, ran.detail)
      return {
        outcome: {
          ...edit,
          output: `${edit.output}\n\n${fill(MODEL_TEXT.thenRunNotRun, { reason })}`,
          thenRun: {
            command,
            outcome: 'notRun',
            skip: ran.skip,
            ...(ran.detail !== undefined && ran.detail.trim() !== '' && { detail: ran.detail }),
            output: '',
          },
        },
        hookEffects: effects,
      }
    }
    const { line, result } = ran
    this.noteCheckCommandRun(line, result, startedOn)
    const finished = shellOutcome(result, SHELL_DEFAULT_TIMEOUT_MS)
    return {
      outcome: {
        ...edit,
        output: `${edit.output}\n\n${MODEL_TEXT.thenRunLead} $ ${line}\n${finished.output}`,
        thenRun: {
          command: line,
          outcome: outcomeOf(result),
          output: shellText(result),
          ...(result.exitCode !== null && { exitCode: result.exitCode }),
        },
      },
      hookEffects: effects,
    }
  }

  /** Whether the file still holds what the edit left: `then_run`'s guard (M68). */
  private async isAsEdited(target: {
    readonly absolute: string
    readonly checkedAbsolute: string
  }): Promise<boolean> {
    let current: string | undefined
    try {
      current = await this.deps.io.readFile(target.checkedAbsolute, target.checkedAbsolute)
    } catch (error: unknown) {
      this.deps.log.warn(`then_run's guard could not read the file: ${describe(error)}`)
      return false
    }
    return current !== undefined && fingerprint(current) === this.seenFiles.get(target.absolute)
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
      ...(outcome.verifySummary !== undefined && { verifySummary: outcome.verifySummary }),
      ...(outcome.thenRun !== undefined && { thenRun: outcome.thenRun }),
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.rerecordTranscript(completed)
    const replay: ReplayItem = {
      turnId,
      item: {
        type: 'function_call_output',
        call_id: call.call_id,
        output: outcome.outputParts ?? outcome.output,
      },
    }
    this.replay.push(replay)
    const outputImages = outcome.outputParts?.filter((part) => part.type === 'input_image') ?? []
    if (outputImages.length > 0) {
      this.pendingOutputMedia.set(replay, outputImages)
    }
    if (outcome.visibleFile !== undefined) {
      this.readFiles.push(outcome.visibleFile)
    }
  }

  /** Permission check, execution and the transcript row for one tool call. */
  private async runCall(
    turnId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
  ): Promise<HookToolResult> {
    const itemId = this.deps.newId()
    const startedAt = this.deps.now()
    const pre = await this.runHooks(
      'PreToolUse',
      turnId,
      {
        tool_name: call.name,
        tool_input: await this.preToolInput(call, signal),
        tool_use_id: itemId,
      },
      toolMatcherNames(call.name),
      signal,
      false,
    )
    const effectiveCall: FunctionCallItem =
      pre.updatedInput === undefined
        ? call
        : { ...call, arguments: JSON.stringify(pre.updatedInput) }
    const paid =
      this.childTaskFor(effectiveCall) === undefined ? paidFeatureOf(call.name) : 'subagents'
    const started: ItemSnapshot = {
      itemId,
      kind: 'toolCall',
      status: IN_PROGRESS,
      turnId,
      tool: call.name,
      args: effectiveCall.arguments,
      ...(paid !== undefined && { paid }),
    }
    this.recordTranscript(turnId, started)
    this.emit({ type: 'itemStarted', item: started })
    let result: CallResult
    try {
      result =
        pre.blockedReason === undefined
          ? await this.decideAndRun(
              turnId,
              itemId,
              effectiveCall,
              signal,
              goalCommandRevision,
              pre.forceApproval,
            )
          : { outcome: toolFailure(pre.blockedReason), isRejected: true }
    } catch (error: unknown) {
      if (error instanceof AbortedError || signal.aborted) {
        this.finishCall(
          turnId,
          started,
          effectiveCall,
          toolFailure(MODEL_TEXT.toolCancelledByStop),
          CANCELLED,
        )
        throw new AbortedError()
      }
      // A tool that threw (a disk error, a directory for a file, an MCP
      // server's error or deadline) is a failed call the model is told
      // about, not the end of the turn.
      result = { outcome: toolFailure(describe(error)), isRejected: false }
    }
    // An MCP tool's `path` is its own business, not a workspace file it read.
    if (this.externalTool(effectiveCall.name) === undefined) {
      await this.touchPath(effectiveCall)
    }
    let { outcome } = result
    const { isRejected, running, hookEffects } = result
    if (running === undefined) {
      if (!this.canQueueToolMedia(outcome)) {
        outcome = {
          output: `Error: ${MODEL_TEXT.toolMediaBudgetExceeded}`,
          visibleOutput: UI_TEXT.mediaTotalTooLarge,
          failureReason: UI_TEXT.mediaTotalTooLarge,
        }
      }
      let status = COMPLETED
      if (outcome.failureReason !== undefined) {
        status = isRejected ? REJECTED : FAILED
      }
      this.finishCall(turnId, started, effectiveCall, outcome, status)
    } else {
      this.continueInBackground(turnId, started, effectiveCall, outcome, running)
    }
    for (const context of [...pre.contexts, ...(hookEffects?.contexts ?? [])]) {
      this.replay.push({
        turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: context }],
        },
      })
    }
    const post = await this.runHooks(
      outcome.failureReason === undefined ? 'PostToolUse' : 'PostToolUseFailure',
      turnId,
      outcome.failureReason === undefined
        ? {
            tool_name: effectiveCall.name,
            tool_input: toolHookInput(argumentsOf(effectiveCall)),
            tool_use_id: itemId,
            tool_response: toolHookOutput(outcome.output),
          }
        : {
            tool_name: effectiveCall.name,
            tool_input: toolHookInput(argumentsOf(effectiveCall)),
            tool_use_id: itemId,
            error: toolHookOutput(outcome.failureReason),
            is_interrupt: false,
            duration_ms: this.deps.now() - startedAt,
          },
      toolMatcherNames(effectiveCall.name),
      signal,
    )
    const blocked = [
      ...(post.stopReason === undefined && post.blockedReason !== undefined
        ? [post.blockedReason]
        : []),
      ...(hookEffects?.messages ?? []),
    ]
    for (const reason of blocked) {
      this.replay.push({
        turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: reason }],
        },
      })
    }
    return {
      record: {
        tool_name: effectiveCall.name,
        tool_input: toolHookInput(argumentsOf(effectiveCall)),
        tool_use_id: itemId,
        tool_response: toolHookOutput(outcome.output),
      },
      stopReason: post.stopReason ?? hookEffects?.stopReason,
    }
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
    for (const { parts, userMessageId: itemId } of turn.steered.splice(0)) {
      // Admitted user input (M68): the fix loop, rejections and runs start
      // afresh; what the conversation wrote stays until the next message. A
      // subagent's steers come from its parent model, not the user.
      if (!this.isSubagent) {
        this.ledger.resetForSteer()
      }
      const text = typedText(parts)
      this.replay.push({
        turnId: turn.turnId,
        userMessageId: itemId,
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: MODEL_TEXT.steeredPrefix },
            ...this.contentParts(parts),
          ],
        },
      })
      const attachments = attachmentsOf(parts)
      this.recordTranscript(turn.turnId, {
        itemId,
        kind: 'userMessage',
        status: COMPLETED,
        turnId: turn.turnId,
        text,
        ...(attachments.length > 0 && { attachments }),
      })
    }
  }

  /** Accepted steering that missed this turn's last request becomes user turns. */
  private queuedSteered(turn: ActiveTurn): QueuedTurn[] {
    return turn.steered.splice(0).map(({ parts, userMessageId }) => {
      const turnId = this.deps.newId()
      this.emit({ type: 'userMessageTurnChanged', userMessageId, turnId })
      return { turnId, parts, displayText: undefined, userMessageId, isGoalWake: false }
    })
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

  /**
   * The verify loop's automatic step (M68, PLAN.md D49), after a round that
   * edited files and before the next request: the edited files' diagnostics
   * once the language servers settle, then the user's check commands (those
   * not already run since the round's last edit), each by the shell tool's
   * path, its hooks included. Its row shows what ran, and the model reads it
   * all as tool data, within one budget. After CHECK_FIX_MAX_ROUNDS failing
   * rounds in a row the checks stop until the user's next message, and the
   * model and the user are told. Nothing runs after the turn's last round
   * (no request would read it) or a Stop (the M68 review). A hook's stop is
   * returned.
   */
  private async verifyRound(turn: ActiveTurn, isLastRound: boolean): Promise<string | undefined> {
    const edited = this.ledger.takeRoundEdits()
    const { verify } = this.deps
    const { signal } = turn.abort
    if (verify === undefined || isAbortRequested(signal)) {
      return undefined
    }
    if (isLastRound || edited.length === 0) {
      // The round's runs are judged, edits or not (the Codex review of PR #54).
      if (this.ledger.judgeRound()) {
        this.noteFixLoopStopped(turn.turnId, [])
      }
      return undefined
    }
    const isDiagnosticsOn = verify.isDiagnosticsOn()
    // Restricted Mode runs no shell (D13): the checks are left out, not refused
    // one by one. A check already run on the latest state of what it covers
    // (by run_checks, or an edit's then_run of its command) is not run again.
    const checks =
      this.ledger.isStopped || !this.deps.isWorkspaceTrusted()
        ? []
        : verify
            .checkCommands()
            .filter(
              (check) =>
                !this.ledger.isRejected(check.name) &&
                !this.ledger.hasCurrentRun(check.name, checkScope(check, edited)),
            )
    if (!isDiagnosticsOn && checks.length === 0) {
      if (this.ledger.judgeRound()) {
        this.noteFixLoopStopped(turn.turnId, [])
      }
      return undefined
    }
    const paths = edited.map((file) => file.relative)
    const parts = (isDiagnosticsOn ? 1 : 0) + checks.length
    const share = Math.floor(VERIFY_NOTE_MAX_CHARS / Math.max(parts, 1))
    const started: ItemSnapshot = {
      itemId: this.deps.newId(),
      kind: 'toolCall',
      status: IN_PROGRESS,
      turnId: turn.turnId,
      tool: VERIFY_TOOLS.verifyEdits,
      args: JSON.stringify({ paths }),
    }
    this.recordTranscript(turn.turnId, started)
    this.emit({ type: 'itemStarted', item: started })
    const effects = newHookEffects()
    let pending: PendingReport | undefined
    let runs: readonly CheckRun[]
    try {
      pending = isDiagnosticsOn
        ? await this.editDiagnostics(verify, edited, signal, share)
        : undefined
      // Looked up after the language servers' wait, so a file gone by now is not passed.
      const existing = checks.length === 0 ? [] : await this.existingFiles(edited)
      runs = await this.runChecks(started.itemId, checks, existing, signal, effects, share)
      if (isAbortRequested(signal)) {
        throw new AbortedError()
      }
    } catch (error: unknown) {
      const isStopped = error instanceof AbortedError || isAbortRequested(signal)
      const ended: ItemSnapshot = {
        ...started,
        status: isStopped ? CANCELLED : FAILED,
        ...(!isStopped && { failureReason: describe(error) }),
      }
      this.emit({ type: 'itemCompleted', item: ended })
      this.rerecordTranscript(ended)
      throw isStopped ? new AbortedError() : error
    }
    const report = pending?.report
    const sections = [
      ...(report === undefined ? [] : [report.text]),
      ...(runs.length === 0 ? [] : [checksSection(runs)]),
    ]
    const completed: ItemSnapshot = {
      ...started,
      status: COMPLETED,
      visibleOutput: sections.join('\n\n'),
      verifySummary: {
        files: paths,
        ...(report?.errors !== undefined && { errors: report.errors }),
        ...(report?.warnings !== undefined && { warnings: report.warnings }),
        ...(report?.unchecked !== undefined && { unchecked: report.unchecked }),
        checks: runs.map((run) => run.summary),
      },
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.rerecordTranscript(completed)
    if (this.ledger.judgeRound()) {
      this.noteFixLoopStopped(turn.turnId, sections)
    } else {
      this.replay.push({
        turnId: turn.turnId,
        item: noteItem([MODEL_TEXT.verifyLead, ...sections].join('\n\n')),
      })
    }
    // The model has the reads now: they become the baseline of the next check.
    pending?.commit()
    this.appendHookEffects(turn.turnId, effects)
    return effects.stopReason
  }

  /** The verify note with the fix loop's stop at its end, and the panel's notice (M68). */
  private noteFixLoopStopped(turnId: string, sections: readonly string[]): void {
    const stopped = fill(MODEL_TEXT.checksStopped, { count: String(CHECK_FIX_MAX_ROUNDS) })
    this.replay.push({
      turnId,
      item: noteItem([MODEL_TEXT.verifyLead, ...sections, stopped].join('\n\n')),
    })
    this.emit({
      type: 'backendNotice',
      level: 'warning',
      text: plural(UI_TEXT.checksStoppedNotice, CHECK_FIX_MAX_ROUNDS),
    })
  }

  /** What the checks' hooks added, after the verify note: their contexts, then their reasons. */
  private appendHookEffects(turnId: string, effects: HookEffects): void {
    for (const text of [...effects.contexts, ...effects.messages]) {
      this.replay.push({ turnId, item: noteItem(text) })
    }
  }

  /**
   * The edited files' diagnostics, compared with their previous check (M68).
   * At most VERIFY_SHOWN_FILES_MAX files are shown and read, none once the
   * conversation wrote a file the editor's tools run as code (the M68
   * review); the others are "not checked" with the reason. Diagnostics that
   * cannot be read at all are said so, to the model and the log, rather than
   * reported clean.
   */
  private async editDiagnostics(
    verify: VerifyHooks,
    edited: readonly EditedFile[],
    signal: AbortSignal,
    maxChars: number,
  ): Promise<PendingReport> {
    const { codeFile } = this.ledger
    const shown = codeFile === undefined ? edited.slice(0, VERIFY_SHOWN_FILES_MAX) : []
    const skipped: FileDiagnostics[] = edited.slice(shown.length).map((file) => ({
      file,
      entries: [],
      unchecked: codeFile === undefined ? 'tooMany' : 'codeLoading',
    }))
    let read: readonly FileDiagnostics[] = []
    if (shown.length > 0) {
      try {
        read = await unlessStopped(verify.diagnosticsAfterEdit(shown, signal), signal)
      } catch (error: unknown) {
        if (error instanceof AbortedError) {
          throw error
        }
        this.deps.log.warn(`Verify: the diagnostics could not be read: ${describe(error)}`)
        return {
          report: {
            text: fill(MODEL_TEXT.verifyDiagnosticsUnavailable, { reason: describe(error) }),
            unchecked: edited.length,
          },
          commit: NOTHING_TO_COMMIT,
        }
      }
    }
    return this.diagnosticsHistory.report([...read, ...skipped], {
      maxChars,
      ...(codeFile !== undefined && { codeFile }),
    })
  }

  private async loop(turn: ActiveTurn): Promise<void> {
    const { signal } = turn.abort
    let isStopHookActive = false
    let stopContinuations = 0
    for (let round = 0; round < MODEL_API_MAX_TOOL_ROUNDS; round += 1) {
      if (isAbortRequested(signal)) {
        throw new AbortedError()
      }
      const requiredBeforeRound = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
      if (requiredBeforeRound !== undefined) {
        throw requiredBeforeRound
      }
      this.drainSteered(turn)
      this.drainGoalWake(turn)
      const wasBudgetLimited = this.goal?.status === GOAL_STATUS.budgetLimited
      let streamed: StreamedCall
      try {
        streamed = await this.streamOnce(turn.turnId, signal, round, turn.confirmedRequest)
      } catch (error: unknown) {
        if (!isAbortRequested(signal)) {
          turn.modelFailure = error
        }
        throw error
      }
      const { calls, goalCommandRevision, postContexts } = streamed
      if (isAbortRequested(signal)) {
        // A buffered completed response may arrive after Stop. Its calls
        // still need outputs for valid replay, but no work or steering runs.
        this.skipCalls(turn.turnId, calls)
        throw new AbortedError()
      }
      const requiredAfterStream = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
      if (requiredAfterStream !== undefined) {
        this.skipCalls(turn.turnId, calls, MODEL_TEXT.mcpRequiredUnavailable)
        throw requiredAfterStream
      }
      if (!wasBudgetLimited && this.goal?.status === GOAL_STATUS.budgetLimited) {
        this.skipCalls(turn.turnId, calls, MODEL_TEXT.goalBudgetReached)
        this.appendHookContexts(turn.turnId, postContexts)
        this.queuedTurns.unshift(...this.queuedSteered(turn))
        return
      }
      // One more model call without progress toward the goal (the step probe, D38).
      if (isGoalActive(this.goal)) {
        this.goalSteps += 1
      }
      if (calls.length === 0) {
        this.appendHookContexts(turn.turnId, postContexts)
        // A message typed while the final answer streamed gets its own round
        // instead of being accepted and dropped (D26).
        if (turn.steered.length === 0 && !(turn.goalWakePending && isGoalActive(this.goal))) {
          const lastAssistantMessage =
            this.transcript.findLast(
              (entry) => entry.item.turnId === turn.turnId && entry.item.kind === 'agentMessage',
            )?.item.text ?? ''
          const stopEvent = this.isSubagent ? 'SubagentStop' : 'Stop'
          const stop = await this.runHooks(
            stopEvent,
            turn.turnId,
            {
              stop_hook_active: isStopHookActive,
              last_assistant_message: lastAssistantMessage,
              ...(this.isSubagent &&
                this.childSubagentId !== undefined && {
                  subagent_id: this.childSubagentId,
                  child_session_id: this.sessionId,
                }),
            },
            undefined,
            signal,
          )
          const requiredAfterStopHook = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
          if (requiredAfterStopHook !== undefined) {
            throw requiredAfterStopHook
          }
          if (stop.stopReason !== undefined) {
            return
          }
          if (stop.blockedReason !== undefined && stopContinuations < HOOK_MAX_STOP_CONTINUATIONS) {
            isStopHookActive = true
            stopContinuations += 1
            this.replay.push({
              turnId: turn.turnId,
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: stop.blockedReason }],
              },
            })
            continue
          }
          if (stop.blockedReason !== undefined) {
            this.deps.log.warn(`Model API ${stopEvent} hook reached its continuation limit`)
          }
          return
        }
        continue
      }
      let isRoundComplete = false
      const batch: Readonly<Record<string, unknown>>[] = []
      try {
        for (const [index, call] of calls.entries()) {
          if (isAbortRequested(signal)) {
            this.skipCalls(turn.turnId, calls.slice(index))
            throw new AbortedError()
          }
          const requiredBeforeCall = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
          if (requiredBeforeCall !== undefined) {
            this.skipCalls(turn.turnId, calls.slice(index), MODEL_TEXT.mcpRequiredUnavailable)
            throw requiredBeforeCall
          }
          try {
            const finished = await this.runCall(turn.turnId, call, signal, goalCommandRevision)
            batch.push(finished.record)
            if (finished.stopReason !== undefined) {
              const requiredAfterCall = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
              if (requiredAfterCall !== undefined) {
                throw requiredAfterCall
              }
              this.skipCalls(turn.turnId, calls.slice(index + 1), finished.stopReason)
              this.dropUndeliveredMedia(turn.turnId)
              return
            }
          } catch (error: unknown) {
            this.skipCalls(turn.turnId, calls.slice(index + 1))
            throw error
          }
        }
        isRoundComplete = true
      } finally {
        // A user message between a function call and its output is invalid
        // replay. Post-model context follows the whole tool batch instead.
        this.appendHookContexts(turn.turnId, postContexts)
        // A stopped or failed round names its read files without replaying
        // bytes that no model request saw (M54).
        this.appendReadFiles(turn.turnId, isRoundComplete && !isAbortRequested(signal))
      }
      const afterBatch = await this.runHooks(
        'PostToolBatch',
        turn.turnId,
        { tool_calls: batch },
        undefined,
        signal,
      )
      if (afterBatch.stopReason === undefined && afterBatch.blockedReason !== undefined) {
        this.replay.push({
          turnId: turn.turnId,
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: afterBatch.blockedReason }],
          },
        })
      }
      const requiredAfterCalls = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
      if (requiredAfterCalls !== undefined) {
        throw requiredAfterCalls
      }
      if (afterBatch.stopReason !== undefined) {
        // Hooks can stop a completed tool batch without a cancelled terminal.
        // Those read-file bytes were queued, not delivered to a model request.
        this.dropUndeliveredMedia(turn.turnId)
        return
      }
      const verifyStop = await this.verifyRound(turn, round === MODEL_API_MAX_TOOL_ROUNDS - 1)
      if (verifyStop !== undefined) {
        // A check's hook stopped the turn after the round, as PostToolBatch can.
        this.dropUndeliveredMedia(turn.turnId)
        return
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
    this.mediaNoticeSent = false
    const turn: ActiveTurn = {
      turnId: queued.turnId,
      abort: new AbortController(),
      steered: [],
      acceptedTextAttachmentBytes: textAttachmentBytes(queued.parts),
      modelFailure: undefined,
      goalWakePending: false,
      isWebSearchAllowed: false,
      ...(queued.confirmedRequest !== undefined && {
        confirmedRequest: queued.confirmedRequest,
      }),
    }
    // What a stopped turn left for its round is not checked in this one (M68).
    this.ledger.beginTurn()
    this.active = turn
    this.status = RUNNING
    this.turnIds.push(turn.turnId)
    this.emit({ type: 'turnStarted', turnId: turn.turnId })
    this.emit({ type: 'sessionStatus', status: RUNNING })
    // The context comes first so a skill invocation can be expanded (D13);
    // it never throws, so the user message always follows.
    await this.context.load()
    this.environment ??= await this.loadEnvironment()
    await this.loadRepoMap(turn.abort.signal)
    // Pending background output and user shell commands precede this turn.
    this.settleNotes(turn.turnId)
    this.touch()
    const startedAt = this.deps.now()
    let terminal = COMPLETED
    let reason: string | undefined
    let errorKind: string | undefined
    try {
      await this.startHooks()
      for (const message of this.pendingHookMessages.splice(0)) {
        this.emit({ type: 'backendNotice', level: 'info', text: message })
      }
      for (const context of this.pendingHookContexts.splice(0)) {
        this.replay.push({
          turnId: turn.turnId,
          item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: context }] },
        })
      }
      if (this.hookStartStopReason !== undefined) {
        const stopReason = this.hookStartStopReason
        this.hookStartStopReason = undefined
        throw new HookStoppedError(stopReason)
      }
      if (this.isSubagent && this.turnCount === 0) {
        if (this.childSubagentId === undefined) {
          throw new Error('child session has no subagent id')
        }
        await this.runHooks(
          'SubagentStart',
          turn.turnId,
          { subagent_id: this.childSubagentId, child_session_id: this.sessionId },
          undefined,
          turn.abort.signal,
        )
      }
      this.drainChildResults()
      if (queued.isGoalWake) {
        this.appendGoalWake(turn.turnId, queued.parts)
      } else {
        this.appendUserMessage(turn.turnId, queued.parts, queued.displayText, queued.userMessageId)
      }
      if (!queued.isGoalWake) {
        const replayBeforeSubmit = this.replay.length
        const submitted = await this.runHooks(
          'UserPromptSubmit',
          turn.turnId,
          { prompt: typedText(queued.parts) },
          undefined,
          turn.abort.signal,
        )
        if (submitted.blockedReason !== undefined) {
          // A rejected prompt stays visible in History, but never reaches a
          // later model request through the replay (M51).
          this.replay.splice(replayBeforeSubmit)
          const userIndex = this.replay.findLastIndex(
            (entry) =>
              entry.turnId === turn.turnId &&
              entry.item.type === 'message' &&
              entry.item.role === 'user',
          )
          if (userIndex !== -1) {
            this.replay.splice(userIndex, 1)
          }
          throw new HookStoppedError(submitted.blockedReason)
        }
        // Admitted: a user's message starts the verify loop afresh (M68). A
        // goal's wake carries on, and a parent model's message to a subagent
        // is not user input.
        if (!this.isSubagent) {
          this.ledger.resetForMessage()
        }
      }
      await this.prepareMcp(turn.abort.signal)
      turn.isWebSearchAllowed = await this.webSearchConsent(turn.abort.signal)
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
        this.deps.log.warn(
          error instanceof HookStoppedError
            ? `Model API turn ${turn.turnId} stopped by a hook`
            : `Model API turn ${turn.turnId} failed: ${reason}`,
        )
        if (turn.modelFailure !== undefined && !(error instanceof ChildTaskRefusedError)) {
          const lastAssistantMessage = this.transcript.findLast(
            (entry) => entry.item.turnId === turn.turnId && entry.item.kind === 'agentMessage',
          )?.item.text
          await this.runHooks(
            'StopFailure',
            turn.turnId,
            {
              error: errorKind,
              error_details: reason,
              ...(lastAssistantMessage !== undefined && {
                last_assistant_message: lastAssistantMessage,
              }),
            },
            errorKind,
            turn.abort.signal,
          )
        }
      }
    }
    if (terminal !== COMPLETED) {
      this.dropUndeliveredMedia(turn.turnId)
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
  ): Promise<{ readonly text: string; readonly response: ResponseObject }> {
    let text = ''
    let response: ResponseObject | undefined
    const admitAttempt = this.responseAttemptGuard(body)
    const responseStream = this.deps.client.streamResponse(
      body,
      signal,
      undefined,
      undefined,
      admitAttempt,
    )
    for await (const event of responseStream) {
      if (event.type === 'response.completed') {
        response = event.response
      }
      text += this.collectedText(event, chargedGoalId)
    }
    if (response === undefined) {
      throw new ModelApiError(
        'The stream ended without a completed response',
        0,
        undefined,
        undefined,
      )
    }
    return { text, response }
  }

  /** The summary call of `compact`, and the replay it leaves behind. */
  private async runCompaction(signal: AbortSignal): Promise<CompactOutcome> {
    const compactionBody = (): CreateResponseBody =>
      this.keyed({
        ...this.body(),
        // Within Meta's image budget too (M54): a conversation past it can still be compacted.
        input: this.budget.fit([
          ...this.replay.map((entry) => entry.item),
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: MODEL_TEXT.compactionPrompt }],
          },
        ]),
        tools: [],
        include: ['reasoning.encrypted_content'],
      })
    const turnId = this.turnIds.at(-1) ?? COMPACTION_TURN_ID
    const requestId = this.deps.newId()
    await this.beforeModelCall(turnId, compactionBody(), requestId, 1, 0, signal)
    const chargedGoalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    const body = compactionBody()
    const { text: summary, response } = await this.collectText(body, signal, chargedGoalId)
    const post = await this.runHooks(
      'PostLLMCall',
      turnId,
      postModelCallFields(body, response, requestId, 1, 0, this.sessionId),
      MODEL_API_HOOK_PROVIDER,
      signal,
      false,
    )
    if (post.blockedReason !== undefined) {
      throw new HookStoppedError(post.blockedReason)
    }
    this.replay.splice(0, this.replay.length, {
      turnId: COMPACTION_TURN_ID,
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `${MODEL_TEXT.compactionPrefix}\n\n${summary}` }],
      },
    })
    this.compactedThroughTurnId = this.turnIds.at(-1)
    this.appendHookContexts(COMPACTION_TURN_ID, post.contexts)
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

  /**
   * The index in `turnIds` of the last turn the compaction summary stands
   * for, or -1 when the conversation was never compacted: a compaction
   * replaces the replay of every turn before it with one summary (M53).
   */
  private compactedThrough(turnIds: readonly string[]): number {
    if (this.replay.every((entry) => entry.turnId !== COMPACTION_TURN_ID)) {
      return -1
    }
    if (this.compactedThroughTurnId !== undefined) {
      const index = turnIds.indexOf(this.compactedThroughTurnId)
      return index === -1 ? turnIds.length - 1 : index
    }
    // Old session files have no boundary field. The last completed
    // compaction row marks where the summary was accepted in transcript
    // order; replay gaps from later rejected prompts do not move it.
    const compactionIndex = this.transcript.findLastIndex(
      (entry) => entry.item.kind === 'compaction' && entry.item.status === COMPLETED,
    )
    if (compactionIndex === -1) {
      // A summary without its event cannot prove an earlier cut is safe.
      return turnIds.length - 1
    }
    for (let index = compactionIndex - 1; index >= 0; index -= 1) {
      const turnIndex = turnIds.indexOf(this.transcript[index]?.turnId ?? '')
      if (turnIndex !== -1) {
        return turnIndex
      }
    }
    return -1
  }

  /** Only a stored key's digest scopes a job; a changed key sees no old jobs. */
  private async scheduleAccountId(): Promise<string> {
    const id = await this.deps.getAccountId()
    if (id === undefined) {
      throw new Error(UI_TEXT.scheduleAccountMissing)
    }
    return id
  }

  private scheduleStore(): ScheduleStore {
    const store = this.deps.scheduleStore
    if (store === undefined) {
      throw new Error(UI_TEXT.scheduleStorageMissing)
    }
    return store
  }

  private isScheduleBusy(): boolean {
    return this.active !== undefined || this.compacting !== undefined || this.queuedTurns.length > 0
  }

  private publishSchedules(jobs: readonly ScheduledPrompt[]): readonly ScheduledPrompt[] {
    this.emit({ type: 'schedulesChanged', jobs: jobs.map((job) => scheduleViewOf(job)) })
    if (this.scheduleTimer === undefined && !this.isDisposed) {
      this.scheduleTimer = setInterval(() => {
        if (!this.isDisposed) {
          void this.listSchedules().catch((error: unknown) => {
            this.deps.log.warn(`Scheduled prompts could not be refreshed: ${describe(error)}`)
          })
        }
      }, SCHEDULE_POLL_INTERVAL_MS)
    }
    return jobs
  }

  /** A loaded session polls only its own jobs. Polls never make model calls. */
  private async listSchedules(): Promise<readonly ScheduledPrompt[]> {
    // A removed key clears the panel without waiting for storage. Check again
    // after the read so a slow poll cannot publish a previous account's jobs.
    if ((await this.deps.getAccountId()) === undefined) {
      return this.publishSchedules([])
    }
    const store = this.scheduleStore()
    const stored = await store.list(this.sessionId)
    const accountId = await this.deps.getAccountId()
    const jobs =
      accountId === undefined
        ? []
        : stored.filter(
            (job) => job.workspaceRoot === this.deps.workspaceRoot && job.accountId === accountId,
          )
    return this.publishSchedules(jobs)
  }

  private async createSchedule(cadence: ScheduleCadence, prompt: string): Promise<ScheduledPrompt> {
    if (this.isSideChat) {
      throw new Error(UI_TEXT.sideChatPlanOnly)
    }
    const parsed = scheduleCadenceSchema.safeParse(cadence)
    const cleanPrompt = prompt.trim()
    if (
      cleanPrompt === '' ||
      cleanPrompt.length > SCHEDULE_MAX_PROMPT_CHARS ||
      !parsed.success ||
      (parsed.data.kind === 'interval' &&
        (!Number.isSafeInteger(parsed.data.everyMs) ||
          parsed.data.everyMs < SCHEDULE_MIN_INTERVAL_MS ||
          parsed.data.everyMs > SCHEDULE_MAX_INTERVAL_MS))
    ) {
      throw new Error(UI_TEXT.scheduleInvalid)
    }
    const existing = await this.listSchedules()
    if (existing.length >= SCHEDULE_MAX_JOBS_PER_SESSION) {
      throw new Error(UI_TEXT.scheduleTooMany)
    }
    const now = this.deps.now()
    const expiresAtMs = now + SCHEDULE_LIFETIME_MS
    const nextFireAtMs = nextScheduleFire(parsed.data, now, expiresAtMs)
    if (nextFireAtMs === undefined) {
      throw new Error(UI_TEXT.scheduleNoFire)
    }
    const job: ScheduledPrompt = {
      id: this.deps.newId(),
      sessionId: this.sessionId,
      workspaceRoot: this.deps.workspaceRoot,
      accountId: await this.scheduleAccountId(),
      prompt: cleanPrompt,
      cadence: parsed.data,
      createdAtMs: now,
      expiresAtMs,
      nextFireAtMs,
      fireCount: 0,
    }
    await this.scheduleStore().create(job)
    this.touch()
    try {
      // The schedule must not be reported as created until its owning session
      // is durable too; a crash would otherwise leave an orphaned job.
      await this.onPersisted()
    } catch (error: unknown) {
      await this.scheduleStore().remove(this.sessionId, job.id)
      throw error
    }
    await this.listSchedules()
    return job
  }

  private async cancelSchedule(id: string): Promise<boolean> {
    if (this.isSideChat) {
      throw new Error(UI_TEXT.sideChatPlanOnly)
    }
    const jobs = await this.listSchedules()
    const job = jobs.find((entry) => entry.id === id)
    if (job === undefined) {
      return false
    }
    const isRemoved = await this.scheduleStore().remove(this.sessionId, id)
    await this.listSchedules()
    if (isRemoved) {
      this.touch()
    }
    return isRemoved
  }

  /** A confirmed occurrence: check gate and identity again, then claim before spending. */
  private async runSchedule(
    id: string,
    occurrenceMs: number,
    confirmed: ScheduleRunConfirmation,
  ): Promise<TurnSubmission> {
    if (this.isSideChat) {
      throw new Error(UI_TEXT.sideChatPlanOnly)
    }
    if (confirmed.sessionId !== this.sessionId || confirmed.modelId !== this.modelId) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    if (!this.deps.isPaidFeatureOn('scheduledPrompts')) {
      throw new Error(UI_TEXT.schedulePaidOff)
    }
    if (this.isScheduleBusy()) {
      throw new Error(UI_TEXT.scheduleBusy)
    }
    const jobs = await this.listSchedules()
    const job = jobs.find((entry) => entry.id === id)
    if (job?.nextFireAtMs !== occurrenceMs || occurrenceMs > this.deps.now()) {
      throw new Error(UI_TEXT.scheduleNotDue)
    }
    if (job.prompt !== confirmed.prompt || this.modelId !== confirmed.modelId) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    if (!(await this.scheduleStore().claim(job, occurrenceMs))) {
      throw new Error(UI_TEXT.scheduleAlreadyRun)
    }
    const accountId = await this.scheduleAccountId()
    if (this.isDisposed || this.isScheduleBusy()) {
      throw new Error(UI_TEXT.scheduleBusy)
    }
    if (!this.deps.isPaidFeatureOn('scheduledPrompts')) {
      throw new Error(UI_TEXT.schedulePaidOff)
    }
    if (this.modelId !== confirmed.modelId || accountId !== job.accountId) {
      throw new Error(UI_TEXT.scheduleConfirmationExpired)
    }
    // The request carries only the confirmed model and a digest of the key.
    // The client checks the actual SecretStorage key just before HTTP.
    const requestFor = (turnId: string): ConfirmedModelRequest => {
      let hasStarted = false
      return {
        modelId: confirmed.modelId,
        keyDigest: job.accountId,
        isStillAllowed: () =>
          !this.isDisposed &&
          this.modelId === confirmed.modelId &&
          this.deps.isPaidFeatureOn('scheduledPrompts'),
        onRequestStarted: () => {
          if (hasStarted) {
            return
          }
          hasStarted = true
          const item: ItemSnapshot = {
            itemId: this.deps.newId(),
            kind: 'toolCall',
            status: COMPLETED,
            turnId,
            tool: MODEL_API_SCHEDULED_TOOL,
            args: JSON.stringify({ id: job.id, prompt: job.prompt }),
            visibleOutput: UI_TEXT.scheduleRunStarted,
            paid: 'scheduledPrompts',
          }
          this.recordTranscript(turnId, item)
          this.emit({ type: 'itemCompleted', item })
          this.deps.notePaidUse('scheduledPrompts', 1)
          this.touch()
        },
      }
    }
    // No await between this check and sendTurn: a new turn cannot slip in and
    // turn a confirmed scheduled prompt into a silently queued later run.
    const submission = await this.sendTurn(
      [{ type: 'text', text: job.prompt }],
      job.prompt,
      requestFor,
    )
    this.touch()
    try {
      await this.listSchedules()
    } catch (error: unknown) {
      // A run already admitted and started must never be reported as rejected.
      this.deps.log.warn(`Scheduled prompts could not be refreshed: ${describe(error)}`)
    }
    return submission
  }

  /** The conversation a paid use is asked in (M58): a child task's is its parent's. */
  private get askingSessionId(): string {
    return this.parentSession?.askingSessionId ?? this.sessionId
  }

  // --- AgentSession ---

  /** A proven host-origin write: aliases reread instead of retaining old fingerprints. */
  public noteExternalEdit(file: EditedFile): void {
    if (this.isDisposed) {
      return
    }
    this.seenFiles.clear()
    this.ledger.noteEdit(file, [file.relative])
  }

  /** SessionStart runs when the session opens; context enters its first turn. */
  public async startHooks(): Promise<void> {
    if (this.hookStarted) {
      return
    }
    this.hookStarted = true
    await this.collectStartHooks(this.hookStartSource, undefined)
  }

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

  public sendTurn(
    parts: readonly TurnPart[],
    displayText?: string,
    requestFor?: (turnId: string) => ConfirmedModelRequest,
  ): Promise<TurnSubmission> {
    if (this.isDisposed) {
      return Promise.reject(new Error(UI_TEXT.turnStoppedByRestart))
    }
    const textBudgetError = textAttachmentBudgetError(textAttachmentBytes(parts))
    if (textBudgetError !== undefined) {
      return Promise.reject(textBudgetError)
    }
    const turnId = this.isSubagent ? `${this.sessionId}:${this.deps.newId()}` : this.deps.newId()
    const userMessageId = this.deps.newId()
    const confirmedRequest = requestFor?.(turnId)
    const queued: QueuedTurn = {
      turnId,
      parts,
      displayText,
      userMessageId,
      isGoalWake: false,
      ...(confirmedRequest !== undefined && { confirmedRequest }),
    }
    // A compaction is a turn too (D26): a message sent during one waits for it.
    if (this.active === undefined && this.compacting === undefined) {
      void this.runTurn(queued)
      return Promise.resolve({ turnId, disposition: 'started', userMessageId })
    }
    this.queuedTurns.push(queued)
    return Promise.resolve({ turnId, disposition: 'queued', userMessageId })
  }

  public steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<TurnSubmission> {
    if (this.isDisposed) {
      return Promise.reject(new Error(UI_TEXT.turnStoppedByRestart))
    }
    if (this.active?.turnId !== expectedTurnId || this.active.abort.signal.aborted) {
      return Promise.reject(new Error(TURN_NOT_RUNNING))
    }
    const addedTextBytes = textAttachmentBytes(parts)
    const textBudgetError = textAttachmentBudgetError(
      this.active.acceptedTextAttachmentBytes + addedTextBytes,
    )
    if (textBudgetError !== undefined) {
      return Promise.reject(textBudgetError)
    }
    if (!this.canQueueSteeredMedia(parts)) {
      return Promise.reject(new Error(UI_TEXT.mediaTotalTooLarge))
    }
    const userMessageId = this.deps.newId()
    this.active.acceptedTextAttachmentBytes += addedTextBytes
    this.active.steered.push({ parts, userMessageId })
    return Promise.resolve({ turnId: expectedTurnId, disposition: 'steered', userMessageId })
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
    if (mode !== 'denyUnmatched' && this.isSideChat) {
      return Promise.reject(new Error(UI_TEXT.sideChatPlanOnly))
    }
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
    this.mediaNoticeSent = false
    // Running like a turn (D26): Stop ends it, and messages sent meanwhile queue.
    const abort = new AbortController()
    this.compacting = abort
    this.status = RUNNING
    this.emit({ type: 'sessionStatus', status: RUNNING })
    try {
      const before = await this.runHooks(
        'PreCompact',
        this.turnIds.at(-1),
        { trigger: 'manual' },
        'manual',
        abort.signal,
      )
      if (before.stopReason !== undefined) {
        return { status: NOOP, reason: before.stopReason }
      }
      const outcome = await this.runCompaction(abort.signal)
      await this.runHooks(
        'PostCompact',
        this.turnIds.at(-1),
        { trigger: 'manual' },
        'manual',
        abort.signal,
      )
      if (outcome.status === 'accepted') {
        await this.collectStartHooks('compact', abort.signal)
      }
      return outcome
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

  /**
   * The todo list set from outside a turn (M79): a plan's steps before the
   * turn that implements it. Refused while a turn or a compaction holds the
   * session, where `todo_write` may be replacing the list.
   */
  public setTodos(items: readonly TodoItem[]): void {
    if (this.active !== undefined || this.compacting !== undefined) {
      throw new Error(UI_TEXT.planWaitForTurn)
    }
    this.todos = [...items]
    this.emit({ type: 'todoChanged', items: [...this.todos] })
    this.touch()
  }

  /** The exact user card's pictures, or unavailable without a durable replay link. */
  public sentImages(turnId: string, itemId: string): readonly SentImage[] | undefined {
    const card = this.transcript.find(
      (entry) =>
        entry.turnId === turnId &&
        entry.item.kind === 'userMessage' &&
        entry.item.itemId === itemId,
    )
    if (card === undefined) {
      return undefined
    }
    const entry = this.replay.find(
      (candidate) =>
        candidate.turnId === turnId &&
        candidate.userMessageId === itemId &&
        candidate.item.type === 'message' &&
        candidate.item.role === 'user',
    )
    if (entry?.item.type !== 'message') {
      return undefined
    }
    return entry.item.content.flatMap((part) => {
      const parsed = part.type === 'input_image' ? DATA_URL.exec(part.image_url) : null
      const [, mediaType, base64Data] = parsed ?? []
      return mediaType === undefined || base64Data === undefined ? [] : [{ mediaType, base64Data }]
    })
  }

  /** One more surface holds this session (a second panel resumed it, PLAN.md D25). */
  public retain(): void {
    this.holders += 1
  }

  /** Orderly host shutdown; SessionEnd is observation only (M51). */
  public async endHooks(signal: AbortSignal): Promise<void> {
    if (this.hookEnded || !this.hookStarted) {
      return
    }
    this.hookEnded = true
    await this.runHooks('SessionEnd', undefined, { reason: 'shutdown' }, 'shutdown', signal)
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
    this.workspaceEdits.delete(this.ledger)
    if (this.scheduleTimer !== undefined) {
      clearInterval(this.scheduleTimer)
      this.scheduleTimer = undefined
    }
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
      ...(this.isSideChat && { sideChat: true }),
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
      workspaceRoot: this.deps.sessionWorkspaceRoot ?? this.deps.workspaceRoot,
    }
  }

  public history(): SessionHistoryOutcome {
    return {
      mode: 'inline',
      sideChat: this.isSideChat,
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
      ...(this.isSideChat && { sideChat: true }),
      workspaceRoot: this.deps.sessionWorkspaceRoot ?? this.deps.workspaceRoot,
      modelId: this.modelId,
      approvalMode: this.permissions.currentMode,
      effort: this.effort,
      ...(this.name !== undefined && { name: this.name }),
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      turnIds: [...this.turnIds],
      ...(this.compactedThroughTurnId !== undefined && {
        compactedThroughTurnId: this.compactedThroughTurnId,
      }),
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
    this.compactedThroughTurnId = stored.compactedThroughTurnId
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
    this.goal = this.isSideChat ? undefined : stored.goal
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
        this.isSideChat ? 'denyUnmatched' : saved.session.approvalMode,
        this.deps,
        () => {
          this.touch()
        },
        () => this.onPersisted(),
        NO_CHILD_DISPOSAL,
        true,
        this,
        saved.id,
        this.hooks,
        'resume',
        this.isSideChat,
        this.workspaceEdits,
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

  /**
   * Copies the completed turns through `lastTurnId` (all of them when
   * absent) into `target`. A turn still running is never copied, as MSP's
   * fork copies completed turns only (a side chat opens while the main turn
   * runs, M53). A cut before the last compaction is refused (PLAN.md D46):
   * its summary stands for the turns after the cut too, so the branch would
   * carry what it was cut from.
   */
  public copyInto(target: ModelApiSession, lastTurnId: string | undefined): void {
    const completed = this.turnIds.filter((turnId) => turnId !== this.active?.turnId)
    const cut = lastTurnId === undefined ? completed.length - 1 : completed.indexOf(lastTurnId)
    if (cut === -1) {
      const why = lastTurnId === undefined ? 'no completed turn' : 'unknown turn'
      throw new Error(`invalid fork boundary for session ${this.sessionId}: ${why}`)
    }
    const compactedIndex = this.compactedThrough(completed)
    if (cut < compactedIndex) {
      throw new Error(UI_TEXT.rewindBeforeCompaction)
    }
    const kept = new Set(completed.slice(0, cut + 1))
    kept.add(COMPACTION_TURN_ID)
    target.replay.push(...this.replay.filter((entry) => kept.has(entry.turnId)))
    const retained = this.transcript.filter((entry) => kept.has(entry.turnId))
    target.transcript.push(...withoutRunning(retained))
    target.turnIds.push(...completed.slice(0, cut + 1))
    target.compactedThroughTurnId = completed[compactedIndex]
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
    target.goal = target.isSideChat ? undefined : this.goal
    // The prompt's repo map goes with the fork (M67), so it is not made again.
    target.repoMapText = this.repoMapText
    target.repoMapTries = this.repoMapTries
    for (const child of this.children.values()) {
      if (!kept.has(child.parentTurnId)) {
        continue
      }
      const sessionId = `${target.sessionId}:${child.id}`
      const session = new ModelApiSession(
        sessionId,
        child.session.modelId,
        target.isSideChat ? 'denyUnmatched' : child.session.approvalMode,
        this.deps,
        () => {
          target.touch()
        },
        () => target.onPersisted(),
        NO_CHILD_DISPOSAL,
        true,
        target,
        child.id,
        target.hooks,
        'fork',
        target.isSideChat,
        target.workspaceEdits,
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
  private readonly workspaceEdits: WorkspaceEdits
  /** Pinned at first use; a host cannot serve a different stored-key account. */
  private accountIdValue: string | undefined
  /** What the store holds for this workspace, kept current as sessions change. */
  private readonly stored = new Map<string, StoredSessionHeader>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  /** Saves run one after another; failures are logged, and strict callers also see them. */
  private saving: Promise<void> = Promise.resolve()
  public readonly info: HostInfo = {
    kind: 'modelApi',
    serverName: MODEL_API_SERVER_NAME,
    serverVersion: MODEL_API_VERSION,
    grantedCapabilities: [],
    canEditSessions: true,
  }

  public constructor(private readonly deps: ModelApiHostDeps) {
    this.workspaceEdits = deps.workspaceEdits ?? new WorkspaceEdits()
  }

  private async requireAccountId(): Promise<string> {
    const current = await this.deps.getAccountId()
    if (
      current === undefined ||
      (this.accountIdValue !== undefined && current !== this.accountIdValue)
    ) {
      throw new Error(UI_TEXT.notSignedInReason)
    }
    this.accountIdValue = current
    return current
  }

  private ownedSnapshot(snapshot: StoredSession): StoredSession {
    const accountId = this.accountIdValue
    if (accountId === undefined) {
      throw new Error(UI_TEXT.notSignedInReason)
    }
    return {
      ...snapshot,
      accountId,
      ...(snapshot.children !== undefined && {
        children: snapshot.children.map((child) => ({
          ...child,
          session: this.ownedSnapshot(child.session),
        })),
      }),
    }
  }

  private announce(session: ModelApiSession): void {
    for (const listener of this.listListeners) {
      listener({ type: 'changed', record: session.record() })
    }
  }

  private queueSave(
    snapshot: StoredSession,
    store: SessionStore,
    shouldSetHeaderAfterSave: boolean,
  ): Promise<void> {
    const header = headerOf(snapshot)
    if (!shouldSetHeaderAfterSave) {
      this.stored.set(snapshot.sessionId, header)
    }
    const previous = this.saving
    const saved = (async () => {
      await previous
      await store.save(snapshot)
      if (shouldSetHeaderAfterSave) {
        this.stored.set(snapshot.sessionId, header)
      }
    })()
    this.saving = (async () => {
      try {
        await saved
      } catch (error: unknown) {
        this.deps.log.warn(`Session ${snapshot.sessionId} was not saved: ${describe(error)}`)
      }
    })()
    return saved
  }

  private persist(session: ModelApiSession, isStrict = false): Promise<void> {
    const { store } = this.deps
    if (store === undefined) {
      return isStrict ? Promise.reject(new Error(UI_TEXT.historyUnavailable)) : Promise.resolve()
    }
    const snapshot = this.ownedSnapshot(session.snapshot())
    // A turn-start user message can be saved, but a function call without
    // its output cannot be replayed after a crash. Goal/settings touches
    // during a pending tool still announce live; the settled touch saves.
    // A child's unsettled turn holds the parent's save the same way: its
    // replay is nested in this snapshot.
    if (hasUnansweredSessionCall(snapshot)) {
      return isStrict ? Promise.reject(new Error(UI_TEXT.historyUnavailable)) : Promise.resolve()
    }
    const saved = this.queueSave(snapshot, store, isStrict)
    return isStrict ? saved : this.saving
  }

  /** A schedule create needs proof its owning session was saved before success. */
  private persistStrict(session: ModelApiSession): Promise<void> {
    const { store } = this.deps
    if (store === undefined) {
      return Promise.reject(new Error(UI_TEXT.scheduleStorageMissing))
    }
    const snapshot = this.ownedSnapshot(session.snapshot())
    // A schedule cannot make an unsafe replay durable. The caller removes
    // its new job on this refusal, leaving the last valid session snapshot.
    return hasUnansweredSessionCall(snapshot)
      ? Promise.reject(new Error(UI_TEXT.scheduleBusy))
      : this.queueSave(snapshot, store, false)
  }

  private create(
    modelId: string,
    approvalMode: ApprovalMode,
    sessionId: string = this.deps.newId(),
    hooks: readonly HookDefinition[] = [],
    hookStartSource: 'startup' | 'resume' | 'fork' = 'startup',
    isSideChat = false,
  ): ModelApiSession {
    const session: ModelApiSession = new ModelApiSession(
      sessionId,
      modelId,
      approvalMode,
      this.deps,
      () => {
        void this.persist(session)
        this.announce(session)
      },
      () => this.persistStrict(session),
      () => {
        this.sessions.delete(sessionId)
      },
      false,
      undefined,
      undefined,
      hooks,
      hookStartSource,
      isSideChat,
      this.workspaceEdits,
    )
    this.sessions.set(sessionId, session)
    return session
  }

  private async sessionHooks(): Promise<readonly HookDefinition[]> {
    try {
      return (await this.deps.loadHooks?.()) ?? []
    } catch (error: unknown) {
      this.deps.log.warn(`Model API hooks could not load: ${describe(error)}`)
      return []
    }
  }

  /**
   * A stored session read whole (D26: the window keeps only headers). The
   * saves queued before it run first, so the file holds what this window
   * last wrote.
   */
  private async storedSession(sessionId: string): Promise<StoredSession> {
    const accountId = await this.requireAccountId()
    const { store } = this.deps
    if (store !== undefined && this.stored.has(sessionId)) {
      await this.saving
      const stored = await store.load(sessionId)
      await this.requireAccountId()
      if (stored?.accountId === accountId) {
        return stored
      }
    }
    throw new Error(`session ${sessionId} is not held by this window`)
  }

  /** The live session, or the stored one brought back into this window. */
  private async revive(sessionId: string, isSideChatRequired = false): Promise<ModelApiSession> {
    const live = this.sessions.get(sessionId)
    if (live !== undefined) {
      if (isSideChatRequired && live.record().sideChat !== true) {
        throw new Error(UI_TEXT.sideChatSessionOnly)
      }
      live.retain()
      return live
    }
    const stored = await this.storedSession(sessionId)
    if (isSideChatRequired && stored.sideChat !== true) {
      throw new Error(UI_TEXT.sideChatSessionOnly)
    }
    // Another surface may have brought it back while the file was read.
    const revived = this.sessions.get(sessionId)
    if (revived !== undefined) {
      if (isSideChatRequired && revived.record().sideChat !== true) {
        throw new Error(UI_TEXT.sideChatSessionOnly)
      }
      revived.retain()
      return revived
    }
    const session = this.create(
      stored.modelId,
      stored.sideChat === true ? 'denyUnmatched' : stored.approvalMode,
      sessionId,
      stored.sideChat === true ? [] : await this.sessionHooks(),
      'resume',
      stored.sideChat === true,
    )
    session.adopt(stored)
    await session.startHooks()
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

  /**
   * The MCP servers start with a conversation, as Muse Code starts them with
   * its session (M50), so they are ready by the first message; that turn
   * waits for any still starting.
   */
  private async startMcpServers(): Promise<void> {
    try {
      await this.deps.mcpServers?.start()
    } catch (error: unknown) {
      this.deps.log.warn(`The MCP servers could not be started: ${describe(error)}`)
    }
  }

  /** Reads the store once; this window's sessions then include the stored ones. */
  public async load(): Promise<void> {
    const accountId = await this.requireAccountId()
    const { store } = this.deps
    if (store === undefined) {
      return
    }
    const sessions = await store.list()
    await this.requireAccountId()
    for (const stored of sessions) {
      if (
        stored.workspaceRoot === (this.deps.sessionWorkspaceRoot ?? this.deps.workspaceRoot) &&
        stored.accountId === accountId
      ) {
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

  /** Capture the live owner now; a later replacement with the same id is not this writer. */
  public externalEditRecorder(session: AgentSession): WorkspaceEditRecorder | undefined {
    const owner = this.sessions.get(session.sessionId)
    if (owner === undefined || owner !== session) {
      return undefined
    }
    return (file) => {
      if (this.sessions.get(owner.sessionId) === owner) {
        owner.noteExternalEdit(file)
      }
    }
  }

  public async startSession(options: StartSessionOptions): Promise<AgentSession> {
    if (!(APPROVAL_MODES as readonly string[]).includes(options.approvalMode)) {
      throw new Error(`unknown approval mode ${options.approvalMode}`)
    }
    const hooks = options.sideChat === true ? [] : await this.sessionHooks()
    await this.requireAccountId()
    const session = this.create(
      options.modelId,
      options.sideChat === true ? 'denyUnmatched' : (options.approvalMode as ApprovalMode),
      this.deps.newId(),
      hooks,
      'startup',
      options.sideChat === true,
    )
    try {
      await session.startHooks()
      await this.requireAccountId()
    } catch (error: unknown) {
      session.dispose()
      throw error
    }
    this.announce(session)
    void this.startMcpServers()
    return session
  }

  /** The MCP servers' live state, for the MCP servers view (M50). */
  public mcpSnapshot(): McpPoolSnapshot | undefined {
    return this.deps.mcpServers?.snapshot()
  }

  public async listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    await this.requireAccountId()
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
    return { sessions, nextCursor: undefined }
  }

  /** A conversation or one of its private child transcripts (M48). */
  public async readSession(sessionId: string): Promise<SessionHistoryOutcome> {
    await this.requireAccountId()
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
      sideChat: source.sideChat === true,
      items: source.transcript.map((entry) => entry.item),
      name: source.name,
      todos: source.todos,
      goal: source.goal === undefined ? null : toSessionGoal(source.goal),
    }
  }

  public async resumeSession(
    sessionId: string,
    _modelId: string,
    _mcpServers?: Readonly<Record<string, SessionMcpHttpServer>>,
    options?: { readonly requireSideChat?: boolean },
  ): Promise<LoadedSession> {
    await this.requireAccountId()
    const session = await this.revive(sessionId, options?.requireSideChat === true)
    try {
      await this.requireAccountId()
    } catch (error: unknown) {
      session.dispose()
      throw error
    }
    const loaded = this.loaded(session)
    void this.startMcpServers()
    return loaded
  }

  public async forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
    options?: { readonly sideChat?: boolean },
  ): Promise<LoadedSession> {
    await this.requireAccountId()
    // Copying needs no hold on a live source; a stored one is revived only for the copy.
    const live = this.sessions.get(sessionId)
    const source = live ?? (await this.revive(sessionId))
    const isSideChat = options?.sideChat === true || source.record().sideChat === true
    let hooks: readonly HookDefinition[]
    try {
      hooks = isSideChat ? [] : await this.sessionHooks()
      await this.requireAccountId()
    } catch (error: unknown) {
      if (live === undefined) {
        source.dispose()
      }
      throw error
    }
    const fork = this.create(
      modelId,
      isSideChat ? 'denyUnmatched' : source.approvalMode,
      this.deps.newId(),
      hooks,
      'fork',
      isSideChat,
    )
    try {
      source.copyInto(fork, lastTurnId)
      await fork.startHooks()
      await this.requireAccountId()
      if (isSideChat) {
        await this.persist(fork, true)
      } else {
        void this.persist(fork)
      }
      await this.requireAccountId()
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
    const ending = new AbortController()
    const deadline = setTimeout(() => {
      ending.abort()
    }, HOOK_SESSION_END_TIMEOUT_MS)
    try {
      for (const session of this.sessions.values()) {
        if (ending.signal.aborted) {
          break
        }
        try {
          await session.endHooks(ending.signal)
        } catch (error: unknown) {
          this.deps.log.warn(`Model API SessionEnd hook failed: ${describe(error)}`)
        }
      }
    } finally {
      clearTimeout(deadline)
    }
    // Disposing removes the entry; a Map iterator tolerates that.
    for (const session of this.sessions.values()) {
      session.disposeAll()
    }
    // The MCP servers go with the host (M50): a stdio server's process tree is killed.
    await Promise.all([this.saving, this.deps.mcpServers?.close()])
  }
}
