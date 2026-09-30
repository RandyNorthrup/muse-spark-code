// One conversation per surface: owns the MSP session for that surface, turns
// webview requests into backend calls, and streams AgentEvents back. Also the
// source of truth for the composer settings that outlive a webview reload
// (permission mode, effort, thinking) and for the images waiting to be sent.

import path from 'node:path'
import { Buffer } from 'node:buffer'
import { AttachmentStore } from '../../core/attachments'
import { isProtectedPath } from '../../core/protectedPaths'
import {
  type AgentHost,
  type AgentSession,
  type BackendKind,
  type GoalCommand,
  type GoalRefusal,
  type HostExit,
  isGoalRefusedError,
  isPromptSettledError,
  isSessionNotLoadedError,
  type LoadedSession,
  type PromptSettledError,
  type PromptSettledReason,
  type SessionHistoryOutcome,
  type SessionListEvent,
  type SessionMcpHttpServer,
  type SessionRecord,
  type TurnPart,
  type TurnSubmission,
} from '../../core/agent/agentBackend'
import { editAutomaticallyChoice } from '../../core/agent/approvalRules'
import { toSessionRow } from '../../core/agent/sessionRows'
import {
  hasUnshownCharacters,
  numberedSteps,
  planBody,
  planLogName,
  type PlanMarkdown,
  planSteps,
  planTitle,
} from '../../core/plans/planDocument'
import {
  type PlanStore,
  type PlanSummary,
  type SaveOutcome,
  planTooLargeText,
} from '../../core/plans/planStore'
import type { WorkspaceEditRecorder } from '../../core/verify/workspaceEdits'
import { isProfileWorkspace, type ShellSandboxPosture } from '../../core/backends/musecode/sandbox'
import { chatReferenceText } from '../../core/chatReference'
import { textFileDisplay } from '../../shared/textFileDisplay'
import { type EditorContext, editorContextText } from '../../core/editorContext'
import type { ToolImageResult } from '../../core/toolImages'
import type { DictationHandle, DictationSetup, DictationStatus } from '../../core/voice/dictation'
import {
  ALLOWED_LINK_SCHEMES,
  AUTH_REQUIRED_ERROR_KIND,
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DELTA_BATCH_MS,
  type DictationAction,
  type DictationEngine,
  type EffortLevel,
  type ExportFormat,
  type GoalCommandVerb,
  IDE_MCP_SERVER_NAME,
  IMAGE_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  PDF_EXTENSION,
  PLAN_BRIEF_LOCAL_ID_PREFIX,
  PLAN_FILE_MAX_BYTES,
  PLAN_TODO_PENDING_STATUS,
  PRIVATE_ATTACHMENT_EXTENSIONS,
  PRIVATE_ATTACHMENT_NAMES,
  MENTION_RESULT_LIMIT,
  MODEL_TEXT,
  MSP_REQUESTED_CAPABILITIES,
  OUTPUT_DOCUMENT_MAX_PAGES,
  OUTPUT_PAGE_BYTES,
  OUTPUT_TAB_ID_LENGTH,
  PATCH_DOCUMENT_MAX_PAGES,
  type PaidFeature,
  type PermissionMode,
  SANDBOX_FAILURE_MARKER,
  SESSION_LIST_LIMIT,
  SESSION_LIST_MAX_PAGES,
  CHOICE_STEERING_NOTE,
  SESSION_RESTORE_WINDOW_MS,
  SHELL_TOOLS,
  type SubagentAction,
  TEXT_ATTACHMENT_EXTENSIONS,
  TEXT_FILE_DISPLAY_MARKER,
  UNSUPPORTED_BINARY_ATTACHMENT_EXTENSIONS,
  UI_TEXT,
  USER_SHELL_ITEM_KIND,
  USER_SHELL_SANDBOX_FAILURE_MARKER,
} from '../../shared/constants'
import { effortForThinking, effortLevelsFor, isEffortLevel } from '../../shared/effort'
import type { AgentEvent, ApprovalChoice, ItemSnapshot, TodoItem } from '../../shared/agentEvents'
import { fill, plural } from '../../shared/l10n/text'
import type { PaidUseRequest } from '../../shared/paid'
import type { ScheduleCadence, ScheduledPrompt } from '../../shared/schedule'
import { formatMention, parseSkillInvocation } from '../../shared/mentions'
import { approvalModeFor } from '../../shared/permissionModes'
import type {
  ChatReference,
  EditRef,
  HostAction,
  HostToWebviewMessage,
  LineRange,
  MentionItem,
  ModelOption,
  SkillOption,
} from '../../shared/protocol'
import type { AccountFacts, SubscriptionUsage, UsageInsights } from '../../shared/usage'
import type { AuthPort } from '../auth/authService'
import type { ReviewNotice } from '../editor/editReview'
import { errorDetail, type Logger } from '../logger'
import type { ChatSurface, ConversationMessage } from '../views/chatSurface'
import {
  type ConversationExports,
  exportConversation,
  type ExportOutcome,
} from './exportConversation'

/**
 * One subscription on the current host (list stream, usage stream),
 * replaced when the controller moves to another host, dropped when the host
 * dies (its listeners died with it).
 */
class HostWatch {
  private current: { readonly host: AgentHost; readonly unsubscribe: () => void } | undefined

  public ensure(host: AgentHost, subscribe: (host: AgentHost) => () => void): void {
    if (this.current?.host === host) {
      return
    }
    this.current?.unsubscribe()
    this.current = { host, unsubscribe: subscribe(host) }
  }

  public isWatching(host: AgentHost): boolean {
    return this.current?.host === host
  }

  public forget(): void {
    this.current?.unsubscribe()
    this.current = undefined
  }

  public dispose(): void {
    this.forget()
  }
}

export interface PickedFile {
  readonly name: string
  readonly fsPath: string
  /** Workspace-relative with forward slashes; undefined outside the workspace. */
  readonly relativePath: string | undefined
}

export interface FileAccess {
  /** Native open dialog; resolves to [] when cancelled. */
  showOpenDialog(): Promise<readonly PickedFile[]>
  /** Reads no file that is already over the attachment limit. */
  readFile(
    fsPath: string,
    maxBytes: number,
    expectedCanonicalPath?: string,
  ): Promise<{ readonly bytes: Uint8Array | undefined; readonly isPdf: boolean }>
  /** Indexed relative path and the same checked target for reading; undefined on an escape. */
  canonicalRelativePath(
    fsPath: string,
  ): Promise<{ readonly canonical: string; readonly checkedAbsolute: string } | undefined>
  /** QuickPick over the mention index; resolves to the chosen relative path. */
  pickMentionFile(): Promise<string | undefined>
  /** Relative path for a dropped `file:` URI; undefined outside the workspace. */
  toRelativePath(uri: string): string | undefined
}

export interface MentionSearch {
  search(query: string, limit: number): Promise<readonly MentionItem[]>
  /** Whether the file is in the index (excluded files share their path only). */
  contains(relativePath: string): Promise<boolean>
}

/** Edit review (M5): each call returns the notices to show in the transcript. */
export interface EditReviewActions {
  openDiff(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]>
  revert(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]>
}

/** What Plans… does with the plan the user picked (M79). */
export interface PlanChoice {
  readonly plan: PlanSummary
  readonly action: 'open' | 'implement'
}

/**
 * Plans as files (M79, PLAN.md D49): the workspace's `.agents/plans/` and
 * the Plans… pick. Undefined without a workspace folder.
 */
export interface PlanFiles extends Pick<PlanStore, 'find' | 'save' | 'has' | 'read' | 'list'> {
  /** Captured while the verified plan session is still attached, before lookup/confirmation. */
  readonly captureOwner?: (session: AgentSession) => WorkspaceEditRecorder | undefined
  /**
   * The yes a save needs: `.agents/` is a protected path (PLAN.md D24), so
   * writing a plan there asks first, as a protected write does.
   */
  confirmSave(): Promise<boolean>
  /** A plan and what to do with it; undefined when the pick was dismissed. */
  choose(plans: readonly PlanSummary[]): Promise<PlanChoice | undefined>
  /**
   * The plan reader (dist/planMarkdown.js, loaded on first use): a plan's
   * title, steps and hidden text. Throws, with the reason, when it cannot
   * load; a plan action then refuses rather than skip the hidden-text check.
   */
  markdown(): PlanMarkdown
}

/** The last session a surface held, for the reopen-within-ten-minutes rule. */
export interface LastSession {
  readonly sessionId: string
  /** Epoch ms of its last activity as this extension saw it. */
  readonly at: number
}

/** Per-workspace memory behind the History dialog (`workspaceState`, M6). */
export interface SessionMemory {
  archivedIds(): readonly string[]
  setArchivedIds(ids: readonly string[]): Promise<void>
  lastSession(): LastSession | undefined
  setLastSession(last: LastSession | undefined): Promise<void>
}

export interface ConversationDeps {
  readonly surface: ChatSurface
  readonly auth: AuthPort
  readonly ensureHost: () => Promise<AgentHost>
  readonly workspaceRoot: string | undefined
  readonly modelId: string
  readonly initialPermissionMode: PermissionMode
  /** False until the approval cards ship (M4); see shared/permissionModes.ts. */
  readonly hasApprovalUi: boolean
  readonly openExternal: (url: string) => void
  readonly openSideChat?: (sessionId: string) => void
  readonly mentions: MentionSearch
  readonly files: FileAccess
  /** The `allowDangerouslySkipPermissions` setting: whether Bypass is offered. */
  readonly isBypassAllowed: () => boolean
  /**
   * A remote window (`vscode.env.remoteName`): a dev container's settings can
   * switch Bypass on there, so it needs one explicit yes (PLAN.md D24).
   */
  readonly isRemoteWindow: boolean
  readonly confirmRemoteBypass: () => Promise<boolean>
  /** `museSpark.confidentialWorkspace`: contributor-tier models are blocked. */
  readonly isConfidentialWorkspace: () => boolean
  /** One explicit yes before a contributor-tier model is used (M7). */
  readonly confirmContributor: (modelId: string) => Promise<boolean>
  readonly runHostAction: (action: HostAction) => Promise<void>
  /** Code block "Copy": the system clipboard. */
  readonly copyText: (text: string) => Promise<void>
  /** Code block "Insert at cursor"; false when no text editor is active. */
  readonly insertCode: (text: string) => Promise<boolean>
  /** A shell tool reported the OS sandbox missing: the host offers the setup. */
  readonly onSandboxUnavailable: () => void
  readonly platform: NodeJS.Platform
  /** `%USERPROFILE%`; undefined off Windows (the sandbox notice, D12). */
  readonly userProfileDir: string | undefined
  /** The shell sandbox posture the host runs with (D12). */
  readonly shellSandbox: () => ShellSandboxPosture
  /** The active editor for the file chip (M5); undefined when none. */
  readonly editorContext: () => EditorContext | undefined
  /** `museSpark.autosave`: save dirty editors before every turn. */
  readonly isAutosaveEnabled: () => boolean
  readonly saveAll: () => Promise<void>
  /** Files open with unsaved changes, as the panel names them (PLAN.md D27). */
  readonly unsavedFiles: () => readonly string[]
  /** Code block "Apply": replace the active editor's selection; false without an editor. */
  readonly applyCode: (text: string) => Promise<boolean>
  readonly editReview: EditReviewActions
  /** A tool output as a read-only editor tab named `title` (M15). */
  readonly openDocument: (title: string, content: string) => Promise<void>
  /** A file in an editor, `path` absolute or workspace-relative, the lines (1-based) selected (M16). */
  readonly openFile: (path: string, range: LineRange | undefined) => Promise<void>
  /** The picture a tool row names, from the workspace (M43, `loadToolImage`). */
  readonly readToolImage: (path: string) => Promise<ToolImageResult>
  /** The IDE tool server for `session/start`, when it is listening. */
  readonly ideMcpEndpoint: () => Promise<SessionMcpHttpServer | undefined>
  readonly newAttachmentId: () => string
  /** Session history (M6). */
  readonly sessions: SessionMemory
  /** The usage modal's Account section (M14). */
  readonly accountFacts: (backend: BackendKind) => Promise<AccountFacts>
  /** The usage modal's insights from the CLI's trace logs (M14); undefined without logs. */
  readonly usageInsights: () => Promise<UsageInsightsReport | undefined>
  /** Whether this surface resumes its last session when it reopens (the sidebar). */
  readonly isRestorable: boolean
  /** Voice dictation (M9): the platform's helper, or why there is none. */
  readonly dictation: DictationSetup
  /**
   * Muse Voice (M35, PLAN.md D30) when it is the microphone's engine (its
   * setting on, its price accepted, the Model API backend); undefined while
   * the free engine is.
   */
  readonly museVoice: () => DictationSetup | undefined
  /** "Export conversation…" (M30): the save dialog, the write, Muse Code's own log. */
  readonly exports: ConversationExports
  /** Saved plans (M79); undefined without a workspace folder. */
  readonly plans: PlanFiles | undefined
  /** The palette's paid-feature toggles (M33, PLAN.md D30): on asks for the price first. */
  readonly setPaidFeature: (feature: PaidFeature, isOn: boolean) => Promise<void>
  /** VS Code workspace trust (PLAN.md D13): Restricted Mode runs no `!` command (M46). */
  readonly isWorkspaceTrusted: () => boolean
  /**
   * A command that Ctrl+B can move to the background started or stopped
   * running here (M46): the keybinding's context key follows.
   */
  readonly onForegroundTasksChanged: () => void
  /**
   * A separate yes for each due Model API turn, naming prompt and token price
   * (M52): the paid-use popup (M58).
   */
  readonly confirmScheduledRun?: (job: ScheduledPrompt, modelId: string) => Promise<boolean>
  readonly isScheduledPaidOn?: () => boolean
  /** The paid-use popup (M58, PLAN.md D48): before each Muse Voice recording. */
  readonly allowsPaidUse: (request: PaidUseRequest) => Promise<boolean>
  /** Account & usage's "Ask again": every paid feature asks again in this workspace (M58). */
  readonly forgetPaidUse: () => Promise<void>
  /**
   * The verify loop's note to Muse Code (M68, PLAN.md D49), read for each
   * message: check the diagnostics of what it edits (only when the session
   * has the `ide` server), run the user's checks. Undefined when there is
   * nothing to say.
   */
  readonly verifyGuidance?: (hasIdeServer: boolean) => string | undefined
  readonly now: () => number
  readonly log: Logger
}

/** The day and the week windows of the usage insights (M14). */
export interface UsageInsightsReport {
  readonly day: UsageInsights
  readonly week: UsageInsights
}

const IDLE_STATUS = 'idle'
const NOOP_STATUS = 'noop'
const CANCELLED_STATUS = 'cancelled'
// `session/compact` rejects with this reason before the first turn has run
// (verified live 2026-09-21); it is "nothing to do", not a failure.
const MISSING_RUN_REASON = 'missing_run'
const BYPASS_MODE: PermissionMode = 'bypassPermissions'
const FALLBACK_MODE: PermissionMode = 'manual'
/** Auto approval is safe only while one controller holds the shared session. */
const sessionSurfaces = new WeakMap<AgentSession, Set<ConversationController>>()
const APPROVED_DECISION = 'approved'
const [IDE_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES
const HISTORY_MODE_NONE = 'none'
const REWIND_HISTORY_MODES: ReadonlySet<string> = new Set([
  'inline',
  'snapshot',
  'anchoredSnapshot',
])
const NOT_LOADED_STATUS = 'notLoaded'
// Events that mark a hidden surface unread (Claude Code's dot): the turn is
// done, or the agent is waiting on a decision or an answer.
const ATTENTION_EVENTS: ReadonlySet<AgentEvent['type']> = new Set([
  'turnCompleted',
  'approvalRequested',
  'questionRequested',
])
/** Session/model actions must stop as soon as sign-out is announced in any panel. */
const AUTH_REQUIRED_SESSION_ACTIONS: ReadonlySet<ConversationMessage['type']> = new Set([
  'readOutput',
  'readToolImage',
  'openOutput',
  'openEditDiff',
  'rewindCode',
  'exportConversation',
  'decideApproval',
  'answerQuestion',
  'clarifyQuestion',
  'moveToBackground',
  'rewindConversation',
  'openSideChat',
  'setModel',
  'setEffort',
  'setThinking',
  'setPermissionMode',
  'compact',
  'goalCommand',
  'scheduleCreate',
  'scheduleList',
  'scheduleCancel',
  'scheduleRun',
  'listSkills',
  'listSessions',
  'readChildSession',
  'subagentControl',
  'subagentMessage',
  'resumeSession',
  'setSessionArchived',
  'forkSession',
  'renameSession',
  'readUsage',
  'setPaidFeature',
  'savePlan',
  'implementPlan',
])
const QUEUED_DISPOSITION = 'queued'
const TOOL_CALL_KIND = 'toolCall'
const SUBAGENT_ITEM_KIND = 'subagent'
const IN_PROGRESS_STATUS = 'inProgress'
// The unsaved files a warning names before it counts the rest (D27).
const UNSAVED_FILES_NAMED = 3
// How a notice the user saw reads in the log (M39).
const NOTICE_PREFIX = 'Shown in the panel: '

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The two tables below are built when used, never at module load: the
// display language's table is installed at activation, after this loads.

/** A decision or answer that arrived after its prompt had moved (PLAN.md D26). */
function promptSettledText(reason: PromptSettledReason): string {
  const texts: Readonly<Record<PromptSettledReason, string>> = {
    alreadySettled: UI_TEXT.promptAlreadySettled,
    movedOn: UI_TEXT.promptMovedOn,
    gone: UI_TEXT.promptGone,
  }
  return texts[reason]
}

/** The command a `goalCommand` message asks for (M45); undefined for a set or edit with no objective. */
function goalCommandOf(
  verb: GoalCommandVerb,
  objective: string | undefined,
): GoalCommand | undefined {
  if (verb === 'set' || verb === 'edit') {
    const trimmed = objective?.trim() ?? ''
    return trimmed === '' ? undefined : { verb, objective: trimmed }
  }
  return { verb }
}

/** What the transcript says once a goal command was accepted (M45). */
function goalDoneText(command: GoalCommand): string {
  switch (command.verb) {
    case 'set': {
      return fill(UI_TEXT.goalSetNotice, { objective: command.objective })
    }
    case 'edit': {
      return fill(UI_TEXT.goalEditedNotice, { objective: command.objective })
    }
    case 'pause': {
      return UI_TEXT.goalPausedNotice
    }
    case 'resume': {
      return UI_TEXT.goalResumedNotice
    }
    case 'clear': {
      return UI_TEXT.goalClearedNotice
    }
  }
}

/** Why a goal command was refused, in words (M45; MSP's reasons, captured live). */
function goalRefusalText(verb: GoalCommandVerb, refusal: GoalRefusal): string {
  if (refusal === 'noGoal') {
    return UI_TEXT.goalNone
  }
  const texts: Readonly<Partial<Record<GoalCommandVerb, string>>> = {
    pause: UI_TEXT.goalCannotPause,
    resume: UI_TEXT.goalCannotResume,
    edit: UI_TEXT.goalCannotEdit,
  }
  return texts[verb] ?? UI_TEXT.goalCommandFailed
}

interface ExportNotice {
  readonly level: 'info' | 'warning'
  readonly text: string
}

/** What an export that wrote nothing tells the user (M30); `exported` says nothing. */
function exportNotice(outcome: ExportOutcome): ExportNotice | undefined {
  const notices: Readonly<Partial<Record<ExportOutcome, ExportNotice>>> = {
    logUnavailable: { level: 'warning', text: UI_TEXT.exportLogUnavailable },
    historyUnavailable: { level: 'warning', text: UI_TEXT.exportHistoryUnavailable },
    empty: { level: 'info', text: UI_TEXT.exportNothing },
  }
  return notices[outcome]
}

/** How a session came to this surface, for the log (M39). */
type SessionOrigin = 'started' | 'resumed' | 'forked' | 'continued after a restart'

/** When a turn started and first streamed output, for its end line (M39). */
interface TurnClock {
  readonly startedAt: number
  firstOutputAt: number | undefined
}

/** A turn's end in the log (M39): its result, and how long it and its first output took. */
function turnEndLine(
  event: Extract<AgentEvent, { type: 'turnCompleted' }>,
  clock: TurnClock | undefined,
  now: number,
): string {
  const why = event.reason === undefined ? '' : `: ${event.reason}`
  const durationMs = event.durationMs ?? (clock === undefined ? undefined : now - clock.startedAt)
  const took = durationMs === undefined ? '' : ` after ${String(durationMs)} ms`
  const firstOutput =
    clock?.firstOutputAt === undefined
      ? ''
      : `, first output after ${String(clock.firstOutputAt - clock.startedAt)} ms`
  return `Turn ${event.turnId} ${event.terminal}${why}${took}${firstOutput}`
}

function isContributorModel(modelId: string): boolean {
  return modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX)
}

