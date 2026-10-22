import { COMPANION_VOICE_RELEASE } from '../companionVoice'
// The generator's build entry: its imports are visible to the dead-code gate.
export {
  featureCatalog,
  COMMAND_REFERENCE,
  referenceDescription,
  REFERENCE_IN_PROGRESS_FEATURES,
} from '../featureCatalog'
export { COMMAND_IDS, SCHEDULE_EDITOR_DELIVERY_CERTIFICATION } from '../constants'
export { buildPalette } from '../paletteRegistry'
export { slashCommandsOf } from './slashReference'
export { cliCommands } from '../cliCommands'
export { EN } from '../l10n/en'
export { permissionModeDetail } from '../permissionModes'
export { referenceText } from './text'
export { fill } from '../l10n/text'
export { Usd } from '../usd'
export {
  ACP_AGENT_NAME,
  MUSE_VOICE_MAX_SECONDS,
  MUSE_VOICE_FRAME_MS,
  MUSE_VOICE_RESERVED_MS,
  PAID_FEATURE_SETTINGS,
  PAID_FEATURES,
  MUSE_CODE_PAID_FEATURES,
  ACP_PAID_FEATURES,
  ACP_PAID_FLAGS,
  SETTING_DEFAULTS,
  DEFAULT_EFFORT,
  MODEL_EFFORT_LEVELS,
  THINKING_OFF_EFFORT,
  MODEL_API_EFFORT_OFF,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_PDF_PAGE_IMAGES,
  EXEC_MODES,
  EXEC_OUTPUTS,
  EXEC_DEFAULT_MODE,
  EXEC_DEFAULT_OUTPUT,
  EXEC_MIN_OUTPUT_TOKENS,
  MODEL_API_MAX_OUTPUT_TOKENS,
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  ACP_CONFIG_IDS,
  PERMISSION_MODES,
  RULES_FILE_NAMES,
  SKILL_FILE_NAME,
  MEMORY_DIR_SEGMENTS,
  SHELL_SANDBOX_MODES,
  EFFORT_LEVELS,
  AGENT_FILE_NAME,
  PROJECT_AGENTS_DIR_SEGMENTS,
  PERSONAL_AGENTS_DIR_SEGMENTS,
} from '../constants'
export { parseGoalPrompt } from '../goalCommand'
export { parseReviewPrompt } from '../reviewCommand'
export { parseHandoffPrompt } from '../handoff'

// Reviewed host capability inventory: pairs are explicit, never a Cartesian claim.
// The tooling gate also checks tool/action coverage and host admission witnesses.
const companionCapabilities: [string, readonly string[]][] = COMPANION_VOICE_RELEASE.isReady
  ? [['companion-dictation', ['acp:museCode', 'acp:modelApi']]]
  : []
