// The only contract between the extension host and the webview. Every message
// crossing postMessage in either direction is validated with these schemas at
// the receiving side; anything that fails validation is logged and dropped.
//
// Shared by both TypeScript projects (host and webview), so this file must not
// import from `vscode`, Node, or the DOM.

import * as z from 'zod/mini'
import {
  agentEventSchema,
  answerSchema,
  itemSnapshotSchema,
  requirementRefSchema,
  todoItemSchema,
} from './agentEvents'
import {
  CHAT_REFERENCE_INTENTS,
  DICTATION_ACTIONS,
  DICTATION_UI_STATUSES,
  EFFORT_LEVELS,
  PERMISSION_MODES,
  PREFERRED_LOCATIONS,
} from './constants'
import { sessionRowSchema } from './sessions'
import { accountFactsSchema, subscriptionUsageSchema, usageInsightsSchema } from './usage'

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
} as const

const settingsSnapshotSchema = z.object(settingsSnapshotShape)

/** One applied edit the host can revert: the tool item and its patch document. */
const editRefSchema = z.object({ itemId: z.string(), outputRef: z.string() })
export type EditRef = z.infer<typeof editRefSchema>

// What the webview keeps in VS Code's webview state (`setState`): the
// session it shows, so a panel rebuilt after a window reload resumes it
// (PLAN.md D15). Anything else stored there restores an empty panel.
const persistedStateSchema = z.object({ sessionId: z.optional(z.string()) })
export type PersistedState = z.infer<typeof persistedStateSchema>

