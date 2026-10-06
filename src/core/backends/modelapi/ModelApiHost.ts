import { redactDiagnosticEvent, redactSecrets } from '../../redact'
// The Model API backend (PLAN.md D1, M7): sessions held in this process,
// each a replayed conversation on `POST /v1/responses` (stateless reasoning
// replay, `store: false`) with the in-process tool harness, the permission
// engine and the approval / question cards of the transcript. Emits the
// same AgentEvents as the Muse Code host, so nothing above it changes.
// Sessions live for the host's lifetime (this VS Code window).

import { Buffer } from 'node:buffer'
import { ArgumentPreview, type ArgumentPreviewCapabilities } from './argumentPreview'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import type {
  AgentEvent,
  ApprovalSubject,
  ElicitationField,
  ElicitationReply,
  ItemSnapshot,
  QuestionAnswer,
  TodoItem,
} from '../../../shared/agentEvents'
import {
  AGENT_SOURCE_LABELS,
  AUTH_REQUIRED_ERROR_KIND,
  AUTO_REVIEW_ROW_TOOL,
  AUTO_REVIEWER_RECENT_CALLS,
  BACKGROUND_INITIATOR_USER,
  BASE64_DATA_URL_OVERHEAD_CHARS,
  BROWSER_CHECK_SUBJECT_KIND,
  BROWSER_CHECK_WIDEN_SUBJECT_KIND,
  CHECK_FIX_MAX_ROUNDS,
  type CheckCommandSetting,
  type CheckSkip,
  CLARIFICATION_MAX_CHARS,
  CODE_INTEL_MODEL_TEXT,
  CODE_INTEL_TOOLS,
  type CodeIntelTool,
  CONTEXT_PRESSURE_HIGH,
  CONTEXT_PRESSURE_MEDIUM,
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  FILE_REFUSAL_MODEL_TEXT,
  GOAL_OBJECTIVE_MAX_CHARS,
  GOAL_STATUS,
  type GoalCommandVerb,
  HOOK_MAX_STOP_CONTINUATIONS,
  HOOK_MODEL_READ_TOOLS,
  HOOK_NOTIFICATION_DELAY_MS,
  HOOK_ON_FAILURE_MAX_DEPTH,
  HOOK_SESSION_END_TIMEOUT_MS,
  HTTP_STATUS,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
  IDE_MCP_SERVER_NAME,
  MCP_ELICITATION_TIMEOUT_MS,
  ISO_DATE_LENGTH,
  MAX_ENCODED_MEDIA_CHARS,
  MAX_MODEL_API_TEXT_ATTACHMENT_BYTES,
  MEMORY_INDEX_FILE,
  type MemoryScope,
  MODEL_API_CLOSE_SETTLE_MS,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_EFFORT_OFF,
  MODEL_API_HOOK_PROVIDER,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_MAX_RETRIES,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_MODEL_TEXT,
  MODEL_API_OUTPUT_ENCODING,
  MODEL_API_OUTPUT_MEDIA_TYPE,
  MODEL_API_PDF_PAGE_IMAGES,
  MODEL_API_RETRYABLE_STREAM_CODES,
  MODEL_API_SCHEDULED_TOOL,
  MODEL_API_SERVER_NAME,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
  MODEL_API_VERSION,
  MODEL_API_WEB_SEARCH_TOOL,
  MODEL_TEXT,
  OUTPUT_REF_PREFIX,
  PAID_FEATURES,
  PAID_PRICES_USD,
  type PaidFeature,
  PROJECT_SKILLS_DIR_SEGMENTS,
  type PromptCacheRetention,
  QUESTION_OUTCOME_CLARIFIED,
  REPO_MAP_PROMPT_TRIES,
  SCHEDULE_LIFETIME_MS,
  SCHEDULE_MAX_INTERVAL_MS,
  SCHEDULE_MAX_JOBS_PER_SESSION,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_POLL_INTERVAL_MS,
  SEARCHES_PER_PRICE_UNIT,
  SHELL_DEFAULT_TIMEOUT_MS,
  SKILL_FILE_NAME,
  STORED_SESSION_VERSION,
  SUBAGENT_CAPACITY,
  SUBAGENT_DEPTH,
  SUBAGENT_ID_PREFIX,
  SUBAGENT_MAX_PER_CONVERSATION,
  SUBAGENT_RESULT_READY,
  SUBAGENT_RESULT_TEXT_MAX_CHARS,
  SUBAGENT_SUMMARY_MAX_CHARS,
  SUBAGENT_TASK_MAX_REQUESTS,
  SUBAGENT_WAIT_DEFAULT_MS,
  type SubagentAction,
  THINKING_OFF_EFFORT,
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_ARGUMENT_PREVIEW_INTERVAL_MS,
  TOOL_STATUS_INTERRUPTED,
  UI_TEXT,
  USER_SHELL_ITEM_KIND,
  USER_SHELL_TIMEOUT_MS,
  VERIFY_COMMAND_RULE_KEY,
  VERIFY_NOTE_MAX_CHARS,
  VERIFY_SHOWN_FILES_MAX,
  VERIFY_TOOLS,
  WEB_FETCH_SUBJECT_KIND,
} from '../../../shared/constants'
import { fill, formatNumber, plural } from '../../../shared/l10n/text'
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
  type QueuedMessageRef,
  type SentImage,
  type SessionEventListener,
  type SessionHistoryOutcome,
  type SessionMcpHttpServer,
  type SessionListEvent,
  type SessionPage,
  type SessionRecord,
  type SkillSummary,
  type StartSessionOptions,
  SteerRefusedError,
  type TurnPart,
  type TurnSubmission,
  type WithdrawOutcome,
} from '../../agent/agentBackend'
import type { ContextIo } from '../../context/contextFiles'
import {
  type AgentDefinition,
  type AgentRuntime,
  narrowApprovalMode,
  narrowTools,
  resolveAgentEffort,
  resolveAgentModel,
} from '../../context/customAgents'
import {
  type BundledSkillsSource,
  type SkillDefinition,
  type SkillSource,
  skillBodyForModel,
} from '../../context/skills'
import { WorkspaceContext } from '../../context/workspaceContext'
import type { CoreLogger } from '../../logging'
import { textFileInput } from '../../textAttachment'
import { withDeadline } from '../../timeouts'
import { isProtectedPath } from '../../protectedPaths'
import { isSamePath } from '../../paths'
import { ShellEntryError } from '../../shellResult'
import { confineWorkspacePath, isBelow } from '../../workspacePath'
import { pathModule } from '../../workspaceRoot'
import { type CheckScope, type RunSnapshot, VerifyLedger } from './verifyLedger'
import { WorkspaceEdits, type WorkspaceEditRecorder } from '../../verify/workspaceEdits'
import { fingerprint } from '../../verify/fingerprint'
import type { McpTool } from '../../mcp'
import type { WebFetcher, WebFetchResult } from '../../web/webFetch'
import {
  type BrowserCheckHost,
  browserCheckScope,
  browserScopeKey,
  extraHostSet,
  placeBrowserCall,
} from '../../browser/browserTool'
import type { CheckAdmission } from '../../browser/browserRun'
import { browserCheckOutcome, browserCheckRefused, browserCheckRestricted } from './browserCalls'
import type { WebFetchFailure } from '../../web/fetchFailure'
import type { JudgeAdvisory, JudgeFence } from '../../judge/use'
import type { ModelApiJudgeConnection } from '../../judge/same/modelApiSource'
import { approvalHost } from '../../web/hostName'
import { checkPageUrl } from '../../web/pageUrl'
import { IndexLineStoppedError, type MemoryStore } from '../../memory/memoryStore'
import { type CodeIntelDeps, CodeIntelRefusal } from '../../codeIntel/codeIntelQuery'
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
import type { PermissionSettings } from '../../permissionSettings'
import { ReviewBreaker } from './autoReviewer'
import type {
  runHookModelTurn as RunHookModelTurn,
  reviewPaidCall as ReviewPaidCall,
} from './reviewerEntry'
import type {
  createForeignHookAdapter as CreateForeignHookAdapter,
  PluginHostDeps,
} from './foreignHooksEntry'
import type * as HookRuntime from './hookRuntimeEntry'
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
  type ForeignDispatchContext,
  type ForeignHookAdapter,
  type HookDefinition,
  type HookDispatch,
  type HookEvent,
  type HookReplacement,
  toolMatcherNames,
} from './hooks'
import { postModelCallFields, preModelCallFields } from './modelCallHooks'
import type { HookMcpOutcome, HookModelTurn, HookModelDailyBudget } from './hookHandlers'
import { ObservationPack, estimatePackTokens } from './observationPack'
import { nextScheduleFire } from './schedules'
import {
  type BudgetBase,
  type BudgetReservation,
  type OwnedSessionBudgetScope,
  estimateInput,
  requestParts,
  reserveRequest,
  type SessionBudgetClaim,
  SessionBudgetExceededError,
} from './sessionBudget'
import { uiLocale } from '../../../shared/l10n/text'
import { estimateCostUsd, formatUsd } from '../../usage/insights'
import { toolHookInput, toolHookOutput } from './toolHookPayload'
import {
  afterAgentThoughtFields,
  beforeToolSelectionFields,
  createFileChangedThrottle,
  emptyExtensionDispatch,
  extensionHookPayload,
  fileChangedFields,
  instructionsLoadedFields,
  isToolAllowedBySelection,
  modelSwitchFields,
  messageDisplayFields,
  isFileChangedWatched,
  permissionDeniedFields,
  taskFields,
  userPromptExpansionFields,
  type ExtensionHookContext,
  type ExtensionHookDefinition,
  type ExtensionHookDispatch,
  type ExtensionHookEvent,
  type FileChangedThrottle,
} from './extensionHooks'
import { type ImagePlan, imageUseRequest, prepareImageCall, runImageCall } from './imageGeneration'
import { promptCacheKey } from './promptCache'
import {
  isReviewerRole,
  isReviewerTool,
  reviewerInstructionsFor,
  reviewerToolRefusal,
} from './reviewer'
import { MediaBudget } from './mediaBudget'
import { mcpFunctionDefinition, mcpFunctionName } from './mcp/functions'
import {
  ALLOW_ELICITATION_SEAM,
  describeElicitationForLog,
  type ElicitationHookSeam,
  elicitationFieldNames,
  type ElicitationOutcome,
} from './mcp/elicitation'
import type {
  McpElicitationHandler,
  McpElicitationRequest,
  McpPoolSnapshot,
  McpToolRef,
  McpToolSource,
} from './mcp/pool'
import { isMemoryTool, placeMemoryCall, runMemoryCall, type PlacedMemoryCall } from './memoryTools'

import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  PermissionEngine,
  type PermissionJudgement,
  type PermissionQuery,
  type ToolClass,
  verdictFor,
} from './permissions'
import { describePolicyProblem, type PermissionPolicy, PolicyCache } from './permissionPolicy'
import { sanitizeImportedSession, type SessionExport } from '../../export/sessionTransfer'
import {
  headerOf,
  recordOf,
  type SessionStore,
  type StoredPendingChildResult,
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
  type FunctionToolDefinition,
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
  type FormatTarget,
  executeTool,
  parseQuestions,
  readSkillArgs,
  webFetchArgs,
  type ShellResult,
  parseShellDirectoryReport,
  shellDirectoryTrailer,
  shellOutcome,
  shellText,
  ShellTimeLimit,
  shellToolFor,
  todoWriteArgs,
  toolDefinitions,
  type ToolIo,
  type ToolOutcome,
  type TopTurn,
  type TouchedFiles,
  type TurnCheckpoint,
  type TurnEnd,
  type TurnWrites,
  type VisibleFile,
} from './tools'
import {
  isSubagentTool,
  sendMessageArgs,
  spawnArgs,
  type SpawnArgs,
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
  /** One Auto reviewer call's tokens (M78): billed apart from the conversation. */
  readonly noteReviewerUsage: (modelId: string, usage: SubagentUsage) => void
  /**
   * One M91 prompt/agent hook run's tokens (D70): billed apart from the
   * conversation, on the hookModels tally line. Optional until the host
   * wires it: without it, runs are still counted, but no cost settles.
   */
  readonly noteHookModelUsage?: ((modelId: string, usage: SubagentUsage) => void) | undefined
  readonly hookModelDailyBudget?: HookModelDailyBudget | undefined
}

export interface ModelApiHostDeps extends ModelApiPaidHooks {
  /** M98: injected same-model source; all paid dispatch admitted by lane A. */
  readonly judge?: JudgeAdvisory | undefined
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
  /** The skills that ship with the extension (M89, PLAN.md D68); undefined where none ship. */
  readonly bundledSkills?: BundledSkillsSource | undefined
  /** The managed personal agent root (M76); undefined without a home. */
  readonly personalAgentsRoot: string | undefined
  /** VS Code workspace trust: gates rules, skills, memory and the shell (D13). */
  readonly isWorkspaceTrusted: () => boolean
  /** `museSpark.confidentialWorkspace`: contributor-tier agent models are blocked. */
  readonly isConfidentialWorkspace: () => boolean
  /** One explicit yes before a contributor-tier agent model is used (M76). */
  readonly confirmContributorModel: (modelId: string) => Promise<boolean>
  /** Sessions between windows (D14); undefined without workspace storage. */
  readonly store?: SessionStore | undefined
  /** External trials share this parent's spending without saving their temporary DTO as its history. */
  readonly budgetScope?: OwnedSessionBudgetScope
  /** Extension-owned preflight/actual-attempt hooks, composed with budget and child admission. */
  readonly admitResponseAttempt?: ResponseAttemptGuard | undefined
  /** The git facts for the prompt's environment section (D15), read once per session. */
  readonly describeEnvironment: () => Promise<EnvironmentFacts>
  /** Whether a paid feature is on (M33–M35, PLAN.md D30): its setting, and its price accepted. */
  readonly isPaidFeatureOn: (feature: PaidFeature) => boolean
  /** Counts paid uses for the window's tally: searches made, images returned. */
  readonly notePaidUse: (feature: PaidFeature, units: number) => void
  /** `museSpark.modelApiPromptCacheRetention`, read per request (M56, PLAN.md D43). */
  readonly promptCacheRetention: () => PromptCacheRetention
  /** `museSpark.modelApiSessionBudgetUsd`, read per request; 0 is no cap (M82). */
  readonly sessionBudgetUsd: () => number
  /** `museSpark.modelApiReplyUsage`, read per reply (M82). */
  readonly showReplyUsage: () => boolean
  /** M106 L1: selected M95 record projection; absent/unknown leaves today's stream unchanged. */
  readonly argumentPreviewCapabilities?:
    ((modelId: string) => ArgumentPreviewCapabilities | undefined) | undefined
  /**
   * Observation packing (M73, PLAN.md D49): `museSpark.modelApiObservationPacking`,
   * or the M75 eval's `packing` arm. Read when a session is created or
   * resumed: true packs that session's outputs for its life; absent or
   * false packs nothing and offers no `recall_output`.
   */
  readonly observationPacking?: (() => boolean) | undefined
  /**
   * The shell keeps its directory between calls (M91 lane S, PLAN.md D70):
   * `museSpark.modelApiShellKeepsDirectory`, read per shell call. Absent or
   * false runs every call at the workspace root, as before.
   */
  readonly shellKeepsDirectory?: (() => boolean) | undefined
  /**
   * Where the shell's per-session side files live (M91 lane S): the
   * extension's temp dir holds one file per session. Tests pass their own;
   * the operating system's temp dir is the default.
   */
  readonly shellSidecarDir?: string | undefined
  /** A smaller replay cap for focused media-budget verification. */
  readonly mediaBudgetMaxEncodedChars?: number
  /** Extension-owned, workspace-local schedules; absent without workspace storage. */
  readonly scheduleStore?: ScheduleStore | undefined
  /** SHA-256 digest of the current SecretStorage key, never its plaintext. */
  readonly getAccountId: () => Promise<string | undefined>
  /** Owned attempt usage observer; receives a per-response delta, not transcript totals. */
  readonly noteResponseUsage?: ((modelId: string, usage: SubagentUsage) => void) | undefined
  /** A fresh snapshot at each session start (M51); disabled means empty. */
  readonly loadHooks?: () => Promise<readonly HookDefinition[]>
  /** The session's spark-hooks.json snapshot (M91 lane E); same gates, empty when disabled. */
  readonly loadExtensionHooks?: () => Promise<readonly ExtensionHookDefinition[]>
  /** Machine hook opt-in is checked again for every dispatch. */
  readonly isHooksEnabled?: (() => boolean) | undefined
  /**
   * M91 http hooks (D70): `museSpark.hookHttpAllowedHosts`, read at every
   * dispatch. Absent means empty: no http hook runs. Optional until the host
   * wires the setting.
   */
  readonly hookHttpAllowedHosts?: (() => readonly string[]) | undefined
  /** The workspace sandbox's network posture, re-read before each HTTP hook. */
  readonly isHookNetworkAllowed?: (() => boolean) | undefined
  /**
   * Amp and OpenCode plugin hooks' host side (M91b): M51's allowlisted
   * environment and the tree their children run in. Without it they are
   * refused by their fail-closed rule.
   */
  readonly pluginHooks?:
    (Pick<PluginHostDeps, 'containment'> & { readonly env: () => NodeJS.ProcessEnv }) | undefined
  /** Tests can shorten the six-second Notification delay without waiting. */
  readonly hookNotificationDelayMs?: number | undefined
  /**
   * Tests give an imported hook's regular-expression match a deadline a
   * loaded rig cannot lapse; production keeps HOOK_MATCHER_TIMEOUT_MS.
   */
  readonly hookMatcherTimeoutMs?: number | undefined
  /** Tests can shorten the elicitation form's wait without waiting. */
  readonly elicitationTimeoutMs?: number | undefined
  /** The MCP servers of Muse Code's settings (M50, PLAN.md D42), closed with the host. */
  readonly mcpServers?: McpToolSource | undefined
  /**
   * The Elicitation and ElicitationResult hook runs (M91, PLAN.md D70).
   * Lane E owns the dispatch; until it lands, the default proceeds every
   * request to the form. Tests inject a fake here.
   */
  readonly elicitationHooks?: ElicitationHookSeam | undefined
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
   * The window's browser check (M81, PLAN.md D49): the run in the browser's
   * own bundle and the user's widened hosts; undefined leaves
   * `browser_check` out.
   */
  readonly browserCheck?: BrowserCheckHost | undefined
  /**
   * VS Code's language services (M67, PLAN.md D49): the code intelligence
   * tools; undefined leaves them out.
   */
  readonly codeIntel?: LanguageServiceHost | undefined
  /** `museSpark.modelApiRepoMap`, read per turn: the repo map in the system prompt (M67). */
  readonly isRepoMapInPrompt?: (() => boolean) | undefined
  /**
   * M72: admitted before hooks or edits, including queued and scheduled
   * turns. M86: whether the turn is recorded, with its own writes, which
   * record what its tools write for a restore until `afterTurnRuns`. A child
   * turn passes its top turn (spec 3.2): it inherits that turn's decision,
   * and it does not run when its own record cannot be made (a rejection).
   */
  readonly beforeTurnRuns?:
    ((sessionId: string, turnId: string, top?: TopTurn) => Promise<TurnCheckpoint>) | undefined
  /** The turn ended (Stop and cancellation alike): its checkpoint ends after its writes. */
  readonly afterTurnRuns?:
    ((sessionId: string, turnId: string, end: TurnEnd) => Promise<void>) | undefined
  /**
   * The command rules, permission profiles and repository rules (M78,
   * PLAN.md D49), read at each call so a change applies at once; undefined
   * means none are set.
   */
  readonly permissionSettings?: (() => PermissionSettings) | undefined
}

const NO_ENVIRONMENT: EnvironmentFacts = { git: undefined }
// The memory scope whose notes are workspace files (`.agents/memory`, M49).
const PROJECT_MEMORY_SCOPE: MemoryScope = 'project'
// The skill source whose skills are workspace files (`.agents/skills`, D13).
const PROJECT_SKILL_SOURCE: SkillSource = 'project'

/** No command rules, no profiles: a host built without the settings (M78). */
const NO_PERMISSION_SETTINGS: PermissionSettings = {
  commandRules: [],
  profiles: {},
  profile: '',
  repositoryRules: undefined,
}

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
  /** The model's line in its place if a stop drops it first. */
  readonly notDelivered: string
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

// A message steered into the running turn (M87): the one kind taken back without an event.
const STEERED_DISPOSITION = 'steered'

function isImagePart(part: TurnPart): part is ImagePart {
  return part.type === 'image'
}

/** A withdrawn message's picture, as the composer takes it back (M87, as M53's rewind). */
function sentImageOf(part: ImagePart): SentImage {
  return { mediaType: part.mediaType, base64Data: part.base64Data }
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
  /** The custom agent the spawn named (M76); undefined runs with the session's own prompt. */
  readonly agentId: string | undefined
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
  /**
   * The file policy's revision at the spawn's admission (M78, the RV78g
   * review): the child's results quote what it read since, so they reach
   * the parent's model only while the policy is still that revision.
   * Undefined for a child saved before revisions were recorded.
   */
  readonly policyRevision: string | undefined
}

/** One consented child task; only in memory, never in the session snapshot. */
interface ChildTaskGrant {
  /** The model the child runs on: a custom agent's own, else the session's. */
  readonly modelId: string
  /** The session's model when the grant was approved; a later switch ends the task. */
  readonly parentModelId: string
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
  readonly isHookContinuation?: boolean
  /** The accepted user goal command this queued wake must still serve. */
  readonly goalCommandRevision?: number
  /** A `/review` (M70): the turn runs as the Reviewer, its prompt and read-only tools. */
  readonly isReview?: boolean
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
  /** Run as the Reviewer (M70): its prompt, and only the tools that read. */
  readonly isReview: boolean
  /** Whether it is recorded (M86), and what its tools then write through; set once admitted. */
  checkpoint?: TurnCheckpoint | undefined
  /** It started a process, or one of the conversation's ran in the background (M86, spec 8). */
  ranProcesses: boolean
  /** The terminal is selected; checkpoint cleanup cannot cancel this turn. */
  isFinalizing?: boolean
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

/** A request's budget reservation while it runs (M82). */
interface OpenReservation extends BudgetReservation {
  /** The model the body names: a base only while the session still uses it. */
  readonly modelId: string
  /** Any intervening model change invalidates its base, including a switch back. */
  readonly modelRevision: number
  readonly goalRevision: number
  readonly isWorkspaceTrusted: boolean
  readonly paidFeatures: readonly PaidFeature[]
  readonly hasCap: boolean
  readonly hasUnknownCost: boolean
  hasAmbiguousAttempt: boolean
  /** The account whose reservation was saved before the final key admission. */
  accountId: string | undefined
  /** Held on disk, including before the request is actually sent. */
  isReserved: boolean
  claim: SessionBudgetClaim | undefined
  /** Its parts: the next estimate's base once its usage is reported. */
  readonly parts: ReadonlyMap<string, number>
  /** Its response began: a request ending now without usage counts at the whole reservation. */
  hasStarted: boolean
  /** It went out with the key: stopped from here on, it may have run, so it counts too. */
  isSent: boolean
  /** An explicit refusal before any response began has no billable usage. */
  isRefused: boolean
}

/** A direct paid response owns its claim instead of borrowing the main request's state. */
export interface DirectResponseBudget {
  readonly scope: OwnedSessionBudgetScope | undefined
  readonly claim: SessionBudgetClaim | undefined
  isSent: boolean
}

/** The requests behind a reply line (M82): their tokens and dollars. */
interface ReplyUsageTally {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
  readonly reasoningTokens: number
  readonly costUsd: number
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

/** How an elicitation form settled (M91 lane M): accept, decline or cancel. */
type ElicitationContent =
  | { readonly kind: 'accepted'; readonly content: Readonly<Record<string, unknown>> }
  | { readonly kind: 'declined' }
  | { readonly kind: 'cancelled' }

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

/** A captured call owner; only an explicitly moved, still-owned background shell may outlive its turn. */
type CallAdmission = (canRunDetached?: boolean) => boolean

/**
 * What let a call in under the permission policy (M78), for its live policy
 * fence: the call as the engine judges it, the engine's judgement once it
 * was admitted (after any card), with no hook's question folded in, and
 * whether the workspace was trusted then.
 */
interface Admission {
  readonly query: PermissionQuery
  readonly judgement: PermissionJudgement
  readonly isTrusted: boolean
  /** The file policy's revision then (`filePolicyRevision`), for an outcome that cannot name its files. */
  readonly revision: string
}

/**
 * Where the dispatcher learns what let a call in (M78): each path that runs
 * a call fills it at admission, before the call's first I/O, so the
 * dispatcher's fence judges whatever the call then brings back.
 */
interface AdmissionSlot {
  admission?: Admission
}

/** A memory call's live policy fence: what admitted it, and every name its notes go by. */
interface MemoryFence {
  readonly admission: Admission
  /** The note's names and, for a project note's add, its index's: what its writes must pass. */
  readonly names: readonly string[]
  /** The note's own names: the files its outcome comes from. */
  readonly noteNames: readonly string[]
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
  | {
      readonly kind: 'skipped'
      readonly skip: CheckSkip
      readonly detail?: string
      /** The extension's own detail in the user's language, for the row; the model keeps `detail`. */
      readonly visibleDetail?: string
    }
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

/** One wait in a child task's admission (a question, a hook, a popup): its refusal, if any. */
type AdmissionWait = () => Promise<ToolOutcome | undefined>

/** A child task admitted: its grant, and the tools a custom agent keeps (undefined: the session's). */
interface ChildAdmission {
  readonly grant: ChildTaskGrant
  readonly tools: readonly string[] | undefined
}

/** Where a streamed output item stands while its deltas arrive. */
interface OpenItemFields {
  readonly ourId: string
  text: string
  readonly summary: string[]
  /** In the transcript as completed: a later sight of the item only updates it. */
  isCompleted: boolean
  /** The sources the completed reply cited, as the transcript has them (M33). */
  citations: readonly Citation[]
  /** When the item completed (M87, PLAN.md D66): a reply's recorded time, kept with it. */
  recordedAt?: string
}

type OpenItem = OpenItemFields &
  (
    | { readonly kind: 'agentMessage' | 'reasoning' | 'webSearch' }
    | {
        readonly kind: 'argumentPreview'
        readonly call: FunctionCallItem
        readonly preview: ArgumentPreview
        previewAt?: number
      }
  )

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
  'elicitationRequested',
  'elicitationSettled',
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
const EXPANDED_SLASH_NAME = /^\/([\w:-]+)/
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

/** A save's failure is logged by the save queue; its caller has nothing to add. */
const IGNORE_SAVE_FAILURE = (): void => undefined

/** Billable token counts must be safe integers; cached input cannot exceed input. */
function isCountedUsage(usage: Usage): boolean {
  return (
    [
      usage.input_tokens,
      usage.output_tokens,
      usage.input_tokens_details?.cached_tokens ?? 0,
      usage.output_tokens_details?.reasoning_tokens ?? 0,
      usage.total_tokens ?? 0,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) &&
    (usage.input_tokens_details?.cached_tokens ?? 0) <= usage.input_tokens
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

/**
 * A UserPromptSubmit block ends the turn cancelled with the hook's reason, as
 * on Muse Code 1.4.2 (M91 capture run 5), so Interrupt fires for it. Other
 * hook stops still fail the turn.
 */
class HookCancelledError extends Error {
  public constructor(public readonly reason: string) {
    super(reason)
    this.name = 'HookCancelledError'
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

function toolFailure(reason: string, visibleReason = reason): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: visibleReason, failureReason: visibleReason }
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
      output: `Error: ${MODEL_API_MODEL_TEXT.webFetchRestrictedMode}`,
      visibleOutput: UI_TEXT.webFetchRestrictedMode,
      failureReason: UI_TEXT.webFetchRestrictedMode,
    },
    isRejected: true,
  }
}

/** A browser check refused in Restricted Mode (M81): the model's reason, the row's in the user's language. */
function browserCheckRestrictedCall(): CallResult {
  return { outcome: browserCheckRestricted(), isRejected: true }
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
      return `${MODEL_API_MODEL_TEXT.answersPrefix}\n${JSON.stringify(reply.answers)}`
    }
    case 'cancelled': {
      return MODEL_API_MODEL_TEXT.questionCancelledOutput
    }
    case 'clarified': {
      return `${MODEL_API_MODEL_TEXT.clarificationLead}\n${reply.text}`
    }
  }
}

/** A child's result waiting for the parent's next request, with the revision its child ran under. */
interface PendingChildResult {
  readonly childId: string
  readonly text: string
  readonly revision: string | undefined
}

// The child named on a result's second line (`<lead>\n<id>: …`), for a result saved as plain text.
const PENDING_RESULT_CHILD = /^[^\n]*\n([^:\n]+):/

/** A stored pending result; one saved as plain text has no revision, so it is withheld. */
function pendingFromStored(stored: StoredPendingChildResult): PendingChildResult {
  return typeof stored === 'string'
    ? {
        childId: PENDING_RESULT_CHILD.exec(stored)?.[1] ?? SUBAGENT_ID_PREFIX,
        text: stored,
        revision: undefined,
      }
    : { childId: stored.childId, text: stored.text, revision: stored.policyRevision }
}

function storedPending(pending: PendingChildResult): StoredPendingChildResult {
  return {
    childId: pending.childId,
    text: pending.text,
    ...(pending.revision !== undefined && { policyRevision: pending.revision }),
  }
}

/**
 * What an outcome carrying children's results touched (M78, the RV78g
 * review): no file it can name, and each child's work since its spawn, which
 * must still be the file policy's revision.
 */
function childResultsTouched(children: readonly ChildRecord[]): TouchedFiles {
  return { names: [], complete: false, revisions: children.map((child) => child.policyRevision) }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * What an edit-family call did, from its own patch document (M91 lane W):
 * a file it created, or one it changed. Kiro's file triggers run by it
 * (PostFileCreate, PostFileSave); undefined for a call with no patch.
 */
function fileOperationOf(outcome: ToolOutcome): ForeignDispatchContext['fileOperation'] {
  const document = outcome.patch?.document
  if (document === undefined) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(document)
    const files = isPlainRecord(parsed) ? parsed['files'] : undefined
    return Array.isArray(files) &&
      files.some((file: unknown) => isPlainRecord(file) && file['created'] === true)
      ? 'create'
      : 'save'
  } catch {
    return 'save'
  }
}

/** A subagent call refused: the model's reason, and the row's when it has one of its own. */
function subagentFailure(reason: string, visibleReason?: string): ToolOutcome {
  const visible = visibleReason ?? UI_TEXT.agentControlFailed
  return { output: `Error: ${reason}`, visibleOutput: visible, failureReason: visible }
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
  'contributorBlocked',
] as const
type ChildTaskRefusal = (typeof CHILD_TASK_REFUSALS)[number]

function childTaskMessages(kind: ChildTaskRefusal): {
  readonly model: string
  readonly visible: string
} {
  switch (kind) {
    case 'paidOff': {
      return { model: MODEL_API_MODEL_TEXT.subagentPaidOff, visible: UI_TEXT.subagentPaidOff }
    }
    case 'consentDeclined': {
      return {
        model: MODEL_API_MODEL_TEXT.subagentConsentDeclined,
        visible: UI_TEXT.subagentConsentDeclined,
      }
    }
    case 'requestLimit': {
      const limit = SUBAGENT_TASK_MAX_REQUESTS
      return {
        model: fill(MODEL_API_MODEL_TEXT.subagentRequestLimit, { limit }),
        visible: fill(UI_TEXT.subagentRequestLimit, { limit }),
      }
    }
    case 'keyChanged': {
      return { model: MODEL_API_MODEL_TEXT.subagentKeyChanged, visible: UI_TEXT.subagentKeyChanged }
    }
    case 'modelChanged': {
      return {
        model: MODEL_API_MODEL_TEXT.subagentModelChanged,
        visible: UI_TEXT.subagentModelChanged,
      }
    }
    case 'goalEnded': {
      return { model: MODEL_API_MODEL_TEXT.subagentGoalEnded, visible: UI_TEXT.subagentGoalEnded }
    }
    case 'tariffUnknown': {
      return {
        model: MODEL_API_MODEL_TEXT.subagentTariffUnknown,
        visible: UI_TEXT.subagentTariffUnknown,
      }
    }
    case 'planMode': {
      return { model: MODEL_API_MODEL_TEXT.subagentPlanMode, visible: UI_TEXT.subagentPlanMode }
    }
    case 'webSearchOff': {
      return {
        model: MODEL_API_MODEL_TEXT.subagentWebSearchOff,
        visible: UI_TEXT.subagentWebSearchOff,
      }
    }
    case 'contributorBlocked': {
      return {
        model: MODEL_API_MODEL_TEXT.subagentContributorBlocked,
        visible: UI_TEXT.subagentContributorBlocked,
      }
    }
  }
}

function childTaskFailure(kind: ChildTaskRefusal): ToolOutcome {
  const { model, visible } = childTaskMessages(kind)
  return { output: `Error: ${model}`, visibleOutput: visible, failureReason: visible }
}

/** A refused tool call, with the user's answer when they gave one. */
/** What the Auto reviewer made of an ask (M78): run the call, or show the card with why. */
type ReviewedAsk =
  | { readonly decision: 'allow' }
  | { readonly decision: 'ask'; readonly note: string | undefined; readonly judgeCaution?: boolean }

/** Why a card asks beyond the mode, as the card says under the command (M78). */
function cardNote(judgement: PermissionJudgement | undefined): string | undefined {
  if (judgement?.settledBy === 'profile') {
    return UI_TEXT.approvalProfileNote
  }
  if (judgement?.settledBy !== 'askRule') {
    return undefined
  }
  const why = judgement.rule?.justification?.trim() ?? ''
  return why === '' ? UI_TEXT.approvalAskRuleNote : fill(UI_TEXT.approvalAskRuleWhy, { why })
}

/** A shell command a forbid rule refused (M78): the model hears the rule's reason, if it has one. */
function refusedByRule(call: FunctionCallItem, judgement: PermissionJudgement): ToolOutcome {
  const why = judgement.rule?.justification?.trim() ?? ''
  return toolFailure(
    `${call.name} ${MODEL_API_MODEL_TEXT.toolRefusedByRule}${why === '' ? '' : `: ${why}`}`,
  )
}

/** A path the permission settings deny the file tools (M78). */
function deniedPath(display: string): ToolOutcome {
  return toolFailure(`${display} ${MODEL_API_MODEL_TEXT.pathDeniedByPolicy}`)
}

/** A refused PostToolUseFailure correction names its reason for the model (M91). */
function refusedCorrection(reason: string): { ok: false; reason: string } {
  return { ok: false, reason: fill(UI_TEXT.hookCorrectionRefused, { reason }) }
}

/** A call the permission settings stopped allowing at its I/O (M78): the model's reason, the row's in the user's language. */
function policyChangedRefusal(toolName: string): ToolOutcome {
  return {
    output: `Error: ${toolName} ${MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange}`,
    visibleOutput: UI_TEXT.policyChangedRefused,
    failureReason: UI_TEXT.policyChangedRefused,
  }
}

/**
 * The dispatcher's refusal of an outcome whose call had already written
 * (M78): nothing it brought back reaches the model, which is told the
 * change stays; the row keeps the change's patch, so it can be seen and
 * reverted.
 */
function policyChangedAfterWrite(toolName: string, written: ToolOutcome): ToolOutcome {
  return {
    output: `Error: ${toolName} ${MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange}${MODEL_API_MODEL_TEXT.policyChangeKeptWrite}`,
    visibleOutput: UI_TEXT.policyChangedKeptWrite,
    failureReason: UI_TEXT.policyChangedKeptWrite,
    ...(written.patch !== undefined && { patch: written.patch }),
  }
}

/** Whether an outcome reports a write its call already made (M78): a patch, or a write that did not fail. */
function hasWritten(admission: Admission, outcome: ToolOutcome): boolean {
  const { toolClass } = admission.query
  return (
    outcome.patch !== undefined ||
    (outcome.failureReason === undefined && (toolClass === 'edit' || toolClass === 'paid'))
  )
}

function refusedOutcome(
  call: FunctionCallItem,
  feedback: string | undefined,
  isDeniedByHook = false,
): ToolOutcome {
  const reason = `${call.name} ${isDeniedByHook ? MODEL_API_MODEL_TEXT.toolRejectedByHook : MODEL_API_MODEL_TEXT.toolRejectedByUser}`
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

/** The name a tool allowlist matches: the function name, or the hosted search's own type. */
function toolNameOf(definition: ToolDefinition): string {
  return definition.type === 'function' ? definition.name : definition.type
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
  return `${MODEL_API_MODEL_TEXT.skillInvoked} "${skill.id}". ${MODEL_API_MODEL_TEXT.skillArguments} ${args ?? MODEL_API_MODEL_TEXT.skillNoArguments}\n\n${skillBodyForModel(skill)}`
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

/** A shell call's kept-directory tracking (M91 lane S, PLAN.md D70). */
interface ShellDirectoryTracking {
  /** False runs the user's command untouched at the workspace root, as before. */
  readonly tracked: boolean
  /** The arguments executeTool sees: the user's command plus the trailer when tracked. */
  readonly argsJson: string
  /** The command's start directory: the kept one when tracked. */
  readonly cwd: string | undefined
  /** The session's side file the trailer reports to. */
  readonly sideFile: string
  /** The report nonce this call's trailer writes. */
  readonly sequence: number
}

// The shell's per-session side files under the temp dir (M91 lane S): one
// `<session>.<object>.cwd` file per live session object, holding the last
// call's sequence and final directory. A call whose trailer never ran leaves
// a stale sequence, which reads back as "no report".
const SHELL_SIDECAR_DIR = 'muse-spark-shell'
/** What never names a side file: the rest of a session id is replaced. */
const SIDECAR_UNSAFE = /[^A-Za-z0-9_-]/g

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
  private lastJudgeBody: CreateResponseBody | undefined
  private readonly listeners = new Set<SessionEventListener>()
  private readonly replay: ReplayItem[] = []
  private readonly transcript: TranscriptItem[] = []
  /** Display rows only; consumed by runCall, never included in the request body. */
  private readonly argumentPreviewRows = new Map<string, ItemSnapshot>()
  private readonly argumentPreviewTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; flush: () => void }
  >()
  private readonly turnIds: string[] = []
  /** The real last turn summarized by an accepted compaction, not inferred from replay gaps. */
  private compactedThroughTurnId: string | undefined
  private readonly outputs = new Map<string, string>()
  private readonly permissions: PermissionEngine
  /** The command rules and permission profile as the settings stand (M78). */
  private readonly policies: PolicyCache
  /** The Auto reviewer's circuit breaker, reset by each message the user sends (M78). */
  private readonly reviewBreaker = new ReviewBreaker()
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
  private repoMapPolicy: PermissionPolicy['files'] | undefined
  private repoMapTries = 0
  /**
   * The shell's kept directory (M91 lane S, PLAN.md D70): the canonical
   * absolute path the last shell call ended in, or undefined at the
   * workspace root. Per session: a new session starts at the root, and a
   * child task keeps its own. Never a path outside the workspace: one
   * reported there resets to the root with a note to the model.
   */
  private keptShellDir: string | undefined
  /** The shell call sequence, nonce for the session's side-file reports. */
  private shellCallSequence = 0
  /** The session's side-file folder, made on the first tracked call. */
  private shellSidecarMade = false
  /** The session's side file, removed when the session is disposed. */
  private shellSidecarFile: string | undefined
  /**
   * This session object's side-file token (M91 lane S): two live surfaces on
   * one session (PLAN.md D25) must not share a report file, even with the
   * same session id and sequence.
   */
  private readonly shellSidecarToken = randomUUID()
  private readonly judgeCardFences = new Map<string, JudgeFence>()
  private readonly pendingApprovals = new Map<string, Pending<ApprovalDecision>>()
  /** Live cards for a second surface joining while a decision is still pending. */
  private readonly pendingApprovalEvents = new Map<
    string,
    Extract<AgentEvent, { type: 'approvalRequested' }>
  >()
  private readonly pendingQuestions = new Map<string, Pending<QuestionReply>>()
  /**
   * Elicitation forms waiting on the user (M91 lane M): the fields the
   * answer is validated against, and the server that asked, so a refusal
   * can name the field without ever holding a value.
   */
  private readonly pendingElicitations = new Map<
    string,
    {
      readonly pending: Pending<ElicitationContent>
      readonly fields: readonly ElicitationField[]
      readonly server: string
    }
  >()
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
  private readonly pendingChildResults: PendingChildResult[] = []
  /** The contributor-tier models the user said yes to for an agent's run, in this session (M76). */
  private readonly confirmedContributorModels = new Set<string>()
  private childTaskGrant: ChildTaskGrant | undefined
  /**
   * A child's top turn (M86, spec 3.2): the parent's turn that spawned it,
   * whose recording decision each of the child's turns inherits.
   */
  private topTurn: TopTurn | undefined
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
    this.deps.notePaidUse('subagents', 1)
  }
  private active: ActiveTurn | undefined
  private readonly interruptedWork = new WeakSet<AbortController>()
  /** Interrupt survives the turn's abort, but never the session's lifetime. */
  private readonly interruptLifetime = new AbortController()
  /** Each file as the model last read or wrote it, for `write_file`'s check (D27). */
  private readonly seenFiles = new Map<string, string>()
  /** Each edited file's diagnostics at its last check, to say what changed (M68). */
  private readonly diagnosticsHistory = new DiagnosticsHistory()
  /** The verify loop's record since the user's last input (M68; `verifyLedger.ts`). */
  private readonly ledger = new VerifyLedger()
  /** Rename plans made for a call's PreToolUse hooks, which the call then writes (M67). */
  private readonly hookRenamePlans = new WeakMap<FunctionCallItem, Promise<RenamePlanResult>>()
  /** The imported hooks' adapters, loaded on first use (M91 lane W). */
  private foreignAdapter: Promise<ForeignHookAdapter | undefined> | undefined
  /** A SubagentStop hook's documented replacement of this child's reply, by turn (M91). */
  private readonly hookReplies = new Map<string, string>()
  /** FileChanged's per-path quiet window and per-minute cap (M91 lane E). */
  private readonly fileChangedThrottle: FileChangedThrottle = createFileChangedThrottle()
  /**
   * A BeforeToolSelection hook's narrowing for one turn (M91 lane E): the
   * declared tool list never changes, admission refuses the rest. Keyed by
   * turn so a stale narrowing cannot leak into the next turn.
   */
  private toolSelection:
    { readonly turnId: string; readonly allowed: readonly string[] } | undefined
  /**
   * Consecutive TaskCreated/TaskCompleted refusals (M91 lane E): past
   * `HOOK_MAX_STOP_CONTINUATIONS` the turn ends; no refused task is admitted.
   */
  private taskRefusals = 0
  private readonly observedRules = new Set<string>()
  private readonly teammateKeeps = new Map<string, number>()
  private hookTokensAdded = 0
  /** Keeps each request within the page and encoded-media budgets (M54, PLAN.md D47). */
  private readonly budget: MediaBudget
  /** Packed tool outputs and the savings ledger (M73): undefined unless packing is on. */
  private readonly packing: ObservationPack | undefined
  /**
   * The ledger total a resumed session brought (M73), kept so a save keeps
   * it even where this session does not pack; a packing session's store
   * carries it on instead.
   */
  private restoredPackedTokens: number | undefined
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
  /**
   * Dollars this conversation spent at list price (M82), kept with the
   * session: every response that reported usage (a turn's, a failed one's,
   * a compaction's), each child task's as it reports (their consent is
   * separate, D48, so they are never reserved), and the whole reservation
   * of a request whose response began but never reported. A child session
   * keeps none of its own.
   */
  private budgetSpentUsd = 0
  private hasUnknownBudgetCost = false
  private budgetIsFreshFork = false
  private budgetAccountId: string | undefined
  private budgetWrites: Promise<void> = Promise.resolve()
  private turnCostUsd = 0
  /** The last reported request, which the next estimate starts from (M82). */
  private budgetBase: BudgetBase | undefined
  private modelRevision = 0
  /** The reservation of the request in flight, until its usage is reported or it ends (M82). */
  private openReservation: OpenReservation | undefined
  /** What the requests since the last reply line used (M82), for the next line. */
  private unshownUsage: ReplyUsageTally | undefined
  /**
   * The model the request in flight was sent to (M82): its usage is priced
   * at that model's rates, whatever the session switched to meanwhile.
   */
  private sendingModelId: string | undefined
  /** Turns and compactions still running, by id: a closing window waits for them to save (M82). */
  private readonly unsettled = new Map<number, Promise<void>>()
  private workCount = 0
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
  /** Built from an imported file, or forked from such a session (M84, PLAN.md D49). */
  public imported = false

