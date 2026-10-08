import { PAID_USE_REGISTRY } from './paid'
// HELPREF: reviewed feature relationships. The generator validates every id
// against the manifest and reuses its translated text and the palette's tips.
import { COMMAND_IDS, type SETTING_DEFAULTS, PROMPT_COMMAND_IDS, UI_TEXT } from './constants'
import type { UiText } from './l10n/en'

type PlainReferenceText =
  | { readonly fallbackKey: string; readonly fallback: string }
  | { readonly cli: keyof UiText['referenceCliOptions'] }
  | { readonly ui: { [K in keyof UiText]: UiText[K] extends string ? K : never }[keyof UiText] }
  | { readonly tip: keyof UiText['paletteTips'] }
  | { readonly setting: string }
  | { readonly command: string }

export type ReferenceText =
  | PlainReferenceText
  | {
      readonly conditions: readonly {
        /** Technical selector; the description explains each of its states. */
        readonly when: string
        readonly text: PlainReferenceText
      }[]
    }

// Conditional descriptions must opt into a typed field, never a content heuristic.
const UI_CONDITIONS: Readonly<
  Partial<Record<Extract<PlainReferenceText, { ui: unknown }>['ui'], string>>
> = {
  referenceNativeAgentsConditions: 'run.subagent_delegation_mode',
  resourceCpuMaxPercentDescription: 'resourceCpuThreshold',
  resourceMemoryMaxPercentDescription: 'resourceMemoryThreshold',
  providerOpenRouterServices: 'openRouterServices=absent',
  referenceSandbox: 'platform=win32&shellSandbox',
  autoCompactionAwaitingEvaluation: 'autoCompactionEvaluation',
  referenceBrowser: 'workspaceTrust',
  referenceBestOfNRequirements: 'bestOfNAdmission',
  referenceSecretPrompt: 'secretDetected',
  referenceTabMenu: 'copilotYield',
  referenceConversationActions: 'turnState',
  referencePermissionLimits: 'backend&permissionMode&autoReviewer',
  museCodeReviewerNotice: 'permissionMode=auto&museCodeAutoReviewer=true',
  gitCommitItemDetail: 'userRequestedMessage',
  referenceDictation: 'platform&localWindow',
  referenceVoice: 'backend&localWindow&voiceAdmission',
  referenceBundled: 'backend',
  mcpRestartDetail: 'turnState',
}
const NLS_CONDITIONS: Readonly<Partial<Record<string, string>>> = {
  'config.reports.network.enumDescriptions.whenSignedIn': 'reportsNetwork&githubSignIn',
  'config.backend.enumDescriptions.auto': 'backendAvailability',
  'config.resourceRelocate.enumDescriptions.paired': 'resourceRelocation',
  'config.browserCheckRuntime.enumDescriptions.download': 'browserRuntimeAcquisition',
  'config.tabMultiline.enumDescriptions.auto': 'multilineMode',
  'config.tabTrigger.enumDescriptions.onInvoke': 'tabTrigger',
  'config.judge.engine.enumDescriptions.auto': 'judgeEngine',
}
const SETTING_CONDITIONS: Readonly<
  Partial<
    Record<
      | keyof typeof SETTING_DEFAULTS
      | 'resourceCpuMaxPercent'
      | 'resourceMemoryMaxPercent'
      | 'resourceGpuMaxPercent'
      | 'resourceDiskBusyMaxPercent'
      | 'resourceDiskMinFreeGiB'
      | 'resourceRelocate',
      string
    >
  >
> = {
  'reports.network': 'reportsNetwork&githubSignIn',
  preferredLocation: 'activeConversation',
  archiveInactiveSessions: 'sessionIdle',
  cleanupPeriodDays: 'sessionList',
  sandboxNetwork: 'shellSandbox',
  browserCheckExtraHosts: 'browserNetworkAdmission',
  notifyOnBackgroundTurn: 'turnState&windowFocus',
  modelApiSessionBudgetUsd: 'sessionBudget',

  modelApiObservationPacking: 'conversationStart',
  modelApiAutoCompaction: 'conversationStart&modelPricing',
  modelApiStrictTools: 'conversationStart&tools.strict',
  modelApiParallelReads: 'conversationStart',
  webSearchMaxPerRequest: 'conversationStart&hosted.webSearch',
  showWhatsNewOnUpdate: 'releaseHighlights',
  modelApiPermissionProfile: 'permissionProfile',
  tabLanguages: 'language',
  tabMultiline: 'multilineMode',
  tabTrigger: 'tabTrigger',
  'shell.passEnvironmentVariables': 'backend=modelApi&shellOrigin=interactive',
  resourceCpuMaxPercent: 'resourceThreshold',
  resourceMemoryMaxPercent: 'resourceThreshold',
  resourceGpuMaxPercent: 'resourceThreshold',
  resourceDiskBusyMaxPercent: 'resourceThreshold',
  resourceDiskMinFreeGiB: 'resourceDiskThreshold',
  resourceRelocate: 'resourceRelocation',
  modelApiVoice: 'voiceAdmission',
  bundledSkills: 'backend&skillInstallation',
  // M109: the fence description names the off state (workers stay fenced),
  // and the screen-lock description the reported-lock state.
  'vault.agentFence': 'shellOrigin=interactive&agentFence',
  'vault.lockOnScreenLock': 'screenLock',
}

