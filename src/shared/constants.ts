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
// `contributes.walkthroughs[0].id`, opened as `<publisher>.<name>#<id>`.
export const WALKTHROUGH_ID = 'museSpark.gettingStarted'
export const WALKTHROUGH_QUALIFIED_ID = `${EXTENSION_QUALIFIED_ID}#${WALKTHROUGH_ID}`
export const COMMAND_IDS = {
  openInSidebar: 'museSpark.openInSidebar',
  openInNewTab: 'museSpark.openInNewTab',
  focusInput: 'museSpark.focusInput',
  insertMentionReference: 'museSpark.insertMentionReference',
  toggleFocusView: 'museSpark.toggleFocusView',
  toggleThinking: 'museSpark.toggleThinking',
  setUpSandbox: 'museSpark.setUpSandbox',
  showLogs: 'museSpark.showLogs',
  diagnostics: 'museSpark.diagnostics',
  newConversation: 'museSpark.newConversation',
  signOut: 'museSpark.signOut',
  openInTerminal: 'museSpark.openInTerminal',
  createRulesFile: 'museSpark.createRulesFile',
  openWalkthrough: 'museSpark.openWalkthrough',
} as const

// Extension-private `globalState` keys (never machine-wide configuration).
export const GLOBAL_STATE_KEYS = {
  /** "Don't ask again" on the Windows sandbox setup prompt. */
  sandboxPromptSuppressed: 'museSpark.sandboxPromptSuppressed',
  /** The subscription window the CLI last reported, shown "as of" until a fresh one (M16). */
  lastUsage: 'museSpark.lastUsage',
} as const

// VS Code `when`-clause context keys the extension maintains.
export const CONTEXT_KEYS = {
  inputFocused: 'museSpark.inputFocused',
  /** True while a credential for the selected backend is present (the walkthrough's sign-in step). */
  signedIn: 'museSpark.signedIn',
} as const

// Built-in VS Code commands the extension invokes.
export const VSCODE_COMMANDS = {
  focusActiveEditorGroup: 'workbench.action.focusActiveEditorGroup',
  setContext: 'setContext',
  openSettings: 'workbench.action.openSettings',
  openKeybindings: 'workbench.action.openGlobalKeybindings',
  diff: 'vscode.diff',
  openWalkthrough: 'workbench.action.openWalkthrough',
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
// Muse in place of Claude and the MSP behaviour behind each mode, PLAN.md
// D7), per backend where they differ (D24): in Manual Muse Code applies
// edits inside the workspace without an approval (verified live in M4), and
// the Model API backend has no safety-check judge behind Auto.
export const PERMISSION_MODE_DETAILS: Readonly<Record<PermissionMode, string>> = {
  manual: 'Muse will ask before running commands; Muse Code edits workspace files without asking',
  acceptEdits: 'Muse will edit files without asking and ask before running commands',
  plan: 'Muse will explore the code and present a plan before editing',
  auto: 'Muse will approve actions that pass a safety check and pause for anything risky',
  bypassPermissions: 'Muse will edit files and run commands without asking',
}
export const MODEL_API_PERMISSION_MODE_DETAILS: Readonly<Partial<Record<PermissionMode, string>>> =
  {
    manual: 'Muse will ask for approval before each edit and each command',
    auto: 'Muse will edit files without asking, except protected files, and ask before commands',
  }
export const PREFERRED_LOCATIONS = ['sidebar', 'panel'] as const
export type PreferredLocation = (typeof PREFERRED_LOCATIONS)[number]

export interface EnvironmentVariable {
  readonly name: string
  readonly value: string
}

// Whether shell commands run inside Muse Code's OS sandbox. `auto` keeps the
// sandbox except where it is known not to work: Windows workspaces under the
// user's profile (PLAN.md D12, verified live 2026-09-22). `off` runs commands
// directly as the user, gated by the approval cards, as Claude Code does.
export const SHELL_SANDBOX_MODES = ['auto', 'muse', 'off'] as const
export type ShellSandboxMode = (typeof SHELL_SANDBOX_MODES)[number]
export const SHELL_SANDBOX_SETTING = 'museSpark.shellSandbox'
export const BYPASS_SETTING = 'museSpark.allowDangerouslySkipPermissions'

// Which backend hosts conversations (PLAN.md D1, M7): `auto` takes Muse
// Code when the CLI is installed and the Model API when only a key is
// present; the other two force one side.
export const BACKEND_MODES = ['auto', 'museCode', 'modelApi'] as const
export type BackendMode = (typeof BACKEND_MODES)[number]
export const BACKEND_SETTING = 'museSpark.backend'

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
  // Claude Code's `archiveInactiveSessions`: hide sessions idle this many
  // days from the History dialog (1 / 2 / 7 / 14; 0 never). Hidden, not
  // deleted: MSP has no delete, and "Show archived" brings them back.
  archiveInactiveSessions: 14,
  museBinaryPath: '',
  environmentVariables: [] as readonly EnvironmentVariable[],
  shellSandbox: 'auto' as ShellSandboxMode,
  backend: 'auto' as BackendMode,
  // Claude Code's `enableNewConversationShortcut`: Ctrl+N starts a new
  // conversation while a Muse surface is focused. Read only by the
  // keybinding's `when` clause (`config.museSpark.…`), off by default.
  enableNewConversationShortcut: false,
} as const
export const ARCHIVE_DAY_CHOICES = [1, 2, 7, 14, 0] as const
// Settings a repository's `.vscode/settings.json` must never set (PLAN.md
// D15): they choose what executes, what is billed and how much is approved,
// so the manifest declares them `scope: machine` (user settings only).
export const MACHINE_SCOPED_SETTINGS = [
  'initialPermissionMode',
  'backend',
  'shellSandbox',
  'allowDangerouslySkipPermissions',
  'museBinaryPath',
  'environmentVariables',
] as const

