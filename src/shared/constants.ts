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
  manageSkills: 'museSpark.manageSkills',
  importSkills: 'museSpark.importSkills',
  exportConversation: 'museSpark.exportConversation',
  mcpServers: 'museSpark.mcpServers',
  hooks: 'museSpark.hooks',
  memory: 'museSpark.memory',
  newWorktree: 'museSpark.newWorktree',
  removeWorktree: 'museSpark.removeWorktree',
  // M46: Ctrl+B moves the running commands to the background; the other
  // stops every background task of the conversation.
  moveToBackground: 'museSpark.moveToBackground',
  stopBackgroundTasks: 'museSpark.stopBackgroundTasks',
} as const

// Extension-private `globalState` keys (never machine-wide configuration).
export const GLOBAL_STATE_KEYS = {
  /** "Don't ask again" on the Windows sandbox setup prompt. */
  sandboxPromptSuppressed: 'museSpark.sandboxPromptSuppressed',
  /** The subscription window the CLI last reported, shown "as of" until a fresh one (M16). */
  lastUsage: 'museSpark.lastUsage',
  /**
   * The paid features whose price the user accepted in the confirmation
   * (M33, PLAN.md D30): a setting that is on without its entry here is not
   * used, and turning a setting off removes its entry.
   */
  paidConfirmations: 'museSpark.paidConfirmations',
} as const

// VS Code `when`-clause context keys the extension maintains.
export const CONTEXT_KEYS = {
  inputFocused: 'museSpark.inputFocused',
  /** True while a credential for the selected backend is present (the walkthrough's sign-in step). */
  signedIn: 'museSpark.signedIn',
  /** The focused conversation runs a command Ctrl+B can move to the background (M46). */
  canMoveToBackground: 'museSpark.canMoveToBackground',
} as const

// Built-in VS Code commands the extension invokes.
export const VSCODE_COMMANDS = {
  focusActiveEditorGroup: 'workbench.action.focusActiveEditorGroup',
  setContext: 'setContext',
  openSettings: 'workbench.action.openSettings',
  openKeybindings: 'workbench.action.openGlobalKeybindings',
  diff: 'vscode.diff',
  openWalkthrough: 'workbench.action.openWalkthrough',
  // A folder in a window of its own (M32's new worktree).
  openFolder: 'vscode.openFolder',
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
// Settings `muse serve` takes at spawn: changing one restarts it (PLAN.md D25).
export const CLI_PROCESS_SETTINGS = [
  'museSpark.museBinaryPath',
  'museSpark.environmentVariables',
  'http.proxy',
  'http.noProxy',
] as const
// VS Code's proxy settings, handed to `muse serve` when its environment has none.
export const HTTP_SETTINGS_SECTION = 'http'
export const HTTP_PROXY_SETTING = 'proxy'
export const HTTP_NO_PROXY_SETTING = 'noProxy'
// The terminal environment settings the Model API shell tool applies (D25).
export const TERMINAL_ENV_SECTION = 'terminal.integrated.env'
export const TERMINAL_ENV_KEYS = { windows: 'windows', osx: 'osx', linux: 'linux' } as const

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
  // Claude Code's `cleanupPeriodDays` (PLAN.md D26): Model API conversations
  // idle longer than this are deleted when a window reads them; 0 keeps them.
  // Muse Code's own sessions are the CLI's to keep.
  cleanupPeriodDays: 30,
  museBinaryPath: '',
  environmentVariables: [] as readonly EnvironmentVariable[],
  shellSandbox: 'auto' as ShellSandboxMode,
  backend: 'auto' as BackendMode,
  // Claude Code's `enableNewConversationShortcut`: Ctrl+N starts a new
  // conversation while a Muse surface is focused. Read only by the
  // keybinding's `when` clause (`config.museSpark.…`), off by default.
  enableNewConversationShortcut: false,
  // The paid Model API features (M33–M35, PLAN.md D30): off until the user
  // turns one on and accepts its price in the confirmation.
  modelApiWebSearch: false,
  modelApiImageGeneration: false,
  modelApiVoice: false,
} as const
export const ARCHIVE_DAY_CHOICES = [1, 2, 7, 14, 0] as const
// Settings a repository's `.vscode/settings.json` must never set (PLAN.md
// D15): they choose what executes, what is billed and how much is approved,
// so the manifest declares them `scope: machine` (user settings only). The
// paid features are among them (D30): a repository cannot spend the key.
export const MACHINE_SCOPED_SETTINGS = [
  'initialPermissionMode',
  'backend',
  'shellSandbox',
  'allowDangerouslySkipPermissions',
  'museBinaryPath',
  'environmentVariables',
  'modelApiWebSearch',
  'modelApiImageGeneration',
  'modelApiVoice',
] as const

// --- Paid features on the Model API backend (M33–M35, PLAN.md D30) ---

