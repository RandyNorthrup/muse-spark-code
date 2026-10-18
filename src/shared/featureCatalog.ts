import { PAID_USE_REGISTRY } from './paid'
// HELPREF: reviewed feature relationships. The generator validates every id
// against the manifest and reuses its translated text and the palette's tips.
import {
  COMMAND_IDS,
  type SETTING_DEFAULTS,
  PROMPT_COMMAND_IDS,
  UI_TEXT,
  SCHEDULE_EDITOR_DELIVERY_CERTIFICATION,
} from './constants'
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
  referenceScreenRecording: 'nativeRecorder=absent',
  // Review repairs cover dispatch authority, resolved-file policy and window
  // lifetime; the delivery certification switch still owns availability.
  referenceSchedules: 'scheduleDeliveryCertified=false',
  referenceSchedulesCertified: 'scheduleDeliveryCertified=true',
  referenceRuntimeSchedulesCertified: 'scheduleDeliveryCertified=true',
  referenceSchedulePaidConsentCertified: 'scheduleDeliveryCertified=true',
  referenceSchedulePaidConsent: 'scheduleDeliveryCertified=false',
  referenceRuntimeSchedules: 'scheduleDeliveryCertified=false',
  referenceVaultPanel: 'vaultBroker=absent',
  referenceNativeAgentsConditions: 'run.subagent_delegation_mode',
  resourceCpuMaxPercentDescription: 'resourceCpuThreshold',
  resourceMemoryMaxPercentDescription: 'resourceMemoryThreshold&memoryHeadroom=available',
  resourceMemoryMinFreeGiBDescription: 'memoryHeadroom=available',
  providerOpenRouterServices: 'openRouterServices=absent',
  privacyNoRetentionDetail: 'provider=openrouter&privacy=zdr',
  referenceOutputCapMinimum: 'outputMinimum=known',
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
  'config.resourceRelocate.enumDescriptions.paired': 'resourceRelocation=noRoute',
  'config.resourceRelocate.enumDescriptions.ask': 'resourceRelocation=noRoute',
  'config.resourceRelocate.enumDescriptions.off': 'resourceRelocation=off',
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
      | 'resourceMemoryMinFreeGiB'
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
  // The provider wizard edits this numeric setting, preserving exact USD
  // through a validated decimal-to-number boundary.
  modelApiSessionBudgetUsd: 'sessionBudget',

  modelApiObservationPacking: 'conversationStart',
  modelApiAutoCompaction: 'conversationStart&modelPricing',
  modelApiStrictTools: 'conversationStart&tools.strict',
  modelApiParallelReads: 'conversationStart',
  webSearchMaxPerRequest: 'conversationStart&hosted.webSearch',
  showWhatsNewOnUpdate: 'releaseHighlights',
  schedules: 'scheduleDeliveryCertified=true',
  scheduleDefaultDelivery: 'scheduleDeliveryCertified=true',
  scheduleAgentCreation: 'scheduleDeliveryCertified=true',
  modelApiPermissionProfile: 'permissionProfile',
  tabLanguages: 'language',
  tabMultiline: 'multilineMode',
  tabTrigger: 'tabTrigger',
  'shell.passEnvironmentVariables': 'backend=modelApi&shellOrigin=interactive',
  resourceCpuMaxPercent: 'resourceThreshold',
  resourceMemoryMaxPercent: 'resourceThreshold&memoryHeadroom=available',
  resourceMemoryMinFreeGiB: 'memoryHeadroom=available',
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
      case 'auto-compaction':
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
  // M107 U–C1/W: Show opens the chat's chip popover; Resume changes the governor, so no Run.
  showResources: { description: { command: COMMAND_IDS.showResources }, canRun: true },
  resumeResources: { description: { command: COMMAND_IDS.resumeResources }, canRun: false },
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
  estimate: { description: { ui: 'referenceEstimate' }, canRun: false },
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
  schedulePrompt: {
    description: { tip: 'schedulePrompt' },
    get canRun() {
      return SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
    },
  },
  showSchedules: {
    description: { tip: 'schedule' },
    get canRun() {
      return SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
    },
  },
  showScheduleTimeline: {
    description: { tip: 'scheduleTimeline' },
    get canRun() {
      return SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
    },
  },
  vault: { description: { ui: 'referenceVaultPanel' }, canRun: false },
  lockVault: { description: { ui: 'referenceVaultPanel' }, canRun: false },
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

