// The only contract between the extension host and the webview. Every message
// crossing postMessage in either direction is validated with these schemas at
// the receiving side; anything that fails validation is logged and dropped.
//
// Shared by both TypeScript projects (host and webview), so this file must not
// import from `vscode`, Node, or the DOM.

import { modelApiStatusSchema } from './serviceStatus'
import { providerSetupSchema } from './providerSetup'
import * as z from 'zod/mini'
import {
  agentEventSchema,
  answerSchema,
  itemSnapshotSchema,
  requirementRefSchema,
  sessionGoalSchema,
  todoItemSchema,
} from './agentEvents'
import {
  CHAT_REFERENCE_INTENTS,
  CHECKPOINT_AVAILABILITIES,
  CHECKPOINT_RESTORE_BLOCKERS,
  CLARIFICATION_MAX_CHARS,
  DICTATION_ACTIONS,
  DICTATION_ENGINES,
  DICTATION_UI_STATUSES,
  EFFORT_LEVELS,
  EXPORT_FORMATS,
  GOAL_COMMANDS,
  MAX_ATTACHMENT_BASE64_CHARS,
  MODEL_PRICINGS,
  PAID_FEATURES,
  PERMISSION_MODES,
  PREFERRED_LOCATIONS,
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_EVENT_KINDS,
  REPORT_FRAME_PATH_MAX_CHARS,
  REPORT_STACK_MAX_FRAMES,
  REPORT_WEBVIEW_ERROR_KINDS,
  SUBAGENT_ACTIONS,
  WEBVIEW_ERROR_MESSAGE_MAX_CHARS,
  WEBVIEW_ERROR_SOURCES,
  WEBVIEW_ERROR_STACK_MAX_CHARS,
} from './constants'
import {
  commitFormSchema,
  GIT_ACTIONS,
  GIT_DRAFT_KINDS,
  GIT_FORMS,
  gitDraftSchema,
  gitStateSchema,
  pullRequestFormSchema,
} from './git'
import { judgeStatusSchema } from './judge'
import { paidStateSchema } from './paid'
import { patchHunkSchema } from './patchDocument'
import { reviewRequestSchema } from './reviewCommand'
import { scheduleCadenceSchema } from './schedule'
import { bestOfNRunSchema } from './bestOfN'
import { boardRowSchema } from './sessionBoard'
import { sessionRowSchema } from './sessions'
import {
  accountFactsSchema,
  providerUsageRowSchema,
  subscriptionUsageSchema,
  usageInsightsSchema,
} from './usage'

// Settings the webview needs to render. Host-only settings (binary path,
// environment variables) are deliberately absent. The shape is exported so the
// host-side settings reader validates with the very same schemas.
export const settingsSnapshotShape = {
  preferredLocation: z.enum(PREFERRED_LOCATIONS),
  initialPermissionMode: z.enum(PERMISSION_MODES),
  autosave: z.boolean(),
  attachOpenFile: z.boolean(),
  useCtrlEnterToSend: z.boolean(),
  hideOnboarding: z.boolean(),
  focusView: z.boolean(),
  respectGitIgnore: z.boolean(),
  confidentialWorkspace: z.boolean(),
  allowDangerouslySkipPermissions: z.boolean(),
  /** Days of inactivity after which the History dialog hides a session; 0 never. */
  archiveInactiveSessions: z.number(),
  /** Tokens and the dollar estimate under each Model API reply (M82); off by default. */
  modelApiReplyUsage: z.boolean(),
  /** The Auto reviewer on Muse Code (M90): the Modes menu words Auto with it. */
  museCodeAutoReviewer: z.boolean(),
} as const

const settingsSnapshotSchema = z.object(settingsSnapshotShape)

/** One applied edit the host can revert: the tool item and its patch document. */
const editRefSchema = z.object({ itemId: z.string(), outputRef: z.string() })
export type EditRef = z.infer<typeof editRefSchema>

// Rewind the conversation to before a user card (M53): a fork cut just
// before its turn, its prompt back in the composer.
const rewindConversationSchema = z.object({
  type: z.literal('rewindConversation'),
  sourceSessionId: z.string().check(z.minLength(1)),
  itemId: z.string().check(z.minLength(1)),
  turnId: z.string(),
  lastTurnId: z.optional(z.string()),
  text: z.string(),
  imageCount: z.number(),
  attachmentEpoch: z.optional(z.number()),
})

const indexSchema = z.int().check(z.gte(0))

/**
 * One file of one edit as the review pane lists it (M70): the edit's item
 * and patch, the file's place in the patch, its workspace-relative path and
 * its hunks. `refusal` says why its hunks cannot be reverted here.
 */
const reviewFileSchema = z.object({
  itemId: z.string(),
  outputRef: z.string(),
  fileIndex: indexSchema,
  path: z.string(),
  refusal: z.optional(z.string()),
  hunks: z.array(patchHunkSchema),
})
export type ReviewFile = z.infer<typeof reviewFileSchema>

// What the host reads from VS Code's webview state (`setState`): the
// session the panel shows, so a panel rebuilt after a window reload resumes
// it (PLAN.md D15). The webview keeps its own conversation snapshot beside
// it (M25, src/webview/state/snapshot.ts); the host never reads that part.
const persistedStateSchema = z.object({
  sessionId: z.optional(z.string()),
  sideChat: z.optional(z.boolean()),
})
export type PersistedState = z.infer<typeof persistedStateSchema>