/**
 * A new conversation that starts from a brief (M79's "Implement in a fresh
 * conversation"; M74's `/handoff` is to reuse it). The old conversation is
 * left as it is (History keeps it) and nothing of it is carried over: the
 * first message is the brief alone, in the starting permission mode.
 */
export interface ConversationBrief {
  /** What the brief is, for the log: never its content, nor a name drawn from it (M39). */
  readonly label: string
  /** The first message as its card shows it, in the user's language. */
  readonly displayText: string
  /** The same message as the model reads it (MODEL_TEXT, English). */
  readonly modelText: string
  /** The brief as a named UTF-8 text file (M54's path on both backends), if it is one. */
  readonly attachment: { readonly name: string; readonly bytes: Uint8Array } | undefined
  /**
   * What the model reads after it (MODEL_TEXT, English), told whether the
   * todo list below was set, which only some backends allow.
   */
  readonly modelNote: (hasSetTodos: boolean) => string
  /** The todo list the conversation starts with, where the backend lets the extension set one. */
  readonly todos: readonly TodoItem[]
  /**
   * Whether the user approved this content here: a Plan-mode reply of this
   * panel's conversation. Anything else (a file from the workspace) is
   * untrusted content (PLAN.md D49): the conversation starts in a mode that
   * asks, whatever `museSpark.initialPermissionMode` says.
   */
  readonly isApproved: boolean
}

/** What `send` takes from a brief for its first message. */
type BriefExtras = Pick<ConversationBrief, 'displayText' | 'modelNote' | 'todos'>

/** What `send` did: whether the host took the message, and whether a brief's todo list was set. */
interface SendOutcome {
  readonly isAccepted: boolean
  readonly hasSetTodos: boolean
}

/** What `startFromBrief` did; a refusal has already said why. */
type BriefStart =
  | { readonly status: 'started'; readonly hasSetTodos: boolean }
  | { readonly status: 'refused' }
  | { readonly status: 'changed' }

/** Where a plan to implement comes from (M79): the reply on screen, or a saved file. */
type PlanSource =
  | { readonly kind: 'reply'; readonly sessionId: string; readonly itemId: string }
  | { readonly kind: 'file'; readonly fileName: string }

const AGENT_MESSAGE_KIND = 'agentMessage'
const USER_MESSAGE_KIND = 'userMessage'
const STEERED_DISPOSITION = 'steered'
const PLAN_MODE: PermissionMode = 'plan'

/**
 * A plan as a conversation's brief (M79): the plan file attached, what to do
 * with it for the model, and its steps as the todo list. Where the backend
 * lets the extension set that list, the note says what it was set to (the
 * model does not see the list otherwise); where it does not (MSP has no todo
 * command), the note asks the model to take the steps as its list. A plan
 * the user approved here is said to be approved; a file from the workspace
 * is untrusted content, and the note says so.
 */
function planBrief(
  relativePath: string,
  bytes: Uint8Array,
  steps: readonly string[],
  isApproved: boolean,
): ConversationBrief {
  const name = JSON.stringify(relativePath)
  return {
    label: planLogName(path.posix.basename(relativePath)),
    displayText: fill(UI_TEXT.planBriefText, { path: relativePath }),
    modelText: fill(MODEL_TEXT.planBriefRequest, { path: relativePath }),
    attachment: { name: relativePath, bytes },
    modelNote: (hasSetTodos) => {
      const lead = fill(isApproved ? MODEL_TEXT.planBriefApproved : MODEL_TEXT.planBriefFromFile, {
        name,
      })
      if (steps.length === 0) {
        return lead
      }
      const todos = hasSetTodos
        ? fill(MODEL_TEXT.planBriefTodosSet, { steps: numberedSteps(steps) })
        : MODEL_TEXT.planBriefTodosAsk
      return `${lead} ${todos}`
    },
    todos: steps.map((step) => ({ text: step, status: PLAN_TODO_PENDING_STATUS })),
    isApproved,
  }
}

/** An error's kind for the log (its code or name), never its message, which may name the plan. */
function errorKind(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }
  return error instanceof Error ? error.name : typeof error
}

export class ConversationController {
  private session: AgentSession | undefined
  private unsubscribe: (() => void) | undefined
  private models: readonly ModelOption[] | undefined
  private modelListing: Promise<void> | undefined
  private skills: readonly SkillOption[] | undefined
  private skillsRefresh: Promise<void> | undefined
  private readonly attachments: AttachmentStore
  /** A clear or session replacement invalidates pending browser file admission. */
  private attachmentGeneration = 0
  /** External session drops invalidate in-flight sends; owned not-loaded recovery does not. */
  private sendInvalidationEpoch = 0
  /** Distinguishes an account stop from an ordinary same-account session switch. */
  private accountStopEpoch = 0
  /** A reloaded panel cannot see the old session while its cancel is pending. */
  private accountStopsInFlight = 0
  /** The latest composer generation seen on this surface's file messages. */
  private webviewAttachmentEpoch = 0

  /** User cards whose file bytes rewind cannot restore across every backend/history path. */
  private readonly fileMessageIds = new Set<string>()
  /** Fresh cards use local IDs until Muse Code serves their durable user item IDs. */
  /** Sessions started or resumed with the `ide` server, whose tools they can call (M68). */
  private readonly ideSessions = new WeakSet<AgentSession>()
  private readonly acceptedUserCards = new Map<
    string,
    { readonly turnId: string; readonly text: string }
  >()
  private modelId: string
  private permissionMode: PermissionMode
  private isSideChat: boolean
  /** Muse Code does not persist a side marker: this panel may resume only its own fork. */
  private readonly sideSessionIds = new Set<string>()
  private effort: EffortLevel = DEFAULT_EFFORT
  private isThinkingEnabled = true
  private activeTurnId: string | undefined
  /**
   * Child sessions this surface has rows for. Their turns reach the parent
   * stream (M48) but never take the parent turn's steering, Stop or Ctrl+B.
   */
  private readonly childSessionIds = new Set<string>()
  private hasWarnedSandbox = false
  /** The contributor model the user said yes to (once per conversation). */
  private confirmedContributor: string | undefined
  /** The workspace's stored sessions once the dialog asked for them (M6). */
  private sessionRecords: Map<string, SessionRecord> | undefined
  private readonly listWatch = new HostWatch()
  private historyWatchEpoch = 0
  private readonly usageWatch = new HostWatch()
  /** Usage belongs to one live host; a restarted host may use another account. */
  private usageHost: AgentHost | undefined
  private latestUsage: SubscriptionUsage | undefined
  private usageEventRevision = 0
  private usageReadSequence = 0
  /** The dictation driver, created on the first press (M9). */
  private dictation: DictationHandle | undefined
  private dictationStatus: DictationStatus = 'idle'
  /** The engine the driver above records with (M35). */
  private dictationEngine: DictationEngine = 'system'
  /**
   * A driver whose engine stopped being the microphone's while it recorded
   * (the review of PR #27): its recording was ended, and it is kept until
   * the transcript of what it already sent arrives or the panel closes.
   */
  private retiredDictation: DictationHandle | undefined
  /**
   * Counts every microphone press (M58): a Muse Voice start waits for the
   * paid-use popup, and a stop pressed meanwhile cancels it.
   */
  private dictationPresses = 0
  /** Approvals "Edit automatically" answered itself (D24): their resolution is labelled so. */
  private readonly autoApproved = new Set<string>()
  /** The remote-window Bypass confirmation, given once per conversation (D24). */
  private hasConfirmedRemoteBypass = false
  /** Said once the surface is ready: why the conversation did not start as configured. */
  private startupNotice: string | undefined
  /** The backend kind of the attached session (a resume only goes to the same kind). */
  private sessionKind: BackendKind | undefined
  /** Stops listening for the host closing this session. */
  private closedWatch: (() => void) | undefined
  /** The session the next message resumes after a restart or a crash (PLAN.md D25). */
  private resumeTarget: { readonly sessionId: string; readonly kind: BackendKind } | undefined
  /** A session start in flight, shared by concurrent callers. */
  private sessionOpening: Promise<AgentSession> | undefined
  /** A replaced opening cannot clear a newer opening's shared slot. */
  private sessionOpeningGeneration = -1
  /** The surface closed: nothing started after this is kept. */
  private isDisposed = false
  /**
   * Turns this session has seen complete (D26): a submission's ack that
   * lands after its own turn finished must not mark that turn running again.
   */
  private readonly finishedTurns = new Set<string>()
  /** Whether the attached session's host renames and forks (D26: not Muse Code 1.3.0 on Windows). */
  private canEditSessions = true
  /** The unsaved files last warned about, so the same set is not repeated (D27). */
  private unsavedNoticeKey = ''
  /** A transcript reload after a delivery gap, and the gaps heard so far. */
  private gapReload: Promise<void> | undefined
  private gapCount = 0
  /** Live goal events after a gap read began take precedence over that read. */
  private goalEventCount = 0
  /** The turns under way, timed for the log (M39). */
  private readonly turnClocks = new Map<string, TurnClock>()
  /** Streamed text not yet posted, and the frame timer that posts it (M39). */
  private pendingDelta: Extract<AgentEvent, { type: 'textDelta' }> | undefined
  private deltaTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * The running turn's shell calls still in the foreground, by item (M46):
   * what Ctrl+B moves to the background.
   */
  private readonly foregroundShells = new Set<string>()
  /** A shell's row can start before its approval is granted (Model API). */
  private readonly pendingShellApprovals = new Set<string>()
  private readonly pausedForegroundShells = new Set<string>()
  /**
   * The turns this panel started in Plan mode that finished with the panel
   * in Plan mode throughout (M79): only their replies are plans. A restart
   * keeps them (the resumed session has the same turns); a new conversation
   * forgets them.
   */
  private readonly planTurnIds = new Set<string>()
  /**
   * Plan-mode turns sent but not finished yet, running or queued: leaving
   * Plan mode drops them all, since any of them may then act.
   */
  private readonly pendingPlanTurnIds = new Set<string>()
  /** A plan action (save, implement, Plans…) is running (M79). */
  private isPlanActionRunning = false

  public constructor(private readonly deps: ConversationDeps) {
    this.modelId = deps.modelId
    this.isSideChat = deps.surface.isSideChat === true
    const restoredSideId = this.isSideChat ? deps.surface.takeRestoredSessionId() : undefined
    if (restoredSideId !== undefined) {
      this.sideSessionIds.add(restoredSideId)
    }
    this.permissionMode = this.isSideChat ? 'plan' : deps.initialPermissionMode
    if (this.permissionMode === BYPASS_MODE && !deps.isBypassAllowed()) {
      // The initial-mode setting alone cannot switch approvals off; the
      // explicit allow setting must be on too, as in Claude Code.
      deps.log.warn(
        'museSpark.initialPermissionMode is bypassPermissions but allowDangerouslySkipPermissions is off; starting in Manual',
      )
      this.permissionMode = FALLBACK_MODE
    } else if (this.permissionMode === BYPASS_MODE && deps.isRemoteWindow) {
      // A dev container can set both settings (D24): never start there without approvals.
      deps.log.warn('Bypass permissions requested in a remote window; starting in Manual')
      this.permissionMode = FALLBACK_MODE
      this.startupNotice = UI_TEXT.bypassRemoteStartedManual
    }
    this.attachments = new AttachmentStore(deps.newAttachmentId)
  }

  private post(message: HostToWebviewMessage): void {
    // Streamed text still waiting goes first, so nothing overtakes it.
    this.flushDelta()
    this.deps.surface.post(message)
  }

  /**
   * Streamed text is posted at most once a frame (M39): consecutive deltas of
   * one item's field join, and any other message posts them first.
   */
  private queueDelta(event: Extract<AgentEvent, { type: 'textDelta' }>): void {
    const pending = this.pendingDelta
    if (pending?.itemId === event.itemId && pending.field === event.field) {
      this.pendingDelta = { ...pending, delta: pending.delta + event.delta }
    } else {
      this.flushDelta()
      this.pendingDelta = event
    }
    this.deltaTimer ??= setTimeout(() => {
      this.deltaTimer = undefined
      this.flushDelta()
    }, DELTA_BATCH_MS)
  }

  private flushDelta(): void {
    if (this.deltaTimer !== undefined) {
      clearTimeout(this.deltaTimer)
      this.deltaTimer = undefined
    }
    const pending = this.pendingDelta
    if (pending === undefined) {
      return
    }
    this.pendingDelta = undefined
    this.deps.surface.post({ type: 'agentEvent', event: pending })
  }

