// The only contract between the extension host and the webview. Every message
// crossing postMessage in either direction is validated with these schemas at
// the receiving side; anything that fails validation is logged and dropped.
//
// Shared by both TypeScript projects (host and webview), so this file must not
// import from `vscode`, Node, or the DOM.

import * as z from 'zod/mini'
import { PERMISSION_MODES, PREFERRED_LOCATIONS } from './constants'

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

const webviewToHostMessageSchema = z.discriminatedUnion('type', [
  // Sent once when the React app has mounted and is listening for messages.
  z.object({ type: z.literal('ready') }),
  // The composer gained or lost keyboard focus; drives the
  // `museSpark.inputFocused` context key behind Ctrl+Esc.
  z.object({ type: z.literal('inputFocusChanged'), focused: z.boolean() }),
  // Header "new conversation" button: open another editor-tab surface.
  z.object({ type: z.literal('openNewTab') }),
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