// --- Sessions (M6, PLAN.md §6 M6) ---

// `session/list` page size (the host caps at 200) and how many pages the
// dialog will follow before it stops.
export const SESSION_LIST_LIMIT = 200
export const SESSION_LIST_MAX_PAGES = 5
// A surface that opens within this long of its last session's activity
// resumes it (the Claude Code sidebar rule: "if a message was sent in the
// last 10 minutes").
export const SESSION_RESTORE_WINDOW_MS = 10 * 60 * 1000
export const WORKSPACE_STATE_KEYS = {
  archivedSessions: 'museSpark.archivedSessions',
  lastSession: 'museSpark.lastSession',
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
// A git call that has not answered by then (a hung network drive, a lock)
// is killed; the callers fall back as if git were absent (PLAN.md D24).
export const GIT_TIMEOUT_MS = 15_000
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
  list_files: 'List',
  ask_user: 'Question',
  todo_write: 'Tasks',
  // Muse Code's native subagent tools (M14; seen live 2026-09-23).
  subagent_spawn: 'Spawn agent',
  subagent_wait: 'Wait for agents',
  subagent_status: 'Agent status',
  subagent_send_message: 'Message agent',
  subagent_read_result: 'Agent result',
  subagent_cancel: 'Cancel agent',
}
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'powershell', 'shell', 'cmd'])
export const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file'])
export const FILE_READ_TOOLS: ReadonlySet<string> = new Set(['read_file'])
// --- Meta Model API backend (M7, PLAN.md D1 / D2 / §5.1) ---

export const MODEL_API_BASE_URL = 'https://api.meta.ai/v1'
export const MODEL_API_SERVER_NAME = 'meta-model-api'
export const MODEL_API_VERSION = 'v1'
// Only chat models are listed; the catalogue also carries image, voice and
// segmentation models.
export const MODEL_API_MODEL_PREFIX = 'muse-spark-'
export const CONTRIBUTOR_MODEL_SUFFIX = '-contributor'
// Meta's published Model API prices per million tokens (dev.meta.ai/docs/
// pricing-rate-limits, read 2026-09-22): the standard tier for every plain
// model, the contributor tier for the `-contributor` models.
export const MODEL_API_PRICES_PER_MILLION = {
  standard: { input: 1.25, cachedInput: 0.15, output: 4.25 },
  contributor: { input: 0.1, cachedInput: 0.002, output: 0.2 },
} as const
export const MODEL_API_PRICES_VERIFIED_ON = '2026-09-22'
export const TOKENS_PER_MILLION = 1_000_000
// dev.meta.ai/docs/models: every Muse Spark model has this window; the
// output cap is well under the documented 131,072 maximum.
export const MODEL_API_CONTEXT_WINDOW = 1_048_576
export const MODEL_API_MAX_OUTPUT_TOKENS = 32_768
// dev.meta.ai/docs/error-handling: 429 / 500 / 503 are retryable with
// exponential backoff and jitter, honouring Retry-After; 3–5 attempts.
export const MODEL_API_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 503])
export const MODEL_API_MAX_RETRIES = 4
export const MODEL_API_RETRY_BASE_MS = 1000
export const MODEL_API_RETRY_MAX_MS = 60_000
export const MODEL_API_RETRY_JITTER_MS = 1000
export const HTTP_UNAUTHORIZED = 401
// The turn error kind both backends report when the credential is refused;
// the controller turns it into the signed-out gate.
export const AUTH_REQUIRED_ERROR_KIND = 'authRequired'
// The reasoning effort sent while the Thinking toggle is off (`none` is a 400).
export const MODEL_API_EFFORT_OFF = 'minimal'
// Context pressure thresholds (fraction of the window) for the indicator.
export const CONTEXT_PRESSURE_MEDIUM = 0.7
export const CONTEXT_PRESSURE_HIGH = 0.9
// A turn stops after this many model calls (tool rounds) to bound a loop.
export const MODEL_API_MAX_TOOL_ROUNDS = 50
// The in-process tools (Claude Code's set, MSP's names where they exist so
// the transcript rows render identically).
export const MODEL_API_TOOLS = {
  readFile: 'read_file',
  writeFile: 'write_file',
  editFile: 'edit_file',
  search: 'search',
  listFiles: 'list_files',
  bash: 'bash',
  powershell: 'powershell',
  askUser: 'ask_user',
  todoWrite: 'todo_write',
  readSkill: 'read_skill',
} as const
// Workspace context on the Model API backend (PLAN.md D13): the files Muse
// Code reads, by its conventions. Rules: `AGENTS.md`, else `CLAUDE.md`, per
// directory; a file over the load limit is skipped and the whole rules
// context is truncated over its limit, each with a logged warning.
export const RULES_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const
// The prompt's environment section (PLAN.md D15): how many `git log
// --oneline` subjects the Model API backend lists at session start.
export const ENVIRONMENT_RECENT_COMMITS = 5
// `YYYY-MM-DD` is the first ten characters of an ISO timestamp.
export const ISO_DATE_LENGTH = 10
export const RULES_FILE_MAX_BYTES = 64 * 1024
export const RULES_CONTEXT_MAX_BYTES = 256 * 1024
export const RULES_TRUNCATED_MARKER = '[rules truncated]'
export const RULES_PREAMBLE =
  'Standing rules were loaded at session open. Follow higher-priority instructions first. If rules files conflict, the deeper file wins over the shallower one.'