// CX1R3: retained for coverage validation, omitted from published Help.
// Accounts left the list with CM108ACC: the terminal and ACP serve them.
// Argument previews left it with C-M106-2: the panel and ACP render them on
// a model whose record verifies streamed arguments.
export const REFERENCE_IN_PROGRESS_FEATURES: readonly string[] = [
  'team-workers',
  'vault',
  'estimator',
  'auto-compaction',
]

export function featureCatalog(): readonly Feature[] {
  return [
    feature(
      'resources',
      { ui: 'resourceTitle' },
      { ui: 'referenceResources' },
      ['showResources', 'resumeResources'],
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
    // MODELSPLIT4: section transitions preserve the visible document; reload
    // restores its measured box. Lazy price/usage rows announce loading.
    feature(
      'providers',
      // M95: configured clients preserve local refusals; ACP auth lists sign-ins only.
      { ui: 'modelsPanelTitle' },
      { ui: 'startWithOwnModelDetail' },
      [
        'startWithOwnModel',
        'modelsAndAgents',
        'addModelProvider',
        'connectChatGpt',
        'connectCopilot',
      ],
      // Saved custom limits persist directly from Edit without a new test
      // while the connection is unchanged; pre-write failures retain the draft.
      // Edit and Change key share a full saved snapshot; unchanged routing,
      // limits, consent and the default survive. Save admits one operation
      // per draft, compares edited fields inside the stored mutation and offers
      // Reload on conflicts. Untouched fields and rotated/removed keys survive
      // consent waits; only an entered key replaces a stored credential.
      // Save validates first, then writes provider/key/default/limit/composer in
      // order. Completed writes stay on failure; localized outcomes name saved,
      // failed and skipped steps. Every outcome refreshes without losing earlier
      // information. Budget-only partial drafts retry on a fresh baseline; other
      // partial or stale forms reopen. A key bound to an old origin shows missing.
      // Re-entry compares even origin-refused credential records; only concurrent
      // changes conflict. Confirmed limit retries retain all completed receipts.
      // Simultaneous cross-window saves remain last-writer-wins until LOCKLIB.
      // Earlier steps remain navigable while final Save validates limits.
      // ChatGPT sign-in reuses the account's saved registration (its issued
      // client survives sign-out); "Use a Different ChatGPT Account" (the
      // panel, the ACP sign-in method, `providers add chatgpt --new-account`)
      // registers another account instead.
      ['suggestedProvider', 'modelApiSessionBudgetUsd'],
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
    // M121: exact costs and period changes; unproved historical months are
    // withheld with a translated notice in editor and portable usage views.
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
      { ui: 'referenceManualCompaction' },
      [],
      [],
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
    {
      ...feature(
        'auto-compaction',
        { ui: 'autoCompactionName' },
        { ui: 'autoCompactionAwaitingEvaluation' },
        [],
        ['modelApiAutoCompaction'],
        'agent-loop-guarantees',
        ['modelApi'],
        true,
        ['vscode', 'acp'],
      ),
      details: [{ setting: 'modelApiAutoCompaction' }],
    },
    feature(
      'argument-preview',
      { ui: 'toolArgumentPreviewLabel' },
      { ui: 'toolArgumentPreviewDescription' },
      [],
      [],
      'agent-loop-guarantees',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
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
      // JSON progress uses stderr; stopped runs retain redacted incomplete answers.
      // M80/M95: one atomic spend admission; estimates include a margin and each ambiguous attempt retains its reservation.
      ['modelApi'],
      false,
      ['acp'],
    ),
    feature(
      'fast-tier',
      { cli: 'fast' },
      { cli: 'fast' },
      [],
      [],
      'headless-runs',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
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
    // Deep CLI help follows the public command table; full reference is explicit.
    // ACP and exec use the selected provider summary's known effort levels.
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
    // M87 MENUFAN: shared row/selection bursts follow visible element anchors;
    // inside pointer/selected borders keep neighbouring focus rings clear.
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
    // M123P9: runtime checkout uses the same installed display language;
    // uncertain record writes have a translated failure, with CAS cleanup.
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
      details: [
        {
          ui: SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
            ? 'referenceSchedulesCertified'
            : 'referenceSchedules',
        },
        {
          ui: SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
            ? 'referenceSchedulePaidConsentCertified'
            : 'referenceSchedulePaidConsent',
        },
        { ui: 'scheduledMediaSupport' },
      ] as const,
    },
    {
      ...feature(
        'runtime-schedules',
        { ui: 'runtimeSchedulesItem' },
        { ui: 'runtimeSchedulesItemDetail' },
        [],
        [],
        'runtime-scheduled-delivery',
        ['museCode', 'modelApi'],
        false,
        ['acp'],
      ),
      facts: {
        unattended: true,
        durableClaims: true,
        terminal: true,
      },
      details: [
        {
          ui: SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
            ? 'referenceRuntimeSchedulesCertified'
            : 'referenceRuntimeSchedules',
        },
      ] as const,
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
      ['paidDailyBudgetUsd', 'modelApiSessionBudgetUsd'],
      'paid-features',
      ['modelApi'],
      false,
      ['vscode', 'acp'],
    ),
    feature(
      'tab',
      { command: COMMAND_IDS.tabMenu },
      // D73: only Always persists the model/price; Allow once saves nothing,
      // so each new window asks again (RVM94KR4G). Consent is key-bound, and
      // other features' price changes preserve Tab's window grant (RVM94KR3G).
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
    const isInProgress = REFERENCE_IN_PROGRESS_FEATURES.includes(entry.id)
    const surfaces = isInProgress ? [] : (REFERENCE_SURFACES[entry.id] ?? entry.surfaces)
    return {
      ...entry,
      ...(isInProgress && {
        summary: { ui: 'referenceInProgress' },
        description: { ui: 'referenceInProgress' },
      }),
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
      details: isInProgress
        ? []
        : [...entry.details, ...(REFERENCE_DETAILS[entry.id] ?? []).map((ui) => ({ ui }))],
      facts: {},
    }
  })
}

export const REFERENCE_SURFACES: Readonly<Record<string, readonly string[]>> = {
  'orchestrator-playbook': ['acp:museCode', 'acp:modelApi'],
  // CM108ACC: the terminal and ACP sessions on the Model API backend; the
  // editor's Accounts page is not mounted.
  accounts: ['acp:modelApi'],
  'web-fetch': ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  search: ['vscode:modelApi', 'acp:modelApi'],
  images: ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  acp: ['acp:museCode', 'acp:modelApi'],
}

const REFERENCE_DETAILS: Readonly<
  Record<string, readonly Extract<ReferenceText, { ui: unknown }>['ui'][]>
> = {
  providers: [
    'providerOpenRouterServices',
    'pricePerMillion',
    'privacyNoRetentionDetail',
    'referenceOutputCapMinimum',
  ],
  estimator: ['estimateCliHelp'],
  // Includes Muse Code's permission-rule exceptions, shared with localized settings.
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
  schedules: ['referenceAttachments'],
  auto: ['referencePaidContexts'],
  subagents: ['referencePaidContexts'],
  'best-of-n': ['referenceBestOfNRequirements', 'referencePaidContexts'],
  support: ['referenceAcp'],
  cache: ['referenceCache'],
  'custom-agents': ['referencePaidContexts'],
  'conversation-actions': [
    'referenceWindowsSessions',
    'restoreFilesToHere',
    'rewindAndRestore',
    'copyResponse',
    'replyToOutput',
    'askAboutThis',
    'commentOnThis',
    'promptSave',
    'sharePrompt',
  ],
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

// Terminal and ACP help only: the editor's own commands and settings
// (museSpark.*) cannot be run there, so they stay out of this text.
export function sharingHelp(table: UiText = UI_TEXT): string {
  return sharingFeatures(table)
    .filter((feature) => feature.surface !== 'editor' && feature.surface !== 'setting')
    .map((feature) => `${feature.syntax}\n${feature.label}: ${feature.detail}`)
    .join('\n\n')
}
