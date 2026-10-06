import type { UsageRecording } from '../../core/usage/recording'
import type { ProviderUsageRow } from '../../shared/usage'
import { startApprovalJudge } from '../../core/judge/use'
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
  NO_EXTENSION_HOOK_DISPATCH,
  type GoalCommand,
  type GoalRefusal,
  type HostExit,
  isDecisionNotAppliedError,
  isGoalRefusedError,
  isMuseCodeFaultError,
  isPromptSettledError,
  isSessionNotLoadedError,
  isSteerRefusedError,
  type LoadedSession,
  type MuseCodeFaultError,
  type OutputPage,
  type OutputPageRequest,
  type PromptSettledError,
  type PromptSettledReason,
  type QueuedMessageRef,
  type SessionHistoryOutcome,
  type SessionListEvent,
  type SessionMcpHttpServer,
  type SentImage,
  type SessionRecord,
  type TurnPart,
  type TurnSubmission,
} from '../../core/agent/agentBackend'
import { editAutomaticallyChoice, isReviewableApproval } from '../../core/agent/approvalRules'
import { scrubSecretApproval } from '../../core/agent/approvalSecrets'
import { countSecretMatches, redactDiagnosticEvent, redactSecrets } from '../../core/redact'
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
import type { ShellSandboxPosture } from '../../core/backends/musecode/sandbox'
import type { BestOfNGitGuard } from '../../core/bestOfN/bestOfNRunner'
import { type BestOfNError, isBestOfNError } from '../../core/bestOfN/bestOfNError'
import type { BestOfNCoordinator } from '../../core/bestOfN/bestOfNCoordinator'
import type { BoardSession, PendingPrompts } from '../../core/sessionBoard'
import { failureForLog, isMspFailure, stderrForLog } from '../../core/backends/musecode/logText'
import { chatReferenceText } from '../../core/chatReference'
import type { PlanModeHold, PlanModeRestore } from '../../core/review/planModeHold'
import type { ReviewMaterial } from '../../core/review/reviewMaterial'
import { isPrivateFileName } from '../../shared/privateFiles'
import { isGitReview, type ReviewRequest } from '../../shared/reviewCommand'
import { FifoLimiter } from '../../core/fifoLimiter'
import { textFileDisplay } from '../../shared/textFileDisplay'
import { type EditorContext, editorContextText } from '../../core/editorContext'
import type { ToolImageResult } from '../../core/toolImages'
import type {
  DictationHandle,
  DictationSetup,
  DictationStatus,
  VoiceConsentFence,
} from '../../core/voice/dictation'
import type { OwnedSessionBudgetScope } from '../../core/backends/modelapi/sessionBudget'
import {
  ALLOWED_LINK_SCHEMES,
  AUTH_REQUIRED_ERROR_KIND,
  AUTO_REVIEWER_RECENT_CALLS,
  CONTRIBUTOR_MODEL_SUFFIX,
  DAMAGED_SESSIONS_KEPT,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  DELTA_BATCH_MS,
  type DictationAction,
  type DictationEngine,
  type EffortLevel,
  type ExportFormat,
  type GoalCommandVerb,
  HANDOFF_LOCAL_ID_PREFIX,
  HANDOFF_OPEN_TODO_STATUSES,
  IDE_MCP_SERVER_NAME,
  IMAGE_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  PDF_EXTENSION,
  PLAN_BRIEF_LOCAL_ID_PREFIX,
  PLAN_FILE_MAX_BYTES,
  PLAN_FILE_MAX_KB,
  PLAN_TODO_PENDING_STATUS,
  MENTION_RESULT_LIMIT,
  CONVERSATION_MODEL_TEXT,
  MSP_READ_OUTPUT_CONCURRENCY,
  MSP_REQUESTED_CAPABILITIES,
  MUSE_EVENT_LOG_FAULT,
  OUTPUT_DOCUMENT_MAX_PAGES,
  OUTPUT_PAGE_BYTES,
  OUTPUT_TAB_ID_LENGTH,
  PATCH_DOCUMENT_MAX_PAGES,
  type PaidFeature,
  type PermissionMode,
  REVIEW_PANE_MAX_EDITS,
  REVIEW_PANE_MAX_LINES,
  SANDBOX_FAILURE_MARKER,
  SANDBOX_PREPARING_MARKER,
  SESSION_LIST_LIMIT,
  SESSION_LIST_MAX_PAGES,
  CHOICE_STEERING_NOTE,
  SESSION_RESTORE_WINDOW_MS,
  SHELL_TOOLS,
  type SubagentAction,
  TEXT_ATTACHMENT_EXTENSIONS,
  TEXT_FILE_DISPLAY_MARKER,
  UNSUPPORTED_BINARY_ATTACHMENT_EXTENSIONS,
  REPORT_UNKNOWN_ERROR_CODE,
  type ReportEventKind,
  UI_TEXT,
  USER_SHELL_ITEM_KIND,
  USER_SHELL_SANDBOX_FAILURE_MARKER,
} from '../../shared/constants'
import { effortForThinking, effortLevelsFor, isEffortLevel } from '../../shared/effort'
import type { AgentEvent, ApprovalChoice, ItemSnapshot, TodoItem } from '../../shared/agentEvents'
import { fill, plural } from '../../shared/l10n/text'
import type { GitAction, GitDraftKind } from '../../shared/git'
import { backendLabel } from '../../shared/palette'
import type { PaidUseRequest } from '../../shared/paid'
import type { ScheduleCadence, ScheduledPrompt } from '../../shared/schedule'
import { formatMention, parseSkillInvocation } from '../../shared/mentions'
import { approvalModeFor, untrustedStartMode } from '../../shared/permissionModes'
import type { MuseCodeReviewerPort } from '../review/museCodeReviewerBundle'
import type { JudgeAdvisory, JudgeFence } from '../../core/judge/use'
import type { ReviewedApprovals } from '../review/reviewedApprovals'
import type {
  ChatReference,
  EditRef,
  HostAction,
  HostToWebviewMessage,
  LineRange,
  MentionItem,
  ModelOption,
  NoticeAction,
  ReportEventRef,
  ReportWebviewError,
  ReviewFile,
  SkillOption,
} from '../../shared/protocol'
import type { AccountFacts, SubscriptionUsage } from '../../shared/usage'
import type { UsageInsightsReport } from '../../runtime/usage/traceLogs'
import type { AuthPort } from '../auth/authService'
import type { CheckpointPort } from '../checkpoints/checkpointHost'
import type { DescribedFile, EditReviewActions, ReviewNotice } from '../editor/editReview'
import type { ReviewCollection } from '../review/reviewCollector'
import type { ReviewTurnFeatures } from '../review/reviewBundle'
import { errorDetail, type Logger } from '../logger'
import type { ChatSurface, ConversationMessage } from '../views/chatSurface'
import type { TasksTabPort, TasksTabView } from '../views/tasksTabPort'

/** The controller's Git adapter contract, portable to hosts without VS Code. */
export interface ConversationGitPort {
  postState(isSurfaceReady?: boolean): void
  sessionChanged(sessionId: string | undefined): void
  handleAction(action: GitAction): Promise<void>
  commit(message: string, isUnstagedIncluded: boolean): Promise<void>
  createPullRequest(request: NewPullRequestRequest): Promise<void>
  promptFor(kind: GitDraftKind, base?: string): Promise<string>
  generationStarting(kind: GitDraftKind): number
  isGenerationCurrent(id: number): boolean
  generationSubmitted(turnId: string, id?: number): void
  generationFailed(id?: number): void
  onEvent(event: AgentEvent): void
  dispose(): void
}

/** The controller's side of the injected Git adapter. */
export interface GitSurface {
  post(message: HostToWebviewMessage): void
  /** Fixed words only: the notice can also reach the log. */
  notice(level: 'info' | 'warning' | 'error', text: string): void
  /** Dynamic program details stay in the panel. */
  say(level: 'warning' | 'error', text: string): void
  sessionId(): string | undefined
}

/** The pull request form as the user pressed Create on it. */
export interface NewPullRequestRequest {
  readonly head: string
  readonly base: string
  readonly title: string
  readonly body: string
  readonly isDraft: boolean
}
import {
  ConversationCheckpoints,
  type NoticeLevel,
  type PendingMark,
} from './conversationCheckpoints'
import {
  type ConversationExports,
  exportConversation,
  type ExportOutcome,
} from './exportConversation'
import type { BestOfNManager } from '../bestOfN/bestOfNManager'
import type * as SessionBoardBundle from '../sessionBoardEntry'
import { uiLocale } from '../../shared/l10n/text'
import type { BestOfNRun } from '../../shared/bestOfN'
import type { SubagentUsage } from '../../shared/paid'
import type { ResponseAttemptGuard } from '../../core/backends/modelapi/client'
import { type AttentionNotice, attentionNotice } from './turnNotifications'
import { importRefusal, messageCount, type SessionExport } from '../../core/export/sessionTransfer'
import {
  type PickedTransferFile,
  readTransferDocument,
  type SessionTransferFiles,
} from './sessionImport'
import type { ReportDataSource, ReportProblemMessage } from './reportProblemHandler'
import type { ReportEditorIo } from '../support/reportProblem'
import type * as ReportBundle from '../support/reportEntry'

/**
 * Report a problem (M93, PLAN.md D72) as a surface sees it: the dialog's
 * facts and journal, and the recorder's two ways in. Recording writes facts
 * (a fixed kind, a known code, package frames), never the text a row shows.
 */
export interface ConversationReports {
  readonly source: ReportDataSource
  /** The editor's clipboard, browser, save picker and issue reporter for the exports. */
  readonly io: ReportEditorIo
  /** Journals the webview's scrubbed failure (the recorder bounds how many). */
  readonly recordWebviewError: (error: ReportWebviewError) => void
  /**
   * Journals one failure as facts (a fixed kind and a code the recorder
   * checks against its vocabulary); the sanitized reference a row then
   * carries, or undefined when nothing was recorded.
   */
  readonly record: (kind: ReportEventKind, code: string) => ReportEventRef | undefined
}

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
  /** Sessions whose Muse Code event log failed, newest last (CLI recovery). */
  damagedIds(): readonly string[]
  setDamagedIds(ids: readonly string[]): Promise<void>
  lastSession(): LastSession | undefined
  setLastSession(last: LastSession | undefined): Promise<void>
}

export interface ConversationDeps {
  readonly usageRecording?: UsageRecording | undefined
  readonly surface: ChatSurface
  readonly auth: AuthPort
  readonly ensureHost: () => Promise<AgentHost>
  readonly workspaceRoot: string | undefined
  readonly modelId: string
  readonly initialPermissionMode: PermissionMode
  /** False until the approval cards ship (M4); see shared/permissionModes.ts. */
  readonly hasApprovalUi: boolean
  readonly runManualHook?: (name: string) => Promise<{ readonly matched: boolean }>
  readonly rewriteMessage?: (text: string) => Promise<string | undefined>
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
  /** The shell sandbox posture the host runs with (D12). */
  readonly shellSandbox: () => ShellSandboxPosture
  /**
   * True the first time in this window that the sandbox-off warning may be
   * shown (musecode-write-asks); without it, every session shows it.
   */
  readonly shouldWarnSandboxOff?: () => boolean
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
  /** `/review` (M70, PLAN.md D49): its parts, from the review's own bundle. */
  readonly review: ReviewTurnFeatures
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
  readonly modelApiSessionBudgetUsd: () => number
  /** Digest only; available before a conversation or workspace exists. */
  readonly voiceAccountId: () => Promise<string | undefined>
  readonly ownedVoiceBudgetScope: (
    sessionId: string,
  ) => Promise<OwnedSessionBudgetScope | undefined>
  /** "Export conversation…" (M30): the save dialog, the write, Muse Code's own log. */
  readonly exports: ConversationExports
  /** Session import and share files (M84, PLAN.md D49): pick a JSON file, confirm the import. */
  readonly transferFiles: SessionTransferFiles
  /**
   * Report a problem (M93, PLAN.md D72): the flight recorder's side for this
   * surface. Undefined where no recorder could start; the dialog then says
   * plainly that it did not work, and failures go unrecorded.
   */
  readonly reports?: ConversationReports | undefined
  /** Saved plans (M79); undefined without a workspace folder. */
  readonly plans: PlanFiles | undefined
  /** The palette's paid-feature toggles (M33, PLAN.md D30): on asks for the price first. */
  readonly setPaidFeature: (feature: PaidFeature, isOn: boolean) => Promise<void>
  /**
   * VS Code workspace trust (PLAN.md D13): Restricted Mode runs no `!`
   * command (M46). VS Code's alone; git also needs the hold let go (M71).
   */
  readonly isWorkspaceTrusted: () => boolean
  /**
   * The window is held on someone else's pull request (M71): the
   * conversation stays in Plan mode and runs no `!` command until the user
   * trusts the worktree in the extension's card.
   */
  readonly isWorktreeHeld: () => boolean
  /** Git and pull requests for this conversation (M71), given the controller's side. */
  readonly createGit: (surface: GitSurface) => ConversationGitPort
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
  /** Turn checkpoints (M72): captured around each turn, restored from a user card. */
  readonly checkpoints: CheckpointPort
  /** Files open with unsaved changes, absolute (M72: a restore leaves them). */
  readonly unsavedPaths: () => readonly string[]
  /** The one modal before a file restore or a code rewind (M72): true to go ahead. */
  readonly confirmFileAction: (title: string, detail: string, action: string) => Promise<boolean>
  /** Account & usage's "Ask again": every paid feature asks again in this workspace (M58). */
  readonly forgetPaidUse: () => Promise<void>
  /** Approvals and questions waiting on the user, shared by every surface (M77). */
  readonly pendingPrompts: PendingPrompts
  readonly boardSessions?: () => readonly BoardSession[]
  readonly focusBoardSession?: (sessionId: string, backend: BackendKind) => boolean
  readonly bestOfNCoordinator: BestOfNCoordinator
  /** Capture the originating session before Take awaits path and account checks. */
  readonly bestOfNWorkspaceEdits?: (
    session: AgentSession | undefined,
  ) => Parameters<BestOfNManager['take']>[2]
  readonly modelApiAccountId: () => Promise<string | undefined>
  readonly openBestOfNWorktree: (absolutePath: string) => Promise<void>
  readonly noteBestOfNRequest: () => void
  readonly noteBestOfNUsage: (modelId: string, usage: SubagentUsage) => void
  readonly bestOfNBudgetScope?: (
    sessionId: string | undefined,
  ) => Promise<OwnedSessionBudgetScope | undefined>
  /** git in `cwd`: its stdout, or a rejection with git's own words (M77). */
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs?: number,
    input?: string,
    beforeRun?: BestOfNGitGuard,
  ) => Promise<string>
  /** Production supplies the automatic Best-of-N policy; injected test Git may use runGit. */
  readonly runBestOfNGit?: ConversationDeps['runGit']
  /** Whether a paid feature's setting is on and its price accepted (M77). */
  readonly isPaidFeatureOn: (feature: PaidFeature) => boolean
  /** Counts a paid use in the window's tally (M77). */
  readonly notePaidUse: (feature: PaidFeature, units: number) => void
  /** A Model API host rooted in a best-of-N worktree (M77). */
  readonly buildAttemptHost: (
    worktreeRoot: string,
    admitRequest: ResponseAttemptGuard,
    noteUsage: (modelId: string, usage: SubagentUsage) => void,
    budgetScope: OwnedSessionBudgetScope | undefined,
  ) => Promise<AgentHost>
  /** The file system's canonical read, for the worktree confinement (M77). */
  readonly realPath: (absolutePath: string) => Promise<string>
  /**
   * The verify loop's note to Muse Code (M68, PLAN.md D49), read for each
   * message: check the diagnostics of what it edits (only when the session
   * has the `ide` server), run the user's checks. Undefined when there is
   * nothing to say.
   */
  readonly verifyGuidance?: (hasIdeServer: boolean) => string | undefined
  /**
   * This surface's tasks tab (M87, PLAN.md D66): "Open in a tab" opens it,
   * and it follows the conversation's list. Undefined in a host without
   * editor tabs, where the action says it failed.
   */
  readonly tasksTab?: TasksTabPort
  /**
   * The bundled skills' offer (M89, PLAN.md D68), asked when a Muse Code
   * conversation starts: a notice with Install (or Update) and Not now, at
   * most once per window; undefined when there is nothing to offer.
   */
  readonly bundledSkillsOffer?: () => Promise<
    { readonly text: string; readonly actions: readonly NoticeAction[] } | undefined
  >
  /**
   * A turn of this surface's session needs the user (M82): the controller
   * names what, the window's `BackgroundNotifier` decides whether it shows.
   */
  readonly notifyAttention: (notice: AttentionNotice) => void
  /**
   * The Auto reviewer on Muse Code (M90, PLAN.md D69), one per window: in
   * Auto, an approval Muse Code raised goes to it before the user. Absent
   * where there is none.
   */
  readonly judge?: JudgeAdvisory | undefined
  readonly museCodeReviewer?: MuseCodeReviewerPort
  readonly now: () => number
  readonly log: Logger
}

const IDLE_STATUS = 'idle'
const NOOP_STATUS = 'noop'
const CANCELLED_STATUS = 'cancelled'
// A tool call that ended in failure, on both backends (M93: journalled as a fact).
const FAILED_ITEM_STATUS = 'failed'
// `session/compact` rejects with this reason before the first turn has run
// (verified live 2026-09-21); it is "nothing to do", not a failure.
const MISSING_RUN_REASON = 'missing_run'
const BYPASS_MODE: PermissionMode = 'bypassPermissions'
const AUTO_MODE: PermissionMode = 'auto'
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
  'elicitationRequested',
])
/** Session/model actions must stop as soon as sign-out is announced in any panel. */
const AUTH_REQUIRED_SESSION_ACTIONS: ReadonlySet<ConversationMessage['type']> = new Set([
  'readOutput',
  'readToolImage',
  'openOutput',
  'openEditDiff',
  'revertEdit',
  'rewindCode',
  'exportConversation',
  'decideApproval',
  'answerQuestion',
  'elicitationAnswer',
  'clarifyQuestion',
  'moveToBackground',
  'rewindConversation',
  'restoreFiles',
  'redoRestore',
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
  'requestSessionBoard',
  'activateBoardSession',
  'startBestOfN',
  'takeBestOfNAttempt',
  'openBestOfNAttempt',
  'cancelBestOfN',
  'readChildSession',
  'subagentControl',
  'subagentMessage',
  'resumeSession',
  'setSessionArchived',
  'forkSession',
  'renameSession',
  'readUsage',
  'setPaidFeature',
  'importSession',
  'savePlan',
  'implementPlan',
  // A handoff's Cancel is not here (M74): releasing an operation the panel
  // owns needs no admission, and the panel has already closed its dialog.
  'requestHandoff',
  'confirmHandoff',
  'withdrawQueued',
])
const QUEUED_DISPOSITION = 'queued'
const COMPLETED_STATUS = 'completed'
const TOOL_CALL_KIND = 'toolCall'
const SUBAGENT_ITEM_KIND = 'subagent'
const IN_PROGRESS_STATUS = 'inProgress'
// The unsaved files a warning names before it counts the rest (D27).
const UNSAVED_FILES_NAMED = 3
// How a notice the user saw reads in the log (M39).
const NOTICE_PREFIX = 'Shown in the panel: '

// An error in words for the log or the panel: external text (an MSP failure,
// CLI output) is redacted first, since it can carry a secret-shaped value.
function describe(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}

/** CLI errors are logged by kind/code; their message is for the redacted panel only. */
function describeForLog(error: unknown): string {
  return isMspFailure(error) ? failureForLog(error) : describe(error)
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

/** Why a review read nothing, for the log: the refusal and git's failure, never git's words. */
function reviewOutcomeForLog(collection: Exclude<ReviewCollection, { kind: 'material' }>): string {
  if (collection.kind === 'cancelled') {
    return 'cancelled'
  }
  return collection.failure === undefined
    ? collection.refusal
    : `${collection.refusal} (${collection.failure})`
}

interface ExportNotice {
  readonly level: 'info' | 'warning'
  readonly text: string
}

/**
 * What an export that wrote nothing tells the user (M30, M84); `exported`
 * and a closed preview (`dismissed`) say nothing.
 */
function exportNotice(outcome: ExportOutcome): ExportNotice | undefined {
  const notices: Readonly<Partial<Record<ExportOutcome, ExportNotice>>> = {
    logUnavailable: { level: 'warning', text: UI_TEXT.exportLogUnavailable },
    historyUnavailable: { level: 'warning', text: UI_TEXT.exportHistoryUnavailable },
    empty: { level: 'info', text: UI_TEXT.exportNothing },
    tooLarge: { level: 'warning', text: UI_TEXT.exportTooLarge },
  }
  return notices[outcome]
}

type RewindConversationMessage = Extract<ConversationMessage, { type: 'rewindConversation' }>

/** A conversation rewind that passed its checks, ready to fork (M53, M72). */
interface PreparedRewind {
  readonly message: RewindConversationMessage
  readonly source: AgentSession
  readonly host: AgentHost
  readonly generation: number
  readonly images: readonly SentImage[]
}

/** How a session came to this surface, for the log (M39). */
type SessionOrigin = 'started' | 'resumed' | 'forked' | 'imported' | 'continued after a restart'

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
   * panel's conversation. Anything else (a file from the workspace, or a
   * reply in a conversation that holds imported history, M84) is untrusted
   * content (PLAN.md D49): the conversation starts in a mode that asks,
   * whatever `museSpark.initialPermissionMode` says.
   */
  readonly isApproved: boolean
  /**
   * Whether the new conversation stays in Plan mode, whatever the above
   * says: a handoff from a Plan-mode conversation (M74) never leaves Plan
   * for a mode that acts.
   */
  readonly shouldKeepPlanMode: boolean
}

/** What `send` takes from a brief for its first message. */
type BriefExtras = Pick<ConversationBrief, 'displayText' | 'modelNote' | 'todos'>

/** What `send` did: whether the host took the message, and whether a brief's todo list was set. */
interface SendOutcome {
  readonly isAccepted: boolean
  readonly hasSetTodos: boolean
  /** The turn the message started, where one did (M74 names its handoff's). */
  readonly turnId: string | undefined
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
    modelText: fill(CONVERSATION_MODEL_TEXT.planBriefRequest, { path: relativePath }),
    attachment: { name: relativePath, bytes },
    modelNote: (hasSetTodos) => {
      const lead = fill(
        isApproved
          ? CONVERSATION_MODEL_TEXT.planBriefApproved
          : CONVERSATION_MODEL_TEXT.planBriefFromFile,
        {
          name,
        },
      )
      if (steps.length === 0) {
        return lead
      }
      const todos = hasSetTodos
        ? fill(CONVERSATION_MODEL_TEXT.planBriefTodosSet, { steps: numberedSteps(steps) })
        : CONVERSATION_MODEL_TEXT.planBriefTodosAsk
      return `${lead} ${todos}`
    },
    todos: steps.map((step) => ({ text: step, status: PLAN_TODO_PENDING_STATUS })),
    isApproved,
    shouldKeepPlanMode: false,
  }
}

/**
 * A distilled brief as a conversation's brief (M74): the reviewed text
 * itself is the first message — no file travels — with the goal and the
 * open items as the model's note. The model wrote it, so it counts as
 * approved, and starts in the starting mode, only when the dialog showed
 * the user all of it before Start: the brief and the open items it lists,
 * neither holding a character the dialog does not show. Otherwise it is
 * untrusted content and starts in a mode that asks, as a plan file does; a
 * handoff from Plan mode stays in Plan. The [untrusted] labels it carries
 * keep their meaning through the note (PLAN.md D49).
 */
function handoffBrief(
  briefText: string,
  goal: string | undefined,
  todos: readonly TodoItem[],
  shouldKeepPlanMode: boolean,
): ConversationBrief {
  return {
    label: 'handoff brief',
    displayText: briefText,
    modelText: briefText,
    attachment: undefined,
    modelNote: (hasSetTodos) => {
      const lead =
        goal === undefined
          ? CONVERSATION_MODEL_TEXT.handoffNote
          : fill(CONVERSATION_MODEL_TEXT.handoffNoteWithGoal, { goal })
      if (todos.length === 0) {
        return lead
      }
      const steps = todos.map((todo) => todo.text)
      const list = hasSetTodos
        ? fill(CONVERSATION_MODEL_TEXT.handoffTodosSet, { steps: numberedSteps(steps) })
        : CONVERSATION_MODEL_TEXT.handoffTodosAsk
      return `${lead} ${list}`
    },
    todos,
    isApproved:
      !hasUnshownCharacters(briefText) && todos.every((todo) => !hasUnshownCharacters(todo.text)),
    shouldKeepPlanMode,
  }
}

/** A `/handoff` whose distillation turn is running, or whose brief waits. */
interface PendingHandoff {
  readonly requestId: string
  readonly goal: string | undefined
  turnId: string | undefined
  /** Submission began; the turn can run before its acceptance arrives. */
  hasSubmittedTurn: boolean
  session: AgentSession | undefined
  /** The brief, once the distillation turn completed and it was shown. */
  brief: string | undefined
  todos: readonly TodoItem[]
  /** The completed turn's reply being read back as the brief. */
  isReadingBrief: boolean
  isStarting: boolean
  /**
   * The send epoch owning the slot; a resumable restart adopts a waiting
   * brief into the new one, so the sign-in retry still owns it.
   */
  generation: number
}