// Skills: `.agents/skills/<id>/SKILL.md` in the workspace (project scope) and
// `$XDG_CONFIG_HOME/muse/skills/<id>` (else `~/.config/muse/skills`), Muse Code's
// managed personal root. Front matter: `name`, `description`, and the
// optional `user-invocable` and `argument-hint`.
export const PROJECT_SKILLS_DIR_SEGMENTS = ['.agents', 'skills'] as const
export const PERSONAL_SKILLS_DIR_SEGMENTS = ['muse', 'skills'] as const
export const SKILL_FILE_NAME = 'SKILL.md'
export const SKILL_FILE_MAX_BYTES = 64 * 1024
export const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
export const SKILL_SOURCES = ['project', 'user'] as const
// What the extension watches so the palette follows skill files (D13).
export const PROJECT_SKILLS_GLOB = '**/.agents/skills/**'
export const PERSONAL_SKILLS_GLOB = '*/SKILL.md'
// Memory: the project index `.agents/memory/MEMORY.md`, read at session start.
export const MEMORY_INDEX_SEGMENTS = ['.agents', 'memory', 'MEMORY.md'] as const
export const MEMORY_DIR = '.agents/memory'
export const MEMORY_INDEX_MAX_LINES = 200
export const MEMORY_INDEX_MAX_BYTES = 32 * 1024
export const MEMORY_TRUNCATED_MARKER = '[MEMORY.md truncated]'
export const TOOL_OUTPUT_MAX_CHARS = 64_000
export const TOOL_OUTPUT_CLIP_MARKER = '\n[output clipped]'
export const READ_FILE_DEFAULT_LIMIT = 2000
export const READ_FILE_MAX_LINE_CHARS = 2000
export const SEARCH_MAX_RESULTS = 200
export const SEARCH_MAX_FILE_BYTES = 1024 * 1024
// The model's regular expression is evaluated on a worker thread that is
// terminated when it overruns this budget (ReDoS containment); the worker
// stops collecting after this many hits.
export const SEARCH_TIMEOUT_MS = 20_000
export const SEARCH_MAX_HITS = 5000
export const SEARCH_PATTERN_MAX_LENGTH = 512
export const SEARCH_WORKER_FILE = 'searchWorker.js'
// A glob is matched by a table over pattern × path (no regular expression,
// PLAN.md D24); the length cap bounds that table.
export const GLOB_MAX_LENGTH = 256
// `{a,b}{c,d}…` multiplies; past this many alternatives the glob is refused.
export const GLOB_MAX_ALTERNATIVES = 256
// Protected writes (D24): paths that configure or run code outside the edit
// itself ask for approval in every mode but Bypass, whatever the session
// rules say. Lower case; compared case-insensitively, anywhere in the path.
export const PROTECTED_PATH_SEGMENTS: readonly (readonly string[])[] = [
  ['.git'],
  ['.husky'],
  ['.vscode'],
  ['.idea'],
  ['.devcontainer'],
  ['.github', 'workflows'],
  ['.agents'],
]
export const PROTECTED_FILE_NAMES: ReadonlySet<string> = new Set([
  'agents.md',
  'claude.md',
  '.envrc',
  '.gitmodules',
])
export const LIST_FILES_DEFAULT_LIMIT = 500
export const SHELL_DEFAULT_TIMEOUT_MS = 120_000
export const SHELL_MAX_TIMEOUT_MS = 600_000
export const SHELL_OUTPUT_MAX_BYTES = 4 * 1024 * 1024
export const OUTPUT_REF_PREFIX = 'tool_patch-'
// The stored output the transcript can page (`item/readOutput` parity).
export const MODEL_API_OUTPUT_MEDIA_TYPE = 'application/json'
export const MODEL_API_OUTPUT_ENCODING = 'utf8'
// Model API sessions persist as one JSON file each under the workspace
// storage directory (PLAN.md D14); the version guards the shape.
export const MODEL_API_SESSIONS_DIR = 'modelapi-sessions'
export const STORED_SESSION_VERSION = 1

// Item kinds the transcript never shows: our own echo and host-internal children.
export const HIDDEN_ITEM_KINDS: ReadonlySet<string> = new Set(['userMessage', 'reminderChild'])

// --- Subagents, background tasks and usage insights (M14, PLAN.md D17) ---

// Muse Code hides its subagent tools unless this setting in its own
// settings file (`$XDG_CONFIG_HOME/muse/settings.json`, else
// `~/.config/muse/settings.json`) is `auto`; the extension reads it, never
// writes it.
export const MUSE_SETTINGS_FILE_SEGMENTS = ['muse', 'settings.json'] as const
/** The owner commands on a native subagent the Agent map offers (MSP `subagent/<action>`), M18. */
export const SUBAGENT_ACTIONS = ['interrupt', 'stop', 'resume', 'close'] as const
export type SubagentAction = (typeof SUBAGENT_ACTIONS)[number]
/** Control statuses (MSP SubagentControlStatus) that mean the child is still working. */
export const SUBAGENT_RUNNING_STATUSES: ReadonlySet<string> = new Set([
  'accepted',
  'starting',
  'running',
])
export const SUBAGENT_RESULT_READY = 'resultReady'
export const SUBAGENT_CLOSED = 'closed'
export const MUSE_DELEGATION_DEFAULT = 'off'
export const MUSE_DELEGATION_ENABLED = 'auto'
// The CLI's trace logs, one per `muse serve` process, under its data root.
export const MUSE_TRACE_LOG_SEGMENTS = [
  '.local',
  'share',
  'muse',
  'local-tracing',
  'bootstrap',
] as const
export const TRACE_LOG_FILE_SUFFIX = '.log'
export const TRACE_LOG_MAX_BYTES = 8 * 1024 * 1024
export const TRACE_LOG_MAX_FILES = 200
// A reminder agent's run registers one tool (its decision); a subagent's run
// registers the toolset (verified 2026-09-22: 1 versus 30).
export const REMINDER_RUN_TOOL_COUNT_MAX = 2
export const USAGE_WINDOW_DAY_MS = 24 * 60 * 60 * 1000
export const USAGE_WINDOW_WEEK_MS = 7 * USAGE_WINDOW_DAY_MS
export const LONG_SESSION_MS = 8 * 60 * 60 * 1000
export const USAGE_INSIGHTS_TTL_MS = 30 * 1000
// Sent with every turn on the CLI backend, hidden from the transcript like
// the editor context: Muse otherwise answers a choice in prose where the
// panel could show a picker (the request_user_input tool).
export const CHOICE_STEERING_NOTE =
  '<harness_note>When you offer the user a choice between options, ask through the request_user_input tool instead of listing the options in prose, so the panel can show a picker.</harness_note>'