  public constructor(
    public readonly sessionId: string,
    modelId: string,
    approvalMode: ApprovalMode,
    private readonly deps: ModelApiHostDeps,
    private readonly onChanged: () => void,
    private readonly onPersisted: (kind?: 'budget' | 'refund') => Promise<void>,
    private readonly onDispose: () => void,
    private readonly isHostClosing: () => boolean,
    private readonly isSubagent = false,
    private readonly parentSession?: ModelApiSession,
    private readonly childSubagentId?: string,
    private readonly hooks: readonly HookDefinition[] = [],
    private readonly hookStartSource: 'startup' | 'resume' | 'fork' = 'startup',
    private readonly isSideChat = false,
    private readonly workspaceEdits = new WorkspaceEdits(),
    private readonly agent?: AgentRuntime,
    /** A child task whose role is `reviewer` (M70): every turn runs as the Reviewer. */
    private readonly isReviewerChild = false,
    /**
     * The session's spark-hooks.json snapshot (M91 lane E): same trust gate
     * and opt-in as `hooks`, empty with the opt-in off. A child shares its
     * parent's snapshot.
     */
    private readonly extensionHooks: readonly ExtensionHookDefinition[] = [],
  ) {
    this.workspaceEdits.add(this.ledger)
    this.modelId = modelId
    this.permissions = new PermissionEngine(approvalMode)
    this.policies = new PolicyCache(
      deps.permissionSettings ?? (() => NO_PERMISSION_SETTINGS),
      deps.platform,
    )
    this.budget = new MediaBudget(deps.mediaBudgetMaxEncodedChars)
    if (agent !== undefined) {
      this.effort = agent.effort
    }
    // Packing is a full session's own store (its originals); a subagent's
    // calls are its parent's conversation to pack, never its own.
    this.packing =
      !isSubagent && deps.observationPacking?.() === true ? new ObservationPack() : undefined
    const { memory } = deps
    this.context = new WorkspaceContext({
      io: deps.contextIo,
      workspaceRoot: deps.workspaceRoot,
      platform: deps.platform,
      personalSkillsRoot: deps.personalSkillsRoot,
      bundledSkills: deps.bundledSkills,
      personalAgentsRoot: deps.personalAgentsRoot,
      // A child cannot spawn, so it reads no agents (M76).
      hasAgents: !isSubagent,
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
    const safe = redactDiagnosticEvent(event)
    for (const listener of this.listeners) {
      listener(safe)
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
      this.hookTokensAdded += estimatePackTokens(context.length)
      this.replay.push({
        turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: context }],
        },
      })
    }
    if (contexts.length > 0) this.emitUsage()
  }

  /** The hooks that run for this session: none in a side chat or with the opt-in off (M51). */
  private enabledHooks(): readonly HookDefinition[] {
    return this.isSideChat || this.deps.isHooksEnabled?.() === false ? [] : this.hooks
  }

  /**
   * Lane P's adapters for imported hooks (M91 lane W), from their own bundle
   * (dist/foreignHooks.js, D6), loaded the first time this session runs a
   * hook while it holds one. One per session: a Cursor stop script's loop
   * count lives as long as the conversation. Undefined when the bundle cannot
   * load: the imported hooks are then skipped, said in the log.
   */
  private async foreignHookAdapter(): Promise<ForeignHookAdapter | undefined> {
    this.foreignAdapter ??= (async () => {
      try {
        const entry = await import('./foreignHooksEntry.js')
        const exported: unknown = entry.createForeignHookAdapter
        if (typeof exported !== 'function') throw new Error('Invalid hook adapter export')
        const create: typeof CreateForeignHookAdapter = entry.createForeignHookAdapter
        const plugins = this.deps.pluginHooks
        return create({
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
          io: this.deps.io,
          homeDir: homedir(),
          ...(this.deps.hookMatcherTimeoutMs !== undefined && {
            matcherTimeoutMs: this.deps.hookMatcherTimeoutMs,
          }),
          ...(plugins !== undefined && {
            plugins: {
              env: plugins.env(),
              containment: plugins.containment,
              warn: (message: string) => {
                this.deps.log.warn(`Model API hooks: ${message}`)
              },
              // A plugin child is a process the running turn started (M86).
              onProcess: () => {
                this.noteProcessRan()
              },
              now: () => this.deps.now(),
            },
          }),
        })
      } catch {
        this.deps.log.warn('Model API hooks: the imported-hook adapters could not be loaded')
        return
      }
    })()
    return await this.foreignAdapter
  }

  /**
   * The hook and MCP-form runtime (dist/hookRuntime.js, M91, D6): lane E's
   * dispatcher, lane H's typed handlers and lane M's form checks, loaded the
   * first time this session needs one. A bundle that cannot load rejects,
   * and each caller fails its own safe way: a hook is skipped and logged, a
   * form is refused, never accepted.
   */
  private async hookRuntime(): Promise<typeof HookRuntime> {
    return await import('./hookRuntimeEntry.js')
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
      this.judgementWithHook({ toolName: call.name, toolClass: 'edit' }, false).verdict === 'deny'
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
    foreignContext?: ForeignDispatchContext,
  ): Promise<HookDispatch> {
    const runHook = this.deps.io.runHook?.bind(this.deps.io)
    const hooks = this.enabledHooks()
    const adapter = hooks.some((hook) => hook.foreign !== undefined)
      ? await this.foreignHookAdapter()
      : undefined
    const runHookHttp = this.deps.io.runHookHttp?.bind(this.deps.io)
    const result = await dispatchHooks(
      hooks,
      event,
      this.hookPayload(event, turnId, fields),
      matcher,
      // A hook's command is a process the running turn started (M86).
      runHook === undefined
        ? {}
        : {
            runHook: async (...args: Parameters<typeof runHook>) => {
              this.noteProcessRan()
              return await runHook(...args)
            },
          },
      signal,
      (warning) => {
        this.deps.log.warn(`Model API hooks: ${warning}`)
      },
      // M91 typed handlers (D70, lane H): the http POST over the host's
      // pinned path when wired, the MCP tool call through its own approval
      // path, the allowlist setting, and the trust posture re-checked at
      // every run. Absent runners skip their handlers. The runner itself
      // loads with the hook runtime on the first typed handler.
      {
        runTyped: async (...args) => {
          const runtime = await this.hookRuntime()
          return await runtime.runTypedHandler(...args)
        },
        ...(runHookHttp !== undefined && {
          httpPost: async (url, payload, hookSignal) => {
            this.noteProcessRan()
            return await runHookHttp(url, payload, hookSignal)
          },
        }),
        callMcpTool: async (server, tool, argsJson, hookSignal) => {
          this.noteProcessRan()
          return await this.runHookMcpTool(server, tool, argsJson, hookSignal)
        },
        runModelTurn: async (input, hookSignal) => {
          this.noteProcessRan()
          return await this.runHookModelTurn(
            input.kind,
            input.system,
            input.user,
            event,
            hookSignal,
          )
        },
        httpAllowlist: () => this.deps.hookHttpAllowedHosts?.() ?? [],
        isNetworkAllowed: () =>
          this.deps.isWorkspaceTrusted() && this.deps.isHookNetworkAllowed?.() === true,
        isHookModelsOn: () => this.deps.isPaidFeatureOn('hookModels'),
        allowsHookModelUse: (request) =>
          this.deps.allowsPaidUse(
            {
              feature: 'hookModels',
              event: request.event,
              kind: request.kind,
              modelId: request.modelId,
              ...(this.deps.hookModelDailyBudget !== undefined && {
                dailyBudgetUsd: this.deps.hookModelDailyBudget.capUsd(),
              }),
            },
            false,
            this.askingSessionId,
          ),
        noteHookModelRun: () => {
          this.deps.notePaidUse('hookModels', 1)
        },
        noteHookModelUsage: this.deps.noteHookModelUsage,
        modelId: this.modelId,
      },
      adapter,
      foreignContext,
      event === 'Interrupt'
        ? (execution) => {
            this.track(execution, false)
          }
        : undefined,
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

  /**
   * Muse Code's Interrupt (1.4.0, captured in docs/certification/m91.md): an
   * async-only observation fired when a running turn or compaction is
   * cancelled, never on an idle close or after its terminal is selected.
   * Session-owned async work survives the turn abort; answers apply nothing.
   */
  private fireInterrupt(): void {
    const work = this.active?.abort ?? this.compacting
    const turnId = this.active?.turnId ?? this.turnIds.at(-1)
    if (
      work === undefined ||
      turnId === undefined ||
      this.active?.isFinalizing === true ||
      this.interruptedWork.has(work)
    ) {
      return
    }
    this.interruptedWork.add(work)
    this.track(
      this.runHooks(
        'Interrupt',
        turnId,
        {},
        undefined,
        this.interruptLifetime.signal,
        false,
        false,
      ),
      false,
    )
  }

  /** The extension hooks that run for this session: none in a side chat or with the opt-in off. */
  private enabledExtensionHooks(): readonly ExtensionHookDefinition[] {
    return this.isSideChat ||
      !this.deps.isWorkspaceTrusted() ||
      this.deps.isHooksEnabled?.() === false
      ? []
      : this.extensionHooks
  }

  private extensionHookContext(turnId: string | undefined): ExtensionHookContext {
    return {
      sessionId: this.sessionId,
      workspaceRoot: this.deps.workspaceRoot,
      modelId: this.modelId,
      permissionMode: this.permissions.currentMode,
      ...(turnId !== undefined && { turnId }),
    }
  }

  /**
   * Fire one extension event (M91 lane E). Hook context goes at the tail of
   * the turn's replay only (SoL-Pi rule 2); without a turn there is nowhere
   * for it, so it is dropped. Messages are shown as notices either way.
   * Undefined when no extension hook is configured, so the hooks-off path
   * stays byte-identical (SoL-Pi rule 7). A caller that places the contexts
   * itself (AfterAgentThought's tail merge) passes `shouldReplayContexts` false, so
   * each context is replayed exactly once.
   */
  private async fireExtensionHooks(
    event: ExtensionHookEvent,
    turnId: string | undefined,
    fields: Readonly<Record<string, unknown>>,
    matcherValue: string | undefined,
    signal: AbortSignal | undefined,
    shouldReplayContexts = true,
  ): Promise<ExtensionHookDispatch | undefined> {
    const hooks = this.enabledExtensionHooks()
    if (hooks.length === 0) {
      return undefined
    }
    let runtime: typeof HookRuntime
    try {
      runtime = await this.hookRuntime()
    } catch {
      this.deps.log.warn(
        `Model API extension hooks: ${event}: the hook runtime could not be loaded; no hook ran`,
      )
      return emptyExtensionDispatch()
    }
    const runHook = this.deps.io.runHook?.bind(this.deps.io)
    const result = await runtime.dispatchExtensionHooks({
      hooks,
      event,
      payload: extensionHookPayload(event, this.extensionHookContext(turnId), fields),
      matcherValue,
      // A hook's command is a process the running turn started (M86).
      io:
        runHook === undefined
          ? {}
          : {
              runHook: async (...args: Parameters<typeof runHook>) => {
                this.noteProcessRan()
                return await runHook(...args)
              },
            },
      cwd: this.deps.workspaceRoot,
      signal,
      warn: (warning) => {
        this.deps.log.warn(`Model API extension hooks: ${warning}`)
      },
      isAllowed: () => this.enabledExtensionHooks().length > 0 && !this.isDisposed,
    })
    for (const message of result.messages) {
      this.emit({ type: 'backendNotice', level: 'info', text: message })
    }
    if (turnId !== undefined && shouldReplayContexts) {
      this.appendHookContexts(turnId, result.contexts)
    }
    return result
  }

  /** A BeforeToolSelection narrowing for this turn, if a hook set one. */
  private toolSelectionFor(turnId: string): readonly string[] | undefined {
    return this.toolSelection?.turnId === turnId ? this.toolSelection.allowed : undefined
  }

  /**
   * Narrow the offered tools for this request (M91 lane E): BeforeToolSelection
   * sees the declared tools and answers a subset, enforced at call admission.
   * The declared list never changes (SoL-Pi rule 1): a filtered declaration
   * would lie to the next request's prefix check. A tool-less request has
   * nothing to narrow, so hooks stay quiet and cannot clobber the turn.
   */
  private async selectToolsForTurn(
    turnId: string,
    body: CreateResponseBody,
    signal: AbortSignal,
  ): Promise<void> {
    const offered = body.tools.map((tool) => (tool.type === 'function' ? tool.name : tool.type))
    if (offered.length === 0) {
      return
    }
    this.toolSelection = undefined
    const selected = await this.fireExtensionHooks(
      'BeforeToolSelection',
      turnId,
      beforeToolSelectionFields(offered),
      undefined,
      signal,
    )
    const allowed = selected?.allowedTools
    if (allowed === undefined) return
    this.toolSelection = { turnId, allowed: allowed.filter((name) => offered.includes(name)) }
    const blockedHosted = body.tools.find(
      (tool) => tool.type !== 'function' && !allowed.includes(tool.type),
    )
    if (blockedHosted !== undefined)
      throw new HookStoppedError(`${blockedHosted.type}: ${UI_TEXT.hookToolRemoved}`)
    const removed = offered.filter((name) => !this.toolSelection?.allowed.includes(name))
    if (removed.length > 0) {
      this.appendHookContexts(turnId, [
        `${MODEL_API_MODEL_TEXT.hookToolsUnavailable} ${removed.join(', ')}`,
      ])
    }
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
    await this.selectToolsForTurn(turnId, body, signal)
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
          canReadFile: (file) =>
            !this.isDisposed &&
            !this.isHostClosing() &&
            !this.policy().files.isDenied([file.relative, file.canonical]),
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
    if (this.isSubagent) return this.parentSession?.promptRepoMap()
    return this.repoMapPolicy === this.policy().files ? this.repoMapText : undefined
  }

  /**
   * The repo map for the prompt (M67) while the setting is on. Never throws:
   * a map that cannot be made is logged and the prompt goes without it. Only
   * a map with text is kept; a try that failed or came out empty counts, and
   * after `REPO_MAP_PROMPT_TRIES` the session stops trying. A Stop ends the
   * lookups at once and does not count. A child task never builds one.
   */
  private async loadRepoMap(signal: AbortSignal): Promise<void> {
    const policy = this.policy().files
    if (this.repoMapPolicy !== policy) {
      this.repoMapPolicy = policy
      this.repoMapText = undefined
      this.repoMapTries = 0
    }
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

  /**
   * Completed children's results into the replay, each only while the file
   * policy is still the revision its child was spawned under (M78, the RV78g
   * review): a result quotes what its child read, and a deny or trust change
   * since withholds it, after a resume too. The model is told it was.
   */
  private drainChildResults(): void {
    for (const pending of this.pendingChildResults.splice(0)) {
      const text = this.isRevisionCurrent([pending.revision])
        ? pending.text
        : `${MODEL_API_MODEL_TEXT.subagentResult}\n${pending.childId}: ${MODEL_API_MODEL_TEXT.subagentResultWithheld}`
      this.replay.push({
        turnId: this.turnIds.at(-1) ?? this.sessionId,
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      })
    }
  }

  /**
   * Whether the model answers as the Reviewer now (M70): a `/review` turn, or
   * a child task whose role is `reviewer` and that names no custom agent (a
   * named agent's own prompt, tools and mode govern its run, M76).
   */
  private isReviewing(): boolean {
    return (this.isReviewerChild && this.agent === undefined) || this.active?.isReview === true
  }

  /**
   * The body as the session budget lets it be sent (M82): with a cap, its
   * input estimated high from the last reported request and
   * `max_output_tokens` lowered so input plus output at list price fits
   * what is left, the reservation held open until the response reports.
   * Throws `SessionBudgetExceededError` when it cannot fit: it is not sent,
   * and the turn stops with the reason. Child tokens are counted when
   * reported, but their separately consented requests are not reserved
   * against the parent's cap (M82 owner decision).
   */
  private budgeted(body: CreateResponseBody): CreateResponseBody {
    this.openReservation = undefined
    if (this.isSubagent) return body
    const capUsd = this.currentBudgetCap()
    if (capUsd <= 0 && this.budgetJournal() === undefined) {
      return body
    }
    const estimate = estimateInput(requestParts(body), this.budgetBase)
    const maxOutputTokens = body.max_output_tokens
    const reservation =
      capUsd > 0
        ? reserveRequest({
            capUsd,
            spentUsd: this.budgetSpentUsd,
            estimatedInputTokens: estimate.inputTokens,
            modelId: body.model,
          })
        : {
            estimatedInputTokens: estimate.inputTokens,
            maxOutputTokens,
            costUsd: estimateCostUsd(
              { inputTokens: estimate.inputTokens, outputTokens: maxOutputTokens, cachedTokens: 0 },
              body.model,
            ),
          }
    this.openReservation = {
      ...reservation,
      modelId: body.model,
      modelRevision: this.modelRevision,
      goalRevision: this.goalCommandRevision,
      isWorkspaceTrusted: this.deps.isWorkspaceTrusted(),
      paidFeatures: PAID_FEATURES.filter((feature) => this.deps.isPaidFeatureOn(feature)),
      hasCap: capUsd > 0,
      hasUnknownCost: modelApiPaidTier(body.model) === undefined,
      hasAmbiguousAttempt: false,
      accountId: undefined,
      isReserved: false,
      claim: undefined,
      parts: estimate.parts,
      hasStarted: false,
      isSent: false,
      isRefused: false,
    }
    return capUsd > 0 ? { ...body, max_output_tokens: reservation.maxOutputTokens } : body
  }

  /**
   * The request about to be sent (M82): its model, which prices its usage,
   * and its reservation, as the log keeps it.
   */
  private sending(body: CreateResponseBody): OpenReservation | undefined {
    this.sendingModelId = body.model
    const reservation = this.openReservation
    if (reservation?.hasCap === true) {
      this.deps.log.info(
        `Session budget: request reserved for ${String(reservation.estimatedInputTokens)} input and ${String(reservation.maxOutputTokens)} output tokens`,
      )
    }
    return reservation
  }

  /** A capped request never reaches fetch before its possible charge is durable. */
  private async persistReservation(reservation: OpenReservation | undefined): Promise<void> {
    if (reservation === undefined) {
      return
    }
    reservation.accountId = this.deps.budgetScope?.accountId ?? this.budgetOwner().budgetAccountId
    if (reservation.accountId === undefined) {
      throw new MissingApiKeyError()
    }
    const journal = this.budgetJournal()
    if (journal === undefined) {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
    reservation.claim = await journal.reserve(
      this.deps.budgetScope?.sessionId ?? this.budgetOwner().sessionId,
      reservation.accountId,
      reservation.costUsd,
      {
        isUnbounded: !reservation.hasCap,
        hasUnknownCost: reservation.hasUnknownCost,
      },
    )
    reservation.isReserved = true
    if (this.deps.budgetScope === undefined) {
      await this.onPersisted('budget')
    }
  }

  private budgetOwner(): ModelApiSession {
    return this.parentSession?.budgetOwner() ?? this
  }

  private currentBudgetCap(): number {
    return this.isSubagent ? 0 : (this.deps.budgetScope?.capUsd() ?? this.deps.sessionBudgetUsd())
  }

  private budgetJournal(): SessionStore['budget'] {
    return this.deps.budgetScope?.journal ?? this.deps.store?.budget
  }

  /** Read shared spending before computing any new request's allowance. */
  private async refreshBudgetSpend(): Promise<void> {
    await this.budgetWrites
    const owner = this.budgetOwner()
    const scope = this.deps.budgetScope
    const accountId = await this.deps.getAccountId()
    if (
      accountId === undefined ||
      (owner.budgetAccountId !== undefined && owner.budgetAccountId !== accountId) ||
      (scope !== undefined && (scope.accountId !== accountId || !scope.isStillAllowed(accountId)))
    ) {
      throw new MissingApiKeyError()
    }
    owner.budgetAccountId = accountId
    const journal = this.budgetJournal()
    if (journal === undefined) {
      if (this.currentBudgetCap() > 0) {
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      }
      return
    }
    if (scope === undefined) {
      await this.onPersisted('budget')
    }
    const total = await journal.read(scope?.sessionId ?? owner.sessionId, accountId)
    owner.budgetIsFreshFork = false
    if (this.currentBudgetCap() > 0 && total.hasUnknownHistoricalFees) {
      throw new Error(UI_TEXT.sessionBudgetLegacyFeesUnknown)
    }
    this.budgetSpentUsd = total.spentUsd
    owner.hasUnknownBudgetCost = total.hasUnknownHistoricalFees
  }

  /** Each charge owns its journal entry; another host's snapshot cannot erase it. */
  private recordBudgetCost(
    costUsd: number,
    claim: SessionBudgetClaim | undefined,
    hasUnknownCost = false,
  ): void {
    if (costUsd === 0 && claim === undefined && !hasUnknownCost) {
      return
    }
    const owner = this.budgetOwner()
    const journal = this.budgetJournal()
    const scope = this.deps.budgetScope
    const accountId = scope?.accountId ?? owner.budgetAccountId
    if (journal === undefined || accountId === undefined) {
      return
    }
    const previous = this.budgetWrites
    const write = (async () => {
      await previous
      const total =
        claim === undefined
          ? await journal.record(
              scope?.sessionId ?? owner.sessionId,
              accountId,
              costUsd,
              hasUnknownCost,
            )
          : await claim.settle(costUsd, hasUnknownCost)
      this.budgetSpentUsd = total.spentUsd
      owner.hasUnknownBudgetCost = total.hasUnknownHistoricalFees
      this.touch()
    })()
    this.budgetWrites = write
    // The request awaits this same rejection before any further admission;
    // attach a handler now because stream events cannot await persistence.
    void write.catch(() => {
      this.deps.log.warn('Session spend was not saved')
    })
  }

  /**
   * A request ended (M82). One still reserved reported no usage: when its
   * request went out, Meta may have run it, so its whole reservation counts
   * as spent. One that never went out, or that Meta explicitly refused
   * before its response began, cost nothing.
   */
  private async endRequest(): Promise<void> {
    const reservation = this.openReservation
    this.openReservation = undefined
    this.sendingModelId = undefined
    if (reservation === undefined) {
      await this.budgetWrites
      return
    }
    const costUsd =
      reservation.hasAmbiguousAttempt || (reservation.isSent && !reservation.isRefused)
        ? reservation.costUsd
        : 0
    if (costUsd > 0) {
      this.budgetSpentUsd += reservation.costUsd
      this.warnUnknownCharge(costUsd)
      this.deps.log.warn(
        `Session budget: a response ended without its usage; its reservation of ${String(reservation.costUsd)} USD counts as spent`,
      )
    }
    this.recordBudgetCost(costUsd, reservation.claim, costUsd > 0 && !reservation.hasCap)
    await this.budgetWrites
    // The on-disk liability is now settled or released, even if this request failed before a frame.
    if (this.deps.budgetScope === undefined) {
      await this.onPersisted('refund')
    }
  }

  /** A conservative liability is visible without presenting it as verified billing. */
  private warnUnknownCharge(costUsd: number): void {
    this.emit({
      type: 'backendNotice',
      level: 'warning',
      text: fill(UI_TEXT.sessionBudgetUnknownCharge, { amount: formatUsd(costUsd) }),
    })
  }

  private noteRequestRefusal(reservation: OpenReservation | undefined, error: unknown): void {
    if (reservation !== undefined) {
      reservation.isRefused =
        !reservation.hasStarted &&
        error instanceof ModelApiError &&
        (error.status === HTTP_STATUS.badRequest || error.status === HTTP_TOO_MANY_REQUESTS)
    }
  }

  /**
   * Keeps `work` (a turn, a compaction) until it ends, so a closing window
   * can wait for a stopped turn to charge and save what it spent (M82).
   * `isFailureCallers`: its caller awaits it and sees a failure.
   */
  private track(work: Promise<unknown>, isFailureCallers: boolean): void {
    this.workCount += 1
    const id = this.workCount
    this.unsettled.set(id, this.completion(work, id, isFailureCallers))
  }

  private async completion(
    work: Promise<unknown>,
    id: number,
    isFailureCallers: boolean,
  ): Promise<void> {
    try {
      await work
    } catch (error: unknown) {
      // A turn reports its own failures, so one that reaches here is a fault.
      if (!isFailureCallers) {
        this.deps.log.error(`A Model API turn failed unexpectedly: ${describe(error)}`)
      }
    } finally {
      this.unsettled.delete(id)
    }
  }

  /** What this request may offer: the shell and memory need trust, skills need loading. */
  private toolFlags(): {
    readonly hasShell: boolean
    readonly hasSkills: boolean
    readonly hasMemory: boolean
  } {
    const hasShell = this.deps.isWorkspaceTrusted()
    return {
      hasShell,
      hasSkills: this.context.sections().skills.length > 0,
      // Memory is the workspace context's (D13): offered in a trusted workspace only (D41).
      hasMemory: hasShell && this.deps.memory !== undefined,
    }
  }

  /** The effective child tool names, for a custom agent's allowlist to meet (M76). */
  private offeredToolNames(): readonly string[] {
    const flags = this.toolFlags()
    return this.tools(flags.hasShell, flags.hasSkills, flags.hasMemory, true).map((tool) =>
      toolNameOf(tool),
    )
  }

  /** The agent's own instructions and tools, or the Reviewer's. */
  private promptAndTools(
    today: string,
    hasPackedRecall: boolean,
  ): {
    readonly instructions: string
    readonly tools: readonly ToolDefinition[]
  } {
    const context = this.context.sections()
    const environment = this.environment ?? NO_ENVIRONMENT
    if (this.isReviewing()) {
      const tools = this.reviewerTools()
      return {
        instructions: reviewerInstructionsFor({
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
          toolNames: tools.map((tool) => tool.name),
          today,
          environment,
          rules: context.rules,
        }),
        tools,
      }
    }
    const shell = shellToolFor(this.deps.platform)
    const flags = this.toolFlags()
    const { hasShell, hasMemory } = flags
    const goalSection = goalInstructions(this.goal, this.goalSteps)
    const repoMap = this.promptRepoMap()
    const role = this.agentRole()
    return {
      instructions: instructionsFor({
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        shellToolName: shell.name,
        shellName: shell.shellName,
        hasShell,
        isShellAllowed: this.canRunShell(),
        hasMemory,
        hasWebFetch: this.isWebFetchOffered(hasShell),
        hasCodeIntel: this.deps.codeIntel !== undefined,
        today,
        environment,
        // The agents catalogue invites a spawn, which asks its paid popup:
        // hidden while paid subagents are off, from a child, which cannot
        // spawn, and once the workspace is no longer trusted (M76 review).
        context: {
          ...context,
          agents: this.isAgentCatalogueOffered() ? context.agents : [],
        },
        verify: {
          isDiagnosticsOn: this.deps.verify?.isDiagnosticsOn() === true,
          checks: this.canRunVerifyCommands() ? this.checkCommands() : [],
        },
        ...(repoMap !== undefined && { repoMap }),
        // Pinned while the goal is active (M45, PLAN.md D38).
        ...(goalSection !== undefined && { goalSection }),
        // A custom agent's own prompt runs as the child's role (M76).
        ...(role !== undefined && { agent: role }),
      }),
      tools: this.tools(hasShell, flags.hasSkills, hasMemory, this.isSubagent, hasPackedRecall),
    }
  }

  private body(): CreateResponseBody {
    this.drainChildResults()
    const fitted = this.budget.fit(this.replay.map((entry) => entry.item))
    // Packing projects per request only: the replay keeps the originals, so
    // a later request (or a restore) packs from the full outputs again.
    // Reviewer tools cannot recall packed output: retain the full observations.
    const input = this.isReviewing() ? fitted : (this.packing?.project(fitted) ?? fitted)
    if (this.budget.omitted && !this.mediaNoticeSent) {
      this.emit({ type: 'backendNotice', level: 'warning', text: UI_TEXT.olderMediaOmitted })
      this.mediaNoticeSent = true
    }
    const today = new Date(this.deps.now()).toISOString().slice(0, ISO_DATE_LENGTH)
    return this.keyed({
      model: this.modelId,
      input,
      ...this.promptAndTools(
        today,
        input.some((item) => this.packing?.isPlaceholder(item) === true),
      ),
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
      if (
        fitted === undefined ||
        fitted === entry.item ||
        // A placeholder stands in for one request only: the replay keeps
        // the original, so a later request packs from the full output.
        this.packing?.isPlaceholder(fitted) === true
      ) {
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

  /** Whether the `# Agents` catalogue is shown: a spawn must be possible (M76). */
  private isAgentCatalogueOffered(): boolean {
    return (
      !this.isSubagent && this.deps.isWorkspaceTrusted() && this.deps.isPaidFeatureOn('subagents')
    )
  }

  /**
   * The role a child agent runs with (M76). A project file's prompt is
   * repository content: it reaches the model only while the workspace is
   * trusted, a resumed child included; without it the child keeps its
   * narrowed tools and mode and runs on the base prompt alone.
   */
  private agentRole(): AgentRuntime | undefined {
    return this.agent?.source === 'project' && !this.deps.isWorkspaceTrusted()
      ? undefined
      : this.agent
  }

  /** The user's check commands as they stand now (M68); none without the verify loop. */
  private checkCommands(): readonly CheckCommandSetting[] {
    return this.deps.verify?.checkCommands() ?? []
  }

  /**
   * The shell tool, and `then_run`, which runs any command line the model
   * writes, need the shell tool in a narrowed agent's list (M76).
   */
  private canRunShell(): boolean {
    const allowed = this.agent?.toolAllowlist
    return allowed === undefined || allowed.includes(shellToolFor(this.deps.platform).name)
  }

  /**
   * Automatic checks and `run_checks` run only the user's configured check
   * commands: a narrowed agent needs `run_checks` or the shell in its list (M76).
   */
  private canRunVerifyCommands(): boolean {
    const allowed = this.agent?.toolAllowlist
    return this.canRunShell() || allowed?.includes(VERIFY_TOOLS.runChecks) === true
  }

  /** In-process, IDE, MCP and paid search tools offered to this request. */
  private tools(
    hasShell: boolean,
    hasSkills: boolean,
    hasMemory: boolean,
    isSubagent = this.isSubagent,
    hasPackedRecall = false,
  ): readonly ToolDefinition[] {
    const own = toolDefinitions(this.deps.platform, {
      hasShell,
      // then_run runs any command: only where the shell tool is (M76).
      hasThenRun: hasShell && this.canRunShell(),
      hasSkills,
      hasImageGeneration: this.deps.isPaidFeatureOn('imageGeneration'),
      hasSubagents: !isSubagent && this.deps.isPaidFeatureOn('subagents'),
      isSubagent,
      hasMemory,
      hasPackedRecall,
      checks: this.checkCommands(),
      // Trusted workspaces only, as the shell (M69).
      hasWebFetch: this.isWebFetchOffered(hasShell),
      // The same for the browser check (M81); a side chat's Plan mode refuses it.
      hasBrowserCheck:
        hasShell &&
        this.deps.browserCheck !== undefined &&
        this.deps.browserCheck.isOffered() &&
        !this.isSideChat,
      hasCodeIntel: this.deps.codeIntel !== undefined,
    })
    const mcp = hasShell ? (this.deps.mcpServers?.definitions() ?? []) : []
    const offered = [...own, ...this.ideDefinitions(), ...mcp]
    const withSearch: readonly ToolDefinition[] = this.isWebSearchOffered()
      ? [...offered, { type: MODEL_API_WEB_SEARCH_TOOL }]
      : offered
    // A custom agent keeps only its allowlist of the offered tools (M76).
    if (this.agent?.toolAllowlist === undefined) {
      return withSearch
    }
    const allowed = new Set(this.agent.toolAllowlist)
    return withSearch.filter((tool) => allowed.has(toolNameOf(tool)))
  }

  /** The extension's own IDE tools, as the model calls them (M50). */
  private ideDefinitions(): readonly FunctionToolDefinition[] {
    return (this.deps.ideTools ?? []).map(
      (tool) => mcpFunctionDefinition(ideFunctionName(tool), tool).definition,
    )
  }

  /**
   * The Reviewer's tools (M70): the workspace readers and VS Code's Problems
   * panel. Nothing that writes, runs a command or reaches the network, and
   * no web search, whatever is on.
   */
  private reviewerTools(): readonly FunctionToolDefinition[] {
    const own = toolDefinitions(this.deps.platform, {
      hasShell: false,
      hasSkills: false,
      isSubagent: true,
    })
    return [...own, ...this.ideDefinitions()].filter((tool) => isReviewerTool(tool.name))
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
   * the feature is on and this prompt's popup allowed it (M58). A Reviewer's
   * turn is never allowed it (M70, `runTurn`).
   */
  private isWebSearchOffered(): boolean {
    return (
      !this.deps.client.hasPaidDailyBudget &&
      this.currentBudgetCap() <= 0 &&
      this.active?.isWebSearchAllowed === true &&
      this.deps.isPaidFeatureOn('webSearch')
    )
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
    if (this.currentBudgetCap() > 0 || this.deps.client.hasPaidDailyBudget) {
      this.emit({
        type: 'backendNotice',
        level: 'warning',
        text: UI_TEXT.sessionBudgetSearchUnavailable,
      })
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
    if (servers === undefined || this.isReviewing()) {
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
    // The Reviewer deliberately offers no external MCP tool (M70).
    if (this.isReviewing()) {
      return undefined
    }
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
  private responseAttemptGuard(
    body: CreateResponseBody,
    directBudget?: DirectResponseBudget,
  ): ResponseAttemptGuard {
    const reservation = directBudget === undefined ? this.openReservation : undefined
    const guard: ResponseAttemptGuard = (keyDigest) => {
      if (this.isHostClosing() || this.isDisposed) {
        this.active?.abort.abort()
        this.compacting?.abort()
        throw new AbortedError()
      }
      if (this.deps.budgetScope?.isStillAllowed(keyDigest) === false) {
        this.active?.abort.abort()
        this.compacting?.abort()
        throw new AbortedError()
      }
      if (this.isSubagent) {
        this.admitChildAttempt(keyDigest, body)
      }
      const ownerAccount = this.budgetOwner().budgetAccountId
      if (ownerAccount !== undefined && keyDigest !== ownerAccount) {
        throw new Error(UI_TEXT.notSignedInReason)
      }
      if (
        body.tools.some((tool) => tool.type === MODEL_API_WEB_SEARCH_TOOL) &&
        !this.isWebSearchOffered()
      ) {
        throw new Error(UI_TEXT.sessionBudgetSearchUnavailable)
      }
      // A cap enabled during key retrieval needs a new durable preflight.
      if (directBudget !== undefined) {
        if (directBudget.scope?.isStillAllowed(keyDigest) === false) {
          throw new AbortedError()
        }
        const capUsd = directBudget.scope?.capUsd() ?? this.currentBudgetCap()
        if (directBudget.claim === undefined && capUsd > 0) {
          throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
        }
        if (directBudget.isSent && capUsd > 0) {
          throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
        }
        directBudget.claim?.check(capUsd)
      } else if (reservation === undefined && this.currentBudgetCap() > 0) {
        this.active?.abort.abort()
        this.compacting?.abort()
        throw new AbortedError()
      }
      // The preflight awaited disk. This final key/account and revision
      // check stays synchronous, immediately before the HTTP try.
      if (reservation !== undefined) {
        if (keyDigest !== reservation.accountId) {
          throw new Error(UI_TEXT.notSignedInReason)
        }
        if (
          reservation.modelRevision !== this.modelRevision ||
          reservation.goalRevision !== this.goalCommandRevision ||
          reservation.isWorkspaceTrusted !== this.deps.isWorkspaceTrusted() ||
          PAID_FEATURES.some(
            (feature) =>
              reservation.paidFeatures.includes(feature) !== this.deps.isPaidFeatureOn(feature),
          )
        ) {
          this.active?.abort.abort()
          this.compacting?.abort()
          throw new AbortedError()
        }
        if (reservation.claim === undefined) {
          throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
        }
        if (reservation.isSent && this.currentBudgetCap() > 0) {
          throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
        }
        reservation.claim.check(this.currentBudgetCap())
      }
      const required = this.requiredMcpFailure(this.deps.mcpServers?.snapshot())
      if (required !== undefined) {
        throw required
      }
      this.deps.admitResponseAttempt?.(keyDigest)
    }
    let paidFeature = this.deps.admitResponseAttempt?.paidFeature
    if (this.isSubagent) paidFeature = 'subagents'
    else if (this.active?.confirmedRequest !== undefined) paidFeature ??= 'scheduledPrompts'
    let paidEstimatedInputTokens: number | undefined
    if (
      this.deps.client.hasPaidDailyBudget &&
      (paidFeature !== undefined || directBudget !== undefined)
    ) {
      paidEstimatedInputTokens = estimateInput(requestParts(body), undefined).inputTokens
    }
    return Object.assign(guard, {
      ...(paidFeature !== undefined && { paidFeature }),
      ...(paidEstimatedInputTokens !== undefined && { paidEstimatedInputTokens }),
      onRequestStarted: () => {
        if (this.isSubagent && this.childTaskGrant !== undefined) {
          this.childTaskGrant.remainingAttempts -= 1
        }
        if (reservation !== undefined) {
          reservation.isSent = true
        }
        if (directBudget === undefined) {
          // Packing counts the conversation's request only once it is really
          // sent (M73); a direct review's body is not the conversation's.
          this.packing?.noteSent(body.input)
        } else {
          directBudget.isSent = true
        }
        this.deps.admitResponseAttempt?.onRequestStarted?.()
      },
    })
  }

  /** A client-generated 429 refusal admitted no work, so this claim can retry. */
  private allowRateLimitedRetry(notice: RetryNotice): void {
    const reservation = this.openReservation
    if (reservation !== undefined) {
      if (notice.reason.startsWith(`HTTP ${String(HTTP_TOO_MANY_REQUESTS)}:`)) {
        reservation.isSent = false
      } else {
        reservation.hasAmbiguousAttempt = true
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

  /**
   * Now as a recorded time (M87, PLAN.md D66): RFC 3339, as Muse Code's
   * `recordedAt`. The host stamps each user message and reply with it, and
   * the session file keeps it, so a reload shows the times again.
   */
  private recordedNow(): string {
    return new Date(this.deps.now()).toISOString()
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
      recordedAt: this.recordedNow(),
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
      parts: [{ type: 'text', text: MODEL_API_MODEL_TEXT.goalWake }],
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
      this.track(this.runTurn(queued), false)
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
    // An invalid count can understate spend. It is no report, so a reserved
    // request counts at its full reservation (M82).
    if (!isCountedUsage(usage)) {
      this.deps.log.warn('Model API usage with invalid token counts was ignored')
      return
    }
    const billable = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    }
    const sentModelId = this.sendingModelId ?? this.modelId
    const hasKnownPrice = modelApiPaidTier(sentModelId) !== undefined
    const costUsd = estimateCostUsd(billable, sentModelId)
    const nextUsage = {
      inputTokens: this.usage.inputTokens + billable.inputTokens,
      outputTokens: this.usage.outputTokens + billable.outputTokens,
      cachedTokens: this.usage.cachedTokens + billable.cachedTokens,
      reasoningTokens:
        this.usage.reasoningTokens + (usage.output_tokens_details?.reasoning_tokens ?? 0),
    }
    if (
      [
        ...Object.values(nextUsage),
        nextUsage.inputTokens + nextUsage.outputTokens,
        costUsd,
        this.budgetSpentUsd + costUsd,
        this.turnCostUsd + costUsd,
      ].some((value) => !Number.isFinite(value))
    ) {
      this.deps.log.warn('Model API usage whose totals or cost are not finite was ignored')
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
    this.usage = nextUsage
    const reservation = this.openReservation
    const claim = reservation?.claim
    this.budgetSpentUsd += costUsd
    if (hasKnownPrice) {
      this.turnCostUsd += costUsd
    }
    this.recordBudgetCost(
      costUsd,
      claim,
      !hasKnownPrice || reservation?.hasAmbiguousAttempt === true,
    )
    this.settleReservation(usage)
    if (this.isSubagent) {
      this.deps.noteSubagentUsage(this.sendingModelId ?? this.modelId, billable)
    } else {
      const shown = this.unshownUsage
      this.unshownUsage = {
        inputTokens: (shown?.inputTokens ?? 0) + billable.inputTokens,
        outputTokens: (shown?.outputTokens ?? 0) + billable.outputTokens,
        cachedTokens: (shown?.cachedTokens ?? 0) + billable.cachedTokens,
        reasoningTokens:
          (shown?.reasoningTokens ?? 0) + (usage.output_tokens_details?.reasoning_tokens ?? 0),
        costUsd: (shown?.costUsd ?? 0) + costUsd,
      }
      // Saved now, even while a call waits for its output (M82).
      this.touch()
    }
    // An attempt's tally prices the request at the model it was sent to, as the
    // budget does, whatever the session switched to meanwhile (M82).
    this.deps.noteResponseUsage?.(sentModelId, billable)
    this.emitUsage()
    this.noteContext(usage.input_tokens + usage.output_tokens)
  }

  /**
   * The request in flight reported its usage (M82): its reservation closes,
   * and it becomes the base the next estimate starts from. A request sent
   * without a reservation (no cap) leaves no base, so a cap set later
   * estimates the whole of its first request. An output that used every
   * token the budget allowed may be cut short, and the transcript says so.
   */
  private settleReservation(usage: Usage): void {
    const reservation = this.openReservation
    this.openReservation = undefined
    // A model changed mid-request may count differently: no base then.
    this.budgetBase =
      reservation?.hasCap === true &&
      reservation.modelId === this.modelId &&
      reservation.modelRevision === this.modelRevision
        ? { inputTokens: usage.input_tokens, parts: reservation.parts }
        : undefined
    if (
      reservation?.hasCap === true &&
      reservation.maxOutputTokens < MODEL_API_MAX_OUTPUT_TOKENS &&
      usage.output_tokens >= reservation.maxOutputTokens
    ) {
      this.emit({
        type: 'backendNotice',
        level: 'warning',
        text: fill(UI_TEXT.sessionBudgetOutputLimited, {
          tokens: formatNumber(reservation.maxOutputTokens),
        }),
      })
    }
  }

  /**
   * The session's token totals (M73 carries the packing ledger while it
   * runs, so Account & usage shows the row only then).
   */
  private emitUsage(): void {
    this.emit({
      type: 'tokenUsage',
      ...this.usage,
      modelId: this.modelId,
      ...(this.packing !== undefined && { packedTokensAvoided: this.packing.savings() }),
      ...(this.hookTokensAdded > 0 && { hookTokensAdded: this.hookTokensAdded }),
    })
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
    kind: Exclude<OpenItem['kind'], 'argumentPreview'>,
    turnId: string,
  ): Exclude<OpenItem, { kind: 'argumentPreview' }> {
    const existing = open.get(wireId)
    if (existing !== undefined) {
      if (existing.kind === 'argumentPreview') throw new Error(UI_TEXT.modelApiServiceFailure)
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

  private startedSnapshot(
    entry: Exclude<OpenItem, { kind: 'argumentPreview' }>,
    turnId: string,
  ): ItemSnapshot {
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

  private showArgumentPreview(
    entry: Extract<OpenItem, { kind: 'argumentPreview' }>,
    turnId: string,
    isForced = false,
  ) {
    const now = this.deps.now()
    const elapsed =
      entry.previewAt === undefined ? TOOL_ARGUMENT_PREVIEW_INTERVAL_MS : now - entry.previewAt
    if (!isForced && elapsed < TOOL_ARGUMENT_PREVIEW_INTERVAL_MS) {
      if (!this.argumentPreviewTimers.has(entry.call.call_id)) {
        const flush = () => {
          this.showArgumentPreview(entry, turnId, true)
        }
        const timer = setTimeout(flush, TOOL_ARGUMENT_PREVIEW_INTERVAL_MS - elapsed)
        timer.unref()
        this.argumentPreviewTimers.set(entry.call.call_id, { timer, flush })
      }
      return
    }
    this.clearArgumentPreviewTimer(entry.call.call_id)
    // The bound covers processing even when the snapshot will be deduplicated.
    entry.previewAt = now
    const item = {
      itemId: entry.ourId,
      turnId,
      kind: 'toolCall' as const,
      tool: redactSecrets(entry.call.name),
      status: IN_PROGRESS,
      args: '' as const,
      argumentPreview: entry.preview.snapshot(),
    }
    const previous = this.argumentPreviewRows.get(entry.call.call_id)?.argumentPreview
    if (
      previous?.text === item.argumentPreview.text &&
      previous.truncated === item.argumentPreview.truncated &&
      previous.bytes === item.argumentPreview.bytes &&
      previous.frozen === item.argumentPreview.frozen
    )
      return
    if (previous === undefined) {
      this.recordTranscript(turnId, item)
    } else {
      this.rerecordTranscript(item)
    }
    this.argumentPreviewRows.set(entry.call.call_id, item)
    this.emit({ type: 'toolArgumentPreview', item })
  }

  private clearArgumentPreviewTimer(callId: string): void {
    const timer = this.argumentPreviewTimers.get(callId)
    if (timer !== undefined) clearTimeout(timer.timer)
    this.argumentPreviewTimers.delete(callId)
  }

  /** A failed/abandoned preview has no executable arguments or successful result. */
  private interruptArgumentPreview(callId: string): void {
    this.argumentPreviewTimers.get(callId)?.flush()
    this.clearArgumentPreviewTimer(callId)
    const preview = this.argumentPreviewRows.get(callId)
    if (preview === undefined) return
    this.argumentPreviewRows.delete(callId)
    const { argumentPreview: _preview, ...row } = preview
    const item = { ...row, status: TOOL_STATUS_INTERRUPTED }
    this.rerecordTranscript(item)
    this.emit({ type: 'itemCompleted', item })
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
    if (isFailed) {
      return
    }
    const units = searchUnits(item)
    this.deps.notePaidUse('webSearch', units)
    const costUsd = (units * PAID_PRICES_USD.webSearchPerThousand) / SEARCHES_PER_PRICE_UNIT
    this.budgetSpentUsd += costUsd
    this.turnCostUsd += costUsd
    this.recordBudgetCost(costUsd, undefined)
  }

  private completedSnapshot(
    entry: Exclude<OpenItem, { kind: 'argumentPreview' }>,
    turnId: string,
  ): ItemSnapshot {
    return entry.kind === 'agentMessage'
      ? {
          itemId: entry.ourId,
          kind: entry.kind,
          status: COMPLETED,
          turnId,
          text: entry.text,
          ...(entry.citations.length > 0 && { citations: [...entry.citations] }),
          ...(entry.recordedAt !== undefined && { recordedAt: entry.recordedAt }),
        }
      : {
          itemId: entry.ourId,
          kind: entry.kind,
          status: COMPLETED,
          turnId,
          summary: [...entry.summary],
        }
  }

  private completeItem(
    entry: Exclude<OpenItem, { kind: 'argumentPreview' }>,
    turnId: string,
  ): void {
    // A reply's time is the moment it completed, as Muse Code records one (M87).
    if (entry.kind === 'agentMessage') {
      entry.recordedAt ??= this.recordedNow()
    }
    const item = this.completedSnapshot(entry, turnId)
    entry.isCompleted = true
    this.emit({ type: 'itemCompleted', item })
    this.recordTranscript(turnId, item)
  }

  /**
   * The sources of a completed reply as the whole response has them (M33):
   * Meta's cookbook says citations are complete only once the stream ends.
   */
  private settleCitations(
    entry: Exclude<OpenItem, { kind: 'argumentPreview' }>,
    citations: readonly Citation[],
    turnId: string,
  ): void {
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
        } else if (
          isFunctionCallItem(item) &&
          this.deps.argumentPreviewCapabilities?.(this.sendingModelId ?? this.modelId)?.tools
            .streamingArguments.state === 'yes'
        ) {
          const entry: OpenItem = {
            ourId: this.deps.newId(),
            kind: 'argumentPreview',
            call: item,
            preview: new ArgumentPreview(
              toolDefinitions(this.deps.platform, {
                hasShell: true,
                hasSkills: false,
                hasWebFetch: true,
              }).find((tool) => tool.name === item.name)?.previewFields,
            ),
            text: '',
            summary: [],
            isCompleted: false,
            citations: [],
          }
          entry.preview.append(item.arguments)
          open.set(wireId, entry)
          this.showArgumentPreview(entry, turnId)
        }
        return undefined
      }
      case 'response.function_call_arguments.delta':
      case 'response.function_call_arguments.done': {
        const entry = open.get(event.item_id)
        if (entry?.kind === 'argumentPreview') {
          if (event.type === 'response.function_call_arguments.delta') {
            entry.preview.append(event.delta)
          } else {
            entry.preview.finish(event.arguments)
          }
          this.showArgumentPreview(
            entry,
            turnId,
            event.type === 'response.function_call_arguments.done',
          )
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
      if (entry.kind === 'argumentPreview') {
        this.interruptArgumentPreview(entry.call.call_id)
        entry.isCompleted = true
      } else if (entry.kind === 'webSearch') {
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
    } else if (isFunctionCallItem(item)) {
      const entry = open.get(wireId)
      if (entry?.kind === 'argumentPreview') {
        entry.preview.finish(item.arguments)
        this.showArgumentPreview(entry, turnId, true)
      }
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
        if (signal.aborted) {
          for (const entry of open.values()) {
            if (entry.kind !== 'argumentPreview') continue
            this.interruptArgumentPreview(entry.call.call_id)
            entry.isCompleted = true
          }
        } else {
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
    // A request that cannot fit the session budget left is never sent (M82),
    // nor shown to the hooks; the body sent is reserved afresh below, since
    // what it carries can change while the hooks run.
    await this.refreshBudgetSpend()
    await this.beforeModelCall(turnId, this.budgeted(this.body()), requestId, attempt, step, signal)
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
      this.allowRateLimitedRetry(notice)
      this.emit({
        type: 'turnRetry',
        turnId,
        attempt: notice.attempt,
        maxAttempts: notice.maxAttempts,
        retryDelayMs: notice.delayMs,
        reason: notice.reason,
      })
    }
    await this.refreshBudgetSpend()
    const body = this.budgeted(this.body())
    this.lastJudgeBody = body
    const reservation = this.sending(body)
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
    let calls: readonly FunctionCallItem[]
    let wasFitted: boolean
    try {
      await this.persistReservation(reservation)
      for await (const event of responseStream) {
        if (reservation !== undefined) {
          reservation.hasStarted = true
        }
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
      wasFitted = this.commitFittedReplay(requestReplay, body.input)
      this.markOutputMediaDelivered(requestReplay, body.input)
      calls = this.adoptOutput(turnId, final, open, chargedGoalId)
    } catch (error: unknown) {
      this.noteRequestRefusal(reservation, error)
      throw error
    } finally {
      await this.endRequest()
    }
    if (wasFitted) {
      this.touch()
    }
    // The finished reasoning blocks observe first: they completed before the
    // response did (M91 lane E). Their context joins the tail ahead of the
    // post-call context, oldest operation first.
    const thoughtContexts = await this.noteThoughts(turnId, open, signal)
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
      this.skipCalls(turnId, calls, MODEL_API_MODEL_TEXT.mcpRequiredUnavailable)
      throw requiredAfterPostHook
    }
    if (post.blockedReason !== undefined) {
      // Muse Code's isolated echo capture ended its run on a PostLLM block.
      // Stop here, pairing calls so a later session can still replay them.
      this.skipCalls(turnId, calls, post.blockedReason)
      throw new HookStoppedError(post.blockedReason)
    }
    return { calls, goalCommandRevision, postContexts: [...thoughtContexts, ...post.contexts] }
  }

  /**
   * A finished reasoning block (M91 lane E): bounded and scrubbed like every
   * hook preview, observation only. Fires once per completed block of a
   * successful response; a failed attempt's partial thoughts stay silent. The
   * contexts skip the fire-time replay and join the tail with the post-call
   * context instead, so each is replayed exactly once.
   */
  private async noteThoughts(
    turnId: string,
    open: ReadonlyMap<string, OpenItem>,
    signal: AbortSignal,
  ): Promise<readonly string[]> {
    const contexts: string[] = []
    for (const entry of open.values()) {
      if (entry.kind !== 'reasoning' || !entry.isCompleted) {
        continue
      }
      const thought = await this.fireExtensionHooks(
        'AfterAgentThought',
        turnId,
        afterAgentThoughtFields(entry.summary.join('\n')),
        undefined,
        signal,
        false,
      )
      if (thought !== undefined) {
        contexts.push(...thought.contexts)
      }
    }
    return contexts
  }

  /**
   * The tokens and dollars under a reply (M82), while the setting is on:
   * the response's last message carries what every request of this turn
   * since the previous line used, tool steps and failed attempts included,
   * so the lines of a turn add up to what it cost. A response with no
   * message leaves its usage to the next one.
   */
  private noteReplyUsage(
    response: ResponseObject,
    open: Map<string, OpenItem>,
    turnId: string,
  ): void {
    const tally = this.unshownUsage
    if (tally === undefined || !this.deps.showReplyUsage()) {
      return
    }
    let lastMessageWireId: string | undefined
    for (const [index, item] of response.output.entries()) {
      if (isMessageItem(item)) {
        lastMessageWireId = item.id ?? String(index)
      }
    }
    const entry = lastMessageWireId === undefined ? undefined : open.get(lastMessageWireId)
    if (entry === undefined || !entry.isCompleted || entry.kind !== 'agentMessage') {
      return
    }
    this.unshownUsage = undefined
    const { costUsd, ...usage } = tally
    const item: ItemSnapshot = { ...this.completedSnapshot(entry, turnId), usage, costUsd }
    this.emit({ type: 'itemUpdated', item })
    this.rerecordTranscript(item)
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
        if (entry?.isCompleted === true && entry.kind !== 'argumentPreview') {
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
          content: [{ type: OUTPUT_TEXT, text: MODEL_API_MODEL_TEXT.reasoningOnlyReply }],
        },
      })
    }
    this.noteUsage(response.usage, chargedGoalId)
    this.noteReplyUsage(response, open, turnId)
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
   * workspace. Hooks never allow protected writes, network requests, paid
   * calls or asks settled by a rule/profile; they may deny or demand a card.
   * The Auto reviewer may answer only an otherwise unsettled eligible ask.
   */
  private async askApproval(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    query: PermissionQuery,
    question: { readonly card: ApprovalSubject } | { readonly paid: PaidUseRequest },
    requiresUserApproval = false,
    judgement?: PermissionJudgement,
    // A hook's own helper call (M91 mcp_tool): the judgement, the trust
    // check and the card are the tool's own, but no hook fires for it and
    // the Auto reviewer does not judge it, so a hook can never approve or
    // review itself into a loop.
    isHookHelperCall = false,
  ): Promise<ApprovalOutcome> {
    const canReview = judgement?.isReviewable !== false
    const hook: HookDispatch = isHookHelperCall
      ? {
          blockedReason: undefined,
          contexts: [],
          messages: [],
          updatedInput: undefined,
          forceApproval: false,
          stopReason: undefined,
          approvalDecision: undefined,
        }
      : await this.permissionRequestHook(call, signal)
    if (hook.blockedReason !== undefined) {
      return { isApproved: false, feedback: hook.blockedReason, deniedByHook: true }
    }
    signal.throwIfAborted()
    judgement = this.judgementWithHook(query, requiresUserApproval)
    if (!canReview) judgement = { ...judgement, isReviewable: false }
    if (
      judgement.verdict === 'deny' ||
      ((query.toolClass === 'shell' || query.toolClass === 'mcp') &&
        !this.deps.isWorkspaceTrusted())
    ) {
      await this.notePermissionDenied(call.name, this.denialReason(call, judgement), signal)
      return { isApproved: false, feedback: undefined }
    }
    if ('paid' in question) {
      const isAllowed = await this.askPaidUse(call, signal, question.paid, requiresUserApproval)
      return { isApproved: isAllowed, feedback: undefined }
    }
    // M92e (PLAN.md D71): a settled secret ask is not an allow a hook may
    // take: the card asks with the value redacted.
    const isSettledAsk =
      judgement.settledBy !== undefined &&
      ['askRule', 'profile', 'complexCommand', 'secretDetected'].includes(judgement.settledBy)
    if (
      !requiresUserApproval &&
      !isSettledAsk &&
      query.isProtected !== true &&
      query.toolClass !== 'network' &&
      hook.approvalDecision === 'allow'
    ) {
      return { isApproved: true, feedback: undefined }
    }
    let review: ReviewedAsk | undefined
    if (!requiresUserApproval && !isHookHelperCall && judgement.isReviewable) {
      review = await this.autoReview(call, query, signal)
      signal.throwIfAborted()
      judgement = this.permissions.judge(query, this.policy())
      if (judgement.verdict === 'deny' || !this.deps.isWorkspaceTrusted()) {
        await this.notePermissionDenied(call.name, this.denialReason(call, judgement), signal)
        return { isApproved: false, feedback: undefined }
      }
      if (review?.decision === 'allow' && judgement.isReviewable) {
        this.emit({
          type: 'approvalResolved',
          approvalId: this.deps.newId(),
          itemId,
          decision: DECISION_APPROVED,
          resolvedBy: UI_TEXT.autoReviewerResolver,
        })
        return { isApproved: true, feedback: undefined }
      }
    }
    const note = cardNote(judgement) ?? (review?.decision === 'ask' ? review.note : undefined)
    const approvalId = this.deps.newId()
    const request: Extract<AgentEvent, { type: 'approvalRequested' }> = {
      type: 'approvalRequested',
      approvalId,
      itemId,
      toolName: call.name,
      rawArgs: call.arguments,
      requirementId: { approvalId, sourceIndex: 0 },
      subject: question.card,
      availableChoices: [...choicesFor(call.name, query.command, judgement.hasSessionChoice)],
      isJudgeEscalated: requiresUserApproval || review !== undefined,
      isProtectedWrite: query.isProtected === true,
      ...(review?.decision === 'ask' && review.judgeCaution === true && { judgeCaution: true }),
      ...(note !== undefined && { note }),
      ...(this.agent?.permissionMode !== undefined && {
        permissionMode: this.agent.permissionMode,
      }),
    }
    let decision: ApprovalDecision
    const stopNotifying = this.notifyWhileAsking(call, signal)
    let caution: JudgeFence | undefined
    try {
      decision = await waitFor<ApprovalDecision>(signal, (pending) => {
        this.pendingApprovals.set(approvalId, pending)
        this.pendingApprovalEvents.set(approvalId, request)
        this.emit(request)
        if (review !== undefined) {
          return
        }

        caution = this.startJudge(call)
        if (caution !== undefined) this.judgeCardFences.set(approvalId, caution)
        caution?.card(() => {
          if (
            this.judgeCardFences.get(approvalId) !== caution ||
            !this.pendingApprovals.has(approvalId) ||
            signal.aborted
          )
            return
          this.pendingApprovalEvents.set(approvalId, { ...request, judgeCaution: true })
          this.emit({ type: 'approvalCaution', approvalId, requirementId: request.requirementId })
        })
      })
    } finally {
      caution?.discard()
      this.judgeCardFences.delete(approvalId)
      this.pendingApprovalEvents.delete(approvalId)
      this.pendingApprovals.delete(approvalId)
      stopNotifying()
    }
    const isOffered = request.availableChoices.some(
      (choice) => choice.choiceId === decision.choiceId,
    )
    signal.throwIfAborted()
    const fresh = this.permissions.judge(query, this.policy())
    const isStillPermitted =
      fresh.verdict !== 'deny' &&
      ((query.toolClass !== 'shell' && query.toolClass !== 'mcp') || this.deps.isWorkspaceTrusted())
    if (
      isStillPermitted &&
      isOffered &&
      (fresh.hasSessionChoice ||
        (requiresUserApproval && question.card.kind === BROWSER_CHECK_WIDEN_SUBJECT_KIND)) &&
      decision.choiceId === APPROVAL_CHOICE_IDS.allowSession
    ) {
      this.permissions.allowForSession(query.toolName, query.command)
    }
    // Only the two allow choices this card offered approve; anything else refuses.
    const isApproved =
      isStillPermitted &&
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
    if (!isApproved) {
      await this.notePermissionDenied(
        call.name,
        (review !== undefined && review.decision !== 'allow' ? review.note : undefined) ??
          decision.feedback ??
          MODEL_API_MODEL_TEXT.toolRejectedByUser,
        signal,
      )
    }
    return { isApproved, feedback: decision.feedback }
  }

  /**
   * The Auto reviewer on an ask nothing settled (M78, PLAN.md D49): the
   * paid-use popup first (D48), then one read-only call, shown as its own
   * paid row. Undefined when the reviewer is off, not for this session (a
   * child task, a side chat), or its use was declined: the card asks as
   * before. A decline, an unreadable answer, a failure and the breaker all
   * come back as an ask with the reason; only the user's Stop throws.
   */
  private paidModelObservers(turnId: string) {
    return {
      keyed: (request: Omit<CreateResponseBody, 'prompt_cache_key' | 'prompt_cache_retention'>) =>
        this.keyed(request),
      guard: (body: CreateResponseBody, budget: DirectResponseBudget) =>
        this.responseAttemptGuard(body, budget),
      isCountedUsage,
      abortError: () => new AbortedError(),
      isRefused: (error: unknown) =>
        error instanceof ModelApiError &&
        (error.status === HTTP_STATUS.badRequest || error.status === HTTP_TOO_MANY_REQUESTS),
      emit: (event: AgentEvent) => {
        this.emit(event)
      },
      record: (item: ItemSnapshot, isStarted: boolean) => {
        if (isStarted) this.recordTranscript(turnId, item)
        else this.rerecordTranscript(item)
      },
    }
  }

  private async autoReview(
    call: FunctionCallItem,
    query: PermissionQuery,
    signal: AbortSignal,
  ): Promise<ReviewedAsk | undefined> {
    if (!this.deps.isPaidFeatureOn('autoReviewer') || this.isSubagent || this.isSideChat) {
      return undefined
    }
    if (this.reviewBreaker.isTripped) {
      return { decision: 'ask', note: UI_TEXT.autoReviewerPaused }
    }
    const action = query.command ?? call.arguments
    const modelId = this.modelId
    if (modelApiPaidTier(modelId) === undefined) {
      return { decision: 'ask', note: UI_TEXT.autoReviewerFailed }
    }
    const mode = this.permissions.currentMode
    const active = this.active
    const policy = this.policy()
    const isCurrent = () =>
      !this.isDisposed &&
      !signal.aborted &&
      this.active === active &&
      this.modelId === modelId &&
      this.permissions.currentMode === mode &&
      mode === 'onRequest' &&
      this.deps.isWorkspaceTrusted() &&
      this.deps.isPaidFeatureOn('autoReviewer') &&
      this.policy() === policy
    let keyDigest: string
    let budgetScope: OwnedSessionBudgetScope | undefined
    try {
      keyDigest = await unlessStopped(this.deps.client.currentKeyDigest(), signal)
      budgetScope = await unlessStopped(this.ownedBudgetScope(), signal)
    } catch {
      if (signal.aborted) throw new AbortedError()
      return { decision: 'ask', note: UI_TEXT.autoReviewerFailed }
    }
    if (
      !isCurrent() ||
      (budgetScope === undefined && this.deps.sessionBudgetUsd() !== 0) ||
      budgetScope?.isStillAllowed(keyDigest) === false
    ) {
      return { decision: 'ask', note: UI_TEXT.autoReviewerFailed }
    }
    const isAllowed = await unlessStopped(
      this.deps.allowsPaidUse(
        { feature: 'autoReviewer', modelId, tool: call.name, action },
        false,
        this.askingSessionId,
      ),
      signal,
    )
    if (!isAllowed || !isCurrent()) {
      return undefined
    }
    let reviewPaidCall: typeof ReviewPaidCall
    try {
      const entry = await import('./reviewerEntry.js')
      // The packaged function's signature comes from this same source build.
      const exported: unknown = entry.reviewPaidCall
      if (typeof exported !== 'function') throw new Error('Invalid Auto reviewer export')
      reviewPaidCall = entry.reviewPaidCall
    } catch {
      if (signal.aborted) throw new AbortedError()
      this.deps.log.warn('The Auto reviewer bundle could not be loaded; the user decides')
      return { decision: 'ask', note: UI_TEXT.autoReviewerFailed }
    }
    if (!isCurrent()) return undefined
    const turnId = this.active?.turnId ?? this.turnIds.at(-1) ?? this.sessionId
    const caution = this.startJudge(call)
    let outcome: ReviewedAsk
    try {
      outcome = await reviewPaidCall(
        {
          deps: this.deps,
          table: UI_TEXT,
          locale: uiLocale(),
          breaker: this.reviewBreaker,
          userRequest: this.lastUserText(),
          recentCalls: this.recentCalls(turnId),
          ...this.paidModelObservers(turnId),
          keyed: (request) => this.keyed(request),
          guard: (body, budget) => this.responseAttemptGuard(body, budget),
          isCountedUsage,
          abortError: () => new AbortedError(),
          isRefused: (error) =>
            error instanceof ModelApiError &&
            (error.status === HTTP_STATUS.badRequest || error.status === HTTP_TOO_MANY_REQUESTS),
          emit: (event) => {
            this.emit(event)
          },
          record: (item, isStarted) => {
            if (isStarted) this.recordTranscript(turnId, item)
            else this.rerecordTranscript(item)
          },
        },
        call.name,
        action,
        turnId,
        signal,
        {
          modelId,
          keyDigest,
          isStillAllowed: () =>
            isCurrent() &&
            (budgetScope === undefined
              ? this.deps.sessionBudgetUsd() === 0
              : budgetScope.isStillAllowed(keyDigest)),
          onRequestStarted: () => {
            this.deps.notePaidUse('autoReviewer', 1)
          },
        },
        budgetScope,
        isCurrent,
      )
    } catch (error: unknown) {
      caution?.discard()
      throw error
    }
    const hasJudgeCaution = caution?.read() === 'caution'
    return hasJudgeCaution
      ? {
          decision: 'ask',
          note: outcome.decision === 'ask' ? outcome.note : undefined,
          judgeCaution: true,
        }
      : outcome
  }

  private startJudge(call: FunctionCallItem): JudgeFence | undefined {
    if (this.isSubagent || this.isSideChat || this.active === undefined) return undefined
    let args: unknown
    try {
      args = JSON.parse(call.arguments)
    } catch {
      return undefined
    }
    return this.deps.judge?.start(
      {
        backend: 'modelApi',
        sessionId: this.sessionId,
        turnId: this.active.turnId,
        tool: call.name,
        args,
      },
      JSON.stringify({
        userRequest: this.lastUserText(),
        recentCalls: this.recentCalls(this.active.turnId),
        tool: call.name,
        args,
      }),
    )
  }

  /** The user's latest message as they typed it, for the reviewer. */
  private lastUserText(): string | undefined {
    return this.transcript.findLast((entry) => entry.item.kind === 'userMessage')?.item.text
  }

  /** The turn's earlier tool calls, the reviewer's own rows left out. */
  private recentCalls(turnId: string): { readonly tool: string; readonly args: string }[] {
    return this.transcript
      .filter(
        (entry) =>
          entry.turnId === turnId &&
          entry.item.kind === 'toolCall' &&
          entry.item.tool !== AUTO_REVIEW_ROW_TOOL &&
          entry.item.status !== IN_PROGRESS,
      )
      .slice(-AUTO_REVIEWER_RECENT_CALLS)
      .map((entry) => ({ tool: entry.item.tool ?? '', args: entry.item.args ?? '' }))
  }

  /** The PermissionRequest hooks on one call (M51): a block, or the decision a card may follow. */
  private async permissionRequestHook(
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<HookDispatch> {
    return await this.runHooks(
      'PermissionRequest',
      this.active?.turnId,
      { tool_name: call.name, tool_input: toolHookInput(argumentsOf(call)) },
      toolMatcherNames(call.name),
      signal,
      false,
    )
  }

  /** The paid-use popup for one call (M58), notifying while it waits; a Stop ends the wait. */
  private async askPaidUse(
    call: FunctionCallItem,
    signal: AbortSignal,
    paid: PaidUseRequest,
    requiresUserApproval: boolean,
  ): Promise<boolean> {
    const stopNotifying = this.notifyWhileAsking(call, signal)
    try {
      return await unlessStopped(
        this.deps.allowsPaidUse(paid, requiresUserApproval, this.askingSessionId),
        signal,
      )
    } finally {
      stopNotifying()
    }
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

  /**
   * One MCP server's `elicitation/create` during this session's tool call
   * (M91 lane M, form mode only): the Elicitation hooks run first, then the
   * form asks the user. Never auto-accepts, in any approval mode: without
   * an answer there is no accept. A timeout, a stopped turn or a closed
   * session settles it as a cancel. Values are validated against the
   * server's schema and reach only the server's own result: they are never
   * logged, and no event carries them.
   */
  private async runElicitation(
    itemId: string,
    request: McpElicitationRequest,
  ): Promise<ElicitationOutcome> {
    const { server, params, signal } = request
    // Already parsed at the connection's boundary (rule 7); parsed again
    // for use here. A refusal throws to the connection's error answer.
    const forms = await this.hookRuntime()
    const parsed = forms.parseElicitationParams(params)
    const seam =
      this.deps.isHooksEnabled?.() === false
        ? ALLOW_ELICITATION_SEAM
        : (this.deps.elicitationHooks ?? ALLOW_ELICITATION_SEAM)
    const checked = forms.validateElicitationSchema(parsed.requestedSchema)
    if (!checked.ok) {
      this.deps.log.warn(`MCP server ${server} elicitation declined: ${checked.reason}`)
      return await this.finishElicitation(server, [], 'decline')
    }
    const fields = checked.fields
    const fieldNames = elicitationFieldNames(fields)
    const isStopped = () => signal.aborted
    if (isStopped() || this.pendingElicitations.size > 0) {
      return await this.finishElicitation(server, fieldNames, 'cancel')
    }
    const verdict = await seam.fireElicitation({
      server,
      message: parsed.message,
      fieldNames: [...fieldNames],
      requiredNames: fields.filter((field) => field.required).map((field) => field.name),
    })
    if (isStopped() || this.pendingElicitations.size > 0) {
      return await this.finishElicitation(server, fieldNames, 'cancel')
    }
    if (verdict.decision === 'decline' || verdict.decision === 'cancel') {
      if (verdict.decision === 'decline' && verdict.reason !== undefined) {
        this.emit({
          type: 'backendNotice',
          level: 'info',
          text: fill(UI_TEXT.elicitationDeclinedByHook, { server, reason: verdict.reason }),
        })
      }
      return await this.finishElicitation(server, fieldNames, verdict.decision)
    }
    if (verdict.decision === 'answer') {
      if (verdict.source !== 'user') {
        this.deps.log.warn(`MCP server ${server} elicitation: a project hook's answer is refused`)
        return await this.finishElicitation(server, fieldNames, 'decline')
      }
      const values = verdict.values ?? {}
      const answered = forms.validateElicitationValues(fields, values)
      if (!answered.ok) {
        this.deps.log.warn(
          `MCP server ${server} elicitation: a hook's answer does not fit the schema and is refused`,
        )
        return await this.finishElicitation(server, fieldNames, 'decline')
      }
      this.emit({
        type: 'backendNotice',
        level: 'info',
        text: fill(UI_TEXT.elicitationAnsweredByHook, { server }),
      })
      return await this.finishElicitation(server, fieldNames, 'accept', answered.content)
    }
    const elicitationId = this.deps.newId()
    const reply = await this.waitForElicitation(
      elicitationId,
      server,
      itemId,
      parsed.message,
      fields,
      signal,
    )
    this.pendingElicitations.delete(elicitationId)
    const refusalAction = reply.kind === 'declined' ? 'decline' : 'cancel'
    const action = reply.kind === 'accepted' ? 'accept' : refusalAction
    this.emit({ type: 'elicitationSettled', elicitationId, action })
    return reply.kind === 'accepted'
      ? await this.finishElicitation(server, fieldNames, 'accept', reply.content)
      : await this.finishElicitation(server, fieldNames, action)
  }

  /**
   * The form's wait: shown in the panel until it is answered, and in the
   * ACP agent through its form path. Invalid answers are refused with the
   * field named, and the wait goes on; the timeout and any stop cancel it.
   */
  private async waitForElicitation(
    elicitationId: string,
    server: string,
    itemId: string,
    message: string,
    fields: readonly ElicitationField[],
    signal: AbortSignal,
  ): Promise<ElicitationContent> {
    const timer = setTimeout(() => {
      this.pendingElicitations.get(elicitationId)?.pending.resolve({ kind: 'cancelled' })
    }, this.deps.elicitationTimeoutMs ?? MCP_ELICITATION_TIMEOUT_MS)
    try {
      // Pending before it is shown, as an approval card is: an answer given
      // as the form arrives must find it (the live sweep, 2026-09-27).
      return await waitFor<ElicitationContent>(signal, (pending) => {
        this.pendingElicitations.set(elicitationId, { pending, fields, server })
        this.emit({
          type: 'elicitationRequested',
          elicitationId,
          server,
          message,
          fields: fields.map((field) => ({ ...field })),
          itemId,
        })
      })
    } catch {
      return { kind: 'cancelled' }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * The ElicitationResult hook run (observation) and the server's answer. A
   * project hook sees the field names and the action only, never values.
   */
  private async finishElicitation(
    server: string,
    fieldNames: readonly string[],
    action: ElicitationOutcome['action'],
    content?: Readonly<Record<string, unknown>>,
  ): Promise<ElicitationOutcome> {
    const seam =
      this.deps.isHooksEnabled?.() === false
        ? ALLOW_ELICITATION_SEAM
        : (this.deps.elicitationHooks ?? ALLOW_ELICITATION_SEAM)
    await seam.fireElicitationResult({ server, fieldNames: [...fieldNames], action })
    this.deps.log.info(describeElicitationForLog(server, fieldNames, action))
    return action === 'accept' ? { action, content: { ...content } } : { action }
  }

  /** Settles a waiting elicitation form with `reply`. */
  private async settleElicitationForm(
    elicitationId: string,
    reply: ElicitationReply,
  ): Promise<void> {
    const found = this.pendingElicitations.get(elicitationId)
    if (found === undefined) {
      throw new Error(UI_TEXT.elicitationExpired)
    }
    if (reply.kind !== 'accepted') {
      found.pending.resolve(reply)
      return
    }
    // Loaded already: the form's own schema was checked with it.
    const { validateElicitationValues } = await this.hookRuntime()
    const checked = validateElicitationValues(found.fields, reply.values)
    if (!checked.ok) {
      throw new Error(
        fill(UI_TEXT.elicitationInvalid, { field: checked.refusal.field, server: found.server }),
      )
    }
    found.pending.resolve({ kind: 'accepted', content: checked.content })
  }

  /**
   * Replace the task list (M91 lane E): each added item runs TaskCreated,
   * each newly completed one TaskCompleted, with the bounded subject and
   * description. A refusal keeps the old list and tells the model why; after
   * `HOOK_MAX_STOP_CONTINUATIONS` refusals in a row the turn ends, keeping the
   * old list. A new user turn may try again, through every hook.
   */
  private async writeTodos(
    call: FunctionCallItem,
    turnId: string,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
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
    const previous = this.todos
    const next = parsed.data.items
    {
      for (const item of next) {
        const wasCompleted = previous.some(
          (old) => old.text === item.text && old.status === 'completed',
        )
        const fields = taskFields({ subject: item.text, description: item.activeForm ?? '' })
        if (previous.every((old) => old.text !== item.text)) {
          const created = await this.fireExtensionHooks(
            'TaskCreated',
            turnId,
            fields,
            item.text,
            signal,
          )
          if (created?.refusedReason !== undefined) {
            return this.taskRefused('created', item.text, created.refusedReason)
          }
        }
        if (wasCompleted || item.status !== 'completed') continue
        const completed = await this.fireExtensionHooks(
          'TaskCompleted',
          turnId,
          fields,
          item.text,
          signal,
        )
        if (completed?.refusedReason !== undefined) {
          return this.taskRefused('completed', item.text, completed.refusedReason)
        }
      }
      this.taskRefusals = 0
    }
    this.todos = next
    this.emit({ type: 'todoChanged', items: [...this.todos] })
    const summary = `${String(this.todos.length)} tasks`
    return { output: summary, visibleOutput: summary }
  }

  /** A refused task write: the old list stands, and the refusal counts toward the pause. */
  private taskRefused(kind: 'created' | 'completed', subject: string, reason: string): ToolOutcome {
    this.taskRefusals += 1
    if (this.taskRefusals >= HOOK_MAX_STOP_CONTINUATIONS) {
      this.deps.log.warn(
        `Model API extension hooks: task continuation limit after ${String(this.taskRefusals)} refusals`,
      )
    }
    const text = fill(
      kind === 'created' ? UI_TEXT.hookRefusedTaskCreated : UI_TEXT.hookRefusedTaskCompleted,
      { subject, reason },
    )
    return { output: `Error: ${text}`, visibleOutput: text, failureReason: text }
  }

  /**
   * A skill part's expansion as the model receives it (M91 lane E): each
   * resolved skill runs UserPromptExpansion, which can refuse with a visible
   * reason. A refused expansion never reaches a model request: the appended
   * user message is removed, as for a blocked prompt. Selectors nothing
   * resolves go as typed, with no expansion and no hook.
   */
  private async expandSkillsForHooks(
    turnId: string,
    parts: readonly TurnPart[],
    replayStart: number,
    signal: AbortSignal,
    displayText?: string,
  ): Promise<void> {
    for (const part of parts) {
      if (part.type !== 'skill') {
        continue
      }
      const skill = this.context.skill(part.selector)
      if (skill === undefined) {
        continue
      }
      const expanded = await this.fireExtensionHooks(
        'UserPromptExpansion',
        turnId,
        userPromptExpansionFields({
          trigger: 'skill',
          name: part.selector,
          expanded: skillInvocationText(skill, part.arguments),
        }),
        part.selector,
        signal,
      )
      if (expanded?.refusedReason === undefined) {
        continue
      }
      this.replay.splice(replayStart)
      throw new HookStoppedError(
        fill(UI_TEXT.hookRefusedExpansion, {
          name: `/${part.selector}`,
          reason: expanded.refusedReason,
        }),
      )
    }
    const slashName = displayText?.match(EXPANDED_SLASH_NAME)?.[1]
    if (slashName === undefined || parts.some((part) => part.type === 'skill')) return
    const expanded = await this.fireExtensionHooks(
      'UserPromptExpansion',
      turnId,
      userPromptExpansionFields({ trigger: 'slash', name: slashName, expanded: typedText(parts) }),
      slashName,
      signal,
    )
    if (expanded?.refusedReason === undefined) return
    this.replay.splice(replayStart)
    throw new HookStoppedError(
      fill(UI_TEXT.hookRefusedExpansion, { name: `/${slashName}`, reason: expanded.refusedReason }),
    )
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
        return [{ type: 'input_text', text: file.notDelivered }]
      }
      const [sent] = this.contentParts([file.part])
      if (sent === undefined) {
        return []
      }
      const lead: InputContentPart = { type: 'input_text', text: file.lead }
      pending.push({
        notDelivered: file.notDelivered,
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
      const leads = new Map(pending.map((file) => [file.lead, file.notDelivered]))
      const media = new Set(pending.map((file) => file.media))
      const content = replay.item.content.flatMap((part): InputContentPart[] => {
        const notDelivered = leads.get(part)
        if (notDelivered !== undefined) {
          return [{ type: 'input_text', text: notDelivered }]
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
            ? { type: 'input_text', text: MODEL_API_MODEL_TEXT.toolOutputImageNotDelivered }
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

  /**
   * `read_skill`: the body of a catalogue skill, by id; never a path. A
   * project skill is a workspace file, `.agents/skills/<id>/SKILL.md`, which
   * the permission settings bind as they bind `read_file` (M78, the RV78f
   * review): a denied one is refused before anything is returned, and its
   * names are what the dispatcher's fence judges again. A personal skill
   * lives in Muse Code's own folder, and a bundled one (M89) in the
   * extension's, not the workspace.
   */
  private async readSkill(
    call: FunctionCallItem,
    turnId: string,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const parsed = readSkillArgs.safeParse(argumentsOf(call))
    if (!parsed.success) {
      return toolFailure('invalid arguments: id is required')
    }
    const skill = this.context.skill(parsed.data.id)
    if (skill === undefined) {
      return toolFailure(`${MODEL_API_MODEL_TEXT.skillNotFound} ${parsed.data.id}`)
    }
    const loaded: ToolOutcome = {
      output: `Skill ${skill.id}: ${skill.description}\n\n${skillBodyForModel(skill)}`,
      visibleOutput: `Loaded skill ${skill.id} (${skill.source})`,
    }
    if (skill.source !== PROJECT_SKILL_SOURCE) {
      // Muse Code's own folder or the extension's: no file the workspace's rules name.
      return { ...loaded, touched: { names: [], complete: true } }
    }
    const file = await confineWorkspacePath(
      this.deps.workspaceRoot,
      [...PROJECT_SKILLS_DIR_SEGMENTS, skill.id, SKILL_FILE_NAME].join('/'),
      this.deps.platform,
      this.deps.io,
    )
    if (!file.ok) {
      return toolFailure(file.reason)
    }
    const names = [file.relative, file.canonical]
    if (this.policy().files.isDenied(names)) return deniedPath(file.relative)
    await this.fireExtensionHooks(
      'InstructionsLoaded',
      turnId,
      instructionsLoadedFields(file.relative, 'skill'),
      file.relative,
      signal,
    )
    return { ...loaded, touched: { names, complete: true } }
  }

  /**
   * A `recall_output` call (M73): pages a packed original back. A read of
   * the session's own earlier output, so it runs in every mode without a
   * card. Without packing the tool is not offered, and a model that calls
   * it anyway is told so, never run.
   */
  private recallPacked(call: FunctionCallItem): ToolOutcome {
    return this.packing === undefined
      ? toolFailure(`unknown tool ${call.name}`)
      : this.packing.recall(call.arguments)
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

  /**
   * `generate_image` and `edit_image`, using the approved source bytes and
   * destination. The egress fence (M78, the lead's choke-point decision):
   * the request carries workspace bytes off the machine (an edit's
   * sources), so the live policy judges the call again, with its target and
   * every source, inside each attempt's final admission, with no await
   * between that and the send. A refusal sends nothing, and the paid
   * reservation is released as for any request that was not sent.
   */
  private async makeImage(
    plan: ImagePlan,
    signal: AbortSignal,
    admission: Admission,
  ): Promise<ToolOutcome> {
    const touched: TouchedFiles = {
      names: [plan.target, ...plan.sources].flatMap((file) => [file.relative, file.canonical]),
      complete: true,
    }
    for (const path of [plan.target, ...plan.sources]) {
      const current = await confineWorkspacePath(
        this.deps.workspaceRoot,
        path.absolute,
        this.deps.platform,
        this.deps.io,
      )
      if (!current.ok || current.checkedAbsolute !== path.checkedAbsolute) {
        return toolFailure(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval)
      }
    }
    await this.refreshBudgetSpend()
    const price = PAID_PRICES_USD.imageGeneration
    const capUsd = this.currentBudgetCap()
    if (capUsd > 0 && price > capUsd - this.budgetSpentUsd) {
      throw new SessionBudgetExceededError(
        fill(UI_TEXT.sessionBudgetStopped, {
          estimate: formatUsd(price),
          cap: formatUsd(capUsd),
          spent: formatUsd(this.budgetSpentUsd),
        }),
      )
    }
    const owner = this.budgetOwner()
    const scope = this.deps.budgetScope
    const accountId = scope?.accountId ?? owner.budgetAccountId
    const journal = this.budgetJournal()
    const claim =
      accountId !== undefined && journal !== undefined
        ? await journal.reserve(scope?.sessionId ?? owner.sessionId, accountId, price)
        : undefined
    const revision = this.modelRevision
    const goalRevision = this.goalCommandRevision
    const isTrusted = this.deps.isWorkspaceTrusted()
    const imageState = { isSent: false, isBilled: false }
    let isRefused = false
    let hasReturned = false
    let egressRefusal: ToolOutcome | undefined
    try {
      if (scope === undefined && capUsd > 0) {
        await this.onPersisted('budget')
      }
      const outcome = await runImageCall(plan, {
        client: this.deps.client,
        io: this.toolWrites()?.io ?? this.deps.io,
        signal,
        isStillOn: () => this.deps.isPaidFeatureOn('imageGeneration'),
        admitAttempt: Object.assign(
          (keyDigest: string | undefined) => {
            // Image transport retries only an explicit 429. The preceding
            // attempt then admitted no work, including if this retry is refused.
            imageState.isSent = false
            if (
              keyDigest !== accountId ||
              signal.aborted ||
              this.isDisposed ||
              revision !== this.modelRevision ||
              goalRevision !== this.goalCommandRevision ||
              isTrusted !== this.deps.isWorkspaceTrusted() ||
              !this.deps.isPaidFeatureOn('imageGeneration') ||
              scope?.isStillAllowed(keyDigest) === false
            ) {
              throw new AbortedError()
            }
            if (claim === undefined && this.currentBudgetCap() > 0) {
              throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
            }
            claim?.check(this.currentBudgetCap())
            // The egress fence, last: the client builds and sends with no await.
            egressRefusal ??= this.policyRefusal(admission, touched.names)
            if (egressRefusal !== undefined) {
              throw new AbortedError()
            }
          },
          {
            onRequestStarted: () => {
              imageState.isSent = true
            },
          },
        ),
        onBilled: () => {
          imageState.isBilled = true
          this.deps.notePaidUse('imageGeneration', 1)
        },
      })
      hasReturned = true
      return { ...outcome, touched }
    } catch (error: unknown) {
      if (egressRefusal !== undefined) {
        return egressRefusal
      }
      isRefused =
        error instanceof ModelApiError &&
        (error.status === HTTP_STATUS.badRequest || error.status === HTTP_TOO_MANY_REQUESTS)
      throw error
    } finally {
      const charged =
        imageState.isBilled || (!hasReturned && !isRefused && imageState.isSent) ? price : 0
      this.budgetSpentUsd += charged
      if (imageState.isBilled) {
        this.turnCostUsd += charged
      } else if (charged > 0) {
        this.warnUnknownCharge(charged)
      }
      this.recordBudgetCost(charged, claim)
      await this.budgetWrites
      if (claim !== undefined && scope === undefined) {
        await this.onPersisted('refund')
      }
    }
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

  /**
   * A tool that named a path may have entered a directory with its own rules
   * file (M91 lane E): newly loaded rules run InstructionsLoaded, with the
   * workspace-relative path and a reason, never content.
   */
  private async touchPath(
    call: FunctionCallItem,
    turnId: string,
    signal: AbortSignal,
  ): Promise<void> {
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
    if (!resolved.ok) {
      return
    }
    const isChanged = await this.context.touch(resolved.relative)
    if (isChanged) {
      await this.noteLoadedRules(turnId, 'touched-path', signal)
    }
  }

  private async noteLoadedRules(
    turnId: string,
    reason: 'rules' | 'touched-path',
    signal: AbortSignal,
  ): Promise<void> {
    for (const file of this.context.rulePaths()) {
      if (this.observedRules.has(file)) continue
      this.observedRules.add(file)
      await this.fireExtensionHooks(
        'InstructionsLoaded',
        turnId,
        instructionsLoadedFields(file, reason),
        file,
        signal,
      )
    }
  }

  /**
   * A shell call's kept directory (M91 lane S, PLAN.md D70): where the
   * command starts, and what executeTool runs. The user's command is wrapped
   * after admission, so the approval card, the session rules and the hook
   * payloads see exactly what the model wrote; the trailer only reports
   * the final directory to the session's side file. `then_run` and
   * `run_checks` never pass through here: they run at the workspace root.
   */
  private async beginShellDirectory(call: FunctionCallItem): Promise<ShellDirectoryTracking> {
    const untracked = (): ShellDirectoryTracking => ({
      tracked: false,
      argsJson: call.arguments,
      cwd: undefined,
      sideFile: '',
      sequence: 0,
    })
    if (this.deps.shellKeepsDirectory?.() !== true) {
      return untracked()
    }
    const parsed = parsedArguments(call.arguments)
    const command = pick(parsed, 'command')
    if (command === undefined) {
      // No command names none: executeTool refuses it, and nothing is tracked.
      return untracked()
    }
    const p = pathModule(this.deps.platform)
    const sideFile = p.join(
      this.deps.shellSidecarDir ?? p.join(tmpdir(), SHELL_SIDECAR_DIR),
      `${this.sessionId.replaceAll(SIDECAR_UNSAFE, '_')}.${this.shellSidecarToken}.cwd`,
    )
    if (!this.shellSidecarMade) {
      try {
        await mkdir(p.dirname(sideFile), { recursive: true })
      } catch (error: unknown) {
        // Nowhere to report to: the command still runs at the root, as before.
        this.deps.log.warn(`The shell's directory tracking is off: ${describe(error)}`)
        return untracked()
      }
      this.shellSidecarMade = true
      this.shellSidecarFile = sideFile
    }
    const sequence = (this.shellCallSequence += 1)
    return {
      tracked: true,
      argsJson: JSON.stringify({
        ...parsed,
        command: `${command}${shellDirectoryTrailer(this.deps.platform, sideFile, sequence)}`,
      }),
      // Use the same native long form as resolveShellDirectory on Windows:
      // a workspace opened through an 8.3 alias must also start/reset there.
      cwd:
        this.keptShellDir ??
        (this.deps.platform === 'win32'
          ? await this.deps.io.realPath(this.deps.workspaceRoot)
          : this.deps.workspaceRoot),
      sideFile,
      sequence,
    }
  }

  /**
   * Reads a tracked call's report back and moves the kept directory: the
   * tail of a result whose directory is not the root names it
   * (`UI_TEXT.shellDirectory`), and a directory outside the workspace
   * resets to the root with a note to the model
   * (`UI_TEXT.shellDirectoryReset`). A result at the root carries nothing:
   * no earlier request bytes change (SoL-Pi rule 1). The CwdChanged hook
   * point for lane E is the assignment to `keptShellDir` below: the old and
   * new directories are both in hand here.
   */
  private async endShellDirectory(
    tracking: ShellDirectoryTracking,
    outcome: ToolOutcome,
  ): Promise<ToolOutcome> {
    if (!tracking.tracked) {
      return outcome
    }
    let text: string | undefined
    try {
      text = await this.deps.io.readFile(tracking.sideFile)
    } catch (error: unknown) {
      this.deps.log.warn(`The shell's directory report could not be read: ${describe(error)}`)
    }
    const reported = parseShellDirectoryReport(text, tracking.sequence)
    if (reported === undefined) {
      // The trailer never ran: keep the previous directory, silently.
      return outcome
    }
    const resolved = await this.resolveShellDirectory(reported)
    this.keptShellDir = resolved.dir
    if (resolved.tail === undefined) {
      return outcome
    }
    return {
      ...outcome,
      output: outcome.output === '' ? resolved.tail : `${outcome.output}\n${resolved.tail}`,
      visibleOutput:
        outcome.visibleOutput === '' ? resolved.tail : `${outcome.visibleOutput}\n${resolved.tail}`,
    }
  }

  /**
   * A reported final directory, kept or refused (M91 lane S): the canonical
   * forms of the root and the report, links and junctions resolved, decide
   * (PLAN.md D24). The root itself keeps nothing; anything not below it
   * resets with a note naming the canonical path when known.
   */
  private async resolveShellDirectory(
    reported: string,
  ): Promise<{ readonly dir: string | undefined; readonly tail: string | undefined }> {
    const platform = this.deps.platform
    const p = pathModule(platform)
    if (!p.isAbsolute(reported)) {
      return { dir: undefined, tail: fill(UI_TEXT.shellDirectoryReset, { path: reported }) }
    }
    let realTarget: string
    let realRoot: string
    try {
      ;[realTarget, realRoot] = await Promise.all([
        this.deps.io.realPath(reported),
        this.deps.io.realPath(this.deps.workspaceRoot),
      ])
    } catch {
      // The file system refuses to say: fail closed, back to the root.
      return { dir: undefined, tail: fill(UI_TEXT.shellDirectoryReset, { path: reported }) }
    }
    if (isSamePath(realTarget, realRoot, platform)) {
      return { dir: undefined, tail: undefined }
    }
    const relative = p.relative(realRoot, realTarget)
    if (!isBelow(relative, p)) {
      return { dir: undefined, tail: fill(UI_TEXT.shellDirectoryReset, { path: realTarget }) }
    }
    return {
      dir: realTarget,
      tail: fill(UI_TEXT.shellDirectory, { path: relative.split(p.sep).join('/') }),
    }
  }

  /**
   * The shell tool, movable to the background while it runs (M46, PLAN.md
   * D39). Until it moves, the turn's Stop ends it and its time limit holds;
   * once moved, the call answers the model at once, the command runs on with
   * no limit, and only its own stop (its row, Stop all, the session closing)
   * ends it. The live policy fence (M78) is asked at the real process entry,
   * after every wait of the adapter; its refusal replaces the refused entry's
   * result, which would read as a stop the user never made.
   */
  private async runShellCall(
    itemId: string,
    call: FunctionCallItem,
    turnSignal: AbortSignal,
    isAllowed: CallAdmission,
    admission: Admission,
  ): Promise<Performed> {
    this.noteProcessRan()
    const stop = new AbortController()
    const onTurnStop = () => {
      stop.abort()
    }
    if (turnSignal.aborted) {
      stop.abort()
    }
    turnSignal.addEventListener('abort', onTurnStop, { once: true })
    const limit = new ShellTimeLimit()
    let refusal: ToolOutcome | undefined
    const run = async (): Promise<ToolOutcome> => {
      const tracking = await this.beginShellDirectory(call)
      const outcome = await executeTool(call.name, tracking.argsJson, {
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        io: this.deps.io,
        shellCwd: tracking.cwd,
        signal: stop.signal,
        limit,
        seen: this.seenFiles,
        assertCanRun: () => {
          if (stop.signal.aborted || !isAllowed(this.backgroundShells.get(itemId) === stop))
            throw new AbortedError()
          refusal ??= this.policyRefusal(admission)
          if (refusal !== undefined) throw new AbortedError()
        },
      })
      return refusal ?? (await this.endShellDirectory(tracking, outcome))
    }
    const running = run()
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
    this.noteBackgroundStarted()
    return {
      outcome: { output: MODEL_API_MODEL_TEXT.shellMovedToBackground, visibleOutput: '' },
      running,
    }
  }

  /**
   * An M91 mcp_tool handler's call (D70, lane H): the tool on its configured
   * MCP server, through that tool's own approval path. The policy judgement,
   * the trust check and the approval card are the tool's own; the helper
   * call fires no hook and skips the Auto reviewer, so a hook can never
   * approve or review itself into a loop. A colliding plain name that is not
   * this server's tool is missing, never another server's tool.
   */
  private async runHookMcpTool(
    server: string,
    tool: string,
    argsJson: string,
    signal: AbortSignal,
  ): Promise<HookMcpOutcome> {
    const servers = this.deps.mcpServers
    if (servers === undefined) {
      return { kind: 'missing' }
    }
    const candidate = mcpFunctionName(server, tool, new Set())
    const ref = servers.find(candidate)
    if (ref?.server !== server || ref.tool !== tool) {
      return { kind: 'missing' }
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return { kind: 'denied' }
    }
    const call: FunctionCallItem = {
      type: 'function_call',
      call_id: this.deps.newId(),
      name: candidate,
      arguments: argsJson,
    }
    const query: PermissionQuery = {
      toolName: candidate,
      toolClass: 'mcp',
      isReadOnly: ref.isReadOnly,
    }
    const judgement = this.permissions.judge(query, this.policy())
    if (judgement.verdict === 'deny') return { kind: 'denied' }
    const approval =
      judgement.verdict === 'allow'
        ? { isApproved: true }
        : await this.askApproval(
            this.deps.newId(),
            call,
            signal,
            query,
            { card: { kind: 'tool', toolName: candidate } },
            false,
            undefined,
            true,
          )
    if (!approval.isApproved) {
      return { kind: 'denied' }
    }
    signal.throwIfAborted()
    if (
      !this.deps.isWorkspaceTrusted() ||
      this.permissions.judge(query, this.policy()).verdict === 'deny'
    ) {
      return { kind: 'denied' }
    }
    const outcome = await servers.call(candidate, argsJson, signal)
    return {
      kind: 'called',
      text: outcome.output,
      isError: outcome.failureReason !== undefined,
    }
  }

  /**
   * An M91 agent handler's read-only tools (D70, lane H): read, grep, list
   * and code intelligence. No writes, no shell, no web; rename is not
   * offered. Whatever is off (code intelligence without the service) is
   * simply absent.
   */
  private hookModelTools(): readonly FunctionToolDefinition[] {
    return toolDefinitions(this.deps.platform, {
      hasShell: false,
      hasSkills: false,
      isSubagent: true,
      hasCodeIntel: this.deps.codeIntel !== undefined,
    }).filter((tool) => HOOK_MODEL_READ_TOOLS.has(tool.name))
  }

  /** One read-only tool call of a hook's agent turn; any other name is refused. */
  private fileToolContext(signal: AbortSignal) {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      platform: this.deps.platform,
      io: this.toolWrites()?.io ?? this.deps.io,
      signal,
      seen: this.seenFiles,
      files: this.policy().files,
    }
  }

  private async executeHookModelTool(
    name: string,
    argsJson: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!HOOK_MODEL_READ_TOOLS.has(name)) {
      throw new Error(`the hook model call cannot use ${name}`)
    }
    const intelTool = codeIntelToolOf(name)
    if (intelTool !== undefined && intelTool !== 'renameSymbol') {
      if (this.deps.codeIntel === undefined) {
        throw new Error(`the hook model call cannot use ${name}`)
      }
      const outcome = await this.readCode(
        intelTool,
        { type: 'function_call', call_id: this.deps.newId(), name, arguments: argsJson },
        signal,
      )
      return outcome.output
    }
    const context = this.fileToolContext(signal)
    const outcome = await executeTool(name, argsJson, {
      ...context,
      assertCanWrite: () => {
        throw new AbortedError()
      },
    })
    return outcome.output
  }

  /**
   * An M91 prompt/agent handler's own model call (D70, lane H): one attempt,
   * no retry, hooks off, on the hookModels tally line apart from the
   * conversation. The paid gate and popup already allowed this run; the row
   * keeps it loud.
   */
  private async runHookModelTurn(
    kind: 'prompt' | 'agent',
    system: string,
    user: string,
    event: string,
    signal: AbortSignal,
  ): Promise<HookModelTurn> {
    const modelId = this.modelId
    const active = this.active
    const policy = this.policy()
    const isCurrent = () =>
      !this.isDisposed &&
      !signal.aborted &&
      this.active === active &&
      this.modelId === modelId &&
      this.deps.isWorkspaceTrusted() &&
      this.deps.isPaidFeatureOn('hookModels') &&
      this.policy() === policy
    const [keyDigest, budgetScope] = await unlessStopped(
      Promise.all([this.deps.client.currentKeyDigest(), this.ownedBudgetScope()]),
      signal,
    )
    if (
      !isCurrent() ||
      (budgetScope === undefined && this.deps.sessionBudgetUsd() !== 0) ||
      budgetScope?.isStillAllowed(keyDigest) === false
    ) {
      throw new Error('the hook model call could not start')
    }
    let runHookModel: typeof RunHookModelTurn
    try {
      const entry = await import('./reviewerEntry.js')
      if (typeof entry.runHookModelTurn !== 'function') {
        throw new TypeError('Invalid hook model export')
      }
      runHookModel = entry.runHookModelTurn
    } catch {
      if (signal.aborted) throw new AbortedError()
      this.deps.log.warn('The hook model bundle could not be loaded')
      throw new Error('the hook model bundle could not be loaded')
    }
    if (!isCurrent()) throw new AbortedError()
    // The run is tallied when the gate allowed it; the request observer below
    // counts its attempts for the client's own budget, nothing more.
    const turnId = this.active?.turnId ?? this.turnIds.at(-1) ?? this.sessionId
    return await runHookModel(
      {
        deps: this.deps,
        tools: kind === 'agent' ? this.hookModelTools() : [],
        executeReadOnlyTool: async (name, argsJson, toolSignal) =>
          await this.executeHookModelTool(name, argsJson, toolSignal),
        ...this.paidModelObservers(turnId),
      },
      { kind, system, user },
      event,
      turnId,
      signal,
      {
        modelId,
        keyDigest,
        isStillAllowed: () =>
          isCurrent() &&
          (budgetScope === undefined
            ? this.deps.sessionBudgetUsd() === 0
            : budgetScope.isStillAllowed(keyDigest)),
        onRequestStarted: () => {
          // Hook runs are counted by the consenting dispatcher.
        },
      },
      budgetScope,
      isCurrent,
    )
  }

  /** The IDE tool in process, or the MCP server's tool over its connection (M50). */
  private async performExternal(
    itemId: string,
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
      return toolFailure(`${call.name} ${MODEL_API_MODEL_TEXT.mcpToolUnavailable}`)
    }
    this.noteProcessRan()
    // This call's elicitations are answered in this session (M91 lane M),
    // with the form under this tool's row. Never auto-accepted: the route
    // only asks, in every approval mode.
    const route: McpElicitationHandler = (request) => this.runElicitation(itemId, request)
    const outcome = await servers.call(call.name, call.arguments, signal, route)
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

  private childEvent(child: ChildRecord, event: AgentEvent, wasIdleChecked = false): void {
    if (
      !wasIdleChecked &&
      event.type === 'turnCompleted' &&
      event.terminal === COMPLETED &&
      this.enabledExtensionHooks().some((hook) => hook.event === 'TeammateIdle')
    ) {
      void this.keepIdleChild(child)
        .then((kept) => {
          if (!kept) this.childEvent(child, event, true)
        })
        .catch(() => {
          this.deps.log.warn('A background TeammateIdle hook failed')
          this.childEvent(child, event, true)
        })
      return
    }
    if (event.type === 'turnStarted') {
      child.chargedGoalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    } else if (event.type === 'tokenUsage') {
      const latest = child.session.usage
      const inputDelta = latest.inputTokens - child.usage.inputTokens
      const outputDelta = latest.outputTokens - child.usage.outputTokens
      const cachedDelta = latest.cachedTokens - child.usage.cachedTokens
      // The child owns its charge in the parent's shared journal. Here its
      // deltas update the parent's displayed totals, without charging twice.
      const costUsd = estimateCostUsd(
        { inputTokens: inputDelta, outputTokens: outputDelta, cachedTokens: cachedDelta },
        child.session.sendingModelId ?? child.session.modelId,
      )
      const nextUsage = {
        inputTokens: this.usage.inputTokens + inputDelta,
        outputTokens: this.usage.outputTokens + outputDelta,
        cachedTokens: this.usage.cachedTokens + cachedDelta,
        reasoningTokens:
          this.usage.reasoningTokens + latest.reasoningTokens - child.usage.reasoningTokens,
      }
      if (
        [
          ...Object.values(nextUsage),
          nextUsage.inputTokens + nextUsage.outputTokens,
          this.budgetSpentUsd + costUsd,
          this.turnCostUsd + costUsd,
        ].some((value) => !(Number.isFinite(value) && value >= 0))
      ) {
        this.deps.log.warn('Child usage whose totals or cost are not finite was ignored')
        child.usage = { ...latest }
        return
      }
      this.budgetSpentUsd += costUsd
      this.chargeChildGoal(child, inputDelta + outputDelta)
      if (this.active?.turnId === child.parentTurnId) {
        this.turnCostUsd += costUsd
      }
      this.usage = nextUsage
      child.usage = { ...latest }
      this.emitUsage()
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
      const replied = child.session.hookReplyFor(event.turnId) ?? reply?.item.text
      const text =
        (isTaskRefusal ? event.reason : (replied ?? event.reason)) ??
        MODEL_API_MODEL_TEXT.subagentNoReply
      const modelText = isTaskRefusal ? (modelChildFailure(event.errorKind, text) ?? text) : text
      child.result = {
        summary: text.slice(0, SUBAGENT_SUMMARY_MAX_CHARS),
        ...(text !== '' && { text: text.slice(0, SUBAGENT_RESULT_TEXT_MAX_CHARS) }),
        ...(event.errorKind !== undefined && { errorKind: event.errorKind }),
      }
      this.pendingChildResults.push({
        childId: child.id,
        text: `${MODEL_API_MODEL_TEXT.subagentResult}\n${child.id}: ${JSON.stringify({ ...child.result, summary: modelText.slice(0, SUBAGENT_SUMMARY_MAX_CHARS), text: modelText.slice(0, SUBAGENT_RESULT_TEXT_MAX_CHARS) })}`,
        revision: child.policyRevision,
      })
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

  /** A hidden continuation uses the original consent and its remaining request bound. */
  private canContinueChild(child: ChildRecord, grant: ChildTaskGrant): boolean {
    return (
      !this.isDisposed &&
      !this.isHostClosing() &&
      child.state === 'running' &&
      this.children.get(child.id) === child &&
      child.session.childTaskGrant === grant &&
      child.nextTaskGrant === undefined
    )
  }

  private async keepIdleChild(child: ChildRecord): Promise<boolean> {
    let siblings = 0
    for (const other of this.children.values()) {
      if (other === child || other.state !== 'running') continue
      siblings += 1
    }
    const keeps = this.teammateKeeps.get(child.id) ?? 0
    const grant = child.session.childTaskGrant
    if (
      siblings === 0 ||
      grant === undefined ||
      keeps >= HOOK_MAX_STOP_CONTINUATIONS ||
      grant.remainingAttempts <= 0 ||
      !this.canContinueChild(child, grant)
    )
      return false
    const verdict = await this.fireExtensionHooks(
      'TeammateIdle',
      undefined,
      { name: child.id, siblings_running: siblings },
      child.id,
      undefined,
    )
    if (verdict?.keepWorking !== true || !this.canContinueChild(child, grant)) return false
    const keyDigest = await this.deps.client.currentKeyDigest()
    if (
      this.childGrantRefusal(grant, keyDigest, child.session.modelId) !== undefined ||
      !this.canContinueChild(child, grant)
    )
      return false
    this.teammateKeeps.set(child.id, keeps + 1)
    const reason = verdict.keepReason ?? MODEL_API_MODEL_TEXT.hookTeammateContinue
    await child.session.submitTurn(
      [{ type: 'text', text: reason }],
      undefined,
      false,
      undefined,
      true,
    )
    this.emit({
      type: 'backendNotice',
      level: 'info',
      text: fill(UI_TEXT.hookTeammateKept, { name: child.id, reason }),
    })
    return true
  }

  private installChildGrant(child: ChildRecord, grant: ChildTaskGrant): void {
    if (child.session.activeTurnId === undefined) {
      child.session.childTaskGrant = grant
    } else {
      child.nextTaskGrant = grant
    }
  }

  /**
   * The custom agent a spawn names (M76): undefined when it names none, or
   * why it cannot run. Restricted Mode offers none. A name resolves only
   * when every root of higher precedence than its definition loaded: one
   * that did not refuses the name, naming that root, and a broader lower
   * definition never stands in for it (RV70x).
   */
  private spawnAgentOf(
    agentId: string | undefined,
  ): { readonly agent: AgentDefinition | undefined } | { readonly refusal: ToolOutcome } {
    if (agentId === undefined) {
      return { agent: undefined }
    }
    // Agent files load only in a trusted workspace; a session that began
    // trusted and lost it offers none either (Restricted Mode, D13).
    if (!this.deps.isWorkspaceTrusted()) {
      return { refusal: subagentFailure(MODEL_API_MODEL_TEXT.agentRestrictedMode) }
    }
    const resolved = this.context.agent(agentId)
    if (resolved.kind === 'found') {
      return { agent: resolved.agent }
    }
    if (resolved.kind === 'unknown') {
      return { refusal: subagentFailure(`unknown agent "${agentId}"`) }
    }
    const { hole } = resolved
    return {
      refusal: subagentFailure(
        fill(MODEL_API_MODEL_TEXT.agentUnloaded, {
          id: agentId,
          source: AGENT_SOURCE_LABELS[hole.source],
        }),
        fill(UI_TEXT.agentUnloaded, { id: agentId, path: hole.path }),
      ),
    }
  }

  /**
   * The tools a spawn with this agent keeps: its list met with the tools a
   * child is offered (M76), undefined for the session's own set, or an error
   * when they meet nothing.
   */
  private agentToolAllowlist(
    agent: AgentDefinition | undefined,
  ): { readonly tools: readonly string[] | undefined } | { readonly error: string } {
    const tools = narrowTools(this.offeredToolNames(), agent?.tools)
    return agent !== undefined && tools?.length === 0
      ? { error: `agent "${agent.id}" names no tools this session offers` }
      : { tools }
  }

  /**
   * A spawn under a `command_id` already used (M76 review, RV70x): an exact
   * retry (the same role, objective and agent) answers with that child's id
   * and state before any new-child admission, since it starts nothing and
   * needs none of a new child's capabilities; another task under the id is
   * refused. Undefined when the id is new or absent.
   */
  private existingSpawn(args: SpawnArgs): ToolOutcome | undefined {
    const prior =
      args.command_id === undefined ? undefined : this.spawnCommands.get(args.command_id)
    const child = prior === undefined ? undefined : this.childById(prior)
    if (child === undefined) {
      return undefined
    }
    if (
      child.role !== args.role ||
      child.objective !== args.objective ||
      child.agentId !== args.agent
    ) {
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

  /**
   * A new child's static admission (M76 review, RV70x): what its arguments
   * ask for (isolation), the conversation's limit, the agent it names and
   * the tools that agent meets, then its task's paid gates. Nothing here
   * waits, and a spawn any of it refuses is asked nothing.
   */
  private admitNewSpawn(
    call: FunctionCallItem,
    args: SpawnArgs,
  ):
    | { readonly agent: AgentDefinition | undefined; readonly task: SubagentTaskConfirmation }
    | { readonly refusal: CallResult } {
    if (args.worktree_isolation !== undefined && args.worktree_isolation !== false) {
      return {
        refusal: {
          outcome: subagentFailure('worktree isolation is unavailable on this backend'),
          isRejected: false,
        },
      }
    }
    if (this.children.size >= SUBAGENT_MAX_PER_CONVERSATION) {
      return {
        refusal: {
          outcome: subagentFailure('subagent limit reached for this conversation'),
          isRejected: false,
        },
      }
    }
    const named = this.spawnAgentOf(args.agent)
    if ('refusal' in named) {
      return { refusal: { outcome: named.refusal, isRejected: true } }
    }
    // A list that meets none of the offered tools can never run.
    const tools = this.agentToolAllowlist(named.agent)
    if ('error' in tools) {
      return { refusal: { outcome: subagentFailure(tools.error), isRejected: true } }
    }
    const task = this.childTaskFor(call, named.agent)
    if (task === undefined) {
      return {
        refusal: { outcome: subagentFailure('invalid subagent_spawn arguments'), isRejected: true },
      }
    }
    const gate = this.childTaskGate(task.modelId)
    return gate === undefined
      ? { agent: named.agent, task }
      : { refusal: { outcome: childTaskFailure(gate), isRejected: true } }
  }

  /** Every new task buys a fresh bounded grant; a running note does not. */
  private childTaskFor(
    call: FunctionCallItem,
    agent: AgentDefinition | undefined,
  ): SubagentTaskConfirmation | undefined {
    if (call.name === MODEL_API_SUBAGENT_TOOLS.spawn) {
      const parsed = spawnArgs.safeParse(argumentsOf(call))
      return parsed.success
        ? {
            role: parsed.data.role,
            objective: parsed.data.objective,
            modelId: resolveAgentModel(this.modelId, agent?.model),
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
      // A follow-up continues the child's own run: a custom agent's model, not the session's.
      modelId: child.session.modelId,
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
    // A confidential workspace enabled after the grant still blocks a
    // contributor-tier child at validation and at queued start (M76 review).
    if (grant.modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX) && this.deps.isConfidentialWorkspace()) {
      return 'contributorBlocked'
    }
    if (childModelId !== grant.modelId || this.modelId !== grant.parentModelId) {
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

  /**
   * A child task's paid gates, checked before anything is asked: paid
   * subagents on, a goal with budget left, a verified price, and (a model a
   * custom agent names passes the checks of the user's own choice, M76) no
   * contributor model in a confidential workspace.
   */
  private childTaskGate(modelId: string): ChildTaskRefusal | undefined {
    if (!this.deps.isPaidFeatureOn('subagents')) {
      return 'paidOff'
    }
    if (this.goal?.status === GOAL_STATUS.budgetLimited) {
      return 'goalEnded'
    }
    if (modelApiPaidTier(modelId) === undefined) {
      return 'tariffUnknown'
    }
    return modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX) && this.deps.isConfidentialWorkspace()
      ? 'contributorBlocked'
      : undefined
  }

  /** The grant a child task's consent buys: what its rechecks compare the session against. */
  private async newChildGrant(modelId: string): Promise<ChildTaskGrant> {
    const parentModelId = this.modelId
    const goalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    const isWebSearchAllowed =
      this.active?.isWebSearchAllowed ?? this.deps.isPaidUseRemembered('webSearch')
    return {
      modelId,
      parentModelId,
      keyDigest: await this.deps.client.currentKeyDigest(),
      goalId,
      remainingAttempts: SUBAGENT_TASK_MAX_REQUESTS,
      isWebSearchAllowed,
    }
  }

  /**
   * Everything a wait may have changed (M76 review, RV70x), checked after
   * each wait of a child task's admission and once more before it starts:
   * the workspace's trust for a custom agent; the grant's gates (Plan, paid
   * subagents on, the price, a contributor model in a confidential
   * workspace, the model, the key, the goal); and the tools the agent meets.
   * Only the key's read waits, first: the checks after it are synchronous,
   * so the next question, popup or start sees what they saw.
   */
  private async recheckAdmission(
    grant: ChildTaskGrant,
    agent: AgentDefinition | undefined,
  ): Promise<ChildAdmission | { readonly refusal: ToolOutcome }> {
    let keyDigest: string | undefined
    try {
      keyDigest = await this.deps.client.currentKeyDigest()
    } catch (error: unknown) {
      if (!(error instanceof MissingApiKeyError)) {
        throw error
      }
    }
    if (agent !== undefined && !this.deps.isWorkspaceTrusted()) {
      return { refusal: subagentFailure(MODEL_API_MODEL_TEXT.agentRestrictedMode) }
    }
    const refusal = this.childGrantRefusal(grant, keyDigest, grant.modelId)
    if (refusal !== undefined) {
      return { refusal: childTaskFailure(refusal) }
    }
    const tools = this.agentToolAllowlist(agent)
    return 'error' in tools
      ? { refusal: subagentFailure(tools.error) }
      : { grant, tools: tools.tools }
  }

  /**
   * A child task's admission past its static checks, in one order (M76
   * review, RV70x): the grant (the key's read), then each wait in turn, with
   * recheckAdmission after every one, so no question or popup is shown for
   * a task an earlier wait already made invalid. The caller starts the child
   * on the last recheck's result with nothing awaited between them.
   */
  private async consentToChildTask(
    task: SubagentTaskConfirmation,
    agent: AgentDefinition | undefined,
    waits: readonly AdmissionWait[],
  ): Promise<ChildAdmission | { readonly refusal: ToolOutcome }> {
    const grant = await this.newChildGrant(task.modelId)
    let checked = await this.recheckAdmission(grant, agent)
    for (const wait of waits) {
      if ('refusal' in checked) {
        return checked
      }
      const refusal = await wait()
      if (refusal !== undefined) {
        return { refusal }
      }
      checked = await this.recheckAdmission(grant, agent)
    }
    return checked
  }

  /**
   * The contributor yes a child task's model needs (M76): asked for every
   * spawn, and for a follow-up when this session was never given it (a
   * child resumed in a new window). No wait for any other model. A Stop
   * preempts the modal mid-turn like any wait.
   */
  private contributorWaits(
    modelId: string,
    isSpawn: boolean,
    signal: AbortSignal | undefined,
  ): readonly AdmissionWait[] {
    if (
      !modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX) ||
      (!isSpawn && this.confirmedContributorModels.has(modelId))
    ) {
      return []
    }
    return [
      async () => {
        const asking = this.deps.confirmContributorModel(modelId)
        const isConfirmed =
          signal === undefined ? await asking : await unlessStopped(asking, signal)
        if (isConfirmed) {
          this.confirmedContributorModels.add(modelId)
        }
        return isConfirmed ? undefined : childTaskFailure('consentDeclined')
      },
    ]
  }

  /**
   * What a model's child task asks through (M48, M58, M76): the contributor
   * yes when its model needs one, the PermissionRequest hooks (which may
   * deny a paid task, never allow it), then the paid-use popup. It asks even
   * when subagents are allowed always for a model other than the session's,
   * since "always" was given for the model the user saw priced (D48), and
   * whenever a hook demands a question.
   */
  private modelChildTaskWaits(
    call: FunctionCallItem,
    signal: AbortSignal,
    task: SubagentTaskConfirmation,
    isSpawn: boolean,
    shouldForceApproval: boolean,
  ): readonly AdmissionWait[] {
    return [
      ...this.contributorWaits(task.modelId, isSpawn, signal),
      async () => {
        const hook = await this.permissionRequestHook(call, signal)
        return hook.blockedReason === undefined
          ? undefined
          : refusedOutcome(call, hook.blockedReason, true)
      },
      async () => {
        const isAllowed = await this.askPaidUse(
          call,
          signal,
          { feature: 'subagents', task },
          shouldForceApproval || task.modelId !== this.modelId,
        )
        return isAllowed ? undefined : childTaskFailure('consentDeclined')
      },
    ]
  }

  /** A user-owned follow-up or reopen gets the paid-use popup (M58), admitted in the same order. */
  private async confirmOwnerChildTask(
    child: ChildRecord,
    objective: string,
  ): Promise<ChildTaskGrant> {
    // A follow-up continues the child's own run: a custom agent's model, not the session's.
    const task: SubagentTaskConfirmation = {
      role: child.role,
      objective,
      modelId: child.session.modelId,
      attemptLimit: SUBAGENT_TASK_MAX_REQUESTS,
    }
    const gate = this.childTaskGate(task.modelId)
    const admitted =
      gate === undefined
        ? await this.consentToChildTask(task, undefined, [
            ...this.contributorWaits(task.modelId, false, undefined),
            async () => {
              // "Always" was given for the model the user saw priced: a child
              // on another one (an agent file named it) asks again (M76, D48).
              const isAllowed = await this.deps.allowsPaidUse(
                { feature: 'subagents', task },
                task.modelId !== this.modelId,
                this.askingSessionId,
              )
              return isAllowed ? undefined : childTaskFailure('consentDeclined')
            },
          ])
        : { refusal: childTaskFailure(gate) }
    if ('refusal' in admitted) {
      throw new Error(admitted.refusal.visibleOutput)
    }
    return admitted.grant
  }

  /** The exact task text sent after queued notes are added to a child turn. */
  private queuedChildTask(child: ChildRecord, additions: readonly string[]): string {
    const parts = child.session.turnCount === 0 ? [child.objective, ...additions] : additions
    return parts.join('\n\n') || MODEL_API_MODEL_TEXT.subagentResume
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
        this.pendingChildResults.push({
          childId: child.id,
          text: `${MODEL_API_MODEL_TEXT.subagentResult}\n${child.id}: ${JSON.stringify({ summary: messages.model, text: messages.model, errorKind: `subagent_${refusal}` })}`,
          revision: child.policyRevision,
        })
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
        [{ type: 'text', text: `${MODEL_API_MODEL_TEXT.subagentObjective}\n\n${task}` }],
        task,
      )
    }
  }

  /**
   * subagent_spawn's admission, in one order (M76 review, RV70x):
   * 1. the mode (Plan refuses every spawn, a retry included), then a
   *    `command_id` already used: an exact retry answers with its child
   *    before any new-child admission, another task under it is refused;
   * 2. a new child's static admission (admitNewSpawn), which waits on
   *    nothing: isolation, the limit, the agent and its tools, the paid gates;
   * 3. the waits (the contributor yes, the PermissionRequest hooks, the
   *    paid-use popup), each followed by recheckAdmission;
   * 4. the child starts on what the last recheck admitted, the mode judged
   *    once more and the file policy's revision taken (M78), with nothing
   *    awaited in between.
   */
  private async decideAndRunSpawn(
    turnId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    shouldForceApproval: boolean,
    slot: AdmissionSlot,
  ): Promise<CallResult> {
    const parsed = spawnArgs.safeParse(argumentsOf(call))
    if (!parsed.success) {
      return { outcome: subagentFailure('invalid subagent_spawn arguments'), isRejected: true }
    }
    const query: PermissionQuery = { toolName: call.name, toolClass: 'spawn' }
    const judgement = this.judgementWithHook(query, shouldForceApproval)
    if (judgement.verdict === 'deny') {
      return await this.refused(call, judgement, signal)
    }
    const existing = this.existingSpawn(parsed.data)
    if (existing !== undefined) {
      return { outcome: existing, isRejected: false }
    }
    const admitted = this.admitNewSpawn(call, parsed.data)
    if ('refusal' in admitted) {
      return admitted.refusal
    }
    const consent = await this.consentToChildTask(
      admitted.task,
      admitted.agent,
      this.modelChildTaskWaits(call, signal, admitted.task, true, shouldForceApproval),
    )
    if ('refusal' in consent) {
      return { outcome: consent.refusal, isRejected: true }
    }
    // The waits may have changed the mode: judged again, as every call is
    // after its card, and the child runs under the policy revision of now.
    signal.throwIfAborted()
    const current = this.permissions.judge(query, this.policy())
    if (
      current.verdict === 'deny' ||
      (judgement.verdict === 'allow' && current.verdict === 'ask')
    ) {
      return await this.refused(call, current, signal)
    }
    const admission = this.admitted(query, current)
    slot.admission = admission
    return {
      outcome: this.spawnChild(parsed.data, turnId, consent, admitted.agent, admission.revision),
      isRejected: false,
    }
  }

  /**
   * Starts a child decideAndRunSpawn admitted, on what its last recheck
   * found, with nothing awaited since. A custom agent narrows the run to its
   * prompt, tools, model, effort and permissions; what it asks beyond the
   * session is refused, never widened (M76).
   */
  private spawnChild(
    args: SpawnArgs,
    turnId: string,
    admission: ChildAdmission,
    spawnAgent: AgentDefinition | undefined,
    policyRevision: string,
  ): ToolOutcome {
    const { grant } = admission
    const modelId = grant.modelId
    const mode = this.isSideChat
      ? 'denyUnmatched'
      : narrowApprovalMode(this.permissions.currentMode, spawnAgent?.approvalMode)
    const id = `${SUBAGENT_ID_PREFIX}${String(this.children.size + 1)}`
    const child = new ModelApiSession(
      `${this.sessionId}:${id}`,
      modelId,
      mode,
      this.deps,
      () => {
        this.touch()
      },
      // A child snapshot lives in its parent's stored session.
      (kind) => this.onPersisted(kind),
      NO_CHILD_DISPOSAL,
      this.isHostClosing,
      true,
      this,
      id,
      this.hooks,
      'startup',
      this.isSideChat,
      this.workspaceEdits,
      spawnAgent === undefined
        ? undefined
        : {
            id: spawnAgent.id,
            source: spawnAgent.source,
            prompt: spawnAgent.body,
            toolAllowlist: admission.tools,
            effort: resolveAgentEffort(modelId, spawnAgent.effort),
            approvalMode: spawnAgent.approvalMode,
            permissionMode: spawnAgent.permissionMode,
          },
      isReviewerRole(args.role),
      // A subagent shares its parent's extension snapshot (M91 lane E).
      this.extensionHooks,
    )
    child.childTaskGrant = grant
    child.topTurn = { checkpoint: this.active?.checkpoint }
    const record: ChildRecord = {
      id,
      role: args.role,
      objective: args.objective,
      agentId: spawnAgent?.id,
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
      policyRevision,
    }
    child.onEvent((event) => {
      this.childEvent(record, event)
    })
    this.children.set(id, record)
    if (args.command_id !== undefined) {
      this.spawnCommands.set(args.command_id, id)
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
        touched: childResultsTouched([child]),
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
      touched: childResultsTouched([child]),
    }
  }

  /** The subagent tools but spawn, which decideAndRunSpawn admits and starts. */
  private async runSubagentTool(
    call: FunctionCallItem,
    signal: AbortSignal,
    grant?: ChildTaskGrant,
  ): Promise<ToolOutcome> {
    if (this.isSubagent) {
      return subagentFailure('a subagent cannot spawn or control other subagents')
    }
    const args = argumentsOf(call)
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
      const listed: ChildRecord[] = []
      for (const child of this.children.values()) {
        if (parsed.data.subagent_id !== undefined && child.id !== parsed.data.subagent_id) {
          continue
        }
        const statusFilter = parsed.data.status_filter
        if (statusFilter && statusFilter !== 'all' && child.state !== statusFilter) {
          continue
        }
        listed.push(child)
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
        touched: childResultsTouched(listed),
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
        touched: childResultsTouched([child]),
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
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
    isAllowed: CallAdmission,
    admission: Admission,
    turnId: string,
    childGrant?: ChildTaskGrant,
    approvedTarget?: { readonly absolute: string; readonly checkedAbsolute: string },
    approvedImagePlan?: ImagePlan,
  ): Promise<Performed> {
    const external = this.externalTool(call.name)
    if (external !== undefined) {
      return { outcome: await this.performExternal(itemId, external, call, signal) }
    }
    if (isSubagentTool(call.name)) {
      return { outcome: await this.runSubagentTool(call, signal, childGrant) }
    }
    switch (call.name) {
      case MODEL_API_TOOLS.askUser: {
        return { outcome: await this.askUser(itemId, call, signal) }
      }
      case MODEL_API_TOOLS.todoWrite: {
        return { outcome: await this.writeTodos(call, turnId, signal) }
      }
      case MODEL_API_TOOLS.readSkill: {
        return { outcome: await this.readSkill(call, turnId, signal) }
      }
      case MODEL_API_TOOLS.recallOutput: {
        return { outcome: this.recallPacked(call) }
      }
      case MODEL_API_TOOLS.generateImage:
      case MODEL_API_TOOLS.editImage: {
        return {
          outcome:
            approvedImagePlan === undefined
              ? toolFailure(MODEL_TEXT.imageGenerationOff)
              : await this.makeImage(approvedImagePlan, signal, admission),
        }
      }
      case MODEL_API_TOOLS.createGoal:
      case MODEL_API_TOOLS.updateGoal:
      case MODEL_API_TOOLS.reportProgress: {
        if (goalCommandRevision !== this.goalCommandRevision) {
          return {
            outcome: {
              output: `Error: ${MODEL_API_MODEL_TEXT.goalRequestSuperseded}`,
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
        return await this.runShellCall(itemId, call, signal, isAllowed, admission)
      }
      case VERIFY_TOOLS.runChecks: {
        return await this.runChecksCall(itemId, call, signal, isAllowed)
      }
      default: {
        const intelTool = codeIntelToolOf(call.name)
        if (intelTool !== undefined && intelTool !== 'renameSymbol') {
          return { outcome: await this.readCode(intelTool, call, signal) }
        }
        const assertCanWrite = this.editAdmission(call, isAllowed)
        const formatter = this.formatter(assertCanWrite)
        return {
          outcome: await executeTool(call.name, call.arguments, {
            ...this.fileToolContext(signal),
            assertCanWrite,
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
  private editAdmission(
    call: FunctionCallItem,
    isCurrent: () => boolean,
  ): NonNullable<EditFormatter['assertCanWrite']> {
    return (target) => {
      if (
        !isCurrent() ||
        this.deps.io.hasUnsavedChanges(target.absolute) ||
        this.deps.io.hasUnsavedChanges(target.checkedAbsolute) ||
        this.judgementWithHook({ toolName: call.name, toolClass: 'edit' }, false).verdict ===
          'deny' ||
        this.policy().files.isDenied([target.relative, target.canonical])
      )
        throw new AbortedError()
    }
  }

  private verificationAdmission(signal: AbortSignal): CallAdmission {
    const active = this.active
    const mode = this.permissions.currentMode
    const wasTrusted = this.deps.isWorkspaceTrusted()
    return (canRunDetached = false) =>
      (canRunDetached || (!signal.aborted && this.active === active)) &&
      !this.isDisposed &&
      !this.isHostClosing() &&
      this.permissions.currentMode === mode &&
      this.deps.isWorkspaceTrusted() === wasTrusted
  }

  private refusedDiagnostics(files: readonly EditedFile[]): PendingReport {
    return {
      report: { text: MODEL_API_MODEL_TEXT.verifyAccessRefused, unchecked: files.length },
      commit: NOTHING_TO_COMMIT,
    }
  }

  private formatter(
    assertCanWrite: NonNullable<EditFormatter['assertCanWrite']>,
  ): EditFormatter | undefined {
    const verify = this.deps.verify
    if (verify?.isFormatOnEdit() !== true || !this.deps.isWorkspaceTrusted()) return undefined
    const warn = (message: string) => {
      this.deps.log.warn(message)
    }
    return {
      assertCanWrite,
      format: async (target, text) => {
        assertCanWrite(target)
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
    policy: PermissionPolicy = this.policy(),
  ): Promise<{ readonly skip: CheckSkip; readonly detail?: string } | undefined> {
    const shell = shellToolFor(this.deps.platform)
    // Keyed apart from the shell tool: a check's grant never answers for the
    // model's own shell call of the same command (PR #54, fourth Codex round).
    const query: PermissionQuery = {
      toolName: VERIFY_COMMAND_RULE_KEY,
      toolClass: 'shell',
      command: request.ruleCommand,
      dialect: this.deps.platform === 'win32' ? 'powershell' : 'bash',
    }
    let judgement = this.permissions.judge(query, policy)
    // Standing policy judges the actual expanded line; check-session grants keep their separate base key.
    const actual = this.permissions.judge({ ...query, command: request.line }, policy)
    if (actual.settledBy !== undefined) judgement = actual
    const permitted =
      this.changesWhatRunsNow(request.ruleCommand) && judgement.settledBy === undefined
        ? verdictFor(this.permissions.currentMode, 'shell')
        : judgement.verdict
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
      request.isForced || this.changesWhatRunsNow(request.ruleCommand),
      { ...judgement, verdict, isReviewable: false },
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
    isAllowed: () => boolean,
    correctionsUsed = 0,
  ): Promise<CommandOutcome> {
    if (!this.deps.isWorkspaceTrusted()) {
      return { kind: 'skipped', skip: 'restricted' }
    }
    // A narrowed custom agent holds neither the shell nor run_checks: what it
    // was never offered is not run for it (M76), before any hook sees it.
    if (!this.canRunVerifyCommands()) {
      return { kind: 'skipped', skip: 'refused', detail: MODEL_API_MODEL_TEXT.agentToolNotOffered }
    }
    const beforePolicy = this.policy()
    const commandAdmission = this.verificationAdmission(signal)
    const isCurrent = () => isAllowed() && commandAdmission() && this.policy() === beforePolicy
    if (!isCurrent()) return { kind: 'skipped', skip: 'refused' }
    const shell = shellToolFor(this.deps.platform)
    const turnId = this.active?.turnId
    if (
      turnId !== undefined &&
      !isToolAllowedBySelection(shell.name, this.toolSelectionFor(turnId))
    ) {
      return { kind: 'skipped', skip: 'hookDenied', detail: UI_TEXT.hookToolRemoved }
    }
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
    if (!isCurrent()) return { kind: 'skipped', skip: 'refused' }
    effects.contexts.push(...pre.contexts)
    if (pre.stopReason !== undefined) {
      // An imported guard that ends the turn (Amp's tool.call `error`, M91b).
      effects.stopReason ??= pre.stopReason
    }
    if (pre.blockedReason !== undefined) {
      return { kind: 'skipped', skip: 'hookDenied', detail: pre.blockedReason }
    }
    let { line, ruleCommand } = request
    if (pre.updatedInput !== undefined) {
      const updated = pre.updatedInput['command']
      if (typeof updated !== 'string' || updated.trim() === '') {
        return {
          kind: 'skipped',
          skip: 'hookDenied',
          detail: MODEL_API_MODEL_TEXT.hookInputNoCommand,
          visibleDetail: UI_TEXT.hookInputNoCommand,
        }
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
    const policy = beforePolicy
    const refusal = await authorizeThenGuard({
      isRuleLapsed: () => this.changesWhatRunsNow(ruleCommand),
      authorize: () => this.authorizeCommand(itemId, authorized, signal, policy),
      guard: async () =>
        isCurrent() && (request.guard === undefined || (await request.guard())) && isCurrent(),
    })
    signal.throwIfAborted()
    if (refusal !== undefined) {
      return { kind: 'skipped', ...refusal }
    }
    if (!isCurrent()) return { kind: 'skipped', skip: 'refused' }
    const startedAt = this.deps.now()
    const result = await this.runCommand(line, request.timeoutMs, signal, () => {
      if (!isCurrent()) throw new AbortedError()
    })
    if (result.isEntryRefused === true) return { kind: 'skipped', skip: 'refused' }
    if (!isCurrent())
      return {
        kind: 'ran',
        line,
        result: { ...result, stdout: MODEL_API_MODEL_TEXT.verifyAccessRefused, stderr: '' },
      }
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
    if (isCurrent()) effects.contexts.push(...post.contexts)
    if (post.stopReason !== undefined) {
      effects.stopReason ??= post.stopReason
    } else if (post.blockedReason !== undefined) {
      effects.messages.push(post.blockedReason)
    }
    if (
      ran.failureReason !== undefined &&
      post.updatedInput !== undefined &&
      post.stopReason === undefined &&
      isCurrent()
    ) {
      const correction = await this.correctionFor(
        {
          type: 'function_call',
          call_id: toolUseId,
          name: shell.name,
          arguments: JSON.stringify(input),
        },
        post.updatedInput,
        correctionsUsed,
        signal,
      )
      if (correction.ok) {
        const args = argumentsOf(correction.call)
        const command = pick(args, 'command')
        if (command === undefined || command.trim() === '') {
          effects.messages.push(refusedCorrection(UI_TEXT.hookInputNoCommand).reason)
        } else {
          return await this.runVerifyCommand(
            itemId,
            {
              ...request,
              line: command,
              ruleCommand: command,
              description: pick(args, 'description') ?? request.description,
            },
            signal,
            effects,
            isAllowed,
            correctionsUsed + 1,
          )
        }
      } else {
        effects.messages.push(correction.reason)
      }
    }
    return {
      kind: 'ran',
      line,
      result: isCurrent()
        ? result
        : { ...result, stdout: MODEL_API_MODEL_TEXT.verifyAccessRefused, stderr: '' },
    }
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
    isAllowed: () => boolean,
  ): Promise<CheckRun> {
    if (!isAllowed() || !this.verificationAllowed(files))
      return skippedCheck(check, 'refused', MODEL_API_MODEL_TEXT.verifyAccessRefused)
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
        guard: async () =>
          isAllowed() &&
          this.verificationAllowed(files) &&
          (check.changedFiles !== true ||
            files.length === 0 ||
            (await this.areStillWhereConfined(files, isAllowed))) &&
          isAllowed() &&
          this.verificationAllowed(files),
      },
      signal,
      effects,
      isAllowed,
    )
    if (outcome.kind === 'skipped') {
      if (outcome.skip === 'rejected') {
        this.ledger.reject(check.name)
      }
      return skippedCheck(check, outcome.skip, outcome.detail)
    }
    const run = finishedCheck(check, outcome.line, outcome.result, timeoutMs, maxChars)
    if (isAllowed()) this.ledger.record(run.summary.outcome, startedOn)
    return run
  }

  /**
   * A check or `then_run` command, as the shell tool runs one (M68). A shell
   * that cannot start is a failed run the model is told about, as the user's
   * own `!` command is (M46), not the end of the turn; one refused before its
   * entry (`ShellEntryError`) is a refusal: no hooks, nothing told to the model.
   */
  private async runCommand(
    line: string,
    timeoutMs: number,
    signal: AbortSignal,
    assertCanRun?: () => void,
  ): Promise<ShellResult> {
    this.noteProcessRan()
    try {
      return await this.deps.io.runShell(
        line,
        this.deps.workspaceRoot,
        timeoutMs,
        signal,
        undefined,
        assertCanRun,
      )
    } catch (error: unknown) {
      return {
        stdout: '',
        stderr: describe(error),
        exitCode: null,
        isTimedOut: false,
        isCancelled: false,
        // Failed before entry: no process existed, so it is a refusal, not a run
        // (no hooks around it, no command failure told to the model).
        ...(error instanceof ShellEntryError && { isEntryRefused: true as const }),
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
    isAllowed: () => boolean,
  ): Promise<readonly CheckRun[]> {
    const runs: CheckRun[] = []
    for (const check of checks) {
      if (isAbortRequested(signal)) {
        throw new AbortedError()
      }
      if (effects.stopReason !== undefined) {
        break
      }
      runs.push(
        isAllowed()
          ? await this.runCheck(itemId, check, files, signal, effects, maxChars, isAllowed)
          : skippedCheck(check, 'refused', MODEL_API_MODEL_TEXT.verifyAccessRefused),
      )
    }
    return runs
  }

  /** The files that still exist: only those reach a check (the M68 review). */
  private verificationAllowed(
    files: readonly EditedFile[],
    signal?: AbortSignal,
    wasTrusted = true,
  ): boolean {
    return (
      signal?.aborted !== true &&
      !this.isDisposed &&
      !this.isHostClosing() &&
      this.deps.isWorkspaceTrusted() === wasTrusted &&
      files.every((file) => !this.policy().files.isDenied([file.relative, file.absolute]))
    )
  }

  private async existingFiles(
    files: readonly EditedFile[],
    isAllowed: () => boolean,
  ): Promise<readonly EditedFile[]> {
    const exists = await Promise.all(
      files.map(async (file) => {
        try {
          if (!isAllowed() || !this.verificationAllowed([file])) return false
          const isExisting = await this.deps.io.pathExists(file.absolute)
          return isExisting && isAllowed() && this.verificationAllowed([file])
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
  private async areStillWhereConfined(
    files: readonly EditedFile[],
    isAllowed: () => boolean,
  ): Promise<boolean> {
    if (!isAllowed()) return false
    const p = pathModule(this.deps.platform)
    try {
      const real = await Promise.all(
        files.map((file) =>
          this.verificationAllowed([file])
            ? this.deps.io.realPath(p.join(this.deps.workspaceRoot, file.relative))
            : Promise.resolve(undefined),
        ),
      )
      return (
        isAllowed() &&
        this.verificationAllowed(files) &&
        files.every((file, index) => real[index] === file.absolute)
      )
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
    isAllowed: () => boolean,
  ): Promise<Performed> {
    if (!this.deps.isWorkspaceTrusted())
      return { outcome: toolFailure(MODEL_API_MODEL_TEXT.checkSkipRestricted) }
    const configured = this.checkCommands()
    if (configured.length === 0) {
      return { outcome: toolFailure(MODEL_API_MODEL_TEXT.runChecksNone) }
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
          fill(MODEL_API_MODEL_TEXT.runChecksUnknown, {
            name: unknown,
            names: configured.map((check) => check.name).join(', '),
          }),
        ),
      }
    }
    const isEditedScope = parsed.args.paths === undefined
    const files: EditedFile[] = []
    if (isEditedScope) {
      files.push(...(await this.existingFiles(this.ledger.editedFiles(), isAllowed)))
    } else {
      const named = parsed.args.paths ?? []
      for (const given of named) {
        if (!isAllowed()) return { outcome: toolFailure(MODEL_API_MODEL_TEXT.verifyAccessRefused) }
        const resolved = await confineWorkspacePath(
          this.deps.workspaceRoot,
          given,
          this.deps.platform,
          this.deps.io,
        )
        if (!isAllowed()) return { outcome: toolFailure(MODEL_API_MODEL_TEXT.verifyAccessRefused) }
        if (!resolved.ok) {
          return { outcome: toolFailure(resolved.reason) }
        }
        const file = { relative: resolved.canonical, absolute: resolved.checkedAbsolute }
        if (!this.verificationAllowed([file]) || this.policy().files.isDenied([resolved.relative]))
          return { outcome: toolFailure(MODEL_API_MODEL_TEXT.verifyAccessRefused) }
        if (!(await this.deps.io.pathExists(resolved.checkedAbsolute))) {
          return {
            outcome: toolFailure(
              fill(MODEL_API_MODEL_TEXT.runChecksMissingPath, { path: resolved.relative }),
            ),
          }
        }
        if (!isAllowed() || !this.verificationAllowed([file]))
          return { outcome: toolFailure(MODEL_API_MODEL_TEXT.verifyAccessRefused) }
        files.push(file)
      }
    }
    const selected = configured.filter((check) => names.includes(check.name))
    const effects = newHookEffects()
    const share = Math.floor(VERIFY_NOTE_MAX_CHARS / Math.max(selected.length, 1))
    const runs = await this.runChecks(itemId, selected, files, signal, effects, share, isAllowed)
    const section = checksSection(runs)
    const checked = files.map((file) => file.relative)
    return {
      outcome: {
        output: `${MODEL_API_MODEL_TEXT.runChecksLead}\n\n${section}`,
        visibleOutput: section,
        verifySummary: { files: checked, checks: runs.map((run) => run.summary) },
        // What the checks ran over; their output may quote any file (M78).
        touched: { names: checked, complete: false },
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
    const judgement = this.judgementWithHook(query, shouldForceApproval)
    if (judgement.verdict === 'deny') {
      return await this.refused(call, judgement, signal)
    }
    if (judgement.verdict === 'allow') {
      return undefined
    }
    const approval = await this.askApproval(
      itemId,
      call,
      signal,
      query,
      { card: subject },
      shouldForceApproval,
      judgement,
    )
    return approval.isApproved
      ? undefined
      : {
          outcome: refusedOutcome(call, approval.feedback, approval.deniedByHook === true),
          isRejected: true,
        }
  }

  /**
   * The permission policy as the settings stand (M78). A problem in them is
   * said once for each value of the settings: to the user in full, and in
   * the log by its kind only (the settings can hold command lines).
   */
  private policy(): PermissionPolicy {
    const { policy, fresh } = this.policies.current()
    for (const problem of fresh) {
      this.deps.log.warn(`Permission settings: ${problem.kind} (shown in the conversation)`)
      this.emit({ type: 'backendNotice', level: 'warning', text: describePolicyProblem(problem) })
    }
    return policy
  }

  /**
   * The live policy fence (M78, the RV78 review and the lead's choke-point
   * decision). The dispatcher asks it of every call's outcome before the
   * outcome is built for the model (`fencedOutcome`); a side effect asks it
   * at the moment it happens: a shell command's process entry, a memory
   * note's write, the image request that carries workspace bytes off the
   * machine. A decision taken before an await never lets the I/O through:
   * the policy as it stands now (its rules, its profile and the mode) and
   * the workspace's trust judge the call again. What ran with no question
   * must still be allowed. An answered ask must not now be refused, nor
   * newly settled by a rule or the profile (a hook's or the Auto reviewer's
   * answer cannot answer that). A call let in while the workspace was
   * trusted needs it trusted still. No file it touches may now be denied,
   * nor read under an extra root the profile no longer has. Undefined while
   * all of that holds; otherwise the refusal that replaces whatever the call
   * produced.
   */
  private policyRefusal(
    admission: Admission,
    names: readonly string[] = [],
    extraRoot?: string,
  ): ToolOutcome | undefined {
    const policy = this.policy()
    const now = this.permissions.judge(admission.query, policy)
    const was = admission.judgement
    const isAdmitted =
      now.verdict === 'allow' ||
      (now.verdict === 'ask' &&
        was.verdict === 'ask' &&
        (now.settledBy === undefined || now.settledBy === was.settledBy))
    const isTrustLost = admission.isTrusted && !this.deps.isWorkspaceTrusted()
    // No names (a shell command) is no file: a deny-all profile denies files, not commands.
    const isFileRefused =
      (names.length > 0 && policy.files.isDenied(names)) ||
      (extraRoot !== undefined && !policy.files.extraRoots.includes(extraRoot))
    return isAdmitted && !isTrustLost && !isFileRefused
      ? undefined
      : policyChangedRefusal(admission.query.toolName)
  }

  /** What let a call in, captured at its admission for the fences that judge it again (M78). */
  private admitted(query: PermissionQuery, judgement: PermissionJudgement): Admission {
    return {
      query,
      judgement,
      isTrusted: this.deps.isWorkspaceTrusted(),
      revision: this.filePolicyRevision(),
    }
  }

  /**
   * The file policy's revision (M78, the RV78g review): a digest of the
   * profile, its deny-read globs, deny-all and extra roots, and the
   * workspace's trust. Any change to any of them is a new revision. A digest
   * rather than a counter, so a child's result stored with its revision is
   * judged by the same rule after a restart, and no glob or root is stored.
   */
  private filePolicyRevision(): string {
    const { profileName, files } = this.policy()
    const facts = [
      profileName ?? null,
      files.denyGlobs,
      files.isDenyAll,
      files.extraRoots,
      this.deps.isWorkspaceTrusted(),
    ]
    return createHash('sha256').update(JSON.stringify(facts)).digest('hex')
  }

  /**
   * Whether work done under each of `revisions` may still reach the model:
   * only while the file policy is that revision now. One nobody recorded
   * (a child or result saved before revisions were) may not.
   */
  private isRevisionCurrent(revisions: readonly (string | undefined)[]): boolean {
    const now = this.filePolicyRevision()
    return revisions.every((revision) => revision === now)
  }

  /**
   * The dispatcher's live policy fence (M78, the lead's choke-point
   * decisions after RV78f and RV78g): every call's outcome, from every tool,
   * built-in or external, judged again synchronously, right before the
   * outcome is built for the model. `policyRefusal` judges its admission and
   * the files it touched. An outcome whose `touched` is not complete (no
   * list, or a command's, a server's, a child's text) cannot name what it
   * quotes, so it fails closed: refused if the file policy's revision moved
   * at all since the call was let in, or since any earlier work it carries
   * (`touched.revisions`). A refusal replaces the outcome, so nothing from
   * the call reaches the model; a read it recorded as seen is forgotten, and
   * a write it had already made is said to stay. A call refused before
   * admission did nothing, and a rejection (`isRejected`) brought nothing
   * back: the caller passes either as it is, in its own words.
   */
  private fencedOutcome(admission: Admission | undefined, outcome: ToolOutcome): ToolOutcome {
    if (admission === undefined) {
      return outcome
    }
    const { touched } = outcome
    const isOpaqueAndMoved =
      touched?.complete !== true &&
      !this.isRevisionCurrent([admission.revision, ...(touched?.revisions ?? [])])
    const refusal =
      this.policyRefusal(admission, touched?.names, touched?.extraRoot) ??
      (isOpaqueAndMoved ? policyChangedRefusal(admission.query.toolName) : undefined)
    if (refusal === undefined) {
      return outcome
    }
    if (touched?.seen !== undefined) {
      this.seenFiles.delete(touched.seen)
    }
    return hasWritten(admission, outcome)
      ? policyChangedAfterWrite(admission.query.toolName, outcome)
      : refusal
  }

  /**
   * The engine's judgement under the policy. A hook may add a card to an
   * allow, never override a denial; a question it demands is the user's,
   * never the Auto reviewer's.
   */
  private judgementWithHook(
    query: PermissionQuery,
    shouldForceApproval: boolean,
    policy: PermissionPolicy = this.policy(),
  ): PermissionJudgement {
    const judged = this.permissions.judge(query, policy)
    if (!shouldForceApproval) {
      return judged
    }
    return judged.verdict === 'allow'
      ? { verdict: 'ask', isReviewable: false, hasSessionChoice: true }
      : { ...judged, isReviewable: false }
  }

  /** A forbid rule's or the mode's outcome for a refused call (M78). */
  private denialOutcome(call: FunctionCallItem, judgement: PermissionJudgement): ToolOutcome {
    return judgement.settledBy === 'forbidRule'
      ? refusedByRule(call, judgement)
      : this.refusedByMode(call).outcome
  }

  private denialReason(call: FunctionCallItem, judgement: PermissionJudgement): string {
    const outcome = this.denialOutcome(call, judgement)
    return outcome.failureReason ?? outcome.output
  }

  /**
   * A refused call: by a forbid rule (M78), or by the mode. Fires
   * PermissionDenied as observation (M91 lane E), with the tool and the
   * reason, never a retry.
   */
  private async refused(
    call: FunctionCallItem,
    judgement: PermissionJudgement,
    signal: AbortSignal,
  ): Promise<CallResult> {
    const outcome = this.denialOutcome(call, judgement)
    await this.notePermissionDenied(call.name, outcome.failureReason ?? outcome.output, signal)
    return { outcome, isRejected: true }
  }

  /**
   * PermissionDenied as observation: the tool when one was refused, the
   * reason, no retry. The active turn, when one runs, takes the context at
   * its tail.
   */
  private async notePermissionDenied(
    toolName: string | undefined,
    reason: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.fireExtensionHooks(
      'PermissionDenied',
      this.active?.turnId,
      permissionDeniedFields({
        ...(toolName !== undefined && { toolName }),
        reason,
      }),
      toolName,
      signal,
    )
  }

  private refusedByMode(call: FunctionCallItem): CallResult {
    return {
      outcome: toolFailure(`${call.name} ${MODEL_API_MODEL_TEXT.toolRefusedByMode}`),
      isRejected: true,
    }
  }

  /**
   * An add may update its index; check both possible targets without an
   * existence shortcut. The refusal, or the fence the call's reads and
   * writes must still pass: every name checked here, under this judgement.
   */
  private async memoryRefusal(
    memory: MemoryStore,
    placed: PlacedMemoryCall,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<{ readonly refusal: CallResult } | { readonly fence: MemoryFence }> {
    const places = [placed.place]
    if (placed.call.tool === 'add' && placed.place.scope === PROJECT_MEMORY_SCOPE) {
      const index = await memory.locate(PROJECT_MEMORY_SCOPE, MEMORY_INDEX_FILE)
      if (!index.ok) return { refusal: { outcome: toolFailure(index.reason), isRejected: true } }
      places.push(index.value)
    }
    const names: string[] = []
    let noteNames: readonly string[] = []
    for (const place of places) {
      if (place.scope !== PROJECT_MEMORY_SCOPE) continue
      const confined = await confineWorkspacePath(
        this.deps.workspaceRoot,
        place.absolute,
        this.deps.platform,
        this.deps.io,
      )
      if (!confined.ok)
        return { refusal: { outcome: toolFailure(confined.reason), isRejected: true } }
      const placeNames = [place.display, confined.relative, confined.canonical]
      if (place === placed.place) noteNames = placeNames
      names.push(...placeNames)
    }
    signal.throwIfAborted()
    if (!this.deps.isWorkspaceTrusted())
      return {
        refusal: {
          outcome: toolFailure(MODEL_API_MODEL_TEXT.memoryRestrictedMode),
          isRejected: true,
        },
      }
    const policy = this.policy()
    const denied = names.find((name) => policy.files.isDenied([name]))
    if (denied !== undefined) return { refusal: { outcome: deniedPath(denied), isRejected: true } }
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: placed.call.tool === 'read' ? 'read' : 'edit',
    }
    const judgement = this.permissions.judge(query, policy)
    return judgement.verdict === 'deny'
      ? { refusal: this.refusedByMode(call) }
      : { fence: { admission: this.admitted(query, judgement), names, noteNames } }
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
    isAllowed: () => boolean,
    slot: AdmissionSlot,
  ): Promise<CallResult> {
    const { memory } = this.deps
    if (memory === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return { outcome: toolFailure(MODEL_API_MODEL_TEXT.memoryRestrictedMode), isRejected: true }
    }
    if (!isAllowed()) throw new AbortedError()
    const placed = await placeMemoryCall(memory, call.name, call.arguments)
    if (!isAllowed()) throw new AbortedError()
    if (!placed.ok) {
      return { outcome: toolFailure(placed.reason), isRejected: false }
    }
    const placedCheck = await this.memoryRefusal(memory, placed.value, call, signal)
    if ('refusal' in placedCheck) return placedCheck.refusal
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
      if (!isAllowed()) throw new AbortedError()
      if (!replaced.ok) {
        return { outcome: toolFailure(replaced.reason), isRejected: false }
      }
      const freshCheck = await this.memoryRefusal(memory, replaced.value, call, signal)
      if ('refusal' in freshCheck) return freshCheck.refusal
      slot.admission = freshCheck.fence.admission
      return {
        outcome: await this.runFencedMemoryCall(
          memory,
          replaced.value,
          isAllowed,
          freshCheck.fence,
        ),
        isRejected: false,
      }
    }
    slot.admission = placedCheck.fence.admission
    return {
      outcome: await this.runFencedMemoryCall(memory, placed.value, isAllowed, placedCheck.fence),
      isRejected: false,
    }
  }

  /**
   * A placed memory call (M78). Its owner (Stop, the turn, the trust) is
   * asked at every MemoryIo read and write; a write is also judged by the
   * live policy fence there, at the moment it happens, and a refusal
   * replaces a write refused before it published. A note already written
   * when its new index line was refused stays reported as written, its index
   * line logged as not written, as an index with unsaved changes is. A read
   * changes nothing: what it read is judged by the dispatcher's fence, which
   * every outcome crosses, over the note's names.
   */
  private async runFencedMemoryCall(
    memory: MemoryStore,
    placed: PlacedMemoryCall,
    isAllowed: () => boolean,
    fence: MemoryFence,
  ): Promise<ToolOutcome> {
    const touched: TouchedFiles = { names: fence.noteNames, complete: true }
    const assertOwner = () => {
      if (!isAllowed() || !this.deps.isWorkspaceTrusted()) throw new AbortedError()
    }
    if (placed.call.tool === 'read') {
      // The store asks the owner around its read and throws a Stop on.
      return { ...(await runMemoryCall(memory, placed, assertOwner)), touched }
    }
    // What the write goes through, taken when the call starts (M86).
    const writes = this.toolWrites()?.memory
    let refusal: ToolOutcome | undefined
    const assertCurrent = () => {
      assertOwner()
      refusal ??= this.policyRefusal(fence.admission, fence.names)
      if (refusal !== undefined) throw new AbortedError()
    }
    let outcome: ToolOutcome
    try {
      outcome = await this.runPlacedMemoryWrite(memory, placed, assertCurrent, writes)
    } catch (error: unknown) {
      if (error instanceof IndexLineStoppedError) {
        // The note is published. A Stop ends the call as a stop (the RV78g
        // review); a refusal of its index line alone keeps it reported written.
        if (refusal === undefined) throw error.stopped
        return { output: error.written, visibleOutput: error.written, touched }
      }
      if (refusal === undefined) throw error
      return refusal
    }
    return refusal !== undefined && outcome.failureReason !== undefined
      ? refusal
      : { ...outcome, touched }
  }

  /** Memory writes can change a check's named input, including a new note's index. */
  private async runPlacedMemoryWrite(
    memory: MemoryStore,
    placed: PlacedMemoryCall,
    assertCurrent: () => void,
    writes: TurnWrites['memory'] | undefined,
  ): Promise<ToolOutcome> {
    assertCurrent()
    const paths = [placed.place.absolute]
    if (placed.call.tool === 'add') {
      const index = await memory.locate(placed.place.scope, MEMORY_INDEX_FILE)
      assertCurrent()
      if (index.ok) {
        paths.push(index.value.absolute)
      }
    }
    const completions: (() => void)[] = []
    try {
      for (const path of paths) {
        assertCurrent()
        const target = await confineWorkspacePath(
          this.deps.workspaceRoot,
          path,
          this.deps.platform,
          this.deps.io,
        )
        assertCurrent()
        if (target.ok) {
          completions.push(
            this.workspaceEdits.beginEdit(
              { relative: target.canonical, absolute: target.checkedAbsolute },
              [target.relative, target.canonical],
            ),
          )
        }
      }
      assertCurrent()
      return await runMemoryCall(memory, placed, assertCurrent, writes)
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
    slot: AdmissionSlot,
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
    const withdrawn = this.networkCallWithdrawn(call, query, signal, webFetchRestricted)
    if (withdrawn !== undefined) {
      return withdrawn
    }
    slot.admission = this.admitted(query, this.permissions.judge(query, this.policy()))
    const result = await fetchPage(url, signal, () => this.isWebFetchStillAllowed(query))
    // Asked again once the page is in: it reaches the model only while web
    // fetch is still allowed.
    return (
      this.networkCallWithdrawn(call, query, signal, webFetchRestricted) ?? {
        outcome: webFetchOutcome(result),
        isRejected: false,
      }
    )
  }

  /** Whether what allowed a web fetch still holds: trust, and a mode that does not refuse it. */
  private isWebFetchStillAllowed(query: PermissionQuery): boolean {
    return this.deps.isWorkspaceTrusted() && this.permissions.verdict(query) !== 'deny'
  }

  /**
   * The refusal for a network call (a web fetch, a browser check) no longer
   * allowed after an await; throws when the turn stopped.
   */
  private networkCallWithdrawn(
    call: FunctionCallItem,
    query: PermissionQuery,
    signal: AbortSignal,
    restricted: () => CallResult,
  ): CallResult | undefined {
    if (signal.aborted) {
      throw new AbortedError()
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return restricted()
    }
    return this.permissions.verdict(query) === 'deny' ? this.refusedByMode(call) : undefined
  }

  /**
   * A browser check (M81, PLAN.md D49): refused in Restricted Mode, and for
   * a call it would refuse anyway, before any card; then judged as a network
   * tool per host, its card naming the URL. A host beyond loopback and the
   * user's setting is reached only once the user allowed it on a card (this
   * call's, or an "always" they chose on one in this session): Bypass alone
   * never widens the check, so the card is asked there too. The setting is
   * read again after the card, and the page reaches the model only while the
   * check is still allowed.
   */
  private async decideAndRunBrowserCheck(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    shouldForceApproval: boolean,
    slot: AdmissionSlot,
  ): Promise<CallResult> {
    const browser = this.deps.browserCheck
    if (browser === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    if (!this.deps.isWorkspaceTrusted()) {
      return browserCheckRestrictedCall()
    }
    const placed = placeBrowserCall(argumentsOf(call), extraHostSet(browser.extraHosts()))
    if (!placed.ok) {
      return { outcome: browserCheckRefused(placed), isRejected: false }
    }
    const { placement, actions } = placed
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: 'network',
      command: placement.approvalHost,
    }
    const isWidening = placement.kind === 'needsWidening'
    const refusal = await this.judge(
      itemId,
      call,
      signal,
      query,
      {
        kind: isWidening ? BROWSER_CHECK_WIDEN_SUBJECT_KIND : BROWSER_CHECK_SUBJECT_KIND,
        target: placement.url,
        toolName: call.name,
      },
      shouldForceApproval || (isWidening && !this.permissions.isAllowedForSession(query)),
    )
    if (refusal !== undefined) {
      return refusal
    }
    const withdrawn = this.networkCallWithdrawn(call, query, signal, browserCheckRestrictedCall)
    if (withdrawn !== undefined) {
      return withdrawn
    }
    slot.admission = this.admitted(query, this.permissions.judge(query, this.policy()))
    // The scope the card covered, frozen now; trust, the mode, the runtime
    // setting and that scope are read again while the check is prepared and
    // runs (M81 A1).
    const scope = browserCheckScope(placement, browser.extraHosts())
    const approvalKey = browserScopeKey(placement.url, scope)
    const admission: CheckAdmission = () => {
      if (
        !this.deps.isWorkspaceTrusted() ||
        !browser.isOffered() ||
        this.permissions.verdict(query) === 'deny'
      ) {
        return 'notOffered'
      }
      const now = browserCheckScope(placement, browser.extraHosts())
      return browserScopeKey(placement.url, now) === approvalKey ? 'ok' : 'scopeChanged'
    }
    // A browser runs, and a page it drives can make a local server change
    // files: a restore says so, as for commands (M86, spec 8).
    this.noteProcessRan()
    const result = await browser.check(
      {
        url: placement.url,
        actions,
        allowedHosts: scope.allowedHosts,
        approvalKey,
        includeScreenshot: true,
        signal,
      },
      admission,
    )
    return (
      this.networkCallWithdrawn(call, query, signal, browserCheckRestrictedCall) ?? {
        outcome: browserCheckOutcome(placement.url, result),
        isRejected: false,
      }
    )
  }

  /**
   * A read-only code intelligence call (M67): a read in every mode, stopped
   * by Stop. Every file the live read guard let it read is what it touched
   * (M78), for the dispatcher's fence.
   */
  private async readCode(
    tool: Exclude<CodeIntelTool, 'renameSymbol'>,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const deps = this.codeIntelDeps()
    if (deps === undefined) {
      return toolFailure(`unknown tool ${call.name}`)
    }
    const names: string[] = []
    const canReadFile: NonNullable<CodeIntelDeps['canReadFile']> = (file) => {
      const isReadable = deps.canReadFile?.(file) !== false
      if (isReadable) {
        names.push(file.relative, file.canonical)
      }
      return isReadable
    }
    const outcome = await unlessStopped(
      runCodeIntelRead(tool, call.arguments, { ...deps, canReadFile }, signal),
      signal,
    )
    // A provider's answer (a hover's text) may quote what no placed file holds.
    return { ...outcome, touched: { names, complete: false } }
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
    isAllowed: () => boolean,
    slot: AdmissionSlot,
  ): Promise<CallResult> {
    const assertFirstWrite = this.editAdmission(call, isAllowed)
    const deps = this.codeIntelDeps()
    if (deps === undefined) {
      return { outcome: toolFailure(`unknown tool ${call.name}`), isRejected: false }
    }
    // Plan refuses every edit: the language service is not even asked then.
    if (
      this.judgementWithHook({ toolName: call.name, toolClass: 'edit' }, false).verdict === 'deny'
    ) {
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
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: 'edit',
      isProtected: isProtectedRename(plan),
    }
    const refusal = await this.judge(
      itemId,
      call,
      signal,
      query,
      { kind: 'fileWrite', path: renameCardPath(plan), toolName: call.name },
      shouldForceApproval,
    )
    if (refusal !== undefined) {
      return refusal
    }
    slot.admission = this.admitted(query, this.permissions.judge(query, this.policy()))
    // Every planned name lapses stale grants before the rechecks await I/O.
    // Only successful native writes enter this session's automatic check round.
    const completions: (() => void)[] = []
    // What the rename read or wrote, each past the live guard (M78's dispatcher fence).
    const touched: string[] = []
    let hasWritten = false
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
        io: this.toolWrites()?.io ?? this.deps.io,
        seen: this.seenFiles,
        signal,
        beforeAccess: (file) => {
          if (
            this.isDisposed ||
            this.isHostClosing() ||
            !this.deps.isWorkspaceTrusted() ||
            this.policy().files.isDenied([file.relative, file.canonical])
          ) {
            throw new CodeIntelRefusal(
              CODE_INTEL_MODEL_TEXT.codeIntelPolicyRefused,
              UI_TEXT.codeIntelPolicyRefused,
            )
          }
          if (!hasWritten) assertFirstWrite(file)
          touched.push(file.relative, file.canonical)
        },
        onWritten: (file) => {
          hasWritten = true
          this.noteEdited(file)
        },
      })
      return {
        outcome: { ...outcome, touched: { names: touched, complete: true } },
        isRejected: false,
      }
    } finally {
      for (const complete of completions) {
        complete()
      }
    }
  }

  /**
   * The permission check and, when it allows, the tool itself. May throw (an
   * abort, an I/O error). Every path that runs the call fills `slot` at its
   * admission, for the dispatcher's fence (M78).
   */
  private async decideAndRun(
    turnId: string,
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
    slot: AdmissionSlot,
    shouldForceApproval = false,
  ): Promise<CallResult> {
    // The Reviewer only reads (M70): a tool it names that is not one of its
    // own is refused, offered or not, in every mode, Bypass included.
    if (this.isReviewing() && !isReviewerTool(call.name)) {
      return {
        outcome: toolFailure(reviewerToolRefusal(call.name)),
        isRejected: true,
      }
    }
    const isAllowed = this.verificationAdmission(signal)
    const external = this.externalTool(call.name)
    if (external !== undefined && this.isSideChat) {
      return {
        outcome: toolFailure(`${call.name} ${MODEL_API_MODEL_TEXT.toolRefusedByMode}`),
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
    // The allowlist binds every dispatcher, including memory's specialized
    // path: definitions alone cannot stop a model calling a tool by name.
    if (this.agent?.toolAllowlist !== undefined && !this.agent.toolAllowlist.includes(call.name)) {
      return {
        outcome: toolFailure(MODEL_API_MODEL_TEXT.agentToolNotOffered, UI_TEXT.agentToolNotOffered),
        isRejected: false,
      }
    }
    if (isMemoryTool(call.name)) {
      return await this.decideAndRunMemory(
        itemId,
        call,
        signal,
        toolClass,
        shouldForceApproval,
        isAllowed,
        slot,
      )
    }
    if (call.name === MODEL_API_TOOLS.browserCheck) {
      return await this.decideAndRunBrowserCheck(itemId, call, signal, shouldForceApproval, slot)
    }
    if (toolClass === 'network') {
      return await this.decideAndRunWebFetch(itemId, call, signal, shouldForceApproval, slot)
    }
    if (call.name === CODE_INTEL_TOOLS.renameSymbol) {
      return await this.decideAndRunRename(
        itemId,
        call,
        signal,
        shouldForceApproval,
        isAllowed,
        slot,
      )
    }
    if (
      this.isSubagent &&
      (isSubagentTool(call.name) ||
        call.name === MODEL_API_TOOLS.askUser ||
        call.name === MODEL_API_TOOLS.todoWrite ||
        call.name === MODEL_API_TOOLS.createGoal ||
        call.name === MODEL_API_TOOLS.getGoal ||
        call.name === MODEL_API_TOOLS.updateGoal ||
        call.name === MODEL_API_TOOLS.reportProgress ||
        call.name === MODEL_API_TOOLS.recallOutput)
    ) {
      return { outcome: subagentFailure('tool unavailable to a subagent'), isRejected: true }
    }
    if (call.name === MODEL_API_SUBAGENT_TOOLS.spawn) {
      return await this.decideAndRunSpawn(turnId, call, signal, shouldForceApproval, slot)
    }
    if ((toolClass === 'shell' || toolClass === 'mcp') && !this.deps.isWorkspaceTrusted()) {
      // Restricted Mode (PLAN.md D13): the tool is not offered, and a model
      // that calls it anyway is refused, never prompted.
      const reason =
        toolClass === 'mcp'
          ? MODEL_API_MODEL_TEXT.mcpRestrictedMode
          : MODEL_API_MODEL_TEXT.shellRestrictedMode
      return { outcome: toolFailure(reason), isRejected: true }
    }
    const policy = this.policy()
    let approvedImagePlan: ImagePlan | undefined
    if (toolClass === 'paid') {
      const prepared = await this.imagePlan(call)
      if (!prepared.ok) {
        return { outcome: toolFailure(prepared.reason), isRejected: false }
      }
      // The permission settings bind the image tools too (M78): an edit
      // sends its sources to Meta, and the image is a file written.
      const denied = [prepared.plan.target, ...prepared.plan.sources].find((file) =>
        policy.files.isDenied([file.relative, file.canonical]),
      )
      if (denied !== undefined) {
        return { outcome: deniedPath(denied.relative), isRejected: true }
      }
      approvedImagePlan = prepared.plan
    }
    const target = toolClass === 'edit' ? await this.editTarget(call) : undefined
    if (target?.ok === false) {
      // A path the tool would refuse anyway is refused before any card.
      return { outcome: toolFailure(target.reason), isRejected: false }
    }
    if (target?.ok === true && policy.files.isDenied([target.relative, target.canonical])) {
      return { outcome: deniedPath(target.relative), isRejected: true }
    }
    // A follow-up that starts a new task is a paid child task like a spawn.
    const childTask = this.childTaskFor(call, undefined)
    const query: PermissionQuery = {
      toolName: call.name,
      toolClass: childTask === undefined ? toolClass : 'spawn',
      command: toolClass === 'shell' ? pick(argumentsOf(call), 'command') : undefined,
      // The shell tool runs the platform's shell, whatever the call is named.
      dialect: this.deps.platform === 'win32' ? 'powershell' : 'bash',
      isProtected:
        target?.ok === true
          ? isProtectedPath(target.canonical)
          : approvedImagePlan !== undefined && isProtectedPath(approvedImagePlan.target.canonical),
      isReadOnly: external?.kind === 'mcp' && external.ref.isReadOnly,
    }
    const judgement = this.judgementWithHook(query, shouldForceApproval, policy)
    if (judgement.verdict === 'deny') {
      return await this.refused(call, judgement, signal)
    }
    if (judgement.settledBy === 'allowRule') {
      // Said on the row, as a card's answer would be: the user's rule ran it.
      this.emit({
        type: 'approvalResolved',
        approvalId: this.deps.newId(),
        itemId,
        decision: DECISION_APPROVED,
        resolvedBy: UI_TEXT.commandRuleResolver,
      })
    }
    const { verdict } = judgement
    let childGrant: ChildTaskGrant | undefined
    if (childTask !== undefined) {
      // The same order as a spawn's (RV70x): the gates, then each wait
      // followed by a recheck. Only a spawn asks the contributor yes every
      // time; a follow-up rides the spawn's unless this session never had it.
      const gate = this.childTaskGate(childTask.modelId)
      const consent =
        gate === undefined
          ? await this.consentToChildTask(
              childTask,
              undefined,
              this.modelChildTaskWaits(call, signal, childTask, false, shouldForceApproval),
            )
          : { refusal: childTaskFailure(gate) }
      if ('refusal' in consent) {
        return { outcome: consent.refusal, isRejected: true }
      }
      childGrant = consent.grant
    } else if (verdict === 'ask') {
      const paid = approvedImagePlan === undefined ? undefined : imageUseRequest(approvedImagePlan)
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
        judgement,
      )
      if (!approval.isApproved) {
        return {
          outcome: refusedOutcome(call, approval.feedback, approval.deniedByHook === true),
          isRejected: true,
        }
      }
    }
    // A child task's grant was rechecked after its last wait (consentToChildTask).
    signal.throwIfAborted()
    const currentPolicy = this.policy()
    const currentJudgement = this.permissions.judge(query, currentPolicy)
    if (
      currentJudgement.verdict === 'deny' ||
      (verdict === 'allow' && currentJudgement.verdict === 'ask')
    ) {
      return await this.refused(call, currentJudgement, signal)
    }
    if ((toolClass === 'shell' || toolClass === 'mcp') && !this.deps.isWorkspaceTrusted()) {
      const modeOutcome = this.refusedByMode(call).outcome
      await this.notePermissionDenied(
        call.name,
        modeOutcome.failureReason ?? modeOutcome.output,
        signal,
      )
      return this.refusedByMode(call)
    }
    const deniedNow =
      target?.ok === true && currentPolicy.files.isDenied([target.relative, target.canonical])
        ? target
        : approvedImagePlan &&
          [approvedImagePlan.target, ...approvedImagePlan.sources].find((file) =>
            currentPolicy.files.isDenied([file.relative, file.canonical]),
          )
    if (deniedNow !== undefined) {
      const denied = deniedPath(deniedNow.relative)
      await this.notePermissionDenied(call.name, denied.failureReason ?? denied.output, signal)
      return { outcome: denied, isRejected: true }
    }
    // What the call's side effects and the dispatcher's fence judge again.
    const admission = this.admitted(query, currentJudgement)
    slot.admission = admission
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
        itemId,
        call,
        signal,
        goalCommandRevision,
        isAllowed,
        admission,
        turnId,
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
          output: `${performed.outcome.output}\n${MODEL_API_MODEL_TEXT.thenRunEditFailed}`,
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
        isAllowed,
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
    target: FormatTarget,
    command: string,
    edit: ToolOutcome,
    signal: AbortSignal,
    isForced: boolean,
    isAllowed: () => boolean,
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
      // then_run is the shell by another name: a narrowed agent without the shell tool has none.
      ran = this.canRunShell()
        ? await this.runVerifyCommand(
            itemId,
            {
              line: command,
              ruleCommand: command,
              description: THEN_RUN_DESCRIPTION,
              timeoutMs: SHELL_DEFAULT_TIMEOUT_MS,
              isForced,
              guard: () => this.isAsEdited(target, isAllowed),
            },
            signal,
            effects,
            isAllowed,
          )
        : {
            kind: 'skipped',
            skip: 'refused',
            detail: MODEL_API_MODEL_TEXT.agentToolNotOffered,
            visibleDetail: UI_TEXT.agentToolNotOffered,
          }
    } catch (error: unknown) {
      if (!(error instanceof AbortedError) && !isAbortRequested(signal)) {
        throw error
      }
      // Stopped at its hooks or its card: the edit happened, so the call keeps
      // its result and its diff; the turn ends when the loop sees the stop.
      return {
        outcome: {
          ...edit,
          output: `${edit.output}\n\n${fill(MODEL_API_MODEL_TEXT.thenRunNotRun, { reason: MODEL_API_MODEL_TEXT.toolCancelledByStop })}`,
          thenRun: { command, outcome: 'cancelled', output: '' },
        },
        hookEffects: effects,
      }
    }
    if (ran.kind === 'skipped') {
      const reason = skipReason(ran.skip, ran.detail)
      // The row's line is in the user's language (verifyText.ts); a hook's or
      // the user's own words are shown as they are.
      const shown = ran.visibleDetail ?? ran.detail
      return {
        outcome: {
          ...edit,
          output: `${edit.output}\n\n${fill(MODEL_API_MODEL_TEXT.thenRunNotRun, { reason })}`,
          thenRun: {
            command,
            outcome: 'notRun',
            skip: ran.skip,
            ...(shown !== undefined && shown.trim() !== '' && { detail: shown }),
            output: '',
          },
        },
        hookEffects: effects,
      }
    }
    const { line, result } = ran
    if (isAllowed()) this.noteCheckCommandRun(line, result, startedOn)
    const finished = shellOutcome(result, SHELL_DEFAULT_TIMEOUT_MS)
    return {
      outcome: {
        ...edit,
        output: `${edit.output}\n\n${MODEL_API_MODEL_TEXT.thenRunLead} $ ${line}\n${finished.output}`,
        // The command's output may quote any file: the outcome can no longer name them all.
        touched: { names: edit.touched?.names ?? [], complete: false },
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
  private async isAsEdited(target: FormatTarget, isAllowed: () => boolean): Promise<boolean> {
    if (!isAllowed() || this.policy().files.isDenied([target.relative, target.canonical]))
      return false
    let current: string | undefined
    try {
      current = await this.deps.io.readFile(target.checkedAbsolute, target.checkedAbsolute)
    } catch (error: unknown) {
      this.deps.log.warn(`then_run's guard could not read the file: ${describe(error)}`)
      return false
    }
    return (
      isAllowed() &&
      !this.policy().files.isDenied([target.relative, target.canonical]) &&
      current !== undefined &&
      fingerprint(current) === this.seenFiles.get(target.absolute)
    )
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
  ): ReplayItem {
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
    return replay
  }

  /**
   * A PostToolUseFailure hook's corrected call (Muse 1.4.0, M91 lane R): the
   * same tool only, as a new call through PreToolUse, policy, path
   * confinement and approval, bounded by HOOK_ON_FAILURE_MAX_DEPTH. A refusal
   * names its reason for the model; the original failure stands.
   */
  private async correctionFor(
    call: FunctionCallItem,
    updatedInput: Record<string, unknown>,
    correctionsUsed: number,
    signal: AbortSignal,
  ): Promise<{ ok: true; call: FunctionCallItem } | { ok: false; reason: string }> {
    signal.throwIfAborted()
    if (correctionsUsed >= HOOK_ON_FAILURE_MAX_DEPTH) {
      return refusedCorrection(plural(UI_TEXT.hookCorrectionTooDeep, HOOK_ON_FAILURE_MAX_DEPTH))
    }
    const { tool_name: named, ...args } = updatedInput
    // updatedInput replaces the arguments; only a tool_name restating this
    // same tool may ride along. Anything else naming a tool is refused: the
    // correction never switches tools.
    if (named !== undefined && (typeof named !== 'string' || named !== call.name)) {
      return refusedCorrection(UI_TEXT.hookCorrectionOtherTool)
    }
    const corrected: FunctionCallItem = { ...call, arguments: JSON.stringify(args) }
    // The full path re-vets the corrected call, but a path outside the
    // workspace is refused here with its reason instead of running at all. A
    // memory note's path is under its scope's root, not the workspace.
    if (isMemoryTool(call.name)) {
      signal.throwIfAborted()
      return { ok: true, call: corrected }
    }
    const target = await this.editTarget(corrected)
    if (target !== undefined && !target.ok) {
      return refusedCorrection(UI_TEXT.hookCorrectionOutside)
    }
    signal.throwIfAborted()
    return { ok: true, call: corrected }
  }

  /**
   * A corrected call supersedes its failed attempt: the row stays in History,
   * but its output and trailing hook context leave replay so one call_id
   * answers once, before any replacement context the model will read.
   */
  private supersedeReplayOutput(replay: ReplayItem, outcome: ToolOutcome): void {
    const index = this.replay.indexOf(replay)
    if (index !== -1) {
      this.replay.splice(index)
    }
    this.pendingOutputMedia.delete(replay)
    if (outcome.visibleFile === undefined) {
      return
    }
    const queued = this.readFiles.lastIndexOf(outcome.visibleFile)
    if (queued !== -1) {
      this.readFiles.splice(queued, 1)
    }
  }

  /**
   * An imported PostToolUse hook's documented replacement of what the model
   * sees (Cursor `updated_mcp_tool_output`, Copilot `modifiedResult`; M91
   * lane W, D70 SoL-Pi rule 2). It replaces the call's replay output in
   * place, before the next request is built, so packing archives what the
   * model saw and `recall_output` returns those bytes. Anything the call had
   * queued behind its output (an image, a read file) goes with it. The row
   * keeps the real output, and a notice says the model saw the hook's.
   */
  private replaceOutput(replay: ReplayItem, outcome: ToolOutcome, value: HookReplacement['value']) {
    const index = this.replay.indexOf(replay)
    if (index === -1 || replay.item.type !== 'function_call_output') {
      return
    }
    this.supersedeReplayOutput(replay, outcome)
    this.replay.splice(index, 0, {
      ...replay,
      item: { ...replay.item, output: typeof value === 'string' ? value : JSON.stringify(value) },
    })
    this.emit({ type: 'backendNotice', level: 'info', text: UI_TEXT.hookOutputReplaced })
  }

  /** Permission check, execution and the transcript row for one tool call. */
  private async runCall(
    turnId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
    goalCommandRevision: number,
    correctionsUsed = 0,
  ): Promise<HookToolResult> {
    const preview = this.argumentPreviewRows.get(call.call_id)
    const itemId = preview?.itemId ?? this.deps.newId()
    const startedAt = this.deps.now()
    // A BeforeToolSelection hook took this tool away for the turn: the call is
    // refused at admission, before any PreToolUse hook sees it, while the
    // declared tool list stays exactly as the model saw it (M91 lane E).
    const selection = this.toolSelectionFor(turnId)
    const selectionReason =
      selection === undefined || isToolAllowedBySelection(call.name, selection)
        ? undefined
        : `${call.name}: ${UI_TEXT.hookToolRemoved}`
    const pre: HookDispatch =
      selectionReason === undefined
        ? await this.runHooks(
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
        : {
            blockedReason: selectionReason,
            contexts: [],
            messages: [],
            updatedInput: undefined,
            forceApproval: false,
            stopReason: undefined,
            approvalDecision: undefined,
          }
    const effectiveCall: FunctionCallItem =
      pre.updatedInput === undefined
        ? call
        : { ...call, arguments: JSON.stringify(pre.updatedInput) }
    // The Reviewer's tools are never paid, and it is refused every other (M70).
    // Otherwise the paid marker only: the grant (with the agent's model) is
    // prepared later in runToolCall.
    let paid: PaidFeature | undefined
    if (!this.isReviewing()) {
      paid =
        this.childTaskFor(effectiveCall, undefined) === undefined
          ? paidFeatureOf(call.name)
          : 'subagents'
    }
    const started: ItemSnapshot = {
      itemId,
      kind: 'toolCall',
      status: IN_PROGRESS,
      turnId,
      tool: call.name,
      args: effectiveCall.arguments,
      ...(paid !== undefined && { paid }),
    }
    this.clearArgumentPreviewTimer(call.call_id)
    this.argumentPreviewRows.delete(call.call_id)
    if (preview === undefined) {
      this.recordTranscript(turnId, started)
    } else {
      this.rerecordTranscript(started)
    }
    this.emit({ type: 'itemStarted', item: started })
    const slot: AdmissionSlot = {}
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
              slot,
              pre.forceApproval,
            )
          : { outcome: toolFailure(pre.blockedReason), isRejected: true }
    } catch (error: unknown) {
      if (error instanceof AbortedError || signal.aborted) {
        this.finishCall(
          turnId,
          started,
          effectiveCall,
          toolFailure(MODEL_API_MODEL_TEXT.toolCancelledByStop),
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
      await this.touchPath(effectiveCall, turnId, signal)
    }
    const { admission } = slot
    const { isRejected, running, hookEffects } = result
    // The one point every outcome crosses: no await from here to the model's
    // replay. A rejection brought nothing back and keeps its own words.
    let outcome = isRejected ? result.outcome : this.fencedOutcome(admission, result.outcome)
    let attemptReplay: ReplayItem | undefined
    if (running === undefined) {
      if (!this.canQueueToolMedia(outcome)) {
        outcome = {
          output: `Error: ${MODEL_API_MODEL_TEXT.toolMediaBudgetExceeded}`,
          visibleOutput: UI_TEXT.mediaTotalTooLarge,
          failureReason: UI_TEXT.mediaTotalTooLarge,
        }
      }
      let status = COMPLETED
      if (outcome.failureReason !== undefined) {
        status = isRejected ? REJECTED : FAILED
      }
      attemptReplay = this.finishCall(turnId, started, effectiveCall, outcome, status)
      if (
        effectiveCall.name === MODEL_API_TOOLS.todoWrite &&
        outcome.failureReason !== undefined &&
        this.taskRefusals >= HOOK_MAX_STOP_CONTINUATIONS
      ) {
        throw new HookStoppedError(outcome.failureReason)
      }
    } else {
      this.continueInBackground(turnId, started, effectiveCall, outcome, running, admission)
    }
    if (selectionReason !== undefined) {
      await this.notePermissionDenied(call.name, selectionReason, signal)
    }
    this.appendHookContexts(turnId, [...pre.contexts, ...(hookEffects?.contexts ?? [])])
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
      true,
      true,
      { fileOperation: fileOperationOf(outcome) },
    )
    if (
      attemptReplay !== undefined &&
      outcome.failureReason === undefined &&
      post.replacement?.target === 'toolResult'
    ) {
      this.replaceOutput(attemptReplay, outcome, post.replacement.value)
    }
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
    // A PostToolUseFailure hook's corrected call (Muse 1.4.0, M91): the same
    // tool only, as a new call through the full path, bounded by
    // HOOK_ON_FAILURE_MAX_DEPTH. A stop still stops: no corrected call runs
    // after it. A backgrounded call is still running, so it is never
    // corrected either.
    if (
      attemptReplay !== undefined &&
      outcome.failureReason !== undefined &&
      post.updatedInput !== undefined &&
      post.stopReason === undefined
    ) {
      const correction = await this.correctionFor(
        effectiveCall,
        post.updatedInput,
        correctionsUsed,
        signal,
      )
      if (correction.ok) {
        this.supersedeReplayOutput(attemptReplay, outcome)
        return await this.runCall(
          turnId,
          correction.call,
          signal,
          goalCommandRevision,
          correctionsUsed + 1,
        )
      }
      this.replay.push({
        turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: correction.reason }],
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
      // A PreToolUse stop (Amp's tool.call `error`, M91b) refused the call
      // and ends the turn too.
      stopReason: post.stopReason ?? hookEffects?.stopReason ?? pre.stopReason,
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
    admission: Admission | undefined,
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
        // Its end is an outcome too: the dispatcher's fence judges it as it is told (M78).
        this.endInBackground(moved, call, this.fencedOutcome(admission, final))
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
      `${MODEL_API_MODEL_TEXT.backgroundEndedLead}\n$ ${commandOf(call.arguments)}\n${final.output}`,
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

  /**
   * The final admission of the user's `!` command at its real entry, after
   * the checkpoint mark and the native adapter's waits: the CURRENT trust,
   * this session and the Host's closing state, and the user's own stop. It
   * belongs to no turn, so neither the running turn, its Stop nor the
   * permission mode (Plan included) decides it: the user typed it.
   */
  private userShellAdmission(stop: AbortController): () => void {
    return () => {
      if (
        stop.signal.aborted ||
        this.isDisposed ||
        this.isHostClosing() ||
        !this.deps.isWorkspaceTrusted()
      ) {
        throw new AbortedError()
      }
    }
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
        undefined,
        this.userShellAdmission(stop),
      )
    } catch (error: unknown) {
      result = {
        stdout: '',
        stderr: describe(error),
        exitCode: null,
        isTimedOut: false,
        isCancelled: false,
        // Failed before entry: nothing ran, so the row says so and the model
        // is told nothing. A failure after the command ran is still told.
        ...(error instanceof ShellEntryError && { isEntryRefused: true as const }),
      }
    } finally {
      this.userShells.delete(started.itemId)
    }
    const outcome = shellOutcome(result, USER_SHELL_TIMEOUT_MS)
    // A refused entry ran nothing: its row says so, and the model is told
    // nothing about a command that never started.
    const isRefused = result.isEntryRefused === true && !stop.signal.aborted
    const failureReason = isRefused ? UI_TEXT.userShellFailed : outcome.failureReason
    // As Muse Code's rows read (captured 2026-09-25): exit 0 completed, any
    // other failed; one the user stopped reads stopped.
    let status = result.exitCode === 0 ? COMPLETED : FAILED
    if (stop.signal.aborted) {
      status = CANCELLED
    }
    const completed: ItemSnapshot = {
      ...started,
      status,
      visibleOutput: isRefused ? UI_TEXT.userShellFailed : shellText(result),
      durationMs: this.deps.now() - startedAt,
      ...(result.exitCode !== null && { exitCode: result.exitCode }),
      ...(failureReason !== undefined && { failureReason }),
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.rerecordTranscript(completed)
    if (result.isEntryRefused !== true) {
      this.noteForModel(`${MODEL_API_MODEL_TEXT.userShellLead}\n$ ${command}\n${outcome.output}`)
    }
  }

  /** Calls kept from running still get an output for valid replay. */
  private skipCalls(
    turnId: string,
    calls: readonly FunctionCallItem[],
    reason: string = MODEL_API_MODEL_TEXT.toolCancelledByStop,
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

  private async drainSteered(turn: ActiveTurn): Promise<void> {
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
      const replayStart = this.replay.length
      this.replay.push({
        turnId: turn.turnId,
        userMessageId: itemId,
        item: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: MODEL_API_MODEL_TEXT.steeredPrefix },
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
        recordedAt: this.recordedNow(),
      })
      await this.expandSkillsForHooks(turn.turnId, parts, replayStart, turn.abort.signal)
      // It is in the request now (M87): an Edit can no longer take it back.
      if (!this.isSubagent) {
        this.emit({ type: 'messageAdmitted', userMessageId: itemId })
      }
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

  /** The queued turn `ref` names, out of the queue and withdrawn; undefined once it started. */
  private takeQueued(ref: QueuedMessageRef): readonly TurnPart[] | undefined {
    const index = this.queuedTurns.findIndex(
      (queued) =>
        queued.turnId === ref.turnId &&
        !queued.isGoalWake &&
        queued.userMessageId === ref.userMessageId,
    )
    const [queued] = index === -1 ? [] : this.queuedTurns.splice(index, 1)
    if (queued === undefined) {
      return undefined
    }
    this.emit({ type: 'turnWithdrawn', turnId: queued.turnId, reason: UI_TEXT.turnUnqueued })
    return queued.parts
  }

  /**
   * The steer `ref` names, out of the running turn's steered input; undefined
   * once a request took it. Never a `turnWithdrawn`: that names the running
   * turn, which would end it for the panel (lane P's warning).
   */
  private takeSteer(ref: QueuedMessageRef): readonly TurnPart[] | undefined {
    const turn = this.active
    if (turn?.turnId !== ref.turnId) {
      return undefined
    }
    const index = turn.steered.findIndex((steer) => steer.userMessageId === ref.userMessageId)
    const [steer] = index === -1 ? [] : turn.steered.splice(index, 1)
    if (steer === undefined) {
      return undefined
    }
    turn.acceptedTextAttachmentBytes -= textAttachmentBytes(steer.parts)
    return steer.parts
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
        content: [{ type: 'input_text', text: MODEL_API_MODEL_TEXT.goalWake }],
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
    const admission = this.verificationAdmission(turn.abort.signal)
    const edited = this.ledger.takeRoundEdits()
    const wasTrusted = this.deps.isWorkspaceTrusted()
    // Filtering denied files out of lookup must not authorize checks over the revoked edit.
    const isAllowed: CallAdmission = (canRunDetached) =>
      admission(canRunDetached) && this.verificationAllowed(edited, undefined, wasTrusted)
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
    const selectedChecks =
      this.ledger.isStopped || !this.deps.isWorkspaceTrusted()
        ? []
        : verify
            .checkCommands()
            .filter(
              (check) =>
                !this.ledger.isRejected(check.name) &&
                !this.ledger.hasCurrentRun(check.name, checkScope(check, edited)),
            )
    const canRunChecks = this.canRunVerifyCommands()
    const checks = canRunChecks ? selectedChecks : []
    const refusedChecks = canRunChecks
      ? []
      : selectedChecks.map((check) =>
          skippedCheck(check, 'refused', MODEL_API_MODEL_TEXT.agentToolNotOffered),
        )
    if (!isDiagnosticsOn && selectedChecks.length === 0) {
      if (this.ledger.judgeRound()) {
        this.noteFixLoopStopped(turn.turnId, [])
      }
      return undefined
    }
    const paths = edited.map((file) => file.relative)
    const parts = (isDiagnosticsOn ? 1 : 0) + selectedChecks.length
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
        ? await this.editDiagnostics(verify, edited, signal, share, isAllowed)
        : undefined
      // Looked up after the language servers' wait, so a file gone by now is not passed.
      const existing =
        checks.length === 0 || !isAllowed() ? [] : await this.existingFiles(edited, isAllowed)
      runs = isAllowed()
        ? [
            ...refusedChecks,
            ...(await this.runChecks(
              started.itemId,
              checks,
              existing,
              signal,
              effects,
              share,
              isAllowed,
            )),
          ]
        : selectedChecks.map((check) =>
            skippedCheck(check, 'refused', MODEL_API_MODEL_TEXT.verifyAccessRefused),
          )
      if (isAbortRequested(signal)) {
        throw new AbortedError()
      }
      if (!isAllowed()) {
        pending = this.refusedDiagnostics(edited)
        runs = runs.map((run) => ({
          summary: {
            name: run.summary.name,
            outcome: run.summary.outcome,
            ...(run.summary.skip !== undefined && { skip: run.summary.skip }),
          },
          text: MODEL_API_MODEL_TEXT.verifyAccessRefused,
        }))
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
        item: noteItem([MODEL_API_MODEL_TEXT.verifyLead, ...sections].join('\n\n')),
      })
    }
    // The model has the reads now: they become the baseline of the next check.
    pending?.commit()
    this.appendHookEffects(turn.turnId, effects)
    return effects.stopReason
  }

  /** The verify note with the fix loop's stop at its end, and the panel's notice (M68). */
  private noteFixLoopStopped(turnId: string, sections: readonly string[]): void {
    const stopped = fill(MODEL_API_MODEL_TEXT.checksStopped, {
      count: String(CHECK_FIX_MAX_ROUNDS),
    })
    this.replay.push({
      turnId,
      item: noteItem([MODEL_API_MODEL_TEXT.verifyLead, ...sections, stopped].join('\n\n')),
    })
    this.emit({
      type: 'backendNotice',
      level: 'warning',
      text: plural(UI_TEXT.checksStoppedNotice, CHECK_FIX_MAX_ROUNDS),
    })
  }

  /** What the checks' hooks added, after the verify note: their contexts, then their reasons. */
  private appendHookEffects(turnId: string, effects: HookEffects): void {
    this.appendHookContexts(turnId, [...effects.contexts, ...effects.messages])
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
    isAllowed: () => boolean,
  ): Promise<PendingReport> {
    const canReadFile = (file: EditedFile) =>
      isAllowed() && !this.policy().files.isDenied([file.relative, file.absolute])
    if (edited.some((file) => !canReadFile(file))) return this.refusedDiagnostics(edited)
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
        read = await unlessStopped(verify.diagnosticsAfterEdit(shown, signal, canReadFile), signal)
      } catch (error: unknown) {
        if (error instanceof AbortedError) {
          throw error
        }
        if (edited.some((file) => !canReadFile(file))) return this.refusedDiagnostics(edited)
        this.deps.log.warn(`Verify: the diagnostics could not be read: ${describe(error)}`)
        return {
          report: {
            text: fill(MODEL_API_MODEL_TEXT.verifyDiagnosticsUnavailable, {
              reason: describe(error),
            }),
            unchecked: edited.length,
          },
          commit: NOTHING_TO_COMMIT,
        }
      }
    }
    if (edited.some((file) => !canReadFile(file))) return this.refusedDiagnostics(edited)
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
      await this.drainSteered(turn)
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
        this.skipCalls(turn.turnId, calls, MODEL_API_MODEL_TEXT.mcpRequiredUnavailable)
        throw requiredAfterStream
      }
      if (!wasBudgetLimited && this.goal?.status === GOAL_STATUS.budgetLimited) {
        this.skipCalls(turn.turnId, calls, MODEL_API_MODEL_TEXT.goalBudgetReached)
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
          // An imported SubagentStop hook's documented replacement of the
          // child's reply (Copilot `modifiedResponse`): what the parent reads.
          if (this.isSubagent && stop.replacement?.target === 'subagentResponse') {
            const { value } = stop.replacement
            this.hookReplies.set(
              turn.turnId,
              typeof value === 'string' ? value : JSON.stringify(value),
            )
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
            this.skipCalls(
              turn.turnId,
              calls.slice(index),
              MODEL_API_MODEL_TEXT.mcpRequiredUnavailable,
            )
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

  /** Child turns share checkpoint ownership with their top parent, even after it finishes. */
  private checkpointSessionId(): string {
    return this.parentSession?.checkpointSessionId() ?? this.sessionId
  }

  /**
   * What a tool call writes through, taken when it starts: the running
   * turn's own recorded writes (M86), else the window's io, which records
   * nothing. A call that outlives its turn keeps the turn's, which refuses it.
   */
  private toolWrites(): TurnWrites | undefined {
    const checkpoint = this.active?.checkpoint
    return checkpoint?.kind === 'recording' ? checkpoint.writes : undefined
  }

  /** Only the inherited decision is persisted, never a previous window's writes. */
  private inheritedRecording(): boolean | undefined {
    const top = this.topTurn
    return (
      top?.recordsFiles ??
      (top?.checkpoint === undefined ? undefined : top.checkpoint.kind !== 'off')
    )
  }

  /** The running turn started a process (M86, spec 8): its restore says what it never undoes. */
  private noteProcessRan(): void {
    if (this.active !== undefined) {
      this.active.ranProcesses = true
    }
  }

  /** Whether a command of the conversation, its children's included, runs in the background now. */
  private hasLiveCommands(): boolean {
    return this.conversationSessions().some(
      (session) => session.backgroundShells.size > 0 || session.userShells.size > 0,
    )
  }

  private conversationSessions(): readonly ModelApiSession[] {
    return this.parentSession === undefined
      ? [this, ...this.descendantSessions()]
      : this.parentSession.conversationSessions()
  }

  private descendantSessions(): readonly ModelApiSession[] {
    const sessions: ModelApiSession[] = []
    for (const { session } of this.children.values()) {
      sessions.push(session, ...session.descendantSessions())
    }
    return sessions
  }

  /** A task can start and finish between another turn's start/end samples. */
  private noteBackgroundStarted(): void {
    for (const session of this.conversationSessions()) {
      session.noteProcessRan()
    }
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
      isReview: queued.isReview === true,
      ranProcesses: this.hasLiveCommands(),
      ...(queued.confirmedRequest !== undefined && {
        confirmedRequest: queued.confirmedRequest,
      }),
    }
    // What a stopped turn left for its round is not checked in this one (M68).
    this.ledger.beginTurn()
    this.taskRefusals = 0
    this.active = turn
    // A message of the user's puts them back in the loop: the Auto reviewer
    // may answer again (M78). A goal's wake is not one.
    if (!queued.isGoalWake) {
      this.reviewBreaker.reset()
    }
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
    this.turnCostUsd = 0
    // A reply line counts this turn's requests only (M82).
    this.unshownUsage = undefined
    let terminal = COMPLETED
    let reason: string | undefined
    let errorKind: string | undefined
    try {
      try {
        turn.checkpoint = await this.deps.beforeTurnRuns?.(
          this.checkpointSessionId(),
          turn.turnId,
          this.isSubagent ? (this.topTurn ?? { checkpoint: undefined }) : undefined,
        )
      } catch (error: unknown) {
        this.deps.log.warn(
          `The turn checkpoint could not be admitted: ${error instanceof Error ? error.name : 'unknown failure'}`,
        )
        throw new Error(this.isSubagent ? UI_TEXT.childCheckpointFailed : UI_TEXT.sendMarkFailed, {
          cause: error,
        })
      }
      turn.abort.signal.throwIfAborted()
      await this.startHooks()
      for (const message of this.pendingHookMessages.splice(0)) {
        this.emit({ type: 'backendNotice', level: 'info', text: message })
      }
      this.appendHookContexts(turn.turnId, this.pendingHookContexts.splice(0))
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
      } else if (queued.isHookContinuation === true) {
        this.appendHookContexts(turn.turnId, [typedText(queued.parts)])
      } else {
        const replayStart = this.replay.length
        this.appendUserMessage(turn.turnId, queued.parts, queued.displayText, queued.userMessageId)
        await this.expandSkillsForHooks(
          turn.turnId,
          queued.parts,
          replayStart,
          turn.abort.signal,
          queued.displayText,
        )
      }
      if (!queued.isGoalWake && queued.isHookContinuation !== true) {
        await this.noteLoadedRules(turn.turnId, 'rules', turn.abort.signal)
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
          // later model request through the replay (M51). On Muse Code the
          // turn ends cancelled with the hook's reason and Interrupt fires
          // (M91 capture run 5), so this turn does the same.
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
          this.fireInterrupt()
          throw new HookCancelledError(submitted.blockedReason)
        }
        // Admitted: a user's message starts the verify loop afresh (M68). A
        // goal's wake carries on, and a parent model's message to a subagent
        // is not user input.
        if (!this.isSubagent) {
          this.ledger.resetForMessage()
        }
      }
      await this.prepareMcp(turn.abort.signal)
      // The Reviewer never searches (M70): nothing to ask about.
      turn.isWebSearchAllowed =
        !this.isReviewing() && (await this.webSearchConsent(turn.abort.signal))
      await this.loop(turn)
    } catch (error: unknown) {
      if (turn.abort.signal.aborted || error instanceof HookCancelledError) {
        terminal = CANCELLED
        if (error instanceof HookCancelledError) {
          reason = error.reason
          // Fixed words only: the reason carries the hook's stderr, which the
          // redactor would not catch (AGENTS.md rule 8).
          this.deps.log.warn(`Model API turn ${turn.turnId} cancelled by a hook`)
        }
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
    turn.isFinalizing = true
    if (terminal !== COMPLETED) {
      this.dropUndeliveredMedia(turn.turnId)
    }
    // `loop` returns only with nothing steered left (D26), and `steer` is
    // refused once `active` is cleared, so no input is lost between the two.
    // A note that arrived during the last reply is kept for the next request (M46).
    this.settleNotes(turn.turnId)
    try {
      await this.deps.afterTurnRuns?.(this.checkpointSessionId(), turn.turnId, {
        checkpoint: turn.checkpoint,
        ranProcesses: turn.ranProcesses || this.hasLiveCommands(),
      })
    } catch (error: unknown) {
      this.deps.log.warn(
        `The turn checkpoint could not be ended: ${error instanceof Error ? error.name : 'unknown failure'}`,
      )
    }
    this.deps.judge?.discardTurn(this.sessionId, turn.turnId)
    for (const callId of this.argumentPreviewRows.keys()) {
      this.interruptArgumentPreview(callId)
    }
    this.active = undefined
    this.status = IDLE
    this.turnCount += 1
    // The turn's cost against the cap, said once afterwards (M82).
    const budgetCapUsd = this.currentBudgetCap()
    const turnCostUsd = this.turnCostUsd
    if (budgetCapUsd > 0 && turnCostUsd > 0 && !this.budgetOwner().hasUnknownBudgetCost) {
      this.emit({
        type: 'backendNotice',
        level: 'info',
        text: fill(UI_TEXT.budgetTurnCost, {
          cost: formatUsd(turnCostUsd),
          spent: formatUsd(this.budgetSpentUsd),
          cap: formatUsd(budgetCapUsd),
        }),
      })
    }
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
      this.track(this.runTurn(next), false)
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
    const reservation = this.sending(body)
    const admitAttempt = this.responseAttemptGuard(body)
    const responseStream = this.deps.client.streamResponse(
      body,
      signal,
      (notice) => {
        this.allowRateLimitedRetry(notice)
      },
      undefined,
      admitAttempt,
    )
    try {
      await this.persistReservation(reservation)
      for await (const event of responseStream) {
        if (reservation !== undefined) {
          reservation.hasStarted = true
        }
        if (event.type === 'response.completed') {
          response = event.response
        }
        text += this.collectedText(event, chargedGoalId)
      }
    } catch (error: unknown) {
      this.noteRequestRefusal(reservation, error)
      throw error
    } finally {
      await this.endRequest()
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
    await this.refreshBudgetSpend()
    // The compaction is a request like any other: the session budget
    // reserves it too, and refuses it when it cannot fit (M82).
    const compactionBody = (): CreateResponseBody =>
      this.budgeted(
        this.keyed({
          ...this.body(),
          // Within Meta's image budget too (M54): a conversation past it can still be compacted.
          input: this.budget.fit([
            ...this.replay.map((entry) => entry.item),
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: MODEL_API_MODEL_TEXT.compactionPrompt }],
            },
          ]),
          tools: [],
          include: ['reasoning.encrypted_content'],
        }),
      )
    const turnId = this.turnIds.at(-1) ?? COMPACTION_TURN_ID
    const requestId = this.deps.newId()
    await this.beforeModelCall(turnId, compactionBody(), requestId, 1, 0, signal)
    const chargedGoalId = isGoalActive(this.goal) ? this.goal.goal_id : undefined
    await this.refreshBudgetSpend()
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
        content: [
          { type: 'input_text', text: `${MODEL_API_MODEL_TEXT.compactionPrefix}\n\n${summary}` },
        ],
      },
    })
    // The packed originals left with the replay; the ledger stays, a
    // session total like the token counts.
    this.packing?.reset()
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
    // The summary replaced what the compaction request carried, so that
    // request is no base for the next estimate; Meta's count of the new
    // context is, when it comes (M82).
    this.budgetBase = undefined
    // The new context size is a courtesy: the compaction stands if it cannot be counted.
    const { stream: _stream, ...countable } = this.body()
    const countRevision = this.modelRevision
    try {
      const counted = await this.deps.client.countInputTokens(countable)
      if (countRevision === this.modelRevision) {
        this.noteContext(counted)
      }
      if (!this.isSubagent && this.currentBudgetCap() > 0 && countRevision === this.modelRevision) {
        this.budgetBase = {
          inputTokens: counted,
          parts: estimateInput(requestParts(countable), undefined).parts,
        }
      }
    } catch (error: unknown) {
      const status =
        error instanceof ModelApiError ? `HTTP ${String(error.status)}` : 'request failed'
      this.deps.log.warn(`The compacted context could not be counted: ${status}`)
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

  private submitTurn(
    parts: readonly TurnPart[],
    displayText: string | undefined,
    isReview: boolean,
    requestFor?: (turnId: string) => ConfirmedModelRequest,
    isHookContinuation = false,
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
      ...(isHookContinuation && { isHookContinuation: true }),
      ...(isReview && { isReview }),
      ...(confirmedRequest !== undefined && { confirmedRequest }),
    }
    // A compaction is a turn too (D26): a message sent during one waits for it.
    if (this.active === undefined && this.compacting === undefined) {
      this.track(this.runTurn(queued), false)
      return Promise.resolve({ turnId, disposition: 'started', userMessageId })
    }
    this.queuedTurns.push(queued)
    return Promise.resolve({ turnId, disposition: 'queued', userMessageId })
  }

  /** The body of `compact`, once it may run: tracked, so a closing window waits for it. */
  private async compactNow(): Promise<CompactOutcome> {
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

  /** The conversation a paid use is asked in (M58): a child task's is its parent's. */
  private get askingSessionId(): string {
    return this.parentSession?.askingSessionId ?? this.sessionId
  }

  // --- AgentSession ---

  /** A file changed outside the agent (M91 lane E): FileChanged, debounced and capped. */
  private async noteFileChanged(
    relativePath: string,
    reason: 'external-edit' | 'watcher',
  ): Promise<void> {
    const hooks = this.enabledExtensionHooks()
    if (
      hooks.length === 0 ||
      this.isDisposed ||
      !isFileChangedWatched(hooks, relativePath) ||
      isProtectedPath(relativePath) ||
      relativePath.split('/').some((part) => part === '.git' || part === 'node_modules')
    )
      return
    const listedFiles = await this.deps.io.listFiles()
    if (!listedFiles.includes(relativePath)) return
    const verdict = this.fileChangedThrottle.check(relativePath, this.deps.now())
    if (verdict !== 'fire') {
      if (verdict === 'capped') {
        this.deps.log.warn(
          `Model API extension hooks: FileChanged capped for ${relativePath}; resume in a minute`,
        )
      }
      return
    }
    await this.fireExtensionHooks(
      'FileChanged',
      undefined,
      fileChangedFields(relativePath, reason),
      relativePath,
      undefined,
    )
  }

  /** A SubagentStop hook's replacement of this child's reply in a turn, if one asked (M91). */
  public hookReplyFor(turnId: string): string | undefined {
    return this.hookReplies.get(turnId)
  }

  /** A proven host-origin write: aliases reread instead of retaining old fingerprints. */
  public noteExternalEdit(file: EditedFile): void {
    if (this.isDisposed) {
      return
    }
    this.seenFiles.clear()
    this.ledger.noteEdit(file, [file.relative])
    // FileChanged is observation only and never starts a turn (M91 lane E).
    void this.noteFileChanged(file.relative, 'external-edit').catch((error: unknown) => {
      this.deps.log.warn(`Model API extension hooks: FileChanged failed: ${describe(error)}`)
    })
  }

  /**
   * Fire one extension event from this session's snapshot outside any turn
   * (M91 lane E): a Best-of-N worktree, an idling teammate, a message about
   * to show. Hook context has no turn to join, so only the decision comes
   * back; with the opt-in off, in a side chat, or after dispose, the
   * dispatch is empty and the operation proceeds as before.
   */
  public async fireExtensionHook(
    event: ExtensionHookEvent,
    fields: Readonly<Record<string, unknown>>,
    matcherValue?: string,
  ): Promise<ExtensionHookDispatch> {
    if (this.isDisposed) {
      return emptyExtensionDispatch()
    }
    return (
      (await this.fireExtensionHooks(
        event,
        undefined,
        event === 'MessageDisplay' && typeof fields['message'] === 'string'
          ? messageDisplayFields(fields['message'])
          : fields,
        matcherValue,
        undefined,
      )) ?? emptyExtensionDispatch()
    )
  }

  /** SessionStart runs when the session opens; context enters its first turn. */
  public async startHooks(): Promise<void> {
    if (this.hookStarted) {
      return
    }
    this.hookStarted = true
    await this.collectStartHooks(this.hookStartSource, undefined)
  }

  /** Shared parent liability, initialized from its own safe history before external paid work. */
  public async ownedBudgetScope(): Promise<OwnedSessionBudgetScope | undefined> {
    const modelRevision = this.modelRevision
    const goalRevision = this.goalCommandRevision
    const isTrusted = this.deps.isWorkspaceTrusted()
    await this.refreshBudgetSpend()
    const owner = this.budgetOwner()
    const journal = this.budgetJournal()
    const source = this.deps.budgetScope
    const accountId = source?.accountId ?? owner.budgetAccountId
    if (journal === undefined || accountId === undefined) {
      return undefined
    }
    const scope: OwnedSessionBudgetScope = Object.freeze({
      sessionId: source?.sessionId ?? owner.sessionId,
      accountId,
      journal,
      capUsd: () => this.currentBudgetCap(),
      isStillAllowed: (keyDigest: string | undefined) =>
        !this.isHostClosing() &&
        !this.isDisposed &&
        !owner.isDisposed &&
        keyDigest === accountId &&
        owner.budgetAccountId === accountId &&
        modelRevision === this.modelRevision &&
        goalRevision === this.goalCommandRevision &&
        isTrusted === this.deps.isWorkspaceTrusted() &&
        source?.isStillAllowed(keyDigest) !== false,
    })
    if (!scope.isStillAllowed(accountId)) {
      throw new AbortedError()
    }
    return scope
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
    return this.submitTurn(parts, displayText, false, requestFor)
  }

  /**
   * A `/review` the user asked for (M70, PLAN.md D49): a turn of this
   * conversation, run as the Reviewer with its own prompt and only the tools
   * that read. It is part of the user's own turn, so it asks for no payment.
   */
  public review(parts: readonly TurnPart[], displayText: string): Promise<TurnSubmission> {
    return this.submitTurn(parts, displayText, true)
  }

  /**
   * Input for the running turn. Each refusal takes nothing (a
   * `SteerRefusedError`), so the conversation may send it as a new turn.
   */
  public steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<TurnSubmission> {
    if (this.isDisposed) {
      return Promise.reject(new Error(UI_TEXT.turnStoppedByRestart))
    }
    if (this.active?.turnId !== expectedTurnId || this.active.abort.signal.aborted) {
      return Promise.reject(new SteerRefusedError(TURN_NOT_RUNNING))
    }
    const addedTextBytes = textAttachmentBytes(parts)
    const textBudgetError = textAttachmentBudgetError(
      this.active.acceptedTextAttachmentBytes + addedTextBytes,
    )
    if (textBudgetError !== undefined) {
      return Promise.reject(new SteerRefusedError(textBudgetError.message))
    }
    if (!this.canQueueSteeredMedia(parts)) {
      return Promise.reject(new SteerRefusedError(UI_TEXT.mediaTotalTooLarge))
    }
    const userMessageId = this.deps.newId()
    this.active.acceptedTextAttachmentBytes += addedTextBytes
    this.active.steered.push({ parts, userMessageId })
    return Promise.resolve({ turnId: expectedTurnId, disposition: 'steered', userMessageId })
  }

  /**
   * Take a message back before a request reads it (M87, PLAN.md D66). A
   * queued turn leaves the queue and ends withdrawn, as Muse Code's
   * `turn/unqueued` does; a steer leaves the running turn's steered input
   * with no event, as the running turn goes on. Both happen synchronously,
   * so a message the queue already started or `drainSteered` already put in
   * a request is too late. The images come back from the message's parts.
   */
  public withdrawQueued(ref: QueuedMessageRef): Promise<WithdrawOutcome> {
    const parts =
      ref.disposition === STEERED_DISPOSITION ? this.takeSteer(ref) : this.takeQueued(ref)
    return Promise.resolve(
      parts === undefined
        ? { status: 'tooLate' }
        : {
            status: 'withdrawn',
            images: parts.filter(isImagePart).map((part) => sentImageOf(part)),
          },
    )
  }

  /**
   * Stop: the running turn or compaction is aborted, and each queued message
   * is ended with a reason instead of vanishing (D26).
   */
  public cancel(): Promise<void> {
    this.deps.judge?.discardSession(this.sessionId)
    for (const dropped of this.queuedTurns.splice(0)) {
      this.emit({
        type: 'turnWithdrawn',
        turnId: dropped.turnId,
        reason: UI_TEXT.queuedTurnDropped,
      })
    }
    const hasRunning =
      (this.active !== undefined && this.active.isFinalizing !== true) ||
      this.compacting !== undefined
    if (hasRunning) {
      // Pause the goal Stop targeted now. A replacement accepted while an
      // aborted turn unwinds must remain active and get its own wake.
      this.pauseGoalAfterStop()
    }
    this.active?.abort.abort()
    if (this.compacting !== undefined) {
      this.compacting.abort()
    }
    // Muse Code's Interrupt fires on a cancelled running turn or compaction,
    // never on an idle close (M91, docs/certification/m91.md). Disposal and
    // host close reach it through here.
    if (hasRunning) {
      this.fireInterrupt()
    }
    return Promise.resolve()
  }

  /**
   * Switch the model (M91 lane E): a PreModelSwitch hook can refuse, with a
   * visible reason, and then the session stays on its model; a switch runs
   * PostModelSwitch as observation. Model ids only, never prompts or keys.
   */
  public async setModel(modelId: string): Promise<void> {
    const oldModel = this.modelId
    const turnId = this.active?.turnId
    const pre = await this.fireExtensionHooks(
      'PreModelSwitch',
      turnId,
      modelSwitchFields({ oldModel, newModel: modelId }),
      undefined,
      undefined,
    )
    if (pre?.refusedReason !== undefined) {
      this.emit({
        type: 'backendNotice',
        level: 'warning',
        text: fill(UI_TEXT.hookRefusedModelSwitch, { model: oldModel, reason: pre.refusedReason }),
      })
      return
    }
    this.deps.judge?.discardSession(this.sessionId)
    this.modelId = modelId
    this.modelRevision += 1
    // Another model may count the same request differently (M82).
    this.budgetBase = undefined
    this.emit({ type: 'modelChanged', modelId })
    this.touch()
    await this.fireExtensionHooks(
      'PostModelSwitch',
      turnId,
      modelSwitchFields({ oldModel, newModel: modelId }),
      undefined,
      undefined,
    )
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
    const approvalMode = APPROVAL_MODES.find((known) => known === mode)
    if (approvalMode === undefined) {
      return Promise.reject(new Error(`unknown approval mode ${mode}`))
    }
    this.deps.judge?.discardSession(this.sessionId)
    // A custom agent's ceiling survives a session mode switch (M76 review):
    // the child re-narrows instead of running wider than its definition.
    this.permissions.setMode(
      this.agent?.approvalMode === undefined
        ? approvalMode
        : narrowApprovalMode(approvalMode, this.agent.approvalMode),
    )
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
    const compacting = this.compactNow()
    this.track(compacting, true)
    return await compacting
  }

  /** Resolves after turns, compactions, Interrupt work and children's work end. */
  public async settled(): Promise<void> {
    while (this.unsettled.size > 0) {
      await Promise.all(this.unsettled.values())
    }
    await Promise.all(
      Array.from(this.children.values(), async (child) => {
        await child.session.settled()
      }),
    )
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
    this.judgeCardFences.get(decision.approvalId)?.discard()
    this.judgeCardFences.delete(decision.approvalId)
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

  /**
   * Settles an elicitation form (M91 lane M): accept with validated values,
   * or decline or cancel. An answer outside the requested schema is refused,
   * and the form stays open; answering a settled form reports it as gone.
   */
  public settleElicitation(elicitationId: string, reply: ElicitationReply): Promise<void> {
    if (!this.pendingElicitations.has(elicitationId)) {
      for (const child of this.children.values()) {
        if (child.session.pendingElicitations.has(elicitationId)) {
          return child.session.settleElicitation(elicitationId, reply)
        }
      }
    }
    return this.settleElicitationForm(elicitationId, reply)
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
    this.noteBackgroundStarted()
    this.noteProcessRan()
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
          MODEL_API_MODEL_TEXT.subagentResume,
        ])
        const grant = await this.confirmOwnerChildTask(child, taskBeforeConsent)
        if (
          this.isDisposed ||
          child.state !== stateBeforeConsent ||
          child.revision !== revisionBeforeConsent ||
          this.queuedChildTask(child, [
            ...child.pendingMessages,
            MODEL_API_MODEL_TEXT.subagentResume,
          ]) !== taskBeforeConsent
        ) {
          throw new Error(UI_TEXT.subagentConsentDeclined)
        }
        this.installChildGrant(child, grant)
        child.pendingMessages.push(MODEL_API_MODEL_TEXT.subagentResume)
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
    if (this.shellSidecarFile !== undefined) {
      // The session's side file goes with it; a tracked call still running
      // reads back "no report" and keeps the previous directory.
      const sideFile = this.shellSidecarFile
      this.shellSidecarFile = undefined
      void rm(sideFile, { force: true }).catch(() => {
        // Best effort: the operating system cleans its own temp dir.
      })
    }
    this.workspaceEdits.delete(this.ledger)
    if (this.scheduleTimer !== undefined) {
      clearInterval(this.scheduleTimer)
      this.scheduleTimer = undefined
    }
    void this.cancel()
    // Let this close's Interrupt enter before aborting its owned queue and
    // processes. The handlers are tracked, so host close waits for cleanup.
    queueMicrotask(() => {
      this.interruptLifetime.abort()
    })
    // Nothing is left running unwatched (M46): the background commands and
    // the user's own go with the session.
    for (const stop of [...this.backgroundShells.values(), ...this.userShells.values()]) {
      stop.abort()
    }
    for (const child of this.children.values()) {
      child.session.disposeAll()
    }
    // Plugin children still running for an imported hook end with it (M91b).
    void this.foreignAdapter?.then((adapter) => {
      adapter?.dispose?.()
    })
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
      ...(this.imported && { imported: true }),
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
    const budgetSpentUsd =
      this.budgetSpentUsd +
      (this.openReservation?.isReserved === true ? this.openReservation.costUsd : 0)
    const freshFork: Pick<StoredSession, 'budgetIsFreshFork' | 'budgetSpentUsd'> = this
      .budgetIsFreshFork
      ? { budgetIsFreshFork: true, budgetSpentUsd: 0 }
      : {}
    const packedTokensAvoided = this.packing?.savings() ?? this.restoredPackedTokens
    return {
      version: STORED_SESSION_VERSION,
      sessionId: this.sessionId,
      ...(this.isSideChat && { sideChat: true }),
      ...(this.imported && { imported: true }),
      workspaceRoot: this.deps.sessionWorkspaceRoot ?? this.deps.workspaceRoot,
      modelId: this.modelId,
      approvalMode: this.permissions.currentMode,
      effort: this.effort,
      // A custom agent's narrowed run, so a resume or fork keeps it (M76
      // review). Optional fields stay absent, never undefined.
      ...(this.agent !== undefined && {
        agent: {
          id: this.agent.id,
          source: this.agent.source,
          prompt: this.agent.prompt,
          ...(this.agent.toolAllowlist !== undefined && {
            toolAllowlist: [...this.agent.toolAllowlist],
          }),
          effort: this.agent.effort,
          ...(this.agent.approvalMode !== undefined && {
            approvalMode: this.agent.approvalMode,
          }),
          ...(this.agent.permissionMode !== undefined && {
            permissionMode: this.agent.permissionMode,
          }),
        },
      }),
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
      ...(budgetSpentUsd > 0 && { budgetSpentUsd }),
      ...freshFork,
      ...(packedTokensAvoided !== undefined && { packedTokensAvoided }),
      ...(this.hookTokensAdded > 0 && { hookTokensAdded: this.hookTokensAdded }),
      ...(this.spawnCommands.size > 0 && { spawnCommands: Object.fromEntries(this.spawnCommands) }),
      ...(this.pendingChildResults.length > 0 && {
        pendingChildResults: this.pendingChildResults.map((pending) => storedPending(pending)),
      }),
      ...(this.children.size > 0 && {
        children: Array.from(this.children.values(), (child) => ({
          id: child.id,
          role: child.role,
          objective: child.objective,
          itemId: child.itemId,
          parentTurnId: child.parentTurnId,
          ...(child.session.inheritedRecording() !== undefined && {
            checkpointRecording: child.session.inheritedRecording(),
          }),
          startedAt: child.startedAt,
          state: child.state,
          ...(child.result !== undefined && { result: child.result }),
          ...(child.terminal !== undefined && { terminal: child.terminal }),
          ...(child.policyRevision !== undefined && { policyRevision: child.policyRevision }),
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
          item: noteItem(
            `${MODEL_API_MODEL_TEXT.backgroundLostLead}\n$ ${commandOf(item.args ?? '')}`,
          ),
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
    this.imported = stored.imported === true
    this.createdAt = stored.createdAt
    this.lastActivityAt = stored.lastActivityAt
    this.turnCount = stored.turnIds.length
    this.usage = { ...stored.usage }
    this.budgetSpentUsd = stored.budgetSpentUsd ?? 0
    this.budgetAccountId = stored.accountId
    // The packing ledger is a session total like the token counts: a
    // session saved before it was kept carries none, so it starts at zero.
    this.restoredPackedTokens = stored.packedTokensAvoided
    this.hookTokensAdded = stored.hookTokensAdded ?? 0
    this.packing?.restoreSavings(stored.packedTokensAvoided ?? 0)
    this.status = IDLE
    this.pendingChildResults.push(
      ...(stored.pendingChildResults ?? []).map((stored) => pendingFromStored(stored)),
    )
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
        (kind) => this.onPersisted(kind),
        NO_CHILD_DISPOSAL,
        this.isHostClosing,
        true,
        this,
        saved.id,
        this.hooks,
        'resume',
        this.isSideChat,
        this.workspaceEdits,
        // A custom agent's narrowed run survives the resume (M76 review).
        saved.session.agent,
        isReviewerRole(saved.role),
        this.extensionHooks,
      )
      session.adopt(saved.session)
      session.topTurn = { checkpoint: undefined, recordsFiles: saved.checkpointRecording }
      const record: ChildRecord = {
        id: saved.id,
        role: saved.role,
        objective: saved.objective,
        agentId: saved.session.agent?.id,
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
        policyRevision: saved.policyRevision,
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
          ? `${MODEL_API_MODEL_TEXT.backgroundLostLead}\n$ ${command}`
          : `${MODEL_API_MODEL_TEXT.backgroundEndedLead}\n$ ${command}\n${item.visibleOutput ?? ''}`
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
    target.budgetIsFreshFork = true
    // A fork carries the imported history, so it asks as its source does (M84).
    target.imported = this.imported
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
      const saved = { ...child.session.snapshot(), sessionId }
      const session = new ModelApiSession(
        sessionId,
        child.session.modelId,
        target.isSideChat ? 'denyUnmatched' : child.session.approvalMode,
        this.deps,
        () => {
          target.touch()
        },
        (kind) => target.onPersisted(kind),
        NO_CHILD_DISPOSAL,
        target.isHostClosing,
        true,
        target,
        child.id,
        target.hooks,
        'fork',
        target.isSideChat,
        target.workspaceEdits,
        // A custom agent's narrowed run survives the fork (M76 review).
        saved.agent,
        isReviewerRole(child.role),
        target.extensionHooks,
      )
      session.adopt(saved)
      session.topTurn = { checkpoint: undefined, recordsFiles: child.session.inheritedRecording() }
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

  /** Reads the actual main request; the side stream never enters this session's replay or tally. */
  public judgeConnection(turnId: string, keyDigest: string): ModelApiJudgeConnection {
    const readMainBody = (): CreateResponseBody => {
      if (this.active?.turnId !== turnId || this.lastJudgeBody?.model !== this.modelId)
        throw new Error('Judge source changed')
      return this.lastJudgeBody
    }
    return {
      keyDigest,
      source: {
        readMainBody,
        keyPrefix: promptCacheKey,
        prefixTokens: () => {
          return
        },
      },
      transport: {
        send: async (body, signal, guard) => {
          if (guard === undefined) throw new Error('Judge dispatch requires admission')
          let final: ResponseObject | undefined
          const stream = this.deps.client.streamResponse(
            body,
            signal,
            undefined,
            { retriesUsed: MODEL_API_MAX_RETRIES },
            guard,
          )
          for await (const event of stream) {
            if (event.type === 'response.completed') final = event.response
          }
          if (final?.status !== 'completed')
            throw new Error('Judge stream has no completed response')
          const text = final.output
            .flatMap((item) =>
              item.type === 'message' && 'content' in item
                ? item.content.flatMap((part) =>
                    part.type === 'output_text' && 'text' in part ? [part.text] : [],
                  )
                : [],
            )
            .join('')
          const usage = final.usage
          if (usage !== undefined && usage !== null && !isCountedUsage(usage))
            throw new Error('Invalid Judge usage')
          const cached = usage?.input_tokens_details?.cached_tokens
          const reasoning = usage?.output_tokens_details?.reasoning_tokens
          return {
            text,
            inputTokens: usage?.input_tokens,
            outputTokens: usage?.output_tokens,
            ...(usage !== undefined &&
              usage !== null &&
              cached !== undefined &&
              reasoning !== undefined && {
                usage: {
                  inputTokens: usage.input_tokens,
                  outputTokens: usage.output_tokens,
                  cachedTokens: cached,
                  reasoningTokens: reasoning,
                },
              }),
          }
        },
      },
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
  private isClosing = false
  private isVerifyDisposed = false
  private readonly sessions = new Map<string, ModelApiSession>()

  private readonly workspaceEdits: WorkspaceEdits
  /** Pinned at first use; a host cannot serve a different stored-key account. */
  private accountIdValue: string | undefined
  /** What the store holds for this workspace, kept current as sessions change. */
  private readonly stored = new Map<string, StoredSessionHeader>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  /** Saves run one after another; failures are logged, and strict callers also see them. */
  private saving: Promise<void> = Promise.resolve()
  /**
   * Each session's last saved snapshot (M82): while a call waits for its
   * output the replay cannot be saved, but what the session spent can,
   * written onto this.
   */
  private readonly lastSaved = new Map<string, StoredSession>()
  public readonly info: HostInfo = {
    kind: 'modelApi',
    serverName: MODEL_API_SERVER_NAME,
    serverVersion: MODEL_API_VERSION,
    grantedCapabilities: [],
    canEditSessions: true,
  }

  public constructor(private readonly deps: ModelApiHostDeps) {
    this.workspaceEdits = deps.workspaceEdits ?? new WorkspaceEdits()
    // Elicitations outside any tool call have no session to ask: they are
    // declined, and the pool declares the capability while this stands
    // (M91 lane M). Each call carries its own session's route instead.
    deps.mcpServers?.setElicitationHandler?.(() => Promise.resolve({ action: 'decline' as const }))
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

  /** A closing host takes no new session: one made now would outlive `close`. */
  private refuseWhileClosing(): void {
    if (this.isClosing) {
      throw new AbortedError()
    }
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

  private assertBudgetHostOpen(): void {
    if (this.isClosing) {
      throw new Error(UI_TEXT.historyUnavailable)
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
    this.lastSaved.set(snapshot.sessionId, snapshot)
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
      void this.persistSpend(snapshot, store).catch(IGNORE_SAVE_FAILURE)
      return isStrict ? Promise.reject(new Error(UI_TEXT.historyUnavailable)) : Promise.resolve()
    }
    const saved = this.queueSave(snapshot, store, isStrict)
    return isStrict ? saved : this.saving
  }

  /**
   * What a session spent while a call waits for its output (M82): the last
   * saved snapshot with this one's token totals and budget spend, so a
   * reload or a crash cannot forget a request's cost and let the next one
   * pass the cap. Nothing is written for a session never saved: there is
   * nothing to reload.
   */
  private persistSpend(
    snapshot: StoredSession,
    store: SessionStore,
    isStrict = false,
  ): Promise<void> {
    const last = this.lastSaved.get(snapshot.sessionId)
    if (last === undefined) {
      return isStrict ? Promise.reject(new Error(UI_TEXT.historyUnavailable)) : Promise.resolve()
    }
    if (
      !isStrict &&
      last.budgetSpentUsd === snapshot.budgetSpentUsd &&
      JSON.stringify(last.usage) === JSON.stringify(snapshot.usage)
    ) {
      return Promise.resolve()
    }
    const { budgetSpentUsd: _unsaved, ...saved } = last
    return this.queueSave(
      {
        ...saved,
        usage: snapshot.usage,
        ...(snapshot.budgetSpentUsd !== undefined && { budgetSpentUsd: snapshot.budgetSpentUsd }),
      },
      store,
      false,
    )
  }

  /** Durable liability without ever writing an unanswered tool call to replay. */
  private async persistBudgetReservation(
    session: ModelApiSession,
    isRefund = false,
  ): Promise<void> {
    const { store } = this.deps
    if (store === undefined) {
      throw new Error(UI_TEXT.historyUnavailable)
    }
    if (!isRefund) {
      await this.requireAccountId()
    }
    // A nonsent request releases its original account's liability even if
    // a different key caused admission to fail. No new account is written.
    const snapshot = this.ownedSnapshot(session.snapshot())
    await (hasUnansweredSessionCall(snapshot)
      ? this.persistSpend(snapshot, store, true)
      : this.queueSave(snapshot, store, false))
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
    extensionHooks: readonly ExtensionHookDefinition[] = [],
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
      (kind) =>
        kind === 'budget' || kind === 'refund'
          ? this.persistBudgetReservation(session, kind === 'refund')
          : this.persistStrict(session),
      () => {
        this.sessions.delete(sessionId)
        this.lastSaved.delete(sessionId)
      },
      () => this.isClosing,
      false,
      undefined,
      undefined,
      hooks,
      hookStartSource,
      isSideChat,
      this.workspaceEdits,
      undefined,
      false,
      extensionHooks,
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
   * The session's spark-hooks.json snapshot (M91 lane E): same gates as
   * `sessionHooks`, empty with the opt-in off or when loading fails.
   */
  private async sessionExtensionHooks(): Promise<readonly ExtensionHookDefinition[]> {
    try {
      return (await this.deps.loadExtensionHooks?.()) ?? []
    } catch (error: unknown) {
      this.deps.log.warn(`Model API extension hooks could not load: ${describe(error)}`)
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
    const hooks = stored.sideChat === true ? [] : await this.sessionHooks()
    const extensionHooks = stored.sideChat === true ? [] : await this.sessionExtensionHooks()
    // Loading the hooks may outlast a sign-out or the host closing: checked
    // again before the session exists and its SessionStart hook runs.
    await this.requireAccountId()
    this.refuseWhileClosing()
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
      hooks,
      'resume',
      stored.sideChat === true,
      extensionHooks,
    )
    // The caller checks the account and the closing again after the
    // SessionStart hook; a hook that fails leaves no session behind.
    try {
      session.adopt(stored)
      await session.startHooks()
    } catch (error: unknown) {
      session.dispose()
      throw error
    }
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

  /**
   * Resume a parsed export as a new session (M84, PLAN.md D49): a fresh id
   * (which severs schedules), the caller's asking mode and model, no rules,
   * goals, todos, schedules or patches, each imported turn handed to the
   * model as untrusted data, and the session marked imported. The save
   * stamps the current key's digest, so only this key reopens it.
   */
  public judgeConnection(sessionId: string, turnId: string): ModelApiJudgeConnection | undefined {
    const session = this.sessions.get(sessionId)
    if (session === undefined || this.accountIdValue === undefined) return
    return session.judgeConnection(turnId, this.accountIdValue)
  }

  public async importSession(
    doc: SessionExport,
    options: { readonly approvalMode: ApprovalMode; readonly modelId: string },
  ): Promise<LoadedSession> {
    await this.requireAccountId()
    const stored = sanitizeImportedSession(doc, {
      sessionId: this.deps.newId(),
      workspaceRoot: this.deps.workspaceRoot,
      approvalMode: options.approvalMode,
      modelId: options.modelId,
      now: new Date(this.deps.now()).toISOString(),
    })
    const hooks = await this.sessionHooks()
    const extensionHooks = await this.sessionExtensionHooks()
    // Loading the hooks may outlast a sign-out or the host closing: both are
    // checked again before the session exists and its SessionStart hook runs
    // (RV84c C1), as every other opening checks them.
    await this.requireAccountId()
    this.refuseWhileClosing()
    const session = this.create(
      stored.modelId,
      stored.approvalMode,
      stored.sessionId,
      hooks,
      'resume',
      false,
      extensionHooks,
    )
    try {
      session.adopt(stored)
      await session.startHooks()
      await this.requireAccountId()
      this.refuseWhileClosing()
    } catch (error: unknown) {
      session.dispose()
      throw error
    }
    void this.persist(session)
    this.announce(session)
    void this.startMcpServers()
    return this.loaded(session)
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
    const extensionHooks = options.sideChat === true ? [] : await this.sessionExtensionHooks()
    // Loading the hooks may outlast a sign-out or the host closing.
    await this.requireAccountId()
    this.refuseWhileClosing()
    const session = this.create(
      options.modelId,
      options.sideChat === true ? 'denyUnmatched' : (options.approvalMode as ApprovalMode),
      this.deps.newId(),
      hooks,
      'startup',
      options.sideChat === true,
      extensionHooks,
    )
    try {
      await session.startHooks()
      await this.requireAccountId()
      this.refuseWhileClosing()
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

  /** Extension-owned callers bind only an already loaded, currently owned parent. */
  public async getOwnedBudgetScope(
    sessionId: string,
  ): Promise<OwnedSessionBudgetScope | undefined> {
    this.assertBudgetHostOpen()
    await this.requireAccountId()
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw new Error(UI_TEXT.historyUnavailable)
    }
    const scope = await session.ownedBudgetScope()
    this.assertBudgetHostOpen()
    return scope === undefined
      ? undefined
      : Object.freeze({
          ...scope,
          isStillAllowed: (keyDigest: string | undefined) =>
            !this.isClosing && scope.isStillAllowed(keyDigest),
        })
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
      this.refuseWhileClosing()
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
    let extensionHooks: readonly ExtensionHookDefinition[]
    try {
      hooks = isSideChat ? [] : await this.sessionHooks()
      extensionHooks = isSideChat ? [] : await this.sessionExtensionHooks()
      // Loading the hooks may outlast a sign-out or the host closing.
      await this.requireAccountId()
      this.refuseWhileClosing()
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
      extensionHooks,
    )
    try {
      source.copyInto(fork, lastTurnId)
      await fork.startHooks()
      await this.requireAccountId()
      this.refuseWhileClosing()
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
    this.isClosing = true
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
    // A turn the close stops charges what it spent and saves as it ends
    // (M82): wait for the sessions' running work, but never past a deadline.
    const settling = Promise.all(
      Array.from(this.sessions.values(), async (session) => {
        await session.settled()
      }),
    )
    // Disposing removes the entry; a Map iterator tolerates that.
    for (const session of this.sessions.values()) {
      session.disposeAll()
    }
    try {
      await withDeadline(settling, MODEL_API_CLOSE_SETTLE_MS, 'closing')
    } catch (error: unknown) {
      this.deps.log.warn(`Model API sessions still running at close: ${describe(error)}`)
    }
    // The MCP servers go with the host (M50): a stdio server's process tree is killed.
    try {
      await Promise.all([this.saving, this.deps.mcpServers?.close()])
    } finally {
      if (!this.isVerifyDisposed) {
        this.isVerifyDisposed = true
        this.deps.verify?.dispose?.()
      }
    }
  }
}
