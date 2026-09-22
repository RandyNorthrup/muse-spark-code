// Every tunable and user-visible literal lives here. The no-magic-numbers lint
// rule is disabled for this file only; everywhere else a bare literal is an
// error. Keep entries grouped and named for what they mean, not what they are.

export const PRODUCT_NAME = 'Muse Spark'

// Must match package.json `publisher` and `name`; test/unit/manifest.test.ts
// fails if they drift.
export const EXTENSION_PUBLISHER = 'RandyNorthrup'
export const EXTENSION_NAME = 'muse-spark-code'
export const EXTENSION_QUALIFIED_ID = `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`

// Contribution point ids (package.json `contributes`).
export const CHAT_VIEW_ID = 'museSpark.chatView'
export const CHAT_PANEL_VIEW_TYPE = 'museSpark.chatPanel'
export const COMMAND_IDS = {
  openInSidebar: 'museSpark.openInSidebar',
  openInNewTab: 'museSpark.openInNewTab',
  focusInput: 'museSpark.focusInput',
  insertMentionReference: 'museSpark.insertMentionReference',
  toggleFocusView: 'museSpark.toggleFocusView',
} as const

// VS Code `when`-clause context keys the extension maintains.
export const CONTEXT_KEYS = {
  inputFocused: 'museSpark.inputFocused',
} as const

// Built-in VS Code commands the extension invokes.
export const VSCODE_COMMANDS = {
  focusActiveEditorGroup: 'workbench.action.focusActiveEditorGroup',
  setContext: 'setContext',
} as const

// Settings (package.json `contributes.configuration`). Keys are relative to
// the `museSpark` section; defaults are the single source of truth for both
// the manifest (checked by test) and the runtime reader.
export const SETTINGS_SECTION = 'museSpark'
export const PERMISSION_MODES = [
  'manual',
  'acceptEdits',
  'plan',
  'auto',
  'bypassPermissions',
] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]
export const PERMISSION_MODE_LABELS: Readonly<Record<PermissionMode, string>> = {
  manual: 'Manual',
  acceptEdits: 'Edit automatically',
  plan: 'Plan',
  auto: 'Auto',
  bypassPermissions: 'Bypass permissions',
}
export const PREFERRED_LOCATIONS = ['sidebar', 'panel'] as const
export type PreferredLocation = (typeof PREFERRED_LOCATIONS)[number]

export interface EnvironmentVariable {
  readonly name: string
  readonly value: string
}

export const SETTING_DEFAULTS = {
  preferredLocation: 'panel' as PreferredLocation,
  initialPermissionMode: 'manual' as PermissionMode,
  autosave: true,
  attachOpenFile: true,
  useCtrlEnterToSend: false,
  hideOnboarding: false,
  focusView: false,
  respectGitIgnore: true,
  confidentialWorkspace: false,
  museBinaryPath: '',
  environmentVariables: [] as readonly EnvironmentVariable[],
} as const

// Webview bundle layout produced by scripts/build.mjs.
export const WEBVIEW_DIST_SEGMENTS = ['dist', 'webview'] as const
export const WEBVIEW_SCRIPT_FILE = 'main.js'
export const WEBVIEW_STYLE_FILE = 'main.css'
export const WEBVIEW_ROOT_ELEMENT_ID = 'root'

// Content-Security-Policy nonce: 24 random bytes encode to 32 base64url chars.
export const NONCE_BYTES = 24

// Composer behaviour.
export const COMPOSER_MAX_ROWS = 10

// --- Muse Code CLI / Muse Session Protocol (PLAN.md D1a, §5.4) ---