/** The composer's effort and Thinking toggle, as a session holds them. */
interface ComposerEffort {
  readonly effort: EffortLevel
  readonly isThinkingEnabled: boolean
}

/**
 * One session's reasoning-effort changes (CLI recovery, 2026-10-03: eight
 * slider steps sent eight `session/setReasoningEffort` at once to a Muse
 * Code that answered none, each failing with its own warning).
 */
interface EffortSync {
  /** The wire value wanted now, and the composer state it stands for. */
  wanted: string
  wantedState: ComposerEffort
  /** The composer state the session holds, as far as this burst knows. */
  kept: ComposerEffort
  /** The burst's end: undefined when the newest value applied, else `kept`. */
  done: Promise<ComposerEffort | undefined> | undefined
}

/** An error's kind for the log (its code or name), never its message, which may name the plan. */
function errorKind(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }
  return error instanceof Error ? error.name : typeof error
}

export { restartConversationBackends } from './conversationBackends'

export class ConversationController {
  // Revert owns turn admission until file I/O settles; pending sends own it
  // even before their turnStarted event or acknowledgement reaches the panel.
  private revertsInFlight = 0
  private turnSubmissionsInFlight = 0
  private turnStartEpoch = 0
  private session: AgentSession | undefined
  private unsubscribe: (() => void) | undefined
  private models: readonly ModelOption[] | undefined
  /**
   * Models the host flagged as training on the content, from the unfiltered
   * listing (M95): the picker never sees them where confidential, and neither
   * does a stale `setModel`. Refreshed with every listing, forgotten with it.
   */
  private readonly trainingModelIds = new Set<string>()
  private modelListing: Promise<void> | undefined
  /** The backend the model catalogue was listed from; a new backend or sign-in starts a new one. */
  private modelGeneration = 0
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
  /**
   * Sessions this panel opened that hold imported history (M84, PLAN.md
   * D49), forks included: a plan written in one is untrusted content. Every
   * such session passes through `adopt`; a resume after a restart only
   * reopens a session this panel already had.
   */
  private readonly importedSessionIds = new Set<string>()
  private effort: EffortLevel = DEFAULT_EFFORT
  private isThinkingEnabled = true
  private activeTurnId: string | undefined
  /**
   * Child sessions this surface has rows for. Their turns reach the parent
   * stream (M48) but never take the parent turn's steering, Stop or Ctrl+B.
   */
  private messageDisplayQueue: Promise<void> = Promise.resolve()
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
  /** Read synchronously by the paid driver's start; each stream keeps that immutable scope. */
  private startingVoiceBudgetScope: OwnedSessionBudgetScope | undefined
  private startingVoiceConsentFence: VoiceConsentFence | undefined
  /** Context changes stay changed for consent, including a model/mode round trip. */
  private voiceContextRevision = 0
  /** Approvals "Edit automatically" answered itself (D24): their resolution is labelled so. */
  private readonly autoApproved = new Set<string>()
  /**
   * The Auto reviewer on Muse Code (M90, PLAN.md D69): this conversation's
   * approvals in its hands (and its breaker), made on the first review.
   */
  private reviews: ReviewedApprovals | undefined
  private readonly judgeCards = new Map<string, JudgeFence>()
  /** What the reviewer is shown (M78's input): the user's latest message, the turn's calls so far. */
  private reviewUserText: string | undefined
  private reviewCalls: readonly { readonly tool: string; readonly args: string }[] = []
  /** The remote-window Bypass confirmation, given once per conversation (D24). */
  private hasConfirmedRemoteBypass = false
  /** Said once the surface is ready: why the conversation did not start as configured. */
  private startupNotice: string | undefined
  /**
   * Failures already shown in the panel. Everything waiting on one host
   * start gets the same failure when it fails: it is shown once, and the
   * other waiters only log it (0.10.0 showed one slow start six times).
   */
  private readonly shownFailures = new WeakSet<object>()
  /**
   * Muse Code faults said in this panel, by session and fault (D26): each is
   * said once, with its way on; a repeat only logs.
   */
  private readonly shownFaults = new Set<string>()
  /**
   * Stored-output reads in flight, by item, output and offset: a row that
   * asks again (re-rendered, collapsed and expanded) joins the read already
   * sent instead of queueing another behind it on a busy host.
   */
  private readonly outputReads = new Map<string, Promise<void>>()
  /**
   * Stored-output reads sent at once, the rest waiting in order (CLI
   * recovery): a read still waiting when its session is no longer this
   * panel's is never sent.
   */
  private readonly outputReadSlots = new FifoLimiter(MSP_READ_OUTPUT_CONCURRENCY)
  /** A failed output read was said in this conversation; later ones only log until one succeeds. */
  private hasSaidOutputFailure = false
  /** Each session's effort changes: one in flight, the newest waiting (CLI recovery). */
  private readonly effortSyncs = new WeakMap<AgentSession, EffortSync>()
  /** The backend kind of the attached session (a resume only goes to the same kind). */
  private sessionKind: BackendKind | undefined
  /** Best-of-N runs (M77): one manager per surface, posting to it. */
  private bestOfNManager: BestOfNManager | undefined
  /** The latest run this surface heard of, for the take's branch names. */
  private lastBestOfNRun: BestOfNRun | undefined
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
  /** The session whose goal is read back before its next action (`goalOutcomeUnknown`). */
  private goalRefreshSessionId: string | undefined
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
  /** Commit, push, pull requests and their generated drafts (M71). */
  private readonly git: ConversationGitPort
  /**
   * A Muse Code review turn holding the session in Plan mode (M70), and the
   * mode the user had, which comes back when that turn ends.
   */
  private planHold:
    | {
        readonly hold: PlanModeHold
        readonly previousMode: PermissionMode
        readonly bypassEpoch: number
      }
    | undefined
  /**
   * A `/review` on its way (git, the pickers, the session): one at a time.
   * A message sent meanwhile waits for it (`sessionForAction`), so it cannot
   * start a turn the review's own turn would then queue or steer behind.
   * It belongs to the conversation that started it: a dropped conversation
   * lets it go (`dropSession`), so its outstanding command never holds up
   * or refuses the next conversation.
   */
  private reviewStart: Promise<void> | undefined
  /** Mode choices and revocation wait for the outstanding owned request; the newest wins. */
  private reviewModeSettling: Promise<void> | undefined
  private permissionModeSelection = 0
  /** Turning Bypass off invalidates prior popups and restores, even after off/on. */
  private bypassRevocationEpoch = 0
  /**
   * The review pane's hunks reverted in this session (M70): each is taken out
   * once. The value is the press that holds it, so a press that went stale
   * releases only its own hold.
   */
  private readonly revertedHunks = new Map<string, symbol>()
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
  /** Plan actions and handoff Start share the conversation-replacing operation lock. */
  private isPlanActionRunning = false
  /** This conversation's turn checkpoints (M72). */
  private readonly checkpoints: ConversationCheckpoints
  /**
   * A `/handoff` (M74) in flight: its distillation turn, then its brief
   * waiting in the dialog. One at a time; a new conversation drops it.
   */
  private pendingHandoff: PendingHandoff | undefined
  /** Report a problem (M93): the dialog's handler, one per surface, loaded with dist/report.js. */
  private reportHandler:
    Promise<{ handle: (message: ReportProblemMessage) => Promise<void> }> | undefined
  /**
   * Messages of this session accepted as queued or steered that may still be
   * taken back (M87, PLAN.md D66), by their card's local id: the only ids an
   * Edit may name. The backend has the last word (`tooLate`).
   */
  private readonly queuedMessages = new Map<string, QueuedMessageRef>()
  /**
   * User items a request read before their submission's ack came back (M87):
   * the late ack must not offer them for an Edit. Cleared with the session,
   * and when a turn ends (a steer acknowledged after its turn ended is not
   * kept anyway).
   */
  private readonly admittedEarly = new Set<string>()
  /** Cards whose withdrawal is in flight: a second Edit leaves the answer to the first. */
  private readonly withdrawals = new Set<string>()
  /** The conversation's name as the surface shows it; undefined while untitled. */
  private conversationName: string | undefined
  /** The last todo list a session's events or history gave (M87: the tasks tab's list). */
  private todoList: { readonly sessionId: string; readonly items: readonly TodoItem[] } | undefined
  /**
   * The conversation a tasks tab was opened for (M87), by its session; a
   * conversation that had none yet takes its first. Undefined: no tab is
   * open for this surface's conversation.
   */
  private tasksTabFor: { readonly sessionId: string | undefined } | undefined

  public constructor(private readonly deps: ConversationDeps) {
    this.modelId = deps.modelId
    this.isSideChat = deps.surface.isSideChat === true
    const restoredSideId = this.isSideChat ? deps.surface.takeRestoredSessionId() : undefined
    if (restoredSideId !== undefined) {
      this.sideSessionIds.add(restoredSideId)
    }
    // A side chat, and a window held on someone else's pull request (M71), start in Plan.
    this.permissionMode =
      this.isSideChat || deps.isWorktreeHeld() ? 'plan' : deps.initialPermissionMode
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
    this.checkpoints = new ConversationCheckpoints({
      backend: (sessionId) =>
        this.session !== undefined && this.session.sessionId === sessionId
          ? this.sessionKind
          : undefined,
      port: deps.checkpoints,
      post: (message) => {
        this.post(message)
      },
      notice: (level, text, redoRestoreId) => {
        this.notice(level, text, redoRestoreId)
      },
      confirm: deps.confirmFileAction,
      unsavedPaths: deps.unsavedPaths,
      log: deps.log,
    })
    this.git = deps.createGit({
      post: (message) => {
        if (!this.isDisposed) {
          this.post(message)
        }
      },
      notice: (level, text) => {
        if (!this.isDisposed) {
          this.notice(level, text)
        }
      },
      say: (level, text) => {
        if (!this.isDisposed) {
          this.say(level, text)
        }
      },
      sessionId: () => this.session?.sessionId,
    })
  }

  private post(message: HostToWebviewMessage): void {
    // Streamed text still waiting goes first, so nothing overtakes it.
    this.flushDelta()
    switch (message.type) {
      case 'agentEvent': {
        this.deps.surface.post({ ...message, event: redactDiagnosticEvent(message.event) })
        break
      }
      case 'notice': {
        this.deps.surface.post({ ...message, text: redactSecrets(message.text) })
        break
      }
      case 'withdrawRefused': {
        this.deps.surface.post({ ...message, reason: redactSecrets(message.reason) })
        break
      }
      default: {
        this.deps.surface.post(message)
      }
    }
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
  private notice(level: NoticeLevel, text: string, redoRestoreId?: string, error?: unknown): void {
    const logged = isMspFailure(error) ? failureForLog(error) : redactSecrets(text)
    if (level === 'error') {
      this.deps.log.error(`${NOTICE_PREFIX}${logged}`)
    } else if (level === 'warning') {
      this.deps.log.warn(`${NOTICE_PREFIX}${logged}`)
    }
    this.say(level, text, redoRestoreId)
  }

  /**
   * Says `text` in the panel only: for a failure already logged in more
   * detail. A file restore's notice carries its Redo (M72). An error is
   * journalled as a fact (M93, D72), never its text, and its row offers
   * "Report this" with the sanitized reference.
   */
  private say(level: NoticeLevel, text: string, redoRestoreId?: string): void {
    const reportRef =
      level === 'error'
        ? this.deps.reports?.record('errorNotice', REPORT_UNKNOWN_ERROR_CODE)
        : undefined
    this.post({
      type: 'notice',
      level,
      text,
      ...(redoRestoreId !== undefined && { redoRestoreId }),
      ...(reportRef !== undefined && { reportRef }),
    })
  }

  /**
   * A Muse Code fault (D26), said once per session in plain words with the
   * way on: the replay fault refuses every message, so it offers a restart
   * (after which the session runs again) and a new conversation; the ledger
   * fault only spoils each decision's reply, so it offers a new conversation.
   */
  private noteMuseCodeFault(error: MuseCodeFaultError): void {
    const key = this.faultKey(error.fault)
    if (this.shownFaults.has(key)) {
      this.deps.log.warn(`Muse Code fault ${error.fault} again (said once in the panel)`)
      return
    }
    this.shownFaults.add(key)
    const isReplay = error.fault === 'approvalReplay'
    const text = isReplay ? UI_TEXT.approvalReplayRefused : UI_TEXT.approvalLedgerFault
    const actions: readonly NoticeAction[] = isReplay
      ? ['restartMuseCode', 'newConversation']
      : ['newConversation']
    const level: NoticeLevel = isReplay ? 'error' : 'warning'
    this.deps.log[isReplay ? 'error' : 'warn'](`${NOTICE_PREFIX}${text}`)
    this.post({ type: 'notice', level, text, actions: [...actions] })
  }

  private faultKey(fault: MuseCodeFaultError['fault']): string {
    return `${this.session?.sessionId ?? ''}\u{0}${fault}`
  }

  private isDamaged(sessionId: string): boolean {
    return this.deps.sessions.damagedIds().includes(sessionId)
  }

  /**
   * Muse Code said this session's event log failed (CLI recovery): Muse Code
   * 1.4.2 then failed every message of it (the owner's session of
   * 2026-10-02/03). It is kept as damaged in this workspace, the newest
   * `DAMAGED_SESSIONS_KEPT`: never resumed by itself again, and a message to
   * it is refused before Muse Code hears of it. It stays in History.
   */
  private markDamaged(sessionId: string, how: string): void {
    const damaged = this.deps.sessions.damagedIds()
    if (damaged.includes(sessionId)) {
      return
    }
    this.deps.log.warn(
      `Session ${sessionId}'s Muse Code event log failed (${how}); it takes no new message`,
    )
    void this.deps.sessions
      .setDamagedIds([...damaged, sessionId].slice(-DAMAGED_SESSIONS_KEPT))
      .catch((error: unknown) => {
        this.deps.log.warn(`The damaged session list could not be saved: ${errorKind(error)}`)
      })
  }

  /** The session this panel's next message would go to, when its log is damaged. */
  private damagedTarget(): string | undefined {
    const sessionId = this.session?.sessionId ?? this.resumeTarget?.sessionId
    return sessionId !== undefined && this.isDamaged(sessionId) ? sessionId : undefined
  }

  /**
   * A message or action for a damaged session (CLI recovery): a message's
   * card says why and the composer keeps the draft; the notice beside it
   * offers a new conversation (D26's way on), each time.
   */
  private refuseDamaged(
    sessionId: string,
    localId: string | undefined,
    isComposerMessage: boolean,
  ): void {
    this.deps.log.info(
      `A message to session ${sessionId} was refused: its Muse Code log is damaged`,
    )
    if (localId !== undefined) {
      this.post({
        type: 'sendFailed',
        localId,
        reason: UI_TEXT.sessionLogDamaged,
        attachmentsKept: isComposerMessage,
      })
    }
    this.post({
      type: 'notice',
      level: 'warning',
      text: UI_TEXT.sessionLogDamaged,
      actions: ['newConversation'],
    })
  }

  /**
   * Whether this panel is yet to show `error`, which it now counts as shown:
   * the first of the actions sharing a failed start shows it, the rest log it.
   */
  private isFirstShowing(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && this.shownFailures.has(error)) {
      return false
    }
    this.noteShown(error)
    return true
  }

  /** `error` is shown in the panel (a failed message's own card says it). */
  private noteShown(error: unknown): void {
    if (typeof error === 'object' && error !== null) {
      this.shownFailures.add(error)
    }
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
    void this.checkpoints.sessionChanged(this.session?.sessionId)
    this.refreshTasksTab()
  }

  private postSessionList(): void {
    if (this.sessionRecords === undefined) {
      return
    }
    const sessions: ReturnType<typeof toSessionRow>[] = []
    for (const record of this.sessionRecords.values()) {
      if (
        this.deps.museCodeReviewer?.isSideSession(record.sessionId) === true ||
        this.deps.judge?.isSideSession?.(record.sessionId) === true
      ) {
        // The Auto reviewer's side session (M90): never a conversation of the user's.
        continue
      }
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
    this.conversationName = name
    this.deps.surface.setTitle(name ?? UI_TEXT.untitledConversation)
    this.refreshTasksTab()
  }

  /** What the tasks tab shows for `sessionId` (M87): its last list, under the conversation's name. */
  private tasksTabView(sessionId: string | undefined): TasksTabView {
    const list = this.todoList
    return {
      conversation: this.conversationName ?? UI_TEXT.untitledConversation,
      items: list !== undefined && list.sessionId === sessionId ? [...list.items] : [],
    }
  }

  /**
   * "Open in a tab" on the task list (M87, PLAN.md D66): the tab opens for
   * this conversation, the session it runs on now or resumes on next.
   */
  private openTasksTab(): void {
    const failed = fill(UI_TEXT.hostActionFailed, { action: 'openTasksTab' })
    const port = this.deps.tasksTab
    if (port === undefined) {
      this.notice('error', failed)
      return
    }
    const sessionId = this.session?.sessionId ?? this.resumeTarget?.sessionId
    try {
      port.open(this.tasksTabView(sessionId))
    } catch (error: unknown) {
      this.notice('error', `${failed}: ${describe(error)}`)
      return
    }
    this.tasksTabFor = { sessionId }
  }

  /**
   * The tasks tab follows its conversation (M87): its list and name while
   * that conversation's session is the attached one, and the end once
   * another session takes the surface. Between sessions (one opening, a
   * restart) nothing is said: the same conversation may come back.
   */
  private refreshTasksTab(): void {
    const bound = this.tasksTabFor
    const sessionId = this.session?.sessionId
    if (bound === undefined || sessionId === undefined) {
      return
    }
    if (bound.sessionId === undefined) {
      // A conversation that had no session when its tab opened: this is its first.
      this.tasksTabFor = { sessionId }
    } else if (bound.sessionId !== sessionId) {
      this.endTasksTab()
      return
    }
    this.deps.tasksTab?.update(this.tasksTabView(sessionId))
  }

  /** The tasks tab's conversation ended (cleared, replaced, its panel closed). */
  private endTasksTab(): void {
    if (this.tasksTabFor === undefined) {
      return
    }
    this.tasksTabFor = undefined
    this.deps.tasksTab?.ended()
  }

  /** A session's todo list as its events or its history give it (M87). */
  private noteTodoList(sessionId: string, items: readonly TodoItem[]): void {
    this.todoList = { sessionId, items: [...items] }
    this.refreshTasksTab()
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
      this.deps.log.warn(`turn/cancel before leaving the session failed: ${describeForLog(error)}`)
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
    // A review's Plan mode goes with its session (M70): the next session
    // starts, resumes or is adopted in the mode the user had.
    this.releasePlanHold(true)
    this.reviewModeSettling = undefined
    this.permissionModeSelection += 1
    this.revertedHunks.clear()
    const didHaveSkills = this.skills !== undefined
    this.skills = undefined
    this.skillsRefresh = undefined
    if (didHaveSkills && !this.isDisposed) {
      this.post({ type: 'skillList', skills: [] })
    }
    if (!isOwnedRecovery) {
      this.sendInvalidationEpoch += 1
      // A review starting in the old conversation answers its own card; the
      // next conversation neither waits for it nor is refused because of it.
      this.reviewStart = undefined
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
      // The imported mark (M84) goes with the session: an opening reads it
      // again from the session's record (`adopt`, `resumeAfterRestart`).
      this.importedSessionIds.delete(session.sessionId)
    }
    session?.dispose()
    this.session = undefined
    this.activeTurnId = undefined
    this.hasSaidOutputFailure = false
    this.fileMessageIds.clear()
    this.acceptedUserCards.clear()
    this.queuedMessages.clear()
    this.admittedEarly.clear()
    this.forgetReviews(isOwnedRecovery)
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
    this.checkpoints.turnCompleted(turnId)
    this.forward(event)
    // A draft asked for in this turn (M71) will not come: its form's button comes back.
    this.git.onEvent(event)
  }

  /** A turn's end in the log, and its clock gone (M39). */
  private endTurnClock(event: Extract<AgentEvent, { type: 'turnCompleted' }>): void {
    const logged =
      this.sessionKind === 'museCode' && event.reason !== undefined
        ? { ...event, reason: stderrForLog(event.reason) }
        : event
    this.deps.log.info(turnEndLine(logged, this.turnClocks.get(event.turnId), this.deps.now()))
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
      this.deps.log.warn(`Edit automatically could not approve: ${describeForLog(error)}`)
      this.forward(event)
    }
  }

  /**
   * Whether the Auto reviewer judges an approval before the user (M90,
   * PLAN.md D69): Auto on Muse Code with its setting on, one panel holding
   * the session (as for Edit automatically), and an approval that
   * `isReviewableApproval` admits.
   */
  private isReviewerApproval(event: Extract<AgentEvent, { type: 'approvalRequested' }>): boolean {
    const port = this.deps.museCodeReviewer
    return (
      port !== undefined &&
      this.deps.hasApprovalUi &&
      this.sessionKind === 'museCode' &&
      this.session !== undefined &&
      sessionSurfaces.get(this.session)?.size === 1 &&
      port.isOn() &&
      isReviewableApproval(event, this.permissionMode, this.activeTurnId)
    )
  }

  /**
   * One approval to the Auto reviewer (M90): held from the panel, its card
   * shown only if the review leaves it to the user (reviewedApprovals.ts).
   */
  private holdForReview(event: Extract<AgentEvent, { type: 'approvalRequested' }>): void {
    const { session } = this
    const port = this.deps.museCodeReviewer
    if (session === undefined || port === undefined) {
      return
    }
    try {
      this.reviews ??= port.reviewer().conversation({
        showCard: (held, note) => {
          const card = scrubSecretApproval(note === undefined ? held : { ...held, note })
          this.forward(card)
          this.track(card)
        },
        notice: (level, text) => {
          this.notice(level, text)
        },
        // Still Auto, still on, still this turn of the panel's one session.
        mayAllow: (held) => this.isReviewerApproval(held),
        log: this.deps.log,
        describeFailure: failureForLog,
        judge: this.deps.judge,
      })
    } catch (error: unknown) {
      this.deps.log.warn(
        `The Auto reviewer could not be loaded; the user decides: ${describeForLog(error)}`,
      )
      const card = { ...event, note: UI_TEXT.autoReviewerFailed }
      this.forward(card)
      this.track(card)
      return
    }
    this.reviews.hold(event, {
      session,
      host: () => this.deps.ensureHost(),
      modelId: this.modelId,
      request: {
        userRequest: this.reviewUserText,
        recentCalls: this.reviewCalls,
        tool: event.toolName,
        action: event.subject.command ?? event.rawArgs,
        workspaceRoot: this.deps.workspaceRoot ?? '',
        platform: this.deps.platform,
      },
    })
  }

  private clearJudgeCards(): void {
    for (const fence of this.judgeCards.values()) fence.discard()
    this.judgeCards.clear()
  }

  private watchJudgeCard(event: Extract<AgentEvent, { type: 'approvalRequested' }>): void {
    if (this.sessionKind !== 'museCode' || this.session === undefined || event.isReplayed === true)
      return
    const fence = startApprovalJudge(
      this.deps.judge,
      {
        backend: 'museCode',
        sessionId: this.session.sessionId,
        turnId: event.turnId ?? this.activeTurnId ?? '',
        tool: event.toolName,
      },
      event.rawArgs,
      JSON.stringify({
        userRequest: this.reviewUserText,
        recentCalls: this.reviewCalls,
        tool: event.toolName,
        action: event.subject.command ?? event.rawArgs,
      }),
    )
    if (fence === undefined) return
    this.judgeCards.get(event.approvalId)?.discard()
    this.judgeCards.set(event.approvalId, fence)
    // The request renders first; the background source never delays the card.
    fence.card(() => {
      if (this.judgeCards.get(event.approvalId) !== fence) return
      this.forward({
        type: 'approvalCaution',
        approvalId: event.approvalId,
        requirementId: event.requirementId,
      })
    })
  }

  /** The user's message reached the host: the reviewer is shown it, and may answer again. */
  private noteReviewMessage(text: string): void {
    this.reviewUserText = text
    this.reviews?.reset()
  }

  /** A call the running turn finished: the reviewer is shown the turn's latest ones. */
  private noteReviewCall(item: ItemSnapshot): void {
    if (
      item.kind !== TOOL_CALL_KIND ||
      item.turnId === undefined ||
      item.turnId !== this.activeTurnId
    ) {
      return
    }
    this.reviewCalls = [
      ...this.reviewCalls,
      { tool: item.tool ?? '', args: item.args ?? '' },
    ].slice(-AUTO_REVIEWER_RECENT_CALLS)
  }

  /** The session left this panel: its reviews stop; a new conversation forgets what they were shown. */
  private forgetReviews(isOwnedRecovery: boolean): void {
    if (this.session !== undefined) this.deps.judge?.discardSession(this.session.sessionId)
    this.clearJudgeCards()
    this.reviews?.forget()
    if (isOwnedRecovery) {
      return
    }
    this.reviews = undefined
    this.reviewUserText = undefined
    this.reviewCalls = []
  }

  /** An event as the webview sees it, plus the unread mark. */
  /**
   * The failures a session's events show, journalled as facts (M93, D72): a
   * failed turn (its error row then offers "Report this" with the returned
   * reference) and a failed tool call. Nothing else of the event is kept;
   * the event itself goes to the panel unchanged.
   */
  private observeFailure(event: AgentEvent): ReportEventRef | undefined {
    const reports = this.deps.reports
    if (reports === undefined) {
      return undefined
    }
    if (event.type === 'turnCompleted' && event.terminal === 'failed') {
      return reports.record('errorNotice', event.errorKind ?? REPORT_UNKNOWN_ERROR_CODE)
    }
    if (event.type === 'itemCompleted' && event.item.status === FAILED_ITEM_STATUS) {
      reports.record('toolCallFailed', REPORT_UNKNOWN_ERROR_CODE)
    }
    return undefined
  }