export function parsePersistedState(raw: unknown): PersistedState {
  const parsed = persistedStateSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>

export const AUTH_STATUSES = [
  'checking',
  'noCli',
  'signedOut',
  'signingIn',
  'signedIn',
  'error',
] as const
export type AuthStatus = (typeof AUTH_STATUSES)[number]

export const SIGN_IN_METHODS = ['browser', 'apiKey'] as const
export type SignInMethod = (typeof SIGN_IN_METHODS)[number]

export const BACKEND_KINDS = ['museCode', 'modelApi'] as const
export type BackendKind = (typeof BACKEND_KINDS)[number]

// Things the webview asks the host to do outside the conversation itself.
/**
 * What a message replies to or quotes from the chat (M17): `reply` from an
 * output's actions menu, `question` or `comment` from a highlighted passage.
 * `role` names who wrote the passage (assistant, user, tool).
 */
const chatReferenceSchema = z.object({
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
] as const
export type HostAction = (typeof HOST_ACTIONS)[number]

export const NOTICE_LEVELS = ['info', 'warning', 'error'] as const

const modelOptionSchema = z.object({
  modelId: z.string(),
  displayLabel: z.string(),
  contextLimit: z.optional(z.number()),
  isDefault: z.boolean(),
})
export type ModelOption = z.infer<typeof modelOptionSchema>

const skillOptionSchema = z.object({
  selector: z.string(),
  displayName: z.string(),
  description: z.string(),
  argumentHint: z.optional(z.string()),
})
export type SkillOption = z.infer<typeof skillOptionSchema>

const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.string(),
  width: z.number(),
  height: z.number(),
  sizeBytes: z.number(),
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

const webviewToHostMessageSchema = z.discriminatedUnion('type', [
  // Sent once when the React app has mounted and is listening for messages.
  z.object({ type: z.literal('ready') }),
  // The composer gained or lost keyboard focus; drives the
  // `museSpark.inputFocused` context key behind Ctrl+Esc.
  z.object({ type: z.literal('inputFocusChanged'), focused: z.boolean() }),
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
  }),
  // The user pressed Stop.
  z.object({ type: z.literal('cancelTurn') }),
  z.object({ type: z.literal('signIn'), method: z.enum(SIGN_IN_METHODS) }),
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
  z.object({ type: z.literal('clearConversation') }),
  // "/compact": ask the host to summarise older context.
  z.object({ type: z.literal('compact') }),
  // The palette opened: (re)load the session's skills.
  z.object({ type: z.literal('listSkills') }),
  // @-mention menu: `requestId` lets the webview drop stale answers.
  z.object({ type: z.literal('searchMentions'), requestId: z.number(), query: z.string() }),
  // "+" / "Attach file…": native open dialog; images become attachments,
  // other files become `@path` mentions.
  z.object({ type: z.literal('pickFile') }),
  // "Mention file from this project…": QuickPick over the workspace index.
  z.object({ type: z.literal('pickMentionFile') }),
  // An image pasted or dropped into the composer.
  z.object({
    type: z.literal('attachImageData'),
    name: z.string(),
    mediaType: z.string(),
    base64: z.string(),
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
  // Question card: one answer per question.
  z.object({
    type: z.literal('answerQuestion'),
    userInputId: z.string(),
    answers: z.array(answerSchema),
  }),
  // Tool row: fetch one page of a stored output or patch document.
  z.object({
    type: z.literal('readOutput'),
    itemId: z.string(),
    outputRef: z.string(),
    offsetBytes: z.number(),
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
  // A tool row's path: open the file, selecting the changed lines when known (M16, `LineRange`).
  z.object({
    type: z.literal('openFile'),
    path: z.string(),
    startLine: z.optional(z.number()),
    endLine: z.optional(z.number()),
  }),
  // Rewind code to a message: revert every edit after it, newest first (M13).
  z.object({ type: z.literal('rewindCode'), edits: z.array(editRefSchema) }),
  // Session history (M6).
  z.object({ type: z.literal('listSessions') }),
  // The Agent map reads a subagent's own session (M14).
  z.object({ type: z.literal('readChildSession'), sessionId: z.string() }),
  z.object({ type: z.literal('resumeSession'), sessionId: z.string() }),
  z.object({
    type: z.literal('setSessionArchived'),
    sessionId: z.string(),
    isArchived: z.boolean(),
  }),
  /** Fork the current session through `lastTurnId` (all turns when absent). */
  z.object({ type: z.literal('forkSession'), lastTurnId: z.optional(z.string()) }),
  z.object({ type: z.literal('renameSession'), name: z.string() }),
  // Account & usage (M8): ask for the subscription window; answered by usageReport.
  z.object({ type: z.literal('readUsage') }),
  // Voice dictation (M9): the microphone button / Ctrl+D. Recognised text
  // comes back as `insertText`; the button state as `dictationState`.
  z.object({ type: z.literal('dictation'), action: z.enum(DICTATION_ACTIONS) }),
])

export type WebviewToHostMessage = z.infer<typeof webviewToHostMessageSchema>

const hostToWebviewMessageSchema = z.discriminatedUnion('type', [
  // Reply to `ready`: everything the shell needs to render its first frame.
  z.object({
    type: z.literal('init'),
    emptyStateHint: z.string(),
    composerPlaceholder: z.string(),
    settings: settingsSnapshotSchema,
  }),
  // A `museSpark.*` setting changed while the webview was open.
  z.object({ type: z.literal('settingsChanged'), settings: settingsSnapshotSchema }),
  // Move keyboard focus into the composer (Ctrl+Esc).
  z.object({ type: z.literal('focusInput') }),
  // Insert text at the composer caret (Alt+K mention reference).
  z.object({ type: z.literal('insertText'), text: z.string() }),
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
  }),
  // The active session's model (shown in the composer pill) and identity.
  z.object({
    type: z.literal('sessionInfo'),
    modelId: z.string(),
    contextLimit: z.optional(z.number()),
    sessionId: z.optional(z.string()),
  }),
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
    items: z.array(itemSnapshotSchema),
    name: z.optional(z.string()),
    todos: z.array(todoItemSchema),
  }),
  // Account & usage (M8): the backend this window runs on and the
  // subscription window the CLI last observed (absent on a key, or before
  // the first turn). Sent for readUsage and again on every usage/changed.
  z.object({
    type: z.literal('usageReport'),
    backend: z.enum(BACKEND_KINDS),
    subscription: z.optional(subscriptionUsageSchema),
    account: z.optional(accountFactsSchema),
    /** From the CLI's trace logs on this machine (M14); absent on the Model API. */
    insights: z.optional(z.object({ day: usageInsightsSchema, week: usageInsightsSchema })),
  }),
  // A subagent's own transcript for the Agent map (M14).
  z.object({
    type: z.literal('childTranscript'),
    sessionId: z.string(),
    name: z.optional(z.string()),
    items: z.array(itemSnapshotSchema),
  }),
  // Voice dictation (M9): sent on surfaceReady and on every change. `reason`
  // explains an unavailable microphone (no built-in recogniser here).
  z.object({
    type: z.literal('dictationState'),
    status: z.enum(DICTATION_UI_STATUSES),
    reason: z.optional(z.string()),
  }),
  // The host accepted a sendMessage and the turn is running.
  z.object({ type: z.literal('turnAccepted'), localId: z.string(), turnId: z.string() }),
  // The host could not submit a sendMessage; the webview restores the draft.
  z.object({ type: z.literal('sendFailed'), localId: z.string(), reason: z.string() }),
  // One backend-agnostic conversation event (see agentEvents.ts).
  z.object({ type: z.literal('agentEvent'), event: agentEventSchema }),
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
  z.object({ type: z.literal('attachmentAdded'), attachment: attachmentSchema }),
  z.object({ type: z.literal('attachmentRejected'), name: z.string(), reason: z.string() }),
  z.object({ type: z.literal('attachmentsCleared') }),
  // A one-line message for the transcript (failed host command, warnings).
  z.object({ type: z.literal('notice'), level: z.enum(NOTICE_LEVELS), text: z.string() }),
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