/** The generator uses these explicit selectors on every description surface. */
export function referenceDescription(text: ReferenceText): ReferenceText {
  if ('conditions' in text) return text
  const settingConditions: Readonly<Partial<Record<string, string>>> = SETTING_CONDITIONS
  let when: string | undefined
  if ('ui' in text) when = UI_CONDITIONS[text.ui]
  else if ('fallbackKey' in text) when = NLS_CONDITIONS[text.fallbackKey]
  else if ('setting' in text) when = settingConditions[text.setting]
  else if ('cli' in text) {
    switch (text.cli) {
      case 'cpu-max':
      case 'memory-max': {
        when = 'resourceThreshold'
        break
      }
      case 'fail-on-denial': {
        when = 'permission=denied'
        break
      }
      case 'no-auto-compaction': {
        when = 'autoCompactionEvaluation'
        break
      }
      case 'private-ok': {
        when = 'privateNetwork'
        break
      }
      default: {
        when = undefined
      }
    }
  }
  return when === undefined ? text : { conditions: [{ when, text }] }
}

interface Feature {
  readonly id: string
  readonly name: ReferenceText
  readonly summary: ReferenceText
  readonly description: ReferenceText
  readonly commands: readonly string[]
  readonly settings: readonly string[]
  readonly docs: string
  readonly editors: readonly ('vscode' | 'acp')[]
  readonly backends: readonly ('museCode' | 'modelApi')[]
  readonly paid: boolean
  readonly surfaces: readonly string[]
  readonly details: readonly ReferenceText[]
  readonly facts: Readonly<Record<string, unknown>>
}

type CommandKey = keyof typeof COMMAND_IDS
interface CommandReference {
  readonly description: ReferenceText
  /** No spending, destructive change, or dependence on a chat/editor selection. */
  readonly canRun: boolean
}

export const COMMAND_REFERENCE: Readonly<Record<CommandKey, CommandReference>> = {
  openUsagePage: { description: { ui: 'paletteUsagePage' }, canRun: true },
  legalScan: { description: { ui: 'legalScanItemDetail' }, canRun: false },
  connectChatGpt: { description: { ui: 'startWithOwnModelDetail' }, canRun: false },
  connectCopilot: { description: { ui: 'startWithOwnModelDetail' }, canRun: false },
  openInSidebar: { description: { ui: 'referenceSidebar' }, canRun: true },
  openInNewTab: { description: { ui: 'referenceNewTab' }, canRun: true },
  focusInput: { description: { ui: 'referenceFocus' }, canRun: false },
  openTasks: { description: { ui: 'referenceTasks' }, canRun: false },
  insertMentionReference: { description: { tip: 'mentionFile' }, canRun: false },
  toggleFocusView: { description: { tip: 'focusView' }, canRun: false },
  toggleThinking: { description: { ui: 'referenceThinking' }, canRun: false },
  setUpSandbox: { description: { ui: 'referenceSandbox' }, canRun: false },
  showLogs: { description: { tip: 'log' }, canRun: true },
  diagnostics: { description: { ui: 'referenceDiagnostics' }, canRun: true },
  reportProblem: { description: { ui: 'referenceReport' }, canRun: true },
  showReport: { description: { ui: 'reportSlashDescription' }, canRun: true },
  estimate: { description: { ui: 'referenceEstimate' }, canRun: true },
  newConversation: { description: { tip: 'clear' }, canRun: false },
  signOut: { description: { tip: 'signOut' }, canRun: false },
  openInTerminal: { description: { ui: 'referenceTerminal' }, canRun: false },
  createRulesFile: { description: { ui: 'referenceRules' }, canRun: false },
  openWalkthrough: { description: { ui: 'referenceWalkthrough' }, canRun: true },
  manageSkills: { description: { tip: 'manageSkills' }, canRun: false },
  importSkills: { description: { tip: 'importSkills' }, canRun: false },
  importFromAgents: { description: { ui: 'agentImportDetailEvery' }, canRun: false },
  exportConversation: { description: { tip: 'export' }, canRun: false },
  importSession: { description: { tip: 'importSession' }, canRun: false },
  openShareFile: { description: { tip: 'openShare' }, canRun: false },
  mcpServers: { description: { ui: 'referenceMcp' }, canRun: false },
  hooks: { description: { tip: 'hooks' }, canRun: false },
  runSetupHooks: { description: { ui: 'referenceSetup' }, canRun: false },
  runHook: { description: { tip: 'hookRun' }, canRun: false },
  retryPluginHooks: { description: { ui: 'referenceRetry' }, canRun: false },
  memory: { description: { tip: 'memory' }, canRun: false },
  newWorktree: { description: { tip: 'newWorktree' }, canRun: false },
  removeWorktree: { description: { tip: 'removeWorktree' }, canRun: false },
  moveToBackground: { description: { ui: 'moveToBackgroundTitle' }, canRun: false },
  stopBackgroundTasks: { description: { ui: 'stopAllTasksTitle' }, canRun: false },
  restartMuseCode: { description: { ui: 'mcpRestartDetail' }, canRun: false },
  installBundledSkills: { description: { ui: 'referenceInstallSkills' }, canRun: false },
  removeBundledSkills: { description: { ui: 'referenceRemoveSkills' }, canRun: false },
  downloadBrowserCheckRuntime: { description: { ui: 'referenceBrowserDownload' }, canRun: false },
  showWhatsNew: { description: { tip: 'whatsNew' }, canRun: true },
  tabTurnOn: { description: { ui: 'referenceTabOn' }, canRun: false },
  tabTurnOff: { description: { ui: 'referenceTabOff' }, canRun: false },
  tabSnooze: { description: { ui: 'referenceTabSnooze' }, canRun: false },
  tabMenu: { description: { ui: 'referenceTabMenu' }, canRun: false },
  tabLanguages: { description: { ui: 'referenceTabLanguages' }, canRun: false },
  openPullRequestInConversation: { description: { ui: 'gitCheckoutItemDetail' }, canRun: false },
  startWithOwnModel: { description: { command: COMMAND_IDS.startWithOwnModel }, canRun: false },
  modelsAndAgents: { description: { command: COMMAND_IDS.modelsAndAgents }, canRun: true },
  addModelProvider: { description: { command: COMMAND_IDS.addModelProvider }, canRun: false },
  savePrompt: { description: { ui: 'promptSecretsNote' }, canRun: false },
  useSavedPrompt: { description: { ui: 'promptRun' }, canRun: false },
  promptLibrary: { description: { ui: 'promptLibrary' }, canRun: true },
  copyToMyPrompts: { description: { ui: 'promptScopeUser' }, canRun: false },
  sharePrompt: { description: { ui: 'shareReviewPrivacy' }, canRun: false },
  shareChat: { description: { ui: 'shareReviewPrivacy' }, canRun: false },
  openHelp: { description: { ui: 'referenceIntro' }, canRun: true },
  attachScreenRecording: { description: { ui: 'referenceScreenRecording' }, canRun: false },
  attachLatestScreenRecording: { description: { ui: 'referenceLatestRecording' }, canRun: false },
  deleteUploadedFiles: { description: { ui: 'referenceUploadedFiles' }, canRun: false },
  nextOpenQuestion: { description: { ui: 'questionNextOpen' }, canRun: false },
  previousOpenQuestion: { description: { ui: 'questionPreviousOpen' }, canRun: false },
  schedulePrompt: { description: { tip: 'schedulePrompt' }, canRun: true },
  showSchedules: { description: { tip: 'schedule' }, canRun: true },
  showScheduleTimeline: { description: { tip: 'scheduleTimeline' }, canRun: true },
  vault: { description: { ui: 'referenceVaultPanel' }, canRun: false },
  lockVault: { description: { ui: 'referenceVaultLock' }, canRun: false },
}