export function parsePersistedState(raw: unknown): PersistedState {
  const parsed = persistedStateSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>

export const AUTH_STATUSES = [
  'checking',
  'noCli',
  'installing',
  'signedOut',
  'signingIn',
  'signedIn',
  'error',
] as const
export type AuthStatus = (typeof AUTH_STATUSES)[number]

export const SIGN_IN_METHODS = ['browser', 'apiKey', 'byo'] as const
export type SignInMethod = (typeof SIGN_IN_METHODS)[number]

export const BACKEND_KINDS = ['museCode', 'modelApi'] as const
export type BackendKind = (typeof BACKEND_KINDS)[number]

// Things the webview asks the host to do outside the conversation itself.
/**
 * What a message replies to or quotes from the chat (M17): `reply` from an
 * output's actions menu, `question` or `comment` from a highlighted passage.
 * `role` names who wrote the passage (assistant, user, tool).
 */
export const chatReferenceSchema = z.object({
  intent: z.enum(CHAT_REFERENCE_INTENTS),
  role: z.string(),
  entryId: z.optional(z.string()),
  text: z.string(),
})
export type ChatReference = z.infer<typeof chatReferenceSchema>

/** Lines (1-based, inclusive) a tool row asks the editor to select (M16). */
export interface LineRange {
  readonly startLine: number
  readonly endLine: number
}

export const HOST_ACTIONS = [
  'openSettings',
  'openKeybindings',
  'openLog',
  'toggleFocusView',
  'toggleCtrlEnterToSend',
  /** "Hide these tips" on the empty state: sets museSpark.hideOnboarding (M8). */
  'hideOnboarding',
  /** The error boundary asks for a fresh webview document (M11). */
  'reload',
  /** The Agent map's "open the Muse Code settings file" (M14). */
  'openMuseSettings',
  /** The palette's "Manage skills…" and "Import skills…" (M30). */
  'manageSkills',
  'importSkills',
  /** The palette's "Import from other agents…" (M83). */
  'importFromAgents',
  /** The palette's "MCP servers…" and "Hooks…" (M31). */
  'showMcpServers',
  'showHooks',
  /** The palette's "Memory…" (M49). */
  'showMemory',
  /** The palette's "New worktree…" and "Remove a worktree…" (M32). */
  'newWorktree',
  'removeWorktree',
  /** The palette's "Open a pull request in a conversation…" (M71). */
  'openPullRequestInConversation',
  /** A Muse Code fault's notice: stop `muse serve`, the next message starts it (D26). */
  'restartMuseCode',
  'openModelApiStatus',
  /**
   * The task list's "Open in a tab" (M87, PLAN.md D66): an editor tab that
   * mirrors this conversation's list, which the user can move into a window
   * of its own. The conversation controller answers it itself.
   */
  'openTasksTab',
  /** The bundled skills' offer for Muse Code (M89, PLAN.md D68): Install, Update, Not now. */
  'installBundledSkills',
  'updateBundledSkills',
  'declineBundledSkills',
  /** The first-run screen's third choice (M95): the wizard at "Pick a provider". */
  'startWithOwnModel',
  /** The model picker's footer rows (M95): the provider quick-pick, the Models & Agents panel. */
  'addModelProvider',
  'manageModels',
  /** The palette's "What's New" (M99, PLAN.md D79): this version's release notes in an editor tab. */
  'showWhatsNew',
] as const
export type HostAction = (typeof HOST_ACTIONS)[number]

export const NOTICE_LEVELS = ['info', 'warning', 'error'] as const
/**
 * The way on a notice offers (D26): the panel's own New conversation, or a
 * host action: `restartMuseCode`, or the bundled skills' Install, Update
 * and Not now (M89).
 */
export const NOTICE_ACTIONS = [
  'restartMuseCode',
  'openModelApiStatus',
  'newConversation',
  'installBundledSkills',
  'updateBundledSkills',
  'declineBundledSkills',
] as const
export type NoticeAction = (typeof NOTICE_ACTIONS)[number]

// A BYO provider's fields (M95, PLAN.md D74): absent on Meta's own models.
// `providerId` is the reference's provider (`meta` is never sent: bare ids
// are Meta's); `pricing` tells the picker and usage how the price reads;
// per-M-token prices only where the provider prices the model.
const modelOptionSchema = z.object({
  modelId: z.string(),
  displayLabel: z.string(),
  contextLimit: z.optional(z.number()),
  isDefault: z.boolean(),
  providerId: z.optional(z.string()),
  providerLabel: z.optional(z.string()),
  pricing: z.optional(z.enum(MODEL_PRICINGS)),
  inputUsdPerMTokens: z.optional(z.number()),
  outputUsdPerMTokens: z.optional(z.number()),
  /** Pinned in the Models section: first in the composer's picker (M95). */
  isPinned: z.optional(z.boolean()),
  /** The provider or route may train on the content (hidden when confidential). */
  trainsOnContent: z.optional(z.boolean()),
})
export type ModelOption = z.infer<typeof modelOptionSchema>

const skillOptionSchema = z.object({
  selector: z.string(),
  displayName: z.string(),
  description: z.string(),
  argumentHint: z.optional(z.string()),
})
export type SkillOption = z.infer<typeof skillOptionSchema>

// An image, or (M54, PLAN.md D47) a PDF: no pixel size, and its page count
// when the page tree could be read.
const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.string(),
  width: z.optional(z.number()),
  height: z.optional(z.number()),
  sizeBytes: z.number(),
  pageCount: z.optional(z.number()),
})
export type AttachmentSummary = z.infer<typeof attachmentSchema>

const mentionItemSchema = z.object({ path: z.string(), isFolder: z.boolean() })
export type MentionItem = z.infer<typeof mentionItemSchema>

// The active editor as the composer chip shows it (M5). The selected text
// itself stays in the host; the webview only needs the label.
const editorContextSummarySchema = z.object({
  /** Workspace-relative with forward slashes. */
  relativePath: z.string(),
  /** 1-based, inclusive. */
  startLine: z.number(),
  endLine: z.number(),
  /** True when nothing is highlighted (a bare caret). */
  isEmpty: z.boolean(),
})
export type EditorContextSummary = z.infer<typeof editorContextSummarySchema>

const composerStateSchema = z.object({
  type: z.literal('composerState'),
  effort: z.enum(EFFORT_LEVELS),
  isThinkingEnabled: z.boolean(),
  permissionMode: z.enum(PERMISSION_MODES),
})

// The Plan-mode reply a plan action names (M79): its session and its item.
const planReplyFields = {
  sourceSessionId: z.string().check(z.minLength(1)),
  itemId: z.string().check(z.minLength(1)),
} as const

// Report a problem (M93, PLAN.md D72): the report workflow's wire shapes,
// exported for lane W's messages and handler. No free-text event payload
// crosses here: fixed event kinds, counts and bounded identifiers only. Raw
// messages, stacks, paths, prompts and session ids stay out; every object is
// strict, so a forged extra field fails instead of riding along.
export const reportEventRefSchema = z.strictObject({
  /** Which recorded event this handoff names. */
  kind: z.enum(REPORT_EVENT_KINDS),
  /**
   * The event's place in this window's recording order (its sequence
   * number, from 0): which failure the row means, never its text. The
   * report itself always reads the whole retained journal.
   */
  entryIndex: z.int().check(z.gte(0)),
})
export type ReportEventRef = z.infer<typeof reportEventRefSchema>

const reportFrameSchema = z.strictObject({
  /** A package-relative path the recorder already verified. */
  path: z.string().check(z.minLength(1), z.maxLength(REPORT_FRAME_PATH_MAX_CHARS)),
  line: z.int().check(z.gte(1)),
  column: z.int().check(z.gte(0)),
})

/**
 * What the webview posts for window.onerror, unhandledrejection and React
 * boundary failures: the scrubbed shape only. `code` is a known short code
 * or REPORT_UNKNOWN_ERROR_CODE; `frames` are bounded verified frames.
 */