// Collapsed tool bodies show this many lines before "Show more".
export const OUTPUT_PREVIEW_LINES = 12
// `item/readOutput` page size (the host serves at most 6 MiB per call).
export const OUTPUT_PAGE_BYTES = 256 * 1024
// The spinner line under the last row cycles through these while a turn runs.
export const STATUS_VERBS = ['Thinking…', 'Working…', 'Calculating…', 'Composing…'] as const
export const STATUS_VERB_INTERVAL_MS = 4000
export const MILLISECONDS_PER_SECOND = 1000
export const SECONDS_PER_MINUTE = 60
export const MINUTES_PER_HOUR = 60
export const HOURS_PER_DAY = 24
export const DAYS_PER_WEEK = 7
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
// One `muse serve` stderr chunk as the log shows it (PLAN.md D24).
export const CLI_STDERR_LOG_MAX_CHARS = 4096
// --- Editor integration (M5, PLAN.md §6 M5) ---

// Active-editor changes are broadcast to the composer after this quiet gap.
export const EDITOR_CONTEXT_DEBOUNCE_MS = 150
// The selected text handed to the model with a message; longer selections
// are clipped with a marker rather than dropped.
export const SELECTION_TEXT_MAX_CHARS = 64 * 1024
// The wording Claude Code uses for editor context (its system reminders).
// A message replying to an output or quoting a highlighted passage (M17):
// the tag the context part uses, how much of the passage travels, and how
// the passage's author is named to the model.
export const CHAT_REFERENCE_TAG = 'chat_reference'
export const CHAT_REFERENCE_MAX_CHARS = 8000
export const CHAT_REFERENCE_INTENTS = ['reply', 'question', 'comment'] as const
export const CHAT_REFERENCE_AUTHORS: Readonly<Record<string, string>> = {
  assistant: 'you, the assistant',
  user: 'the user',
  tool: 'a tool the assistant ran',
}
/** How much of the referenced passage the composer chip and the user card show. */
export const CHAT_REFERENCE_LABEL_CHARS = 60
export const IDE_CONTEXT_TAGS = {
  selection: 'ide_selection',
  openedFile: 'ide_opened_file',
} as const
// Virtual documents holding a file's pre-edit text for the diff view.
export const MUSE_EDIT_SCHEME = 'muse-edit'
// A stored patch document is read whole for review; this many pages of
// OUTPUT_PAGE_BYTES is far beyond any edit the tools produce.
export const PATCH_DOCUMENT_MAX_PAGES = 8
/** Pages of OUTPUT_PAGE_BYTES an "open in editor" fetches at most (16 MiB), M15. */
export const OUTPUT_DOCUMENT_MAX_PAGES = 64
/** The item-id tail that names an output editor tab, as Claude Code names its own. */
export const OUTPUT_TAB_ID_LENGTH = 6
/** The URI scheme of those read-only output documents, and how many stay readable. */
export const OUTPUT_DOCUMENT_SCHEME = 'muse-output'
export const OUTPUT_DOCUMENTS_KEPT = 20
// The IDE tool server `muse serve` reaches over loopback (session MCP), and
// the `session/listChanged` stream behind the History dialog (M6).
export const MSP_REQUESTED_CAPABILITIES = ['sessionMcp', 'sessionListStream'] as const
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
// `muse serve --disable-sandbox`: "keep approval, but skip the sandbox"; a
// host-lifetime posture, so changing it restarts the host (PLAN.md D12).
export const MUSE_DISABLE_SANDBOX_ARG = '--disable-sandbox'
// `muse serve --trust-workspace`: "Load each session workspace's skills and
// rules"; without it the host skips both. `--disable-shell` is the posture
// for VS Code's Restricted Mode: no workspace shell execution (PLAN.md D13).
export const MUSE_TRUST_WORKSPACE_ARG = '--trust-workspace'
export const MUSE_DISABLE_SHELL_ARG = '--disable-shell'
export const MUSE_INSTALL_URL = 'https://dev.meta.ai/products/muse-code/'
export const MUSE_DOCS_URL = 'https://dev.meta.ai/products/muse-code/'
export const ISSUES_URL = 'https://github.com/RandyNorthrup/muse-spark-code/issues'
/** The Meta developer dashboard (usage, keys, billing) the usage dialog links to. */
export const META_DASHBOARD_URL = 'https://dev.meta.ai/'

