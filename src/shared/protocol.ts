// The only contract between the extension host and the webview. Every message
// crossing postMessage in either direction is validated with these schemas at
// the receiving side; anything that fails validation is logged and dropped.
//
// Shared by both TypeScript projects (host and webview), so this file must not
// import from `vscode`, Node, or the DOM.

import * as z from 'zod/mini'
import { agentEventSchema } from './agentEvents'
import { EFFORT_LEVELS, PERMISSION_MODES, PREFERRED_LOCATIONS } from './constants'

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
} as const

const settingsSnapshotSchema = z.object(settingsSnapshotShape)

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

// Things the webview asks the host to do outside the conversation itself.
export const HOST_ACTIONS = [
  'openSettings',
  'openKeybindings',
  'openLog',
  'toggleFocusView',
  'toggleCtrlEnterToSend',
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
  // Header "new conversation" button: open another editor-tab surface.
  z.object({ type: z.literal('openNewTab') }),
  // The user pressed Send. `localId` lets the host confirm or reject the
  // optimistic echo the webview already rendered; `attachmentIds` name the
  // images the host is holding for this message.
  z.object({
    type: z.literal('sendMessage'),
    localId: z.string(),
    text: z.string(),
    attachmentIds: z.array(z.string()),
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
])

export type WebviewToHostMessage = z.infer<typeof webviewToHostMessageSchema>

const hostToWebviewMessageSchema = z.discriminatedUnion('type', [
  // Reply to `ready`: everything the shell needs to render its first frame.
  z.object({
    type: z.literal('init'),
    extensionVersion: z.string(),
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
  // Backend / credential state, driving the sign-in screen and Send button.
  z.object({
    type: z.literal('authState'),
    status: z.enum(AUTH_STATUSES),
    detail: z.optional(z.string()),
  }),
  // The active session's model (shown in the composer pill).
  z.object({
    type: z.literal('sessionInfo'),
    modelId: z.string(),
    contextLimit: z.optional(z.number()),
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