  private forward(event: AgentEvent): void {
    if (event.type === 'textDelta') {
      this.queueDelta(event)
      return
    }
    const reportRef = this.observeFailure(event)
    if (
      (event.type === 'approvalRequested' || event.type === 'questionRequested') &&
      event.isReplayed !== undefined
    ) {
      const shown = { ...event }
      delete shown.isReplayed
      this.post({ type: 'agentEvent', event: shown })
    } else {
      this.post({ type: 'agentEvent', event, ...(reportRef !== undefined && { reportRef }) })
    }
    if (ATTENTION_EVENTS.has(event.type)) {
      this.deps.surface.markUnread()
    }
    const sessionId = this.session?.sessionId
    const notice = sessionId === undefined ? undefined : attentionNotice(sessionId, event)
    if (notice !== undefined) {
      this.deps.notifyAttention(notice)
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
          this.notice(
            'warning',
            `${UI_TEXT.viewGapReloadFailed}: ${describe(error)}`,
            undefined,
            error,
          )
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

  /**
   * An assistant message about to show (M91 lane E): MessageDisplay fires
   * on both backends, since display passes through here. The message is
   * held until its hooks answer; a display-only rewrite travels on the
   * forwarded item's `displayText` while `text` stays the original, so
   * history, copy and export keep what the model wrote. True when held.
   */
  private holdForMessageDisplay(event: Extract<AgentEvent, { type: 'itemCompleted' }>): boolean {
    const session = this.session
    const fire = session?.fireExtensionHook
    const rewrite = this.deps.rewriteMessage
    const text = event.item.kind === AGENT_MESSAGE_KIND ? event.item.text : undefined
    if (
      text === undefined ||
      (fire === undefined && rewrite === undefined) ||
      event.item.status !== COMPLETED_STATUS ||
      text.trim() === ''
    ) {
      return false
    }
    const held = event
    const generation = this.sendInvalidationEpoch
    // The payload matches `messageDisplayFields` in `extensionHooks.ts`
    // (`message`), built inline so that module stays out of the activation
    // bundle. A hook failure shows the message as written, never nothing,
    // and the queue survives a failure so later messages still show.
    const previousDisplay = this.messageDisplayQueue
    this.messageDisplayQueue = (async () => {
      await previousDisplay
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      let shown = held
      try {
        const dispatch =
          fire === undefined
            ? undefined
            : await fire.call(session, 'MessageDisplay', { message: text }, undefined)
        const displayText = dispatch === undefined ? await rewrite?.(text) : dispatch.displayText
        if (displayText !== undefined && displayText !== text) {
          shown = { ...held, item: { ...held.item, displayText } }
        }
      } catch {
        this.deps.log.warn('A MessageDisplay hook failed; the message shows as written')
      }
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      try {
        this.forward(shown)
        this.track(shown)
      } catch (error: unknown) {
        this.deps.log.warn(`An assistant message could not be shown: ${describe(error)}`)
      }
    })()
    return true
  }

  private onEvent(event: AgentEvent): void {
    if (event.type === 'itemCompleted' && this.holdForMessageDisplay(event)) {
      return
    }
    if (event.type === 'modelChanged') {
      if (this.session !== undefined) this.deps.judge?.discardSession(this.session.sessionId)
      this.clearJudgeCards()
      this.voiceContextRevision += 1
    } else if (event.type === 'viewGap') {
      // The controller's own events (D26): never forwarded to the webview.
      this.onViewGap()
      return
    }
    if (event.type === 'goalChanged') {
      this.goalEventCount += 1
    } else if (event.type === 'backendNotice') {
      this.notice(event.level, event.text)
      return
    }
    switch (event.type) {
      case 'approvalRequested': {
        if (this.session !== undefined) {
          this.deps.pendingPrompts.track(this.session.sessionId, event.approvalId)
        }
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
        if (this.isReviewerApproval(event)) {
          this.holdForReview(event)
          return
        }
        this.watchJudgeCard(event)
        break
      }
      case 'approvalUpdated': {
        this.judgeCards.get(event.approvalId)?.discard()
        this.judgeCards.delete(event.approvalId)
        if (this.reviews?.updated(event) === true) {
          return
        }
        break
      }
      case 'approvalResolved': {
        this.judgeCards.get(event.approvalId)?.discard()
        this.judgeCards.delete(event.approvalId)
        this.noteShellApprovalResolved(event)
        if (this.session !== undefined) {
          this.deps.pendingPrompts.resolve(this.session.sessionId, event.approvalId)
        }
        if (this.autoApproved.delete(event.approvalId)) {
          this.forward({ ...event, resolvedBy: UI_TEXT.editAutomaticallyResolver })
          return
        }
        // The Auto reviewer allowed it: the transcript names it and its reason (M90).
        const reason = this.reviews?.resolved(event)
        if (reason !== undefined) {
          this.forward({ ...event, resolvedBy: UI_TEXT.autoReviewerResolver, reason })
          return
        }
        break
      }
      case 'questionRequested': {
        if (this.session !== undefined) {
          this.deps.pendingPrompts.track(this.session.sessionId, event.userInputId)
        }
        break
      }
      case 'questionSettled': {
        if (this.session !== undefined) {
          this.deps.pendingPrompts.resolve(this.session.sessionId, event.userInputId)
        }
        break
      }
      default: {
        break
      }
    }
    // M92e (PLAN.md D71): the panel never shows a secret a proposed shell
    // command holds. The decisions above read the raw event; what is
    // forwarded and tracked is scrubbed, on both backends: the value shown
    // redacted, a secret note, no standing approve choice.
    const shown =
      event.type === 'approvalRequested' || event.type === 'approvalUpdated'
        ? scrubSecretApproval(event)
        : event
    this.forward(shown)
    this.track(shown)
    this.git.onEvent(shown)
  }

  /**
   * Messages no longer to be taken back once `turnId` started, was withdrawn
   * or ended (M87). A start or a withdrawal settles the turn's own queued
   * message; a steered one joined a turn already running, so it stays until
   * admitted. An end settles both: a steer the turn did not take has by
   * then moved to a turn of its own (`userMessageTurnChanged`).
   */
  private forgetQueuedTurn(turnId: string, hasEnded = false): void {
    for (const [localId, message] of this.queuedMessages) {
      if (message.turnId === turnId && (hasEnded || message.disposition === QUEUED_DISPOSITION)) {
        this.queuedMessages.delete(localId)
      }
    }
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
        this.turnStartEpoch += 1
        // A queued message's turn started: the model has it now (M87).
        this.forgetQueuedTurn(event.turnId)
        // A child's own turn reaches the parent stream; the running parent
        // turn keeps the steering, Stop and Ctrl+B (the review of PR #35).
        if (this.isChildTurn(event.turnId)) {
          break
        }
        if (this.session !== undefined && this.activeTurnId !== undefined)
          this.deps.judge?.discardTurn(this.session.sessionId, this.activeTurnId)
        this.clearJudgeCards()
        this.activeTurnId = event.turnId
        this.reviewCalls = []
        this.turnClocks.set(event.turnId, { startedAt: this.deps.now(), firstOutputAt: undefined })
        if (this.session !== undefined && !this.isSideChat) {
          this.checkpoints.turnStarted(this.session.sessionId, event.turnId)
        }
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
      case 'messageAdmitted': {
        // It reached a request (M87): an Edit can no longer take it back.
        // Before its ack (the ack can trail the request), it is remembered.
        let isKnown = false
        for (const [localId, message] of this.queuedMessages) {
          if (message.userMessageId !== event.userMessageId) {
            continue
          }
          this.queuedMessages.delete(localId)
          isKnown = true
        }
        if (!isKnown) {
          this.admittedEarly.add(event.userMessageId)
        }
        break
      }
      case 'userMessageTurnChanged': {
        // A steer the turn ended without waits as a turn of its own (M53),
        // still to be taken back as a queued message under its new turn.
        for (const [localId, message] of this.queuedMessages) {
          if (message.userMessageId === event.userMessageId) {
            this.queuedMessages.set(localId, {
              ...message,
              turnId: event.turnId,
              disposition: QUEUED_DISPOSITION,
            })
          }
        }
        break
      }
      case 'todoChanged': {
        if (this.session !== undefined) {
          this.noteTodoList(this.session.sessionId, event.items)
        }
        break
      }
      case 'turnWithdrawn': {
        this.forgetQueuedTurn(event.turnId)
        // It will never run: a late acceptance must not make it the running turn.
        this.finishedTurns.add(event.turnId)
        this.turnClocks.delete(event.turnId)
        this.planHold?.hold.turnEnded(event.turnId)
        this.pendingPlanTurnIds.delete(event.turnId)
        if (this.pendingHandoff?.turnId === event.turnId) {
          this.pendingHandoff = undefined
          this.notice('warning', UI_TEXT.handoffInterrupted)
        }
        break
      }
      case 'turnCompleted': {
        this.forgetQueuedTurn(event.turnId, true)
        if (!this.isChildTurn(event.turnId)) {
          this.admittedEarly.clear()
        }
        if (this.session !== undefined)
          this.deps.judge?.discardTurn(this.session.sessionId, event.turnId)
        if (event.turnId === this.activeTurnId) this.clearJudgeCards()
        this.endTurnClock(event)
        this.finishedTurns.add(event.turnId)
        // A review turn's end puts the user's mode back (M70).
        this.planHold?.hold.turnEnded(event.turnId)
        // A Plan-mode turn that finished with the panel in Plan mode throughout (M79).
        if (this.pendingPlanTurnIds.delete(event.turnId)) {
          this.planTurnIds.add(event.turnId)
        }
        this.checkpoints.turnCompleted(event.turnId)
        // A handoff's distillation turn (M74): its reply is the brief.
        if (
          this.pendingHandoff?.turnId === event.turnId &&
          this.pendingHandoff.brief === undefined
        ) {
          if (event.terminal === 'completed') {
            void this.finishHandoff(event.turnId)
          } else {
            this.pendingHandoff = undefined
            this.notice('warning', UI_TEXT.handoffInterrupted)
          }
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
        // This session's own event log failed (a child's turn is the child's).
        if (
          event.terminal === 'failed' &&
          event.reason?.includes(MUSE_EVENT_LOG_FAULT) === true &&
          !this.isChildTurn(event.turnId) &&
          this.session !== undefined
        ) {
          this.markDamaged(this.session.sessionId, 'a turn ended on it')
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
        if (event.type === 'itemCompleted') {
          this.noteReviewCall(event.item)
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
   * The shell sandbox's notice when a Muse Code session starts (PLAN.md D12).
   * Without the sandbox, Muse Code's file tools write anywhere without asking
   * (musecode-write-asks), which is said once per window, whether the setting
   * or `auto` turned it off. The sandbox forced on where this CLI cannot run
   * commands (#26) is warned once per session.
   */
  private noteShellSandbox(): void {
    const posture = this.deps.shellSandbox()
    if (!posture.isSandboxed) {
      if (this.deps.shouldWarnSandboxOff?.() ?? true) {
        this.notice(
          'warning',
          posture.reason === 'profileWorkspace'
            ? UI_TEXT.sandboxOffProfileWarning
            : UI_TEXT.sandboxOffSettingWarning,
        )
      }
      return
    }
    if (posture.isUnsupportedWorkspace) {
      this.notice('warning', UI_TEXT.sandboxProfileNotice)
    }
  }

  /**
   * The shell tool's "sandbox not set up" failure gets one actionable notice;
   * a `!` row's too (M46). While Muse Code's sandbox is still preparing
   * (its read-access worker holds the lock), it is set up already, so the
   * notice says to wait instead and no setup is offered.
   */
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
    if (text.includes(SANDBOX_PREPARING_MARKER)) {
      this.notice('warning', UI_TEXT.sandboxPreparingNotice)
      return
    }
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
    // The stage is logged: a multi-command line is one approval decided
    // stage by stage, which read as repeated answers without it.
    this.deps.log.info(
      `Approval ${message.approvalId} stage ${String(message.requirementId.sourceIndex)} answered: ${message.choiceId}`,
    )
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
      if (isMuseCodeFaultError(error)) {
        // The decision applied (#29); the card follows the host's resolve.
        this.noteMuseCodeFault(error)
        return
      }
      // The wording must not claim the decision was refused: the tool may
      // run on. The card offers the choice again only when the host still
      // waits on this stage (one decision per stage, D26); otherwise it
      // follows the host's own events.
      this.notice('warning', `${UI_TEXT.decisionErrorNotice}: ${describe(error)}`, undefined, error)
      if (isDecisionNotAppliedError(error)) {
        this.post({ type: 'approvalReopened', approvalId: message.approvalId })
      }
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
    if (error.reason === 'movedOn' && 'approvalId' in prompt) {
      // Said on the card itself, which shows the step Muse Code waits on.
      this.deps.log.info(
        `Approval ${prompt.approvalId}: a decision arrived after its step moved on`,
      )
      this.post({ type: 'approvalMovedOn', approvalId: prompt.approvalId })
      return
    }
    this.notice('info', promptSettledText(error.reason))
    if (error.reason === 'gone') {
      this.post({ type: 'promptDropped', ...prompt })
    }
  }

  /** An elicitation form's answer (M91 lane M): accept, decline or cancel. */
  private async answerElicitation(
    message: Extract<ConversationMessage, { type: 'elicitationAnswer' }>,
  ): Promise<void> {
    const { session } = this
    if (session === undefined) {
      return
    }
    const settle = session.settleElicitation
    if (settle === undefined) {
      this.notice('error', UI_TEXT.elicitationExpired)
      return
    }
    try {
      const reply =
        message.action === 'accept'
          ? { kind: 'accepted' as const, values: { ...message.values } }
          : { kind: message.action === 'decline' ? ('declined' as const) : ('cancelled' as const) }
      await settle.call(session, message.elicitationId, reply)
    } catch (error: unknown) {
      // A refused answer unlocks the form, as a refused question answer
      // does (M25): the user fixes the named field and sends again.
      this.notice('error', `${UI_TEXT.answerNotAccepted}: ${describe(error)}`)
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
      this.notice('error', `${UI_TEXT.questionCancelFailed}: ${describe(error)}`, undefined, error)
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
      this.notice('error', `${UI_TEXT.answerNotAccepted}: ${describe(error)}`, undefined, error)
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
      this.notice('error', `${UI_TEXT.clarifyNotAccepted}: ${describe(error)}`, undefined, error)
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
      this.notice('warning', `${failure}: ${describe(error)}`, undefined, error)
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
      this.notice('warning', `${UI_TEXT.stopTaskFailed}: ${describe(error)}`, undefined, error)
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
    if (this.deps.isWorktreeHeld()) {
      this.post({ type: 'userShellRefused', command: trimmed, reason: UI_TEXT.worktreeHeldShell })
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
    this.turnSubmissionsInFlight += 1
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
      await this.runResuming(host, session, (current) => {
        if (this.revertsInFlight > 0) {
          throw new Error(UI_TEXT.restoreTurnRunning)
        }
        return current.runUserShell(trimmed)
      })
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
    } finally {
      this.turnSubmissionsInFlight -= 1
    }
  }

  /**
   * One page of a row's stored output (an edit's patch). A read already in
   * flight for the same page is joined, not sent again, and its page serves
   * every row that asked. A failed read is said once in a conversation, with
   * how to retry (collapse and expand the row); later failures only log
   * until a read succeeds again, so a busy Muse Code (one answering reads
   * one after another, more than 60 s behind) stacks no notices (D26).
   */
  private async readOutput(
    message: Extract<ConversationMessage, { type: 'readOutput' }>,
  ): Promise<void> {
    const session = this.session
    if (session === undefined) {
      return
    }
    const key = `${message.itemId}\u{0}${message.outputRef}\u{0}${String(message.offsetBytes)}`
    const inFlight = this.outputReads.get(key)
    if (inFlight !== undefined) {
      await inFlight
      return
    }
    const reading = this.readOutputPage(session, message)
    this.outputReads.set(key, reading)
    try {
      await reading
    } finally {
      this.outputReads.delete(key)
    }
  }

  private async readOutputPage(
    session: AgentSession,
    message: Extract<ConversationMessage, { type: 'readOutput' }>,
  ): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const page = await this.readOutputSlot(session, generation, {
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
      this.hasSaidOutputFailure = false
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
      if (generation !== this.sendInvalidationEpoch || this.session !== session) {
        return
      }
      const text = `${UI_TEXT.outputLoadFailed}: ${describe(error)}`
      if (this.hasSaidOutputFailure) {
        this.deps.log.warn(
          `${describeForLog(error)} (item ${message.itemId}; said once in the panel)`,
        )
        return
      }
      this.hasSaidOutputFailure = true
      this.notice('warning', `${text}. ${UI_TEXT.outputLoadRetry}`, undefined, error)
    }
  }

  /**
   * One stored-output page through the read slots (CLI recovery): at most
   * `MSP_READ_OUTPUT_CONCURRENCY` in flight, the rest in order. One whose
   * session is no longer this panel's when its turn comes is never sent: it
   * fails as a stale read, which its caller does not show.
   */
  private readOutputSlot(
    session: AgentSession,
    generation: number,
    request: OutputPageRequest,
  ): Promise<OutputPage> {
    return this.outputReadSlots.run(
      () => session.readOutput(request),
      () =>
        !this.isDisposed && generation === this.sendInvalidationEpoch && this.session === session,
      () => new Error(UI_TEXT.questionCancelled),
    )
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
      this.notice('error', `${UI_TEXT.openFileFailed}: ${describe(error)}`, undefined, error)
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
        this.notice('error', `${UI_TEXT.openOutputFailed}: ${describe(error)}`, undefined, error)
      }
    }
  }

  private async fetchPatch(
    session: AgentSession,
    generation: number,
    itemId: string,
    outputRef: string,
    maxPages = PATCH_DOCUMENT_MAX_PAGES,
    check?: () => void,
  ): Promise<string | undefined> {
    let content = ''
    let offsetBytes = 0
    for (let page = 0; page < maxPages; page += 1) {
      check?.()
      if (!this.isCurrentSessionAction(session, generation)) {
        return undefined
      }
      const chunk = await this.readOutputSlot(session, generation, {
        itemId,
        outputRef,
        offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
      check?.()
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

  /**
   * "Rewind code to here": the edits after a message, reverted newest first
   * (M13), after the same confirmation as a file restore (M72). With `fork`
   * ("Fork conversation and rewind code") the fork follows the rewind in
   * this one action, so neither can overtake the other; declining the
   * confirmation does neither.
   */
  private async rewindCode(
    message: Extract<ConversationMessage, { type: 'rewindCode' }>,
  ): Promise<void> {
    const { edits, fork } = message
    const generation = this.sendInvalidationEpoch
    if (edits.length === 0) {
      this.notice('info', UI_TEXT.rewindNothing)
    } else {
      const isConfirmed = await this.deps.confirmFileAction(
        UI_TEXT.rewindCodeConfirmTitle,
        UI_TEXT.rewindCodeConfirmDetail,
        UI_TEXT.rewindCodeConfirmAction,
      )
      if (!isConfirmed) {
        return
      }
      let isRewound = true
      for (const edit of edits) {
        if (generation !== this.sendInvalidationEpoch || this.accountStopsInFlight > 0) {
          return
        }
        if (!(await this.reviewEdit('revert', edit.itemId, edit.outputRef))) {
          isRewound = false
        }
      }
      if (generation !== this.sendInvalidationEpoch || this.accountStopsInFlight > 0) {
        return
      }
      if (!isRewound) {
        // An edit that could not be reverted was said above: the code is not rewound,
        // so the conversation is not forked away from the history it still matches.
        if (fork !== undefined) {
          this.notice('warning', UI_TEXT.rewindNotDone)
        }
        return
      }
      this.notice('info', plural(UI_TEXT.rewindDone, edits.length))
    }
    if (fork === undefined) {
      return
    }
    if (fork.lastTurnId === undefined) {
      this.clear()
      return
    }
    this.beginBrowserSessionChange(fork.attachmentEpoch)
    await this.forkSession(fork.lastTurnId)
  }

  /**
   * An edit row's Revert (M87, D66 item 17): the one edit undone after the
   * same kind of confirmation as "Rewind code to here", whose single step
   * it is. `reviewEdit` says what was reverted, or why a file was not.
   */
  private async revertEdit(itemId: string, outputRef: string): Promise<void> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation)) {
      return
    }
    // A running turn may be writing the same file, as for a restore (M72).
    if (this.isRevertRefused(this.turnStartEpoch)) {
      this.notice('info', UI_TEXT.restoreTurnRunning)
      return
    }
    const turnStartEpoch = this.turnStartEpoch
    const isConfirmed = await this.deps.confirmFileAction(
      UI_TEXT.revertEditConfirmTitle,
      UI_TEXT.revertEditConfirmDetail,
      UI_TEXT.rowRevertEdit,
    )
    // The conversation may have changed, or a turn started, while it was open.
    if (
      !isConfirmed ||
      this.accountStopsInFlight > 0 ||
      !this.isCurrentSessionAction(session, generation)
    ) {
      return
    }
    if (this.isRevertRefused(turnStartEpoch)) {
      this.notice('info', UI_TEXT.restoreTurnRunning)
      return
    }
    await this.reviewEdit('revert', itemId, outputRef)
  }

  /**
   * Whether a Revert must not touch the files now (M87): a turn runs or is
   * being submitted, one started since `turnStartEpoch`, or a `/review` is
   * starting (M70), whose turn would read them mid-change.
   */
  private isRevertRefused(turnStartEpoch: number): boolean {
    return (
      this.isTurnRunning() ||
      this.turnStartEpoch !== turnStartEpoch ||
      this.reviewStart !== undefined
    )
  }

  /** Whether the action finished with nothing refused: a warning, an error or no patch is not. */
  private async reviewEdit(
    action: 'openDiff' | 'revert',
    itemId: string,
    outputRef: string,
  ): Promise<boolean> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation)) {
      return false
    }
    const turnStartEpoch = this.turnStartEpoch
    const check = (): void => {
      if (!this.isCurrentSessionAction(session, generation)) {
        throw new Error(UI_TEXT.turnStoppedByRestart)
      }
      if (action === 'revert' && this.isRevertRefused(turnStartEpoch)) {
        throw new Error(UI_TEXT.restoreTurnRunning)
      }
    }
    try {
      check()
      const patch = await this.fetchPatch(
        session,
        generation,
        itemId,
        outputRef,
        PATCH_DOCUMENT_MAX_PAGES,
        check,
      )
      check()
      if (patch === undefined || !this.isCurrentSessionAction(session, generation)) {
        return false
      }
      let notices: readonly ReviewNotice[]
      if (action === 'revert') {
        this.revertsInFlight += 1
        try {
          notices = await this.deps.editReview.revert(itemId, patch, check)
        } finally {
          this.revertsInFlight -= 1
        }
      } else {
        notices = await this.deps.editReview.openDiff(itemId, patch)
      }
      check()
      for (const notice of notices) {
        this.notice(notice.level, notice.text)
      }
      return notices.every((notice) => notice.level === 'info')
    } catch (error: unknown) {
      if (this.isCurrentSessionAction(session, generation)) {
        if (action === 'revert' && this.isRevertRefused(turnStartEpoch)) {
          this.notice('info', UI_TEXT.restoreTurnRunning)
        } else {
          this.notice('error', `${UI_TEXT.editReviewFailed}: ${describe(error)}`, undefined, error)
        }
      }
      return false
    }
  }

  /**
   * The catalogue belongs to the backend, not to a conversation: a new, resumed or
   * forked conversation keeps it (it once emptied the picker until the next send).
   * Only a backend that stops or exits, or a sign-in change, forgets it.
   */
  private forgetModels(): void {
    const didHaveModels = this.models !== undefined
    this.modelGeneration += 1
    this.models = undefined
    this.trainingModelIds.clear()
    this.modelListing = undefined
    if (didHaveModels && !this.isDisposed) {
      this.post({ type: 'modelList', models: [] })
    }
  }

  /** One `model/list` at a time: the warm-up and the first send may overlap (M15). */
  private async ensureModels(host: AgentHost): Promise<void> {
    if (this.models !== undefined) {
      return
    }
    const listing = this.modelListing ?? this.listModels(host, this.modelGeneration)
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
    if (this.isDisposed || this.modelGeneration !== generation) {
      return
    }
    // A confidential workspace hides the contributor tier and any BYO model
    // whose provider or route may train on the content (M95, PLAN.md D74).
    // The refused ids stay known for a stale `setModel` naming one.
    this.trainingModelIds.clear()
    for (const model of listed) {
      if (model.trainsOnContent === true) {
        this.trainingModelIds.add(model.modelId)
      }
    }
    const models = this.deps.isConfidentialWorkspace()
      ? listed.filter(
          (model) => !isContributorModel(model.modelId) && model.trainsOnContent !== true,
        )
      : listed
    this.models = models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      ...(model.contextLimit !== undefined && { contextLimit: model.contextLimit }),
      isDefault: model.isDefault,
      ...(model.providerId !== undefined && { providerId: model.providerId }),
      ...(model.providerLabel !== undefined && { providerLabel: model.providerLabel }),
      ...(model.pricing !== undefined && { pricing: model.pricing }),
      ...(model.inputUsdPerMTokens !== undefined && {
        inputUsdPerMTokens: model.inputUsdPerMTokens,
      }),
      ...(model.outputUsdPerMTokens !== undefined && {
        outputUsdPerMTokens: model.outputUsdPerMTokens,
      }),
      ...(model.isPinned === true && { isPinned: model.isPinned }),
      ...(model.trainsOnContent === true && { trainsOnContent: model.trainsOnContent }),
    }))
    this.post({ type: 'modelList', models: [...this.models] })
  }

  /**
   * The composer's effort for the session; a refusal is said, and the turn
   * still goes. One `session/setReasoningEffort` per session is in flight
   * (CLI recovery): a change meanwhile replaces the one waiting, which is
   * sent when the first settles if it differs from what that sent, and a
   * burst's failure is said once. `kept` is what the session holds before
   * this burst. Resolves to undefined when the newest value applied, else to
   * the composer state the session still holds.
   */
  private applyEffort(
    session: AgentSession,
    kept: ComposerEffort,
  ): Promise<ComposerEffort | undefined> {
    const state = { effort: this.effort, isThinkingEnabled: this.isThinkingEnabled }
    const wanted = effortForThinking(state.effort, state.isThinkingEnabled)
    const running = this.effortSyncs.get(session)
    if (running?.done !== undefined) {
      running.wanted = wanted
      running.wantedState = state
      return running.done
    }
    const sync: EffortSync = { wanted, wantedState: state, kept, done: undefined }
    this.effortSyncs.set(session, sync)
    sync.done = this.syncEffort(session, sync)
    return sync.done
  }

  private async syncEffort(
    session: AgentSession,
    sync: EffortSync,
  ): Promise<ComposerEffort | undefined> {
    let hasWarned = false
    for (;;) {
      const sent = sync.wanted
      const sentState = sync.wantedState
      let isApplied = true
      try {
        await session.setReasoningEffort(sent)
        sync.kept = sentState
      } catch (error: unknown) {
        isApplied = false
        this.deps.log.warn(`session/setReasoningEffort failed: ${failureForLog(error)}`)
        if (!hasWarned) {
          hasWarned = true
          this.say('warning', `${UI_TEXT.effortNotApplied}: ${describe(error)}`)
        }
      }
      // Ended in the same step that saw nothing newer: a change after this
      // starts a burst of its own.
      if (sync.wanted === sent) {
        this.effortSyncs.delete(session)
        return isApplied ? undefined : sync.kept
      }
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
      this.deps.log.warn(`skill/list failed: ${describeForLog(error)}`)
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
    try {
      this.requireNonConfidentialModel(session.modelId)
    } catch (error: unknown) {
      session.dispose()
      throw error
    }
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
    const stopEvents = session.onEvent((event) => {
      if (
        this.isDisposed ||
        this.session !== session ||
        eventGeneration !== this.sendInvalidationEpoch
      ) {
        return
      }
      this.onEvent(event)
    })
    // A command Muse Code answered with its event log's failure (CLI recovery).
    const stopLogWatch = session.onLogDamaged?.(() => {
      this.markDamaged(session.sessionId, 'a command failed on it')
    })
    this.unsubscribe = () => {
      stopEvents()
      stopLogWatch?.()
    }
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
    this.git.sessionChanged(session.sessionId)
    await this.applyEffort(session, {
      effort: this.effort,
      isThinkingEnabled: this.isThinkingEnabled,
    })
    if (this.session !== session || this.attachmentGeneration !== generation || this.isDisposed) {
      return
    }
    void this.refreshSkills(session)
    if (session.schedules !== undefined) {
      void session.schedules.list().catch((error: unknown) => {
        this.deps.log.warn(`Scheduled prompts could not be loaded: ${describeForLog(error)}`)
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
    this.requireNonConfidentialModel(this.modelId)
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
      this.noteShellSandbox()
      void this.offerBundledSkills()
    }
    return session
  }

  /** The bundled skills' one-time offer for Muse Code (M89), in this panel. */
  private async offerBundledSkills(): Promise<void> {
    const { bundledSkillsOffer } = this.deps
    if (bundledSkillsOffer === undefined) {
      return
    }
    try {
      const offer = await bundledSkillsOffer()
      if (offer === undefined || this.isDisposed) {
        return
      }
      this.deps.log.info(`${NOTICE_PREFIX}${offer.text}`)
      this.post({ type: 'notice', level: 'info', text: offer.text, actions: [...offer.actions] })
    } catch (error: unknown) {
      // Nothing to offer is better than a wrong offer; the log says why.
      this.deps.log.warn(`The bundled skills could not be offered: ${describeForLog(error)}`)
    }
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
    if (target !== undefined && this.isDamaged(target.sessionId)) {
      // Never resumed by itself (CLI recovery): Muse Code 1.4.2 re-ran its
      // stale queued turn on resume and failed it again. It stays the target,
      // so the next message is refused rather than sent to a new session.
      this.deps.log.info(`Session ${target.sessionId} is not resumed: its Muse Code log is damaged`)
      throw new Error(UI_TEXT.sessionLogDamaged)
    }
    this.resumeTarget = undefined
    if (target?.kind !== host.info.kind) {
      return undefined
    }
    let loaded: LoadedSession
    const mcpServers = await this.mcpServersFor(host)
    try {
      this.requireNonConfidentialModel(this.modelId)
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
      this.notice('warning', `${UI_TEXT.sessionNotContinued}: ${describe(error)}`, undefined, error)
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
    // The same conversation continues, imported history and all (M84): its
    // mark comes back from the record, while the panel keeps the mode its
    // user chose.
    if (loaded.record.imported === true) {
      this.importedSessionIds.add(loaded.session.sessionId)
    }
    this.activeTurnId = loaded.activeTurnId
    await this.attach(host, loaded.session, 'continued after a restart')
    this.requireCurrentOpening(generation)
    try {
      await loaded.session.setApprovalMode(
        approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
      )
    } catch (error: unknown) {
      this.notice(
        'warning',
        `${UI_TEXT.permissionModeNotApplied}: ${describe(error)}`,
        undefined,
        error,
      )
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
   * Whether the panel still shows `sessionId`'s conversation: attached, or
   * the one the next message resumes after a restart, a crash or the host
   * closing it (D25). A new or other conversation, or an account stop, which
   * clears every panel, is not.
   */
  private holdsConversation(sessionId: string): boolean {
    return (
      !this.isDisposed &&
      this.accountStopsInFlight === 0 &&
      (this.session?.sessionId ?? this.resumeTarget?.sessionId) === sessionId
    )
  }

  /** Why a pane action stopped while its conversation stayed (M70). */
  private paneActionStoppedReason(): string {
    return this.isAuthAdmitted() ? UI_TEXT.turnStoppedByRestart : UI_TEXT.notSignedInReason
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
    // A new turn must not race a restore or revocation that still changes
    // the actual backend mode underneath the panel's temporary label.
    for (;;) {
      const held = this.planHold
      const starting = this.reviewStart
      try {
        await this.reviewModeSettling
      } catch {
        // The mode owner handles the failure and may retire this session.
      }
      await starting
      await held?.hold.waitForModeChange()
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return undefined
      }
      if (
        this.reviewModeSettling === undefined &&
        this.reviewStart === undefined &&
        (this.planHold === held || this.planHold === undefined)
      ) {
        break
      }
    }
    // Refused before any Muse Code command, a resume included (CLI recovery).
    const damaged = this.damagedTarget()
    if (damaged !== undefined) {
      this.refuseDamaged(damaged, localId, isComposerMessage)
      return undefined
    }
    const session = await this.ensureSession(this.deps.workspaceRoot)
    this.requireNonConfidentialModel(session.modelId)
    if (!this.isCurrentSessionAction(session, generation)) {
      return undefined
    }
    // A goal command's unknown outcome (M45): the strip gets the backend's
    // goal back now that the conversation is reachable again.
    if (this.goalRefreshSessionId === session.sessionId) {
      this.goalRefreshSessionId = undefined
      void this.refreshGoal(session, generation)
    }
    return session
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
      if (
        event.record.workspaceRoot !== this.deps.workspaceRoot ||
        this.deps.museCodeReviewer?.isSideSession(event.record.sessionId) === true ||
        this.deps.judge?.isSideSession?.(event.record.sessionId) === true
      ) {
        return
      }
      this.sessionRecords.set(event.record.sessionId, event.record)
    } else {
      const record = this.sessionRecords.get(event.sessionId)
      if (record === undefined) {
        return
      }
      // An unloaded session waits on nothing: its card died with its turn.
      this.deps.pendingPrompts.drop(event.sessionId)
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
        this.notice('error', `${UI_TEXT.historyUnavailable}: ${describe(error)}`, undefined, error)
      }
    }
  }

  // --- Session board and best-of-N (M77) ---

  private async sessionBoard(): Promise<typeof SessionBoardBundle> {
    try {
      const bundle = await import('../sessionBoardEntry')
      if (
        typeof bundle.readSessionBoard !== 'function' ||
        typeof bundle.createBestOfNManager !== 'function'
      ) {
        throw new TypeError(
          'The session board bundle does not export its reader and manager factory',
        )
      }
      return bundle
    } catch (error: unknown) {
      this.deps.log.error(`The session board bundle could not be loaded: ${describeForLog(error)}`)
      throw new Error(UI_TEXT.boardUnavailable, { cause: error })
    }
  }

  private async bestOfN(): Promise<BestOfNManager> {
    const generation = this.sendInvalidationEpoch
    const { createBestOfNManager } = await this.sessionBoard()
    if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
      throw new Error(UI_TEXT.bestOfNContextChanged)
    }
    this.bestOfNManager ??= createBestOfNManager(
      {
        coordinator: this.deps.bestOfNCoordinator,
        getAccountId: this.deps.modelApiAccountId,
        getBudgetScope: async () => await this.deps.bestOfNBudgetScope?.(this.session?.sessionId),
        openWorktree: this.deps.openBestOfNWorktree,
        noteAttemptRequest: this.deps.noteBestOfNRequest,
        noteAttemptUsage: this.deps.noteBestOfNUsage,
        hasDirtyEditors: () => this.deps.unsavedFiles().length > 0,
        contextId: () =>
          `${String(this.sendInvalidationEpoch)}:${this.session?.sessionId ?? ''}:${String(this.isDisposed)}`,
        isBestOfNOn: () => this.deps.isPaidFeatureOn('bestOfN'),
        allowsPaidUse: (request) => this.deps.allowsPaidUse(request),
        notePaidUse: (attempts) => {
          this.deps.notePaidUse('bestOfN', attempts)
        },
        runGit: (args, cwd, timeoutMs, input, beforeRun) =>
          (this.deps.runBestOfNGit ?? this.deps.runGit)(args, cwd, timeoutMs, input, beforeRun),
        repositoryRoot: () => this.deps.workspaceRoot,
        platform: this.deps.platform,
        buildAttemptHost: (worktreeRoot, admitRequest, noteUsage, budgetScope) =>
          this.deps.buildAttemptHost(worktreeRoot, admitRequest, noteUsage, budgetScope),
        modelId: () => this.modelId,
        wireApprovalMode: () => approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
        // The run's extension hooks fire from the surface session's
        // snapshot (M91 lane E): attempts run with hooks off, so the
        // parent's side fires. A session without such a point (Muse Code)
        // leaves the run hookless, as before.
        fireExtensionHook: (event, fields, matcherValue) =>
          this.session?.fireExtensionHook?.(event, fields, matcherValue) ??
          Promise.resolve(NO_EXTENSION_HOOK_DISPATCH),
        isTrusted: () => this.isProjectTrusted(),
        realPath: (absolutePath) => this.deps.realPath(absolutePath),
        onUpdate: (run) => {
          this.lastBestOfNRun = run
          this.post({ type: 'bestOfNUpdate', run })
        },
        log: this.deps.log,
      },
      UI_TEXT,
      uiLocale(),
    )
    return this.bestOfNManager
  }

  /** A settled best-of-N call's failure as a notice; the callers share it. */
  private noticeBestOfNFailure(error: unknown, attemptId?: string): void {
    if (isBestOfNError(error)) {
      this.notice('warning', this.bestOfNErrorText(error, attemptId))
    } else {
      this.notice('error', `${UI_TEXT.bestOfNTitle}: ${describe(error)}`, undefined, error)
    }
  }

  /** Why a best-of-N command was refused, in the user's words. */
  private bestOfNErrorText(error: BestOfNError, attemptId?: string): string {
    const detail = error.detail ?? ''
    switch (error.refusal) {
      case 'noWorkspace': {
        return UI_TEXT.bestOfNNoWorkspace
      }
      case 'untrusted': {
        return this.gitTrustRefusal(UI_TEXT.bestOfNNeedsTrust) ?? UI_TEXT.bestOfNNeedsTrust
      }
      case 'wrongBackend': {
        return UI_TEXT.bestOfNModelApiOnly
      }
      case 'paidOff': {
        return UI_TEXT.bestOfNPaidOff
      }
      case 'invalid': {
        return UI_TEXT.bestOfNInvalidRequest
      }
      case 'unknownModel': {
        return UI_TEXT.bestOfNTariffUnknown
      }
      case 'consentDeclined': {
        return UI_TEXT.bestOfNConsentDeclined
      }
      case 'worktreeFailed': {
        // A take names the branch it could not merge; a start names git's words.
        const branch =
          attemptId === undefined
            ? undefined
            : this.lastBestOfNRun?.runAttempts.find((attempt) => attempt.attemptId === attemptId)
                ?.branch
        return branch === undefined
          ? fill(UI_TEXT.bestOfNWorktreeFailed, { reason: detail })
          : fill(UI_TEXT.bestOfNTakeFailed, { branch, reason: detail })
      }
      case 'alreadyRunning': {
        return UI_TEXT.bestOfNAlreadyRunning
      }
      case 'noRun': {
        return UI_TEXT.bestOfNNoRun
      }
      case 'unknownAttempt': {
        return UI_TEXT.bestOfNUnknownAttempt
      }
      case 'attemptNotDone': {
        return UI_TEXT.bestOfNAttemptNotDone
      }
      case 'alreadyTaken': {
        return fill(UI_TEXT.bestOfNAlreadyTaken, { branch: detail })
      }
      case 'contextChanged': {
        return UI_TEXT.bestOfNContextChanged
      }
      case 'targetChanged': {
        return UI_TEXT.bestOfNTargetChanged
      }
      case 'budgetUnavailable': {
        return UI_TEXT.bestOfNBudgetUnavailable
      }
    }
  }

  private async requestSessionBoard(): Promise<void> {
    if (this.deps.workspaceRoot === undefined) {
      this.notice('warning', UI_TEXT.noWorkspaceReason)
      return
    }
    const generation = this.sendInvalidationEpoch
    const isCurrent = () => generation === this.sendInvalidationEpoch && !this.isDisposed
    try {
      const { readSessionBoard } = await this.sessionBoard()
      if (!isCurrent()) return
      const rows = await readSessionBoard(
        {
          ensureHost: () => this.deps.ensureHost(),
          backendOf: (host) => host.info.kind,
          workspaceRoot: this.deps.workspaceRoot,
          isWorkspaceTrusted: () => this.isProjectTrusted(),
          runGit: (args, cwd, timeoutMs) => this.deps.runGit(args, cwd, timeoutMs),
          platform: this.deps.platform,
          currentSessionId: this.session?.sessionId,
          currentTurnId: this.activeTurnId,
          pendingPrompts: this.deps.pendingPrompts,
          attemptRuns: this.deps.bestOfNCoordinator.snapshots(),
          liveSessions: this.deps.boardSessions?.(),
          log: this.deps.log,
        },
        UI_TEXT,
        uiLocale(),
      )
      if (!isCurrent()) {
        return
      }
      this.post({ type: 'sessionBoard', rows: [...rows] })
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('error', `${UI_TEXT.boardTitle}: ${describe(error)}`, undefined, error)
      }
    }
  }

  private async startBestOfN(
    prompt: string,
    attempts: number,
    requestCeilingPerAttempt: number,
  ): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const host = await this.deps.ensureHost()
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      const manager = await this.bestOfN()
      await manager.start({ prompt, attempts, requestCeilingPerAttempt }, host.info.kind)
    } catch (error: unknown) {
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      this.noticeBestOfNFailure(error)
    }
  }