  /**
   * Says `text` in the panel. A warning or an error goes to the log as well
   * (M39): "Open log" and a support report hold every failure the user saw.
   */
  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    if (level === 'error') {
      this.deps.log.error(`${NOTICE_PREFIX}${text}`)
    } else if (level === 'warning') {
      this.deps.log.warn(`${NOTICE_PREFIX}${text}`)
    }
    this.say(level, text)
  }

  /** Says `text` in the panel only: for a failure already logged in more detail. */
  private say(level: 'info' | 'warning' | 'error', text: string): void {
    this.post({ type: 'notice', level, text })
  }

  private contextLimitFor(modelId: string): number | undefined {
    return this.models?.find((model) => model.modelId === modelId)?.contextLimit
  }

  private postSessionInfo(modelId: string, shouldResetSideChat = false): void {
    const contextLimit = this.contextLimitFor(modelId)
    this.post({
      type: 'sessionInfo',
      modelId,
      ...((this.isSideChat || shouldResetSideChat) && { sideChat: this.isSideChat }),
      ...(contextLimit !== undefined && { contextLimit }),
      ...(this.session !== undefined && { sessionId: this.session.sessionId }),
      // Said only where it is so (D26): the panel then offers neither.
      ...(!this.canEditSessions && { canEditSessions: false }),
    })
  }

  private postSessionList(): void {
    if (this.sessionRecords === undefined) {
      return
    }
    const sessions: ReturnType<typeof toSessionRow>[] = []
    for (const record of this.sessionRecords.values()) {
      if (!this.deps.surface.isSideChat || this.sideSessionIds.has(record.sessionId)) {
        sessions.push(toSessionRow(record))
      }
    }
    this.post({
      type: 'sessionList',
      sessions,
      archivedIds: [...this.deps.sessions.archivedIds()],
    })
  }

  /** Remember when this surface's session was last active (the restore rule). */
  private noteActivity(): void {
    if (this.session === undefined) {
      return
    }
    void this.deps.sessions.setLastSession({
      sessionId: this.session.sessionId,
      at: this.deps.now(),
    })
  }

  private setTitle(name: string | undefined): void {
    this.deps.surface.setTitle(name ?? UI_TEXT.untitledConversation)
  }

  private postComposerState(): void {
    this.post({
      type: 'composerState',
      effort: this.effort,
      isThinkingEnabled: this.isThinkingEnabled,
      permissionMode: this.permissionMode,
    })
  }

  private postSkills(): void {
    if (this.skills !== undefined) {
      this.post({ type: 'skillList', skills: [...this.skills] })
    }
  }

  /** `turn/cancel` for a session being left: a refusal is only worth a log line. */
  private async cancelQuietly(session: AgentSession): Promise<void> {
    try {
      await session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`turn/cancel before leaving the session failed: ${describe(error)}`)
    }
  }

  /**
   * Lets go of the session. A turn still running is cancelled first unless
   * the caller says the host is already gone or has been told (PLAN.md D25):
   * a dropped turn would otherwise run on, unwatched and billed.
   */
  private dropSession(isTurnCancelled = true, isOwnedRecovery = false): void {
    this.attachmentGeneration += 1
    this.sessionOpening = undefined
    const didHaveModels = this.models !== undefined
    const didHaveSkills = this.skills !== undefined
    this.models = undefined
    this.modelListing = undefined
    this.skills = undefined
    this.skillsRefresh = undefined
    if (!this.isDisposed) {
      if (didHaveModels) {
        this.post({ type: 'modelList', models: [] })
      }
      if (didHaveSkills) {
        this.post({ type: 'skillList', skills: [] })
      }
    }
    if (!isOwnedRecovery) {
      this.sendInvalidationEpoch += 1
    }
    const { session } = this
    if (isTurnCancelled && session !== undefined && this.activeTurnId !== undefined) {
      void this.cancelQuietly(session)
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
    // A key replacement may sign straight back in on the same Model API
    // backend. Clear the old account's prompt names before that async restart.
    if (session?.schedules !== undefined && !this.isDisposed) {
      this.forward({ type: 'schedulesChanged', jobs: [] })
    }
    this.closedWatch?.()
    this.closedWatch = undefined
    if (session !== undefined) {
      const surfaces = sessionSurfaces.get(session)
      surfaces?.delete(this)
      if (surfaces?.size === 0) {
        sessionSurfaces.delete(session)
      }
    }
    session?.dispose()
    this.session = undefined
    this.activeTurnId = undefined
    this.fileMessageIds.clear()
    this.acceptedUserCards.clear()
    this.childSessionIds.clear()
    this.finishedTurns.clear()
    this.forgetForegroundShells()
    this.pendingShellApprovals.clear()
    this.pausedForegroundShells.clear()
    // A turn that ended with its session, no end heard: said, and forgotten.
    for (const turnId of this.turnClocks.keys()) {
      this.deps.log.info(`Turn ${turnId} ended with its session`)
    }
    this.turnClocks.clear()
  }

  /**
   * Ends the running turn in the webview when the host cannot say so any
   * more (it stopped, restarted or closed the session, D25): the reply stops
   * streaming and its cards go, as for a turn the host completed.
   */
  private endTurnLocally(terminal: 'cancelled' | 'failed', reason: string): void {
    const turnId = this.activeTurnId
    if (turnId === undefined) {
      return
    }
    this.activeTurnId = undefined
    const event = { type: 'turnCompleted', turnId, terminal, reason } as const
    // The same end line and clock as a turn the host ended (the review of PR #20).
    this.endTurnClock(event)
    this.forward(event)
  }

  /** A turn's end in the log, and its clock gone (M39). */
  private endTurnClock(event: Extract<AgentEvent, { type: 'turnCompleted' }>): void {
    this.deps.log.info(turnEndLine(event, this.turnClocks.get(event.turnId), this.deps.now()))
    this.turnClocks.delete(event.turnId)
  }

  /** The session to pick up on the next message, on a host of the same kind. */
  private rememberForResume(session: AgentSession | undefined): void {
    this.resumeTarget =
      session === undefined || this.sessionKind === undefined
        ? undefined
        : { sessionId: session.sessionId, kind: this.sessionKind }
  }

  /** The host closed this panel's session (idle eviction, a lease lost): resume on the next message. */
  private sessionClosedByHost(reason: string): void {
    this.rememberForResume(this.session)
    this.endTurnLocally('failed', `${UI_TEXT.sessionClosedByHost} (${reason})`)
    this.dropSession(false)
    this.notice(
      'info',
      `${UI_TEXT.sessionClosedByHost} (${reason}). ${UI_TEXT.sessionResumesOnSend}`,
    )
  }

  /**
   * "Edit automatically" (PLAN.md D24): the allow-once choice for a plain
   * file write, which the controller answers itself; undefined for anything
   * the user must see (commands, protected writes, escalations, other modes).
   */
  private autoApprovalChoice(
    event: Extract<AgentEvent, { type: 'approvalRequested' }>,
  ): ApprovalChoice | undefined {
    return this.session === undefined || sessionSurfaces.get(this.session)?.size !== 1
      ? undefined
      : editAutomaticallyChoice(event, this.permissionMode)
  }

  /** Answers an edit approval on the user's behalf; shows the card if the host refuses. */
  private async autoApprove(
    event: Extract<AgentEvent, { type: 'approvalRequested' }>,
    choice: ApprovalChoice,
  ): Promise<void> {
    const session = this.session
    if (session === undefined) {
      return
    }
    this.autoApproved.add(event.approvalId)
    this.deps.log.info(
      `Approval ${event.approvalId} answered by Edit automatically: ${choice.choiceId}`,
    )
    try {
      await session.decideApproval({
        approvalId: event.approvalId,
        choiceId: choice.choiceId,
        requirementId: event.requirementId,
      })
    } catch (error: unknown) {
      this.autoApproved.delete(event.approvalId)
      this.deps.log.warn(`Edit automatically could not approve: ${describe(error)}`)
      this.forward(event)
    }
  }

  /** An event as the webview sees it, plus the unread mark. */
  private forward(event: AgentEvent): void {
    if (event.type === 'textDelta') {
      this.queueDelta(event)
      return
    }
    if (event.type === 'approvalRequested' && event.isReplayed !== undefined) {
      const shown = { ...event }
      delete shown.isReplayed
      this.post({ type: 'agentEvent', event: shown })
    } else {
      this.post({ type: 'agentEvent', event })
    }
    if (ATTENTION_EVENTS.has(event.type)) {
      this.deps.surface.markUnread()
    }
  }

  /**
   * Live delivery dropped events (MSP `view/gap`, D26): the transcript is
   * re-read whole, once more if another gap arrived during the read.
   */
  private async reloadAfterGaps(generation: number): Promise<void> {
    let handled = -1
    while (generation === this.sendInvalidationEpoch && handled !== this.gapCount) {
      handled = this.gapCount
      // The panel's session now: a gap is only ever heard from the attached one.
      const { session } = this
      if (session === undefined) {
        break
      }
      const goalEventsAtStart = this.goalEventCount
      try {
        const host = await this.deps.ensureHost()
        if (generation !== this.sendInvalidationEpoch || this.session !== session) {
          break
        }
        const history = await host.readSession(session.sessionId, { recoverGoal: true })
        if (generation !== this.sendInvalidationEpoch || this.session !== session) {
          break
        }
        this.postHistory(
          session.sessionId,
          history,
          this.activeTurnId,
          goalEventsAtStart === this.goalEventCount,
        )
        this.notice('info', UI_TEXT.viewGapReloaded)
      } catch (error: unknown) {
        if (generation === this.sendInvalidationEpoch && this.session === session) {
          this.notice('warning', `${UI_TEXT.viewGapReloadFailed}: ${describe(error)}`)
        }
      }
    }
  }

  private onViewGap(): void {
    this.gapCount += 1
    if (this.gapReload !== undefined) {
      return
    }
    const reload = this.reloadAfterGaps(this.sendInvalidationEpoch)
    this.gapReload = reload
    void reload.finally(() => {
      if (this.gapReload === reload) {
        this.gapReload = undefined
      }
    })
  }

  private noteFileCard(item: ItemSnapshot): void {
    if (
      item.kind === 'userMessage' &&
      item.attachments?.some((attachment) => attachment.type === 'file')
    ) {
      this.fileMessageIds.add(item.itemId)
    }
  }

  private onEvent(event: AgentEvent): void {
    // The controller's own events (D26): never forwarded to the webview.
    if (event.type === 'viewGap') {
      this.onViewGap()
      return
    }
    if (event.type === 'goalChanged') {
      this.goalEventCount += 1
    } else if (event.type === 'backendNotice') {
      this.notice(event.level, event.text)
      return
    }
    if (event.type === 'approvalRequested') {
      if (SHELL_TOOLS.has(event.toolName)) {
        this.noteShellApprovalRequested(event.itemId)
      }
      // The tool, never its input (M39).
      this.deps.log.info(`Approval ${event.approvalId} asked for ${event.toolName}`)
      const choice = this.autoApprovalChoice(event)
      if (choice !== undefined) {
        void this.autoApprove(event, choice)
        return
      }
    } else if (event.type === 'approvalResolved') {
      this.noteShellApprovalResolved(event)
      if (this.autoApproved.delete(event.approvalId)) {
        this.forward({ ...event, resolvedBy: UI_TEXT.editAutomaticallyResolver })
        return
      }
    }
    this.forward(event)
    this.track(event)
  }

  /** The controller's own bookkeeping for an event the webview was sent. */
  /**
   * A turn of a known child session (M48): its row names the session id, and
   * a Model API child's turn ids prefix it, as the panel already reads them.
   */
  private isChildTurn(turnId: string): boolean {
    for (const childSessionId of this.childSessionIds) {
      if (turnId === childSessionId || turnId.startsWith(`${childSessionId}:`)) {
        return true
      }
    }
    return false
  }

  /** Remember a subagent row's child session, live or from a loaded history. */
  private noteSubagentRow(item: ItemSnapshot): void {
    if (item.kind === SUBAGENT_ITEM_KIND && item.childSessionId !== undefined) {
      this.childSessionIds.add(item.childSessionId)
    }
  }

  private track(event: AgentEvent): void {
    switch (event.type) {
      case 'turnStarted': {
        // A child's own turn reaches the parent stream; the running parent
        // turn keeps the steering, Stop and Ctrl+B (the review of PR #35).
        if (this.isChildTurn(event.turnId)) {
          break
        }
        this.activeTurnId = event.turnId
        this.turnClocks.set(event.turnId, { startedAt: this.deps.now(), firstOutputAt: undefined })
        this.deps.log.info(
          `Turn ${event.turnId} started in session ${this.session?.sessionId ?? '(none)'}`,
        )
        break
      }
      case 'textDelta': {
        const clock =
          this.activeTurnId === undefined ? undefined : this.turnClocks.get(this.activeTurnId)
        if (clock !== undefined && clock.firstOutputAt === undefined) {
          clock.firstOutputAt = this.deps.now()
        }
        break
      }
      case 'turnWithdrawn': {
        // It will never run: a late acceptance must not make it the running turn.
        this.finishedTurns.add(event.turnId)
        this.turnClocks.delete(event.turnId)
        this.pendingPlanTurnIds.delete(event.turnId)
        break
      }
      case 'turnCompleted': {
        this.endTurnClock(event)
        this.finishedTurns.add(event.turnId)
        // A Plan-mode turn that finished with the panel in Plan mode throughout (M79).
        if (this.pendingPlanTurnIds.delete(event.turnId)) {
          this.planTurnIds.add(event.turnId)
        }
        // Another turn completing (a subagent's) leaves this one running.
        if (this.activeTurnId === event.turnId) {
          this.activeTurnId = undefined
          // What the turn left running is its own no more (M46).
          this.forgetForegroundShells()
          this.pendingShellApprovals.clear()
          this.pausedForegroundShells.clear()
        }
        this.noteActivity()
        if (event.terminal === 'failed' && event.errorKind === AUTH_REQUIRED_ERROR_KIND) {
          this.deps.auth.markAuthRequired(event.reason ?? AUTH_REQUIRED_ERROR_KIND)
        }
        break
      }
      case 'sessionNamed': {
        this.setTitle(event.name)
        break
      }
      case 'sessionStatus': {
        if (event.status === IDLE_STATUS) {
          this.activeTurnId = undefined
          this.forgetForegroundShells()
          this.pendingShellApprovals.clear()
          this.pausedForegroundShells.clear()
        }
        break
      }
      case 'effortChanged': {
        if (isEffortLevel(event.effort) && event.effort !== this.effort) {
          this.effort = event.effort
          this.postComposerState()
        }
        break
      }
      case 'skillsChanged': {
        if (this.session !== undefined) {
          void this.refreshSkills(this.session)
        }
        break
      }
      case 'itemStarted': {
        this.noteFileCard(event.item)
        this.noteForegroundShell(event.item)
        this.noteSubagentRow(event.item)
        break
      }
      case 'itemUpdated':
      case 'itemCompleted': {
        this.noteFileCard(event.item)
        if (event.type === 'itemCompleted' || event.item.status !== IN_PROGRESS_STATUS) {
          this.pendingShellApprovals.delete(event.item.itemId)
          this.pausedForegroundShells.delete(event.item.itemId)
        }
        this.noteForegroundShell(event.item)
        this.noteSubagentRow(event.item)
        this.noteSandboxFailure(event.item.failureReason)
        // A `!` command says it in its output (captured 2026-09-25, M46).
        if (event.item.kind === USER_SHELL_ITEM_KIND) {
          this.noteSandboxFailure(event.item.visibleOutput)
        }
        break
      }
      default: {
        break
      }
    }
  }

  /**
   * Keeps the set Ctrl+B acts on (M46): the running turn's shell calls, while
   * they run and are not yet in the background.
   */
  private noteForegroundShell(item: ItemSnapshot): void {
    const isForeground = this.isForegroundShell(item, this.activeTurnId)
    const wasForeground = this.foregroundShells.has(item.itemId)
    if (isForeground === wasForeground) {
      return
    }
    if (isForeground) {
      this.foregroundShells.add(item.itemId)
    } else {
      this.foregroundShells.delete(item.itemId)
    }
    this.deps.onForegroundTasksChanged()
  }

  private noteShellApprovalRequested(itemId: string): void {
    this.pendingShellApprovals.add(itemId)
    if (!this.foregroundShells.delete(itemId)) {
      return
    }
    this.pausedForegroundShells.add(itemId)
    this.deps.onForegroundTasksChanged()
  }

  private noteShellApprovalResolved(
    event: Extract<AgentEvent, { type: 'approvalResolved' }>,
  ): void {
    this.pendingShellApprovals.delete(event.itemId)
    if (
      !this.pausedForegroundShells.delete(event.itemId) ||
      event.decision !== APPROVED_DECISION ||
      this.activeTurnId === undefined
    ) {
      return
    }
    this.foregroundShells.add(event.itemId)
    this.deps.onForegroundTasksChanged()
  }

  private isForegroundShell(item: ItemSnapshot, activeTurnId: string | undefined): boolean {
    return (
      item.kind === TOOL_CALL_KIND &&
      item.tool !== undefined &&
      SHELL_TOOLS.has(item.tool) &&
      item.status === IN_PROGRESS_STATUS &&
      item.background !== true &&
      !this.pendingShellApprovals.has(item.itemId) &&
      item.turnId !== undefined &&
      item.turnId === activeTurnId
    )
  }

  /** A resume or gap reload replaces the transcript, so rebuild Ctrl+B too. */
  private restoreForegroundShells(
    items: readonly ItemSnapshot[],
    activeTurnId: string | undefined,
  ): void {
    const restored = new Set(
      items.filter((item) => this.isForegroundShell(item, activeTurnId)).map((item) => item.itemId),
    )
    if (
      restored.size === this.foregroundShells.size &&
      [...restored].every((itemId) => this.foregroundShells.has(itemId))
    ) {
      return
    }
    this.foregroundShells.clear()
    for (const itemId of restored) {
      this.foregroundShells.add(itemId)
    }
    this.deps.onForegroundTasksChanged()
  }

  private forgetForegroundShells(): void {
    if (this.foregroundShells.size === 0) {
      return
    }
    this.foregroundShells.clear()
    this.deps.onForegroundTasksChanged()
  }

  /**
   * One notice per session about the shell sandbox (PLAN.md D12): `auto`
   * turned it off for a Windows profile workspace, or the user forced it on
   * where the CLI cannot run commands in the workspace.
   */
  private noteShellSandbox(workspaceRoot: string): void {
    const posture = this.deps.shellSandbox()
    if (posture.reason === 'profileWorkspace') {
      this.notice('info', UI_TEXT.sandboxOffProfileNotice)
      return
    }
    const isLimited = isProfileWorkspace(
      this.deps.platform,
      workspaceRoot,
      this.deps.userProfileDir,
    )
    if (isLimited && posture.isSandboxed) {
      this.notice('warning', UI_TEXT.sandboxProfileNotice)
    }
  }

  /** The shell tool's "sandbox not set up" failure gets one actionable notice; a `!` row's too (M46). */
  private noteSandboxFailure(text: string | undefined): void {
    if (text === undefined || this.hasWarnedSandbox) {
      return
    }
    if (
      !text.includes(SANDBOX_FAILURE_MARKER) &&
      !text.includes(USER_SHELL_SANDBOX_FAILURE_MARKER)
    ) {
      return
    }
    this.hasWarnedSandbox = true
    this.notice('warning', UI_TEXT.sandboxNotice)
    this.deps.onSandboxUnavailable()
  }

  private openLink(url: string): void {
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      this.notice('warning', UI_TEXT.linkSchemeRefused)
      return
    }
    if (!ALLOWED_LINK_SCHEMES.has(scheme)) {
      this.notice('warning', UI_TEXT.linkSchemeRefused)
      return
    }
    this.deps.openExternal(url)
  }

  private async decideApproval(
    message: Extract<ConversationMessage, { type: 'decideApproval' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    this.deps.log.info(`Approval ${message.approvalId} answered: ${message.choiceId}`)
    try {
      await this.session.decideApproval({
        approvalId: message.approvalId,
        choiceId: message.choiceId,
        requirementId: message.requirementId,
        ...(message.feedback !== undefined && { feedback: message.feedback }),
      })
    } catch (error: unknown) {
      if (isPromptSettledError(error)) {
        this.promptSettled(error, { approvalId: message.approvalId })
        return
      }
      // Muse Code 1.3.0 on Windows can fail the reply to `approval/decide`
      // on its own ledger write after applying the decision (the tool runs
      // on); the wording must not claim the decision was refused. The card
      // opens again: if the decision did apply, its resolve still closes it.
      this.notice('warning', `${UI_TEXT.decisionErrorNotice}: ${describe(error)}`)
      this.post({ type: 'approvalReopened', approvalId: message.approvalId })
    }
  }

  /**
   * A decision or answer that arrived after its prompt had moved (D26): the
   * user is told it was not needed, and a prompt the host no longer holds
   * loses its card (an answered or advanced one follows the host's events).
   */
  private promptSettled(
    error: PromptSettledError,
    prompt: { readonly approvalId: string } | { readonly userInputId: string },
  ): void {
    this.notice('info', promptSettledText(error.reason))
    if (error.reason === 'gone') {
      this.post({ type: 'promptDropped', ...prompt })
    }
  }

  /** The question card's Cancel: the prompt is declined and the model told (M16). */
  private async cancelQuestion(userInputId: string): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.cancelQuestions(userInputId)
    } catch (error: unknown) {
      if (isPromptSettledError(error)) {
        this.promptSettled(error, { userInputId })
        return
      }
      this.notice('error', `${UI_TEXT.questionCancelFailed}: ${describe(error)}`)
    }
  }

  private async answerQuestion(
    message: Extract<ConversationMessage, { type: 'answerQuestion' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.answerQuestions(message.userInputId, message.answers)
    } catch (error: unknown) {
      if (isPromptSettledError(error)) {
        this.promptSettled(error, { userInputId: message.userInputId })
        return
      }
      this.notice('error', `${UI_TEXT.answerNotAccepted}: ${describe(error)}`)
    }
  }

  /** The question card's Explain instead (M46): the model reads the text and decides again. */
  private async clarifyQuestion(
    message: Extract<ConversationMessage, { type: 'clarifyQuestion' }>,
  ): Promise<void> {
    const text = message.text.trim()
    if (text === '' || this.session === undefined) {
      return
    }
    try {
      await this.session.clarifyQuestions(message.userInputId, text)
    } catch (error: unknown) {
      if (isPromptSettledError(error)) {
        this.promptSettled(error, { userInputId: message.userInputId })
        return
      }
      // An error notice unlocks the card, as a refused answer does (M25).
      this.notice('error', `${UI_TEXT.clarifyNotAccepted}: ${describe(error)}`)
    }
  }

  /**
   * One task command (M46): moving a running command to the background, or
   * stopping a task. Refused, the user is told why and the row's button is
   * free again.
   */
  private async taskCommand(
    itemId: string,
    run: (session: AgentSession) => Promise<void>,
    failure: string,
  ): Promise<void> {
    const { session } = this
    if (session === undefined) {
      this.post({ type: 'taskRefused', itemId })
      return
    }
    try {
      await run(session)
    } catch (error: unknown) {
      this.notice('warning', `${failure}: ${describe(error)}`)
      this.post({ type: 'taskRefused', itemId })
    }
  }

  private async moveToBackground(itemId: string): Promise<void> {
    this.deps.log.info(`Moving task ${itemId} to the background`)
    await this.taskCommand(
      itemId,
      (session) => session.moveToBackground(itemId),
      UI_TEXT.moveToBackgroundFailed,
    )
  }

  private async stopTask(itemId: string): Promise<void> {
    this.deps.log.info(`Stopping task ${itemId}`)
    await this.taskCommand(itemId, (session) => session.stopTask(itemId), UI_TEXT.stopTaskFailed)
  }

  private async stopAllTasks(): Promise<void> {
    if (this.session === undefined) {
      return
    }
    this.deps.log.info('Stopping every background task')
    try {
      await this.session.stopAllTasks()
    } catch (error: unknown) {
      this.notice('warning', `${UI_TEXT.stopTaskFailed}: ${describe(error)}`)
    }
  }

  /**
   * A `!` prompt (M46, PLAN.md D39): the user's own command, run by the
   * backend outside any turn, never in Restricted Mode (D13). The user typed
   * it, so no approval card asks again, whatever the permission mode. One
   * that does not run comes back to the prompt with the reason.
   */
  private async runUserShell(command: string): Promise<void> {
    const trimmed = command.trim()
    if (trimmed === '') {
      return
    }
    if (!this.deps.isWorkspaceTrusted()) {
      this.post({ type: 'userShellRefused', command: trimmed, reason: UI_TEXT.userShellRestricted })
      return
    }
    if (!this.isAuthAdmitted()) {
      this.post({ type: 'userShellRefused', command: trimmed, reason: UI_TEXT.notSignedInReason })
      return
    }
    const workspaceRoot = this.deps.workspaceRoot
    if (workspaceRoot === undefined) {
      this.post({ type: 'userShellRefused', command: trimmed, reason: UI_TEXT.noWorkspaceReason })
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const session = await this.ensureSession(workspaceRoot)
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      const host = await this.deps.ensureHost()
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      this.deps.log.info(`Running a command the user typed (${String(trimmed.length)} characters)`)
      await this.runResuming(host, session, (current) => current.runUserShell(trimmed))
      if (generation === this.sendInvalidationEpoch && this.isAuthAdmitted()) {
        this.noteActivity()
      }
    } catch (error: unknown) {
      if (generation !== this.sendInvalidationEpoch || !this.isAuthAdmitted()) {
        return
      }
      const reason = `${UI_TEXT.userShellFailed}: ${describe(error)}`
      this.deps.log.warn(reason)
      this.post({ type: 'userShellRefused', command: trimmed, reason })
    }
  }

  private async readOutput(
    message: Extract<ConversationMessage, { type: 'readOutput' }>,
  ): Promise<void> {
    const session = this.session
    if (session === undefined) {
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const page = await session.readOutput({
        itemId: message.itemId,
        outputRef: message.outputRef,
        offsetBytes: message.offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
      if (
        this.isDisposed ||
        generation !== this.sendInvalidationEpoch ||
        this.session !== session
      ) {
        return
      }
      this.post({
        type: 'outputPage',
        itemId: message.itemId,
        outputRef: message.outputRef,
        offsetBytes: page.offsetBytes,
        byteLen: page.byteLen,
        content: page.content,
        eof: page.eof,
      })
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.session === session) {
        this.notice('error', `${UI_TEXT.outputLoadFailed}: ${describe(error)}`)
      }
    }
  }

  /** A tool row's picture (M43): the file as a data URI, or why it cannot be shown. */
  private async readToolImage(itemId: string, imagePath: string): Promise<void> {
    const generation = this.sendInvalidationEpoch
    let result: ToolImageResult
    try {
      result = await this.deps.readToolImage(imagePath)
    } catch (error: unknown) {
      result = { ok: false, reason: describe(error) }
    }
    if (generation !== this.sendInvalidationEpoch) {
      return
    }
    if (!result.ok) {
      this.deps.log.info(`tool image ${imagePath} not shown: ${result.reason}`)
    }
    this.post({
      type: 'toolImage',
      itemId,
      path: imagePath,
      ...(result.ok ? { dataUri: result.dataUri } : { error: result.reason }),
    })
  }

  private async insertCode(text: string): Promise<void> {
    if (!(await this.deps.insertCode(text))) {
      this.notice('info', UI_TEXT.noEditorForInsert)
    }
  }

  private async applyCode(text: string): Promise<void> {
    if (!(await this.deps.applyCode(text))) {
      this.notice('info', UI_TEXT.noEditorForApply)
    }
  }

  /** The whole stored patch document (small; paged only in principle). */
  /** A tool row's path: the file in an editor, the changed lines selected when known (M16). */
  private async openFile(
    message: Extract<ConversationMessage, { type: 'openFile' }>,
  ): Promise<void> {
    try {
      await this.deps.openFile(
        message.path,
        message.startLine === undefined || message.endLine === undefined
          ? undefined
          : { startLine: message.startLine, endLine: message.endLine },
      )
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.openFileFailed}: ${describe(error)}`)
    }
  }

  /** A tool output as an editor tab: the stored output in full, else the transcript's copy (M15). */
  private async openOutput(
    message: Extract<ConversationMessage, { type: 'openOutput' }>,
  ): Promise<void> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation)) {
      return
    }
    const tabId = message.itemId.slice(-OUTPUT_TAB_ID_LENGTH)
    const title = fill(UI_TEXT.toolOutputTitle, { tool: message.label, id: tabId })
    try {
      const stored =
        message.outputRef === undefined
          ? undefined
          : await this.fetchPatch(
              session,
              generation,
              message.itemId,
              message.outputRef,
              OUTPUT_DOCUMENT_MAX_PAGES,
            )
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      await this.deps.openDocument(title, stored ?? message.text)
    } catch (error: unknown) {
      if (this.isCurrentSessionAction(session, generation)) {
        this.notice('error', `${UI_TEXT.openOutputFailed}: ${describe(error)}`)
      }
    }
  }

  private async fetchPatch(
    session: AgentSession,
    generation: number,
    itemId: string,
    outputRef: string,
    maxPages = PATCH_DOCUMENT_MAX_PAGES,
  ): Promise<string | undefined> {
    let content = ''
    let offsetBytes = 0
    for (let page = 0; page < maxPages; page += 1) {
      if (!this.isCurrentSessionAction(session, generation)) {
        return undefined
      }
      const chunk = await session.readOutput({
        itemId,
        outputRef,
        offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
      if (!this.isCurrentSessionAction(session, generation)) {
        return undefined
      }
      content += chunk.content
      if (chunk.eof) {
        return content
      }
      offsetBytes = chunk.offsetBytes + chunk.byteLen
    }
    throw new Error(`stored output ${outputRef} is larger than expected`)
  }

  /** "Rewind code to here": the edits after a message, reverted newest first (M13). */
  private async rewindCode(edits: readonly EditRef[]): Promise<void> {
    if (edits.length === 0) {
      this.notice('info', UI_TEXT.rewindNothing)
      return
    }
    const generation = this.sendInvalidationEpoch
    for (const edit of edits) {
      if (generation !== this.sendInvalidationEpoch || this.accountStopsInFlight > 0) {
        return
      }
      await this.reviewEdit('revert', edit.itemId, edit.outputRef)
    }
    if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
      this.notice('info', plural(UI_TEXT.rewindDone, edits.length))
    }
  }

  private async reviewEdit(
    action: 'openDiff' | 'revert',
    itemId: string,
    outputRef: string,
  ): Promise<void> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation)) {
      return
    }
    try {
      const patch = await this.fetchPatch(session, generation, itemId, outputRef)
      if (patch === undefined || !this.isCurrentSessionAction(session, generation)) {
        return
      }
      const notices = await this.deps.editReview[action](itemId, patch)
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      for (const notice of notices) {
        this.notice(notice.level, notice.text)
      }
    } catch (error: unknown) {
      if (this.isCurrentSessionAction(session, generation)) {
        this.notice('error', `${UI_TEXT.editReviewFailed}: ${describe(error)}`)
      }
    }
  }

  /** One `model/list` at a time: the warm-up and the first send may overlap (M15). */
  private async ensureModels(host: AgentHost): Promise<void> {
    if (this.models !== undefined) {
      return
    }
    const listing = this.modelListing ?? this.listModels(host, this.attachmentGeneration)
    this.modelListing = listing
    try {
      await listing
    } finally {
      if (this.modelListing === listing) {
        this.modelListing = undefined
      }
    }
  }

  private async listModels(host: AgentHost, generation: number): Promise<void> {
    const listed = await host.listModels()
    if (this.isDisposed || this.attachmentGeneration !== generation) {
      return
    }
    const models = this.deps.isConfidentialWorkspace()
      ? listed.filter((model) => !isContributorModel(model.modelId))
      : listed
    this.models = models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      ...(model.contextLimit !== undefined && { contextLimit: model.contextLimit }),
      isDefault: model.isDefault,
    }))
    this.post({ type: 'modelList', models: [...this.models] })
  }

  /** Whether the session took the effort; a refusal is said, and the turn still goes. */
  private async applyEffort(session: AgentSession): Promise<boolean> {
    try {
      await session.setReasoningEffort(effortForThinking(this.effort, this.isThinkingEnabled))
      return true
    } catch (error: unknown) {
      this.deps.log.warn(`session/setReasoningEffort failed: ${describe(error)}`)
      this.say('warning', `${UI_TEXT.effortNotApplied}: ${describe(error)}`)
      return false
    }
  }

  private async loadSkills(session: AgentSession, generation: number): Promise<void> {
    try {
      const skills = await session.listSkills()
      if (this.session !== session || this.attachmentGeneration !== generation || this.isDisposed) {
        return
      }
      this.skills = skills.map((skill) => ({
        selector: skill.selector,
        displayName: skill.displayName,
        description: skill.description,
        ...(skill.argumentHint !== undefined && { argumentHint: skill.argumentHint }),
      }))
    } catch (error: unknown) {
      if (this.session !== session || this.attachmentGeneration !== generation || this.isDisposed) {
        return
      }
      this.deps.log.warn(`skill/list failed: ${describe(error)}`)
      this.skills = []
    }
    this.postSkills()
  }

  /** Re-list the skills; concurrent callers share the in-flight request. */
  private async refreshSkills(session: AgentSession): Promise<void> {
    if (this.session !== session) {
      return
    }
    const loading = this.skillsRefresh ?? this.loadSkills(session, this.attachmentGeneration)
    this.skillsRefresh = loading
    try {
      await loading
    } finally {
      if (this.skillsRefresh === loading) {
        this.skillsRefresh = undefined
      }
    }
  }

  /** The IDE tool server config for a new or resumed session, when granted. */
  private async mcpServersFor(
    host: AgentHost,
  ): Promise<Readonly<Record<string, SessionMcpHttpServer>> | undefined> {
    if (!host.info.grantedCapabilities.includes(IDE_MCP_CAPABILITY)) {
      return undefined
    }
    const ideEndpoint = await this.deps.ideMcpEndpoint()
    return ideEndpoint === undefined ? undefined : { [IDE_MCP_SERVER_NAME]: ideEndpoint }
  }

  private sideResumeOptions(host: AgentHost): { readonly requireSideChat: true } | undefined {
    return this.deps.surface.isSideChat === true && host.info.kind === 'modelApi'
      ? { requireSideChat: true }
      : undefined
  }

  /** Take a session as this surface's: events, composer state, skills. */
  private async attach(
    host: AgentHost,
    session: AgentSession,
    origin: SessionOrigin,
  ): Promise<void> {
    const generation = this.attachmentGeneration
    if (origin === 'started' && this.deps.surface.isSideChat === true) {
      this.sideSessionIds.add(session.sessionId)
    }
    this.deps.log.info(
      `Session ${session.sessionId} ${origin} on the ${host.info.kind} backend, model ${session.modelId}`,
    )
    this.session = session
    this.sessionKind = host.info.kind
    const surfaces = sessionSurfaces.get(session) ?? new Set<ConversationController>()
    surfaces.add(this)
    sessionSurfaces.set(session, surfaces)
    this.canEditSessions = host.info.canEditSessions
    const eventGeneration = this.sendInvalidationEpoch
    this.unsubscribe = session.onEvent((event) => {
      if (
        this.isDisposed ||
        this.session !== session ||
        eventGeneration !== this.sendInvalidationEpoch
      ) {
        return
      }
      this.onEvent(event)
    })
    // The host closing this very session is heard here (D25), not only in History.
    this.closedWatch = host.onSessionListEvent((event) => {
      if (eventGeneration !== this.sendInvalidationEpoch) {
        return
      }
      if (
        event.type === 'closed' &&
        event.sessionId === session.sessionId &&
        this.session === session
      ) {
        this.sessionClosedByHost(event.reason)
      }
    })
    this.postSessionInfo(this.modelId)
    this.noteActivity()
    await this.applyEffort(session)
    if (this.session !== session || this.attachmentGeneration !== generation || this.isDisposed) {
      return
    }
    void this.refreshSkills(session)
    if (session.schedules !== undefined) {
      void session.schedules.list().catch((error: unknown) => {
        this.deps.log.warn(`Scheduled prompts could not be loaded: ${describe(error)}`)
      })
    }
  }

  /**
   * The session for the next message. Concurrent callers (two quick sends, a
   * send racing a restore) share one start, so no second session is created
   * and left listening (D25).
   */
  private ensureSession(workspaceRoot: string): Promise<AgentSession> {
    if (this.session !== undefined) {
      return Promise.resolve(this.session)
    }
    if (this.sessionOpening === undefined) {
      const generation = this.attachmentGeneration
      this.sessionOpeningGeneration = generation
      this.sessionOpening = this.openSessionOnce(workspaceRoot, generation)
    }
    return this.sessionOpening
  }

  /** `openSession`, forgetting the shared start once it settles. */
  private async openSessionOnce(workspaceRoot: string, generation: number): Promise<AgentSession> {
    try {
      return await this.openSession(workspaceRoot, generation)
    } finally {
      if (this.sessionOpeningGeneration === generation) {
        this.sessionOpening = undefined
      }
    }
  }

  private requireCurrentOpening(generation: number): void {
    if (this.isDisposed || this.attachmentGeneration !== generation) {
      throw new Error(this.isDisposed ? UI_TEXT.surfaceClosed : UI_TEXT.turnStoppedByRestart)
    }
  }

  private async openSession(workspaceRoot: string, generation: number): Promise<AgentSession> {
    const host = await this.deps.ensureHost()
    this.requireCurrentOpening(generation)
    await this.ensureModels(host)
    this.requireCurrentOpening(generation)
    const resumed = await this.resumeAfterRestart(host, generation)
    this.requireCurrentOpening(generation)
    if (resumed !== undefined) {
      return resumed
    }
    const mcpServers = await this.mcpServersFor(host)
    this.requireCurrentOpening(generation)
    const session = await host.startSession({
      workspaceRoot,
      modelId: this.modelId,
      approvalMode: approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
      ...(this.isSideChat && { sideChat: true }),
      ...(mcpServers !== undefined && { mcpServers }),
    })
    if (mcpServers !== undefined) {
      this.ideSessions.add(session)
    }
    if (this.isDisposed || this.attachmentGeneration !== generation) {
      // The surface closed while the session was starting: nobody would listen.
      session.dispose()
      this.requireCurrentOpening(generation)
    }
    this.modelId = session.modelId
    await this.attach(host, session, 'started')
    this.requireCurrentOpening(generation)
    if (host.info.kind === 'modelApi') {
      this.notice('info', UI_TEXT.modelApiBackendNotice)
    } else {
      this.noteShellSandbox(workspaceRoot)
    }
    return session
  }

  /**
   * After a restart, a crash or the host closing the session, the next
   * message continues the same conversation (D25) rather than starting one
   * with no context. The webview kept its transcript, so nothing is
   * replayed. If the session cannot be resumed the user is told and a new
   * one starts.
   */
  private async resumeAfterRestart(
    host: AgentHost,
    generation: number,
  ): Promise<AgentSession | undefined> {
    const target = this.resumeTarget
    this.resumeTarget = undefined
    if (target?.kind !== host.info.kind) {
      return undefined
    }
    let loaded: LoadedSession
    const mcpServers = await this.mcpServersFor(host)
    try {
      loaded = await host.resumeSession(
        target.sessionId,
        this.modelId,
        mcpServers,
        this.sideResumeOptions(host),
      )
      if (mcpServers !== undefined) {
        this.ideSessions.add(loaded.session)
      }
    } catch (error: unknown) {
      this.notice('warning', `${UI_TEXT.sessionNotContinued}: ${describe(error)}`)
      return undefined
    }
    if (!this.canLoadIntoSurface(host, loaded)) {
      loaded.session.dispose()
      this.notice('warning', UI_TEXT.sideChatSessionOnly)
      return undefined
    }
    this.isSideChat = loaded.record.sideChat === true || this.deps.surface.isSideChat === true
    if (this.isSideChat) {
      this.permissionMode = 'plan'
      this.postComposerState()
    }
    if (this.isDisposed || this.attachmentGeneration !== generation) {
      loaded.session.dispose()
      this.requireCurrentOpening(generation)
    }
    this.activeTurnId = loaded.activeTurnId
    await this.attach(host, loaded.session, 'continued after a restart')
    this.requireCurrentOpening(generation)
    try {
      await loaded.session.setApprovalMode(
        approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
      )
    } catch (error: unknown) {
      this.notice('warning', `${UI_TEXT.permissionModeNotApplied}: ${describe(error)}`)
    }
    this.notice('info', UI_TEXT.sessionContinued)
    return loaded.session
  }

  /** The backend's admission closes before its visible auth label changes. */
  private isAuthAdmitted(): boolean {
    return (
      this.deps.auth.current.status === 'signedIn' &&
      this.deps.auth.backend !== undefined &&
      this.accountStopsInFlight === 0
    )
  }

  /** Why a user action cannot run now (signed out / no folder), posted as asked. */
  private isCurrentSessionAction(
    session: AgentSession | undefined,
    generation: number,
  ): session is AgentSession {
    return (
      session !== undefined &&
      !this.isDisposed &&
      this.isAuthAdmitted() &&
      this.sendInvalidationEpoch === generation &&
      this.session === session
    )
  }

  /**
   * Why an action cannot run now, posted as asked. A refused message's
   * images were never used, so the composer gets them back, unless the
   * message was the host's own (a brief, M79), whose chip goes with it.
   */
  private refuseAction(localId?: string, isComposerMessage = true): string | undefined {
    const isSignedIn = this.isAuthAdmitted()
    const reason = isSignedIn ? undefined : UI_TEXT.notSignedInReason
    if (reason === undefined && this.deps.workspaceRoot !== undefined) {
      return undefined
    }
    const text = reason ?? UI_TEXT.noWorkspaceReason
    this.post(
      localId === undefined
        ? { type: 'notice', level: 'warning', text }
        : { type: 'sendFailed', localId, reason: text, attachmentsKept: isComposerMessage },
    )
    return text
  }

  /** The session for a user action, or undefined (with the reason posted). */
  private async sessionForAction(
    localId?: string,
    isComposerMessage = true,
  ): Promise<AgentSession | undefined> {
    const generation = this.sendInvalidationEpoch
    const refusal = this.refuseAction(localId, isComposerMessage)
    if (refusal !== undefined || this.deps.workspaceRoot === undefined) {
      return undefined
    }
    const session = await this.ensureSession(this.deps.workspaceRoot)
    return this.isCurrentSessionAction(session, generation) ? session : undefined
  }

  // --- Session history (M6) ---

  /** Follow `session/listChanged` / `session/closed` on the current host. */
  private watchList(host: AgentHost): void {
    if (!this.listWatch.isWatching(host)) {
      this.historyWatchEpoch += 1
    }
    const epoch = this.historyWatchEpoch
    this.listWatch.ensure(host, (watched) =>
      watched.onSessionListEvent((event) => {
        if (epoch !== this.historyWatchEpoch || !this.listWatch.isWatching(watched)) {
          return
        }
        this.onListEvent(event)
      }),
    )
  }

  private onListEvent(event: SessionListEvent): void {
    if (this.sessionRecords === undefined) {
      return
    }
    if (event.type === 'changed') {
      if (event.record.workspaceRoot !== this.deps.workspaceRoot) {
        return
      }
      this.sessionRecords.set(event.record.sessionId, event.record)
    } else {
      const record = this.sessionRecords.get(event.sessionId)
      if (record === undefined) {
        return
      }
      this.sessionRecords.set(event.sessionId, { ...record, status: NOT_LOADED_STATUS })
    }
    this.postSessionList()
  }

  private async listSessions(): Promise<void> {
    if (this.deps.workspaceRoot === undefined) {
      this.notice('warning', UI_TEXT.noWorkspaceReason)
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const host = await this.deps.ensureHost()
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      this.watchList(host)
      const records: SessionRecord[] = []
      let cursor: string | undefined
      for (let page = 0; page < SESSION_LIST_MAX_PAGES; page += 1) {
        const result = await host.listSessions({
          workspaceRoot: this.deps.workspaceRoot,
          limit: SESSION_LIST_LIMIT,
          ...(cursor !== undefined && { cursor }),
        })
        if (generation !== this.sendInvalidationEpoch) {
          return
        }
        records.push(...result.sessions)
        cursor = result.nextCursor
        if (cursor === undefined) {
          break
        }
      }
      this.sessionRecords = new Map(records.map((record) => [record.sessionId, record]))
      this.postSessionList()
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('error', `${UI_TEXT.historyUnavailable}: ${describe(error)}`)
      }
    }
  }

  /** The webview's transcript replaced by a session's served history. */
  private postHistory(
    sessionId: string,
    history: SessionHistoryOutcome,
    activeTurnId: string | undefined,
    shouldIncludeGoal = true,
  ): void {
    for (const item of history.items) {
      this.noteSubagentRow(item)
      this.noteFileCard(item)
    }
    this.restoreForegroundShells(history.items, activeTurnId)
    // The turns of this history this panel sent in Plan mode (M79), finished
    // or still running: a reload keeps the plan actions where they were.
    const planTurns = new Set(
      history.items.flatMap((item) =>
        item.kind === USER_MESSAGE_KIND &&
        item.turnId !== undefined &&
        (this.planTurnIds.has(item.turnId) || this.pendingPlanTurnIds.has(item.turnId))
          ? [item.turnId]
          : [],
      ),
    )
    this.post({
      type: 'historyLoaded',
      sessionId,
      ...(history.sideChat !== undefined && { sideChat: history.sideChat }),
      items: [...history.items],
      ...(history.name !== undefined && { name: history.name }),
      todos: [...history.todos],
      // Absent when the history could not say (M45): the panel keeps what it knew.
      ...(shouldIncludeGoal && history.goal !== undefined && { goal: history.goal }),
      // A turn still running keeps its Stop and its steering (D26).
      ...(activeTurnId !== undefined && { activeTurnId }),
      ...(planTurns.size > 0 && { planTurnIds: [...planTurns] }),
    })
  }

  /** A side panel may only load its own fork; Model API also checks its durable marker. */
  private canLoadIntoSurface(host: AgentHost, loaded: LoadedSession): boolean {
    return (
      this.deps.surface.isSideChat !== true ||
      (this.sideSessionIds.has(loaded.session.sessionId) &&
        (host.info.kind !== 'modelApi' || loaded.record.sideChat === true))
    )
  }

  /**
   * Make a resumed or forked session this surface's: the transcript is
   * rebuilt from its history, the model comes from the catalogue's active
   * row (never the record's `modelId`, PLAN.md M6), and this surface's
   * composer settings are applied to it.
   */
  private async adopt(
    host: AgentHost,
    loaded: LoadedSession,
    notice: string,
    origin: SessionOrigin,
  ): Promise<boolean> {
    if (
      origin === 'forked' &&
      this.deps.surface.isSideChat === true &&
      this.session !== undefined &&
      this.sideSessionIds.has(this.session.sessionId) &&
      (host.info.kind !== 'modelApi' || loaded.record.sideChat === true)
    ) {
      this.sideSessionIds.add(loaded.session.sessionId)
    }
    if (!this.canLoadIntoSurface(host, loaded)) {
      loaded.session.dispose()
      throw new Error(UI_TEXT.sideChatSessionOnly)
    }
    this.dropSession()
    const generation = this.sendInvalidationEpoch
    this.isSideChat = loaded.record.sideChat === true || this.deps.surface.isSideChat === true
    if (this.isSideChat) {
      this.permissionMode = 'plan'
      this.postComposerState()
    }
    const models = await host.listModels(loaded.session.sessionId)
    if (generation !== this.sendInvalidationEpoch) {
      loaded.session.dispose()
      return false
    }
    const active = models.find((model) => model.isActive)
    if (active !== undefined) {
      this.modelId = active.modelId
    }
    // A session saved on a contributor-tier model gets the same yes (or the
    // confidential-workspace block) as choosing one (D24).
    const isModelAllowed = await this.allowsModel(this.modelId)
    if (this.isDisposed || generation !== this.sendInvalidationEpoch) {
      loaded.session.dispose()
      return false
    }
    if (!isModelAllowed) {
      const fallback =
        models.find((model) => model.isDefault && !isContributorModel(model.modelId)) ??
        models.find((model) => !isContributorModel(model.modelId))
      const fallbackId = fallback?.modelId ?? DEFAULT_MODEL_ID
      try {
        await loaded.session.setModel(fallbackId)
      } catch (error: unknown) {
        // Never keep a session on the model the user refused.
        loaded.session.dispose()
        throw error
      }
      if (generation !== this.sendInvalidationEpoch) {
        loaded.session.dispose()
        return false
      }
      this.modelId = fallbackId
      this.notice('info', fill(UI_TEXT.contributorResumeFallbackTo, { model: fallbackId }))
    }
    this.postHistory(loaded.session.sessionId, loaded.history, loaded.activeTurnId)
    this.setTitle(loaded.history.name)
    this.notice('info', `${notice} ${loaded.history.name ?? toSessionRow(loaded.record).title}`)
    if (loaded.history.mode === HISTORY_MODE_NONE) {
      this.notice('warning', UI_TEXT.historyNotServed)
    }
    // Before attaching: the events held for this surface may end that turn (D26).
    this.activeTurnId = loaded.activeTurnId
    await this.attach(host, loaded.session, origin)
    if (generation !== this.sendInvalidationEpoch) {
      return false
    }
    const target = approvalModeFor(this.permissionMode, this.deps.hasApprovalUi)
    try {
      await loaded.session.setApprovalMode(target)
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('warning', `${UI_TEXT.permissionModeNotApplied}: ${describe(error)}`)
      }
    }
    return generation === this.sendInvalidationEpoch && !this.isDisposed
  }

  private async resumeSession(sessionId: string): Promise<void> {
    if (this.deps.surface.isSideChat === true && !this.sideSessionIds.has(sessionId)) {
      this.notice('warning', UI_TEXT.sideChatSessionOnly)
      return
    }
    if (this.refuseAction() !== undefined || this.session?.sessionId === sessionId) {
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const host = await this.deps.ensureHost()
      if (generation !== this.sendInvalidationEpoch) {
        return
      }
      await this.ensureModels(host)
      if (generation !== this.sendInvalidationEpoch) {
        return
      }
      this.watchList(host)
      const mcpServers = await this.mcpServersFor(host)
      const loaded = await host.resumeSession(
        sessionId,
        this.modelId,
        mcpServers,
        this.sideResumeOptions(host),
      )
      if (mcpServers !== undefined) {
        this.ideSessions.add(loaded.session)
      }
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        loaded.session.dispose()
        return
      }
      await this.adopt(host, loaded, UI_TEXT.resumedNotice, 'resumed')
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('error', `${UI_TEXT.resumeFailed}: ${describe(error)}`)
      }
    }
  }

  private async editableHostFor(
    session: AgentSession,
    generation: number,
  ): Promise<AgentHost | undefined> {
    const host = await this.deps.ensureHost()
    if (generation !== this.sendInvalidationEpoch || this.session !== session) {
      return undefined
    }
    if (!host.info.canEditSessions) {
      this.notice('info', UI_TEXT.sessionEditsUnsupported)
      return undefined
    }
    return host
  }

  private async forkSession(lastTurnId: string | undefined): Promise<void> {
    if (this.session === undefined) {
      this.notice('info', UI_TEXT.sessionRequired)
      return
    }
    const generation = this.sendInvalidationEpoch
    const session = this.session
    try {
      const host = await this.editableHostFor(session, generation)
      if (host === undefined) {
        return
      }
      const loaded = await host.forkSession(session.sessionId, this.modelId, lastTurnId)
      if (generation !== this.sendInvalidationEpoch || this.session !== session) {
        loaded.session.dispose()
        return
      }
      await this.adopt(host, loaded, UI_TEXT.forkedNotice, 'forked')
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('error', `${UI_TEXT.forkFailed}: ${describe(error)}`)
      }
    }
  }

  /** Resolve a still-current session before a fork-based panel action (M53). */
  private async forkableSource(
    sourceSessionId: string,
    generation: number,
  ): Promise<{ readonly source: AgentSession; readonly host: AgentHost } | undefined> {
    const source = this.session
    if (!this.isCurrentSessionAction(source, generation) || source.sessionId !== sourceSessionId) {
      return undefined
    }
    const host = await this.deps.ensureHost()
    if (!this.isCurrentSessionAction(source, generation)) {
      return undefined
    }
    if (!host.info.canEditSessions) {
      this.notice('info', UI_TEXT.sessionEditsUnsupported)
      return undefined
    }
    return { source, host }
  }

  /** Branch before a user turn, then put its prompt back in the composer (M53). */
  private async rewindConversation(
    message: Extract<ConversationMessage, { type: 'rewindConversation' }>,
  ): Promise<void> {
    if (message.turnId === this.activeTurnId) {
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const forkable = await this.forkableSource(message.sourceSessionId, generation)
      if (forkable === undefined) {
        return
      }
      const { source, host } = forkable
      if (message.turnId === this.activeTurnId) {
        return
      }
      // Model API replay may hold PDF bytes, but a named text file is stored
      // only as model-facing text. Muse Code echoes file metadata without
      // bytes. Never clear/fork on a file card while its chips cannot be
      // restored exactly in both paths.
      if (this.fileMessageIds.has(message.itemId)) {
        this.notice('warning', UI_TEXT.attachmentUnreadable)
        return
      }
      const history = await host.readSession(source.sessionId)
      if (
        !this.isCurrentSessionAction(source, generation) ||
        message.turnId === this.activeTurnId
      ) {
        return
      }
      // A webview request may be forged or stale. Bind every field and the
      // fork cut to one served user card before discarding any conversation.
      const users = history.items.filter((item) => item.kind === 'userMessage')
      let selectedIndex = users.findIndex((item) => item.itemId === message.itemId)
      if (selectedIndex < 0) {
        const accepted = this.acceptedUserCards.get(message.itemId)
        const candidates =
          accepted === undefined
            ? []
            : users.filter((item) => item.turnId === accepted.turnId && item.text === accepted.text)
        const candidate = candidates[0]
        if (candidate !== undefined && candidates.length === 1) {
          selectedIndex = users.indexOf(candidate)
        }
      }
      const selected = users[selectedIndex]
      const preceding = selectedIndex < 0 ? [] : users.slice(0, selectedIndex)
      const earlierDistinct = preceding.findLast(
        (item) => item.turnId !== undefined && item.turnId !== selected?.turnId,
      )
      const hasEarlierTurn = preceding.some((item) => item.turnId !== undefined)
      if (selected === undefined || !REWIND_HISTORY_MODES.has(history.mode)) {
        this.notice('warning', UI_TEXT.attachmentUnreadable)
        return
      }
      if (
        selected.turnId !== message.turnId ||
        (selected.text ?? '') !== message.text ||
        (hasEarlierTurn && earlierDistinct === undefined) ||
        earlierDistinct?.turnId !== message.lastTurnId ||
        selected.attachments?.some((attachment) => attachment.type === 'file')
      ) {
        this.notice('warning', UI_TEXT.attachmentUnreadable)
        return
      }
      const images = source.sentImages?.(message.turnId, message.itemId) ?? []
      const recordedImageCount =
        selected.attachments?.filter((attachment) => attachment.type === 'image').length ?? 0
      if (images.length < Math.max(recordedImageCount, message.imageCount)) {
        this.notice('warning', UI_TEXT.rewindImagesUnavailable)
        return
      }
      if (message.lastTurnId === undefined) {
        this.clear()
      } else {
        const loaded = await host.forkSession(source.sessionId, this.modelId, message.lastTurnId)
        if (!this.isCurrentSessionAction(source, generation)) {
          loaded.session.dispose()
          return
        }
        if (!(await this.adopt(host, loaded, UI_TEXT.forkedNotice, 'forked'))) {
          return
        }
        this.attachments.clear()
        this.post({ type: 'attachmentsCleared' })
      }
      for (const image of images) {
        const added = this.attachments.add(image.mediaType, Buffer.from(image.base64Data, 'base64'))
        if (added.ok) {
          this.post({ type: 'attachmentAdded', attachment: added.attachment })
        }
      }
      this.post({ type: 'restoreDraft', text: message.text })
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
        this.notice('error', `${UI_TEXT.rewindConversationFailed}: ${describe(error)}`)
      }
    }
  }

  /** A separate Plan-mode fork, leaving this surface attached (M53). */
  private async openSideChat(sourceSessionId: string): Promise<void> {
    if (this.deps.openSideChat === undefined) {
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const forkable = await this.forkableSource(sourceSessionId, generation)
      if (forkable === undefined) {
        return
      }
      const { source, host } = forkable
      const loaded = await host.forkSession(source.sessionId, this.modelId, undefined, {
        sideChat: true,
      })
      try {
        if (!this.isCurrentSessionAction(source, generation)) {
          return
        }
        if (loaded.record.sideChat !== true) {
          await loaded.session.setApprovalMode('denyUnmatched')
          if (!this.isCurrentSessionAction(source, generation)) {
            return
          }
          try {
            // Muse Code's fork keeps the parent's goal until cleared.
            await loaded.session.controlGoal({ verb: 'clear' })
          } catch (error: unknown) {
            if (!(isGoalRefusedError(error) && error.refusal === 'noGoal')) {
              throw error
            }
          }
        }
        if (!this.isCurrentSessionAction(source, generation)) {
          return
        }
        this.deps.openSideChat(loaded.session.sessionId)
      } finally {
        loaded.session.dispose()
      }
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
        this.notice('error', `${UI_TEXT.sideChatFailed}: ${describe(error)}`)
      }
    }
  }

  // --- Plans as files (M79, PLAN.md D49) ---

  /**
   * The session a plan action names: the attached one, or, after a restart,
   * a crash or the host closing it (D25), the one the next message would
   * resume, resumed now. Undefined, with the reason said, when the panel
   * no longer holds that conversation.
   */
  private async planSession(
    sourceSessionId: string,
    generation: number,
  ): Promise<AgentSession | undefined> {
    let session = this.session
    if (session === undefined && this.resumeTarget?.sessionId === sourceSessionId) {
      session = await this.sessionForAction()
    }
    if (
      session?.sessionId !== sourceSessionId ||
      !this.isCurrentSessionAction(session, generation)
    ) {
      if (!this.isDisposed) {
        this.notice('info', UI_TEXT.planSessionGone)
      }
      return undefined
    }
    return session
  }

  /**
   * The reply to save as a plan: read back from the host, never taken from
   * the webview, and only while it is this conversation's latest reply, from
   * a turn this panel started in Plan mode and that stayed in it, with no
   * turn running and the panel still in Plan mode. Neither backend marks a
   * plan or its approval on the wire: Muse Code 1.4.0 in Plan mode sends its
   * plan as an ordinary `agentMessage` and takes the user's next message
   * ("go") as the go-ahead (captured live, D13), and the Model API harness
   * has no plan tool. The panel's Save plan or Implement is the approval.
   * Undefined, with the reason said, otherwise.
   */
  private async planReply(
    sourceSessionId: string,
    itemId: string,
    generation: number,
  ): Promise<
    | {
        readonly text: string
        /** The message it answered, as typed (the card's text, a text file's note after it). */
        readonly prompt: string | undefined
        readonly name: string | undefined
        /** Captured from the validated live host/session, never the webview's argument alone. */
        readonly ownerRecorder: WorkspaceEditRecorder | undefined
      }
    | undefined
  > {
    if (this.permissionMode !== PLAN_MODE) {
      this.notice('info', UI_TEXT.planReplyNotLatest)
      return undefined
    }
    const session = await this.planSession(sourceSessionId, generation)
    if (session === undefined) {
      return undefined
    }
    const host = await this.deps.ensureHost()
    if (!this.isCurrentSessionAction(session, generation)) {
      return undefined
    }
    const history = await host.readSession(session.sessionId)
    if (!this.isCurrentSessionAction(session, generation)) {
      return undefined
    }
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.planWaitForTurn)
      return undefined
    }
    if (history.mode === HISTORY_MODE_NONE) {
      this.notice('warning', UI_TEXT.historyNotServed)
      return undefined
    }
    const { items } = history
    const replyIndex = items.findLastIndex((item) => item.kind === AGENT_MESSAGE_KIND)
    const promptIndex = items.findLastIndex((item) => item.kind === USER_MESSAGE_KIND)
    const reply = items[replyIndex]
    const text = reply?.text ?? ''
    if (
      reply?.itemId !== itemId ||
      replyIndex < promptIndex ||
      reply.status === IN_PROGRESS_STATUS ||
      text.trim() === ''
    ) {
      this.notice('info', UI_TEXT.planReplyNotLatest)
      return undefined
    }
    if (reply.turnId === undefined || !this.planTurnIds.has(reply.turnId)) {
      this.notice('info', UI_TEXT.planNotFromPlanTurn)
      return undefined
    }
    const prompt = items[promptIndex]?.text?.split(TEXT_FILE_DISPLAY_MARKER)[0]
    return {
      text,
      prompt,
      name: history.name,
      ownerRecorder:
        host.info.kind === 'modelApi' ? this.deps.plans?.captureOwner?.(session) : undefined,
    }
  }

  /** Current authority after asynchronous plan preparation, lookup or confirmation. */
  private canUsePlans(): boolean {
    if (this.isDisposed) {
      return false
    }
    if (!this.deps.isWorkspaceTrusted()) {
      this.notice('warning', UI_TEXT.planRestricted)
      return false
    }
    return true
  }

  /**
   * Saves the latest Plan-mode reply under `.agents/plans/`, checked afresh
   * on every press: the file (new, or the same plan found saved already) and
   * the plan's text, or undefined with the reason said. A workspace write,
   * so Restricted Mode refuses it, and `.agents` is protected, so it asks.
   */
  private async savePlanReply(
    sourceSessionId: string,
    itemId: string,
    generation: number,
  ): Promise<
    | { readonly saved: SaveOutcome; readonly text: string; readonly markdown: PlanMarkdown }
    | undefined
  > {
    // Refused with its reason said first: no plans without a workspace folder.
    if (this.refuseAction() !== undefined) {
      return undefined
    }
    const { plans } = this.deps
    if (plans === undefined) {
      return undefined
    }
    if (!this.canUsePlans()) {
      return undefined
    }
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.planWaitForTurn)
      return undefined
    }
    // The reader first: without it no plan is titled or checked, so none is saved.
    const markdown = plans.markdown()
    const reply = await this.planReply(sourceSessionId, itemId, generation)
    if (reply === undefined) {
      return undefined
    }
    // The plan the reply holds, byte for byte: a Muse Code plan reply's
    // handoff lines are not part of it (captured, D13).
    const text = planBody(reply.text)
    if (new TextEncoder().encode(text).byteLength > PLAN_FILE_MAX_BYTES) {
      this.notice('warning', planTooLargeText())
      return undefined
    }
    // A direction override or a zero-width character: the panel paints the
    // plan otherwise than the model reads it, so it is neither saved nor started.
    if (hasUnshownCharacters(text)) {
      this.notice('warning', UI_TEXT.planUnshownCharacters)
      return undefined
    }
    const content = {
      title: planTitle(markdown, text, reply.prompt, reply.name ?? UI_TEXT.untitledConversation),
      savedAt: new Date(this.deps.now()),
      text,
    }
    // Saved already (this press or another panel's): the same file, nothing asked.
    const known = await plans.find(content)
    if (!this.canUsePlans()) {
      return undefined
    }
    if (known !== undefined) {
      return { saved: { ...known, isNew: false }, text, markdown }
    }
    // `.agents/` is a protected path (D24): the save asks, as a protected write does.
    if (!(await plans.confirmSave())) {
      return undefined
    }
    if (!this.canUsePlans()) {
      return undefined
    }
    const saved = await plans.save(content, reply.ownerRecorder)
    // The file's date and a hash of its name, and the conversation, never the plan (M39).
    this.deps.log.info(
      `Plan ${saved.isNew ? 'saved' : 'found saved'} as ${planLogName(saved.fileName)} from session ${sourceSessionId}`,
    )
    return { saved, text, markdown }
  }

  /**
   * One plan action at a time: a second press while Save plan, Implement or
   * Plans… still runs is dropped, and said, so a plan is saved once and
   * started once.
   */
  private async onePlanAction(run: () => Promise<void>): Promise<void> {
    if (this.isPlanActionRunning) {
      this.say('info', UI_TEXT.planActionBusy)
      return
    }
    this.isPlanActionRunning = true
    try {
      await run()
    } finally {
      this.isPlanActionRunning = false
    }
  }

  /** A plan action failed: the reason in the panel, only its kind in the log (M39). */
  private planFailed(message: string, error: unknown): void {
    this.deps.log.warn(`A plan action failed (${errorKind(error)})`)
    if (!this.isDisposed) {
      this.say('error', `${message}: ${describe(error)}`)
    }
  }

  /** "Save plan" under the latest Plan-mode reply. */
  private async savePlan(sourceSessionId: string, itemId: string): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const outcome = await this.savePlanReply(sourceSessionId, itemId, generation)
      if (outcome === undefined || this.isDisposed) {
        return
      }
      const path = outcome.saved.relativePath
      this.say(
        'info',
        fill(outcome.saved.isNew ? UI_TEXT.planSaved : UI_TEXT.planAlreadySaved, { path }),
      )
      if (outcome.markdown.hasRawHtml(outcome.text)) {
        this.say('warning', fill(UI_TEXT.planHiddenMarkup, { path }))
      }
    } catch (error: unknown) {
      this.planFailed(UI_TEXT.planSaveFailed, error)
    }
  }

  /**
   * The mode an approved brief starts in: the configured starting mode,
   * never Plan, and Bypass only where a conversation could start in it and
   * never in a remote window (D24); otherwise Manual.
   */
  private briefMode(): PermissionMode {
    const mode = this.deps.initialPermissionMode
    const isBypassRefused =
      mode === BYPASS_MODE && (!this.deps.isBypassAllowed() || this.deps.isRemoteWindow)
    return mode === PLAN_MODE || isBypassRefused ? FALLBACK_MODE : mode
  }

  /**
   * The mode a brief built on untrusted content starts in (D49): one that
   * asks, Manual, or Plan when that is the starting mode.
   */
  private untrustedBriefMode(): PermissionMode {
    return this.deps.initialPermissionMode === PLAN_MODE ? PLAN_MODE : FALLBACK_MODE
  }

  /**
   * Starts a new conversation on this backend from a brief (M79; M74's
   * `/handoff` reuses it). The attachment is checked before anything is
   * left, so a brief the backend would not take changes nothing. Then this
   * conversation is left (History keeps it), Plan mode gives way to the
   * brief's mode, and the brief is sent as the first message, with its card,
   * its note for the model and, where the backend takes one, its todo list.
   */
  private async startFromBrief(brief: ConversationBrief, generation: number): Promise<BriefStart> {
    if (this.isSideChat) {
      this.notice('info', UI_TEXT.sideChatPlanOnly)
      return { status: 'refused' }
    }
    if (this.refuseAction() !== undefined) {
      return { status: 'refused' }
    }
    const host = await this.deps.ensureHost()
    if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
      return { status: 'changed' }
    }
    if (brief.attachment !== undefined && !this.canUsePlans()) {
      return { status: 'refused' }
    }
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.planWaitForTurn)
      return { status: 'refused' }
    }
    const isModelApi = host.info.kind === 'modelApi'
    const { attachment } = brief
    if (attachment !== undefined) {
      const staged = new AttachmentStore(this.deps.newAttachmentId).add(
        attachment.name,
        attachment.bytes,
        isModelApi,
        true,
      )
      if (!staged.ok) {
        this.say('warning', `${UI_TEXT.planImplementFailed}: ${staged.reason}`)
        return { status: 'refused' }
      }
    }
    this.deps.log.info(`Starting a new conversation from the brief ${brief.label}`)
    this.clear()
    this.permissionMode = brief.isApproved ? this.briefMode() : this.untrustedBriefMode()
    this.postComposerState()
    // The same checks on the emptied store as on the staged one above.
    const added =
      attachment === undefined
        ? undefined
        : this.attachments.add(attachment.name, attachment.bytes, isModelApi, true)
    if (added?.ok === false) {
      throw new Error(added.reason)
    }
    const attachments = added?.ok === true ? [added.attachment] : []
    const localId = `${PLAN_BRIEF_LOCAL_ID_PREFIX}${this.deps.newAttachmentId()}`
    this.post({ type: 'briefSubmitted', localId, text: brief.displayText, attachments })
    const sent = await this.send(
      localId,
      brief.modelText,
      attachments.map((summary) => summary.id),
      false,
      undefined,
      brief,
    )
    return sent.isAccepted
      ? { status: 'started', hasSetTodos: sent.hasSetTodos }
      : { status: 'refused' }
  }

  /** "Implement in a fresh conversation": the reply on screen (saved first), or a saved plan. */
  private async implementPlan(source: PlanSource): Promise<void> {
    if (this.isSideChat) {
      this.notice('info', UI_TEXT.planImplementSideChat)
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const brief = await this.planBriefFor(source, generation)
      if (brief === undefined) {
        return
      }
      if (brief.hasRawHtml) {
        // The user did not see all of what the model would be sent.
        this.say('warning', fill(UI_TEXT.planHiddenMarkupNotStarted, { path: brief.relativePath }))
        return
      }
      const started =
        generation === this.sendInvalidationEpoch
          ? await this.startFromBrief(brief.brief, generation)
          : ({ status: 'changed' } as const)
      if (started.status === 'changed') {
        this.say(
          'info',
          source.kind === 'reply'
            ? fill(UI_TEXT.planSavedNotStarted, { path: brief.relativePath })
            : UI_TEXT.planChangedNotStarted,
        )
        return
      }
      if (started.status !== 'started') {
        return
      }
      if (!brief.brief.isApproved) {
        this.say(
          'info',
          fill(UI_TEXT.planFromFileMode, { mode: UI_TEXT.permissionModes[this.permissionMode] }),
        )
      }
      // MSP has no todo command: the brief asked the model to list the steps.
      if (!started.hasSetTodos && brief.brief.todos.length > 0) {
        this.say('info', UI_TEXT.planTodosByModel)
      }
    } catch (error: unknown) {
      if (this.accountStopsInFlight === 0) {
        this.planFailed(UI_TEXT.planImplementFailed, error)
      }
    }
  }

  /**
   * The brief a plan becomes: a reply saved first, or a saved file, which is
   * untrusted content. Either way the model gets the plan as the panel shows
   * a plan reply (`briefText`: a link's destination beside its text, a
   * picture's source, a definition, all as rendered text), never markup it
   * would not show. Implementing either reads workspace text into the
   * model, so Restricted Mode refuses it. Undefined, with the reason said,
   * when there is none.
   */
  private async planBriefFor(
    source: PlanSource,
    generation: number,
  ): Promise<
    | {
        readonly brief: ConversationBrief
        readonly relativePath: string
        readonly hasRawHtml: boolean
      }
    | undefined
  > {
    if (source.kind === 'reply') {
      const outcome = await this.savePlanReply(source.sessionId, source.itemId, generation)
      if (outcome === undefined) {
        return undefined
      }
      const { relativePath } = outcome.saved
      const { markdown, text } = outcome
      const bytes = new TextEncoder().encode(markdown.briefText(text))
      return {
        brief: planBrief(relativePath, bytes, planSteps(markdown, text), true),
        relativePath,
        hasRawHtml: markdown.hasRawHtml(text),
      }
    }
    // Refused with its reason said first: no plans without a workspace folder.
    if (this.refuseAction() !== undefined || this.deps.plans === undefined) {
      return undefined
    }
    if (!this.deps.isWorkspaceTrusted()) {
      this.notice('warning', UI_TEXT.planRestricted)
      return undefined
    }
    const { plans } = this.deps
    const plan = await plans.read(source.fileName)
    if (!this.canUsePlans()) {
      return undefined
    }
    const markdown = plans.markdown()
    const body = plan.document.body
    if (hasUnshownCharacters(body)) {
      this.notice('warning', UI_TEXT.planUnshownCharacters)
      return undefined
    }
    const bytes = new TextEncoder().encode(markdown.briefText(body))
    return {
      brief: planBrief(plan.relativePath, bytes, planSteps(markdown, body), false),
      relativePath: plan.relativePath,
      // A file is sent as untrusted content in a mode that asks, and Plans… opens it whole.
      hasRawHtml: false,
    }
  }

  /** The palette's Plans…: the saved plans, to open one or implement it. */
  private async showPlans(): Promise<void> {
    const { plans } = this.deps
    if (plans === undefined) {
      this.notice('warning', UI_TEXT.noWorkspaceReason)
      return
    }
    let choice: PlanChoice | undefined
    try {
      const saved = await plans.list()
      if (saved.length === 0) {
        this.say('info', UI_TEXT.plansNone)
        return
      }
      choice = await plans.choose(saved)
    } catch (error: unknown) {
      this.planFailed(UI_TEXT.plansFailed, error)
      return
    }
    if (choice?.action === 'open') {
      try {
        await this.deps.openFile(choice.plan.relativePath, undefined)
      } catch (error: unknown) {
        // Deleted after the pick, say: the reason in the panel, only its kind in the log (M39).
        this.planFailed(UI_TEXT.planOpenFailed, error)
      }
    } else if (choice?.action === 'implement') {
      await this.implementPlan({ kind: 'file', fileName: choice.plan.fileName })
    }
  }

  private async renameSession(name: string): Promise<void> {
    const trimmed = name.trim()
    const { session } = this
    if (trimmed === '' || session === undefined) {
      return
    }
    const generation = this.sendInvalidationEpoch
    try {
      const host = await this.editableHostFor(session, generation)
      if (host === undefined) {
        return
      }
      const canonical = await session.rename(trimmed)
      if (generation !== this.sendInvalidationEpoch || this.session !== session) {
        return
      }
      if (canonical !== undefined) {
        this.setTitle(canonical)
        this.post({ type: 'agentEvent', event: { type: 'sessionNamed', name: canonical } })
      }
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.session === session) {
        this.notice('error', `${UI_TEXT.renameFailed}: ${describe(error)}`)
      }
    }
  }

  private async setSessionArchived(sessionId: string, isArchived: boolean): Promise<void> {
    const others = this.deps.sessions.archivedIds().filter((id) => id !== sessionId)
    await this.deps.sessions.setArchivedIds(isArchived ? [...others, sessionId] : others)
    this.postSessionList()
  }

  private buildParts(text: string, attachmentIds: readonly string[]): readonly TurnPart[] {
    const images = this.attachments.partsFor(attachmentIds)
    const trimmed = text.trim()
    const skill = parseSkillInvocation(
      trimmed,
      new Set((this.skills ?? []).map((entry) => entry.selector)),
    )
    if (skill !== undefined) {
      return [
        {
          type: 'skill',
          selector: skill.selector,
          ...(skill.arguments !== undefined && { arguments: skill.arguments }),
        },
        ...images,
      ]
    }
    return trimmed === '' ? images : [{ type: 'text', text }, ...images]
  }

  private async submit(
    session: AgentSession,
    parts: readonly TurnPart[],
    displayText: string | undefined,
    shouldQueueForDisplayText: boolean,
    isCurrent: () => boolean,
  ): Promise<TurnSubmission> {
    if (!isCurrent()) {
      throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    if (!shouldQueueForDisplayText && this.activeTurnId !== undefined) {
      try {
        return await session.steer(this.activeTurnId, parts)
      } catch (error: unknown) {
        if (!isCurrent()) {
          throw new Error(UI_TEXT.turnStoppedByRestart, { cause: error })
        }
        this.deps.log.warn(`turn/steer failed (${describe(error)}); submitting as a new turn`)
      }
    }
    if (!isCurrent()) {
      throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    return await session.sendTurn(parts, displayText)
  }

  /**
   * The editor-context part for this message (Claude Code's IDE reminder).
   * A file the mention index does not list (gitignored / excluded) shares
   * its path but not its text.
   */
  private async contextPart(context: EditorContext | undefined): Promise<TurnPart | undefined> {
    if (context === undefined) {
      return undefined
    }
    const isShareable =
      context.selectedText !== undefined &&
      (await this.deps.mentions.contains(context.relativePath))
    return {
      type: 'text',
      text: editorContextText({
        ...context,
        selectedText: isShareable ? context.selectedText : undefined,
      }),
    }
  }

  private async autosave(): Promise<void> {
    if (this.deps.isAutosaveEnabled()) {
      try {
        await this.deps.saveAll()
      } catch (error: unknown) {
        this.deps.log.warn(`Autosave before the turn failed: ${describe(error)}`)
      }
    }
    this.noteUnsaved()
  }

  /**
   * Muse reads and edits the files on disk, not the editors' unsaved text
   * (D27): the user is told which files differ, once for each set of them.
   */
  private noteUnsaved(): void {
    const unsaved = this.deps.unsavedFiles()
    const key = unsaved.toSorted((left, right) => left.localeCompare(right)).join('\n')
    if (key === this.unsavedNoticeKey) {
      return
    }
    this.unsavedNoticeKey = key
    if (unsaved.length === 0) {
      return
    }
    const shown = unsaved.slice(0, UNSAVED_FILES_NAMED).join(', ')
    const more =
      unsaved.length > UNSAVED_FILES_NAMED
        ? ` (+${String(unsaved.length - UNSAVED_FILES_NAMED)})`
        : ''
    this.notice('warning', `${UI_TEXT.unsavedFilesNotice} ${shown}${more}.`)
  }

  /**
   * Sends one message. A brief (M79) is the host's own message: its card
   * shows `brief.displayText` while the model reads `text` (English), its
   * note and, where the backend takes one, its todo list; if it fails, its
   * chip goes with the card rather than back to the composer, and the todo
   * list it set is taken back.
   */
  private async send(
    localId: string,
    text: string,
    attachmentIds: readonly string[],
    isEditorContextIncluded: boolean,
    reference: ChatReference | undefined,
    brief?: BriefExtras,
  ): Promise<SendOutcome> {
    const isComposerMessage = brief === undefined
    let seededSession: AgentSession | undefined
    try {
      const sendEpoch = this.sendInvalidationEpoch
      const session = await this.sessionForAction(localId, isComposerMessage)
      if (session === undefined) {
        return { isAccepted: false, hasSetTodos: false }
      }
      let expectedGeneration = this.attachmentGeneration
      let submittedSession = session
      const requireCurrent = (current: AgentSession): void => {
        if (
          this.isDisposed ||
          this.sendInvalidationEpoch !== sendEpoch ||
          this.session !== current ||
          this.attachmentGeneration !== expectedGeneration
        ) {
          throw new Error(UI_TEXT.turnStoppedByRestart)
        }
      }
      requireCurrent(session)
      await this.autosave()
      requireCurrent(session)
      const typed = this.buildParts(text, attachmentIds)
      if (typed.length === 0) {
        this.post({
          type: 'sendFailed',
          localId,
          reason: UI_TEXT.nothingToSendReason,
          attachmentsKept: isComposerMessage,
        })
        return { isAccepted: false, hasSetTodos: false }
      }
      // A reply to an output or a quoted passage rides as its own part (M17),
      // before the editor context, like the ide_selection part of M5.
      const referenced: readonly TurnPart[] =
        reference === undefined ? [] : [{ type: 'text', text: chatReferenceText(reference) }]
      const context = await this.contextPart(
        isEditorContextIncluded ? this.deps.editorContext() : undefined,
      )
      requireCurrent(session)
      // The CLI backend also gets the choice-steering note (M14); the Model
      // API backend carries it in its system prompt.
      const host = await this.deps.ensureHost()
      requireCurrent(session)
      if (this.sessionKind !== host.info.kind) {
        throw new Error(UI_TEXT.turnStoppedByRestart)
      }
      // Muse Code also hears how to check its edits (M68): the Model API
      // backend checks them itself and says so in its instructions.
      const verifyNote =
        host.info.kind === 'museCode'
          ? this.deps.verifyGuidance?.(this.ideSessions.has(session))
          : undefined
      const verifyParts: readonly TurnPart[] =
        verifyNote === undefined ? [] : [{ type: 'text', text: verifyNote }]
      const note: readonly TurnPart[] =
        host.info.kind === 'museCode'
          ? [{ type: 'text', text: CHOICE_STEERING_NOTE }, ...verifyParts]
          : []
      // A brief's first message (M79): what to do with it, for the model only.
      const hasSetTodos =
        brief !== undefined && brief.todos.length > 0 && session.setTodos !== undefined
      const briefNote: readonly TurnPart[] =
        brief === undefined ? [] : [{ type: 'text', text: brief.modelNote(hasSetTodos) }]
      const parts = [
        ...typed,
        ...briefNote,
        ...referenced,
        ...(context === undefined ? [] : [context]),
        ...note,
      ]
      // What the card shows: a brief's own words, else what was typed.
      const shownText = brief?.displayText ?? text
      // MSP stores no text-file attachment metadata: keep each name in the
      // durable card while the full content travels only to the model (M54).
      const textFileNames = typed.flatMap((part) => (part.type === 'textFile' ? [part.name] : []))
      let displayText = brief === undefined && parts.length === typed.length ? undefined : shownText
      if (textFileNames.length > 0) {
        displayText =
          host.info.kind === 'museCode'
            ? textFileDisplay(shownText, textFileNames)
            : [shownText, ...textFileNames].filter((line) => line !== '').join('\n')
      }
      // Whether this message starts a Plan-mode turn: its reply may be a plan (M79).
      const isPlanModeSend = this.permissionMode === PLAN_MODE
      const submission = await this.runResuming(host, session, (current) => {
        // runResuming may replace a not-loaded session itself; that recovery
        // owns the new generation. An unrelated restart still fails admission.
        if (current !== session) {
          expectedGeneration = this.attachmentGeneration
        }
        requireCurrent(current)
        submittedSession = current
        // A brief's todo list is set before its first turn reads it (M79),
        // where the backend lets the extension set one.
        if (hasSetTodos && current.setTodos !== undefined) {
          current.setTodos(brief.todos)
          seededSession = current
        }
        return this.submit(
          current,
          parts,
          displayText,
          host.info.kind === 'museCode' && textFileNames.length > 0,
          () =>
            !this.isDisposed &&
            this.sendInvalidationEpoch === sendEpoch &&
            this.session === current &&
            this.attachmentGeneration === expectedGeneration,
        )
      })
      requireCurrent(submittedSession)
      // The images go only once the host has the message (D26).
      this.attachments.release(attachmentIds)
      if (this.isDisposed) {
        return { isAccepted: false, hasSetTodos: false }
      }
      const { turnId } = submission
      this.acceptedUserCards.set(localId, { turnId, text: shownText })
      if (submission.userMessageId !== undefined) {
        this.acceptedUserCards.set(submission.userMessageId, { turnId, text: shownText })
      }
      if (typed.some((part) => part.type === 'file' || part.type === 'textFile')) {
        this.fileMessageIds.add(submission.userMessageId ?? localId)
      }
      if (
        isPlanModeSend &&
        this.permissionMode === PLAN_MODE &&
        submission.disposition !== STEERED_DISPOSITION
      ) {
        // An ack can land after its own turn completed (D26).
        if (this.finishedTurns.has(turnId)) {
          this.planTurnIds.add(turnId)
        } else {
          this.pendingPlanTurnIds.add(turnId)
        }
      }
      // A queued turn is not the running one, and an ack that lands after its
      // own turn completed must not mark it running again (D26).
      if (submission.disposition !== QUEUED_DISPOSITION && !this.finishedTurns.has(turnId)) {
        this.activeTurnId = turnId
      }
      this.post({
        type: 'turnAccepted',
        localId,
        turnId,
        ...(submission.userMessageId !== undefined && {
          userMessageId: submission.userMessageId,
        }),
      })
      this.noteActivity()
      return { isAccepted: true, hasSetTodos: seededSession !== undefined }
    } catch (error: unknown) {
      const reason = describe(error)
      this.deps.log.error(`sendMessage failed: ${isComposerMessage ? reason : errorKind(error)}`)
      if (seededSession !== undefined) {
        this.takeBackTodos(seededSession)
      }
      if (!isComposerMessage) {
        this.attachments.release(attachmentIds)
      }
      // A composer message's images were not released: the composer gets
      // them back for another try. A brief's go with its card.
      this.post({ type: 'sendFailed', localId, reason, attachmentsKept: isComposerMessage })
      return { isAccepted: false, hasSetTodos: false }
    }
  }

  /** A brief that failed leaves no todo list behind (M79): its steps were never sent. */
  private takeBackTodos(session: AgentSession): void {
    try {
      session.setTodos?.([])
    } catch (error: unknown) {
      this.deps.log.warn(`The brief's todo list could not be taken back: ${errorKind(error)}`)
    }
  }

  /**
   * A command on the session (a submission, a goal verb), once more on the
   * resumed session when the host says it no longer holds this one (MSP
   * `sessionNotLoaded`: evicted or closed, D25).
   */
  private async runResuming<T>(
    host: AgentHost,
    session: AgentSession,
    run: (current: AgentSession) => Promise<T>,
  ): Promise<T> {
    const generation = this.sendInvalidationEpoch
    try {
      return await run(session)
    } catch (error: unknown) {
      if (!isSessionNotLoadedError(error) || this.deps.workspaceRoot === undefined) {
        throw error
      }
      // A late refusal from an old session must not replace the session
      // the user opened while that command was in flight.
      if (!this.isCurrentSessionAction(session, generation)) {
        throw error
      }
      this.deps.log.info(`Session ${error.sessionId} was not loaded; resuming it`)
      this.resumeTarget = { sessionId: error.sessionId, kind: host.info.kind }
      this.dropSession(false, true)
      const resumed = await this.ensureSession(this.deps.workspaceRoot)
      return await run(resumed)
    }
  }

  /**
   * The session goal's verbs (M45, PLAN.md D38): `/goal …` in the prompt and
   * the goal strip's controls. A set on a panel with no conversation starts
   * one. What the goal became arrives as `goalChanged`; the transcript says
   * what was done, and a refusal says why in words.
   */
  private async controlGoal(
    requestId: string,
    verb: GoalCommandVerb,
    objective: string | undefined,
  ): Promise<void> {
    const generation = this.sendInvalidationEpoch
    const result = (isAccepted: boolean) => {
      this.post({ type: 'goalCommandResult', requestId, accepted: isAccepted })
    }
    const command = goalCommandOf(verb, objective)
    if (command === undefined) {
      this.notice('warning', UI_TEXT.goalObjectiveMissing)
      result(false)
      return
    }
    if (
      verb !== 'set' &&
      this.session === undefined &&
      this.resumeTarget === undefined &&
      this.sessionOpening === undefined
    ) {
      this.say('warning', UI_TEXT.goalNone)
      result(false)
      return
    }
    let targetSessionId: string | undefined
    try {
      const session = await this.sessionForAction()
      if (!this.isCurrentSessionAction(session, generation)) {
        result(false)
        return
      }
      targetSessionId = session.sessionId
      const host = await this.deps.ensureHost()
      if (
        this.accountStopEpoch > generation ||
        this.accountStopsInFlight > 0 ||
        this.deps.auth.backend === undefined
      ) {
        return
      }
      const outcome = await this.runResuming(host, session, (current) =>
        current.controlGoal(command),
      )
      if (
        generation !== this.sendInvalidationEpoch ||
        !this.isAuthAdmitted() ||
        this.session?.sessionId !== targetSessionId
      ) {
        return
      }
      this.deps.log.info(
        `Goal ${verb} accepted${outcome.turnId === undefined ? '' : ` (turn ${outcome.turnId})`}`,
      )
      this.say('info', goalDoneText(command))
      this.noteActivity()
      result(true)
    } catch (error: unknown) {
      if (
        generation !== this.sendInvalidationEpoch ||
        this.accountStopsInFlight > 0 ||
        (targetSessionId !== undefined && this.session?.sessionId !== targetSessionId)
      ) {
        return
      }
      if (isGoalRefusedError(error)) {
        this.deps.log.info(`Goal ${verb} refused: ${error.message}`)
        this.say('warning', goalRefusalText(verb, error.refusal))
        result(false)
        return
      }
      this.notice('error', `${UI_TEXT.goalCommandFailed}: ${describe(error)}`)
      result(false)
    }
  }

  private async scheduleSession(): Promise<AgentSession | undefined> {
    const generation = this.sendInvalidationEpoch
    const session = await this.sessionForAction()
    if (!this.isCurrentSessionAction(session, generation)) {
      return undefined
    }
    if (session.schedules === undefined) {
      this.notice('warning', UI_TEXT.scheduleModelApiOnly)
    }
    return session.schedules === undefined ? undefined : session
  }

  private async createSchedule(cadence: ScheduleCadence, prompt: string): Promise<void> {
    try {
      const session = await this.scheduleSession()
      const job = await session?.schedules?.create(cadence, prompt)
      if (job !== undefined) {
        this.say('info', fill(UI_TEXT.scheduleCreated, { id: job.id }))
      }
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`)
    }
  }

  private async listSchedules(): Promise<void> {
    try {
      const session = await this.scheduleSession()
      const jobs = await session?.schedules?.list()
      if (jobs?.length === 0) {
        this.say('info', UI_TEXT.scheduleNone)
      }
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`)
    }
  }

  private async cancelSchedule(id: string): Promise<void> {
    try {
      const session = await this.scheduleSession()
      if (session?.schedules === undefined) {
        return
      }
      const isRemoved = await session.schedules.cancel(id)
      this.say(
        isRemoved ? 'info' : 'warning',
        fill(isRemoved ? UI_TEXT.scheduleCancelled : UI_TEXT.scheduleUnknown, { id }),
      )
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`)
    }
  }

  private scheduleRunChanged(): void {
    this.notice(
      'warning',
      this.deps.isScheduledPaidOn?.() === true
        ? UI_TEXT.scheduleConfirmationExpired
        : UI_TEXT.schedulePaidOff,
    )
  }

  private async runSchedule(id: string, occurrenceMs: number): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const session = await this.scheduleSession()
      if (!this.isCurrentSessionAction(session, generation) || session.schedules === undefined) {
        return
      }
      if (this.deps.isScheduledPaidOn?.() !== true) {
        this.notice('warning', UI_TEXT.schedulePaidOff)
        return
      }
      const jobs = await session.schedules.list()
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      const job = jobs.find((entry) => entry.id === id)
      if (job?.nextFireAtMs !== occurrenceMs || occurrenceMs > this.deps.now()) {
        this.notice('warning', UI_TEXT.scheduleNotDue)
        return
      }
      if (this.deps.confirmScheduledRun === undefined) {
        return
      }
      const confirmed = {
        sessionId: session.sessionId,
        modelId: session.modelId,
        backend: this.deps.auth.current.backend,
        prompt: job.prompt,
      }
      if (!(await this.deps.confirmScheduledRun(job, confirmed.modelId))) {
        return
      }
      const isContextChanged = () =>
        !this.isCurrentSessionAction(session, generation) ||
        session.sessionId !== confirmed.sessionId ||
        this.sessionKind !== 'modelApi' ||
        this.deps.auth.current.backend !== confirmed.backend ||
        session.modelId !== confirmed.modelId ||
        this.deps.isScheduledPaidOn?.() !== true
      if (isContextChanged()) {
        if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
          this.scheduleRunChanged()
        }
        return
      }
      const currentJobs = await session.schedules.list()
      const current = currentJobs.find((entry) => entry.id === id)
      if (
        isContextChanged() ||
        current?.nextFireAtMs !== occurrenceMs ||
        current.prompt !== confirmed.prompt
      ) {
        if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
          this.scheduleRunChanged()
        }
        return
      }
      await session.schedules.run(id, occurrenceMs, confirmed)
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
        this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`)
      }
    }
  }

  private async cancel(): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`turn/cancel failed: ${describe(error)}`)
    }
  }

  /** Whether a contributor-tier model may be used here: blocked, or confirmed once. */
  private async allowsModel(modelId: string): Promise<boolean> {
    if (!isContributorModel(modelId) || this.confirmedContributor === modelId) {
      return true
    }
    if (this.deps.isConfidentialWorkspace()) {
      this.notice('warning', UI_TEXT.contributorBlocked)
      return false
    }
    if (!(await this.deps.confirmContributor(modelId))) {
      return false
    }
    this.confirmedContributor = modelId
    return true
  }

  private async setModel(modelId: string): Promise<void> {
    if (!(await this.allowsModel(modelId))) {
      this.postSessionInfo(this.modelId)
      return
    }
    const previous = this.modelId
    this.modelId = modelId
    if (this.session !== undefined) {
      try {
        await this.session.setModel(modelId)
      } catch (error: unknown) {
        this.modelId = previous
        this.notice('error', `${UI_TEXT.modelSwitchFailed}: ${describe(error)}`)
        return
      }
    }
    this.postSessionInfo(modelId)
    // A tier the new model does not serve would fail its turns with a 400
    // (muse-spark-1.2 has no `max`); drop to the highest tier it does serve.
    const levels = effortLevelsFor(modelId)
    if (!levels.includes(this.effort)) {
      await this.updateEffort(levels.at(-1) ?? DEFAULT_EFFORT, this.isThinkingEnabled)
    }
  }

  private async updateEffort(effort: EffortLevel, isThinkingEnabled: boolean): Promise<void> {
    const previous = { effort: this.effort, isThinkingEnabled: this.isThinkingEnabled }
    this.effort = effort
    this.isThinkingEnabled = isThinkingEnabled
    const { session } = this
    if (session !== undefined && !(await this.applyEffort(session))) {
      // The session kept its effort, so the composer shows it again, unless
      // the model no longer serves it (a model switch dropped the tier).
      const isSameSession = this.session === session
      if (isSameSession && effortLevelsFor(this.modelId).includes(previous.effort)) {
        this.effort = previous.effort
        this.isThinkingEnabled = previous.isThinkingEnabled
      }
    }
    this.postComposerState()
  }

  /** Whether the user may enter Bypass now: the setting, and in a remote window one yes (D24). */
  private async mayBypass(): Promise<boolean> {
    if (!this.deps.isBypassAllowed()) {
      this.notice('warning', UI_TEXT.bypassNotAllowed)
      return false
    }
    if (!this.deps.isRemoteWindow || this.hasConfirmedRemoteBypass) {
      return true
    }
    this.hasConfirmedRemoteBypass = await this.deps.confirmRemoteBypass()
    return this.hasConfirmedRemoteBypass
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (mode !== 'plan' && this.isSideChat) {
      this.notice('info', UI_TEXT.sideChatPlanOnly)
      this.postComposerState()
      return
    }
    if (mode === BYPASS_MODE && !(await this.mayBypass())) {
      this.postComposerState()
      return
    }
    const previous = this.permissionMode
    this.permissionMode = mode
    // A turn running or queued when Plan mode is left may act, so its reply
    // is no plan (M79): dropped now, before the backend can apply the mode.
    const leftPlanTurns = mode === PLAN_MODE ? [] : [...this.pendingPlanTurnIds]
    if (mode !== PLAN_MODE) {
      this.pendingPlanTurnIds.clear()
    }
    const target = approvalModeFor(mode, this.deps.hasApprovalUi)
    const { session } = this
    if (session !== undefined && target !== approvalModeFor(previous, this.deps.hasApprovalUi)) {
      try {
        await session.setApprovalMode(target)
      } catch (error: unknown) {
        this.permissionMode = previous
        this.restorePlanTurns(leftPlanTurns)
        this.notice('error', `${UI_TEXT.permissionModeChangeFailed}: ${describe(error)}`)
      }
    }
    this.postComposerState()
  }

  /**
   * The backend refused to leave Plan mode, so the turns it kept running
   * in it are Plan-mode turns still (M79): one that finished meanwhile is
   * one now, the rest again when they finish. (Had the conversation
   * changed during the request, its turn ids match nothing any more.)
   */
  private restorePlanTurns(turnIds: readonly string[]): void {
    for (const turnId of turnIds) {
      if (this.finishedTurns.has(turnId)) {
        this.planTurnIds.add(turnId)
      } else {
        this.pendingPlanTurnIds.add(turnId)
      }
    }
  }

  /** A pending browser encode belongs to the session before this replacement request. */
  private beginBrowserSessionChange(attachmentEpoch?: number): void {
    this.webviewAttachmentEpoch = Math.max(this.webviewAttachmentEpoch + 1, attachmentEpoch ?? 0)
  }

  private clear(): void {
    this.webviewAttachmentEpoch += 1
    const wasSideChat = this.isSideChat
    this.dropSession()
    this.isSideChat = this.deps.surface.isSideChat === true
    // A new conversation is new: the session a restart or crash left to
    // resume is not picked up by its first message (D25).
    this.resumeTarget = undefined
    this.planTurnIds.clear()
    this.pendingPlanTurnIds.clear()
    // The webview drops its transcript too, whoever asked: the panel's own
    // New Conversation (it spends the echo) or a keybinding (M25, D28).
    this.post({ type: 'conversationCleared' })
    this.attachments.clear()
    this.setTitle(undefined)
    // No session any more: the webview forgets the id it keeps for the
    // reload serializer (D15).
    this.postSessionInfo(this.modelId, wasSideChat && !this.isSideChat)
    void this.deps.sessions.setLastSession(undefined)
    this.post({ type: 'attachmentsCleared' })
  }

  private async compact(): Promise<void> {
    const generation = this.sendInvalidationEpoch
    const session = await this.sessionForAction()
    if (!this.isCurrentSessionAction(session, generation)) {
      return
    }
    try {
      const outcome = await session.compact()
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      if (outcome.status === NOOP_STATUS) {
        this.notice(
          'info',
          fill(UI_TEXT.nothingToCompactReason, { reason: outcome.reason ?? NOOP_STATUS }),
        )
      } else if (outcome.status === CANCELLED_STATUS) {
        this.notice('info', UI_TEXT.compactionStoppedNotice)
      }
    } catch (error: unknown) {
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      const reason = describe(error)
      if (reason.includes(MISSING_RUN_REASON)) {
        this.notice('info', UI_TEXT.nothingToCompact)
      } else {
        this.notice('error', `${UI_TEXT.compactionFailed}: ${reason}`)
      }
    }
  }

  private async listSkills(): Promise<void> {
    if (this.skills !== undefined) {
      this.postSkills()
      return
    }
    const session = await this.sessionForAction()
    if (session !== undefined) {
      await this.refreshSkills(session)
    }
  }

  private async searchMentions(requestId: number, query: string): Promise<void> {
    try {
      const items = await this.deps.mentions.search(query, MENTION_RESULT_LIMIT)
      this.post({ type: 'mentionResults', requestId, items: [...items] })
    } catch (error: unknown) {
      this.deps.log.warn(`mention search failed: ${describe(error)}`)
      this.post({ type: 'mentionResults', requestId, items: [] })
    }
  }

  private async addAttachment(
    name: string,
    bytes: Uint8Array,
    canAcceptText = false,
    requestId?: string,
    requestEpoch?: number,
    expectedGeneration?: number,
  ): Promise<void> {
    const generation = expectedGeneration ?? this.attachmentGeneration
    if (!this.isCurrentAttachmentGeneration(generation)) {
      return
    }
    let host: AgentHost
    try {
      host = await this.deps.ensureHost()
    } catch (error: unknown) {
      if (
        this.isDisposed ||
        generation !== this.attachmentGeneration ||
        (requestEpoch !== undefined && requestEpoch !== this.webviewAttachmentEpoch)
      ) {
        return
      }
      if (requestId === undefined) {
        throw error
      }
      this.post({
        type: 'attachmentRejected',
        name,
        reason: UI_TEXT.attachmentUnreadable,
        requestId,
      })
      return
    }
    if (
      this.isDisposed ||
      generation !== this.attachmentGeneration ||
      (requestEpoch !== undefined && requestEpoch !== this.webviewAttachmentEpoch)
    ) {
      return
    }
    const result = this.attachments.add(name, bytes, host.info.kind === 'modelApi', canAcceptText)
    if (result.ok) {
      this.post({
        type: 'attachmentAdded',
        attachment: result.attachment,
        ...(requestId !== undefined && { requestId }),
      })
    } else {
      this.post({
        type: 'attachmentRejected',
        name,
        reason: result.reason,
        ...(requestId !== undefined && { requestId }),
      })
    }
  }

  private insertMention(relativePath: string): void {
    this.post({ type: 'insertText', text: `${formatMention(relativePath)} ` })
  }

  private isCurrentAttachmentGeneration(generation: number): boolean {
    return !this.isDisposed && generation === this.attachmentGeneration
  }

  /** Text bytes need a trusted, indexed, canonical workspace path; path mentions stay available. */
  private async textFileDisposition(
    file: PickedFile,
    generation: number,
  ): Promise<
    | { readonly kind: 'attach'; readonly checkedAbsolute: string }
    | { readonly kind: 'mention' }
    | { readonly kind: 'refuse' }
    | { readonly kind: 'stale' }
  > {
    if (!this.isCurrentAttachmentGeneration(generation)) {
      return { kind: 'stale' }
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return { kind: 'mention' }
    }
    let checked: Awaited<ReturnType<FileAccess['canonicalRelativePath']>>
    try {
      checked = await this.deps.files.canonicalRelativePath(file.fsPath)
    } catch (error: unknown) {
      if (!this.isCurrentAttachmentGeneration(generation)) {
        return { kind: 'stale' }
      }
      this.deps.log.warn(`text attachment path check failed: ${describe(error)}`)
      return { kind: 'mention' }
    }
    if (!this.isCurrentAttachmentGeneration(generation)) {
      return { kind: 'stale' }
    }
    if (checked === undefined) {
      return { kind: 'mention' }
    }
    const { canonical } = checked
    const segments = canonical.toLowerCase().split('/')
    const name = segments.at(-1) ?? ''
    if (
      isProtectedPath(canonical) ||
      name.startsWith('.env.') ||
      PRIVATE_ATTACHMENT_NAMES.has(name) ||
      PRIVATE_ATTACHMENT_EXTENSIONS.has(path.extname(name))
    ) {
      this.post({ type: 'attachmentRejected', name: file.name, reason: UI_TEXT.textFilePrivate })
      return { kind: 'refuse' }
    }
    let isIndexed: boolean
    try {
      isIndexed = await this.deps.mentions.contains(canonical)
    } catch (error: unknown) {
      if (!this.isCurrentAttachmentGeneration(generation)) {
        return { kind: 'stale' }
      }
      throw error
    }
    if (!this.isCurrentAttachmentGeneration(generation)) {
      return { kind: 'stale' }
    }
    return isIndexed
      ? { kind: 'attach', checkedAbsolute: checked.checkedAbsolute }
      : { kind: 'mention' }
  }

  private async pickFile(): Promise<void> {
    const generation = this.attachmentGeneration
    let picked: readonly PickedFile[]
    try {
      picked = await this.deps.files.showOpenDialog()
    } catch (error: unknown) {
      if (!this.isCurrentAttachmentGeneration(generation)) {
        return
      }
      throw error
    }
    if (!this.isCurrentAttachmentGeneration(generation)) {
      return
    }
    for (const file of picked) {
      if (!this.isCurrentAttachmentGeneration(generation)) {
        return
      }
      const extension = path.extname(file.name).toLowerCase()
      const lowerName = file.name.toLowerCase()
      if (
        lowerName.startsWith('.env.') ||
        PRIVATE_ATTACHMENT_NAMES.has(lowerName) ||
        PRIVATE_ATTACHMENT_EXTENSIONS.has(extension)
      ) {
        this.post({ type: 'attachmentRejected', name: file.name, reason: UI_TEXT.textFilePrivate })
        continue
      }
      const isTextFile = TEXT_ATTACHMENT_EXTENSIONS.has(extension)
      let pathToRead = file.fsPath
      let shouldMentionUnlessPdf = false
      if (isTextFile) {
        const disposition = await this.textFileDisposition(file, generation)
        if (disposition.kind === 'stale') {
          return
        }
        if (disposition.kind === 'refuse') {
          continue
        }
        if (disposition.kind === 'mention') {
          shouldMentionUnlessPdf = true
        } else {
          pathToRead = disposition.checkedAbsolute
        }
      }
      if (isTextFile || extension === PDF_EXTENSION || Object.hasOwn(IMAGE_EXTENSIONS, extension)) {
        let maxBytes = MAX_IMAGE_BYTES
        if (isTextFile) {
          maxBytes = MAX_TEXT_ATTACHMENT_BYTES
        } else if (extension === PDF_EXTENSION) {
          maxBytes = MAX_DOCUMENT_BYTES
        }
        let read: Awaited<ReturnType<FileAccess['readFile']>>
        try {
          if (shouldMentionUnlessPdf) {
            read = await this.deps.files.readFile(pathToRead, 0)
          } else if (isTextFile) {
            read = await this.deps.files.readFile(pathToRead, maxBytes, pathToRead)
          } else {
            read = await this.deps.files.readFile(pathToRead, maxBytes)
          }
        } catch (error: unknown) {
          if (!this.isCurrentAttachmentGeneration(generation)) {
            return
          }
          this.deps.log.warn(`attachment read failed: ${describe(error)}`)
          this.post({
            type: 'attachmentRejected',
            name: file.name,
            reason: UI_TEXT.attachmentUnreadable,
          })
          continue
        }
        if (!this.isCurrentAttachmentGeneration(generation)) {
          return
        }
        if (shouldMentionUnlessPdf && !read.isPdf) {
          this.insertMention(file.relativePath ?? file.fsPath.replaceAll('\\', '/'))
          continue
        }
        const limit = read.isPdf ? MAX_DOCUMENT_BYTES : maxBytes
        if (read.bytes === undefined || read.bytes.byteLength > limit) {
          const otherTooLarge = isTextFile ? UI_TEXT.textFileTooLarge : UI_TEXT.attachmentTooLarge
          this.post({
            type: 'attachmentRejected',
            name: file.name,
            reason:
              extension === PDF_EXTENSION || read.isPdf ? UI_TEXT.documentTooLarge : otherTooLarge,
          })
        } else {
          await this.addAttachment(
            file.name,
            read.bytes,
            isTextFile,
            undefined,
            undefined,
            generation,
          )
        }
      } else {
        if (UNSUPPORTED_BINARY_ATTACHMENT_EXTENSIONS.has(extension)) {
          this.post({
            type: 'attachmentRejected',
            name: file.name,
            reason: UI_TEXT.binaryFileUnsupported,
          })
        } else {
          this.insertMention(file.relativePath ?? file.fsPath.replaceAll('\\', '/'))
        }
      }
    }
  }

  private async pickMentionFile(): Promise<void> {
    const generation = this.attachmentGeneration
    let relativePath: string | undefined
    try {
      relativePath = await this.deps.files.pickMentionFile()
    } catch (error: unknown) {
      if (!this.isCurrentAttachmentGeneration(generation)) {
        return
      }
      throw error
    }
    if (relativePath !== undefined && this.isCurrentAttachmentGeneration(generation)) {
      this.insertMention(relativePath)
    }
  }

  private droppedUris(uris: readonly string[]): void {
    const mentions = uris
      .map((uri) => this.deps.files.toRelativePath(uri))
      .filter((relativePath) => relativePath !== undefined)
      .map((relativePath) => `${formatMention(relativePath)} `)
    if (mentions.length > 0) {
      this.post({ type: 'insertText', text: mentions.join('') })
    }
  }

  private async runHostAction(action: HostAction): Promise<void> {
    if (action === 'reload') {
      // The webview's error boundary asked for a fresh document (M11).
      this.deps.surface.reload()
      return
    }
    try {
      await this.deps.runHostAction(action)
    } catch (error: unknown) {
      this.notice('error', `${fill(UI_TEXT.hostActionFailed, { action })}: ${describe(error)}`)
    }
  }

  /** Called when the webview has mounted: replay the state it needs. */
  // --- Account & usage (M8) ---

  /**
   * Answer the dialog with the backend and the subscription window the host
   * last observed, and keep answering while `usage/changed` arrives.
   */
  private async readUsage(): Promise<void> {
    try {
      const host = await this.deps.ensureHost()
      if (this.usageHost !== host) {
        this.usageHost = host
        this.latestUsage = undefined
      }
      const readSequence = ++this.usageReadSequence
      const eventRevision = this.usageEventRevision
      this.usageWatch.ensure(host, (watched) =>
        watched.onUsageChanged((usage) => {
          if (this.usageHost === watched) {
            this.usageEventRevision += 1
          }
          void this.postUsage(watched, usage)
        }),
      )
      const subscription = await host.readUsage()
      if (this.usageHost !== host || this.usageReadSequence !== readSequence) {
        return
      }
      // An empty read can mean account switched within the same CLI host;
      // only clear observations that preceded this read, not newer events.
      if (subscription === undefined && this.usageEventRevision !== eventRevision) {
        return
      }
      await this.postUsage(host, subscription)
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.usageUnavailable}: ${describe(error)}`)
    }
  }

  private async postUsage(
    host: AgentHost,
    subscription: SubscriptionUsage | undefined,
  ): Promise<void> {
    if (!this.canPostUsage(host)) {
      return
    }
    if (
      subscription !== undefined &&
      this.latestUsage !== undefined &&
      subscription.observedAtMs < this.latestUsage.observedAtMs
    ) {
      return
    }
    this.latestUsage = subscription
    const shown = subscription
    const account = await this.deps.accountFacts(host.info.kind)
    const insights = host.info.kind === 'museCode' ? await this.deps.usageInsights() : undefined
    // An older read or a stopped host must not replace a newer observation.
    if (!this.canPostUsage(host) || this.latestUsage !== shown) {
      return
    }
    this.post({
      type: 'usageReport',
      backend: host.info.kind,
      account,
      ...(shown !== undefined && { subscription: shown }),
      ...(insights !== undefined && { insights }),
    })
  }

  private canPostUsage(host: AgentHost): boolean {
    return (
      !this.isDisposed && this.usageHost === host && this.deps.auth.current.status === 'signedIn'
    )
  }

  /** An owner command on a subagent from the Agent map (M18); the CLI's item updates carry the outcome. */
  private async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation)) {
      return
    }
    try {
      await session.controlSubagent(subagentId, action)
    } catch (error: unknown) {
      if (this.isCurrentSessionAction(session, generation)) {
        this.notice('error', `${UI_TEXT.agentControlFailed}: ${describe(error)}`)
      }
    }
  }

  private async messageSubagent(
    subagentId: string,
    body: string,
    isFollowup: boolean,
  ): Promise<void> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation) || body.trim() === '') {
      return
    }
    try {
      await session.messageSubagent(subagentId, body.trim(), isFollowup)
    } catch (error: unknown) {
      if (this.isCurrentSessionAction(session, generation)) {
        this.notice('error', `${UI_TEXT.agentControlFailed}: ${describe(error)}`)
      }
    }
  }

  /** "Export conversation…" (M30): nothing to export before the first message. */
  private async exportConversation(format: ExportFormat): Promise<void> {
    const { session } = this
    if (session === undefined) {
      this.notice('info', UI_TEXT.exportNothing)
      return
    }
    // A running reply is only partly stored (the Model API backend saves
    // when the turn settles), so an export now would miss what the panel
    // already shows.
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.exportWaitForTurn)
      return
    }
    try {
      const host = await this.deps.ensureHost()
      const outcome = await exportConversation(
        host,
        session,
        format,
        new Date(this.deps.now()),
        this.deps.exports,
      )
      const notice = exportNotice(outcome)
      if (notice !== undefined) {
        this.notice(notice.level, notice.text)
      }
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.exportFailed}: ${describe(error)}`)
    }
  }

  /** The Agent map asked for a subagent's own transcript (M14). */
  private async readChildSession(sessionId: string): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const host = await this.deps.ensureHost()
      if (generation !== this.sendInvalidationEpoch) {
        return
      }
      const history = await host.readSession(sessionId)
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      this.post({
        type: 'childTranscript',
        sessionId,
        ...(history.name !== undefined && { name: history.name }),
        items: [...history.items],
      })
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('warning', `${UI_TEXT.agentTranscriptFailed}: ${describe(error)}`)
      }
    }
  }

  // --- Voice dictation (M9) ---

  /** The engine the microphone uses now, and its setup (M35). */
  private dictationChoice(): { readonly engine: DictationEngine; readonly setup: DictationSetup } {
    const museVoice = this.deps.museVoice()
    return museVoice === undefined
      ? { engine: 'system', setup: this.deps.dictation }
      : { engine: 'museVoice', setup: museVoice }
  }

  private postDictationState(): void {
    const { engine, setup } = this.dictationChoice()
    this.post(
      setup.isAvailable
        ? { type: 'dictationState', status: this.dictationStatus, engine }
        : { type: 'dictationState', status: 'unavailable', reason: setup.reason, engine },
    )
  }

  /**
   * The driver of an engine that is no longer the microphone's (M35, the
   * review of PR #27): an idle one goes; a recording one stops at once, so
   * nothing more is sent (Muse Voice turned off is off), and is kept until
   * the panel closes, so the transcript of what it already sent arrives.
   */
  private retireDictation(): void {
    const old = this.dictation
    if (old === undefined) {
      return
    }
    this.dictation = undefined
    if (this.dictationStatus === 'idle') {
      old.dispose()
      return
    }
    old.stop()
    this.retiredDictation?.dispose()
    this.retiredDictation = old
  }

  private dictationDriver(): DictationHandle | undefined {
    const { engine, setup } = this.dictationChoice()
    if (!setup.isAvailable) {
      return undefined
    }
    if (this.dictationEngine !== engine) {
      // A press on the other engine: the driver of the old one goes first.
      this.retireDictation()
    }
    this.dictationEngine = engine
    this.dictation ??= setup.create({
      onStatus: (status) => {
        this.dictationStatus = status
        this.postDictationState()
      },
      // Phrases land at the caret, each followed by a space so the next one
      // (or typing) does not run into it.
      onText: (text) => {
        this.post({ type: 'insertText', text: `${text} ` })
      },
      onError: (reason) => {
        this.notice('error', `${UI_TEXT.dictationFailed}: ${reason}`)
      },
    })
    return this.dictation
  }

  private async handleDictation(action: DictationAction): Promise<void> {
    this.dictationPresses += 1
    const press = this.dictationPresses
    const choice = this.dictationChoice()
    if (action === 'start' && choice.engine === 'museVoice' && choice.setup.isAvailable) {
      // Each Muse Voice recording is paid: the popup first (M58, PLAN.md D48).
      const isAllowed = await this.deps.allowsPaidUse({ feature: 'voice' })
      if (!isAllowed || press !== this.dictationPresses) {
        this.postDictationState()
        return
      }
    }
    const driver = this.dictationDriver()
    if (driver === undefined) {
      // The button is disabled with the reason; a stray press re-sends it.
      this.postDictationState()
      return
    }
    if (action === 'start') {
      driver.start()
    } else {
      driver.stop()
    }
  }

  /**
   * List the models as soon as the panel is open (M15). Until then only a
   * send, a resume or the pill's skill listing started the host and listed
   * the models, so the pill read "Starting Muse Code…" until the first
   * click. Starting the host and listing its models makes no model call.
   */
  private async warmModels(): Promise<void> {
    if (this.deps.auth.current.status !== 'signedIn') {
      return
    }
    try {
      if (this.models === undefined) {
        const host = await this.deps.ensureHost()
        await this.ensureModels(host)
      }
      // The pill reads the session's model; before any session it reads the
      // one the first send will use (M16).
      if (this.session === undefined) {
        this.postSessionInfo(this.modelId)
      }
    } catch (error: unknown) {
      this.deps.log.warn(`model warm-up failed: ${describe(error)}`)
      this.say('warning', `${UI_TEXT.hostStartFailed}: ${describe(error)}`)
    }
  }

  /** Why the conversation did not start as configured (D24), said once. */
  private postStartupNotice(): void {
    if (this.startupNotice === undefined) {
      return
    }
    this.notice('warning', this.startupNotice)
    this.startupNotice = undefined
  }

  /** One message from the webview, routed; `handle` catches what it throws. */
  private async dispatch(message: ConversationMessage): Promise<void> {
    if (!this.isAuthAdmitted() && AUTH_REQUIRED_SESSION_ACTIONS.has(message.type)) {
      this.notice('warning', UI_TEXT.notSignedInReason)
      return
    }
    switch (message.type) {
      case 'sendMessage': {
        await this.send(
          message.localId,
          message.text,
          message.attachmentIds,
          message.includeEditorContext === true,
          message.reference,
        )
        break
      }
      case 'cancelTurn': {
        await this.cancel()
        break
      }
      case 'signIn': {
        await this.deps.auth.signIn(message.method)
        void this.warmModels()
        break
      }
      case 'installMuseCode': {
        await this.deps.auth.installMuseCode()
        break
      }
      case 'cancelSignIn': {
        this.deps.auth.cancelSignIn()
        break
      }
      case 'signOut': {
        this.dropSession()
        await this.deps.auth.signOut()
        break
      }
      case 'retryBackend': {
        this.dropSession()
        // Check again is a click: the CLI is asked afresh, and macOS may ask
        // it about a Keychain sign-in.
        await this.deps.auth.checkAgain()
        break
      }
      case 'openExternal': {
        this.openLink(message.url)
        break
      }
      case 'decideApproval': {
        await this.decideApproval(message)
        break
      }
      case 'answerQuestion': {
        await this.answerQuestion(message)
        break
      }
      case 'cancelQuestion': {
        await this.cancelQuestion(message.userInputId)
        break
      }
      case 'clarifyQuestion': {
        await this.clarifyQuestion(message)
        break
      }
      case 'moveToBackground': {
        await this.moveToBackground(message.itemId)
        break
      }
      case 'stopTask': {
        await this.stopTask(message.itemId)
        break
      }
      case 'stopAllTasks': {
        await this.stopAllTasks()
        break
      }
      case 'runUserShell': {
        await this.runUserShell(message.command)
        break
      }
      case 'readOutput': {
        await this.readOutput(message)
        break
      }
      case 'readToolImage': {
        await this.readToolImage(message.itemId, message.path)
        break
      }
      case 'openOutput': {
        await this.openOutput(message)
        break
      }
      case 'copyText': {
        await this.deps.copyText(message.text)
        break
      }
      case 'insertCode': {
        await this.insertCode(message.text)
        break
      }
      case 'applyCode': {
        await this.applyCode(message.text)
        break
      }
      case 'openEditDiff': {
        await this.reviewEdit('openDiff', message.itemId, message.outputRef)
        break
      }
      case 'openFile': {
        await this.openFile(message)
        break
      }
      case 'rewindCode': {
        await this.rewindCode(message.edits)
        break
      }
      case 'rewindConversation': {
        this.beginBrowserSessionChange(message.attachmentEpoch)
        await this.rewindConversation(message)
        break
      }
      case 'openSideChat': {
        await this.openSideChat(message.sourceSessionId)
        break
      }
      case 'savePlan': {
        await this.onePlanAction(() => this.savePlan(message.sourceSessionId, message.itemId))
        break
      }
      case 'implementPlan': {
        const source: PlanSource = {
          kind: 'reply',
          sessionId: message.sourceSessionId,
          itemId: message.itemId,
        }
        await this.onePlanAction(() => this.implementPlan(source))
        break
      }
      case 'showPlans': {
        await this.onePlanAction(() => this.showPlans())
        break
      }
      case 'setModel': {
        await this.setModel(message.modelId)
        break
      }
      case 'setEffort': {
        await this.updateEffort(message.effort, this.isThinkingEnabled)
        break
      }
      case 'setThinking': {
        await this.updateEffort(this.effort, message.enabled)
        break
      }
      case 'setPermissionMode': {
        await this.setPermissionMode(message.mode)
        break
      }
      case 'clearConversation': {
        this.clear()
        if (message.attachmentEpoch !== undefined) {
          this.webviewAttachmentEpoch = Math.max(
            this.webviewAttachmentEpoch,
            message.attachmentEpoch,
          )
        }
        break
      }
      case 'compact': {
        await this.compact()
        break
      }
      case 'goalCommand': {
        await this.controlGoal(message.requestId, message.verb, message.objective)
        break
      }
      case 'scheduleCreate': {
        await this.createSchedule(message.cadence, message.prompt)
        break
      }
      case 'scheduleList': {
        await this.listSchedules()
        break
      }
      case 'scheduleCancel': {
        await this.cancelSchedule(message.id)
        break
      }
      case 'scheduleRun': {
        await this.runSchedule(message.id, message.occurrenceMs)
        break
      }
      case 'exportConversation': {
        await this.exportConversation(message.format)
        break
      }
      case 'listSkills': {
        await this.listSkills()
        break
      }
      case 'searchMentions': {
        await this.searchMentions(message.requestId, message.query)
        break
      }
      case 'pickFile': {
        await this.pickFile()
        break
      }
      case 'pickMentionFile': {
        await this.pickMentionFile()
        break
      }
      case 'attachImageData': {
        if (message.attachmentEpoch !== undefined) {
          if (message.attachmentEpoch < this.webviewAttachmentEpoch) {
            break
          }
          this.webviewAttachmentEpoch = message.attachmentEpoch
        }
        await this.addAttachment(
          message.name,
          new Uint8Array(Buffer.from(message.base64, 'base64')),
          false,
          message.requestId,
          message.attachmentEpoch,
        )
        break
      }
      case 'removeAttachment': {
        this.attachments.remove(message.id)
        break
      }
      case 'droppedUris': {
        this.droppedUris(message.uris)
        break
      }
      case 'hostAction': {
        await this.runHostAction(message.action)
        break
      }
      case 'listSessions': {
        await this.listSessions()
        break
      }
      case 'readChildSession': {
        await this.readChildSession(message.sessionId)
        break
      }
      case 'subagentControl': {
        await this.controlSubagent(message.subagentId, message.action)
        break
      }
      case 'subagentMessage': {
        await this.messageSubagent(message.subagentId, message.body, message.isFollowup)
        break
      }
      case 'resumeSession': {
        this.beginBrowserSessionChange(message.attachmentEpoch)
        await this.resumeSession(message.sessionId)
        break
      }
      case 'setSessionArchived': {
        await this.setSessionArchived(message.sessionId, message.isArchived)
        break
      }
      case 'forkSession': {
        this.beginBrowserSessionChange(message.attachmentEpoch)
        await this.forkSession(message.lastTurnId)
        break
      }
      case 'renameSession': {
        await this.renameSession(message.name)
        break
      }
      case 'dictation': {
        await this.handleDictation(message.action)
        break
      }
      case 'readUsage': {
        await this.readUsage()
        break
      }
      case 'setPaidFeature': {
        await this.deps.setPaidFeature(message.feature, message.isOn)
        break
      }
      case 'forgetPaidUse': {
        await this.deps.forgetPaidUse()
        break
      }
    }
  }

  private postSurfaceState(): void {
    this.post({
      type: 'surfaceState',
      attachmentEpoch: this.webviewAttachmentEpoch,
      ...(this.session !== undefined && { sessionId: this.session.sessionId }),
      ...(this.activeTurnId !== undefined && { activeTurnId: this.activeTurnId }),
    })
  }

  public surfaceReady(attachmentEpoch?: number): void {
    if (attachmentEpoch !== undefined) {
      // Saved webview state may lag an in-flight session change.
      this.webviewAttachmentEpoch = Math.max(this.webviewAttachmentEpoch, attachmentEpoch)
    }
    if (this.accountStopsInFlight > 0) {
      this.post({ type: 'surfaceState', attachmentEpoch: this.webviewAttachmentEpoch })
      this.post({ type: 'conversationCleared', accountBoundary: true })
      const auth = this.deps.auth.toMessage()
      this.post(
        auth.type === 'authState' && auth.status === 'signedIn'
          ? { type: 'authState', status: 'checking' }
          : auth,
      )
      this.postComposerState()
      this.postDictationState()
      return
    }
    // First, so a reloaded webview keeps the conversation it saved only when
    // that session is still the live one here, with its running turn (M25, D28).
    this.postSurfaceState()
    this.post(this.deps.auth.toMessage())
    this.postComposerState()
    this.postDictationState()
    if (this.models !== undefined) {
      this.post({ type: 'modelList', models: [...this.models] })
    }
    if (this.session !== undefined) {
      this.postSessionInfo(this.session.modelId)
    }
    this.postSkills()
    for (const attachment of this.attachments.list()) {
      this.post({ type: 'attachmentAdded', attachment })
    }
    void this.warmModels()
    this.postStartupNotice()
  }

  /**
   * Runs one message from the webview. The caller does not wait (a `void`
   * call), so a failure no step in `dispatch` caught would reach only VS Code's
   * Extension Host log: it is logged here, with its stack, and said (M39).
   */
  public async handle(message: ConversationMessage): Promise<void> {
    try {
      await this.dispatch(message)
    } catch (error: unknown) {
      this.deps.log.error(`${message.type} failed: ${errorDetail(error)}`)
      this.say('error', `${UI_TEXT.actionFailed}: ${describe(error)}`)
    }
  }

  /**
   * The Claude Code sidebar rule: a surface that reopens within ten minutes
   * of its last session's activity picks that session up again; otherwise
   * it starts empty and the History dialog has it.
   */
  public async restoreRecentSession(): Promise<void> {
    const last = this.deps.sessions.lastSession()
    if (
      last === undefined ||
      this.session !== undefined ||
      !this.deps.isRestorable ||
      this.deps.workspaceRoot === undefined ||
      this.deps.auth.current.status !== 'signedIn'
    ) {
      return
    }
    if (this.deps.now() - last.at > SESSION_RESTORE_WINDOW_MS) {
      await this.deps.sessions.setLastSession(undefined)
      return
    }
    this.beginBrowserSessionChange()
    this.postSurfaceState()
    await this.resumeSession(last.sessionId)
  }

  /**
   * A panel VS Code rebuilt after a window reload held this session (D15):
   * resume it once the surface is signed in, unless a session is live.
   */
  public async restoreSession(sessionId: string): Promise<void> {
    if (
      this.session !== undefined ||
      this.deps.workspaceRoot === undefined ||
      this.deps.auth.current.status !== 'signedIn'
    ) {
      return
    }
    this.beginBrowserSessionChange()
    this.postSurfaceState()
    await this.resumeSession(sessionId)
  }

  /**
   * The Bypass setting was turned off (D24): a conversation in Bypass drops
   * to Manual. If the host refuses the change, the session goes too, so no
   * turn runs without approvals under a setting that says otherwise.
   */
  public async revokeBypass(): Promise<void> {
    if (this.permissionMode !== BYPASS_MODE) {
      return
    }
    this.permissionMode = FALLBACK_MODE
    if (this.session !== undefined) {
      try {
        await this.session.setApprovalMode(approvalModeFor(FALLBACK_MODE, this.deps.hasApprovalUi))
      } catch (error: unknown) {
        this.deps.log.warn(`Bypass revocation: the mode change failed (${describe(error)})`)
        this.dropSession()
      }
    }
    this.notice('warning', UI_TEXT.bypassRevoked)
    this.postComposerState()
  }

  /**
   * The engine may have changed (M35: the paid feature or the backend): an
   * idle driver of the other engine goes, and the microphone is told.
   */
  public refreshDictation(): void {
    const { engine } = this.dictationChoice()
    if (this.dictationEngine !== engine) {
      this.retireDictation()
    }
    this.postDictationState()
  }

  /** Alt+T: flip the Thinking toggle for this conversation. */
  public async toggleThinking(): Promise<void> {
    await this.updateEffort(this.effort, !this.isThinkingEnabled)
  }

  /** Whether Ctrl+B has a running command to move here (M46): its context key. */
  public get hasForegroundShell(): boolean {
    return this.foregroundShells.size > 0
  }

  /**
   * Ctrl+B (M46, the TUI's key): every shell command the running turn still
   * waits on goes on in the background, and the turn goes on without them.
   */
  public async moveRunningToBackground(): Promise<void> {
    const running = [...this.foregroundShells]
    if (running.length === 0) {
      this.say('info', UI_TEXT.nothingToMoveToBackground)
      return
    }
    for (const itemId of running) {
      await this.moveToBackground(itemId)
    }
  }

  /** "Stop Background Tasks" from the command palette (M46). */
  public async stopBackgroundTasks(): Promise<void> {
    await this.stopAllTasks()
  }

  /**
   * The extension is about to stop the hosts (a restart for a setting, trust
   * granted, a sign-in or sign-out; PLAN.md D25). A running turn is
   * cancelled and ended in the webview; unless the conversations end (sign
   * out, shutdown), the session is resumed by the next message.
   */
  public async backendStopping(isConversationEnding: boolean): Promise<void> {
    if (isConversationEnding) {
      this.accountStopsInFlight += 1
    }
    try {
      // Invalidate a pending send before a running turn's cancel can await.
      this.sendInvalidationEpoch += 1
      if (isConversationEnding) {
        this.accountStopEpoch = this.sendInvalidationEpoch
      }
      this.gapReload = undefined
      this.unsubscribe?.()
      this.unsubscribe = undefined
      this.closedWatch?.()
      this.closedWatch = undefined
      this.historyWatchEpoch += 1
      if (isConversationEnding) {
        this.attachmentGeneration += 1
        this.webviewAttachmentEpoch += 1
        this.attachments.clear()
        this.post({ type: 'conversationCleared', accountBoundary: true })
        this.post({ type: 'attachmentsCleared' })
      }
      this.sessionRecords = new Map()
      this.postSessionList()
      if (isConversationEnding) {
        this.sideSessionIds.clear()
      }
      const { session } = this
      if (session !== undefined && this.activeTurnId !== undefined) {
        try {
          await session.cancel()
        } catch (error: unknown) {
          this.deps.log.warn(`turn/cancel before the restart failed: ${describe(error)}`)
        }
        this.endTurnLocally('cancelled', UI_TEXT.turnStoppedByRestart)
      }
      this.rememberForResume(isConversationEnding ? undefined : session)
      this.dropSession(false)
      this.listWatch.forget()
      this.usageWatch.forget()
      this.usageHost = undefined
      this.latestUsage = undefined
    } finally {
      if (isConversationEnding) {
        this.accountStopsInFlight -= 1
      }
    }
  }

  /**
   * The host process ended. The extension's own close is not news; a crash
   * ends the running turn and is resumed by the next message, unless the
   * process refuses to run as configured, which the sign-in gate reports.
   */
  public hostExited(exit: HostExit): void {
    if (exit.isExpected) {
      return
    }
    this.historyWatchEpoch += 1
    const didHaveSession = this.session !== undefined
    this.rememberForResume(this.session)
    this.endTurnLocally('failed', `${UI_TEXT.hostExited} (${exit.description})`)
    this.dropSession(false)
    this.listWatch.forget()
    this.usageWatch.forget()
    this.usageHost = undefined
    this.latestUsage = undefined
    if (exit.isPersistent) {
      this.deps.auth.markBackendError(`${UI_TEXT.hostExited} (${exit.description})`)
    } else if (didHaveSession) {
      this.notice(
        'warning',
        `${UI_TEXT.hostExited} (${exit.description}). ${UI_TEXT.hostRestartsOnSend}`,
      )
    }
  }

  public dispose(): void {
    this.isDisposed = true
    this.historyWatchEpoch += 1
    clearTimeout(this.deltaTimer)
    this.deltaTimer = undefined
    this.pendingDelta = undefined
    this.dropSession()
    this.listWatch.dispose()
    this.usageWatch.dispose()
    this.usageHost = undefined
    this.latestUsage = undefined
    this.dictation?.dispose()
    this.dictation = undefined
    this.retiredDictation?.dispose()
    this.retiredDictation = undefined
  }
}
