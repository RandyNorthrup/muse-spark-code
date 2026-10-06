import { PAID_USE_REGISTRY } from './paid'
// HELPREF: reviewed feature relationships. The generator validates every id
// against the manifest and reuses its translated text and the palette's tips.
import { COMMAND_IDS, type SETTING_DEFAULTS } from './constants'
import type { UiText } from './l10n/en'

type PlainReferenceText =
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
  referenceSandbox: 'platform=win32&shellSandbox',
  referenceBrowser: 'workspaceTrust',
  referenceBestOfNRequirements: 'bestOfNAdmission',
  referenceSecretPrompt: 'secretDetected',
  referenceTabMenu: 'copilotYield',
  referenceConversationActions: 'turnState',
  referencePermissionLimits: 'backend&permissionMode&autoReviewer',
  museCodeReviewerNotice: 'permissionMode=auto&museCodeAutoReviewer=true',
  gitCommitItemDetail: 'userRequestedMessage',
}
const SETTING_CONDITIONS: Readonly<Partial<Record<keyof typeof SETTING_DEFAULTS, string>>> = {
  preferredLocation: 'activeConversation',
  archiveInactiveSessions: 'sessionIdle',
  cleanupPeriodDays: 'sessionList',
  sandboxNetwork: 'shellSandbox',
  browserCheckExtraHosts: 'browserNetworkAdmission',
  notifyOnBackgroundTurn: 'turnState&windowFocus',
  modelApiSessionBudgetUsd: 'sessionBudget',
  modelApiObservationPacking: 'conversationStart',
  showWhatsNewOnUpdate: 'releaseHighlights',
  modelApiPermissionProfile: 'permissionProfile',
  tabLanguages: 'language',
  tabMultiline: 'multilineMode',
  tabTrigger: 'tabTrigger',
}

/** The generator uses these explicit selectors on every description surface. */
export function referenceDescription(text: ReferenceText): ReferenceText {
  if ('conditions' in text) return text
  const settingConditions: Readonly<Partial<Record<string, string>>> = SETTING_CONDITIONS
  let when: string | undefined
  if ('ui' in text) when = UI_CONDITIONS[text.ui]
  else if ('setting' in text) when = settingConditions[text.setting]
  else if ('cli' in text && text.cli === 'fail-on-denial') when = 'permission=denied'
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
  openHelp: { description: { ui: 'referenceIntro' }, canRun: true },
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
      [],
      [],
      'the-panel',
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
    feature(
      'questions',
      { ui: 'questionSubmit' },
      { ui: 'referenceQuestions' },
      [],
      [],
      'the-panel',
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
      ['modelApiWebSearch'],
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
    feature(
      'schedules',
      { ui: 'loopItem' },
      { tip: 'loop' },
      [],
      ['modelApiScheduledPrompts'],
      'scheduled-prompts-model-api',
      ['modelApi'],
      true,
      ['vscode'],
    ),
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
      'support',
      { ui: 'groupSupport' },
      { tip: 'issue' },
      ['showLogs', 'diagnostics', 'reportProblem', 'openWalkthrough', 'showWhatsNew', 'openHelp'],
      ['showWhatsNewOnUpdate'],
      'help-and-reference',
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
      details: (REFERENCE_DETAILS[entry.id] ?? []).map((ui) => ({ ui })),
      facts: {},
    }
  })
}

export const REFERENCE_SURFACES: Readonly<Record<string, readonly string[]>> = {
  'web-fetch': ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  search: ['vscode:modelApi', 'acp:modelApi'],
  images: ['vscode:museCode', 'vscode:modelApi', 'acp:modelApi'],
  acp: ['acp:museCode', 'acp:modelApi'],
}

const REFERENCE_DETAILS: Readonly<
  Record<string, readonly Extract<ReferenceText, { ui: unknown }>['ui'][]>
> = {
  permissions: ['referencePermissionLimits'],
  'native-agents': ['referenceAgentControls', 'referenceNativeAgentsConditions'],
  account: ['signInBrowserDetail', 'signInApiKeyDetail', 'installDetail', 'referenceSecretPrompt'],
  'code-intelligence': ['referenceCodeIntelExtra'],
  chat: ['referenceThinking', 'referenceConversationActions'],
  context: ['referenceContext'],
  skills: ['referenceBundled'],
  exports: ['referenceExports'],
  imports: ['agentImportDetailEvery', 'referenceResumeAgents'],
  plans: ['referencePlanModes'],
  browser: ['referenceBrowser'],
  images: ['referencePaidContexts'],
  search: ['referencePaidContexts'],
  budget: ['referenceBudget'],
  voice: ['referencePaidContexts'],
  auto: ['referencePaidContexts'],
  subagents: ['referencePaidContexts'],
  'best-of-n': ['referenceBestOfNRequirements', 'referencePaidContexts'],
  support: ['referenceAcp'],
  cache: ['referenceCache'],
  'custom-agents': ['referencePaidContexts'],
  'conversation-actions': ['referenceWindowsSessions'],
}