  private async takeBestOfNAttempt(attemptId: string, runId: string): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const beginWorkspaceEdits = this.deps.bestOfNWorkspaceEdits?.(
        this.sessionKind === 'modelApi' ? this.session : undefined,
      )
      const manager = await this.bestOfN()
      const run = await manager.take(attemptId, runId, beginWorkspaceEdits)
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      if (run.takenBranch !== undefined) {
        this.notice('info', fill(UI_TEXT.bestOfNTaken, { branch: run.takenBranch }))
      }
    } catch (error: unknown) {
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      this.noticeBestOfNFailure(error, attemptId)
    }
  }

  private async cancelBestOfN(runId: string): Promise<void> {
    const generation = this.sendInvalidationEpoch
    try {
      const manager = await this.bestOfN()
      await manager.cancel(runId)
    } catch (error: unknown) {
      if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
        return
      }
      this.noticeBestOfNFailure(error)
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
      items: history.items.map((item) =>
        item.kind === USER_MESSAGE_KIND && item.text !== undefined
          ? { ...item, text: redactSecrets(item.text) }
          : item,
      ),
      ...(history.name !== undefined && { name: history.name }),
      todos: [...history.todos],
      // Absent when the history could not say (M45): the panel keeps what it knew.
      ...(shouldIncludeGoal && history.goal !== undefined && { goal: history.goal }),
      // A turn still running keeps its Stop and its steering (D26).
      ...(activeTurnId !== undefined && { activeTurnId }),
      ...(planTurns.size > 0 && { planTurnIds: [...planTurns] }),
      // Someone else's file (M84): the panel offers no Insert or Apply on it.
      ...(this.importedSessionIds.has(sessionId) && { imported: true }),
    })
    this.noteTodoList(sessionId, history.todos)
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
    if (
      !isModelAllowed ||
      (this.deps.isConfidentialWorkspace() && isContributorModel(this.modelId))
    ) {
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
    // A side chat runs in Plan (M53). Like the imported mode below, applied
    // only now that this opening is still current: one overtaken by another
    // opening must leave no mode behind.
    this.isSideChat = loaded.record.sideChat === true || this.deps.surface.isSideChat === true
    if (this.isSideChat) {
      this.permissionMode = 'plan'
      this.postComposerState()
    }
    // A conversation built on an imported file opens asking, every time and
    // whatever the initial mode (M84, PLAN.md D49): only the user's own mode
    // change relaxes it, and only until it is opened again. Applied only now
    // that this opening is still current: an imported session overtaken by
    // another opening must leave neither its mode nor its mark (Muse review).
    const isImported = loaded.record.imported === true
    if (isImported) {
      this.importedSessionIds.add(loaded.session.sessionId)
      this.permissionMode = untrustedStartMode(this.permissionMode, this.deps.initialPermissionMode)
      this.postComposerState()
    }
    this.postHistory(loaded.session.sessionId, loaded.history, loaded.activeTurnId)
    this.setTitle(loaded.history.name)
    this.notice('info', `${notice} ${loaded.history.name ?? toSessionRow(loaded.record).title}`)
    if (isImported) {
      this.notice(
        'info',
        fill(UI_TEXT.importedUntrusted, { mode: UI_TEXT.permissionModes[this.permissionMode] }),
      )
    }
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
        this.notice(
          'warning',
          `${UI_TEXT.permissionModeNotApplied}: ${describe(error)}`,
          undefined,
          error,
        )
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
      this.requireNonConfidentialModel(this.modelId)
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
      if (generation !== this.sendInvalidationEpoch) {
        return
      }
      if (this.isFirstShowing(error)) {
        this.notice('error', `${UI_TEXT.resumeFailed}: ${describe(error)}`, undefined, error)
      } else {
        this.deps.log.error(`resumeSession failed (shown already): ${describeForLog(error)}`)
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
        this.notice('error', `${UI_TEXT.forkFailed}: ${describe(error)}`, undefined, error)
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
  private async rewindConversation(message: RewindConversationMessage): Promise<void> {
    const prepared = await this.prepareRewind(message)
    if (prepared !== undefined) {
      await this.applyRewind(prepared)
    }
  }

  /**
   * Every check a conversation rewind makes before it changes anything
   * (M53): the source still shown, no file card, the served card and its
   * cut, its images at hand. Undefined, with the reason said, when it cannot
   * go on; a restore that comes with it (M72) runs only after this passed.
   */
  private async prepareRewind(
    message: RewindConversationMessage,
  ): Promise<PreparedRewind | undefined> {
    if (message.turnId === this.activeTurnId) {
      return undefined
    }
    const generation = this.sendInvalidationEpoch
    try {
      const forkable = await this.forkableSource(message.sourceSessionId, generation)
      if (forkable === undefined) {
        return undefined
      }
      const { source, host } = forkable
      if (message.turnId === this.activeTurnId) {
        return undefined
      }
      // Model API replay may hold PDF bytes, but a named text file is stored
      // only as model-facing text. Muse Code echoes file metadata without
      // bytes. Never clear/fork on a file card while its chips cannot be
      // restored exactly in both paths.
      if (this.fileMessageIds.has(message.itemId)) {
        this.notice('warning', UI_TEXT.attachmentUnreadable)
        return undefined
      }
      const history = await host.readSession(source.sessionId)
      if (
        !this.isCurrentSessionAction(source, generation) ||
        message.turnId === this.activeTurnId
      ) {
        return undefined
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
        return undefined
      }
      if (
        selected.turnId !== message.turnId ||
        (selected.text ?? '') !== message.text ||
        (hasEarlierTurn && earlierDistinct === undefined) ||
        earlierDistinct?.turnId !== message.lastTurnId ||
        selected.attachments?.some((attachment) => attachment.type === 'file')
      ) {
        this.notice('warning', UI_TEXT.attachmentUnreadable)
        return undefined
      }
      const images = source.sentImages?.(message.turnId, message.itemId) ?? []
      const recordedImageCount =
        selected.attachments?.filter((attachment) => attachment.type === 'image').length ?? 0
      if (images.length < Math.max(recordedImageCount, message.imageCount)) {
        this.notice('warning', UI_TEXT.rewindImagesUnavailable)
        return undefined
      }
      return { message, source, host, generation, images }
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
        this.notice(
          'error',
          `${UI_TEXT.rewindConversationFailed}: ${describe(error)}`,
          undefined,
          error,
        )
      }
      return undefined
    }
  }

  /** The fork (or a fresh conversation) and the prompt back in the composer; true when done. */
  private async applyRewind(prepared: PreparedRewind): Promise<boolean> {
    const { message, source, host, generation, images } = prepared
    try {
      if (!this.isCurrentSessionAction(source, generation)) {
        return false
      }
      if (message.lastTurnId === undefined) {
        this.clear()
      } else {
        const loaded = await host.forkSession(source.sessionId, this.modelId, message.lastTurnId)
        if (!this.isCurrentSessionAction(source, generation)) {
          loaded.session.dispose()
          return false
        }
        if (!(await this.adopt(host, loaded, UI_TEXT.forkedNotice, 'forked'))) {
          return false
        }
        this.attachments.clear()
        this.post({ type: 'attachmentsCleared' })
      }
      this.returnImages(images)
      this.post({ type: 'restoreDraft', text: message.text })
      return true
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
        this.notice(
          'error',
          `${UI_TEXT.rewindConversationFailed}: ${describe(error)}`,
          undefined,
          error,
        )
      }
      return false
    }
  }

  /**
   * A message's images back in the composer (M53's rewind, M87's Edit on a
   * queued message); true when every one came back.
   */
  private returnImages(images: readonly SentImage[]): boolean {
    let isEveryImageBack = true
    for (const image of images) {
      const added = this.attachments.add(image.mediaType, Buffer.from(image.base64Data, 'base64'))
      if (added.ok) {
        this.post({ type: 'attachmentAdded', attachment: added.attachment })
      } else {
        isEveryImageBack = false
      }
    }
    return isEveryImageBack
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
        this.notice('error', `${UI_TEXT.sideChatFailed}: ${describe(error)}`, undefined, error)
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
        /**
         * Written over imported history (M84), read while the session is
         * still the panel's: its mark goes when the session is dropped.
         */
        readonly isImported: boolean
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
      isImported: this.importedSessionIds.has(session.sessionId),
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
    | {
        readonly saved: SaveOutcome
        readonly text: string
        readonly markdown: PlanMarkdown
        /** The reply was written over imported history (M84). */
        readonly isImported: boolean
      }
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
      return { saved: { ...known, isNew: false }, text, markdown, isImported: reply.isImported }
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
    return { saved, text, markdown, isImported: reply.isImported }
  }

  /**
   * One plan action or handoff Start at a time: a second press while Save
   * plan, Implement, Plans… or Start still runs is dropped, and said, so
   * only one operation can leave and seed a conversation.
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
   * Whether git and the project's own configuration may run here: VS Code
   * trusts the folder and the window is not held on someone else's pull
   * request, or the card let the hold go (M71). Best-of-N, the session
   * board's worktree reads and a review of git's changes ask this, never
   * VS Code's trust alone: a held worktree runs no git of the extension's.
   */
  private isProjectTrusted(): boolean {
    return this.deps.isWorkspaceTrusted() && !this.deps.isWorktreeHeld()
  }

  /** Why git may not run here, `restricted` for Restricted Mode; undefined when it may. */
  private gitTrustRefusal(restricted: string): string | undefined {
    if (!this.deps.isWorkspaceTrusted()) {
      return restricted
    }
    return this.deps.isWorktreeHeld() ? UI_TEXT.worktreeHeldShell : undefined
  }

  /**
   * The mode an approved brief starts in: the configured starting mode,
   * Plan only while a PR worktree is held, and Bypass only where a conversation could start in it and
   * never in a remote window (D24); otherwise Manual.
   */
  private briefMode(): PermissionMode {
    if (this.deps.isWorktreeHeld()) {
      return PLAN_MODE
    }
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
    return this.deps.isWorktreeHeld() || this.deps.initialPermissionMode === PLAN_MODE
      ? PLAN_MODE
      : FALLBACK_MODE
  }

  /** The mode a brief's conversation starts in: Plan where the brief keeps it, else by its trust. */
  private briefStartMode(brief: ConversationBrief): PermissionMode {
    if (brief.shouldKeepPlanMode) {
      return PLAN_MODE
    }
    return brief.isApproved ? this.briefMode() : this.untrustedBriefMode()
  }

  /**
   * Starts a new conversation on this backend from a brief (M79; M74's
   * `/handoff` reuses it). The attachment is checked before anything is
   * left, so a brief the backend would not take changes nothing. Then this
   * conversation is left (History keeps it), Plan mode gives way to the
   * brief's mode, and the brief is sent as the first message, with its card,
   * its note for the model and, where the backend takes one, its todo list.
   */
  private async startFromBrief(
    brief: ConversationBrief,
    generation: number,
    canStart: () => boolean = () => true,
  ): Promise<BriefStart> {
    if (this.isSideChat) {
      this.notice('info', UI_TEXT.sideChatPlanOnly)
      return { status: 'refused' }
    }
    if (this.refuseAction() !== undefined) {
      return { status: 'refused' }
    }
    const host = await this.deps.ensureHost()
    if (generation !== this.sendInvalidationEpoch || this.isDisposed || !canStart()) {
      return { status: 'changed' }
    }
    // Admission may have closed during the lookup (a key activation):
    // refused before anything is left, so the plan or the handoff's
    // reviewed brief stays to start again.
    if (this.refuseAction() !== undefined) {
      return { status: 'refused' }
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
    this.permissionMode = this.briefStartMode(brief)
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
          fill(source.kind === 'file' ? UI_TEXT.planFromFileMode : UI_TEXT.planFromImportedMode, {
            mode: UI_TEXT.permissionModes[this.permissionMode],
          }),
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
      // A reply written over imported history (M84) may be that history's
      // doing: untrusted, as a plan file is, so the new conversation asks.
      const isApproved = !outcome.isImported
      return {
        brief: planBrief(relativePath, bytes, planSteps(markdown, text), isApproved),
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

  /** The handoff request turn's card, in the user's language. */
  private handoffCardText(goal: string | undefined): string {
    return goal === undefined
      ? UI_TEXT.handoffRequestCard
      : fill(UI_TEXT.handoffRequestCardWithGoal, { goal })
  }

  /** A handoff failed before its brief: the reason in the panel, only its kind in the log (M39). */
  private handoffFailed(error: unknown): void {
    this.deps.log.warn(`A handoff failed (${errorKind(error)})`)
    if (!this.isDisposed) {
      this.say('error', `${UI_TEXT.handoffFailed}: ${describe(error)}`)
    }
  }

  private isCurrentHandoff(pending: PendingHandoff): boolean {
    return (
      this.pendingHandoff === pending &&
      pending.generation === this.sendInvalidationEpoch &&
      !this.isDisposed &&
      (pending.session === undefined || this.session === pending.session)
    )
  }

  /**
   * The one check after every await of a handoff's request, brief read and
   * Start (M74): the operation still owns the slot in the same
   * conversation (`isCurrentHandoff`), and the backend still admits it.
   * Where only admission fails (a key activation), the operation is
   * refused but kept, its brief and dialog intact, to be retried.
   */
  private isStillCurrent(pending: PendingHandoff): boolean {
    return this.isCurrentHandoff(pending) && this.isAuthAdmitted()
  }

  private dropHandoff(pending: PendingHandoff): void {
    if (this.pendingHandoff === pending) {
      this.pendingHandoff = undefined
    }
  }

  private canDistilHandoff(pending: PendingHandoff): boolean {
    if (!this.isStillCurrent(pending)) {
      // Admission closed meanwhile: refused with the reason.
      if (this.isCurrentHandoff(pending)) {
        this.notice('warning', UI_TEXT.notSignedInReason)
      }
      return false
    }
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.handoffWaitTurn)
      return false
    }
    return true
  }

  /**
   * `/handoff …` (M74): the host says whether it took the command
   * (`handoffCommandResult`, correlated by `requestId`), and the composer
   * keeps the typed command until it did, so a refused handoff keeps its
   * goal, as `/goal` does.
   */
  private async requestHandoff(requestId: string, goal: string | undefined): Promise<void> {
    let isAccepted = false
    try {
      isAccepted = await this.distilHandoff(requestId, goal)
    } finally {
      this.post({ type: 'handoffCommandResult', requestId, accepted: isAccepted })
    }
  }

  /**
   * Asks the model, as the user's own turn in this conversation, for a
   * distilled brief: true once that turn was accepted. Model API only:
   * Muse Code compacts itself. The brief lands in the dialog through
   * `finishHandoff`; nothing starts before the user confirms it.
   */
  private async distilHandoff(requestId: string, goal: string | undefined): Promise<boolean> {
    if (this.isSideChat) {
      this.notice('info', UI_TEXT.handoffSideChat)
      return false
    }
    const previous = this.pendingHandoff
    if (previous !== undefined && !this.isCurrentHandoff(previous)) {
      this.dropHandoff(previous)
    }
    if (this.pendingHandoff !== undefined) {
      // A brief whose read admission put off is read now, and its dialog
      // is the answer; otherwise this request waits on a running one.
      if (!this.readWaitingBrief()) {
        this.notice('info', UI_TEXT.handoffBusy)
      }
      return false
    }
    // A running reply refuses the request in `canDistilHandoff`, after the
    // host lookup and again after each later await, so no path sends the
    // distillation beside it.
    const generation = this.sendInvalidationEpoch
    const pending: PendingHandoff = {
      requestId,
      goal,
      generation,
      turnId: undefined,
      hasSubmittedTurn: false,
      session: this.session,
      brief: undefined,
      todos: [],
      isReadingBrief: false,
      isStarting: false,
    }
    // This operation owns the slot before host/session/history preparation can yield.
    this.pendingHandoff = pending
    try {
      const host = await this.deps.ensureHost()
      if (!this.canDistilHandoff(pending)) {
        return false
      }
      if (host.info.kind !== 'modelApi') {
        this.notice('info', UI_TEXT.handoffUnavailable)
        return false
      }
      if (
        this.session === undefined &&
        this.resumeTarget === undefined &&
        this.sessionOpening === undefined
      ) {
        this.notice('info', UI_TEXT.handoffEmpty)
        return false
      }
      const session = await this.sessionForAction()
      if (
        session === undefined ||
        !this.canDistilHandoff(pending) ||
        !this.isCurrentSessionAction(session, generation)
      ) {
        return false
      }
      pending.session = session
      const history = await host.readSession(session.sessionId)
      if (!this.canDistilHandoff(pending) || !this.isCurrentSessionAction(session, generation)) {
        return false
      }
      if (history.items.length === 0) {
        this.notice('info', UI_TEXT.handoffEmpty)
        return false
      }
      const cardText = this.handoffCardText(goal)
      const localId = `${HANDOFF_LOCAL_ID_PREFIX}${this.deps.newAttachmentId()}`
      this.post({ type: 'briefSubmitted', localId, text: cardText, attachments: [] })
      const modelText =
        goal === undefined
          ? CONVERSATION_MODEL_TEXT.handoffRequest
          : `${CONVERSATION_MODEL_TEXT.handoffRequest} ${fill(CONVERSATION_MODEL_TEXT.handoffRequestGoal, { goal })}`
      const sent = await this.send(
        localId,
        modelText,
        [],
        false,
        undefined,
        undefined,
        cardText,
        pending,
      )
      // The send's outcome and the operation's ownership: a restart while
      // it ran leaves no handoff behind. Admission closing once the turn
      // was taken leaves the operation waiting for it: the turn is the
      // backend's, and its brief is read when admission is back.
      if (!sent.isAccepted || sent.turnId === undefined || !this.isCurrentHandoff(pending)) {
        return false
      }
      pending.turnId = sent.turnId
      this.deps.log.info(`Handoff ${requestId} distilling in turn ${sent.turnId}`)
      if (this.finishedTurns.has(sent.turnId)) {
        // The turn already completed before its acceptance was handled, so
        // no completion event will arrive for it: read its reply now.
        await this.finishHandoff(sent.turnId)
      }
      return true
    } catch (error: unknown) {
      if (this.isCurrentHandoff(pending)) {
        this.handoffFailed(error)
      }
      return false
    } finally {
      if (this.pendingHandoff === pending && pending.turnId === undefined) {
        this.pendingHandoff = undefined
      }
    }
  }

  /**
   * The distillation turn completed: read its reply back as the brief and
   * show it in the dialog, with the open todo items. The turn's own card
   * stays in the transcript; the new conversation starts only on confirm.
   */
  private async finishHandoff(turnId: string): Promise<void> {
    const pending = this.pendingHandoff
    if (pending?.turnId !== turnId || pending.brief !== undefined || pending.isReadingBrief) {
      return
    }
    pending.isReadingBrief = true
    try {
      // While admission is closed the operation waits, its turn done, and
      // `readWaitingBrief` reads the brief after sign-in/key activation,
      // or when the panel next asks.
      if (!this.isStillCurrent(pending)) {
        return
      }
      const host = await this.deps.ensureHost()
      const hasConversationToResume = this.session !== undefined || this.resumeTarget !== undefined
      let session = pending.session
      if (hasConversationToResume && session === undefined) {
        // Rebound after a resumable restart (M74): the stop dropped the
        // waiting handoff's session, so the retry reads the brief from the
        // resumed conversation (the review of PR #84).
        const resumed = await this.sessionForAction()
        if (resumed !== undefined && this.pendingHandoff === pending) {
          pending.session = resumed
          session = resumed
        }
      }
      if (session === undefined || !this.isStillCurrent(pending)) {
        return
      }
      const history = await host.readSession(session.sessionId)
      // A restart, a stop, or a cancel while the read ran leaves no brief
      // behind; admission closing leaves it to be read again.
      if (!this.isStillCurrent(pending)) {
        return
      }
      const reply = history.items.findLast(
        (item) => item.kind === AGENT_MESSAGE_KIND && item.turnId === turnId,
      )
      const text = reply?.text ?? ''
      if (reply === undefined || reply.status === IN_PROGRESS_STATUS || text.trim() === '') {
        this.pendingHandoff = undefined
        this.handoffFailed(new Error(UI_TEXT.handoffNoBrief))
        return
      }
      if (new TextEncoder().encode(text).byteLength > PLAN_FILE_MAX_BYTES) {
        this.pendingHandoff = undefined
        this.notice('warning', fill(UI_TEXT.handoffTooLarge, { size: PLAN_FILE_MAX_KB }))
        return
      }
      pending.brief = text
      pending.todos = history.todos.filter((todo) => HANDOFF_OPEN_TODO_STATUSES.has(todo.status))
      this.postHandoffReady()
    } catch (error: unknown) {
      if (this.isStillCurrent(pending)) {
        this.pendingHandoff = undefined
        this.handoffFailed(error)
      }
    } finally {
      pending.isReadingBrief = false
      if (this.isCurrentHandoff(pending) && !this.isAuthAdmitted()) {
        this.notice('warning', UI_TEXT.notSignedInReason)
      }
    }
  }

  /**
   * A distillation turn that completed while admission was closed (M74):
   * its brief is read now, when the backend admits it again. True when a
   * read started, so the dialog is on its way.
   */
  private readWaitingBrief(): boolean {
    const pending = this.pendingHandoff
    if (
      pending?.turnId === undefined ||
      pending.brief !== undefined ||
      pending.isReadingBrief ||
      !this.finishedTurns.has(pending.turnId) ||
      (pending.session === undefined &&
        this.session === undefined &&
        this.resumeTarget === undefined) ||
      !this.isStillCurrent(pending)
    ) {
      return false
    }
    void this.finishHandoff(pending.turnId)
    return true
  }

  /**
   * The waiting brief's dialog: posted when the distillation turn completed,
   * and again to a rebuilt panel, whose dialog went with its webview while
   * the brief waits here, so a later `/handoff` is never refused as busy
   * with nothing to answer; never one whose conversation is gone (a restart
   * left it stale), which the next request drops. The open items show in it
   * too, so before Start the user sees all the model wrote that the new
   * conversation reads (D49).
   */
  private postHandoffReady(): void {
    const pending = this.pendingHandoff
    if (pending?.brief === undefined || !this.isCurrentHandoff(pending)) {
      return
    }
    this.post({
      type: 'handoffReady',
      requestId: pending.requestId,
      brief: pending.brief,
      ...(pending.goal !== undefined && { goal: pending.goal }),
      todos: pending.todos.map((todo) => todo.text),
    })
  }

  /**
   * The handoff dialog's Start: the reviewed brief seeds a new
   * conversation through the same path as a plan's (M79's
   * `startFromBrief`): the old conversation is left as it is, and the
   * brief alone is the first message, with the open items as its list. Its
   * mode is `handoffBrief`'s: the starting mode only for a brief the dialog
   * showed whole, and Plan kept from a Plan-mode conversation.
   */
  private async confirmHandoff(requestId: string, brief: string): Promise<void> {
    const pending = this.pendingHandoff
    if (pending?.requestId !== requestId || pending.brief === undefined || pending.isStarting) {
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      return
    }
    if (this.isPlanActionRunning) {
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      this.notice('info', UI_TEXT.handoffBusy)
      return
    }
    const generation = pending.generation
    if (!this.isCurrentHandoff(pending)) {
      this.pendingHandoff = undefined
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      this.say('info', UI_TEXT.handoffChangedNotStarted)
      return
    }
    if (brief.trim() === '') {
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      this.say('warning', UI_TEXT.handoffEmpty)
      return
    }
    if (new TextEncoder().encode(brief).byteLength > PLAN_FILE_MAX_BYTES) {
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      this.say('warning', fill(UI_TEXT.handoffTooLarge, { size: PLAN_FILE_MAX_KB }))
      return
    }
    pending.isStarting = true
    this.isPlanActionRunning = true
    const seeded = handoffBrief(
      brief,
      pending.goal,
      pending.todos,
      this.permissionMode === PLAN_MODE,
    )
    let started: BriefStart
    try {
      started = await this.startFromBrief(seeded, generation, () => this.isCurrentHandoff(pending))
    } catch (error: unknown) {
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      if (this.isCurrentHandoff(pending)) {
        this.handoffFailed(error)
      }
      return
    } finally {
      pending.isStarting = false
      this.isPlanActionRunning = false
    }
    if (started.status === 'changed') {
      this.dropHandoff(pending)
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      this.say('info', UI_TEXT.handoffChangedNotStarted)
      return
    }
    if (started.status !== 'started') {
      this.post({ type: 'handoffCommandResult', requestId, accepted: false })
      return
    }
    this.dropHandoff(pending)
    this.post({ type: 'handoffCommandResult', requestId, accepted: true })
    if (!seeded.isApproved) {
      this.say(
        'info',
        fill(UI_TEXT.handoffUnshownMode, { mode: UI_TEXT.permissionModes[this.permissionMode] }),
      )
    }
  }

  /** The handoff dialog's Cancel: the brief is dropped, nothing starts. */
  private cancelHandoff(requestId: string): void {
    if (this.pendingHandoff?.requestId === requestId) {
      this.pendingHandoff = undefined
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
        this.notice('error', `${UI_TEXT.renameFailed}: ${describe(error)}`, undefined, error)
      }
    }
  }

  private async setSessionArchived(sessionId: string, isArchived: boolean): Promise<void> {
    const others = this.deps.sessions.archivedIds().filter((id) => id !== sessionId)
    await this.deps.sessions.setArchivedIds(isArchived ? [...others, sessionId] : others)
    this.postSessionList()
    // An archived conversation's checkpoints go with it (M72); an unarchived
    // one's archives go, so its new checkpoints are kept.
    await (isArchived ? this.checkpoints.forget(sessionId) : this.checkpoints.unforget(sessionId))
  }

  /**
   * The transcript's turn ids of the conversation from `turnId` on, with
   * every turn of the child sessions those turns started, theirs included
   * (M86, spec 3.2): a restore goes ahead only when each has a record.
   * Undefined when the transcript cannot be read or does not hold the turn.
   */
  private async transcriptTurnIds(
    host: AgentHost,
    sessionId: string,
    turnId: string,
  ): Promise<readonly string[] | undefined> {
    const history = await host.readSession(sessionId)
    const start = history.items.findIndex((item) => item.turnId === turnId)
    if (start === -1 || history.mode === HISTORY_MODE_NONE) {
      return undefined
    }
    const turnIds = new Set<string>()
    const children: string[] = []
    const take = (items: readonly ItemSnapshot[]) => {
      for (const item of items) {
        if (item.turnId !== undefined) {
          turnIds.add(item.turnId)
        }
        if (item.kind === SUBAGENT_ITEM_KIND && item.childSessionId !== undefined) {
          children.push(item.childSessionId)
        }
      }
    }
    take(history.items.slice(start))
    const read = new Set<string>()
    for (let child = children.shift(); child !== undefined; child = children.shift()) {
      if (read.has(child)) {
        continue
      }
      read.add(child)
      const childHistory = await host.readSession(child)
      if (childHistory.mode === HISTORY_MODE_NONE) {
        return undefined
      }
      take(childHistory.items)
    }
    return [...turnIds]
  }

  /**
   * "Restore files to here" (M72, M86), and with `rewind` the conversation
   * too ("Rewind conversation and restore files"), once the files are
   * restored.
   */
  private async restoreFiles(
    message: Extract<ConversationMessage, { type: 'restoreFiles' }>,
  ): Promise<void> {
    const { session } = this
    const { rewind } = message
    // The panel sends one turn for both: a stale or forged message whose
    // rewind names another card or conversation than the files is refused
    // before anything is asked or changed, as one for another conversation is.
    if (
      session?.sessionId !== message.sourceSessionId ||
      (rewind !== undefined &&
        (rewind.sourceSessionId !== message.sourceSessionId || rewind.turnId !== message.turnId))
    ) {
      return
    }
    if (this.sessionKind !== 'modelApi') {
      this.notice('warning', UI_TEXT.checkpointsModelApiOnly)
      return
    }
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.restoreTurnRunning)
      return
    }
    if (!(await this.checkpoints.confirmRestore(rewind !== undefined))) {
      return
    }
    // A turn may have started while the confirmation was open.
    if (this.session !== session) {
      return
    }
    if (this.isTurnRunning()) {
      this.notice('info', UI_TEXT.restoreTurnRunning)
      return
    }
    // The conversation's checks run before any file changes.
    let prepared: PreparedRewind | undefined
    if (rewind !== undefined) {
      this.beginBrowserSessionChange(rewind.attachmentEpoch)
      prepared = await this.prepareRewind(rewind)
      if (prepared === undefined) {
        return
      }
    }
    let turnIds: readonly string[] | undefined
    try {
      turnIds = await this.transcriptTurnIds(
        await this.deps.ensureHost(),
        session.sessionId,
        message.turnId,
      )
    } catch (error: unknown) {
      this.deps.log.warn(`The transcript for a restore could not be read: ${describeForLog(error)}`)
    }
    if (turnIds === undefined || this.session !== session || this.isTurnRunning()) {
      this.notice(
        'warning',
        turnIds === undefined ? UI_TEXT.restoreWritesIncomplete : UI_TEXT.restoreFailed,
      )
      return
    }
    const report = await this.checkpoints.restore(session.sessionId, message.turnId, turnIds)
    if (prepared === undefined) {
      report.post()
      return
    }
    const canRewind = report.isComplete && this.session === session && !this.isTurnRunning()
    // Posted after the fork, so the conversation shown carries the report and its Redo.
    const isRewound = canRewind && (await this.applyRewind(prepared))
    report.post()
    if (!isRewound) {
      this.notice('warning', UI_TEXT.rewindNotDone)
    }
  }

  /**
   * Whether a turn runs in this conversation now: read afresh after an
   * await (a turn may start while a confirmation is open), which a
   * narrowed `activeTurnId` would not be.
   */
  private isTurnRunning(): boolean {
    return this.activeTurnId !== undefined || this.turnSubmissionsInFlight > 0
  }

  /**
   * A restore's Redo (M72, M86): never while a turn runs here, and only for
   * the conversation shown, which the request names (the store also checks
   * that the restore was that conversation's).
   */
  private async redoRestore(
    message: Extract<ConversationMessage, { type: 'redoRestore' }>,
  ): Promise<void> {
    const { restoreId, sourceSessionId } = message
    if (this.session?.sessionId !== sourceSessionId) {
      this.post({ type: 'restoreRedone', restoreId, isSpent: false })
      return
    }
    if (this.sessionKind !== 'modelApi') {
      this.notice('warning', UI_TEXT.checkpointsModelApiOnly)
      this.post({ type: 'restoreRedone', restoreId, isSpent: false })
      return
    }
    if (this.activeTurnId !== undefined) {
      this.notice('info', UI_TEXT.restoreTurnRunning)
      this.post({ type: 'restoreRedone', restoreId, isSpent: false })
      return
    }
    const session = this.session
    await this.checkpoints.redo(restoreId, sourceSessionId, async (fromTurnId) => {
      try {
        const ids = await this.transcriptTurnIds(
          await this.deps.ensureHost(),
          sourceSessionId,
          fromTurnId,
        )
        return this.session === session && !this.isTurnRunning() ? ids : undefined
      } catch (error: unknown) {
        this.deps.log.warn(`The transcript for a Redo could not be read: ${describeForLog(error)}`)
        return
      }
    })
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
    this.requireNonConfidentialModel(session.modelId)
    if (this.revertsInFlight > 0) {
      throw new Error(UI_TEXT.restoreTurnRunning)
    }
    if (!shouldQueueForDisplayText && this.activeTurnId !== undefined) {
      try {
        return await session.steer(this.activeTurnId, parts)
      } catch (error: unknown) {
        if (!isCurrent()) {
          throw new Error(UI_TEXT.turnStoppedByRestart, { cause: error })
        }
        // Only a steer refused with nothing taken goes as a new turn (CLI
        // recovery): one with no answer may still reach the turn, and a
        // second copy would run after it (the owner's session, 2026-10-02).
        if (!isSteerRefusedError(error)) {
          this.deps.log.warn(
            `turn/steer failed (${failureForLog(error)}); the message is not sent again`,
          )
          throw error
        }
        this.deps.log.info('turn/steer was refused with nothing taken; submitting as a new turn')
      }
    }
    if (!isCurrent()) {
      throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    this.requireNonConfidentialModel(session.modelId)
    if (this.revertsInFlight > 0) {
      throw new Error(UI_TEXT.restoreTurnRunning)
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
        this.deps.log.warn(`Autosave before the turn failed: ${describeForLog(error)}`)
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
    cardText?: string,
    handoff?: PendingHandoff,
    isSecretAccepted = false,
    gitDraft?: GitDraftKind,
    gitDraftBase?: string,
  ): Promise<SendOutcome> {
    // M92e (PLAN.md D71): a plain composer prompt holding a detected secret
    // is held before sending. Nothing starts and nothing is released: the
    // panel shows its dialog (Send anyway / Edit) over the redacted card,
    // and only a re-post with `secretAccepted` sends it on. Briefs, review
    // cards and handoffs never reach this hold. Read from the one shared
    // table in redact.ts.
    if (
      brief === undefined &&
      cardText === undefined &&
      handoff === undefined &&
      !isSecretAccepted &&
      countSecretMatches(text, []) > 0
    ) {
      this.post({ type: 'secretPromptDetected', localId, redactedText: redactSecrets(text) })
      return { isAccepted: false, hasSetTodos: false, turnId: undefined }
    }
    // Counted once past the review barrier (M70), so a message held behind a
    // starting review does not make that review refuse as busy (M87).
    let isCountedSubmission = false
    const isComposerMessage = brief === undefined
    let seededSession: AgentSession | undefined
    // The running mark this message's turn takes over (M72), dropped if it is not sent.
    let checkpoint: PendingMark | undefined
    const gitGeneration = gitDraft === undefined ? undefined : this.git.generationStarting(gitDraft)
    let isGitSubmitted = false
    let hasSubmittedHandoff = false
    try {
      // A composer send cannot steer the distillation's reply into a
      // different brief. Start's own brief send remains admitted. Check
      // before auth/session preparation too, so its refusal keeps the draft.
      // The block lasts until the brief and its todo snapshot are both
      // captured: the reply is read by turn id, but the todos come from the
      // session-wide list, which a send admitted meanwhile could update
      // before the read resolves (the review of PR #84).
      const requireNoDistillation = (): void => {
        const pending = this.pendingHandoff
        if (
          handoff === undefined &&
          brief === undefined &&
          pending?.hasSubmittedTurn === true &&
          pending.brief === undefined &&
          this.isCurrentHandoff(pending)
        ) {
          throw new Error(UI_TEXT.handoffBusy)
        }
      }
      requireNoDistillation()
      const sendEpoch = this.sendInvalidationEpoch
      const session = await this.sessionForAction(localId, isComposerMessage)
      if (session === undefined) {
        return { isAccepted: false, hasSetTodos: false, turnId: undefined }
      }
      this.turnSubmissionsInFlight += 1
      isCountedSubmission = true
      let expectedGeneration = this.attachmentGeneration
      let submittedSession = session
      const requireCurrent = (current: AgentSession, shouldCheckGitDraft = true): void => {
        if (
          this.isDisposed ||
          this.sendInvalidationEpoch !== sendEpoch ||
          this.session !== current ||
          this.attachmentGeneration !== expectedGeneration ||
          (shouldCheckGitDraft &&
            gitGeneration !== undefined &&
            !this.git.isGenerationCurrent(gitGeneration))
        ) {
          throw new Error(UI_TEXT.turnStoppedByRestart)
        }
        if (handoff !== undefined && !this.isCurrentHandoff(handoff)) {
          throw new Error(UI_TEXT.turnStoppedByRestart)
        }
        requireNoDistillation()
        // Nor is its request sent once admission closed (M74): refused as
        // the reason its card failed, and the composer keeps the command.
        if (handoff !== undefined && !hasSubmittedHandoff && !this.isAuthAdmitted()) {
          throw new Error(UI_TEXT.notSignedInReason)
        }
        // A turn that started meanwhile refuses the handoff's request once,
        // as the reason its card failed, with no notice besides (M74).
        if (handoff !== undefined && !hasSubmittedHandoff && this.activeTurnId !== undefined) {
          throw new Error(UI_TEXT.handoffWaitTurn)
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
        return { isAccepted: false, hasSetTodos: false, turnId: undefined }
      }
      // A reply to an output or a quoted passage rides as its own part (M17),
      // before the editor context, like the ide_selection part of M5.
      const referenced: readonly TurnPart[] =
        reference === undefined ? [] : [{ type: 'text', text: chatReferenceText(reference) }]
      // What the model needs to draft a commit message or a pull request
      // (M71), beside the user's own message asking for it.
      const drafting: readonly TurnPart[] =
        gitDraft === undefined
          ? []
          : [{ type: 'text', text: await this.git.promptFor(gitDraft, gitDraftBase) }]
      requireCurrent(session)
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
        ...drafting,
        ...(context === undefined ? [] : [context]),
        ...note,
      ]
      // What the card shows: a brief's own words, a handoff's request card
      // (M74, in the user's language), else what was typed.
      const shownText = brief?.displayText ?? cardText ?? text
      // MSP stores no text-file attachment metadata: keep each name in the
      // durable card while the full content travels only to the model (M54).
      const textFileNames = typed.flatMap((part) => (part.type === 'textFile' ? [part.name] : []))
      let displayText =
        brief === undefined && cardText === undefined && parts.length === typed.length
          ? undefined
          : shownText
      if (textFileNames.length > 0) {
        displayText =
          host.info.kind === 'museCode'
            ? textFileDisplay(shownText, textFileNames)
            : [shownText, ...textFileNames].filter((line) => line !== '').join('\n')
      }
      // Whether this message starts a Plan-mode turn: its reply may be a plan (M79).
      const isPlanModeSend = this.permissionMode === PLAN_MODE
      // The running mark before a turn this message starts (M72); a message
      // that steers or queues behind a running turn takes none.
      if (this.activeTurnId === undefined && !this.isSideChat) {
        checkpoint = await this.checkpoints.beforeTurn(session.sessionId)
        requireCurrent(session)
      }
      const submission = await this.runResuming(host, session, (current) => {
        // runResuming may replace a not-loaded session itself; that recovery
        // owns the new generation. An unrelated restart still fails admission.
        if (current !== session) {
          expectedGeneration = this.attachmentGeneration
          if (handoff !== undefined && this.pendingHandoff === handoff) {
            handoff.session = current
          }
        }
        requireCurrent(current)
        submittedSession = current
        // A brief's todo list is set before its first turn reads it (M79),
        // where the backend lets the extension set one.
        if (hasSetTodos && current.setTodos !== undefined) {
          current.setTodos(brief.todos)
          seededSession = current
        }
        hasSubmittedHandoff = handoff !== undefined
        if (handoff !== undefined) {
          handoff.hasSubmittedTurn = true
        }
        return this.submit(
          current,
          parts,
          displayText,
          handoff !== undefined || (host.info.kind === 'museCode' && textFileNames.length > 0),
          () =>
            !this.isDisposed &&
            this.sendInvalidationEpoch === sendEpoch &&
            this.session === current &&
            this.attachmentGeneration === expectedGeneration,
        )
      })
      // A Git form may close while the submitted model call finishes. Its
      // chat acknowledgement still belongs here; the generation id below
      // prevents it from filling a later form.
      requireCurrent(submittedSession, false)
      // The images go only once the host has the message (D26).
      this.attachments.release(attachmentIds)
      if (this.isDisposed) {
        return { isAccepted: false, hasSetTodos: false, turnId: undefined }
      }
      const { turnId } = submission
      this.checkpoints.accepted(
        checkpoint,
        turnId,
        submission.disposition !== QUEUED_DISPOSITION &&
          submission.disposition !== STEERED_DISPOSITION,
      )
      if (gitGeneration !== undefined) {
        this.git.generationSubmitted(turnId, gitGeneration)
      }
      // acceptSubmission below records the card; the Auto reviewer sees the message now (M90).
      this.noteReviewMessage(shownText)
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
      this.noteQueuedMessage(submittedSession, localId, submission)
      this.acceptSubmission(localId, shownText, submission)
      isGitSubmitted = true
      return { isAccepted: true, hasSetTodos: seededSession !== undefined, turnId }
    } catch (error: unknown) {
      this.checkpoints.dropPending(checkpoint)
      const reason = describe(error)
      this.deps.log.error(
        `sendMessage failed: ${isComposerMessage ? describeForLog(error) : errorKind(error)}`,
      )
      if (seededSession !== undefined) {
        this.takeBackTodos(seededSession)
      }
      if (!isComposerMessage) {
        this.attachments.release(attachmentIds)
      }
      // A composer message's images were not released: the composer gets
      // them back for another try. A brief's go with its card. The card
      // says why, so whatever else waited on the same start only logs it.
      this.noteShown(error)
      this.post({ type: 'sendFailed', localId, reason, attachmentsKept: isComposerMessage })
      if (isMuseCodeFaultError(error)) {
        // Muse Code refuses every message of this session the same way: the
        // card says what it said, the notice what to do about it (D26).
        this.noteMuseCodeFault(error)
      }
      return { isAccepted: false, hasSetTodos: false, turnId: undefined }
    } finally {
      if (gitGeneration !== undefined && !isGitSubmitted) {
        this.git.generationFailed(gitGeneration)
      }
      if (isCountedSubmission) {
        this.turnSubmissionsInFlight -= 1
      }
    }
  }

  /**
   * A message the backend queued or steered, where its session can take one
   * back (M87, PLAN.md D66): kept under its card's id for an Edit. Not one
   * whose queued turn already started or ended before this ack (D26).
   */
  private noteQueuedMessage(
    session: AgentSession,
    localId: string,
    submission: TurnSubmission,
  ): void {
    const { turnId, disposition } = submission
    const isQueued = disposition === QUEUED_DISPOSITION
    if (
      session.withdrawQueued === undefined ||
      !(isQueued || disposition === STEERED_DISPOSITION) ||
      this.finishedTurns.has(turnId) ||
      (isQueued && this.activeTurnId === turnId) ||
      (submission.userMessageId !== undefined &&
        this.admittedEarly.delete(submission.userMessageId))
    ) {
      return
    }
    this.queuedMessages.set(localId, {
      turnId,
      userMessageId: submission.userMessageId,
      disposition,
    })
  }

  /**
   * Edit on a queued message (M87, PLAN.md D66): the session takes it back
   * if the model does not have it yet. Only a message this conversation
   * accepted as queued or steered, under the ids the card names, is asked
   * for; anything else is refused before the backend hears of it. Taken
   * back, its images return to the composer and the card is told; too late,
   * the card stays and says why.
   */
  private async withdrawQueued(
    message: Extract<ConversationMessage, { type: 'withdrawQueued' }>,
  ): Promise<void> {
    const { localId } = message
    if (this.withdrawals.has(localId)) {
      // The first Edit's answer is on its way.
      return
    }
    const refuse = (reason: string) => {
      this.post({ type: 'withdrawRefused', localId, reason })
    }
    const { session } = this
    if (session?.withdrawQueued === undefined) {
      // A backend without the verb takes nothing back (M87, the lead's string).
      this.deps.log.info(`Queued message ${localId} not withdrawn: the session cannot`)
      refuse(UI_TEXT.queuedEditUnsupported)
      return
    }
    const queued = this.queuedMessages.get(localId)
    const isQueuedHere =
      queued?.turnId === message.turnId && queued.userMessageId === message.userMessageId
    if (!isQueuedHere) {
      this.deps.log.info(`Queued message ${localId} not withdrawn: it is not queued here`)
      refuse(UI_TEXT.queuedTooLate)
      return
    }
    const generation = this.sendInvalidationEpoch
    this.withdrawals.add(localId)
    try {
      const outcome = await session.withdrawQueued(queued)
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      this.queuedMessages.delete(localId)
      if (outcome.status === 'tooLate') {
        this.deps.log.info(`Queued message ${localId} not withdrawn: it reached the model`)
        refuse(UI_TEXT.queuedTooLate)
        return
      }
      for (const key of [localId, queued.userMessageId]) {
        if (key !== undefined) {
          this.acceptedUserCards.delete(key)
        }
      }
      // A backend that keeps no bytes gives no images back (undefined).
      const isKept = outcome.images !== undefined && this.returnImages(outcome.images)
      this.deps.log.info(`Queued message ${localId} withdrawn`)
      this.post({ type: 'queuedWithdrawn', localId, attachmentsKept: isKept })
    } catch (error: unknown) {
      this.deps.log.warn(`Withdrawing queued message ${localId} failed: ${failureForLog(error)}`)
      if (this.isCurrentSessionAction(session, generation)) {
        refuse(describe(error))
      }
    } finally {
      this.withdrawals.delete(localId)
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

  /** The host took the card's turn: the card is sent, and its turn runs unless it queued. */
  private acceptSubmission(localId: string, text: string, submission: TurnSubmission): void {
    const { turnId } = submission
    this.acceptedUserCards.set(localId, { turnId, text })
    if (submission.userMessageId !== undefined) {
      this.acceptedUserCards.set(submission.userMessageId, { turnId, text })
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
      disposition: submission.disposition,
    })
    this.noteActivity()
  }

  // --- Review (M70, PLAN.md D49) ---

  /** Why a review's material could not be read, in words. */
  private reviewRefusalText(collection: Extract<ReviewCollection, { kind: 'refused' }>): string {
    switch (collection.refusal) {
      case 'notRepository': {
        return UI_TEXT.reviewNotRepository
      }
      case 'noChanges': {
        return UI_TEXT.reviewNoChanges
      }
      case 'onlyPrivate': {
        return UI_TEXT.reviewOnlyPrivate
      }
      case 'noBase': {
        return UI_TEXT.reviewNoBase
      }
      case 'unknownRevision': {
        return fill(UI_TEXT.reviewUnknownRevision, { revision: collection.revision ?? '' })
      }
      case 'noCommits': {
        return UI_TEXT.reviewNoCommits
      }
      case 'gitFailed': {
        return UI_TEXT.reviewGitFailed
      }
    }
  }

  /** What the panel says about material that went out in part: a cut diff, private files left out. */
  private noteReviewMaterial(material: ReviewMaterial): void {
    if (material.fullLength !== undefined) {
      this.say('info', UI_TEXT.reviewTruncatedNotice)
    }
    if (material.privateFiles.length > 0) {
      this.say('info', plural(UI_TEXT.reviewPrivateLeftOut, material.privateFiles.length))
    }
  }

  /**
   * `/review` (M70, PLAN.md D49). Git's changes need a trusted workspace
   * (Restricted Mode runs no git); custom instructions do not. The material
   * goes between markers that call it untrusted. On the Model API the turn
   * runs as the Reviewer; on Muse Code it is an ordinary turn held in Plan
   * mode. Either way it is a turn of this conversation, part of the user's
   * own, so nothing asks for payment. Its card is the webview's own, as a
   * message's is: accepted, or failed with the reason.
   */
  private async startReview(localId: string, text: string, request: ReviewRequest): Promise<void> {
    // Says why when it refuses (signed out, no folder), as a message's card does.
    const refusal = this.refuseAction(localId)
    const { workspaceRoot } = this.deps
    if (refusal !== undefined || workspaceRoot === undefined) {
      return
    }
    // Refused before any git or Muse Code command, as a message is (CLI recovery).
    const damaged = this.damagedTarget()
    if (damaged !== undefined) {
      this.refuseDamaged(damaged, localId, true)
      return
    }
    if (
      this.activeTurnId !== undefined ||
      this.reviewStart !== undefined ||
      this.planHold !== undefined
    ) {
      this.post({ type: 'sendFailed', localId, reason: UI_TEXT.reviewBusy })
      return
    }
    // Revert owns turn admission until its file I/O settles (M87).
    if (this.revertsInFlight > 0) {
      this.post({ type: 'sendFailed', localId, reason: UI_TEXT.restoreTurnRunning })
      return
    }
    const gitRefusal = isGitReview(request)
      ? this.gitTrustRefusal(UI_TEXT.reviewRestricted)
      : undefined
    if (gitRefusal !== undefined) {
      this.post({ type: 'sendFailed', localId, reason: gitRefusal })
      return
    }
    const running = this.runReview(localId, text, request, workspaceRoot)
    this.reviewStart = running
    try {
      await running
    } finally {
      // A newer conversation's review may hold the barrier by now.
      if (this.reviewStart === running) {
        this.reviewStart = undefined
      }
    }
  }

  /** The review's asynchronous part: it answers its own failures on the card and never rejects. */
  private async runReview(
    localId: string,
    text: string,
    request: ReviewRequest,
    workspaceRoot: string,
  ): Promise<void> {
    const refuse = (reason: string) => {
      this.post({ type: 'sendFailed', localId, reason })
    }
    const generation = this.sendInvalidationEpoch
    const isStale = () => this.isDisposed || generation !== this.sendInvalidationEpoch
    // The running mark this review's turn takes over (M72), dropped if it is not sent.
    let checkpoint: PendingMark | undefined
    try {
      // Git and the reviewer read the files on disk, as a turn does (D27).
      await this.autosave()
      if (isStale()) {
        refuse(UI_TEXT.turnStoppedByRestart)
        return
      }
      let material: ReviewMaterial | undefined
      let isMaterialCurrent: (() => boolean) | undefined
      if (request.scope !== 'custom') {
        const collection = await this.deps.review.collect(
          request,
          () => !isStale() && this.isProjectTrusted(),
        )
        if (isStale()) {
          refuse(UI_TEXT.turnStoppedByRestart)
          return
        }
        if (collection.kind !== 'material') {
          this.deps.log.info(`Review not started: ${reviewOutcomeForLog(collection)}`)
          refuse(
            collection.kind === 'refused'
              ? this.reviewRefusalText(collection)
              : UI_TEXT.reviewCancelled,
          )
          return
        }
        material = collection.material
        isMaterialCurrent = collection.isCurrent
      }
      const session = await this.ensureSession(workspaceRoot)
      if (isMaterialCurrent?.() === false) {
        throw new Error(UI_TEXT.turnStoppedByRestart)
      }
      const host = await this.deps.ensureHost()
      if (
        !this.isCurrentSessionAction(session, generation) ||
        this.sessionKind !== host.info.kind ||
        isMaterialCurrent?.() === false
      ) {
        throw new Error(UI_TEXT.turnStoppedByRestart)
      }
      const gitRefusal = isGitReview(request)
        ? this.gitTrustRefusal(UI_TEXT.reviewRestricted)
        : undefined
      if (gitRefusal !== undefined) {
        refuse(gitRefusal)
        return
      }
      // A review's turn is marked running before it is sent and takes over
      // that mark, as a message's does (M72): Muse Code's Plan mode is not
      // strictly read-only, and another window must refuse a restore from
      // the moment this one can change a file.
      if (!this.isSideChat) {
        checkpoint = await this.checkpoints.beforeTurn(session.sessionId)
      }
      // A turn may have started while the pickers were open or the mark was published.
      if (this.isTurnRunning()) {
        this.checkpoints.dropPending(checkpoint)
        refuse(UI_TEXT.reviewBusy)
        return
      }
      const parts: readonly TurnPart[] = [
        {
          type: 'text',
          text: this.deps.review.turnText({
            request,
            material,
            isRoleIncluded: session.review === undefined,
            newMarker: this.deps.review.newMarker,
          }),
        },
      ]
      this.deps.log.info(`Review of the ${request.scope} scope (${request.focus}) starting`)
      let submittedSession = session
      const submission = await this.runResuming(host, session, (current) => {
        submittedSession = current
        return this.submitReview(
          current,
          parts,
          text,
          generation,
          isGitReview(request),
          isMaterialCurrent,
        )
      })
      // A dropped session's pending command may still acknowledge its turn.
      if (!this.isCurrentSessionAction(submittedSession, generation)) {
        throw new Error(UI_TEXT.turnStoppedByRestart)
      }
      if (material !== undefined) {
        this.noteReviewMaterial(material)
      }
      this.checkpoints.accepted(
        checkpoint,
        submission.turnId,
        submission.disposition !== QUEUED_DISPOSITION &&
          submission.disposition !== STEERED_DISPOSITION,
      )
      this.acceptSubmission(localId, text, submission)
    } catch (error: unknown) {
      this.checkpoints.dropPending(checkpoint)
      const reason = describe(error)
      // The user's card says why; the log keeps the kind, never text a backend chose.
      this.deps.log.error(`startReview failed: ${errorKind(error)}`)
      refuse(reason)
    }
  }

  /** The review turn on the session: the Reviewer's where the backend has one, else in Plan mode. */
  private async submitReview(
    session: AgentSession,
    parts: readonly TurnPart[],
    text: string,
    generation: number,
    requiresWorkspaceTrust: boolean,
    isMaterialCurrent: (() => boolean) | undefined,
  ): Promise<TurnSubmission> {
    const isCurrent = () =>
      this.isCurrentSessionAction(session, generation) &&
      isMaterialCurrent?.() !== false &&
      (!requiresWorkspaceTrust || this.isProjectTrusted())
    // The panel's Plan label can precede its backend admission.
    while (this.reviewModeSettling !== undefined) {
      await this.reviewModeSettling
    }
    if (!isCurrent()) {
      throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    this.requireNonConfidentialModel(session.modelId)
    if (session.review !== undefined) {
      return await session.review(parts, text)
    }
    this.notice('info', UI_TEXT.reviewPlanModeNotice)
    const previousMode = this.permissionMode
    if (previousMode === 'plan') {
      return await session.sendTurn(parts, text)
    }
    const bypassEpoch = this.bypassRevocationEpoch
    const hold: PlanModeHold = this.deps.review.createHold({
      planMode: approvalModeFor('plan', this.deps.hasApprovalUi),
      restoreMode: () =>
        approvalModeFor(this.restorableMode(previousMode, bypassEpoch), this.deps.hasApprovalUi),
      onRestored: (outcome) => {
        this.planModeRestored(hold, outcome, session, generation)
      },
    })
    this.planHold = { hold, previousMode, bypassEpoch }
    this.voiceContextRevision += 1
    // Auto is left for the review turn: what the Auto reviewer holds is the user's (M90).
    this.reviews?.release()
    this.permissionMode = 'plan'
    this.postComposerState()
    try {
      return await hold.send(session, parts, text, () => {
        this.requireNonConfidentialModel(session.modelId)
        return isCurrent()
      })
    } catch (error: unknown) {
      // Plan mode was refused (nothing to put back), or the send failed and
      // the hold put the mode back already.
      if (this.isHeldBy(hold)) {
        if (
          previousMode === BYPASS_MODE &&
          this.restorableMode(previousMode, bypassEpoch) === FALLBACK_MODE &&
          this.isCurrentSessionAction(session, generation)
        ) {
          // A failed Plan admission may have left the preceding allowAll
          // mode in place after revocation. Do not relabel it as Manual.
          this.retireBypassSession()
        } else {
          this.releasePlanHold(true)
        }
      }
      throw error
    }
  }

  /** Read afresh after an await: whether the hold still holds the session's mode. */
  private isHeldBy(hold: PlanModeHold): boolean {
    return this.planHold?.hold === hold
  }

  /** The mode a review hands back: Bypass only while its setting still allows it (D24). */
  private restorableMode(mode: PermissionMode, bypassEpoch: number): PermissionMode {
    return mode === BYPASS_MODE &&
      (!this.deps.isBypassAllowed() || bypassEpoch !== this.bypassRevocationEpoch)
      ? FALLBACK_MODE
      : mode
  }

  /** Called only after the failed mode request's live session/generation fence. */
  private retireBypassSession(): void {
    this.permissionMode = FALLBACK_MODE
    this.dropSession()
    this.notice('warning', UI_TEXT.bypassRevoked)
    this.postComposerState()
  }

  /**
   * The hold set the session's mode back, or could not (M70): after the
   * review turn, or after a send that failed. A session the host no longer
   * holds takes the user's mode when it is resumed; a live one left in Plan
   * mode keeps the panel in Plan mode too, and says so.
   */
  private planModeRestored(
    hold: PlanModeHold,
    outcome: PlanModeRestore,
    session: AgentSession,
    generation: number,
  ): void {
    const held = this.planHold
    if (held?.hold !== hold || !this.isCurrentSessionAction(session, generation)) {
      return
    }
    this.planHold = undefined
    if (!outcome.ok && !isSessionNotLoadedError(outcome.error)) {
      if (
        held.previousMode === BYPASS_MODE &&
        this.restorableMode(held.previousMode, held.bypassEpoch) === FALLBACK_MODE
      ) {
        // A failed corrective restore may leave allowAll on this owned
        // backend. Retire it instead of describing it as still in Plan.
        this.retireBypassSession()
        return
      }
      this.notice('warning', `${UI_TEXT.reviewModeNotRestored}: ${describe(outcome.error)}`)
      return
    }
    const mode = this.restorableMode(held.previousMode, held.bypassEpoch)
    this.permissionMode = mode
    this.postComposerState()
    if (outcome.ok && outcome.isAfterTurn) {
      this.say('info', fill(UI_TEXT.reviewModeRestored, { mode: UI_TEXT.permissionModes[mode] }))
    }
    if (mode !== held.previousMode) {
      this.notice('warning', UI_TEXT.bypassRevoked)
    }
  }

  /**
   * Ends a review's hold on Plan mode (M70). With `isModeRestored` the panel
   * goes back to the mode the user had (the session went, or Plan mode was
   * never set); without it the user has just chosen a mode themselves.
   */
  private releasePlanHold(isModeRestored: boolean): void {
    const held = this.planHold
    if (held === undefined) {
      return
    }
    this.planHold = undefined
    held.hold.release()
    if (!isModeRestored) {
      return
    }
    this.permissionMode = this.restorableMode(held.previousMode, held.bypassEpoch)
    if (!this.isDisposed) {
      this.postComposerState()
    }
  }

  /**
   * The review pane (M70): the conversation's edits, each patch read and its
   * files placed in the workspace, within the pane's limits. An edit whose
   * patch cannot be read is counted as left out, never guessed at.
   */
  private async readReviewChanges(requestId: string, edits: readonly EditRef[]): Promise<void> {
    const session = this.session
    const generation = this.sendInvalidationEpoch
    const answer = (files: readonly ReviewFile[], omittedEdits: number, reason?: string) => {
      this.post({
        type: 'reviewChanges',
        requestId,
        files: [...files],
        omittedEdits,
        ...(reason !== undefined && { reason }),
      })
    }
    if (!this.isCurrentSessionAction(session, generation)) {
      answer([], 0, this.isAuthAdmitted() ? UI_TEXT.sessionRequired : UI_TEXT.notSignedInReason)
      return
    }
    // The session or its generation went meanwhile: what was read belongs to
    // another moment. A pane the panel still shows (a restart, say) is told
    // why, so it does not wait; a new or other conversation hears nothing.
    const stopped = () => {
      if (this.holdsConversation(session.sessionId)) {
        answer([], 0, this.paneActionStoppedReason())
      }
    }
    const files: ReviewFile[] = []
    const read = edits.slice(0, REVIEW_PANE_MAX_EDITS)
    let omitted = edits.length - read.length
    let lines = 0
    for (const [index, edit] of read.entries()) {
      let described: readonly DescribedFile[] | undefined
      try {
        const patch = await this.fetchPatch(session, generation, edit.itemId, edit.outputRef)
        described = patch === undefined ? undefined : await this.deps.editReview.describe(patch)
      } catch {
        if (!this.isCurrentSessionAction(session, generation)) {
          stopped()
          return
        }
        // Named by its item only: the error may quote a path the host chose (AGENTS.md rule 8).
        this.deps.log.warn(`Review pane: edit ${edit.itemId} not read`)
        omitted += 1
        continue
      }
      if (!this.isCurrentSessionAction(session, generation)) {
        stopped()
        return
      }
      if (described === undefined) {
        answer([], 0, UI_TEXT.turnStoppedByRestart)
        return
      }
      const editLines = described.reduce(
        (sum, entry) =>
          sum + entry.file.hunks.reduce((hunkSum, hunk) => hunkSum + hunk.lines.length, 0),
        0,
      )
      if (lines + editLines > REVIEW_PANE_MAX_LINES) {
        omitted += read.length - index
        break
      }
      lines += editLines
      for (const entry of described) {
        files.push({
          itemId: edit.itemId,
          outputRef: edit.outputRef,
          fileIndex: entry.fileIndex,
          path: entry.path,
          hunks: [...entry.file.hunks],
          ...(entry.refusal !== undefined && { refusal: entry.refusal }),
        })
      }
    }
    answer(files, omitted)
  }

  /**
   * The review pane's Revert on one hunk (M70): taken out once. Each press is
   * answered while the panel still shows its conversation, a restarted one
   * included, and gives the hunk back when it wrote nothing; a new or other
   * conversation hears nothing of it.
   */
  private async revertReviewHunk(
    message: Extract<ConversationMessage, { type: 'revertReviewHunk' }>,
  ): Promise<void> {
    const { itemId, outputRef, fileIndex, hunkIndex } = message
    const answer = (isReverted: boolean, reason?: string) => {
      this.post({
        type: 'reviewHunkResult',
        itemId,
        fileIndex,
        hunkIndex,
        isReverted,
        ...(reason !== undefined && { reason }),
      })
    }
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (!this.isCurrentSessionAction(session, generation)) {
      answer(false, this.isAuthAdmitted() ? UI_TEXT.sessionRequired : UI_TEXT.notSignedInReason)
      return
    }
    const key = [itemId, String(fileIndex), String(hunkIndex)].join('\n')
    if (this.revertedHunks.has(key)) {
      answer(false, UI_TEXT.reviewAlreadyReverted)
      return
    }
    // Taken before the first await: a second press cannot revert it twice.
    const press = Symbol(key)
    this.revertedHunks.set(key, press)
    const release = () => {
      if (this.revertedHunks.get(key) === press) {
        this.revertedHunks.delete(key)
      }
    }
    // The session or its generation went with nothing written: the hunk is
    // given back, and a pane the panel still shows (a restart, say) is told
    // why, so its button does not wait; a new or other conversation hears nothing.
    const stopped = () => {
      release()
      if (this.holdsConversation(session.sessionId)) {
        answer(false, this.paneActionStoppedReason())
      }
    }
    try {
      const patch = await this.fetchPatch(session, generation, itemId, outputRef)
      if (patch === undefined || !this.isCurrentSessionAction(session, generation)) {
        stopped()
        return
      }
      const outcome = await this.deps.editReview.revertHunk(itemId, patch, fileIndex, hunkIndex)
      if (!outcome.isReverted) {
        release()
      }
      // A settled write is told only to the conversation that requested it.
      if (!this.holdsConversation(session.sessionId)) {
        return
      }
      const said = outcome.notices.map((notice) => notice.text).join(' ')
      for (const notice of outcome.notices) {
        this.notice(notice.level, notice.text)
      }
      answer(outcome.isReverted, outcome.isReverted ? undefined : said)
    } catch (error: unknown) {
      if (!this.isCurrentSessionAction(session, generation)) {
        stopped()
        return
      }
      release()
      const reason = `${UI_TEXT.editReviewFailed}: ${describe(error)}`
      this.notice('error', reason)
      answer(false, reason)
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
    // Every exit before the host has the command answers it, so the panel
    // never waits on a command nothing took.
    let hasReachedHost = false
    try {
      const session = await this.sessionForAction()
      if (!this.isCurrentSessionAction(session, generation)) {
        result(false)
        return
      }
      targetSessionId = session.sessionId
      const host = await this.deps.ensureHost()
      if (this.accountStopEpoch > generation || this.accountStopsInFlight > 0) {
        // The conversation ended with the account: nothing to say in it.
        result(false)
        return
      }
      if (this.deps.auth.backend === undefined) {
        // Admission closed during the lookup (a key activation, with the
        // panel still signed in): refused as the sign-in guard refuses.
        this.notice('warning', UI_TEXT.notSignedInReason)
        result(false)
        return
      }
      hasReachedHost = true
      const outcome = await this.runResuming(host, session, (current) =>
        current.controlGoal(command),
      )
      if (
        generation !== this.sendInvalidationEpoch ||
        !this.isAuthAdmitted() ||
        this.session?.sessionId !== targetSessionId
      ) {
        this.goalOutcomeUnknown(targetSessionId, generation, result)
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
        // A command the host never had is answered and nothing is said; one
        // it had may have taken effect.
        if (!hasReachedHost) {
          result(false)
        } else if (targetSessionId !== undefined) {
          this.goalOutcomeUnknown(targetSessionId, generation, result)
        }
        return
      }
      if (isGoalRefusedError(error)) {
        this.deps.log.info(`Goal ${verb} refused: ${error.refusal}`)
        this.say('warning', goalRefusalText(verb, error.refusal))
        result(false)
        return
      }
      this.notice('error', `${UI_TEXT.goalCommandFailed}: ${describe(error)}`, undefined, error)
      result(false)
    }
  }

  /**
   * A goal command the host had when a key activation closed admission or
   * the backend restarted (M45): whether it took is not known. While the
   * panel still shows that conversation (attached, or waiting to resume
   * after the restart) the command is answered refused, so it stays in
   * the prompt, the panel says the outcome is unknown, and the goal is
   * read back from the backend before the conversation's next action. A
   * conversation the panel no longer shows (another one, or the account's
   * end) was reset there: nothing is said.
   */
  private goalOutcomeUnknown(
    sessionId: string,
    generation: number,
    result: (isAccepted: boolean) => void,
  ): void {
    // Attached, or waiting to be resumed after a restart.
    const shownSessionId = (this.session ?? this.resumeTarget)?.sessionId
    if (
      shownSessionId !== sessionId ||
      this.accountStopEpoch > generation ||
      this.accountStopsInFlight > 0
    ) {
      return
    }
    this.goalRefreshSessionId = sessionId
    this.notice('warning', UI_TEXT.goalOutcomeUnknown)
    result(false)
  }

  /**
   * The goal as the backend has it, back in the strip after an unknown
   * outcome (`goalOutcomeUnknown`). A goal event that arrives during the
   * read is newer and wins; a failed read is logged, the notice having
   * said to check the goal.
   */
  private async refreshGoal(session: AgentSession, generation: number): Promise<void> {
    const goalEventsAtStart = this.goalEventCount
    try {
      const host = await this.deps.ensureHost()
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
      const { goal } = await host.readSession(session.sessionId, { recoverGoal: true })
      if (
        goal === undefined ||
        goalEventsAtStart !== this.goalEventCount ||
        !this.isCurrentSessionAction(session, generation)
      ) {
        return
      }
      this.post({ type: 'agentEvent', event: { type: 'goalChanged', goal } })
    } catch (error: unknown) {
      this.deps.log.warn(`goal refresh failed: ${describeForLog(error)}`)
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
      this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`, undefined, error)
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
      this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`, undefined, error)
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
      this.notice('error', `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`, undefined, error)
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
      this.requireNonConfidentialModel(session.modelId)
      await session.schedules.run(id, occurrenceMs, confirmed)
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch && this.accountStopsInFlight === 0) {
        this.notice(
          'error',
          `${UI_TEXT.scheduleCommandFailed}: ${describe(error)}`,
          undefined,
          error,
        )
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
      this.deps.log.warn(`turn/cancel failed: ${describeForLog(error)}`)
    }
  }

  /** A fresh check immediately before dispatch, with no asynchronous gap. */
  private requireNonConfidentialModel(modelId: string): void {
    if (
      this.deps.isConfidentialWorkspace() &&
      (isContributorModel(modelId) || isContributorModel(this.modelId))
    ) {
      throw new Error(UI_TEXT.contributorBlocked)
    }
  }

  /**
   * Whether the model may be used here: a contributor-tier model is blocked
   * or confirmed once, and a BYO model the listing flagged as training on
   * the content is refused in a confidential workspace (M95, PLAN.md D74).
   * Confidential BYO selection resolves current host privacy facts, even
   * before the wizard's first save or after a saved route changes.
   */
  private async allowsModel(modelId: string): Promise<boolean> {
    if (this.deps.isConfidentialWorkspace() && modelId.includes('/')) {
      const generation = this.modelGeneration
      const actionGeneration = this.sendInvalidationEpoch
      try {
        const host = await this.deps.ensureHost()
        const listed = await host.listModels()
        if (
          this.isDisposed ||
          this.modelGeneration !== generation ||
          this.sendInvalidationEpoch !== actionGeneration
        ) {
          return false
        }
        const model = listed.find((entry) => entry.modelId === modelId)
        if (model === undefined || model.trainsOnContent === true) {
          this.notice('warning', UI_TEXT.trainingBlocked)
          return false
        }
      } catch {
        this.notice('warning', UI_TEXT.trainingBlocked)
        return false
      }
      return true
    }
    const isTraining =
      this.models?.find((model) => model.modelId === modelId)?.trainsOnContent === true ||
      this.trainingModelIds.has(modelId)
    if (isTraining && this.deps.isConfidentialWorkspace()) {
      this.notice('warning', UI_TEXT.trainingBlocked)
      return false
    }
    if (isContributorModel(modelId) && this.deps.isConfidentialWorkspace()) {
      this.notice('warning', UI_TEXT.contributorBlocked)
      return false
    }
    if (!isContributorModel(modelId) || this.confirmedContributor === modelId) {
      return true
    }
    if (!(await this.deps.confirmContributor(modelId))) {
      return false
    }
    if (this.deps.isConfidentialWorkspace() && isContributorModel(modelId)) {
      this.notice('warning', UI_TEXT.contributorBlocked)
      return false
    }
    this.confirmedContributor = modelId
    return true
  }

  private async setModel(modelId: string): Promise<void> {
    if (
      !(await this.allowsModel(modelId)) ||
      (this.deps.isConfidentialWorkspace() && isContributorModel(modelId))
    ) {
      this.postSessionInfo(this.modelId)
      return
    }
    const previous = this.modelId
    if (previous !== modelId) {
      this.voiceContextRevision += 1
    }
    this.modelId = modelId
    if (this.session !== undefined) {
      try {
        await this.session.setModel(modelId)
        const appliedModel = this.session.modelId
        // Extension-hook sessions apply or refuse synchronously. Muse Code's
        // modelId instead waits for its next notification after setModel.
        if (appliedModel !== modelId && this.session.fireExtensionHook !== undefined) {
          this.modelId = appliedModel
          this.postSessionInfo(appliedModel)
          return
        }
      } catch (error: unknown) {
        this.modelId = previous
        this.notice('error', `${UI_TEXT.modelSwitchFailed}: ${describe(error)}`, undefined, error)
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
    const kept = session === undefined ? undefined : await this.applyEffort(session, previous)
    // The session kept its effort, so the composer shows it again, unless
    // the model no longer serves it (a model switch dropped the tier).
    if (
      kept !== undefined &&
      this.session === session &&
      effortLevelsFor(this.modelId).includes(kept.effort)
    ) {
      this.effort = kept.effort
      this.isThinkingEnabled = kept.isThinkingEnabled
    }
    this.postComposerState()
  }

  /** Whether the user may enter Bypass now: the setting, and in a remote window one yes (D24). */
  private async mayBypass(isCurrent: () => boolean): Promise<boolean> {
    if (!this.deps.isBypassAllowed()) {
      this.notice('warning', UI_TEXT.bypassNotAllowed)
      return false
    }
    if (!this.deps.isRemoteWindow || this.hasConfirmedRemoteBypass) {
      return true
    }
    const isConfirmed = await this.deps.confirmRemoteBypass()
    if (!isCurrent() || !this.deps.isBypassAllowed()) {
      return false
    }
    this.hasConfirmedRemoteBypass = isConfirmed
    return this.hasConfirmedRemoteBypass
  }

  /** Keep mode writes ordered, including Bypass revoked during an ordinary choice. */
  private async setSessionPermissionMode(session: AgentSession, mode: string): Promise<void> {
    const changing = session.setApprovalMode(mode)
    this.reviewModeSettling = changing
    try {
      await changing
    } finally {
      if (this.reviewModeSettling === changing) {
        this.reviewModeSettling = undefined
      }
    }
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this.session !== undefined) this.deps.judge?.discardSession(this.session.sessionId)
    this.clearJudgeCards()
    if (mode !== 'plan' && this.isSideChat) {
      this.notice('info', UI_TEXT.sideChatPlanOnly)
      this.postComposerState()
      return
    }
    if (mode !== 'plan' && this.deps.isWorktreeHeld()) {
      this.notice('info', UI_TEXT.worktreeHeldPlanOnly)
      this.postComposerState()
      return
    }
    const selection = ++this.permissionModeSelection
    const session = this.session
    const generation = this.sendInvalidationEpoch
    const bypassEpoch = this.bypassRevocationEpoch
    const isCurrent = () =>
      !this.isDisposed &&
      generation === this.sendInvalidationEpoch &&
      session === this.session &&
      selection === this.permissionModeSelection &&
      (mode !== BYPASS_MODE || bypassEpoch === this.bypassRevocationEpoch)
    if (mode === BYPASS_MODE && !(await this.mayBypass(isCurrent))) {
      if (selection === this.permissionModeSelection) {
        this.postComposerState()
      }
      return
    }
    if (!isCurrent() || (mode === BYPASS_MODE && !this.deps.isBypassAllowed())) {
      return
    }
    // The user's own choice ends a review's hold on Plan mode (M70): the mode
    // they had is not put back over it.
    const held = this.planHold
    this.releasePlanHold(false)
    if (held !== undefined) {
      this.reviewModeSettling = held.hold.waitForModeChange()
    }
    const settling = this.reviewModeSettling
    if (settling !== undefined) {
      try {
        await settling
      } catch {
        // The preceding owner handles its failure; this user's choice is
        // still checked against the live session before it can follow.
      }
      if (this.reviewModeSettling === settling) {
        this.reviewModeSettling = undefined
      }
      if (!this.isCurrentSessionAction(session, generation)) {
        return
      }
    }
    if (!isCurrent() || (mode === BYPASS_MODE && !this.deps.isBypassAllowed())) {
      return
    }
    const previous = this.permissionMode
    if (previous !== mode) {
      this.voiceContextRevision += 1
    }
    this.permissionMode = mode
    // A turn running or queued when Plan mode is left may act, so its reply
    // is no plan (M79): dropped now, before the backend can apply the mode.
    const leftPlanTurns = mode === PLAN_MODE ? [] : [...this.pendingPlanTurnIds]
    if (mode !== PLAN_MODE) {
      this.pendingPlanTurnIds.clear()
    }
    if (mode !== AUTO_MODE) {
      this.reviews?.release()
    }
    const target = approvalModeFor(mode, this.deps.hasApprovalUi)
    if (
      session !== undefined &&
      (settling !== undefined || target !== approvalModeFor(previous, this.deps.hasApprovalUi))
    ) {
      try {
        await this.setSessionPermissionMode(session, target)
      } catch (error: unknown) {
        if (!isCurrent()) {
          return
        }
        if (
          held?.previousMode === BYPASS_MODE &&
          this.restorableMode(held.previousMode, held.bypassEpoch) === FALLBACK_MODE
        ) {
          this.retireBypassSession()
          return
        }
        this.permissionMode = previous
        this.restorePlanTurns(leftPlanTurns)
        this.notice(
          'error',
          `${UI_TEXT.permissionModeChangeFailed}: ${describe(error)}`,
          undefined,
          error,
        )
      }
    }
    if (isCurrent()) {
      this.postComposerState()
    }
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
    // A new conversation drops a handoff in flight: its dialog goes with
    // the transcript (`conversationCleared`), and its confirm can no longer
    // name this conversation.
    this.pendingHandoff = undefined
    this.dropSession()
    // The tasks tab's conversation is gone with it (M87).
    this.endTasksTab()
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
    this.git.sessionChanged(undefined)
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
        this.notice('error', `${UI_TEXT.compactionFailed}: ${reason}`, undefined, error)
      }
    }
  }

  /**
   * The skills for the palette and the slash menu, asked for each time one
   * opens: a read in the background, so a session that does not start is
   * logged here, never shown (a send or the panel's warm-up says it once).
   */
  private async listSkills(): Promise<void> {
    if (this.skills !== undefined) {
      this.postSkills()
      return
    }
    let session: AgentSession | undefined
    try {
      session = await this.sessionForAction()
    } catch (error: unknown) {
      this.deps.log.warn(`The skills were not listed: ${describeForLog(error)}`)
      return
    }
    if (session !== undefined) {
      await this.refreshSkills(session)
    }
  }

  private async searchMentions(requestId: number, query: string): Promise<void> {
    try {
      const items = await this.deps.mentions.search(query, MENTION_RESULT_LIMIT)
      this.post({ type: 'mentionResults', requestId, items: [...items] })
    } catch (error: unknown) {
      this.deps.log.warn(`mention search failed: ${describeForLog(error)}`)
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
      this.deps.log.warn(`text attachment path check failed: ${describeForLog(error)}`)
      return { kind: 'mention' }
    }
    if (!this.isCurrentAttachmentGeneration(generation)) {
      return { kind: 'stale' }
    }
    if (checked === undefined) {
      return { kind: 'mention' }
    }
    const { canonical } = checked
    if (isProtectedPath(canonical) || isPrivateFileName(canonical)) {
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
      if (isPrivateFileName(file.name)) {
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
          this.deps.log.warn(`attachment read failed: ${describeForLog(error)}`)
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
    if (action === 'openTasksTab') {
      // The tab mirrors this surface's conversation (M87): the controller's own.
      this.openTasksTab()
      return
    }
    // A restart asked for from a fault's notice: the session it names is
    // said again should the fault outlive the restart.
    const restartedFault =
      action === 'restartMuseCode' ? this.faultKey('approvalReplay') : undefined
    try {
      await this.deps.runHostAction(action)
    } catch (error: unknown) {
      this.notice(
        'error',
        `${fill(UI_TEXT.hostActionFailed, { action })}: ${describe(error)}`,
        undefined,
        error,
      )
      return
    }
    if (restartedFault === undefined) {
      return
    }
    this.shownFaults.delete(restartedFault)
    this.notice('info', UI_TEXT.museCodeRestartAsked)
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
      this.notice('error', `${UI_TEXT.usageUnavailable}: ${describe(error)}`, undefined, error)
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
    const providers: ProviderUsageRow[] = []
    if (this.deps.usageRecording !== undefined) {
      try {
        const rows = new Map<string, ProviderUsageRow>()
        const records = await this.deps.usageRecording.today()
        for (const record of records) {
          const certainty = record.cost.certainty
          const pricing = providerPricing(certainty)
          const prior = rows.get(record.provider)
          rows.set(record.provider, {
            providerId: record.provider,
            providerLabel: record.provider,
            pricing: prior?.pricing === 'unpriced' ? 'unpriced' : pricing,
            inputTokens: (prior?.inputTokens ?? 0) + (record.tokens.input ?? 0),
            outputTokens: (prior?.outputTokens ?? 0) + (record.tokens.output ?? 0),
            costUsd:
              record.cost.usd !== undefined &&
              record.cost.certainty !== 'uncertain' &&
              (prior === undefined || prior.costUsd !== undefined)
                ? (prior?.costUsd ?? 0) + record.cost.usd
                : undefined,
          })
        }
        providers.push(...rows.values())
      } catch {
        // The recording port logs its fixed diagnostic once; live sources still render.
      }
    }
    const insights = host.info.kind === 'museCode' ? await this.deps.usageInsights() : undefined
    // An older read or a stopped host must not replace a newer observation.
    if (!this.canPostUsage(host) || this.latestUsage !== shown) {
      return
    }
    this.post({
      type: 'usageReport',
      backend: host.info.kind,
      account,
      ...(providers.length > 0 && { providers }),
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
        this.notice('error', `${UI_TEXT.agentControlFailed}: ${describe(error)}`, undefined, error)
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
        this.notice('error', `${UI_TEXT.agentControlFailed}: ${describe(error)}`, undefined, error)
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
      this.notice('error', `${UI_TEXT.exportFailed}: ${describe(error)}`, undefined, error)
    }
  }

  /**
   * A picked session-export file, parsed (M84, PLAN.md D49); undefined, with
   * the reason posted, when it was dismissed or cannot be used.
   */
  private async pickTransferDocument(
    title: string,
    failure: string,
  ): Promise<SessionExport | undefined> {
    let picked: PickedTransferFile
    try {
      picked = await this.deps.transferFiles.pickTransferFile(title)
    } catch (error: unknown) {
      this.notice('error', `${failure}: ${describe(error)}`, undefined, error)
      return undefined
    }
    if (this.isDisposed || picked.kind === 'dismissed') {
      return undefined
    }
    if (picked.kind === 'tooLarge') {
      this.notice('error', `${failure}: ${UI_TEXT.transferTooLarge}`)
      return undefined
    }
    const parsed = readTransferDocument(picked.content)
    if (!parsed.ok) {
      this.notice('error', `${failure}: ${parsed.reason}`)
      return undefined
    }
    if (parsed.doc.transcript.length === 0) {
      this.notice('info', UI_TEXT.transferEmpty)
      return undefined
    }
    return parsed.doc
  }

  /**
   * Report a problem (M93, PLAN.md D72): the preview dialog's messages. They
   * need no sign-in and start no session: the dialog builds from the journal
   * and local facts alone. A webview failure is journalled here directly;
   * the dialog's handler loads with dist/report.js on first use.
   */
  private async handleReportMessage(message: ReportProblemMessage): Promise<void> {
    const reports = this.deps.reports
    if (reports === undefined) {
      // No recorder could start in this window: nothing to record or build from.
      if (message.type !== 'reportWebviewError') {
        this.deps.log.warn('Report a problem has no flight recorder in this window')
        this.notice('error', UI_TEXT.actionFailed)
      }
      return
    }
    if (message.type === 'reportWebviewError') {
      reports.recordWebviewError(message)
      return
    }
    let handler: { handle: (message: ReportProblemMessage) => Promise<void> }
    try {
      handler = await this.reportProblemHandler(reports)
    } catch (error: unknown) {
      this.reportHandler = undefined
      this.deps.log.error(`The report bundle could not be loaded: ${describe(error)}`)
      this.notice('error', UI_TEXT.actionFailed)
      return
    }
    await handler.handle(message)
  }

  private reportProblemHandler(reports: ConversationReports): Promise<{
    handle: (message: ReportProblemMessage) => Promise<void>
  }> {
    this.reportHandler ??= (async () => {
      const bundle: typeof ReportBundle = await import('../support/reportEntry')
      if (typeof bundle.createReportProblemHandler !== 'function') {
        throw new TypeError('The report bundle does not export its handler factory')
      }
      return bundle.createReportProblemHandler(
        {
          post: (posted) => {
            this.post(posted)
          },
          noticeError: (text) => {
            this.notice('error', text)
          },
          log: this.deps.log,
          source: reports.source,
          io: reports.io,
          onReportWebviewError: (error) => {
            reports.recordWebviewError(error)
          },
        },
        UI_TEXT,
        uiLocale(),
      )
    })()
    return this.reportHandler
  }

  /**
   * "Import session…" (M84, PLAN.md D49): a picked export file resumed as a
   * new conversation on the Model API backend, on the user's own model, in a
   * mode that asks (`adopt` applies it, as on every later opening).
   */
  private async importSession(): Promise<void> {
    if (this.deps.surface.isSideChat === true) {
      this.notice('warning', UI_TEXT.sideChatSessionOnly)
      return
    }
    if (this.refuseAction() !== undefined) {
      return
    }
    // Disposing drops the session, which moves the epoch on: each check
    // after an await covers a closed panel too.
    const generation = this.sendInvalidationEpoch
    try {
      const host = await this.deps.ensureHost()
      if (generation !== this.sendInvalidationEpoch) {
        return
      }
      if (host.importSession === undefined) {
        this.notice('info', UI_TEXT.importSessionUnavailable)
        return
      }
      const doc = await this.pickTransferDocument(
        UI_TEXT.importPreviewTitle,
        UI_TEXT.importSessionFailed,
      )
      if (doc === undefined || generation !== this.sendInvalidationEpoch) {
        return
      }
      // Refused before the confirmation (RV84 #10): a file past what the
      // model can read is not offered for import at all.
      const refusal = importRefusal(doc)
      if (refusal !== undefined) {
        this.notice('error', `${UI_TEXT.importSessionFailed}: ${refusal}`)
        return
      }
      await this.ensureModels(host)
      if (generation !== this.sendInvalidationEpoch) {
        return
      }
      const mode = untrustedStartMode(this.permissionMode, this.deps.initialPermissionMode)
      const isConfirmed = await this.deps.transferFiles.confirmImport(
        UI_TEXT.importPreviewTitle,
        fill(UI_TEXT.importPreviewDetail, {
          source: backendLabel(doc.sourceBackend),
          messages: plural(UI_TEXT.exportPreviewMessages, messageCount(doc.transcript)),
          model: this.modelId,
          mode: UI_TEXT.permissionModes[mode],
        }),
      )
      if (!isConfirmed || generation !== this.sendInvalidationEpoch) {
        return
      }
      this.watchList(host)
      const loaded = await host.importSession(doc, {
        approvalMode: approvalModeFor(mode, this.deps.hasApprovalUi),
        modelId: this.modelId,
      })
      if (generation !== this.sendInvalidationEpoch) {
        loaded.session.dispose()
        return
      }
      await this.adopt(host, loaded, UI_TEXT.importedNotice, 'imported')
    } catch (error: unknown) {
      if (generation === this.sendInvalidationEpoch) {
        this.notice('error', `${UI_TEXT.importSessionFailed}: ${describe(error)}`, undefined, error)
      }
    }
  }

  /**
   * "Open share file…" (M84): a picked export file shown read-only in the
   * panel. Nothing reaches a session or a model; the panel only renders it.
   */
  private async openShareFile(): Promise<void> {
    const doc = await this.pickTransferDocument(UI_TEXT.openShareTitle, UI_TEXT.shareFailed)
    if (doc === undefined || this.isDisposed) {
      return
    }
    this.post({
      type: 'sharePreview',
      title: doc.name ?? UI_TEXT.exportDefaultTitle,
      exportedAt: doc.exportedAt,
      sourceBackend: doc.sourceBackend,
      modelId: doc.modelId,
      redacted: doc.redacted,
      items: doc.transcript,
    })
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
        this.notice(
          'warning',
          `${UI_TEXT.agentTranscriptFailed}: ${describe(error)}`,
          undefined,
          error,
        )
      }
    }
  }

  // --- Voice dictation (M9) ---

  /** The engine the microphone uses now, and its setup (M35). */
  private dictationChoice(): { readonly engine: DictationEngine; readonly setup: DictationSetup } {
    const museVoice = this.deps.museVoice()
    if (
      museVoice !== undefined &&
      this.voiceIsModelApi() &&
      this.deps.modelApiSessionBudgetUsd() > 0
    ) {
      return {
        engine: 'museVoice',
        setup: { isAvailable: false, reason: UI_TEXT.sessionBudgetVoiceUnavailable },
      }
    }
    return museVoice === undefined
      ? { engine: 'system', setup: this.deps.dictation }
      : { engine: 'museVoice', setup: museVoice }
  }

  private voiceIsModelApi(): boolean {
    return (this.sessionKind ?? this.deps.auth.current.backend) === 'modelApi'
  }

  private isVoiceSessionCurrent(session: AgentSession): boolean {
    return !this.isDisposed && this.session === session && this.sessionKind === 'modelApi'
  }

  private async ownedVoiceBudgetScope(): Promise<OwnedSessionBudgetScope | undefined> {
    if (!this.voiceIsModelApi()) {
      return undefined
    }
    if (this.deps.modelApiSessionBudgetUsd() > 0) {
      throw new Error(UI_TEXT.sessionBudgetVoiceUnavailable)
    }
    const workspaceRoot = this.deps.workspaceRoot
    if (workspaceRoot === undefined) {
      return undefined
    }
    const generation = this.attachmentGeneration
    const sendEpoch = this.sendInvalidationEpoch
    const authGeneration = this.deps.auth.admissionGeneration
    const session = await this.ensureSession(workspaceRoot)
    this.requireCurrentOpening(generation)
    if (!this.isVoiceSessionCurrent(session)) {
      throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    const scope = await this.deps.ownedVoiceBudgetScope(session.sessionId)
    this.requireCurrentOpening(generation)
    if (!this.isVoiceSessionCurrent(session)) {
      throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    return scope === undefined
      ? undefined
      : Object.freeze({
          ...scope,
          isStillAllowed: (keyDigest: string | undefined) => {
            const choice = this.dictationChoice()
            return (
              !this.isDisposed &&
              this.isAuthAdmitted() &&
              this.deps.auth.backend === 'modelApi' &&
              authGeneration === this.deps.auth.admissionGeneration &&
              generation === this.attachmentGeneration &&
              sendEpoch === this.sendInvalidationEpoch &&
              this.session === session &&
              this.sessionKind === 'modelApi' &&
              choice.engine === 'museVoice' &&
              choice.setup.isAvailable &&
              scope.isStillAllowed(keyDigest)
            )
          },
        })
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
      ownedBudgetScope: () => Promise.resolve(this.startingVoiceBudgetScope),
      voiceConsentFence: () => this.startingVoiceConsentFence,
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
    if (action === 'stop') {
      // Availability gates new recordings; Stop must still reach the owned
      // driver after the cap, account or paid setting changes.
      this.dictation?.stop()
      this.postDictationState()
      return
    }
    const press = this.dictationPresses
    const choice = this.dictationChoice()
    let scope: OwnedSessionBudgetScope | undefined
    let consentFence: VoiceConsentFence | undefined
    if (choice.engine === 'museVoice' && choice.setup.isAvailable) {
      const generation = this.attachmentGeneration
      const sendEpoch = this.sendInvalidationEpoch
      const authGeneration = this.deps.auth.admissionGeneration
      const backend = this.deps.auth.backend
      const modelId = this.modelId
      const mode = this.permissionMode
      const contextRevision = this.voiceContextRevision
      const isModelApi = this.voiceIsModelApi()
      const isContextCurrent = () =>
        !this.isDisposed &&
        this.isAuthAdmitted() &&
        generation === this.attachmentGeneration &&
        sendEpoch === this.sendInvalidationEpoch &&
        authGeneration === this.deps.auth.admissionGeneration &&
        backend === this.deps.auth.backend &&
        contextRevision === this.voiceContextRevision &&
        modelId === this.modelId &&
        mode === this.permissionMode
      const isCurrent = () => press === this.dictationPresses && isContextCurrent()
      const prepared = await Promise.all([this.ownedVoiceBudgetScope(), this.deps.voiceAccountId()])
      scope = prepared[0]
      const accountId = prepared[1]
      if (accountId === undefined) {
        throw new Error(UI_TEXT.museVoiceNoKey)
      }
      consentFence = (actualDigest, isSending) => {
        if (actualDigest !== accountId) {
          throw new Error(UI_TEXT.notSignedInReason)
        }
        if (!isContextCurrent()) {
          throw new Error(UI_TEXT.sessionBudgetVoiceContextChanged)
        }
        if (!isSending) return
        if (isModelApi && this.deps.modelApiSessionBudgetUsd() > 0) {
          throw new Error(UI_TEXT.sessionBudgetVoiceUnavailable)
        }
        const current = this.dictationChoice()
        if (current.engine !== 'museVoice' || !current.setup.isAvailable) {
          throw new Error(UI_TEXT.sessionBudgetVoiceContextChanged)
        }
      }
      if (!isCurrent() || scope?.isStillAllowed(accountId) === false) {
        this.postDictationState()
        return
      }
      consentFence(accountId, true)
      // Each Muse Voice recording is paid: the popup first (M58, PLAN.md D48).
      const isAllowed = await this.deps.allowsPaidUse({ feature: 'voice' })
      if (!isAllowed || !isCurrent() || scope?.isStillAllowed(accountId) === false) {
        this.postDictationState()
        return
      }
      consentFence(accountId, true)
    }
    this.startingVoiceBudgetScope = scope
    this.startingVoiceConsentFence = consentFence
    try {
      const driver = this.dictationDriver()
      if (driver === undefined) {
        // The button is disabled with the reason; a stray press re-sends it.
        this.postDictationState()
        return
      }
      driver.start()
    } finally {
      this.startingVoiceBudgetScope = undefined
      this.startingVoiceConsentFence = undefined
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
      this.deps.log.warn(`model warm-up failed: ${describeForLog(error)}`)
      // Whatever else waited on the same start fails with it now; a message's
      // own card says it better, so this says it only if nothing else did.
      await new Promise((resolve) => setImmediate(resolve))
      if (this.isFirstShowing(error)) {
        this.say('warning', `${UI_TEXT.hostStartFailed}: ${describe(error)}`)
      }
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
      // A command the panel waits on hears the refusal too (M45, M74, M87),
      // or the prompt's `/goal …` or `/handoff …`, the goal strip's Save, the
      // handoff dialog's Start and a queued card's Edit stay waiting after
      // admission returns.
      switch (message.type) {
        case 'goalCommand': {
          this.post({ type: 'goalCommandResult', requestId: message.requestId, accepted: false })
          break
        }
        case 'requestHandoff':
        case 'confirmHandoff': {
          this.post({ type: 'handoffCommandResult', requestId: message.requestId, accepted: false })
          break
        }
        case 'withdrawQueued': {
          this.post({
            type: 'withdrawRefused',
            localId: message.localId,
            reason: UI_TEXT.notSignedInReason,
          })
          break
        }
        default: {
          break
        }
      }
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
          undefined,
          undefined,
          undefined,
          message.secretAccepted === true,
          message.gitDraft,
          message.gitDraftBase,
        )
        break
      }
      case 'withdrawQueued': {
        await this.withdrawQueued(message)
        break
      }
      case 'runManualHook': {
        const result = await this.deps.runManualHook?.(message.name)
        if (result === undefined) this.notice('warning', UI_TEXT.hooksNotRunnable)
        break
      }
      case 'cancelTurn': {
        await this.cancel()
        break
      }
      case 'signIn': {
        // The first-run screen's third choice (M95): not a credential but
        // the Models & Agents wizard at "Pick a provider" (lane K's
        // `museSpark.startWithOwnModel`; an explicit error until it lands).
        if (message.method === 'byo') {
          await this.runHostAction('startWithOwnModel')
          break
        }
        await this.deps.auth.signIn(message.method)
        this.readWaitingBrief()
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
        this.forgetModels()
        await this.deps.auth.signOut()
        break
      }
      case 'retryBackend': {
        this.dropSession()
        this.forgetModels()
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
        this.judgeCards.get(message.approvalId)?.discard()
        this.judgeCards.delete(message.approvalId)
        await this.decideApproval(message)
        break
      }
      case 'answerQuestion': {
        await this.answerQuestion(message)
        break
      }
      case 'elicitationAnswer': {
        await this.answerElicitation(message)
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
      case 'revertEdit': {
        await this.revertEdit(message.itemId, message.outputRef)
        break
      }
      case 'openFile': {
        await this.openFile(message)
        break
      }
      case 'rewindCode': {
        await this.rewindCode(message)
        break
      }
      case 'startReview': {
        await this.startReview(message.localId, message.text, message.request)
        break
      }
      case 'readReviewChanges': {
        await this.readReviewChanges(message.requestId, message.edits)
        break
      }
      case 'revertReviewHunk': {
        await this.revertReviewHunk(message)
        break
      }
      case 'rewindConversation': {
        this.beginBrowserSessionChange(message.attachmentEpoch)
        await this.rewindConversation(message)
        break
      }
      case 'restoreFiles': {
        await this.restoreFiles(message)
        break
      }
      case 'redoRestore': {
        await this.redoRestore(message)
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
      case 'requestHandoff': {
        await this.requestHandoff(message.requestId, message.goal)
        break
      }
      case 'confirmHandoff': {
        await this.confirmHandoff(message.requestId, message.brief)
        break
      }
      case 'cancelHandoff': {
        this.cancelHandoff(message.requestId)
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
      case 'importSession': {
        await this.importSession()
        break
      }
      case 'openShareFile': {
        await this.openShareFile()
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
      case 'openUsagePage': {
        await this.runHostAction('openUsagePage')
        break
      }
      case 'listSessions': {
        await this.listSessions()
        break
      }
      case 'requestSessionBoard': {
        await this.requestSessionBoard()
        break
      }
      case 'activateBoardSession': {
        const generation = this.sendInvalidationEpoch
        try {
          if (
            this.deps.surface.isSideChat === true &&
            !this.sideSessionIds.has(message.sessionId)
          ) {
            this.notice('warning', UI_TEXT.sideChatSessionOnly)
            break
          }
          if (
            message.backend === 'modelApi' &&
            (await this.deps.bestOfNCoordinator.openSession(message.sessionId))
          )
            break
          if (this.deps.focusBoardSession?.(message.sessionId, message.backend) === true) break
          const host = await this.deps.ensureHost()
          if (generation !== this.sendInvalidationEpoch || this.isDisposed) break
          if (host.info.kind !== message.backend) {
            this.notice('warning', `${UI_TEXT.resumeFailed}: ${message.backend}`)
            break
          }
          this.beginBrowserSessionChange()
          await this.resumeSession(message.sessionId)
        } catch (error: unknown) {
          if (generation === this.sendInvalidationEpoch && !this.isDisposed)
            this.noticeBestOfNFailure(error)
        }
        break
      }
      case 'startBestOfN': {
        await this.startBestOfN(message.prompt, message.attempts, message.requestCeilingPerAttempt)
        break
      }
      case 'takeBestOfNAttempt': {
        await this.takeBestOfNAttempt(message.attemptId, message.runId)
        break
      }
      case 'openBestOfNAttempt': {
        try {
          const manager = await this.bestOfN()
          await manager.open(message.attemptId, message.runId)
        } catch (error: unknown) {
          if (this.isDisposed) break
          this.noticeBestOfNFailure(error, message.attemptId)
        }
        break
      }
      case 'cancelBestOfN': {
        await this.cancelBestOfN(message.runId)
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
      case 'gitAction': {
        await this.git.handleAction(message.action)
        break
      }
      case 'gitCommit': {
        await this.git.commit(message.message, message.includeUnstaged)
        break
      }
      case 'gitCreatePullRequest': {
        await this.git.createPullRequest(message)
        break
      }
      case 'openReport':
      case 'updateReport':
      case 'exportReport':
      case 'reportWebviewError': {
        await this.handleReportMessage(message)
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

  /** A setting change retires contributor work, including in-flight preparations. */
  public confidentialWorkspaceChanged(): void {
    if (
      this.deps.isConfidentialWorkspace() &&
      (isContributorModel(this.modelId) ||
        (this.session !== undefined && isContributorModel(this.session.modelId)))
    ) {
      this.notice('warning', UI_TEXT.contributorBlocked)
      this.dropSession()
    }
    this.forgetModels()
    void this.warmModels()
  }

  /** Whether checkpoints run changed (trust granted, the setting): the panel is told (M72). */
  public checkpointsChanged(): void {
    void this.checkpoints.refresh()
  }

  public checkpointAvailabilityChanged(): void {
    this.checkpoints.postState()
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
    this.checkpoints.panelReady()
    this.postSkills()
    for (const attachment of this.attachments.list()) {
      this.post({ type: 'attachmentAdded', attachment })
    }
    this.git.postState(true)
    // A waiting handoff's dialog (M74), after the surface state, whose
    // clearing of a stale restored conversation would drop it again; or
    // its brief, when admission put the read off.
    this.postHandoffReady()
    this.readWaitingBrief()
    void this.warmModels()
    this.postStartupNotice()
  }

  /**
   * Runs one message from the webview. The caller does not wait (a `void`
   * call), so a failure no step in `dispatch` caught would reach only VS Code's
   * Extension Host log: it is logged here, with its stack, and said (M39),
   * unless the panel showed this very failure already (a shared start).
   */
  public async handle(message: ConversationMessage): Promise<void> {
    try {
      await this.dispatch(message)
    } catch (error: unknown) {
      this.deps.log.error(
        `${message.type} failed: ${isMspFailure(error) ? describeForLog(error) : errorDetail(error)}`,
      )
      if (this.isFirstShowing(error)) {
        this.say('error', `${UI_TEXT.actionFailed}: ${describe(error)}`)
      }
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
    if (this.isDamaged(last.sessionId)) {
      // History opens it on request; it is never resumed by itself (CLI recovery).
      this.deps.log.info(`Session ${last.sessionId} is not reopened: its Muse Code log is damaged`)
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
    if (this.isDamaged(sessionId)) {
      this.deps.log.info(`Session ${sessionId} is not reopened: its Muse Code log is damaged`)
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
    this.bypassRevocationEpoch += 1
    this.hasConfirmedRemoteBypass = false
    this.permissionModeSelection += 1
    if (this.permissionMode !== BYPASS_MODE) {
      return
    }
    const selection = this.permissionModeSelection
    this.permissionMode = FALLBACK_MODE
    this.voiceContextRevision += 1
    const session = this.session
    const generation = this.sendInvalidationEpoch
    if (session !== undefined) {
      try {
        try {
          await this.reviewModeSettling
        } catch {
          // A refused Bypass request still needs the live Manual fallback.
        }
        if (
          !this.isCurrentSessionAction(session, generation) ||
          selection !== this.permissionModeSelection
        ) {
          return
        }
        await this.setSessionPermissionMode(
          session,
          approvalModeFor(FALLBACK_MODE, this.deps.hasApprovalUi),
        )
      } catch (error: unknown) {
        if (!this.isCurrentSessionAction(session, generation)) {
          return
        }
        this.deps.log.warn(`Bypass revocation: the mode change failed (${describeForLog(error)})`)
        this.retireBypassSession()
        return
      }
    }
    if (generation !== this.sendInvalidationEpoch || this.isDisposed) {
      return
    }
    this.notice('warning', UI_TEXT.bypassRevoked)
    this.postComposerState()
  }

  /**
   * The engine may have changed (M35: the paid feature or the backend): an
   * idle driver of the other engine goes, and the microphone is told.
   */
  public refreshDictation(): void {
    const { engine, setup } = this.dictationChoice()
    if (this.dictationEngine !== engine || !setup.isAvailable) {
      this.retireDictation()
    }
    this.postDictationState()
  }

  /** Alt+T: flip the Thinking toggle for this conversation. */
  public async toggleThinking(): Promise<void> {
    await this.updateEffort(this.effort, !this.isThinkingEnabled)
  }

  /** Capture a host write's exact owner without opening a session or exposing a later replacement. */
  public captureExternalEditOwner(
    capture: (session: AgentSession) => WorkspaceEditRecorder | undefined,
  ): WorkspaceEditRecorder | undefined {
    return this.isDisposed || this.session === undefined ? undefined : capture(this.session)
  }

  /** Whether Ctrl+B has a running command to move here (M46): its context key. */
  public get hasForegroundShell(): boolean {
    return this.foregroundShells.size > 0
  }

  /** The Judge reads the attached action's current model and loaded context window. */
  public judgeContext(
    sessionId: string,
    turnId: string,
  ):
    | {
        readonly backend: BackendKind
        readonly modelId: string
        readonly contextLimit: number | undefined
      }
    | undefined {
    if (
      this.isDisposed ||
      this.accountStopsInFlight > 0 ||
      this.session === undefined ||
      this.sessionKind === undefined ||
      this.session.sessionId !== sessionId ||
      this.activeTurnId !== turnId ||
      (this.deps.isConfidentialWorkspace() && isContributorModel(this.session.modelId))
    )
      return
    return {
      backend: this.sessionKind,
      modelId: this.session.modelId,
      contextLimit: this.contextLimitFor(this.session.modelId),
    }
  }

  public postJudge(
    message: Extract<HostToWebviewMessage, { type: 'judgeState' | 'agentEvent' }>,
  ): void {
    this.post(message)
  }

  /** Board state comes from captured turn events, not a guessed native status. */
  public boardSession(): BoardSession | undefined {
    if (
      this.isDisposed ||
      this.accountStopsInFlight > 0 ||
      this.session === undefined ||
      this.sessionKind === undefined
    ) {
      return undefined
    }
    const record = this.sessionRecords?.get(this.session.sessionId)
    const root = record?.workspaceRoot ?? this.deps.workspaceRoot
    return {
      sessionId: this.session.sessionId,
      backend: this.sessionKind,
      status: this.activeTurnId === undefined ? 'idle' : 'running',
      ...(record?.name !== undefined && { name: record.name }),
      ...(record?.title !== undefined && { title: record.title }),
      ...(record?.branch !== undefined && { branch: record.branch }),
      ...(typeof root === 'string' && { workspaceRoot: root }),
    }
  }

  public revealBoardSession(sessionId: string, backend: BackendKind): boolean {
    if (
      this.isDisposed ||
      this.accountStopsInFlight > 0 ||
      this.sessionKind !== backend ||
      this.session?.sessionId !== sessionId
    ) {
      return false
    }
    this.deps.surface.reveal()
    return true
  }

  /** Whether a turn of this conversation runs on that backend (the watchdog's choice, CLI recovery). */
  public isTurnRunningOn(kind: BackendKind): boolean {
    return this.activeTurnId !== undefined && this.sessionKind === kind
  }

  /**
   * Muse Code stopped answering (the watchdog, CLI recovery), said in a
   * panel on it: restarted already when no turn ran, or, in a panel whose
   * turn runs, the offer to restart it (D26's Restart, which stops the turn).
   */
  public museCodeStoppedAnswering(isRestarted: boolean): void {
    if ((this.sessionKind ?? this.resumeTarget?.kind ?? this.deps.auth.backend) !== 'museCode') {
      return
    }
    if (isRestarted) {
      this.say('info', UI_TEXT.museCodeRestartedUnresponsive)
      return
    }
    if (!this.isTurnRunningOn('museCode')) {
      return
    }
    this.deps.log.warn(`${NOTICE_PREFIX}${UI_TEXT.museCodeUnresponsiveTurn}`)
    this.post({
      type: 'notice',
      level: 'warning',
      text: UI_TEXT.museCodeUnresponsiveTurn,
      actions: ['restartMuseCode'],
    })
  }

  /**
   * "Restart Muse Code" (CLI recovery) stopped the backend: the fresh one
   * starts now and lists its models, as when the panel opens; the
   * conversation resumes with its next message.
   */
  public warmUp(): void {
    void this.warmModels()
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
   * granted, a sign-in or sign-out; PLAN.md D25). A fault recovery names
   * only its backend kind, leaving the other backend's conversations live.
   * A running turn is
   * cancelled and ended in the webview; unless the conversations end (sign
   * out, shutdown), the session is resumed by the next message.
   */
  public async backendStopping(
    isConversationEnding: boolean,
    onlyKind?: BackendKind,
  ): Promise<void> {
    if (
      onlyKind !== undefined &&
      (this.sessionKind ?? this.resumeTarget?.kind ?? this.deps.auth.backend) !== onlyKind
    ) {
      return
    }
    if (isConversationEnding) {
      this.accountStopsInFlight += 1
    }
    try {
      // Invalidate a pending send before a running turn's cancel can await.
      this.sendInvalidationEpoch += 1
      if (isConversationEnding) {
        this.accountStopEpoch = this.sendInvalidationEpoch
      }
      this.bestOfNManager?.dispose()
      this.bestOfNManager = undefined
      this.lastBestOfNRun = undefined
      this.gapReload = undefined
      this.unsubscribe?.()
      this.unsubscribe = undefined
      this.closedWatch?.()
      this.closedWatch = undefined
      this.historyWatchEpoch += 1
      // The hosts are stopping: no tracked card can still wait on them.
      this.deps.pendingPrompts.clear()
      if (isConversationEnding) {
        this.attachmentGeneration += 1
        this.webviewAttachmentEpoch += 1
        this.attachments.clear()
        this.post({ type: 'conversationCleared', accountBoundary: true })
        this.post({ type: 'attachmentsCleared' })
        this.git.sessionChanged(undefined)
        // The tasks tab's conversation ends at the account boundary too (M87).
        this.endTasksTab()
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
          this.deps.log.warn(`turn/cancel before the restart failed: ${describeForLog(error)}`)
        }
        this.endTurnLocally('cancelled', UI_TEXT.turnStoppedByRestart)
      }
      const waiting = this.pendingHandoff
      const isWaitingTurnFinished =
        waiting?.turnId !== undefined &&
        waiting.brief === undefined &&
        this.finishedTurns.has(waiting.turnId)
      this.rememberForResume(isConversationEnding ? undefined : session)
      this.dropSession(false)
      if (
        !isConversationEnding &&
        waiting !== undefined &&
        isWaitingTurnFinished &&
        this.pendingHandoff === waiting &&
        waiting.brief === undefined &&
        waiting.turnId !== undefined
      ) {
        // A brief deferred by closed admission (M74) survives the resumable
        // restart: the stop dropped the session and the finished-turn
        // record, so the waiting handoff is adopted into the new generation
        // with its turn, its session rebound when the conversation resumes,
        // and the sign-in retry reads it (the review of PR #84).
        waiting.generation = this.sendInvalidationEpoch
        waiting.session = undefined
        this.finishedTurns.add(waiting.turnId)
      }
      this.forgetModels()
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
   * `Muse Spark: Report a Problem` (M93): the same dialog the panel's entry
   * points open, built from the journal; nothing about the conversation.
   */
  public async openReport(): Promise<void> {
    await this.handleReportMessage({ type: 'openReport' })
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
    this.forgetModels()
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
    this.bestOfNManager?.dispose()
    this.historyWatchEpoch += 1
    clearTimeout(this.deltaTimer)
    this.deltaTimer = undefined
    this.pendingDelta = undefined
    this.dropSession()
    this.endTasksTab()
    this.forgetModels()
    this.listWatch.dispose()
    this.usageWatch.dispose()
    this.usageHost = undefined
    this.latestUsage = undefined
    this.dictation?.dispose()
    this.dictation = undefined
    this.retiredDictation?.dispose()
    this.retiredDictation = undefined
    this.checkpoints.dispose()
    this.git.dispose()
  }

  /**
   * The user trusted the held worktree in the card (M71): the card goes, and
   * the conversation, still in Plan, may leave it now.
   */
  public worktreeHoldReleased(): void {
    this.git.postState()
    this.postComposerState()
  }
}

function providerPricing(certainty: string): ProviderUsageRow['pricing'] {
  switch (certainty) {
    case 'local':
    case 'plan':
    case 'unpriced': {
      return certainty
    }
    default: {
      return 'priced'
    }
  }
}