/**
 * The getting-started tips on the empty state (M8), in the order shown. The
 * shortcuts are the default bindings from package.json; Cmd stands in for
 * Ctrl on macOS as the composer placeholder already assumes. Windows keeps
 * Ctrl+Esc and Ctrl+Shift+Esc for itself, so its bindings add Alt; the
 * webview does not know the platform, so both are named (M26, D29).
 */
export const ONBOARDING_TIPS = [
  {
    shortcut: 'Ctrl+Esc (Ctrl+Alt+Esc on Windows)',
    text: 'focuses or unfocuses Muse from anywhere in VS Code',
  },
  { shortcut: '/', text: 'opens the actions palette: model, effort, permission mode, history' },
  { shortcut: 'Shift+Tab', text: 'cycles the permission mode while the composer has focus' },
  { shortcut: 'Alt+K', text: 'inserts an @-mention of the editor selection' },
  { shortcut: '@', text: 'mentions a file; drag files or paste images to attach them' },
  {
    shortcut: 'Ctrl+Shift+Esc (Ctrl+Shift+Alt+Esc on Windows)',
    text: 'opens a conversation in a new editor tab',
  },
  {
    shortcut: 'Ctrl+D',
    text: 'records your voice into the composer (tap to toggle, hold to talk)',
  },
] as const
// Voice dictation (M9). The composer's microphone drives a resident helper
// that uses the operating system's own recogniser: Windows PowerShell 5.1 +
// System.Speech on Windows, a Swift helper on Apple's Speech framework on
// macOS. Linux has no built-in recogniser, so the button explains itself.
export const DICTATION_HELPER_DIR = 'native'
export const DICTATION_WINDOWS_SCRIPT_SEGMENTS = ['windows', 'dictate.ps1'] as const
export const DICTATION_DARWIN_HELPER_SEGMENTS = ['darwin', 'muse-dictate'] as const
export const DICTATION_HELPER_COMMANDS = { start: 'start', stop: 'stop', quit: 'quit' } as const
/** A press shorter than this is a tap (toggle); longer is push-to-talk. */
export const DICTATION_HOLD_MS = 300
export const DICTATION_KEY = 'd'
/** After "stop", the helper has this long to deliver the phrase in flight. */
export const DICTATION_STOP_GRACE_MS = 4000
/** How long an unused helper stays warm before it is told to quit. */
export const DICTATION_IDLE_EXIT_MS = 5 * 60 * 1000
/** After "quit", the helper has this long to exit before it is killed. */
export const DICTATION_QUIT_GRACE_MS = 2000
export const DICTATION_STDERR_TAIL_CHARS = 400
export const DICTATION_ACTIONS = ['start', 'stop'] as const
export type DictationAction = (typeof DICTATION_ACTIONS)[number]
export const DICTATION_UI_STATUSES = ['unavailable', 'idle', 'starting', 'listening'] as const
export type DictationUiStatus = (typeof DICTATION_UI_STATUSES)[number]
// M26 (PLAN.md D29): dictation in a remote window, and the environment the
// Windows helper starts with.
/** The button's reason in a window whose extension host runs on a remote machine. */
export const DICTATION_UNAVAILABLE_REMOTE =
  'Voice dictation is not available in a remote window (SSH, WSL, a container, a tunnel or a codespace): the extension runs on the remote machine, which cannot hear this computer’s microphone. Open the folder in a local window to dictate.'
/** Windows PowerShell's module search path, reset for the Windows helper. */
export const WINDOWS_PSMODULEPATH_VARIABLE = 'PSModulePath'
/**
 * The macOS helper's flag naming the app macOS asks on its behalf (VS Code's
 * `env.appName`): macOS charges a helper's privacy requests to the app that
 * started it, so the helper's refusal text names that app.
 */
export const DICTATION_DARWIN_APP_NAME_FLAG = '--app-name'
/** Appended when the macOS helper ends before it said "ready" (not a requested quit). */
export const DICTATION_DARWIN_EARLY_EXIT_HINT =
  'macOS ended the dictation helper before it was ready. After a permission step, macOS refused that permission to the app that started the helper; with no step at all, macOS refused to run the helper itself, which is not notarised. The README’s Voice dictation section explains both.'
export const MUSE_LOGIN_ARGS = ['login'] as const
export const MUSE_LOGOUT_ARGS = ['logout'] as const
export const MUSE_LOGIN_TERMINAL_NAME = 'Muse Code sign-in'
// `Muse Spark: Open in Terminal` runs the CLI with no arguments (its TUI).
export const MUSE_TERMINAL_NAME = 'Muse Code'
// `Muse Spark: Create AGENTS.md` runs the CLI's own scaffold (no model call).
export const MUSE_INIT_ARGS = ['init'] as const
export const MUSE_INIT_TIMEOUT_MS = 30 * 1000
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

// --- Webview state (M25, PLAN.md D28) ---

// The panel keeps its conversation in VS Code's webview state so the crash
// screen's Reload, or a panel moved to another window, comes back with it:
// saved at most this often while it changes, and at once before a reload.
export const WEBVIEW_STATE_SAVE_MS = 1000
// A conversation whose saved form is longer than this (UTF-16 code units, as
// JSON.stringify counts them) keeps only its session id; History reopens it.
export const WEBVIEW_STATE_MAX_CHARS = 8 * 1024 * 1024
// The saved shape's version; a snapshot of any other version is ignored.
export const WEBVIEW_SNAPSHOT_VERSION = 1
// Chromium names a key an input method consumes "Process" (keyCode 229): it
// belongs to the composition, not to the composer.
export const IME_PROCESS_KEY = 'Process'
// The status a tool row takes when its turn ended without finishing it.
export const TOOL_STATUS_INTERRUPTED = 'interrupted'