function feature(
  id: string,
  name: ReferenceText,
  summary: ReferenceText,
  commands: readonly CommandKey[],
  settings: readonly string[],
  docs: string,
  backends: Feature['backends'] = ['museCode', 'modelApi'],
  isPaid = false,
  editors: Feature['editors'] = ['vscode'],
): Feature {
  return {
    id,
    name,
    summary,
    description: summary,
    commands: commands.map((key) => COMMAND_IDS[key]),
    settings: settings.map((key) => `museSpark.${key}`),
    docs: `https://github.com/RandyNorthrup/muse-spark-code#${docs}`,
    backends,
    paid: isPaid,
    surfaces: editors.flatMap((editor) => backends.map((backend) => `${editor}:${backend}`)),
    details: [],
    facts: {},
    editors,
  }
}

export function featureCatalog(): readonly Feature[] {
  return [
    feature(
      'resources',
      { ui: 'resourceTitle' },
      { ui: 'referenceResources' },
      [],
      [
        'resourceGovernor',
        'resourceCpuMaxPercent',
        'resourceMemoryMaxPercent',
        'resourceMemoryMinFreeGiB',
        'resourceGpuMaxPercent',
        'resourceDiskBusyMaxPercent',
        'resourceDiskMinFreeGiB',
        'resourceRelocate',
      ],
      'keeping-your-machine-responsive',
      undefined,
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'agent-outcomes',
      { ui: 'agentReceipt' },
      { ui: 'referenceAgentOutcomes' },
      [],
      [],
      'agent-outcomes',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'providers',
      { ui: 'modelsPanelTitle' },
      { ui: 'startWithOwnModelDetail' },
      [
        'startWithOwnModel',
        'modelsAndAgents',
        'addModelProvider',
        'connectChatGpt',
        'connectCopilot',
      ],
      ['suggestedProvider'],
      'backends',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'reports',
      { ui: 'reportShowCommand' },
      { ui: 'reportSlashDescription' },
      ['showReport'],
      ['reports.network', 'reports.keepHistory', 'reports.agentSources'],
      'report',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'prompt-library',
      { ui: 'promptLibrary' },
      { ui: 'referencePromptMenu' },
      ['savePrompt', 'useSavedPrompt', 'promptLibrary', 'copyToMyPrompts'],
      ['syncPromptsAndBookmarks'],
      'sharing',
      undefined,
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'usage',
      { ui: 'usagePageTitle' },
      { ui: 'paletteUsagePage' },
      ['openUsagePage'],
      ['usageHistory', 'usageHistoryDays'],
      'usage-and-cost',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'team-workers',
      { ui: 'paidTeamWorkersName' },
      { setting: 'modelApiTeamWorkers' },
      [],
      ['modelApiTeamWorkers'],
      'the-panel',
      ['modelApi'],
      true,
    ),
    feature(
      'legal',
      { ui: 'legalScanTitle' },
      { ui: 'legalScanItemDetail' },
      ['legalScan'],
      ['legalHeaderPolicy', 'legalRegistryLookups'],
      'legal-scan-m97',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'legal-explanation',
      { ui: 'paidLegalExplanationName' },
      { ui: 'legalExplainConfirm' },
      [],
      ['legalExplanation'],
      'legal-scan-m97',
      ['museCode', 'modelApi'],
      true,
    ),
    feature(
      'compaction',
      { ui: 'compactItem' },
      { ui: 'autoCompactionAwaitingEvaluation' },
      [],
      ['modelApiAutoCompaction'],
      'observation-packing-model-api',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'chat-sharing',
      { ui: 'shareChat' },
      { ui: 'shareReviewPrivacy' },
      ['shareChat', 'sharePrompt'],
      [],
      'sharing',
      undefined,
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'best-of-n',
      { ui: 'bestOfNTitle' },
      { ui: 'referenceBestOfN' },
      [],
      ['modelApiBestOfN'],
      'session-board-and-best-of-n',
      ['modelApi'],
      true,
    ),
    feature(
      'auto-subscription',
      { ui: 'permissionModeItem' },
      { ui: 'museCodeReviewerNotice' },
      [],
      ['museCodeAutoReviewer'],
      'permission-modes',
      ['museCode'],
    ),
    feature(
      'native-agents',
      { ui: 'agentsCommand' },
      { ui: 'referenceNativeAgents' },
      [],
      [],
      'the-panel',
      ['museCode'],
    ),
    feature(
      'native-search-cron',
      { ui: 'paidWebSearchName' },
      { ui: 'referenceNativeSearch' },
      [],
      [],
      'paid-features',
      ['museCode'],
    ),
    feature(
      'attachments',
      { ui: 'attachmentsLabel' },
      { ui: 'referenceAttachments' },
      ['attachScreenRecording', 'attachLatestScreenRecording', 'deleteUploadedFiles'],
      [
        'mediaMaxUploadMiB',
        'mediaUploadExpiryDays',
        'screenRecordingMaxSeconds',
        'mediaAudioAction',
      ],
      'the-panel',
    ),
    feature(
      'strict-tools',
      { setting: 'modelApiStrictTools' },
      { setting: 'modelApiStrictTools' },
      [],
      ['modelApiStrictTools'],
      'agent-loop-guarantees',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'parallel-reads',
      { setting: 'modelApiParallelReads' },
      { setting: 'modelApiParallelReads' },
      [],
      ['modelApiParallelReads'],
      'agent-loop-guarantees',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'auto-compaction',
      { setting: 'modelApiAutoCompaction' },
      { setting: 'modelApiAutoCompaction' },
      [],
      ['modelApiAutoCompaction'],
      'agent-loop-guarantees',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'argument-preview',
      { ui: 'toolArgumentPreviewLabel' },
      { ui: 'toolArgumentPreviewPending' },
      [],
      [],
      'agent-loop-guarantees',
      ['modelApi'],
    ),
    feature(
      'cut-short-tools',
      { ui: 'incompleteToolCallsNotRun' },
      { ui: 'incompleteToolCallsNotRun' },
      [],
      [],
      'agent-loop-guarantees',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'structured-side-calls',
      { ui: 'structuredOutputRepair' },
      { ui: 'structuredOutputFallback' },
      [],
      [],
      'agent-loop-guarantees',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'output-schema',
      { cli: 'output-schema' },
      { cli: 'output-schema' },
      [],
      [],
      'headless-runs',
      ['modelApi'],
      false,
      ['acp'],
    ),
    feature(
      'service-status',
      { ui: 'modelApiStatusLabel' },
      { ui: 'modelApiStatusOpen' },
      [],
      [],
      'agent-loop-guarantees',
      ['modelApi'],
    ),
    feature(
      'native-deletion',
      { ui: 'memoryDeleteAction' },
      { ui: 'historyLabel' },
      [],
      [],
      'agent-loop-guarantees',
      ['museCode'],
    ),
    feature('effort', { ui: 'effortItem' }, { tip: 'effort' }, [], [], 'the-panel'),
    feature(
      'custom-agents',
      { ui: 'agentsCommand' },
      { ui: 'referenceCustomAgents' },
      [],
      [],
      'the-panel',
      ['modelApi'],
    ),
    feature(
      'conversation-actions',
      { ui: 'transcriptLabel' },
      { ui: 'referenceConversationActions' },
      [],
      [],
      'the-panel',
    ),
    feature('code-output', { ui: 'copyCode' }, { ui: 'referenceCodeOutput' }, [], [], 'the-panel'),
    // ACP queued late answers retire only at model start (request admission on Model API).
    feature(
      'questions',
      { ui: 'questionSubmit' },
      { ui: 'referenceQuestionsDeferral' },
      ['nextOpenQuestion', 'previousOpenQuestion'],
      ['questions.deferAfterSeconds'],
      'questions',
      undefined,
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'mcp-elicitation',
      { ui: 'referenceElicitationTitle' },
      { ui: 'referenceElicitation' },
      [],
      [],
      'the-panel',
      ['modelApi'],
    ),
    feature(
      'acp',
      { ui: 'helpReferenceTitle' },
      { ui: 'referenceAcp' },
      [],
      [],
      'help-and-reference',
      undefined,
      false,
      ['acp'],
    ),
    feature(
      'web-fetch',
      { ui: 'referenceWebFetchTitle' },
      { ui: 'referenceWebFetchDetail' },
      [],
      [],
      'web-fetch',
    ),
    feature(
      'code-intelligence',
      { ui: 'referenceCodeIntelTitle' },
      { ui: 'referenceCodeIntelDetail' },
      [],
      [],
      'code-intelligence',
      undefined,
      false,
      ['vscode'],
    ),
    feature('shell', { ui: 'composerShellMode' }, { ui: 'referenceShellDetail' }, [], [], 'tasks'),
    feature(
      'session-board',
      { ui: 'boardTitle' },
      { ui: 'referenceBoardDetail' },
      [],
      [],
      'session-board-and-best-of-n',
      undefined,
      false,
      ['vscode'],
    ),
    feature(
      'edit-review',
      { ui: 'reviewChangesItem' },
      { ui: 'reviewChangesDetail' },
      [],
      [],
      'review',
      undefined,
      false,
      ['vscode'],
    ),
    feature(
      'free-dictation',
      { ui: 'dictationLabel' },
      { ui: 'referenceDictation' },
      [],
      [],
      'voice-dictation',
      undefined,
      false,
      ['vscode'],
    ),
    feature(
      'chat',
      { ui: 'transcriptLabel' },
      { ui: 'referenceNewTab' },
      [
        'openInSidebar',
        'openInNewTab',
        'focusInput',
        'newConversation',
        'insertMentionReference',
        'toggleFocusView',
        'toggleThinking',
      ],
      [
        'preferredLocation',
        'autosave',
        'attachOpenFile',
        'useCtrlEnterToSend',
        'hideOnboarding',
        'focusView',
        'enableNewConversationShortcut',
      ],
      'the-panel',
      undefined,
      false,
      ['vscode'],
    ),
    feature(
      'account',
      { ui: 'groupAccount' },
      { tip: 'accountUsage' },
      ['signOut', 'restartMuseCode', 'openInTerminal'],
      [
        'backend',
        'museBinaryPath',
        'environmentVariables',
        'modelApiReplyUsage',
        'modelApiSessionBudgetUsd',
        'confidentialWorkspace',
      ],
      'get-started',
    ),
    {
      ...feature(
        'accounts',
        { ui: 'referenceAccountsTitle' },
        { ui: 'referenceAccounts' },
        [],
        ['accountSwap', 'accountParallel', 'accounts.severalOnThisDevice'],
        'several-accounts-per-provider',
        undefined,
        false,
        ['vscode', 'acp'],
      ),
      details: [{ ui: 'referenceDeveloper' }] as const,
    },
    feature(
      'permissions',
      { ui: 'permissionModeItem' },
      { tip: 'permissionMode' },
      ['setUpSandbox'],
      [
        'initialPermissionMode',
        'allowDangerouslySkipPermissions',
        'shellSandbox',
        'sandboxNetwork',
        'shell.passEnvironmentVariables',
      ],
      'permission-modes',
    ),
    feature(
      'history',
      { ui: 'resumeItem' },
      { tip: 'resume' },
      [],
      ['archiveInactiveSessions', 'cleanupPeriodDays'],
      'the-panel',
    ),
    feature(
      'context',
      { ui: 'mentionFile' },
      { tip: 'mentionFile' },
      ['createRulesFile'],
      ['respectGitIgnore'],
      'rules-skills-and-memory',
    ),
    feature(
      'skills',
      { ui: 'groupSkills' },
      { ui: 'referenceSkills' },
      ['manageSkills', 'importSkills', 'installBundledSkills', 'removeBundledSkills'],
      ['bundledSkills'],
      'bundled-skills',
    ),
    feature(
      'imports',
      { command: COMMAND_IDS.importFromAgents },
      { ui: 'agentImportDetailEvery' },
      ['importFromAgents'],
      [],
      'rules-skills-and-memory',
    ),
    feature('memory', { ui: 'memoryItem' }, { tip: 'memory' }, ['memory'], [], 'memory'),
    feature(
      'mcp',
      { ui: 'mcpItem' },
      { ui: 'referenceMcp' },
      ['mcpServers'],
      [],
      'rules-skills-and-memory',
    ),
    feature(
      'hooks',
      { ui: 'hooksItem' },
      { ui: 'hooksItemDetail' },
      ['hooks', 'runSetupHooks', 'runHook', 'retryPluginHooks'],
      ['modelApiHooks', 'hookHttpAllowedHosts', 'modelApiShellKeepsDirectory'],
      'hooks',
    ),
    feature(
      'git',
      { ui: 'groupGit' },
      { tip: 'newWorktree' },
      ['newWorktree', 'removeWorktree', 'openPullRequestInConversation'],
      [],
      'git-and-pull-requests',
    ),
    feature(
      'tasks',
      { ui: 'backgroundTasksLabel' },
      { ui: 'moveToBackgroundTitle' },
      ['openTasks', 'moveToBackground', 'stopBackgroundTasks'],
      ['notifyOnBackgroundTurn'],
      'tasks',
    ),
    feature(
      'exports',
      { ui: 'exportJsonItem' },
      { tip: 'exportJson' },
      ['exportConversation', 'importSession', 'openShareFile'],
      [],
      'the-panel',
    ),
    feature('review', { ui: 'groupReview' }, { tip: 'review' }, [], [], 'review'),
    feature('plans', { ui: 'plansItem' }, { tip: 'plans' }, [], [], 'plans-as-files'),
    feature('goals', { ui: 'goalItem' }, { tip: 'goal' }, [], [], 'session-goals'),
    feature(
      'handoff',
      { ui: 'handoffItem' },
      { tip: 'handoff' },
      [],
      [],
      'handoff-to-a-new-conversation',
    ),
    feature(
      'verify',
      { command: COMMAND_IDS.diagnostics },
      { setting: 'diagnosticsAfterEdits' },
      [],
      ['diagnosticsAfterEdits', 'checkCommands', 'formatOnEdit'],
      'checking-edits',
      ['modelApi'],
    ),
    feature(
      'repo-map',
      { setting: 'modelApiRepoMap' },
      { setting: 'modelApiRepoMap' },
      [],
      ['modelApiRepoMap', 'modelApiObservationPacking'],
      'code-intelligence',
      ['modelApi'],
    ),
    feature(
      'checkpoints',
      { setting: 'turnCheckpoints' },
      { setting: 'turnCheckpoints' },
      [],
      ['turnCheckpoints'],
      'the-panel',
      ['modelApi'],
    ),
    feature(
      'rules',
      { ui: 'permissionModeItem' },
      { setting: 'modelApiCommandRules' },
      [],
      [
        'modelApiCommandRules',
        'modelApiPermissionProfiles',
        'modelApiPermissionProfile',
        'modelApiRepositoryRules',
      ],
      'auto-rules-and-permission-profiles-model-api',
      ['modelApi'],
    ),
    feature(
      'browser',
      { command: COMMAND_IDS.downloadBrowserCheckRuntime },
      { setting: 'browserCheckRuntime' },
      ['downloadBrowserCheckRuntime'],
      ['browserCheckExtraHosts', 'browserCheckRuntime'],
      'browser-check',
      undefined,
      false,
      ['vscode'],
    ),
    feature(
      'voice',
      { ui: 'paidVoiceName' },
      { ui: 'referenceVoice' },
      [],
      ['dictationEngine', 'modelApiVoice'],
      'voice-dictation',
      ['museCode'],
      true,
      ['vscode'],
    ),
    feature(
      'search',
      { ui: 'paidWebSearchName' },
      { tip: 'paid:webSearch' },
      [],
      ['modelApiWebSearch', 'webSearchMaxPerRequest'],
      'paid-features',
      ['modelApi'],
      true,
    ),
    feature(
      'images',
      { ui: 'paidImageGenerationName' },
      { tip: 'paid:imageGeneration' },
      [],
      ['modelApiImageGeneration'],
      'paid-features',
      undefined,
      true,
    ),
    {
      ...feature(
        'schedules',
        { ui: 'loopItem' },
        { tip: 'loop' },
        ['schedulePrompt', 'showSchedules', 'showScheduleTimeline'],
        [
          'modelApiScheduledPrompts',
          'schedules',
          'scheduleDefaultDelivery',
          'scheduleAgentCreation',
        ],
        'scheduled-prompts-model-api',
        ['modelApi'],
        true,
        ['vscode'],
      ),
      details: [{ ui: 'referenceAttachments' }, { ui: 'scheduledMediaSupport' }] as const,
    },
    feature(
      'subagents',
      { ui: 'agentsCommand' },
      { tip: 'paid:subagents' },
      [],
      ['modelApiSubagents'],
      'session-board-and-best-of-n',
      ['modelApi'],
      true,
      ['vscode'],
    ),
    feature(
      'auto',
      { ui: 'permissionModeItem' },
      { tip: 'paid:autoReviewer' },
      [],
      ['modelApiAutoReviewer'],
      'auto-rules-and-permission-profiles-model-api',
      ['modelApi'],
      true,
      ['vscode'],
    ),
    feature(
      'hook-models',
      { ui: 'hooksItem' },
      { tip: 'paid:hookModels' },
      [],
      ['modelApiHookModels'],
      'hooks',
      ['modelApi'],
      true,
      ['vscode'],
    ),
    feature(
      'cache',
      { setting: 'modelApiPromptCacheRetention' },
      { setting: 'modelApiPromptCacheRetention' },
      [],
      ['modelApiPromptCacheRetention'],
      'paid-features',
      ['modelApi'],
      false,
      ['vscode'],
    ),
    feature(
      'budget',
      { setting: 'paidDailyBudgetUsd' },
      { setting: 'paidDailyBudgetUsd' },
      [],
      ['paidDailyBudgetUsd'],
      'paid-features',
      ['modelApi'],
      false,
    ),
    feature(
      'tab',
      { command: COMMAND_IDS.tabMenu },
      { ui: 'referenceTab' },
      ['tabTurnOn', 'tabTurnOff', 'tabSnooze', 'tabMenu', 'tabLanguages'],
      [
        'modelApiTab',
        'tabModel',
        'tabDailyBudgetUsd',
        'tabLanguages',
        'tabMultiline',
        'tabTrigger',
        'tabWithCopilot',
      ],
      'tab-completions',
      undefined,
      true,
      ['vscode'],
    ),
    feature(
      'judge',
      { ui: 'paidJudgeName' },
      { tip: 'paid:judge' },
      [],
      ['judge.engine'],
      'muse-judge',
      ['modelApi'],
      true,
      ['vscode'],
    ),
    feature(
      'judge-subscription',
      { ui: 'paidJudgeName' },
      { ui: 'judgeSubscriptionNotice' },
      [],
      ['judge.engine'],
      'muse-judge',
      ['museCode'],
      false,
      ['vscode'],
    ),
    feature(
      'orchestrator-playbook',
      { ui: 'playbookTitle' },
      { ui: 'playbookRecordHelp' },
      [],
      [],
      'orchestrator-playbook-policy-m116',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'estimator',
      { ui: 'estimateTitle' },
      { ui: 'referenceEstimate' },
      ['estimate'],
      ['estimator.optimize', 'estimator.priceLookup'],
      'estimates',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'support',
      { ui: 'groupSupport' },
      { tip: 'issue' },
      ['showLogs', 'diagnostics', 'reportProblem', 'openWalkthrough', 'showWhatsNew', 'openHelp'],
      ['showWhatsNewOnUpdate'],
      'help-and-reference',
    ),
    feature(
      'vault',
      { command: COMMAND_IDS.vault },
      { ui: 'referenceVaultPanel' },
      ['vault', 'lockVault'],
      [
        'vault.enabled',
        'vault.protection',
        'vault.agentFence',
        'vault.lockAfterIdleMinutes',
        'vault.lockOnScreenLock',
      ],
      'the-vault',
      ['museCode', 'modelApi'],
      false,
      ['vscode', 'acp'],
    ),
  ].map((entry) => {
    const surfaces = REFERENCE_SURFACES[entry.id] ?? entry.surfaces
    return {
      ...entry,
      surfaces,
      editors: [
        ...new Set(
          surfaces.map((surface): 'acp' | 'vscode' =>
            surface.startsWith('acp:') ? 'acp' : 'vscode',
          ),
        ),
      ],
      backends: [
        ...new Set(
          surfaces.map((surface): 'museCode' | 'modelApi' =>
            surface.endsWith(':modelApi') ? 'modelApi' : 'museCode',
          ),
        ),
      ],
      paid: Object.values(PAID_USE_REGISTRY).some((paid) => paid.featureId === entry.id),
      // Feature-level details (schedules, accounts) and REFERENCE_DETAILS
      // combine: neither source may silently erase the other.
      details: [...entry.details, ...(REFERENCE_DETAILS[entry.id] ?? []).map((ui) => ({ ui }))],
      facts: {},
    }
  })
}