// Each is off by default, confirmed with its price when turned on, named in
// the composer's badge while on, shown per use and tallied (the owner's rule:
// "opt in and loud"). They are used on the Model API backend only.
export const PAID_FEATURES = ['webSearch', 'imageGeneration', 'voice'] as const
// The paid features the Muse Code backend can use too, billed to a stored
// Model API key (M44, PLAN.md D37): images through the `ide` server and
// Muse Voice. Web search is not among them: Muse Code searches on the
// subscription with its own tool.
export const MUSE_CODE_PAID_FEATURES = ['imageGeneration', 'voice'] as const
export type PaidFeature = (typeof PAID_FEATURES)[number]
/** Each feature's setting, relative to the `museSpark` section. */
export const PAID_FEATURE_SETTINGS = {
  webSearch: 'modelApiWebSearch',
  imageGeneration: 'modelApiImageGeneration',
  voice: 'modelApiVoice',
} as const satisfies Readonly<Record<PaidFeature, keyof typeof SETTING_DEFAULTS>>
// Meta's published prices (dev.meta.ai/docs/pricing-rate-limits, read
// 2026-09-24), on top of the tokens a turn uses: a web search, an image, and
// an hour of Muse Voice Transcribe audio.
export const PAID_PRICES_USD = {
  webSearchPerThousand: 2.5,
  imageGeneration: 0.01,
  voicePerHour: 0.18,
} as const
export const PAID_PRICES_VERIFIED_ON = '2026-09-24'
export const SEARCHES_PER_PRICE_UNIT = 1000
export const SECONDS_PER_HOUR = 3600

// --- Sessions (M6, PLAN.md §6 M6) ---

// `session/list` page size (the host caps at 200) and how many pages the
// dialog will follow before it stops.
export const SESSION_LIST_LIMIT = 200
export const SESSION_LIST_MAX_PAGES = 5
// A gap reload scans recent durable view pages backward for the last goal
// change. `view/page` allows 1–1000 events per page (MSP SS4.7.3).
export const GOAL_RECOVERY_PAGE_LIMIT = 1000
export const GOAL_RECOVERY_MAX_PAGES = 100
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
// `git worktree add` checks a whole tree out, and `remove` deletes one (M32).
export const GIT_WORKTREE_TIMEOUT_MS = 5 * 60 * 1000
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

export const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'powershell', 'shell', 'cmd'])
// `apply_patch` is Muse Code's hunk-based editor (M43); its rows carry a
// stored patch like `edit_file`'s.
export const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'apply_patch',
])
export const FILE_READ_TOOLS: ReadonlySet<string> = new Set(['read_file'])
// Muse Code's own tool families whose rows read their JSON results (M43,
// captured live 2026-09-25, PLAN.md D36).
export const MEMORY_TOOLS: ReadonlySet<string> = new Set([
  'read_memory',
  'add_memory',
  'edit_memory',
])
// Muse Code's memory scopes (`scope` of the memory tools), the default first.
export const MEMORY_SCOPES = ['personal_project', 'project', 'personal'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]
export const DEFAULT_MEMORY_SCOPE: MemoryScope = 'personal_project'
export const GOAL_TOOLS: ReadonlySet<string> = new Set([
  'create_goal',
  'get_goal',
  'update_goal',
  'report_progress',
])
export const SCHEDULE_TOOLS: ReadonlySet<string> = new Set([
  'cron_create',
  'cron_list',
  'cron_delete',
])
// The tools that make an image (M34, M44): their rows show the prompt and
// the images an edit starts from.
export const IMAGE_MAKING_TOOLS: ReadonlySet<string> = new Set([
  'generate_image',
  'edit_image',
  'mcp__ide__generateImage',
  'mcp__ide__editImage',
])
// The session goal (M45, PLAN.md D38): the user's verbs, which are MSP's
// `goal/<verb>` and the TUI's `/goal <verb>`; `set` and `edit` carry an
// objective.
export const GOAL_COMMANDS = ['set', 'edit', 'pause', 'resume', 'clear'] as const
export type GoalCommandVerb = (typeof GOAL_COMMANDS)[number]
// The goal statuses Muse Code 1.3.0 folds (its goal store's closed list);
// the wire carries the status verbatim, so any other is shown as it came.
export const GOAL_STATUS = {
  active: 'active',
  paused: 'paused',
  complete: 'complete',
  blocked: 'blocked',
  usageLimited: 'usage_limited',
  budgetLimited: 'budget_limited',
} as const
// `/goal <objective>` sets the goal from the prompt, as in Muse Code's TUI;
// `/goal edit <objective>`, `/goal pause`, `/goal resume`, `/goal clear`.
export const GOAL_SLASH_COMMAND = 'goal'
// A progress bar's range: MSP passes the percentage verbatim (over 100
// included), and the strip clamps it for the bar only.
export const GOAL_PERCENT_MAX = 100