// User-visible copy. Mirrors the Claude Code panel wording where the parity
// checklist calls for it.
export const UI_TEXT = {
  untitledConversation: 'Untitled',
  crashTitle: 'The panel hit an error',
  crashDetail: 'Reload rebuilds the panel; the conversation is kept by the host.',
  crashReload: 'Reload',
  // M25 (PLAN.md D28): webview and UI state.
  toolInterrupted: 'Interrupted',
  thoughtDone: 'Thought',
  quoteCopy: 'Copy',
  snapshotTooLong:
    'This conversation was too long to keep in the panel across the reload; open it from History to see all of it.',
  linkOutsideWorkspace: 'Links to files outside the workspace are not opened from the transcript.',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  // Windows binds Ctrl+Alt+Esc (Ctrl+Esc opens Start there; M26, D29).
  composerPlaceholder: 'ctrl esc (ctrl alt esc on Windows) to focus or unfocus Muse',
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
  hostStartFailed: 'The backend could not start',
  decisionErrorNotice:
    'Muse Code reported an error for the decision (the tool may have run anyway)',
  jumpToLatest: 'New messages',
  jumpToLatestTitle: 'Jump to the newest message',
  copyResponse: 'Copy response',
  openOutputTitle: 'Click to open the output in an editor',
  toolOutputTitle: 'tool output',
  clickToExpand: 'Click to expand',
  openOutputFailed: 'Could not open the output',
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
  // PLAN.md D24: the setting turned off while a conversation is in Bypass.
  bypassRevoked:
    'The "Allow dangerously skip permissions" setting was turned off; this conversation is back in Manual.',
  // D24: in a remote window a dev container's settings can switch Bypass on.
  bypassRemoteTitle: 'Run without approvals on a remote machine?',
  bypassRemoteDetail:
    'This window runs on a remote machine or in a container, where a dev container definition can set museSpark.allowDangerouslySkipPermissions without you. Bypass permissions lets Muse edit files and run commands without asking.',
  bypassRemoteConfirm: 'Use Bypass permissions',
  bypassRemoteStartedManual:
    'museSpark.initialPermissionMode asks for Bypass permissions, but this is a remote window; the conversation starts in Manual. Choose Bypass from the Modes menu to confirm it.',
  // D24: an edit the "Edit automatically" mode approved on the user's behalf.
  editAutomaticallyResolver: 'Edit automatically',
  contributorResumeFallback:
    'The resumed conversation was on a contributor-tier model; it now uses',
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
  /** Before a bare tool name (subject kind "tool", e.g. subagent_spawn), M18. */
  approvalUseTool: 'use',
  approvalProtectedWrite: 'Protected write',
  approvalJudgeEscalated: 'Escalated by the safety check',
  approvalFeedbackPlaceholder: 'Tell Muse what to do instead (optional)',
  approvalDecided: 'Decided',
  approvalStep: 'step',
  approvalOf: 'of',
  questionSubmit: 'Submit',
  questionCancel: 'Cancel',
  questionFreeTextPlaceholder: 'Type your answer',
  questionOther: 'Other',
  questionOtherPlaceholder: 'Type your own answer…',
  questionAnswered: 'Answered',
  questionCancelled: 'Cancelled',
  questionCancelFailed: 'The question could not be cancelled',
  /** Replying to an output and quoting a highlighted passage (M17). */
  messageActions: 'Message actions',
  replyToOutput: 'Reply to this output',
  quoteMenuLabel: 'Highlighted text',
  askAboutThis: 'Ask about this',
  commentOnThis: 'Comment on this',
  referenceReply: 'Replying to',
  referenceQuestion: 'Asking about',
  referenceComment: 'Commenting on',
  referenceRemove: 'Remove',
  referenceTitle: 'Goes to the agent with your message as context',
  replyContextLead:
    'The user is replying to this earlier output in the chat; treat their message as a direct response to it. It was written by',
  questionContextLead:
    'The user highlighted this passage of the conversation and is asking a question about it. It was written by',
  commentContextLead:
    'The user highlighted this passage of the conversation and is commenting on it. It was written by',
  referenceTruncated: '[… truncated to',
  referenceCharacters: 'characters]',
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
  openFileTitle: 'Open the file at this change',
  openFileFailed: 'Could not open the file',
  toggleDetails: 'Show or hide the details',
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
  // Session history (M6).
  historyLabel: 'History',
  historySearchPlaceholder: 'Search sessions',
  historyEmpty: 'No sessions in this workspace yet.',
  historyNoMatches: 'No sessions match.',
  historyToday: 'Today',
  historyYesterday: 'Yesterday',
  historyWeek: 'Previous 7 days',
  historyOlder: 'Older',
  historyShowArchived: 'Show archived',
  historyArchive: 'Archive',
  historyUnarchive: 'Unarchive',
  historyCurrent: 'current',
  historyForkMark: 'fork',
  historyTurns: 'turns',
  historyTurn: 'turn',
  justNow: 'just now',
  minutesAgo: 'min ago',
  hoursAgo: 'h ago',
  daysAgo: 'd ago',
  resumeItem: 'Resume',
  resumeDetail: 'Pick a previous conversation in this workspace',
  renameTitle: 'Rename this conversation',
  renamePlaceholder: 'Conversation name',
  // The user card's menu (Claude Code's rewind button): fork, rewind, both.
  rewindMenuLabel: 'Fork or rewind',
  forkFromHere: 'Fork conversation from here',
  rewindCodeToHere: 'Rewind code to here',
  forkAndRewind: 'Fork conversation and rewind code',
  rewindNothing: 'No edits after this message to rewind.',
  rewindDone: 'Code rewound to this message',
  forkedNotice: 'Forked into a new conversation.',
  resumedNotice: 'Resumed',
  historyUnavailable: 'The conversation history could not be loaded',
  historyNotServed: 'The earlier messages of this conversation could not be shown',
  unreadTooltip: 'Muse needs your attention',
  unreadMark: '● ',
  sessionRequired: 'Start a conversation first.',
  // Account & usage dialog (M8).
  usageItem: 'Account & usage…',
  usageItemDetail: 'Subscription usage, this conversation’s tokens, the backend',
  agentsCommand: '/agents',
  agentsCommandDetail: 'Show the agent map',
  usageCommand: '/usage',
  usageCommandDetail: 'Show account usage',
  costCommand: '/cost',
  costCommandDetail: 'Show this conversation’s token totals',
  usageLabel: 'Account & usage',
  usagePlan: 'Plan',
  usageBackend: 'Backend',
  usageWindow: 'Current window',
  usageWeekly: 'This week',
  usageUsed: 'used',
  usageResets: 'resets in',
  usageAsOf: 'as of',
  usageNoSubscription:
    'No subscription usage reported yet. Muse Code reports it after the first turn of a conversation.',
  usageModelApiNote:
    'This window runs on your Model API key: requests are billed to the key at pay-as-you-go rates and counted on the dev.meta.ai dashboard.',
  usageOpenDashboard: 'Open dev.meta.ai',
  usageSessionTokens: 'This conversation',
  usageInput: 'Input',
  usageOutput: 'Output',
  usageCached: 'Cached',
  usageContext: 'Context',
  usageNoSession: 'No tokens counted yet in this conversation.',
  usageLoading: 'Reading usage…',
  usageUnavailable: 'Usage could not be read',
  usageClose: 'Close',
  // Onboarding tips on the empty state (M8), hidden by museSpark.hideOnboarding.
  onboardingTitle: 'Getting started',
  onboardingHide: 'Hide these tips',
  // Screen-reader announcements (M8): a polite live region reads these.
  announceTurnCompleted: 'Muse finished responding',
  announceTurnFailed: 'The turn failed',
  announceTurnCancelled: 'The turn was stopped',
  announceApproval: 'Approval needed for',
  announceQuestion: 'Muse asked a question',
  announceResumed: 'Conversation resumed',
  // Voice dictation (M9).
  dictationTitle: 'Tap or hold to record (Ctrl+D)',
  dictationStopTitle: 'Stop recording (Ctrl+D)',
  dictationLabel: 'Record voice',
  dictationStarting: 'Starting the microphone…',
  dictationListening: 'Listening…',
  dictationFailed: 'Voice dictation failed',
  dictationHelperExited: 'The dictation helper exited',
  dictationUnavailable: 'Voice dictation is not available on this platform.',
  dictationUnavailableLinux:
    'Voice dictation is not available on Linux: no distribution ships a speech recogniser, and this extension adds no third-party engine.',
  dictationUnavailableWindows:
    'Voice dictation needs Windows PowerShell, which was not found (SystemRoot is not set).',
  dictationUnavailableDarwin:
    'Voice dictation needs the macOS helper (native/darwin/muse-dictate), which this build does not include.',
  announceListening: 'Listening',
  announceStoppedListening: 'Stopped listening',
  // Model API backend (M7).
  allowOnce: 'Allow once',
  allowSessionPrefix: 'Always allow in this session:',
  reject: 'Reject',
  toolRefusedByMode: 'refused by the permission mode',
  shellRestrictedMode:
    'shell commands are disabled while the workspace is in Restricted Mode; trust the workspace to enable them',
  skillNotFound: 'unknown skill',
  skillInvoked: 'The user invoked the skill',
  skillArguments: 'Arguments:',
  skillNoArguments: '(none)',
  toolRejectedByUser: 'rejected by the user',
  toolCancelled: 'cancelled',
  contributorTitle: 'Contributor-tier model',
  contributorDetail:
    'Meta may use prompts and completions sent to a contributor-tier model to train its models, in exchange for the lower price. Use it for this conversation?',
  contributorConfirm: 'Use contributor model',
  contributorBlocked:
    'Contributor-tier models are blocked in this workspace (museSpark.confidentialWorkspace).',
  modelApiKeyMissing: 'Paste a Model API key to use the Meta Model API.',
  backendItem: 'Backend',
  backendDetail: 'museSpark.backend: auto / museCode / modelApi',
  backendMuseCode: 'Muse Code (your Muse subscription)',
  backendModelApi: 'Meta Model API (your key, pay as you go)',
  modelApiUnauthorized: 'The Model API rejected the key. Sign in again with a valid key.',
  modelApiBackendNotice:
    'This conversation runs on the Meta Model API with the extension’s own tools (read, edit, write, search, list, shell). Its sessions are kept in this workspace’s extension storage.',
  installOrKeyDetail:
    'The Muse Code CLI hosts conversations for this extension; without it you can still use a Meta Model API key.',
  compactionDone: 'Context compacted',
  compactionPrompt:
    'Summarise this conversation so far for your own future reference: the goal, the decisions, the files touched with what changed, open questions, and what to do next. Be complete but concise; use plain Markdown.',
  compactionPrefix: 'Summary of the conversation so far (the earlier messages were compacted):',
  steeredPrefix: '[The user added while you were working]',
  answersPrefix: 'The user answered:',
  questionCancelledOutput: 'The user declined to answer. Proceed with your best judgement.',
  resumeFailed: 'Could not resume the conversation',
  forkFailed: 'Could not fork the conversation',
  renameFailed: 'Could not rename the conversation',
  sandboxOffProfileNotice:
    "This workspace is under your user profile, where Muse Code's Windows sandbox cannot run commands, so this window runs shell commands without the sandbox, directly as you. Approval prompts still apply. Setting: museSpark.shellSandbox.",
  rulesFileNoWorkspace: 'Open a folder first; AGENTS.md lives in the workspace root.',
  rulesFileExists: 'AGENTS.md already exists in this workspace; opening it.',
  rulesFileCreated: 'AGENTS.md created. Muse reads it as project rules from the next conversation.',
  terminalCliMissing: 'The Muse Code CLI is not installed, so there is no terminal to open.',
  signedOutNotice: 'Signed out of Muse Spark.',
  // The Agent map, the usage modal, the banner and the compact button (M14).
  agentsPillTitle: 'Show the agent map',
  agentSingular: 'agent',
  agentPlural: 'agents',
  agentMapTitle: 'Agent map',
  agentMapHint: 'click an agent for details',
  agentMapEmpty: 'No subagents in this conversation.',
  agentRunning: 'running',
  agentTokens: 'tokens',
  agentContextTokens: 'tokens in context',
  agentUntitled: 'Agent',
  agentRole: 'Role:',
  agentBack: 'Back to the map',
  agentTranscriptLoading: 'Reading the agent’s transcript…',
  agentTranscriptFailed: 'Could not read the agent’s transcript',
  /** The Agent map's owner controls (M18). */
  agentInterrupt: 'Interrupt',
  agentStop: 'Stop',
  agentResume: 'Resume',
  agentClose: 'Close agent',
  agentSendMessage: 'Send message',
  agentFollowup: 'Follow-up task',
  agentMessagePlaceholder: 'A note for this agent, or its next task…',
  agentControlsLabel: 'Agent controls',
  agentControlFailed: 'The agent command was refused',
  agentResultText: 'Result',
  subagentsUnsupported: 'The Model API backend runs no subagents',
  agentNoTranscript: 'No transcript for this agent.',
  agentTranscriptLabel: 'Agent transcript',
  agentDelegationOff:
    'Muse Code’s subagent delegation is off (its default), so the model has no agent tools in this conversation. Set run.subagent_delegation_mode to "auto" in the Muse Code settings file to enable it; the extension never edits that file.',
  agentOpenMuseSettings: 'Open the Muse Code settings file',
  museSettingsMissing: 'Muse Code has not written a settings file yet. It would be at',
  backgroundTaskSingular: 'background task',
  backgroundTaskPlural: 'background tasks',
  backgroundTasksLabel: 'Background tasks',
  backgroundBadge: 'background',
  subagentRowLabel: 'Agent',
  usageAccount: 'Account',
  usageAuthMethod: 'Auth method',
  usageAuthCli: 'Meta account (Muse Code CLI)',
  usageAuthKey: 'Model API key',
  usageAuthNone: 'Not signed in',
  usagePlanPayAsYouGo: 'Pay as you go',
  usagePlanUnknown: 'Not reported yet',
  usageCliVersion: 'Muse Code',
  usageModel: 'Model',
  usageHeading: 'Usage',
  usageCost: 'Estimated cost',
  usageCacheHits: 'Cache hits',
  usageCostNote:
    'Estimate from Meta’s published per-token prices for this model’s tier; the dev.meta.ai dashboard is the bill. Prices read on',
  usageContributing: 'What’s contributing to your usage?',
  usageDay: 'Day',
  usageWeek: 'Week',
  usageContributingNote:
    'Approximate, from the Muse Code CLI’s trace logs on this machine; other devices are not included.',
  usageInsightReminders:
    'of model attempts came from Muse Code’s reminder agents, which run after every reply',
  usageInsightSubagents: 'of model attempts came from subagents',
  usageInsightLong: 'of model attempts came from sessions active for 8+ hours',
  usageInsightNone: 'No CLI activity recorded in this window.',
  usageInsightUnavailable: 'Not available on this backend: the Model API has no local trace logs.',
  usageInsightNoLogs: 'No Muse Code trace logs were found on this machine yet.',
  usageInsightAttempts: 'model attempts across',
  usageInsightSession: 'session',
  usageInsightSessions: 'sessions',
  contextCompactTitle: 'Click to compact now',
  contextPressure: 'pressure',
  unsupportedFileTitle: 'Unsupported file type:',
  unsupportedFileDetail:
    'Supported as uploads: images (PNG, JPEG, GIF, WebP). Other files go in as @ mentions inside the workspace, or by absolute path in the prompt for files outside it.',
  bannerDismiss: 'Dismiss',
  trustGrantedNotice:
    'Workspace trusted: Muse will load its rules, skills and memory from the next message.',
  sandboxRestartNotice:
    'The shell sandbox setting changed; Muse Code restarts with it on the next message. Start a new conversation to continue.',
  sandboxProfileNotice: String.raw`This workspace is under your user profile, which the Windows sandbox of this Muse Code version cannot enter: shell commands will start in the PowerShell folder instead of the project and take about half a minute each. File reads and edits are unaffected. A workspace outside C:\Users runs commands in place.`,
} as const

// Windows PowerShell as an absolute-path suffix under %SystemRoot%, for
// `createTerminal({ shellPath })` when running `muse login` / `muse logout`.
export const WINDOWS_POWERSHELL_TERMINAL_PATH = String.raw`\System32\WindowsPowerShell\v1.0\powershell.exe`
