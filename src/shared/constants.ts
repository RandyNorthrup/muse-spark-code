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
  toggleThinking: 'museSpark.toggleThinking',
  setUpSandbox: 'museSpark.setUpSandbox',
} as const

// Extension-private `globalState` keys (never machine-wide configuration).
export const GLOBAL_STATE_KEYS = {
  /** "Don't ask again" on the Windows sandbox setup prompt. */
  sandboxPromptSuppressed: 'museSpark.sandboxPromptSuppressed',
} as const

// VS Code `when`-clause context keys the extension maintains.
export const CONTEXT_KEYS = {
  inputFocused: 'museSpark.inputFocused',
} as const

// Built-in VS Code commands the extension invokes.
export const VSCODE_COMMANDS = {
  focusActiveEditorGroup: 'workbench.action.focusActiveEditorGroup',
  setContext: 'setContext',
  openSettings: 'workbench.action.openSettings',
  openKeybindings: 'workbench.action.openGlobalKeybindings',
  diff: 'vscode.diff',
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
// One line under each mode in the Modes menu (the Claude Code wording, with
// Muse in place of Claude and the MSP behaviour behind each mode, PLAN.md D7).
export const PERMISSION_MODE_DETAILS: Readonly<Record<PermissionMode, string>> = {
  manual: 'Muse will ask for approval before making each edit',
  acceptEdits: 'Muse will edit files without asking and ask for everything else',
  plan: 'Muse will explore the code and present a plan before editing',
  auto: 'Muse will approve actions that pass a safety check and pause for anything risky',
  bypassPermissions: 'Muse will edit files and run commands without asking',
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
  // Claude Code's `allowDangerouslySkipPermissions`: Bypass permissions is
  // listed in the Modes menu and the Shift+Tab cycle only while this is on.
  allowDangerouslySkipPermissions: false,
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

// --- Reasoning effort (MSP `ReasoningEffort`, PLAN.md §5.2) ---

// The tiers the UI exposes, lowest first: the Model API's documented
// `reasoning_effort` range (minimal … max), each verified live through Muse
// Code with one turn per tier (docs/certification/m3.md, "Effort tiers per
// model"). Two wire tiers are deliberately absent: `none` is what the
// Thinking toggle sends when it is off, and `ultra` is forwarded to the API
// as `max` (the API's rejection of `ultra` on muse-spark-1.2 names `max`),
// so it would be a second dot for the same tier.
export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]
export const EFFORT_LABELS: Readonly<Record<EffortLevel, string>> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}
// The tiers each model family actually serves, keyed by model-id prefix
// (verified live 2026-09-21, Muse Code 1.3.0: muse-spark-1.2 rejects `max`
// with "Supported values: [minimal, low, medium, high, xhigh]"). Families not
// listed get the full UI range.
export const MODEL_EFFORT_LEVELS: Readonly<Record<string, readonly EffortLevel[]>> = {
  'muse-spark-1.3': EFFORT_LEVELS,
  'muse-spark-1.2': ['minimal', 'low', 'medium', 'high', 'xhigh'],
}
// `muse --help` documents `high` as the CLI's own default (verified 2026-09-21,
// Muse Code 1.3.0); the extension starts there so the TUI and the panel agree.
export const DEFAULT_EFFORT: EffortLevel = 'high'
// Sent as the session default while the Thinking toggle is off.
export const THINKING_OFF_EFFORT = 'none'

// --- Attachments ---

// Image types the Meta Model API accepts; anything else is refused with a
// reason rather than sent and rejected by the host.
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]
export const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_MESSAGE = 20

// --- @-mentions ---

export const MENTION_RESULT_LIMIT = 12
// Beyond this many paths the index is truncated and a warning is logged; the
// fuzzy scorer is linear in index size and runs on every keystroke.
export const MENTION_INDEX_LIMIT = 20_000
export const MENTION_INDEX_TTL_MS = 15_000
export const GIT_LS_FILES_ARGS = [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
] as const
// `git ls-files` on a large monorepo can exceed Node's 1 MiB default.
export const GIT_OUTPUT_MAX_BYTES = 64 * 1024 * 1024
export const FIND_FILES_GLOB = '**/*'

// --- Muse Code CLI / Muse Session Protocol (PLAN.md D1a, §5.4) ---