// The rows that show the picture a tool read or made, when the path names one.
export const IMAGE_PREVIEW_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'generate_image',
  'edit_image',
  'mcp__ide__generateImage',
  'mcp__ide__editImage',
])
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
// dev.meta.ai/docs/error-handling: 429 and the server errors are retryable
// with exponential backoff and jitter, honouring Retry-After; 3–5 attempts.
// A 504 is not: the guide says to stream instead, which every long request
// here already does.
export const MODEL_API_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503])
// A stream that ends with an `error` event of these codes (the instance shut
// down or was overloaded mid-reply) is retried whole, as the guide says.
export const MODEL_API_RETRYABLE_STREAM_CODES: ReadonlySet<string> = new Set([
  'server_shutting_down',
  'service_overloaded',
  'backend_unavailable',
])
export const MODEL_API_MAX_RETRIES = 4
export const MODEL_API_RETRY_BASE_MS = 1000
export const MODEL_API_RETRY_MAX_MS = 60_000
export const MODEL_API_RETRY_JITTER_MS = 1000
// The model list and the token count have no turn to stop them (PLAN.md D25).
export const MODEL_API_REQUEST_TIMEOUT_MS = 30_000
// A reply stream that sends nothing for this long, headers or frames, ends
// its turn (M39): it would otherwise hold the turn until Stop. Long enough
// for a model reasoning at length before its first words.
export const MODEL_API_STREAM_IDLE_MS = 300_000
// The file tools load a file whole (read_file shows a window of it,
// edit_file changes it): one larger than this is refused unread (M39).
export const BYTES_PER_MIB = 1024 * 1024
export const TOOL_FILE_MAX_MIB = 10
export const TOOL_FILE_MAX_BYTES = TOOL_FILE_MAX_MIB * BYTES_PER_MIB
export const HTTP_UNAUTHORIZED = 401
// Refused before any work was done: the one status a per-call-billed request retries (M34).
export const HTTP_TOO_MANY_REQUESTS = 429
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
  // M34: offered only while paid image generation is on.
  generateImage: 'generate_image',
  // M44: the same gate and price; one or more workspace images changed by a prompt.
  editImage: 'edit_image',
  // M45 (PLAN.md D38): Muse Code's goal tools, with its arguments and results.
  createGoal: 'create_goal',
  getGoal: 'get_goal',
  updateGoal: 'update_goal',
  reportProgress: 'report_progress',
  // M49 (PLAN.md D41): Muse Code's own memory tools, with its arguments and results.
  readMemory: 'read_memory',
  addMemory: 'add_memory',
  editMemory: 'edit_memory',
} as const
// The image tools the extension's `ide` session server offers Muse Code
// while paid image generation is on and a Model API key is stored (M44):
// billed to the key, never to the subscription (D1, D30).
export const IDE_IMAGE_TOOLS = {
  generateImage: 'generateImage',
  editImage: 'editImage',
} as const
// How Muse Code names those tools in its items (`mcp__<server>__<tool>`):
// their rows are marked paid like the Model API backend's (M44).
export const IDE_PAID_TOOLS: ReadonlySet<string> = new Set([
  `mcp__ide__${IDE_IMAGE_TOOLS.generateImage}`,
  `mcp__ide__${IDE_IMAGE_TOOLS.editImage}`,
])
// The goal loop on the Model API backend (M45, D38). Muse Code reminds the
// agent to report progress after about ten model calls without any (its
// step probe, docs/muse-code/interactive); the same note rides in the
// instructions here, with no extra call. The objective is pinned into every
// request while the goal is active, so it is capped (Muse Code states no
// limit; this one is the extension's).
export const GOAL_PROGRESS_REMINDER_STEPS = 10
export const GOAL_OBJECTIVE_MAX_CHARS = 4000
export const GOAL_ID_PREFIX = 'goal-'