const capabilityPairs: readonly (readonly [string, readonly string[]])[] = [
  ...companionCapabilities,
  ['runtime-schedules', ['acp:museCode', 'acp:modelApi']],
  ['resources', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  ['providers', ['vscode:museCode', 'vscode:modelApi']],
  ...['strict-tools', 'parallel-reads', 'cut-short-tools', 'structured-side-calls'].map(
    (id): [string, readonly string[]] => [id, ['vscode:modelApi', 'acp:modelApi']],
  ),
  // M106 (C-M106-2): the selected model's record is bound in production, so
  // previews render in the panel and in ACP where that record verifies
  // streamed arguments.
  ['argument-preview', ['vscode:modelApi', 'acp:modelApi']],
  ...['service-status'].map((id): [string, readonly string[]] => [id, ['vscode:modelApi']]),
  // Lane RETRYLIMITS: the person's retry limit is a VS Code setting; the
  // documented per-provider bounds apply on every surface.
  ['retry-limits', ['vscode:modelApi']],
  ['native-deletion', ['vscode:museCode']],
  // C-M106-3: the note-only feedback dialog and the served effort tiers,
  // bound in the VS Code window (Muse Code backend).
  ['native-feedback', ['vscode:museCode']],
  ['effort', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  ['voice', ['vscode:museCode', 'vscode:modelApi']],
  ['output-schema', ['acp:modelApi']],
  ['fast-tier', ['vscode:modelApi', 'acp:modelApi']],
  // CM80CI: the four non-GitHub CI templates run headless Model API turns.
  ['ci-other-systems', ['acp:modelApi']],
  ['providers', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  ['usage', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  ['legal', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  ['legal-explanation', ['vscode:museCode', 'vscode:modelApi']],
  ['team-workers', []],
  ['team-configuration', ['vscode:modelApi', 'vscode:museCode']],
  ['auto-compaction', ['vscode:modelApi', 'acp:modelApi']],
  ['compaction', ['vscode:modelApi', 'acp:modelApi']],
  ['custom-agents', ['vscode:modelApi']],
  ['mcp-elicitation', ['vscode:modelApi']],
  ...[
    'best-of-n',
    'verify',
    'repo-map',
    'checkpoints',
    'rules',
    'schedules',
    'subagents',
    'auto',
    'hook-models',
    'cache',
    'judge',
  ].map((id): [string, readonly string[]] => [id, ['vscode:modelApi']]),
  // C-X-1: the shared daily budget also binds headless/ACP runs through the
  // runtime ledger, which reads the same paidDailyBudgetUsd setting.
  ['budget', ['vscode:modelApi', 'acp:modelApi']],
  ...['auto-subscription', 'native-agents', 'native-search-cron', 'judge-subscription'].map(
    (id): [string, readonly string[]] => [id, ['vscode:museCode']],
  ),
  ...[
    'attachments',
    'conversation-actions',
    'code-output',
    'code-intelligence',
    'shell',
    'session-board',
    'edit-review',
    'free-dictation',
    'chat',
    'account',
    'permissions',
    'history',
    'context',
    'skills',
    'imports',
    'memory',
    'mcp',
    'hooks',
    'git',
    'tasks',
    'exports',
    'review',
    'plans',
    'goals',
    'handoff',
    'browser',
    'tab',
  ].map((id): [string, readonly string[]] => [id, ['vscode:museCode', 'vscode:modelApi']]),
  ...['acp'].map((id): [string, readonly string[]] => [id, ['acp:museCode', 'acp:modelApi']]),
  ...['prompt-library', 'chat-sharing', 'resources', 'agent-outcomes', 'windows-paths'].map(
    (id): [string, readonly string[]] => [
      id,
      ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi'],
    ],
  ),
  // M112: ACP asks through forms or text and answers with /questions and /answer.
  ['questions', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  // D203: /playback runs on every surface on the Model API backend, answering
  // from memory only; on Muse Code it is refused, which has no zero-tool turn.
  ['playback', ['vscode:modelApi', 'acp:modelApi']],
  ['reports', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  // M99: ACP answers /whatsnew locally with the same release notes.
  ['support', ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi']],
  // M124: the MCP connector is a runtime command, the same for every editor.
  ['mcp-connector', ['acp:museCode', 'acp:modelApi']],
  // M116: CLI/ACP journal commands work; the VS Code panel has no mount.
  ['orchestrator-playbook', ['acp:museCode', 'acp:modelApi']],
  // M108 (CM108ACC): the terminal and ACP on the Model API backend list
  // accounts, show the current one and its thresholds, and hold per-account
  // keys; the editor's page, swapping and pooling are not bound.
  ['accounts', ['acp:modelApi']],
  // MSM109: the broker-backed panel and commands stay dormant while M109 is
  // in progress: no published surface until the lead's complete receipts.
  ['vault', []],
  // M117: the production plan snapshot port refuses on every surface.
  ['estimator', []],

  ...['web-fetch', 'images'].map((id): [string, readonly string[]] => [
    id,
    ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  ]),
  ...['search'].map((id): [string, readonly string[]] => [id, ['vscode:modelApi', 'acp:modelApi']]),
  // TOOLCAP: the per-result bound on the Model API backend, every surface.
  ...['tool-result-bound'].map((id): [string, readonly string[]] => [
    id,
    ['vscode:modelApi', 'acp:modelApi'],
  ]),
  // M105 lane F: Delete Uploaded Files and ACP /uploads over the account
  // ledger, where the Model API backend runs.
  ...['uploads'].map((id): [string, readonly string[]] => [
    id,
    ['vscode:modelApi', 'acp:modelApi'],
  ]),
]
export const REFERENCE_CAPABILITIES = Object.fromEntries<readonly string[]>(capabilityPairs)
export const REFERENCE_FEATURE_IDS = Object.keys(REFERENCE_CAPABILITIES)
export { referenceKeyboardActions, WEBVIEW_KEYBINDINGS, webviewKey } from '../keybindings'
export const REFERENCE_ACTION_FEATURES = {
  openUsagePage: 'usage',
  startWithOwnModel: 'providers',
  addModelProvider: 'providers',
  manageModels: 'providers',
  openTeamTaskTranscript: 'team-workers',
  stopTeamTask: 'team-workers',
  reviewTeamDiff: 'team-workers',
  decideTeamMerge: 'team-workers',
  answerTeamWaiting: 'team-workers',
  openTeamRoles: 'team-workers',
  resetTeamEntry: 'team-workers',
  stopAllTeamTasks: 'team-workers',
  requestLegalExplanation: 'legal-explanation',
  exportLegalReport: 'legal',
  sharingAction: 'prompt-library',
  runReport: 'reports',
  resourceAction: 'resources',
  resourcePull: 'resources',
  resourceOpenAck: 'resources',
  openSettings: 'support',
  openKeybindings: 'support',
  openLog: 'support',
  toggleFocusView: 'chat',
  toggleCtrlEnterToSend: 'chat',
  hideOnboarding: 'chat',
  reload: 'support',
  openMuseSettings: 'chat',
  manageSkills: 'skills',
  importSkills: 'skills',
  importFromAgents: 'imports',
  showMcpServers: 'mcp',
  showHooks: 'hooks',
  showMemory: 'memory',
  newWorktree: 'git',
  removeWorktree: 'git',
  openPullRequestInConversation: 'git',
  restartMuseCode: 'chat',
  openModelApiStatus: 'service-status',
  openTasksTab: 'chat',
  installBundledSkills: 'skills',
  updateBundledSkills: 'skills',
  declineBundledSkills: 'skills',
  showWhatsNew: 'chat',

  readReference: 'support',
  openReferenceSetting: 'support',
  runReferenceCommand: 'support',
  ready: 'chat',
  inputFocusChanged: 'chat',
  surfaceFocused: 'chat',
  webviewError: 'chat',
  sendMessage: 'chat',
  withdrawQueued: 'chat',
  runManualHook: 'hooks',
  cancelTurn: 'chat',
  signIn: 'account',
  installMuseCode: 'account',
  cancelSignIn: 'account',
  signOut: 'chat',
  retryBackend: 'chat',
  openExternal: 'chat',
  setModel: 'chat',
  setEffort: 'chat',
  setThinking: 'chat',
  setFast: 'chat',
  previewFeedback: 'native-feedback',
  submitFeedback: 'native-feedback',
  setPermissionMode: 'chat',
  clearConversation: 'conversation-actions',
  compact: 'chat',
  requestHandoff: 'chat',
  confirmHandoff: 'chat',
  cancelHandoff: 'chat',
  goalCommand: 'goals',
  scheduleCreate: 'schedules',
  scheduleList: 'schedules',
  scheduleCancel: 'schedules',
  scheduleRun: 'schedules',
  schedulesRequest: 'schedules',
  openSchedules: 'schedules',
  exportConversation: 'conversation-actions',
  importSession: 'conversation-actions',
  openShareFile: 'exports',
  listSkills: 'skills',
  searchMentions: 'chat',
  pickFile: 'chat',
  pickMentionFile: 'chat',
  attachImageData: 'attachments',
  removeAttachment: 'attachments',
  droppedUris: 'chat',
  hostAction: 'chat',
  decideApproval: 'chat',
  cancelQuestion: 'questions',
  estimateRun: 'estimator',
  estimateCommand: 'estimator',
  estimateSpinUp: 'estimator',
  elicitationAnswer: 'mcp-elicitation',
  answerQuestion: 'questions',
  clarifyQuestion: 'questions',
  moveToBackground: 'chat',
  stopTask: 'chat',
  stopAllTasks: 'chat',
  runUserShell: 'chat',
  readOutput: 'code-output',
  readToolImage: 'chat',
  openOutput: 'code-output',
  copyText: 'chat',
  insertCode: 'code-output',
  applyCode: 'code-output',
  openEditDiff: 'chat',
  revertEdit: 'chat',
  openFile: 'chat',
  rewindCode: 'conversation-actions',
  startReview: 'review',
  readReviewChanges: 'review',
  revertReviewHunk: 'review',
  startPlayback: 'playback',
  restoreFiles: 'chat',
  redoRestore: 'chat',
  listSessions: 'conversation-actions',
  requestSessionBoard: 'conversation-actions',
  activateBoardSession: 'conversation-actions',
  startBestOfN: 'best-of-n',
  takeBestOfNAttempt: 'best-of-n',
  openBestOfNAttempt: 'best-of-n',
  cancelBestOfN: 'best-of-n',
  readChildSession: 'conversation-actions',
  subagentControl: 'native-agents',
  subagentMessage: 'native-agents',
  resumeSession: 'conversation-actions',
  setSessionArchived: 'conversation-actions',
  deleteSession: 'conversation-actions',
  forkSession: 'conversation-actions',
  openSideChat: 'chat',
  savePlan: 'plans',
  implementPlan: 'plans',
  showPlans: 'plans',
  renameSession: 'conversation-actions',
  readUsage: 'chat',
  deleteUploadedFile: 'uploads',
  deleteAllUploadedFiles: 'uploads',
  dictation: 'chat',
  setPaidFeature: 'budget',
  forgetPaidUse: 'budget',
  gitAction: 'git',
  gitCommit: 'git',
  gitCreatePullRequest: 'git',
  openReport: 'chat',
  updateReport: 'chat',
  exportReport: 'chat',
  reportWebviewError: 'chat',
}
export { HOST_ACTIONS } from '../protocol'
export {
  PAID_PRICES_USD,
  MODEL_API_PRICES_PER_MILLION,
  MODEL_API_PRICED_MODELS,
  PAID_DAILY_BUDGET,
  CODE_INTEL_TOOLS,
  IDE_CODE_INTEL_TOOLS,
  SCHEDULE_DEFAULT_INTERVAL_MS,
  DICTATION_KEY,
} from '../constants'
export {
  MSP_FRAME_LIMIT_BYTES,
  BUILTIN_AGENT_EXPLORE_ID,
  BUILTIN_AGENT_SECOND_OPINION_ID,
} from '../constants'
export {
  TEXT_ATTACHMENT_EXTENSIONS,
  MODEL_API_TEXT_BUDGET_TOKENS,
  MSP_ATTACHMENT_FRAME_BUDGET_BYTES,
  CONTEXT_PRESSURE_MEDIUM,
  CONTEXT_PRESSURE_HIGH,
  MILLISECONDS_PER_SECOND,
  TIMER_MAX_DELAY_MS,
} from '../constants'

export {
  SCHEDULE_MIN_INTERVAL_MS,
  SCHEDULE_MAX_INTERVAL_MS,
  SCHEDULE_MAX_PROMPT_CHARS,
  SCHEDULE_MAX_JOBS_PER_SESSION,
  RESUME_SKILL_SELECTORS,
  EXPORT_FORMATS,
  EXEC_USD_DECIMALS,
  EXEC_UNTRUSTED_FILES_MAX,
  EXEC_UNTRUSTED_FILE_MAX_BYTES,
  EXEC_UNTRUSTED_TOTAL_MAX_BYTES,
  EXEC_PROMPT_MAX_BYTES,
  QUESTION_DEFER_DEFAULT_SECONDS,
} from '../constants'

export { MODEL_API_TOOLS, MODEL_API_SUBAGENT_TOOLS, VERIFY_TOOLS } from '../constants'
export const REFERENCE_TOOL_FEATURES: Readonly<Record<string, string>> = {
  legal_scan: 'legal',
  read_file: 'attachments',
  write_file: 'chat',
  edit_file: 'edit-review',
  search: 'chat',
  list_files: 'chat',
  bash: 'shell',
  powershell: 'shell',
  ask_user: 'questions',
  todo_write: 'tasks',
  read_skill: 'skills',
  generate_image: 'images',
  edit_image: 'images',
  create_goal: 'goals',
  get_goal: 'goals',
  update_goal: 'goals',
  report_progress: 'goals',
  read_memory: 'memory',
  add_memory: 'memory',
  edit_memory: 'memory',
  recall_output: 'code-output',
  web_fetch: 'web-fetch',
  browser_check: 'browser',
  subagent_spawn: 'subagents',
  subagent_status: 'subagents',
  subagent_wait: 'subagents',
  subagent_send_message: 'subagents',
  subagent_read_result: 'subagents',
  subagent_cancel: 'subagents',
  run_checks: 'verify',
  verify_edits: 'verify',
}

export { LINUX_RECORDERS } from '../constants'

export { CLI_OPTION_REGISTRY, CLI_OPTION_TEXT } from '../../runtime/cliOptions'
export { SLASH_REFERENCE } from './slashReference'

export { PAID_USE_REGISTRY, isPaidSettingOn } from '../paid'

export { resolveSettingDefault, resolveCommandCondition } from './resolvers'

export { REFERENCE_POOL_RADIX } from '../constants'