// MSP `initialize` rejects clientInfo.name outside ^[a-z0-9_]+$.
export const MSP_CLIENT_NAME = 'muse_spark_code'
// The host defaults new sessions to the contributor (training-consent) tier;
// the extension always passes an explicit model and defaults to Standard.
export const DEFAULT_MODEL_ID = 'muse-spark-1.3'
// Approval cards (M4) are what let the host wait on a decision; while this
// was false (M2–M3) every permission mode that would prompt collapsed to
// `denyUnmatched` (see shared/permissionModes.ts).
export const HAS_APPROVAL_UI = true

// --- Transcript (M4) ---

// Tool names seen on the wire (Muse Code 1.3.0, live captures 2026-09-21/22)
// and the label the row shows; unknown tools show their raw name. The IDE
// tool is named by the CLI's MCP catalog: `mcp__<server>__<tool>`.
export const TOOL_LABELS: Readonly<Record<string, string>> = {
  write_file: 'Write',
  edit_file: 'Edit',
  read_file: 'Read',
  search: 'Search',
  bash: 'Bash',
  powershell: 'PowerShell',
  request_user_input: 'Question',
  mcp__ide__getDiagnostics: 'Diagnostics',
}
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'powershell', 'shell', 'cmd'])
export const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file'])
export const FILE_READ_TOOLS: ReadonlySet<string> = new Set(['read_file'])
// Item kinds the transcript never shows: our own echo and host-internal children.
export const HIDDEN_ITEM_KINDS: ReadonlySet<string> = new Set(['userMessage', 'reminderChild'])
// Collapsed tool bodies show this many lines before "Show more".
export const OUTPUT_PREVIEW_LINES = 12
// `item/readOutput` page size (the host serves at most 6 MiB per call).
export const OUTPUT_PAGE_BYTES = 256 * 1024
// The spinner line under the last row cycles through these while a turn runs.
export const STATUS_VERBS = ['Thinking…', 'Working…', 'Calculating…', 'Composing…'] as const
export const STATUS_VERB_INTERVAL_MS = 4000
export const MILLISECONDS_PER_SECOND = 1000
// Muse Code's shell tool reports this when its OS sandbox is not set up
// (Windows: `muse sandbox windows setup` from an elevated shell).
export const SANDBOX_FAILURE_MARKER = 'sandbox enforcement unavailable'
// `muse sandbox windows check` / `setup` (Muse Code 1.3.0; the only platform
// with a sandbox subcommand, verified 2026-09-22 on Windows and Linux). The
// check prints `key=value` lines and exits 1 while setup is required.
export const MUSE_SANDBOX_CHECK_ARGS = ['sandbox', 'windows', 'check'] as const
export const MUSE_SANDBOX_SETUP_ARGS = ['sandbox', 'windows', 'setup'] as const
export const SANDBOX_STATUS_READY = 'ready'
export const SANDBOX_STATUS_SETUP_REQUIRED = 'setup_required'
// The check is a short local process; the setup waits on the UAC prompt and
// then runs for about a second, so the budget is the user's, not the CLI's.
export const SANDBOX_CHECK_TIMEOUT_MS = 30 * 1000
export const SANDBOX_SETUP_TIMEOUT_MS = 5 * 60 * 1000
// Output cap for the short CLI commands the extension runs itself.
export const CLI_OUTPUT_MAX_BYTES = 1024 * 1024
// --- Editor integration (M5, PLAN.md §6 M5) ---

// Active-editor changes are broadcast to the composer after this quiet gap.
export const EDITOR_CONTEXT_DEBOUNCE_MS = 150
// The selected text handed to the model with a message; longer selections
// are clipped with a marker rather than dropped.
export const SELECTION_TEXT_MAX_CHARS = 64 * 1024
// The wording Claude Code uses for editor context (its system reminders).
export const IDE_CONTEXT_TAGS = {
  selection: 'ide_selection',
  openedFile: 'ide_opened_file',
} as const
// Virtual documents holding a file's pre-edit text for the diff view.
export const MUSE_EDIT_SCHEME = 'muse-edit'
// A stored patch document is read whole for review; this many pages of
// OUTPUT_PAGE_BYTES is far beyond any edit the tools produce.
export const PATCH_DOCUMENT_MAX_PAGES = 8
// The IDE tool server `muse serve` reaches over loopback (session MCP).
export const MSP_REQUESTED_CAPABILITIES = ['sessionMcp'] as const
export const IDE_MCP_SERVER_NAME = 'ide'
export const IDE_MCP_SERVER_INFO = { name: 'muse_spark_ide', version: '1' } as const
export const IDE_MCP_PATH = '/mcp'
export const IDE_MCP_LOOPBACK_HOST = '127.0.0.1'
export const IDE_MCP_TOKEN_BYTES = 32
export const IDE_MCP_TOOL_DIAGNOSTICS = 'getDiagnostics'
// Newest MCP revision the server answers with when the client names none.
export const MCP_PROTOCOL_VERSION = '2025-06-18'
// Diagnostics beyond this many are summarised as a count.
export const DIAGNOSTICS_MAX_ENTRIES = 200
export const JSON_RPC_ERRORS = {
  parseError: -32_700,
  invalidRequest: -32_600,
  methodNotFound: -32_601,
  invalidParams: -32_602,
} as const
export const HTTP_STATUS = {
  ok: 200,
  accepted: 202,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  methodNotAllowed: 405,
} as const