// Meta's hosted search (M33): a Responses tool the server runs, shown in
// the transcript as a tool row of this name, marked paid.
export const MODEL_API_WEB_SEARCH_TOOL = 'web_search'
// Image generation (M34, dev.meta.ai/docs/image-generation, read 2026-09-25):
// `POST /images/generations` with Meta's image model, one PNG per call,
// returned inline. `size` sets only the aspect ratio; the generator picks the
// pixels. Meta states no prompt limit: this one keeps a runaway prompt from
// being sent and billed. An image can take a while (the model may search and
// reason first), so its request has a deadline of its own.
export const MODEL_API_IMAGE_MODEL = 'muse-image-1.0'
export const IMAGE_ASPECT_SIZES = {
  square: '1024x1024',
  landscape: '1536x1024',
  portrait: '1024x1536',
} as const
export type ImageAspect = keyof typeof IMAGE_ASPECT_SIZES
export const IMAGE_OUTPUT_FORMAT = 'png'
export const IMAGE_FILE_EXTENSION = '.png'
export const IMAGE_PROMPT_MAX_CHARS = 4000
export const IMAGE_REQUEST_TIMEOUT_MS = 180_000
// Image edits (M44, dev.meta.ai/docs/api-reference/images/edit-image, read
// 2026-09-25): `POST /images/edits` with the source images inline as data
// URLs, one PNG back, the same price as a generated image. Meta requires at
// least one source and states no maximum: this one keeps a call's upload
// (each source up to MAX_IMAGE_BYTES) bounded.
export const IMAGE_EDIT_MAX_SOURCES = 4
// The source images an edit can send, by the media type their name gives.
export const IMAGE_EDIT_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
])
// The first eight bytes of every PNG file: what came back is checked before it is written.
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
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
// Memory (M49, PLAN.md D41, found on disk and in a live capture 2026-09-25):
// Muse Code keeps Markdown notes in three scopes. `project` is the
// repository's `.agents/memory`; `personal` is `<data>/muse/memory/personal`
// and `personal_project` is `<data>/muse/memory/projects/<slug>-<key>`,
// where `<data>` is `$XDG_DATA_HOME`, else `~/.local/share`. Each scope may
// keep a `MEMORY.md` index, one line per note (`- [Title](file.md) | hook`).
export const MEMORY_DIR_SEGMENTS = ['.agents', 'memory'] as const
export const MEMORY_DIR = '.agents/memory'
export const MEMORY_INDEX_FILE = 'MEMORY.md'
export const MEMORY_DATA_HOME_SEGMENTS = ['.local', 'share'] as const
export const MEMORY_DATA_SEGMENTS = ['muse', 'memory'] as const
export const MEMORY_PERSONAL_DIR = 'personal'
export const MEMORY_PROJECTS_DIR = 'projects'
export const MEMORY_NOTE_EXTENSION = '.md'
export const MEMORY_STAGE_FILE_MODE = 0o600
// `add_memory`'s optional `type` (the binary's schema; `user`, `reference`
// and `project` seen accepted live).
export const MEMORY_NOTE_TYPES = ['user', 'feedback', 'project', 'reference'] as const
// `read_memory`'s window when the call names none (the tool's own schema).
export const MEMORY_READ_DEFAULT_LIMIT = 500
// Muse Code's session-start snapshot lists each scope's other notes by
// path, "up to 48 files" (dev.meta.ai/docs/muse-code/configuration).
export const MEMORY_SNAPSHOT_MAX_NOTES = 48
// What the Memory view lists per scope, and how deep it looks for notes.
export const MEMORY_LIST_MAX_NOTES = 500
export const MEMORY_LIST_MAX_DEPTH = 8
// An index line's hook, cut to this many characters.
export const MEMORY_HOOK_MAX_CHARS = 120
export const MEMORY_MARKDOWN_ESCAPE = String.fromCodePoint(92)
export const MEMORY_INDEX_MAX_LINES = 200
export const MEMORY_INDEX_MAX_BYTES = 32 * 1024
export const MEMORY_TRUNCATED_MARKER = '[MEMORY.md truncated]'
export const MUSE_MEMORY_DOCS_URL = 'https://dev.meta.ai/docs/muse-code/configuration#local-memory'
export const TOOL_OUTPUT_MAX_CHARS = 64_000
export const TOOL_OUTPUT_CLIP_MARKER = '\n[output clipped]'
// PLAN.md D27: a clipped shell stream keeps its beginning and its end, with
// this between them; the exit line is never clipped.
export const TOOL_OUTPUT_ELIDED_MARKER = '\n[… output elided …]\n'
// Unchanged lines kept on each side of an edit in the Model API's patch
// documents, as unified diffs and Muse Code's own documents carry them: a
// Revert checks them, so it never re-applies at a line that has moved (D27).
export const PATCH_CONTEXT_LINES = 3
export const READ_FILE_DEFAULT_LIMIT = 2000
export const READ_FILE_MAX_LINE_CHARS = 2000
export const SEARCH_MAX_RESULTS = 200
export const SEARCH_MAX_FILE_BYTES = 1024 * 1024
// The model's regular expression is evaluated on a worker thread that is
// terminated when it overruns this budget (ReDoS containment); the worker
// stops collecting after this many hits.
export const SEARCH_TIMEOUT_MS = 20_000
export const SEARCH_MAX_HITS = 5000
// The files one search reads at most (PLAN.md D27); the output says when the
// glob matched more.
export const SEARCH_MAX_CANDIDATES = 50_000
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
// `.muse` holds `hooks.json`, whose commands Muse Code runs outside its
// sandbox and approval (M29, D30).
export const PROTECTED_PATH_SEGMENTS: readonly (readonly string[])[] = [
  ['.git'],
  ['.husky'],
  ['.vscode'],
  ['.idea'],
  ['.devcontainer'],
  ['.github', 'workflows'],
  ['.agents'],
  ['.muse'],
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
// Per stream: past it the middle of the output is dropped with a count.
export const SHELL_OUTPUT_MAX_CHARS = 2 * 1024 * 1024
// After the shell exits, how long its output may keep arriving before the
// tool returns anyway: a background process it started (`server &`) can
// hold the pipes open for as long as it runs (PLAN.md D25).
export const SHELL_DRAIN_GRACE_MS = 250
export const WINDOWS_TASKKILL_RELATIVE_PATH = String.raw`System32\taskkill.exe`
// A child the shell starts while `taskkill /T` enumerates its tree outlives
// the kill (PLAN.md D25, M27). On Windows each command therefore runs in a
// job object of its own, named so a Stop can end it whole; the helper type
// is compiled once into the extension's storage. Where no job is possible,
// the shell is given this long to exit after taskkill, and then its orphans
// are looked up by their dead parent's id and killed, one generation per
// round, in this many rounds at most; each helper run is given this long.
export const SHELL_JOB_TYPE_NAME = 'MuseSparkJob'
export const SHELL_JOB_FOLDER = 'shell-job'
export const SHELL_JOB_NAME_PREFIX = String.raw`Local\MuseSparkShell-`
export const TREE_EXIT_WAIT_MS = 10_000
export const ORPHAN_SWEEP_ROUNDS = 5
export const PROCESS_TABLE_TIMEOUT_MS = 20_000
export const OUTPUT_REF_PREFIX = 'tool_patch-'
// The stored output the transcript can page (`item/readOutput` parity).
export const MODEL_API_OUTPUT_MEDIA_TYPE = 'application/json'
export const MODEL_API_OUTPUT_ENCODING = 'utf8'
// Model API sessions persist as one JSON file each under the workspace
// storage directory (PLAN.md D14); the version guards the shape.
export const MODEL_API_SESSIONS_DIR = 'modelapi-sessions'
export const STORED_SESSION_VERSION = 1
// PLAN.md D26: a session store `.tmp` this old is a crash's leftover, not a
// save in flight (another window on the same workspace may be writing one).
export const SESSION_FILE_STALE_TEMPORARY_MS = 60_000
// Whole-file writes (D26, D27, `host/fsAtomic.ts`): a temporary file with this
// suffix is renamed over the target; a rename Windows refuses while a scanner
// holds the file is tried this often, the wait doubling from the delay.
export const ATOMIC_TEMPORARY_SUFFIX = '.tmp'
export const ATOMIC_RENAME_ATTEMPTS = 5
export const ATOMIC_RENAME_DELAY_MS = 25
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

// Item kinds the transcript never shows: our own echo and host-internal children.
export const HIDDEN_ITEM_KINDS: ReadonlySet<string> = new Set(['userMessage', 'reminderChild'])

// --- Background work, the `!` user shell, clarifications (M46, PLAN.md D39) ---

// A shell command the user runs from the prompt (`!ls`): MSP's `userShell`
// item, outside any turn; the model sees it with its next request.
export const USER_SHELL_ITEM_KIND = 'userShell'
export const USER_SHELL_PREFIX = '!'
// The Model API backend runs the user's command through the shell tool's own
// runner (job objects on Windows, M27) with this limit, the shell tool's
// longest; the row's Stop ends it sooner.
export const USER_SHELL_TIMEOUT_MS = 10 * 60 * 1000
// Who moved a task to the background (MSP `BackgroundInitiator`).
export const BACKGROUND_INITIATOR_USER = 'user'
// What a row's button asked of a task: `task/background` or `task/stop`.
export const TASK_REQUESTS = ['background', 'stop'] as const
export type TaskRequest = (typeof TASK_REQUESTS)[number]
// `userInput/clarify` (tdd SS5.10.2): a free-form answer in place of the
// options, "text" in MSP v1, at most this many characters.
export const CLARIFICATION_FORMAT = 'text'
export const CLARIFICATION_MAX_CHARS = 500
export const QUESTION_OUTCOME_CLARIFIED = 'clarified'

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

// --- Workflows (M47, PLAN.md D40) ---

/** The run's own item kind, and the agent tool that launches one. */
export const WORKFLOW_KIND = 'workflow'
export const WORKFLOW_TOOL = 'workflow'
/**
 * A child's statuses while it runs (live 2026-09-25: `scheduled`, then
 * `started`, `usage` with its tokens, `completed` and `terminal`). Muse Code
 * showed `started` and `usage` while its child ran; the badge counts only
 * those as running.
 */
export const WORKFLOW_CHILD_RUNNING_STATUSES: ReadonlySet<string> = new Set(['started', 'usage'])
/**
 * Muse Code's `run.workflow_trigger_mode` when its settings file leaves it
 * unset: 1.3.0 ran as `auto` (live 2026-09-25: the session's workflow
 * guidance let the model start one, and the run named `guidanceAuto`).
 */
export const MUSE_WORKFLOW_TRIGGER_DEFAULT = 'auto'
/** The only generated workflow entry ID observed in M47's live capture. */
export const CAPTURED_GENERATED_WORKFLOW_ENTRY_ID = 'generated.model-chosen'
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
// And at most this many characters (M39): one line of minified output can
// be megabytes, which the line count alone would render whole.
export const OUTPUT_PREVIEW_CHARS = 2000
// `item/readOutput` page size (the host serves at most 6 MiB per call).
export const OUTPUT_PAGE_BYTES = 256 * 1024
// The spinner line under the last row changes its verb this often while a
// turn runs (the verbs are `UI_TEXT.statusVerbs`).
export const STATUS_VERB_INTERVAL_MS = 4000
export const MILLISECONDS_PER_SECOND = 1000
export const SECONDS_PER_MINUTE = 60
export const MINUTES_PER_HOUR = 60
export const HOURS_PER_DAY = 24
export const DAYS_PER_WEEK = 7
// Muse Code's shell tool reports this when its OS sandbox is not set up
// (Windows: `muse sandbox windows setup` from an elevated shell).
export const SANDBOX_FAILURE_MARKER = 'sandbox enforcement unavailable'
// And a `!` command's row says this in its output instead (M46, captured
// 2026-09-25 on Windows with the sandbox on and not set up).
export const USER_SHELL_SANDBOX_FAILURE_MARKER = 'managed shell sandbox is unavailable'
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
// And at most this many characters together (M39): each can be 16 MiB.
export const OUTPUT_DOCUMENTS_MAX_CHARS = 32 * 1024 * 1024
export const OUTPUT_DOCUMENTS_KEPT = 20
// The IDE tool server `muse serve` reaches over loopback (session MCP), the
// `session/listChanged` stream behind the History dialog (M6), and the
// TUI's `!` escape, `session/userShell` (M46, PLAN.md D39). The first stays
// first: the IDE server's warning names it.
export const MSP_REQUESTED_CAPABILITIES = ['sessionMcp', 'sessionListStream', 'userShell'] as const
export const MSP_USER_SHELL_CAPABILITY = 'userShell'
// How long the extension waits on `muse serve` (PLAN.md D25; the SDK has no
// timeouts of its own, INV-006): the handshake, an ordinary command, and the
// commands that load or copy a whole session. Past them the command fails
// with a message instead of leaving the panel waiting for ever.
export const MSP_HANDSHAKE_TIMEOUT_MS = 30_000
export const MSP_COMMAND_TIMEOUT_MS = 60_000
export const MSP_LONG_COMMAND_TIMEOUT_MS = 180_000
// A command the host refused without admitting it (the SDK's own rule, D26):
// sent again with the same id up to this many times in all.
export const MSP_COMMAND_ATTEMPTS = 3
export const MSP_RETRY_BASE_DELAY_MS = 50
export const MSP_RETRY_MAX_DELAY_MS = 2000
export const MSP_RETRYABLE_REFUSALS: readonly { readonly code: number; readonly kind: string }[] = [
  { code: -32_001, kind: 'overloaded' },
  { code: -32_031, kind: 'backpressured' },
]
export const MSP_LONG_COMMANDS: ReadonlySet<string> = new Set([
  'session/resume',
  'session/fork',
  'session/read',
  'session/compact',
])
// The frame cap `muse serve` holds in both directions (the SDK's
// DEFAULT_FRAME_LIMIT_BYTES): a command larger than this is refused here with
// a message, where the host would drop the frame and never answer (D26).
export const MSP_FRAME_LIMIT_BYTES = 10 * 1024 * 1024
// `session/list` refuses a larger page (msp.d.ts SessionListParams.limit).
export const MSP_SESSION_LIST_MAX_LIMIT = 200
// Muse Code versions that refuse `session/rename` and `session/fork` on
// Windows (meta-models/muse-code-sdk#30 and #31, verified live 2026-09-22 on
// 1.3.0): the panel does not offer either there (D26).
export const WINDOWS_SESSION_EDITS_LIMITED_MAX_VERSION = '1.3.0'
// Muse Code's documented exit codes (SDK `classifyExit`) after which a
// restart cannot help; what each code means is `UI_TEXT.museExitMeanings`.
export const MUSE_EXIT_PERSISTENT_CODES: ReadonlySet<number> = new Set([2, 3, 5])
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
// One diagnostic's message is cut here (PLAN.md D27): a TypeScript type
// mismatch can run to thousands of characters, and 200 of those would crowd
// the model's context. The cut is marked with how much was left out.
export const DIAGNOSTIC_MESSAGE_MAX_CHARS = 1000
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
  internalServerError: 500,
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
// Muse Code's own page on MCP servers and hooks (M31).
export const MUSE_EXTENDING_DOCS_URL = 'https://dev.meta.ai/docs/muse-code/extending'
// `.muse/hooks.json` under the workspace root, Muse Code's project hooks (M31).
export const PROJECT_HOOKS_SEGMENTS = ['.muse', 'hooks.json'] as const
export const ISSUES_URL = 'https://github.com/RandyNorthrup/muse-spark-code/issues'
/** The Meta developer dashboard (usage, keys, billing) the usage dialog links to. */
export const META_DASHBOARD_URL = 'https://dev.meta.ai/'

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
// Which recogniser the microphone uses (M35, PLAN.md D30): the operating
// system's, free and local, or Muse Voice Transcribe, paid and opt-in, on the
// Model API backend only.
export const DICTATION_ENGINES = ['system', 'museVoice'] as const
export type DictationEngine = (typeof DICTATION_ENGINES)[number]
// Muse Voice (M35, dev.meta.ai/docs/api-reference/voice/realtime, read
// 2026-09-25): a WebSocket whose first text frame carries the key (Meta
// ignores the Authorization header there), then binary frames of 16-bit
// little-endian mono PCM at real time, then `endStream`. Push-to-talk mode:
// cumulative partials, the final one marked. Billed per whole second of audio.
export const MUSE_VOICE_REALTIME_URL = 'wss://api.meta.ai/v1/asr/realtime'
export const MUSE_VOICE_MODEL = 'muse-voice-transcribe-1.0'
export const MUSE_VOICE_AUDIO_ENCODING = 'PCM_16KHZ'
export const MUSE_VOICE_MODE = 'PUSH_TO_TALK'
export const MUSE_VOICE_PARTIAL_MODE = 'CUMULATIVE'
export const MUSE_VOICE_SAMPLE_RATE = 16_000
export const MUSE_VOICE_BYTES_PER_SECOND = MUSE_VOICE_SAMPLE_RATE * 2
// Meta closes a stream whose handshake is not sent within 10 s; the answer
// is waited for as long. After `endStream`, the final text has this long.
export const MUSE_VOICE_HANDSHAKE_TIMEOUT_MS = 10_000
export const MUSE_VOICE_FINISH_TIMEOUT_MS = 15_000
// The WebSocket close codes Meta documents: a normal end, a bad request or
// pacing (not retried), a server failure, a rate limit.
export const WEBSOCKET_CLOSE_NORMAL = 1000
export const MUSE_VOICE_CLOSE_REASONS = {
  1008: 'badRequest',
  1011: 'serverFailure',
  1013: 'rateLimited',
} as const
// The capture helpers: a second script beside dictate.ps1 on Windows, the
// Swift helper's capture mode on macOS, and on Linux the system's own
// recorder (ALSA's arecord, else PulseAudio's parec) writing raw PCM.
export const DICTATION_WINDOWS_CAPTURE_SEGMENTS = ['windows', 'capture.ps1'] as const
export const DICTATION_DARWIN_CAPTURE_FLAG = '--capture'
export const LINUX_RECORDERS: readonly {
  readonly command: string
  readonly args: readonly string[]
}[] = [
  { command: 'arecord', args: ['-q', '-t', 'raw', '-f', 'S16_LE', '-r', '16000', '-c', '1'] },
  { command: 'parec', args: ['--raw', '--format=s16le', '--rate=16000', '--channels=1'] },
]
// M26 (PLAN.md D29): dictation in a remote window, and the environment the
// Windows helper starts with.
/** Windows PowerShell's module search path, reset for the Windows helper. */
export const WINDOWS_PSMODULEPATH_VARIABLE = 'PSModulePath'
/**
 * The macOS helper's flag naming the app that started it (VS Code's
 * `env.appName`). The helper disclaims that app's responsibility and asks
 * macOS under its own name (PLAN.md M28); where it cannot, macOS charges its
 * privacy requests to the app that started it, and its refusal text names
 * that app.
 */
export const DICTATION_DARWIN_APP_NAME_FLAG = '--app-name'
export const MUSE_LOGIN_ARGS = ['login'] as const
export const MUSE_LOGOUT_ARGS = ['logout'] as const
// `Muse Spark: Open in Terminal` runs the CLI with no arguments (its TUI).
export const MUSE_TERMINAL_NAME = 'Muse Code'
// `Muse Spark: Create AGENTS.md` runs the CLI's own scaffold (no model call).
export const MUSE_INIT_ARGS = ['init'] as const
export const MUSE_INIT_TIMEOUT_MS = 30 * 1000
// The CLI's skill commands (M30, D30): local files only, no model call.
export const MUSE_SKILLS_TIMEOUT_MS = 30 * 1000
/** Where `muse skills import --from` can read skills (Claude Code, Codex). */
export const SKILL_IMPORT_SOURCES = ['claude', 'codex'] as const
export type SkillImportSource = (typeof SKILL_IMPORT_SOURCES)[number]
// The prompt's "/" names for the palette rows whose label is not already
// `/name` (M38): Claude Code's names for the same commands. They are
// commands, not prose, so they read the same in every language.
export const SLASH_COMMAND_NAMES = {
  model: 'model',
  resume: 'resume',
  permissions: 'permissions',
  config: 'config',
  mcp: 'mcp',
  hooks: 'hooks',
  memory: 'memory',
} as const
/** Muse Code's bundled skills that continue another agent's session (M30). */
export const RESUME_SKILL_SELECTORS: Readonly<Record<SkillImportSource, string>> = {
  claude: 'resume-claude',
  codex: 'resume-codex',
}
// `muse export --session <id> --out <file>` reads the local session log only.
export const MUSE_EXPORT_TIMEOUT_MS = 60 * 1000
/** "Export conversation…": readable Markdown, or Muse Code's JSON session log (M30). */
export const EXPORT_FORMATS = ['markdown', 'sessionLog'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export const EXPORT_FILE_EXTENSIONS: Readonly<Record<ExportFormat, string>> = {
  markdown: 'md',
  sessionLog: 'json',
}
// An unnamed conversation's export takes its title from the first prompt, cut here.
export const EXPORT_TITLE_MAX_CHARS = 60
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
export const MUSE_VERSION_FILE = '.muse-version'
export const MUSE_BIN_PREFIX = 'muse-bin-'
export const MUSE_WINDOWS_EXE_SUFFIX = '.exe'
export const MUSE_CREDENTIAL_FILE_SEGMENTS = ['muse', 'auth.json'] as const
export const WINDOWS_POWERSHELL_RELATIVE_PATH = String.raw`System32\WindowsPowerShell\v1.0\powershell.exe`
// Windows PowerShell 5.1 writes a redirected stdout in the OEM code page
// ("héllo ✓" came back "h�llo ?", probed 2026-09-23 under Node's
// windowsHide); this runs first and makes its output, and what it pipes to
// native commands, UTF-8 without a BOM (PLAN.md D27).
export const WINDOWS_POWERSHELL_UTF8_PREAMBLE =
  '$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; '
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

// Webview errors reach the host's log (M39): where each came from, its text
// and stack cut to these lengths, and at most WEBVIEW_ERROR_LOG_LIMIT a
// minute per panel, so a render loop cannot flood the log.
export const WEBVIEW_ERROR_SOURCES = ['render', 'window', 'promise', 'hostMessage'] as const
export type WebviewErrorSource = (typeof WEBVIEW_ERROR_SOURCES)[number]
export const WEBVIEW_ERROR_MESSAGE_MAX_CHARS = 1000
export const WEBVIEW_ERROR_STACK_MAX_CHARS = 4000
export const WEBVIEW_ERROR_LOG_LIMIT = 10
export const WEBVIEW_ERROR_WINDOW_MS = 60_000
// The panel keeps its conversation in VS Code's webview state so the crash
// screen's Reload, or a panel moved to another window, comes back with it:
// saved at most this often while it changes, and at once before a reload.
export const WEBVIEW_STATE_SAVE_MS = 1000
// Streamed text reaches the panel at most once a frame (M39): each post is a
// message, a reducer pass and a render, and a fast stream sends many a frame.
export const DELTA_BATCH_MS = 16
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

// What the model or Meta reads (PLAN.md D33): the context leads, the
// compaction prompt, the steering and answer prefixes, the skill invocation
// and the tool failures returned to the model. English whatever the display
// language, so the model's behaviour does not change with the user's locale;
// what the user reads is `UI_TEXT` (src/shared/l10n/).
export const MODEL_TEXT = {
  skillNotFound: 'unknown skill',
  skillInvoked: 'The user invoked the skill',
  skillArguments: 'Arguments:',
  skillNoArguments: '(none)',
  toolRefusedByMode: 'refused by the permission mode',
  shellRestrictedMode:
    'shell commands are disabled while the workspace is in Restricted Mode; trust the workspace to enable them',
  toolRejectedByUser: 'rejected by the user',
  // PLAN.md D26: what the model is told when Stop cuts a tool short.
  toolCancelledByStop: 'cancelled: the user stopped the turn',
  goalBudgetReached: 'cancelled: the goal token budget was reached',
  toolFileTooLarge: 'The file tools read and edit files up to',
  toolFileTooLargeHint:
    'read part of it with a shell command instead (the search tool skips files over 1 MiB)',
  // PLAN.md D27: what the Model API's file tools say when they will not write.
  fileHasUnsavedChanges:
    'has unsaved changes in an editor; ask the user to save or revert them, then try again',
  fileChangedSinceRead:
    'has changed since you last read it, or you have not read it yet; read it with read_file first so nothing is overwritten unseen',
  fileNotText:
    'is not UTF-8 text (binary, or another encoding such as UTF-16 or Latin-1), so it cannot be read or edited as text',
  compactionPrompt:
    'Summarise this conversation so far for your own future reference: the goal, the decisions, the files touched with what changed, open questions, and what to do next. Be complete but concise; use plain Markdown.',
  compactionPrefix: 'Summary of the conversation so far (the earlier messages were compacted):',
  steeredPrefix: '[The user added while you were working]',
  answersPrefix: 'The user answered:',
  questionCancelledOutput: 'The user declined to answer. Proceed with your best judgement.',
  replyContextLead:
    'The user is replying to this earlier output in the chat; treat their message as a direct response to it. It was written by',
  questionContextLead:
    'The user highlighted this passage of the conversation and is asking a question about it. It was written by',
  commentContextLead:
    'The user highlighted this passage of the conversation and is commenting on it. It was written by',
  referenceTruncated: '[… truncated to',
  referenceCharacters: 'characters]',
  selectionClipped: '[selection clipped]',
  selectionNotShared:
    'Its content is not shared because the file is excluded from the workspace index.',
  // A turn whose reply was reasoning alone (no text, no call): the reply
  // replayed after it, since a reasoning item must be followed by one
  // (dev.meta.ai/docs/protocols/responses, reasoning item ordering).
  reasoningOnlyReply: '(no reply text)',
  // M34: what the model is told when an image cannot be made.
  imageGenerationOff:
    'image generation is off; the user turns it on (it is paid) in the palette or the museSpark.modelApiImageGeneration setting',
  imagePathTaken: 'something already exists at that path; choose a new file name',
  // The user said no in the price confirmation (M44): nothing was bought.
  imageDeclined: 'the user declined to buy this image; nothing was bought or written',
  // M45 (PLAN.md D38): the goal loop on the Model API backend, in Muse Code's
  // own words where it has them (its 1.3.0 binary's goal messages).
  goalWake: 'Continue working toward the active session goal.',
  goalRequestSuperseded:
    'the user changed the goal after this request began; request the current goal before reporting progress',
  goalUnfinishedExists:
    'cannot create a new goal because this session has an unfinished goal; complete the existing goal first',
  goalPausedExists:
    "cannot create a new goal because this session's goal is paused; the user can resume it with /goal resume or replace it with /goal <objective>",
  goalNoActive: 'no active goal for this session',
  goalBadStatus: 'invalid status; expected complete or blocked',
  goalBadPercent: 'percent_complete must be between 0 and 100',
  goalEmptyWork: 'current_work and next_work must not be empty',
  goalEmptyObjective: 'objective must not be empty',
  goalObjectiveTooLong: 'objective is too long; the limit in characters is',
  goalBadBudget: 'token_budget must be a positive whole number',
  // M46 (PLAN.md D39): a command the user moved to the background, what the
  // model is told when it ends, a command the user ran from the prompt, and
  // an explanation given instead of an answer.
  shellMovedToBackground:
    'The user moved this command to the background, where it keeps running. Its output is added to the conversation when it ends; do not wait or poll for it, and go on with the task.',
  backgroundEndedLead: '[A command of yours that the user moved to the background has ended]',
  backgroundLostLead:
    '[A command of yours that ran in the background ended when its VS Code window closed; its output was not kept]',
  userShellLead:
    '[The user ran this shell command in the workspace themselves. Its output is context for you, not a request]',
  clarificationLead: 'The user chose none of the options and explained instead:',
  // M49 (PLAN.md D41): the memory tools' results and refusals in Muse Code's
  // own words (its 1.3.0 binary's strings, and the live capture of 2026-09-25).
  memoryNoteWritten: 'memory note written',
  memoryNoteEdited: 'memory note edited',
  memoryPathEmpty: 'memory path must not be empty',
  memoryPathAbsolute: 'absolute memory paths are not allowed',
  memoryPathTraversal: 'memory path traversal is not allowed',
  memoryPathHidden: 'hidden memory path components are not allowed',
  memoryPathNoFileName: 'memory path must include a file name',
  memoryPathNotMarkdown: 'memory path must be a Markdown .md file',
  memoryPathLink: 'memory path contains a symlink',
  memoryFileNotFound: 'memory file not found',
  memoryOffsetTooSmall: 'offset must be at least 1',
  memoryLimitTooSmall: 'limit must be at least 1',
  memoryOldStrEmpty: 'old_str must not be empty',
  memoryOldStrNotFound: 'old_str not found:',
  memoryOldStrAmbiguous: 'ambiguous old_str',
  // The extension's own, where Muse Code has no counterpart.
  memoryNoteExists: 'a memory note already exists at that path',
  memoryNoWorkspace: 'no workspace folder is open, so this scope has no memory',
  memoryNoHome: 'the home folder is unknown, so this scope has no memory',
  memoryRestrictedMode:
    'memory is not available while the workspace is in Restricted Mode; trust the workspace to use it',
} as const

// What the user reads, in the display language (PLAN.md D33).
export { UI_TEXT } from './l10n/text'
// The JSON script element the host writes into each webview's HTML with
// `{ locale, table }`, read before the first render (D33).
export const WEBVIEW_L10N_ELEMENT_ID = 'muse-l10n'

// Windows PowerShell as an absolute-path suffix under %SystemRoot%, for
// `createTerminal({ shellPath })` when running `muse login` / `muse logout`.
export const WINDOWS_POWERSHELL_TERMINAL_PATH = String.raw`\System32\WindowsPowerShell\v1.0\powershell.exe`
// The login / TUI terminal's shell off Windows (PLAN.md D25): POSIX syntax, always there.
export const POSIX_TERMINAL_SHELL = '/bin/sh'