export const REFERENCE_SURFACES: Readonly<Record<string, readonly string[]>> = {
  estimator: ['vscode:museCode', 'vscode:modelApi', 'acp:museCode', 'acp:modelApi'],
  'web-fetch': ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  search: ['vscode:modelApi', 'acp:modelApi'],
  images: ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  acp: ['acp:museCode', 'acp:modelApi'],
}

const REFERENCE_DETAILS: Readonly<
  Record<string, readonly Extract<ReferenceText, { ui: unknown }>['ui'][]>
> = {
  providers: ['providerOpenRouterServices'],
  estimator: ['estimateCliHelp'],
  permissions: ['referencePermissionLimits'],
  'native-agents': ['referenceAgentControls', 'referenceNativeAgentsConditions'],
  account: ['signInBrowserDetail', 'signInApiKeyDetail', 'installDetail', 'referenceSecretPrompt'],
  'code-intelligence': ['referenceCodeIntelExtra'],
  chat: ['referenceThinking', 'referenceConversationActions', 'crashDetail'],
  context: ['referenceContext'],
  skills: ['referenceBundled'],
  exports: ['referenceExports'],
  imports: ['agentImportDetailEvery', 'referenceResumeAgents'],
  plans: ['referencePlanModes'],
  browser: ['referenceBrowser'],
  images: ['referencePaidContexts'],
  search: ['referencePaidContexts'],
  git: ['structuredOutputRepair', 'structuredOutputFallback'],
  judge: ['structuredOutputRepair', 'structuredOutputFallback'],
  'structured-side-calls': ['structuredOutputRepair', 'structuredOutputFallback'],
  budget: ['referenceBudget'],
  voice: ['referencePaidContexts'],
  auto: ['referencePaidContexts'],
  subagents: ['referencePaidContexts'],
  'best-of-n': ['referenceBestOfNRequirements', 'referencePaidContexts'],
  support: ['referenceAcp'],
  cache: ['referenceCache'],
  'custom-agents': ['referencePaidContexts'],
  'conversation-actions': ['referenceWindowsSessions'],
  questions: ['referenceQuestionsDeferral'],
}