export const reportWebviewErrorSchema = z.strictObject({
  kind: z.enum(REPORT_WEBVIEW_ERROR_KINDS),
  source: z.enum(WEBVIEW_ERROR_SOURCES),
  code: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
  frames: z.array(reportFrameSchema).check(z.maxLength(REPORT_STACK_MAX_FRAMES)),
})
export type ReportWebviewError = z.infer<typeof reportWebviewErrorSchema>

// Report a problem (M93 lane W, PLAN.md D72): the preview dialog's wire
// shapes. The dialog shows only what the host built from lane P's sealed
// draft: these messages carry the user's choices (a description within its
// cap, section switches, which journal entries to drop) and bounded
// identifiers (a journal index, a draft seal), never report content, event
// text, paths or raw error text. Every object is strict, so a forged extra
// field (a message, a stack, a text) fails instead of riding along.

/** Where a sealed draft goes: the issue page, the clipboard, a file, or the VS Code reporter. */
export const REPORT_EXPORT_CHANNELS = ['copy', 'issue', 'save', 'vscodeReporter'] as const
export type ReportExportChannel = (typeof REPORT_EXPORT_CHANNELS)[number]

/** Why an export did not happen: stale (rebuild and try again), refused, or cancelled quietly. */
export const REPORT_EXPORT_REASONS = [
  'stale',
  'cancelled',
  'copyFailed',
  'saveFailed',
  'openFailed',
  'reporterFailed',
] as const
export type ReportExportReason = (typeof REPORT_EXPORT_REASONS)[number]

/** A sealed draft is SHA-256 over title and text: 64 hex characters. */
export const REPORT_HASH_HEX_CHARS = 64

/** One removable row of the preview: the facts section or one journal event by index. */
export const reportDraftItemSchema = z.object({
  kind: z.enum(['facts', 'event']),
  /** The journal entry's place, for `event` items only. */
  eventIndex: z.optional(z.int().check(z.gte(0))),
  /** Built by the host from fixed vocabularies; the webview renders it as is. */
  label: z.string().check(z.minLength(1)),
})
export type ReportDraftItem = z.infer<typeof reportDraftItemSchema>

const webviewToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('readReference') }),
  z.object({ type: z.literal('openReferenceSetting'), key: z.string() }),
  z.object({ type: z.literal('runReferenceCommand'), command: z.string() }),
  // Sent once when the React app has mounted and is listening for messages.
  z.object({ type: z.literal('ready'), attachmentEpoch: z.optional(z.number()) }),
  // The composer gained or lost keyboard focus; drives the
  // `museSpark.inputFocused` context key behind Ctrl+Esc.
  z.object({ type: z.literal('inputFocusChanged'), focused: z.boolean() }),
  // The panel's document gained focus (M25): it becomes the surface the
  // keybindings (New Conversation, Alt+T) act on.
  z.object({ type: z.literal('surfaceFocused') }),
  // Something threw in the webview (M39): the host logs it. Cut to these
  // lengths by the sender; nothing the user typed is sent.
  z.object({
    type: z.literal('webviewError'),
    source: z.enum(WEBVIEW_ERROR_SOURCES),
    message: z.string().check(z.maxLength(WEBVIEW_ERROR_MESSAGE_MAX_CHARS)),
    stack: z.optional(z.string().check(z.maxLength(WEBVIEW_ERROR_STACK_MAX_CHARS))),
  }),
  // The user pressed Send. `localId` lets the host confirm or reject the
  // optimistic echo the webview already rendered; `attachmentIds` name the
  // images the host is holding for this message.
  z.object({
    type: z.literal('sendMessage'),
    localId: z.string(),
    text: z.string(),
    attachmentIds: z.array(z.string()),
    /** The editor-context chip was on: the host adds the active file / selection. */
    includeEditorContext: z.optional(z.boolean()),
    /** The message replies to an output or quotes a passage (M17). */
    reference: z.optional(chatReferenceSchema),
    /**
     * M92e (PLAN.md D71): the user saw the secret prompt for this text and
     * chose Send anyway. The host skips the secret hold for this send only.
     */
    secretAccepted: z.optional(z.boolean()),
    /**
     * The user asked the model for a commit message or a pull request's
     * text (M71): the host adds what the model needs, and the reply fills the form.
     */
    gitDraft: z.optional(z.enum(GIT_DRAFT_KINDS)),
    /** The PR form's edited base, so its draft describes the same comparison. */
    gitDraftBase: z.optional(z.string()),
  }),
  // Edit on a queued message (M87, PLAN.md D66): take it back before the
  // model has it. The ids are those `turnAccepted` gave its card; the host
  // acts only on a message it accepted as queued or steered in this
  // conversation under the same ids, and answers `queuedWithdrawn` or
  // `withdrawRefused`.
  z.object({
    type: z.literal('withdrawQueued'),
    localId: z.string().check(z.minLength(1)),
    turnId: z.string().check(z.minLength(1)),
    userMessageId: z.optional(z.string().check(z.minLength(1))),
  }),
  // The user pressed Stop.
  z.object({ type: z.literal('runManualHook'), name: z.string().check(z.minLength(1)) }),
  z.object({ type: z.literal('cancelTurn') }),
  z.object({ type: z.literal('signIn'), method: z.enum(SIGN_IN_METHODS) }),
  z.object({ type: z.literal('installMuseCode') }),
  z.object({ type: z.literal('cancelSignIn') }),
  z.object({ type: z.literal('signOut') }),
  // Re-check for the CLI / restart the backend after an error.
  z.object({ type: z.literal('retryBackend') }),
  z.object({ type: z.literal('openExternal'), url: z.string() }),
  // Composer controls.
  z.object({ type: z.literal('setModel'), modelId: z.string() }),
  z.object({ type: z.literal('setEffort'), effort: z.enum(EFFORT_LEVELS) }),
  z.object({ type: z.literal('setThinking'), enabled: z.boolean() }),
  z.object({ type: z.literal('setPermissionMode'), mode: z.enum(PERMISSION_MODES) }),
  // "/clear": forget this surface's session; the next send starts a new one.
  z.object({ type: z.literal('clearConversation'), attachmentEpoch: z.optional(z.number()) }),
  // "/compact": ask the host to summarise older context.
  z.object({ type: z.literal('compact') }),
  // "/handoff …": distil this conversation into a brief for a fresh one
  // (M74). `requestId` correlates the brief's dialog; `goal` is the text
  // after the command. The host cards the accepted request itself.
  z.object({
    type: z.literal('requestHandoff'),
    requestId: z.string(),
    goal: z.optional(z.string()),
  }),
  // The handoff dialog's Start: the brief as edited. Cancel only dismisses.
  z.object({ type: z.literal('confirmHandoff'), requestId: z.string(), brief: z.string() }),
  z.object({ type: z.literal('cancelHandoff'), requestId: z.string() }),
  // The session goal (M45, PLAN.md D38): `/goal …` in the prompt or the goal
  // strip's controls. `set` and `edit` carry the objective.
  z.object({
    type: z.literal('goalCommand'),
    requestId: z.string(),
    verb: z.enum(GOAL_COMMANDS),
    objective: z.optional(z.string()),
  }),
  // Model API schedules only (M52): validated before crossing into the host.
  z.object({
    type: z.literal('scheduleCreate'),
    cadence: scheduleCadenceSchema,
    prompt: z.string(),
  }),
  z.object({ type: z.literal('scheduleList') }),
  z.object({ type: z.literal('scheduleCancel'), id: z.string() }),
  z.object({ type: z.literal('scheduleRun'), id: z.string(), occurrenceMs: z.number() }),
  // "/export" and "Export session log…" (M30): Markdown, or Muse Code's JSON log.
  z.object({ type: z.literal('exportConversation'), format: z.enum(EXPORT_FORMATS) }),
  // "Import session…" and "Open share file…" (M84): a portable JSON file
  // picked on the host; the import resumes it on the Model API backend.
  z.object({ type: z.literal('importSession') }),
  z.object({ type: z.literal('openShareFile') }),
  // The palette opened: (re)load the session's skills.
  z.object({ type: z.literal('listSkills') }),
  // @-mention menu: `requestId` lets the webview drop stale answers.
  z.object({ type: z.literal('searchMentions'), requestId: z.number(), query: z.string() }),
  // "+" / "Attach file…": native open dialog; images (and, on the Model API
  // backend, PDFs: M54) become attachments, other files `@path` mentions.
  z.object({ type: z.literal('pickFile') }),
  // "Mention file from this project…": QuickPick over the workspace index.
  z.object({ type: z.literal('pickMentionFile') }),
  // An image pasted or dropped into the composer, or (M54) a PDF: the name
  // stays for the wire's sake; the host tells them apart by their bytes.
  z.object({
    type: z.literal('attachImageData'),
    name: z.string(),
    mediaType: z.string(),
    base64: z.string().check(z.maxLength(MAX_ATTACHMENT_BASE64_CHARS)),
    requestId: z.optional(z.string()),
    attachmentEpoch: z.optional(z.number()),
  }),
  z.object({ type: z.literal('removeAttachment'), id: z.string() }),
  // Editor resources dropped onto the composer (`text/uri-list`).
  z.object({ type: z.literal('droppedUris'), uris: z.array(z.string()) }),
  z.object({ type: z.literal('hostAction'), action: z.enum(HOST_ACTIONS) }),
  // Approval card: one of the request's `availableChoices`.
  z.object({
    type: z.literal('decideApproval'),
    approvalId: z.string(),
    choiceId: z.string(),
    requirementId: requirementRefSchema,
    feedback: z.optional(z.string()),
  }),
  // Question card: Cancel declines the prompt; the model sees a cancelled result (M16).
  z.object({ type: z.literal('cancelQuestion'), userInputId: z.string() }),
  // Elicitation form (M91 lane M): accept with the form's values (validated
  // against the schema before they reach the server), or decline or cancel.
  z.object({
    type: z.literal('elicitationAnswer'),
    elicitationId: z.string(),
    action: z.enum(['accept', 'decline', 'cancel']),
    values: z.optional(z.record(z.string(), z.unknown())),
  }),
  // Question card: one answer per question.
  z.object({
    type: z.literal('answerQuestion'),
    userInputId: z.string(),
    answers: z.array(answerSchema),
  }),
  // Question card: an explanation instead of the options (M46, `userInput/clarify`).
  z.object({
    type: z.literal('clarifyQuestion'),
    userInputId: z.string(),
    text: z.string().check(z.maxLength(CLARIFICATION_MAX_CHARS)),
  }),
  // A running command to the background (the row's button, M46); Ctrl+B is
  // the host's own command.
  z.object({ type: z.literal('moveToBackground'), itemId: z.string() }),
  // A background task's Stop, or the user's own command's (M46).
  z.object({ type: z.literal('stopTask'), itemId: z.string() }),
  // The Agent map's Stop all (M46).
  z.object({ type: z.literal('stopAllTasks') }),
  // A `!` prompt (M46): the command, without the `!`.
  z.object({ type: z.literal('runUserShell'), command: z.string() }),
  // Tool row: fetch one page of a stored output or patch document.
  z.object({
    type: z.literal('readOutput'),
    itemId: z.string(),
    outputRef: z.string(),
    offsetBytes: z.number(),
  }),
  // Tool row: the picture a tool read or made, by the path it named (M43).
  z.object({
    type: z.literal('readToolImage'),
    itemId: z.string(),
    path: z.string(),
  }),
  // Tool row: open the whole output in an editor tab (M15). `text` is the
  // transcript's copy; a stored output (`outputRef`) is paged in full instead.
  z.object({
    type: z.literal('openOutput'),
    itemId: z.string(),
    label: z.string(),
    text: z.string(),
    outputRef: z.optional(z.string()),
  }),
  // Code block actions.
  z.object({ type: z.literal('copyText'), text: z.string() }),
  z.object({ type: z.literal('insertCode'), text: z.string() }),
  // Replace the active editor's selection with the block (M5).
  z.object({ type: z.literal('applyCode'), text: z.string() }),
  // Edit review (M5): the stored patch of a completed edit-family item in the
  // diff editor (the inline diff's "Click to expand" since M15).
  z.object({ type: z.literal('openEditDiff'), itemId: z.string(), outputRef: z.string() }),
  // An edit row's Revert (M87, PLAN.md D66 item 17): that edit's stored patch
  // reverse-applied after the file-action confirmation, as one step of
  // "Rewind code to here" is (M13, M72).
  z.object({ type: z.literal('revertEdit'), itemId: z.string(), outputRef: z.string() }),
  // A tool row's path: open the file, selecting the changed lines when known (M16, `LineRange`).
  z.object({
    type: z.literal('openFile'),
    path: z.string(),
    startLine: z.optional(z.number()),
    endLine: z.optional(z.number()),
  }),
  // Rewind code to a message: revert every edit after it, newest first (M13).
  // With `fork` ("Fork conversation and rewind code", M72) the host forks
  // after the rewind, in one action: before `lastTurnId`, or a fresh
  // conversation without one.
  z.object({
    type: z.literal('rewindCode'),
    edits: z.array(editRefSchema),
    fork: z.optional(
      z.object({
        lastTurnId: z.optional(z.string()),
        attachmentEpoch: z.optional(z.number()),
      }),
    ),
  }),
  // `/review …` or a palette review row (M70): the card the webview already
  // shows is `localId`, reading `text`; answered by turnAccepted or sendFailed.
  z.object({
    type: z.literal('startReview'),
    localId: z.string(),
    text: z.string(),
    request: reviewRequestSchema,
  }),
  // The review pane opened (M70): the conversation's edits, oldest first.
  z.object({
    type: z.literal('readReviewChanges'),
    requestId: z.string(),
    edits: z.array(editRefSchema),
  }),
  // The review pane's Revert on one hunk (M70).
  z.object({
    type: z.literal('revertReviewHunk'),
    itemId: z.string(),
    outputRef: z.string(),
    fileIndex: indexSchema,
    hunkIndex: indexSchema,
  }),
  rewindConversationSchema,
  // "Restore files to here" (M72): the workspace's files back to the
  // checkpoint before this turn; with `rewind`, the conversation rewinds as
  // well once the files are restored ("Rewind conversation and restore files").
  z.object({
    type: z.literal('restoreFiles'),
    sourceSessionId: z.string().check(z.minLength(1)),
    turnId: z.string().check(z.minLength(1)),
    rewind: z.optional(rewindConversationSchema),
  }),
  // A restore's Redo (M72, M86): what it replaced goes back, only in the
  // conversation it was offered in.
  z.object({
    type: z.literal('redoRestore'),
    restoreId: z.string().check(z.minLength(1)),
    sourceSessionId: z.string().check(z.minLength(1)),
  }),
  // Session history (M6).
  z.object({ type: z.literal('listSessions') }),
  // The session board (M77): every conversation in the window and its worktrees.
  z.object({ type: z.literal('requestSessionBoard') }),
  z.object({
    type: z.literal('activateBoardSession'),
    sessionId: z.string(),
    backend: z.enum(BACKEND_KINDS),
  }),
  // Best-of-N on the Model API (M77): the same prompt in N worktrees. The
  // host checks the bounds and answers with `bestOfNUpdate` or a notice.
  z.object({
    type: z.literal('startBestOfN'),
    prompt: z.string(),
    attempts: z.int(),
    requestCeilingPerAttempt: z.int(),
  }),
  // "Take this one": apply and stage this attempt's frozen preview.
  z.object({
    type: z.literal('takeBestOfNAttempt'),
    runId: z.string(),
    attemptId: z.string(),
  }),
  z.object({ type: z.literal('openBestOfNAttempt'), runId: z.string(), attemptId: z.string() }),
  z.object({ type: z.literal('cancelBestOfN'), runId: z.string() }),
  // The Agent map reads a subagent's own session (M14).
  z.object({ type: z.literal('readChildSession'), sessionId: z.string() }),
  // The Agent map's owner controls (M18, M48), including reopen and readResult.
  z.object({
    type: z.literal('subagentControl'),
    subagentId: z.string(),
    action: z.enum(SUBAGENT_ACTIONS),
  }),
  // A note to a running subagent, or a follow-up task for a finished one (M18).
  z.object({
    type: z.literal('subagentMessage'),
    subagentId: z.string(),
    body: z.string(),
    isFollowup: z.boolean(),
  }),
  z.object({
    type: z.literal('resumeSession'),
    sessionId: z.string(),
    attachmentEpoch: z.optional(z.number()),
  }),
  z.object({
    type: z.literal('setSessionArchived'),
    sessionId: z.string(),
    isArchived: z.boolean(),
  }),
  /** Fork the current session through `lastTurnId` (all turns when absent). */
  z.object({
    type: z.literal('forkSession'),
    lastTurnId: z.optional(z.string()),
    attachmentEpoch: z.optional(z.number()),
  }),
  z.object({
    type: z.literal('openSideChat'),
    sourceSessionId: z.string().check(z.minLength(1)),
  }),
  // Plans as files (M79): the latest Plan-mode reply saved under
  // `.agents/plans/`, or implemented in a fresh conversation. The host reads
  // the reply back itself; the ids only name it.
  z.object({ type: z.literal('savePlan'), ...planReplyFields }),
  z.object({ type: z.literal('implementPlan'), ...planReplyFields }),
  // The palette's Plans… (M79): the host lists them in a pick.
  z.object({ type: z.literal('showPlans') }),
  z.object({ type: z.literal('renameSession'), name: z.string() }),
  // Account & usage (M8): ask for the subscription window; answered by usageReport.
  z.object({ type: z.literal('readUsage') }),
  // Voice dictation (M9): the microphone button / Ctrl+D. Recognised text
  // comes back as `insertText`; the button state as `dictationState`.
  z.object({ type: z.literal('dictation'), action: z.enum(DICTATION_ACTIONS) }),
  // The palette's paid-feature toggles (M33, PLAN.md D30): on asks the host's
  // confirmation first, which names the price.
  z.object({
    type: z.literal('setPaidFeature'),
    feature: z.enum(PAID_FEATURES),
    isOn: z.boolean(),
  }),
  // Account & usage's "Ask again" (M58): no paid feature stays allowed
  // always in this workspace.
  z.object({ type: z.literal('forgetPaidUse') }),
  // Git and pull requests (M71, PLAN.md D49): the panel's buttons and forms.
  z.object({ type: z.literal('gitAction'), action: z.enum(GIT_ACTIONS) }),
  z.object({
    type: z.literal('gitCommit'),
    message: z.string(),
    /** Stage every change first, new files included. */
    includeUnstaged: z.boolean(),
  }),
  z.object({
    type: z.literal('gitCreatePullRequest'),
    /** The branch the form showed: a different one now refuses the request. */
    head: z.string(),
    base: z.string(),
    title: z.string(),
    body: z.string(),
    isDraft: z.boolean(),
  }),
  // Report a problem (M93 lane W): the preview dialog's requests. Strict:
  // the dialog's choices and bounded identifiers only. `ref` is the
  // sanitized handoff from an error row, a notice or the render fallback —
  // which recorded event the user means, never its text.
  z.strictObject({ type: z.literal('openReport'), ref: z.optional(reportEventRefSchema) }),
  // A description edit, a section switch or an item removal: the host
  // rebuilds lane P's sealed draft and answers with a fresh `reportDraft`.
  z.strictObject({
    type: z.literal('updateReport'),
    // The dialog's own count of the choices it sent (1, 2, …): the host
    // echoes it on the rebuilt draft, so an older reply never settles a
    // newer choice.
    revision: z.int().check(z.gte(1)),
    description: z.string().check(z.maxLength(REPORT_DESCRIPTION_MAX_CHARS)),
    includeFacts: z.boolean(),
    includeEvents: z.boolean(),
    removedEventIndexes: z
      .array(z.int().check(z.gte(0)))
      .check(z.maxLength(REPORT_RECENT_EVENT_COUNT)),
  }),
  // Export the previewed draft through lane P's export paths. `hash` is the
  // seal of the draft on screen; any change since the preview refuses here.
  z.strictObject({
    type: z.literal('exportReport'),
    via: z.enum(REPORT_EXPORT_CHANNELS),
    hash: z.string().check(z.minLength(REPORT_HASH_HEX_CHARS), z.maxLength(REPORT_HASH_HEX_CHARS)),
  }),
  // The scrubbed webview failure (M93 lane W): window.onerror,
  // unhandledrejection and React-boundary posts carry lane 0's bounded
  // identifiers only — lane 0's fields, never the error's message, stack or
  // anything the user typed. M39's `webviewError` (with its text, for the
  // host's log) is unchanged.
  z.strictObject({
    type: z.literal('reportWebviewError'),
    ...reportWebviewErrorSchema.shape,
  }),
])