// MSP `initialize` rejects clientInfo.name outside ^[a-z0-9_]+$.
export const MSP_CLIENT_NAME = 'muse_spark_code'
// The host defaults new sessions to the contributor (training-consent) tier;
// the extension always passes an explicit model and defaults to Standard.
export const DEFAULT_MODEL_ID = 'muse-spark-1.3'
// Until the approval cards ship (M4) the host must never wait on a decision
// the UI cannot give: unmatched approvals are denied, so the agent can read
// and answer but reports that it could not edit or run commands.
export const M2_APPROVAL_MODE = 'denyUnmatched'
export const MUSE_SERVE_ARGS = ['serve'] as const
export const MUSE_INSTALL_URL = 'https://dev.meta.ai/products/muse-code/'
export const MUSE_LOGIN_ARGS = ['login'] as const
export const MUSE_LOGOUT_ARGS = ['logout'] as const
export const MUSE_LOGIN_TERMINAL_NAME = 'Muse Code sign-in'
// How long the browser sign-in may take before the extension stops watching
// for the credential file, and how often it looks.
export const CREDENTIAL_POLL_INTERVAL_MS = 2000
export const CREDENTIAL_POLL_TIMEOUT_MS = 5 * 60 * 1000
// Model API key shape: `LLM|<numeric id>|<secret>`.
export const MODEL_API_KEY_PATTERN = /^LLM\|\d+\|\S+$/
export const SECRET_KEYS = {
  modelApiKey: 'museSpark.modelApiKey',
} as const

// Install layouts verified 2026-09-22 (Muse Code 1.3.0).
export const MUSE_WINDOWS_INSTALL_SEGMENTS = ['Programs', 'muse'] as const
export const MUSE_POSIX_INSTALL_SEGMENTS = ['.local', 'bin'] as const
export const MUSE_CMD_FILE = 'muse.cmd'
export const MUSE_POSIX_EXECUTABLE = 'muse'
export const MUSE_LAUNCHER_PS1_FILE = '.muse-launcher.ps1'
export const MUSE_VERSION_FILE = '.muse-version'
export const MUSE_BIN_PREFIX = 'muse-bin-'
export const MUSE_WINDOWS_EXE_SUFFIX = '.exe'
export const MUSE_CREDENTIAL_FILE_SEGMENTS = ['muse', 'auth.json'] as const
export const WINDOWS_POWERSHELL_RELATIVE_PATH = String.raw`System32\WindowsPowerShell\v1.0\powershell.exe`
export const WINDOWS_POWERSHELL_ARGS = [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
] as const
// Windows PowerShell 5.1 cannot load its modules when it inherits a pwsh 7
// PSModulePath, so the child gets exactly these two directories.
export const WINDOWS_PSMODULEPATH_SEGMENTS = {
  programFiles: ['WindowsPowerShell', 'Modules'],
  systemRoot: ['System32', 'WindowsPowerShell', 'v1.0', 'Modules'],
} as const

// User-visible copy. Mirrors the Claude Code panel wording where the parity
// checklist calls for it.
export const UI_TEXT = {
  untitledConversation: 'Untitled',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
  composerLabel: 'Message Muse',
  connecting: 'Connecting to the extension host…',
  notSignedIn: 'Not signed in',
  sendDisabledReason: 'Sign in to send messages',
  stopTitle: 'Stop',
  signInTitle: 'Sign in to Muse Spark',
  signInBrowser: 'Sign in with your Meta account',
  signInBrowserDetail: 'Opens a terminal running `muse login`; approve the code in your browser.',
  signInApiKey: 'Use a Model API key',
  signInApiKeyDetail: 'Paste a key from dev.meta.ai; it is stored in VS Code secret storage.',
  signOutTitle: 'Sign out',
  installTitle: 'Muse Code is not installed',
  installDetail:
    'The Muse Code CLI hosts conversations for this extension. Install it, then reload.',
  installAction: 'Open install instructions',
  retryAction: 'Check again',
  apiKeyPrompt: 'Meta Model API key',
  apiKeyPlaceholder: 'LLM|1234567890|…',
  apiKeyInvalid: 'A Model API key looks like LLM|<numeric id>|<secret>.',
  signInWaiting: 'Waiting for the browser sign-in to finish…',
  signInTimedOut: 'The sign-in did not complete in time. Try again.',
  hostExited: 'Muse Code stopped unexpectedly.',
  hostStarting: 'Starting Muse Code…',
  working: 'Working…',
  attachDisabledReason: 'Attachments arrive in a later milestone',
  commandsDisabledReason: 'Slash commands arrive in a later milestone',
  focusViewBadge: 'Focus view',
  historyTitle: 'Session history',
  newConversationTitle: 'New conversation',
  sendTitle: 'Send',
} as const

// Windows PowerShell as an absolute-path suffix under %SystemRoot%, for
// `createTerminal({ shellPath })` when running `muse login` / `muse logout`.
export const WINDOWS_POWERSHELL_TERMINAL_PATH = String.raw`\System32\WindowsPowerShell\v1.0\powershell.exe`