/** Runtime localized inventory for M118; the reference generator uses the English fallback. */
export function sharingFeatures(table: UiText = UI_TEXT) {
  return [
    {
      id: 'sharing-help',
      surface: 'editor/acp',
      syntax: '/help',
      label: table.helpReferenceTitle,
      detail: table.referenceIntro,
    },
    {
      id: PROMPT_COMMAND_IDS.save,
      surface: 'editor',
      syntax: 'museSpark.savePrompt',
      label: table.promptSave,
      detail: table.promptSecretsNote,
    },
    {
      id: PROMPT_COMMAND_IDS.use,
      surface: 'editor',
      syntax: 'museSpark.useSavedPrompt',
      label: table.promptUseSaved,
      detail: `${table.promptVariables}; ${table.promptInsert}`,
    },
    {
      id: PROMPT_COMMAND_IDS.library,
      surface: 'editor',
      syntax: 'museSpark.promptLibrary',
      label: table.promptLibrary,
      detail: `${table.promptScopeUser}; ${table.promptScopeWorkspace}`,
    },
    {
      id: PROMPT_COMMAND_IDS.copyToUser,
      surface: 'editor',
      syntax: 'museSpark.copyToMyPrompts',
      label: table.promptCopyToUser,
      detail: table.promptScopeUser,
    },
    {
      id: PROMPT_COMMAND_IDS.sharePrompt,
      surface: 'editor',
      syntax: 'museSpark.sharePrompt',
      label: table.sharePrompt,
      detail: table.shareReviewPrivacy,
    },
    {
      id: PROMPT_COMMAND_IDS.shareChat,
      surface: 'editor',
      syntax: 'museSpark.shareChat',
      label: table.shareChat,
      detail: `${table.shareConversation}; ${table.shareFull}`,
    },
    {
      // Activation observes machine consent before any sharing command is used.
      id: 'museSpark.syncPromptsAndBookmarks',
      surface: 'setting',
      syntax: 'museSpark.syncPromptsAndBookmarks',
      label: table.promptLibrary,
      detail: table.promptScopeUser,
    },
    {
      id: 'share',
      surface: 'acp',
      syntax: '/share chat [--mode full|conversation] [--format md|html|json]',
      label: table.shareChat,
      detail: table.shareReviewPrivacy,
    },
    {
      id: 'prompt',
      surface: 'acp',
      syntax:
        '/prompt save --title TITLE [--scope user|workspace] -- TEXT; /prompt list; /prompt use ID; /prompt share ID',
      label: table.promptLibrary,
      detail: table.promptRun,
    },
    {
      id: 'share-cli',
      surface: 'cli',
      syntax: 'share chat SESSION_ID [--mode full|conversation] [--format md|html|json]',
      label: table.shareChat,
      detail: table.shareConfirm,
    },
    {
      id: 'prompts-save-cli',
      surface: 'cli',
      syntax: 'prompts save --title TITLE [--scope user|workspace] [--cwd FOLDER] < prompt.txt',
      label: table.promptLibrary,
      detail: table.promptRun,
    },
    {
      id: 'prompts-list-cli',
      surface: 'cli',
      syntax: 'prompts list [--search TEXT] [--tag TAG] [--cwd FOLDER]',
      label: table.promptLibrary,
      detail: table.promptScopeUser,
    },
    {
      id: 'prompts-use-cli',
      surface: 'cli',
      syntax: 'prompts use ID [--scope user|workspace] [--chat active|new] [--cwd FOLDER]',
      label: table.promptUseSaved,
      detail: `${table.promptVariables}; ${table.promptInsert}`,
    },
    {
      id: 'prompts-share-cli',
      surface: 'cli',
      syntax:
        'prompts share ID [--scope user|workspace] [--format md|html|json] [--destination copy|file|browser] [--out FILE]',
      label: table.sharePrompt,
      detail: table.shareConfirm,
    },
  ]
}

export function sharingHelp(table: UiText = UI_TEXT): string {
  return sharingFeatures(table)
    .map((feature) => `${feature.syntax}\n${feature.label}: ${feature.detail}`)
    .join('\n\n')
}