// Muse Code versions whose Windows sandbox cannot enter C:\Users\<user>, so a
// workspace under the profile runs shell commands in PowerShell's own folder
// (verified live 2026-09-22 on 1.3.0 through the panel and `muse exec`).
export const SANDBOX_PROFILE_LIMITED_MAX_VERSION = '1.3.0'
// Link schemes the transcript opens; anything else is refused with a notice.
export const ALLOWED_LINK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])
// A code block's Copy button reads "Copied" for this long.
export const COPIED_FEEDBACK_MS = 1500
export const MUSE_SERVE_ARGS = ['serve'] as const
export const MUSE_INSTALL_URL = 'https://dev.meta.ai/products/muse-code/'
export const MUSE_DOCS_URL = 'https://dev.meta.ai/products/muse-code/'
export const ISSUES_URL = 'https://github.com/RandyNorthrup/muse-spark-code/issues'
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
// Windows PowerShell running one inline script (the UAC relaunch for the
// sandbox setup); `-NonInteractive` turns any prompt into an error.
export const WINDOWS_POWERSHELL_COMMAND_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
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
  // Shown while a turn runs: Enter then steers the running turn.
  composerQueuePlaceholder: 'Queue another message…',
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
  attachTitle: 'Attach',
  attachMenuLabel: 'Attach',
  uploadFromComputer: 'Upload from computer',
  addContext: 'Add context',
  commandsTitle: 'Commands',
  modelPillTitle: 'Model and effort',
  permissionModeTitle: 'Permission mode',
  modesTitle: 'Modes',
  modesHintKeys: '⇧ + tab',
  modesHint: 'to switch',
  modesLabel: 'Permission modes',
  bypassNotAllowed:
    'Turn on the "Allow dangerously skip permissions" setting to use Bypass permissions.',
  focusViewBadge: 'Focus view',
  historyTitle: 'Session history',
  newConversationTitle: 'New conversation',
  sendTitle: 'Send',
  // Command palette ("/" menu).
  paletteLabel: 'Actions',
  paletteFilterPlaceholder: 'Filter actions…',
  paletteNoMatches: 'No matching actions',
  paletteBack: 'Back',
  groupContext: 'Context',
  groupModel: 'Model',
  groupCustomize: 'Customize',
  groupAccount: 'Account & usage',
  groupSkills: 'Skills',
  groupSlashCommands: 'Slash commands',
  groupSupport: 'Support',
  attachFile: 'Attach file…',
  mentionFile: 'Mention file from this project…',
  clearConversation: 'Clear conversation',
  switchModel: 'Switch model…',
  effortItem: 'Effort',
  thinkingItem: 'Thinking',
  permissionModeItem: 'Permission mode',
  focusViewItem: 'Focus view',
  ctrlEnterItem: 'Send with Ctrl+Enter',
  openSettings: 'Open settings…',
  openKeybindings: 'Keyboard shortcuts…',
  sessionUsage: 'Session usage',
  signOutItem: 'Sign out',
  skillsLoading: 'Start a conversation to load skills',
  skillsEmpty: 'No skills available in this workspace',
  compactItem: '/compact',
  compactDetail: 'Summarise older context to free the window',
  clearItem: '/clear',
  logoutItem: '/logout',
  openLog: 'Open output log',
  reportIssue: 'Report an issue…',
  openDocs: 'Muse Code documentation',
  modelListLabel: 'Models',
  thinkingOff: 'No thinking',
  modelContextSuffix: 'context',
  // @-mention menu and attachments.
  mentionMenuLabel: 'Files',
  mentionNoMatches: 'No matching files',
  attachmentsLabel: 'Attachments',
  removeAttachment: 'Remove',
  attachmentTooLarge: 'Images must be 10 MB or smaller.',
  attachmentUnsupported: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  attachmentLimit: 'At most 20 images per message.',
  // Transcript rows.
  thoughtFor: 'Thought for',
  thinkingNow: 'Thinking',
  addedLines: 'Added',
  removedLines: 'Removed',
  linesUnit: 'lines',
  lineUnit: 'line',
  modified: 'Modified',
  inLabel: 'IN',
  outLabel: 'OUT',
  showMore: 'Show more',
  showLess: 'Show less',
  loadingOutput: 'Loading…',
  toolFailed: 'Failed',
  toolRejected: 'Rejected',
  copyCode: 'Copy',
  copiedCode: 'Copied',
  insertCode: 'Insert at cursor',
  approvalTitle: 'Muse wants to',
  approvalProtectedWrite: 'Protected write',
  approvalJudgeEscalated: 'Escalated by the safety check',
  approvalFeedbackPlaceholder: 'Tell Muse what to do instead (optional)',
  approvalDecided: 'Decided',
  approvalStep: 'step',
  approvalOf: 'of',
  questionSubmit: 'Submit',
  questionFreeTextPlaceholder: 'Type your answer',
  questionAnswered: 'Answered',
  todoTitle: 'Tasks',
  focusHiddenOne: 'step hidden by Focus view',
  focusHiddenMany: 'steps hidden by Focus view',
  showSteps: 'Show',
  hideSteps: 'Hide',
  retryNotice: 'Model call failed; retrying',
  contextLabel: 'context',
  noEditorForInsert: 'Open a text editor to insert code into it.',
  linkSchemeRefused: 'Only http, https and mailto links can be opened from the transcript.',
  sandboxNotice:
    'Muse Code cannot run shell commands until its Windows sandbox is set up. Run "Muse Spark: Set Up Shell Sandbox" (one administrator approval), then start a new conversation.',
  // Windows sandbox setup prompt and its outcomes (OS notifications).
  sandboxOffer:
    'Muse Code needs a one-time administrator setup before it can run shell commands on Windows (it creates the sandbox users and network filter it runs commands under). Set it up now?',
  sandboxSetUpNow: 'Set up now',
  sandboxNotNow: 'Not now',
  sandboxDontAskAgain: "Don't ask again",
  sandboxReady: 'Muse Code sandbox is ready. Start a new conversation to run shell commands in it.',
  sandboxAlreadyReady: 'Muse Code sandbox is already set up.',
  sandboxStillRequired: 'Muse Code sandbox is still not ready',
  sandboxCancelled: 'Muse Code sandbox setup did not complete',
  sandboxNotNeeded: 'Muse Code needs no sandbox setup on this platform.',
  sandboxCliMissing: 'Muse Code is not installed, so its sandbox cannot be checked.',
  sandboxCheckFailed: 'Muse Code sandbox check could not run',
  // Editor integration (M5).
  editorContextTitle: 'Shared with Muse as context; × leaves it out',
  editorContextRemove: 'Leave the open file out',
  editorContextLabel: 'Open file',
  linePrefix: 'L',
  openDiff: 'Open diff',
  revertEdit: 'Revert',
  applyCode: 'Apply',
  noEditorForApply: 'Open a text editor to apply code into it.',
  diffTitleSuffix: 'Muse edit',
  editReverted: 'Reverted',
  editCreatedRemoved: 'Moved to the trash (Muse created it)',
  editNotRebuildable: 'cannot be rebuilt: the file changed since this edit',
  editPathRefused: 'refused: the edited path is outside the workspace',
  editNoPatch: 'This edit left no patch document.',
  selectionClipped: '[selection clipped]',
  selectionNotShared:
    'Its content is not shared because the file is excluded from the workspace index.',
  sandboxProfileNotice: String.raw`This workspace is under your user profile, which the Windows sandbox of this Muse Code version cannot enter: shell commands will start in the PowerShell folder instead of the project and take about half a minute each. File reads and edits are unaffected. A workspace outside C:\Users runs commands in place.`,
} as const

// Windows PowerShell as an absolute-path suffix under %SystemRoot%, for
// `createTerminal({ shellPath })` when running `muse login` / `muse logout`.
export const WINDOWS_POWERSHELL_TERMINAL_PATH = String.raw`\System32\WindowsPowerShell\v1.0\powershell.exe`