export type WebviewToHostMessage = z.infer<typeof webviewToHostMessageSchema>

const hostToWebviewMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('openHelp') }),
  z.object({
    type: z.literal('referenceValues'),
    error: z.optional(z.boolean()),
    model: z.string(),
    values: z.record(z.string(), z.string()),
    nls: z.record(z.string(), z.string()),
  }),
  // Reply to `ready`: everything the shell needs to render its first frame.
  z.object({
    type: z.literal('init'),
    emptyStateHint: z.string(),
    composerPlaceholder: z.string(),
    settings: settingsSnapshotSchema,
    sideChat: z.optional(z.boolean()),
  }),
  // A `museSpark.*` setting changed while the webview was open.
  z.object({ type: z.literal('settingsChanged'), settings: settingsSnapshotSchema }),
  // Move keyboard focus into the composer (Ctrl+Esc).
  z.object({ type: z.literal('focusInput') }),
  // Open Account & usage (the Tab status menu's row, M94; RVM94HU 21).
  z.object({ type: z.literal('openUsage') }),
  // The host dropped this surface's conversation (M25): New Conversation
  // from a keybinding, or the echo of the webview's own clear.
  z.object({ type: z.literal('conversationCleared'), accountBoundary: z.optional(z.boolean()) }),
  // Sent first on every `ready` (M25): the session and turn the host holds
  // for this surface, so a reloaded webview keeps the transcript it saved
  // only when that conversation is still the live one.
  z.object({
    type: z.literal('surfaceState'),
    sessionId: z.optional(z.string()),
    activeTurnId: z.optional(z.string()),
    /** The host's monotonic browser-file guard; older saved webviews raise their epoch. */
    attachmentEpoch: z.optional(z.number()),
  }),
  // Insert text at the composer caret (Alt+K mention reference).
  z.object({ type: z.literal('insertText'), text: z.string() }),
  z.object({ type: z.literal('restoreDraft'), text: z.string() }),
  // The active editor changed (M5); undefined when no text file is active.
  z.object({
    type: z.literal('editorContext'),
    context: z.optional(editorContextSummarySchema),
  }),
  // Backend / credential state, driving the sign-in screen and Send button.
  z.object({
    type: z.literal('authState'),
    status: z.enum(AUTH_STATUSES),
    detail: z.optional(z.string()),
    /** Which backend the window uses once signed in (M7). */
    backend: z.optional(z.enum(BACKEND_KINDS)),
    /** The sign-in paths the gate offers; both when absent. */
    methods: z.optional(z.array(z.enum(SIGN_IN_METHODS))),
    verificationUrl: z.optional(z.url()),
    userCode: z.optional(z.string()),
    installCommand: z.optional(z.string()),
    hasCli: z.optional(z.boolean()),
    hasCliSession: z.optional(z.boolean()),
    installState: z.optional(z.enum(['running', 'failed'])),
  }),
  // The active session's model (shown in the composer pill) and identity.
  z.object({
    type: z.literal('sessionInfo'),
    modelId: z.string(),
    sideChat: z.optional(z.boolean()),
    contextLimit: z.optional(z.number()),
    sessionId: z.optional(z.string()),
    // `false` where the host refuses rename and fork (D26); absent means offered.
    canEditSessions: z.optional(z.boolean()),
  }),
  // A decision the host did not take (D26): the approval card can be answered again.
  z.object({ type: z.literal('approvalReopened'), approvalId: z.string() }),
  // A decision refused as stale (D26): the card shows, on itself, that the
  // request moved to another step and waits for a choice there.
  z.object({ type: z.literal('approvalMovedOn'), approvalId: z.string() }),
  // The host no longer waits on this prompt (D26): its card goes, with no outcome.
  z.object({
    type: z.literal('promptDropped'),
    approvalId: z.optional(z.string()),
    userInputId: z.optional(z.string()),
  }),
  // The session board (M77): every conversation's state for the board.
  z.object({ type: z.literal('sessionBoard'), rows: z.array(boardRowSchema) }),
  // Best-of-N (M77): the run after every change: attempts starting and
  // finishing, their diff stats, the take and the end.
  z.object({ type: z.literal('bestOfNUpdate'), run: bestOfNRunSchema }),
  // Session history (M6): the workspace's stored sessions for the dialog.
  z.object({
    type: z.literal('sessionList'),
    sessions: z.array(sessionRowSchema),
    archivedIds: z.array(z.string()),
  }),
  // A resumed or forked session's history: the transcript is rebuilt from it.
  z.object({
    type: z.literal('historyLoaded'),
    sessionId: z.string(),
    sideChat: z.optional(z.boolean()),
    items: z.array(itemSnapshotSchema),
    name: z.optional(z.string()),
    todos: z.array(todoItemSchema),
    // The session goal (M45): `null` when the history says there is none;
    // absent when the history could not say (Muse Code serves the goal only
    // with a snapshot), so the panel keeps what it knew of the same session.
    goal: z.optional(z.nullable(sessionGoalSchema)),
    // The turn still running in the session (D26): Stop and steering stay.
    activeTurnId: z.optional(z.string()),
    // The turns of these items this panel sent in Plan mode (M79): their user
    // cards keep `isPlanTurn`, so a reload keeps Save plan and Implement.
    planTurnIds: z.optional(z.array(z.string())),
    // The session holds imported history (M84, PLAN.md D49): its code
    // blocks offer Copy only, as a share file's do.
    imported: z.optional(z.literal(true)),
  }),
  // Account & usage (M8): the backend this window runs on and the
  // subscription window the CLI last observed (absent on a key, or before
  // the first turn). Sent for readUsage and again on every usage/changed.
  z.object({
    type: z.literal('usageReport'),
    serviceStatus: z.optional(modelApiStatusSchema),
    backend: z.enum(BACKEND_KINDS),
    subscription: z.optional(subscriptionUsageSchema),
    account: z.optional(accountFactsSchema),
    /** From the CLI's trace logs on this machine (M14); absent on the Model API. */
    insights: z.optional(z.object({ day: usageInsightsSchema, week: usageInsightsSchema })),
    /** This window's tallies per BYO provider (M95); absent until one is used. */
    providers: z.optional(z.array(providerUsageRowSchema)),
  }),
  // A finished provider setup (M95): the wizard saved a provider and set the
  // composer's model. The panel confirms once, then leaves first run.
  providerSetupSchema,
  // A subagent's own transcript for the Agent map (M14).
  z.object({
    type: z.literal('childTranscript'),
    sessionId: z.string(),
    name: z.optional(z.string()),
    items: z.array(itemSnapshotSchema),
  }),
  // A local share file rendered read-only (M84, PLAN.md D49): the panel
  // shows it in a modal that can act on nothing. `exportedAt` is ISO 8601.
  z.object({
    type: z.literal('sharePreview'),
    title: z.string(),
    exportedAt: z.string(),
    sourceBackend: z.enum(BACKEND_KINDS),
    modelId: z.string(),
    redacted: z.boolean(),
    items: z.array(itemSnapshotSchema),
  }),
  // Voice dictation (M9): sent on surfaceReady and on every change. `reason`
  // explains an unavailable microphone (no built-in recogniser here).
  // `engine` (M35): `museVoice` while the paid engine records, so the
  // microphone says it is paid.
  z.object({
    type: z.literal('dictationState'),
    status: z.enum(DICTATION_UI_STATUSES),
    reason: z.optional(z.string()),
    engine: z.optional(z.enum(DICTATION_ENGINES)),
  }),
  // The paid features that are on and this window's tally (M33, PLAN.md
  // D30): the composer's badge, the palette's toggles and the usage dialog.
  // Sent on surfaceReady and on every change.
  z.object({ type: z.literal('paidState'), state: paidStateSchema }),
  z.object({ type: z.literal('judgeState'), state: judgeStatusSchema }),
  // A message the host sent itself (M79: a plan's brief): the pending card,
  // as the composer's own Send would have made it. `turnAccepted` or
  // `sendFailed` follows with the same `localId`.
  z.object({
    type: z.literal('briefSubmitted'),
    localId: z.string().check(z.minLength(1)),
    text: z.string(),
    attachments: z.array(attachmentSchema),
  }),
  // The host accepted a sendMessage. Model API also returns its durable user-item ID.
  // `disposition` (M87, PLAN.md D66) is the backend's word for what became
  // of it: `started`, `queued` or `steered`, kept open (D36).
  z.object({
    type: z.literal('turnAccepted'),
    localId: z.string(),
    turnId: z.string(),
    userMessageId: z.optional(z.string().check(z.minLength(1))),
    disposition: z.optional(z.string()),
  }),
  // The host could not submit a sendMessage. `attachmentsKept` (M25): the
  // host still holds the message's images, so the composer shows them again;
  // absent, the webview asks the host to drop any it still holds.
  z.object({
    type: z.literal('sendFailed'),
    localId: z.string(),
    reason: z.string(),
    attachmentsKept: z.optional(z.boolean()),
  }),
  // A queued message was taken back (M87, PLAN.md D66): its card goes and
  // its text returns to the composer. `attachmentsKept`, as on `sendFailed`
  // (M25): its images are back in the composer, each sent before this as
  // `attachmentAdded`; absent, the backend could not give them back.
  z.object({
    type: z.literal('queuedWithdrawn'),
    localId: z.string().check(z.minLength(1)),
    attachmentsKept: z.optional(z.boolean()),
  }),
  // The host did not take it back (M87): the card stays, `reason` says why.
  z.object({
    type: z.literal('withdrawRefused'),
    localId: z.string().check(z.minLength(1)),
    reason: z.string(),
  }),
  // M92e (PLAN.md D71): the prompt holds a detected secret, so nothing was
  // sent. The panel shows its dialog (Send anyway / Edit); the transcript
  // card already rendered is replaced by this redacted text.
  z.object({
    type: z.literal('secretPromptDetected'),
    localId: z.string(),
    redactedText: z.string(),
  }),
  // The command's admission result. Correlation protects a newer composer draft.
  z.object({ type: z.literal('goalCommandResult'), requestId: z.string(), accepted: z.boolean() }),
  // `/handoff` (M74): the distilled brief is ready to review, with the open
  // items the new conversation's todo list starts with. Nothing starts until
  // the user confirms it; the dialog sends the edited text back.
  z.object({
    type: z.literal('handoffReady'),
    requestId: z.string(),
    brief: z.string(),
    goal: z.optional(z.string()),
    todos: z.array(z.string()),
  }),
  // A request's or a confirm's admission result. Correlation protects a
  // newer draft or dialog: only an accepted request clears the composer's
  // `/handoff …`, and a refused confirm keeps the dialog.
  z.object({
    type: z.literal('handoffCommandResult'),
    requestId: z.string(),
    accepted: z.boolean(),
  }),
  // One backend-agnostic conversation event (see agentEvents.ts).
  // `reportRef` (M93): a failed turn the host recorded; its error row
  // offers "Report this" with it, never with the row's text.
  z.object({
    type: z.literal('agentEvent'),
    event: agentEventSchema,
    reportRef: z.optional(reportEventRefSchema),
  }),
  // The host's model catalogue (for the picker and context-limit lookups).
  z.object({ type: z.literal('modelList'), models: z.array(modelOptionSchema) }),
  // The session's user-invocable skills (palette "Skills" group).
  z.object({ type: z.literal('skillList'), skills: z.array(skillOptionSchema) }),
  // The host-owned composer settings for this conversation.
  composerStateSchema,
  z.object({
    type: z.literal('mentionResults'),
    requestId: z.number(),
    items: z.array(mentionItemSchema),
  }),
  z.object({
    type: z.literal('attachmentAdded'),
    attachment: attachmentSchema,
    requestId: z.optional(z.string()),
  }),
  z.object({
    type: z.literal('attachmentRejected'),
    name: z.string(),
    reason: z.string(),
    requestId: z.optional(z.string()),
  }),
  z.object({ type: z.literal('attachmentsCleared') }),
  // A one-line message for the transcript (failed host command, warnings).
  // `redoRestoreId` (M72): a file restore's Redo, offered on its notice.
  // `actions` (D26): the buttons of a Muse Code fault's notice.
  // `reportRef` (M93 lane W): the sanitized handoff when the failure was
  // recorded — which journal event the row means, never its text. The row
  // offers "Report this" only while it is present.
  z.object({
    type: z.literal('notice'),
    level: z.enum(NOTICE_LEVELS),
    text: z.string(),
    redoRestoreId: z.optional(z.string()),
    actions: z.optional(z.array(z.enum(NOTICE_ACTIONS))),
    reportRef: z.optional(reportEventRefSchema),
  }),
  // A Redo was answered (M72): spent, its button goes; otherwise it stays
  // for another try (a file left as it is, a turn running).
  z.object({
    type: z.literal('restoreRedone'),
    restoreId: z.string(),
    isSpent: z.boolean(),
  }),
  // Turn checkpoints (M72): whether this window takes them, and which turns
  // of the conversation shown have one (their cards offer "Restore files").
  z.object({
    type: z.literal('checkpointState'),
    availability: z.enum(CHECKPOINT_AVAILABILITIES),
    canRestore: z.boolean(),
    legacyTurnIds: z.optional(z.array(z.string())),
    restoreBlocker: z.optional(z.enum(CHECKPOINT_RESTORE_BLOCKERS)),
    sessionId: z.optional(z.string()),
    turnIds: z.array(z.string()),
  }),
  // One page of a stored tool output / patch document (answer to readOutput).
  z.object({
    type: z.literal('outputPage'),
    itemId: z.string(),
    outputRef: z.string(),
    offsetBytes: z.number(),
    byteLen: z.number(),
    content: z.string(),
    eof: z.boolean(),
  }),
  // The host did not move or stop this task (M46): the row's button is free again.
  z.object({ type: z.literal('taskRefused'), itemId: z.string() }),
  // Git and pull requests (M71, PLAN.md D49): the panel's cards and forms.
  z.object({ type: z.literal('gitState'), state: gitStateSchema }),
  z.object({ type: z.literal('gitCommitForm'), form: commitFormSchema }),
  z.object({ type: z.literal('gitPullRequestForm'), form: pullRequestFormSchema }),
  z.object({ type: z.literal('gitDraft'), draft: gitDraftSchema }),
  // A form's commit or creation ended: done closes it, a failure reopens its buttons.
  z.object({ type: z.literal('gitDone'), form: z.enum(GIT_FORMS), ok: z.boolean() }),
  // The review pane's files and hunks (answer to readReviewChanges, M70).
  // `omittedEdits` counts the edits past the pane's limits or unreadable;
  // `reason` says why there is nothing to list at all.
  z.object({
    type: z.literal('reviewChanges'),
    requestId: z.string(),
    files: z.array(reviewFileSchema),
    omittedEdits: z.number(),
    reason: z.optional(z.string()),
  }),
  // What became of a hunk's Revert (M70); `reason` when it was not reverted.
  z.object({
    type: z.literal('reviewHunkResult'),
    itemId: z.string(),
    fileIndex: indexSchema,
    hunkIndex: indexSchema,
    isReverted: z.boolean(),
    reason: z.optional(z.string()),
  }),
  // A `!` command that did not run (M46): why, and the command, which goes
  // back into an empty prompt.
  z.object({ type: z.literal('userShellRefused'), command: z.string(), reason: z.string() }),
  // The picture a tool row asked for (answer to readToolImage, M43): a data
  // URI of the file, or why it could not be shown.
  z.object({
    type: z.literal('toolImage'),
    itemId: z.string(),
    path: z.string(),
    dataUri: z.optional(z.string()),
    error: z.optional(z.string()),
  }),
  // Report a problem (M93 lane W): the sealed draft the preview shows
  // byte-identical, with the removable items it contains. Labels are built
  // by the host from fixed vocabularies and relative ages; the webview
  // renders them as is and never builds report content itself. `text` is
  // the exact final draft (lane P's seal over title and text); `hash` is
  // that seal, which the export carries back. Like `notice`'s text, title
  // and text are unbounded: the preview scrolls, and the host built them.
  z.object({
    type: z.literal('reportDraft'),
    // Which dialog session (one per open, counted by the host from 1) and
    // which of its choices (the dialog's `revision`, 0 for the opening
    // draft) this draft answers: a late draft for a closed or older dialog,
    // or for an older choice, is told apart instead of reopening or
    // overwriting it.
    session: z.int().check(z.gte(1)),
    revision: z.int().check(z.gte(0)),
    description: z.string().check(z.maxLength(REPORT_DESCRIPTION_MAX_CHARS)),
    includeFacts: z.boolean(),
    includeEvents: z.boolean(),
    items: z.array(reportDraftItemSchema).check(z.maxLength(REPORT_RECENT_EVENT_COUNT + 1)),
    title: z.string(),
    text: z.string(),
    hash: z.string().check(z.minLength(REPORT_HASH_HEX_CHARS), z.maxLength(REPORT_HASH_HEX_CHARS)),
    canUseVscodeReporter: z.boolean(),
    recordingUnavailable: z.boolean(),
  }),
  // What an export attempt answered (M93 lane W): lane P's outcome mapped
  // to fixed words, so the dialog states failures plainly with no raw
  // text. `issueFallback` (the over-long draft, copied with a paste note)
  // rides only on an opened issue page.
  z.object({
    type: z.literal('reportExported'),
    // The session and the seal of the draft this answer is about: an answer
    // for another draft (edited since, or a dialog closed and reopened) is
    // never shown beside the current one.
    session: z.int().check(z.gte(1)),
    hash: z.string().check(z.minLength(REPORT_HASH_HEX_CHARS), z.maxLength(REPORT_HASH_HEX_CHARS)),
    via: z.enum(REPORT_EXPORT_CHANNELS),
    ok: z.boolean(),
    issueFallback: z.optional(z.boolean()),
    reason: z.optional(z.enum(REPORT_EXPORT_REASONS)),
  }),
])

export type HostToWebviewMessage = z.infer<typeof hostToWebviewMessageSchema>

export type ParseResult<T> =
  { readonly ok: true; readonly message: T } | { readonly ok: false; readonly error: string }

function parseWith<T>(schema: z.ZodMiniType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}

export function parseWebviewToHostMessage(input: unknown): ParseResult<WebviewToHostMessage> {
  return parseWith(webviewToHostMessageSchema, input)
}

export function parseHostToWebviewMessage(input: unknown): ParseResult<HostToWebviewMessage> {
  return parseWith(hostToWebviewMessageSchema, input)
}
