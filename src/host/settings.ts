// Reads `museSpark.*` settings with runtime validation. VS Code already
// validates against the manifest schema, but settings.json can hold anything,
// so every value is parsed; an invalid value is logged and replaced by the
// documented default so one bad key cannot take the whole panel down.

import * as z from 'zod/mini'
import { widenedHost } from '../core/browser/browserPolicy'
import { checkCommandsSchema } from '../core/verify/checkCommands'
import {
  BACKEND_MODES,
  type BackendMode,
  BROWSER_CHECK_EXTRA_HOSTS_MAX,
  BROWSER_RUNTIME_MODES,
  type BrowserRuntimeMode,
  type CheckCommandSetting,
  type EnvironmentVariable,
  JUDGE_ENGINES,
  type JudgeEngine,
  LEGAL_HEADER_POLICIES,
  type LegalHeaderPolicy,
  PROMPT_CACHE_RETENTIONS,
  QUESTION_DEFER_MAX_SECONDS,
  type PromptCacheRetention,
  SANDBOX_NETWORK_MODES,
  type SandboxNetworkMode,
  SCHEDULE_AGENT_CREATIONS,
  SCHEDULE_DELIVERIES,
  SETTING_DEFAULTS,
  PAID_DAILY_BUDGET,
  SETTINGS_SECTION,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
  USAGE_HISTORY_DAYS_MIN,
  USAGE_HISTORY_DAYS_MAX,
  TAB_DAILY_BUDGET_MAX_USD,
  TAB_DAILY_BUDGET_MIN_USD,
  TAB_MODELS,
  TAB_MULTILINE_MODES,
  TAB_TRIGGER_MODES,
  TAB_WITH_COPILOT_MODES,
  type TabModel,
  type TabMultiline,
  type TabTrigger,
  type TabWithCopilot,
} from '../shared/constants'
import type { PermissionSettings } from '../core/permissionSettings'
import { type SettingsSnapshot, settingsSnapshotShape } from '../shared/protocol'
import type { Logger } from './logger'

export interface ExtensionSettings extends SettingsSnapshot {
  readonly usageHistory: boolean
  readonly usageHistoryDays: number
  readonly paidDailyBudgetUsd: number
  readonly dictationEngine: 'system' | 'museVoice'
  /** Absolute path to the `muse` executable; empty means "discover". */
  readonly museBinaryPath: string
  readonly environmentVariables: readonly EnvironmentVariable[]
  readonly 'shell.passEnvironmentVariables': readonly string[]
  /** M112 (D92): seconds before an unanswered question defers; 0 never. */
  readonly syncPromptsAndBookmarks: boolean
  readonly 'questions.deferAfterSeconds': number
  readonly 'reports.network': 'whenSignedIn' | 'always' | 'off'
  readonly 'reports.keepHistory': boolean
  readonly 'reports.agentSources': readonly ('claudeCode' | 'codex')[]
  /** Shell sandbox posture for `muse serve` (PLAN.md D12). */
  readonly shellSandbox: ShellSandboxMode
  /** Which backend hosts conversations (PLAN.md D1, M7). */
  readonly backend: BackendMode
  /** Workspace preset suggestion, held by the host (M95, PLAN.md D74). */
  readonly suggestedProvider: string
  /** Ctrl+N for a new conversation (read by the keybinding, kept here for the schema). */
  readonly enableNewConversationShortcut: boolean
  /** Days an idle Model API conversation is kept; 0 keeps it (PLAN.md D26). */
  readonly cleanupPeriodDays: number
  /** D78 availability flags; paid consent and daily admission authorize spending. */
  readonly modelApiWebSearch: boolean
  readonly modelApiImageGeneration: boolean
  readonly modelApiVoice: boolean
  /** The shell sandbox's network for `muse serve` (M56, PLAN.md D43). */
  readonly sandboxNetwork: SandboxNetworkMode
  /** How long Meta is asked to keep the Model API's cached prompt prefix (M56). */
  readonly modelApiPromptCacheRetention: PromptCacheRetention
  readonly modelApiScheduledPrompts: boolean
  /** The v2 schedules surface (M115, PLAN.md D95): on by default. */
  readonly schedules: boolean
  readonly scheduleDefaultDelivery: (typeof SCHEDULE_DELIVERIES)[number]
  readonly scheduleAgentCreation: (typeof SCHEDULE_AGENT_CREATIONS)[number]
  readonly modelApiSubagents: boolean
  /** Best-of-N availability; an explicit run and consent choose its extra attempts. */
  readonly modelApiBestOfN: boolean
  /** Team tasks billed to a key (M96 lane A, PLAN.md D75): on only with the price accepted too. */
  readonly modelApiTeamWorkers: boolean
  /** Configured hooks are enabled by default (D78), in trusted workspaces only. */
  readonly modelApiHooks: boolean
  /** The Model API shell keeps its directory between calls (M91 lane S): on until turned off. */
  readonly modelApiShellKeepsDirectory: boolean
  /** M91 prompt/agent hook handlers (D70): on by default, the setting is the kill switch. */
  readonly modelApiHookModels: boolean
  /** M91 http hook handlers (D70): allowlisted hosts, empty by default. */
  readonly hookHttpAllowedHosts: readonly string[]
  /**
   * M78 (PLAN.md D49): each kept whole here; the Model API bundle parses
   * every rule and profile and reports what it refuses (permissionPolicy.ts).
   */
  readonly modelApiCommandRules: readonly unknown[]
  readonly modelApiPermissionProfiles: Readonly<Record<string, unknown>>
  readonly modelApiPermissionProfile: unknown
  readonly modelApiRepositoryRules: unknown
  /** Paid Auto reviewer availability (M78, D78); each use needs consent. */
  readonly modelApiAutoReviewer: boolean
  /** Inline completions (M94, PLAN.md D73): on only with the price accepted too. */
  readonly modelApiTab: boolean
  /** The model Tab completion requests use (Q-M94b). */
  readonly tabModel: TabModel
  /** The hard daily budget in US dollars for Tab requests (Q-M94c). */
  readonly tabDailyBudgetUsd: number
  /** The languages Tab suggests in, like `github.copilot.enable`. */
  readonly tabLanguages: Readonly<Record<string, boolean>>
  /** When Tab adds surrounding context for multi-line completions. */
  readonly tabMultiline: TabMultiline
  /** Whether Tab suggests automatically or only when invoked. */
  readonly tabTrigger: TabTrigger
  /** What Tab does where GitHub Copilot also suggests. */
  readonly tabWithCopilot: TabWithCopilot
  /** The Muse Judge's engine (M98, PLAN.md D77): `auto` is `same` in phase 1. */
  readonly 'judge.engine': JudgeEngine
  /** The verify loop (M68, PLAN.md D49): diagnostics after edits, check commands, format on edit. */
  readonly diagnosticsAfterEdits: boolean
  readonly checkCommands: readonly CheckCommandSetting[]
  readonly formatOnEdit: boolean

  /** The repo map in the Model API's system prompt (M67). */
  readonly modelApiRepoMap: boolean
  /** Observation packing on the Model API backend (M73): a conversation reads it when it starts. */
  readonly modelApiObservationPacking: boolean
  readonly modelApiAutoCompaction: boolean
  /** A checkpoint of the workspace's files at each turn boundary (M72). */
  readonly turnCheckpoints: boolean
  /** The hosts beyond loopback the browser check may open and reach (M81, PLAN.md D49). */
  readonly browserCheckExtraHosts: readonly string[]
  /** Whether the browser check's runtime is asked for, downloaded or off (M81 A1). */
  readonly browserCheckRuntime: BrowserRuntimeMode
  /** The skills that ship with the extension (M89, PLAN.md D68). */
  readonly bundledSkills: boolean
  /** What's New after an update (M99, PLAN.md D79). */
  readonly showWhatsNewOnUpdate: boolean
  /** Notify when a turn needs attention while the window is unfocused (M82). */
  readonly notifyOnBackgroundTurn: boolean
  /** Tokens and the dollar estimate under each Model API reply (M82). */
  readonly modelApiReplyUsage: boolean
  /** Session budget cap in USD for Model API requests; 0 is no cap (M82). */
  readonly modelApiSessionBudgetUsd: number
  /** Copyright/SPDX header hygiene for the read-only legal scan (M97). */
  readonly legalRegistryLookups: boolean
  readonly legalExplanation: boolean
  readonly legalHeaderPolicy: LegalHeaderPolicy
}

/**
 * The one method this module needs from `vscode.WorkspaceConfiguration`,
 * which satisfies it structurally. Keeping the dependency this narrow makes
 * the reader trivially fakeable in unit tests.
 */
export interface SettingsSource {
  get(section: string): unknown
}

const environmentVariableSchema = z.object({ name: z.string(), value: z.string() })

// The webview-visible settings share their schemas with the wire protocol;
// only the host-only keys are declared here.
const settingSchemas = {
  ...settingsSnapshotShape,
  museBinaryPath: z.string(),
  environmentVariables: z.array(environmentVariableSchema),
  'shell.passEnvironmentVariables': z.array(z.string().check(z.regex(/^[A-Za-z_][A-Za-z0-9_]*$/))),
  syncPromptsAndBookmarks: z.boolean(),
  'questions.deferAfterSeconds': z.int().check(z.gte(0), z.lte(QUESTION_DEFER_MAX_SECONDS)),
  'reports.network': z.enum(['whenSignedIn', 'always', 'off']),
  'reports.keepHistory': z.boolean(),
  'reports.agentSources': z
    .array(z.enum(['claudeCode', 'codex']))
    .check(z.refine((values) => new Set(values).size === values.length)),
  shellSandbox: z.enum(SHELL_SANDBOX_MODES),
  backend: z.enum(BACKEND_MODES),
  suggestedProvider: z.string(),
  enableNewConversationShortcut: z.boolean(),
  cleanupPeriodDays: z.int().check(z.nonnegative()),
  modelApiWebSearch: z.boolean(),
  modelApiImageGeneration: z.boolean(),
  modelApiVoice: z.boolean(),
  sandboxNetwork: z.enum(SANDBOX_NETWORK_MODES),
  modelApiPromptCacheRetention: z.enum(PROMPT_CACHE_RETENTIONS),
  modelApiScheduledPrompts: z.boolean(),
  schedules: z.boolean(),
  scheduleDefaultDelivery: z.enum(SCHEDULE_DELIVERIES),
  scheduleAgentCreation: z.enum(SCHEDULE_AGENT_CREATIONS),
  modelApiSubagents: z.boolean(),
  modelApiBestOfN: z.boolean(),
  modelApiTeamWorkers: z.boolean(),
  modelApiHooks: z.boolean(),
  modelApiShellKeepsDirectory: z.boolean(),
  modelApiHookModels: z.boolean(),
  hookHttpAllowedHosts: z.array(z.string()),
  modelApiCommandRules: z.array(z.unknown()),
  modelApiPermissionProfiles: z.record(z.string(), z.unknown()),
  modelApiPermissionProfile: z.unknown(),
  modelApiRepositoryRules: z.unknown(),
  modelApiAutoReviewer: z.boolean(),
  modelApiTab: z.boolean(),
  tabModel: z.enum(TAB_MODELS),
  tabDailyBudgetUsd: z
    .number()
    .check(z.gte(TAB_DAILY_BUDGET_MIN_USD), z.lte(TAB_DAILY_BUDGET_MAX_USD)),
  tabLanguages: z.record(z.string(), z.boolean()),
  tabMultiline: z.enum(TAB_MULTILINE_MODES),
  tabTrigger: z.enum(TAB_TRIGGER_MODES),
  tabWithCopilot: z.enum(TAB_WITH_COPILOT_MODES),
  'judge.engine': z.enum(JUDGE_ENGINES),
  diagnosticsAfterEdits: z.boolean(),
  checkCommands: checkCommandsSchema,
  formatOnEdit: z.boolean(),

  modelApiRepoMap: z.boolean(),
  modelApiObservationPacking: z.boolean(),
  modelApiAutoCompaction: z.boolean(),
  turnCheckpoints: z.boolean(),
  // Each entry a plain host name or IP address (no port, path or wildcard):
  // one that is not refuses the whole list, so a typo warns rather than
  // widening something else.
  browserCheckExtraHosts: z
    .array(z.string().check(z.refine((entry) => widenedHost(entry) !== undefined)))
    .check(z.maxLength(BROWSER_CHECK_EXTRA_HOSTS_MAX)),
  browserCheckRuntime: z.enum(BROWSER_RUNTIME_MODES),
  bundledSkills: z.boolean(),
  showWhatsNewOnUpdate: z.boolean(),
  notifyOnBackgroundTurn: z.boolean(),
  modelApiReplyUsage: z.boolean(),
  dictationEngine: z.enum(['system', 'museVoice']),
  modelApiSessionBudgetUsd: z.number().check(z.nonnegative()),
  legalRegistryLookups: z.boolean(),
  legalExplanation: z.boolean(),
  paidDailyBudgetUsd: z
    .number()
    .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  legalHeaderPolicy: z.enum(LEGAL_HEADER_POLICIES),
  usageHistory: z.boolean(),
  usageHistoryDays: z
    .int()
    .check(z.minimum(USAGE_HISTORY_DAYS_MIN), z.maximum(USAGE_HISTORY_DAYS_MAX)),
} as const

type SettingKey = keyof typeof settingSchemas

// An invalid value is reported once per logger, not on every read: the
// settings are read about seven times for each message sent (M39).
const reported = new WeakMap<Logger, Set<string>>()

function warnOnce(log: Logger, key: string, text: string): void {
  const seen = reported.get(log) ?? new Set<string>()
  reported.set(log, seen)
  if (seen.has(key)) {
    return
  }
  seen.add(key)
  log.warn(text)
}

function readSetting<K extends SettingKey>(
  config: SettingsSource,
  key: K,
  log: Logger,
): ExtensionSettings[K] {
  let previousKey: string | undefined
  if (key === 'scheduleDefaultDelivery') previousKey = 'schedules.defaultDelivery'
  else if (key === 'scheduleAgentCreation') previousKey = 'schedules.agentCreation'
  const raw = config.get(key) ?? (previousKey === undefined ? undefined : config.get(previousKey))
  const fallback = SETTING_DEFAULTS[key] as ExtensionSettings[K]
  if (raw === undefined) {
    return fallback
  }
  const result = settingSchemas[key].safeParse(raw)
  if (result.success) {
    return result.data as ExtensionSettings[K]
  }
  warnOnce(
    log,
    `${key}=${JSON.stringify(raw)}`,
    `Setting ${SETTINGS_SECTION}.${key} is invalid and its default is in effect: ${z.prettifyError(result.error)}`,
  )
  return fallback
}

export function readSettings(config: SettingsSource, log: Logger): ExtensionSettings {
  return {
    preferredLocation: readSetting(config, 'preferredLocation', log),
    initialPermissionMode: readSetting(config, 'initialPermissionMode', log),
    autosave: readSetting(config, 'autosave', log),
    attachOpenFile: readSetting(config, 'attachOpenFile', log),
    useCtrlEnterToSend: readSetting(config, 'useCtrlEnterToSend', log),
    hideOnboarding: readSetting(config, 'hideOnboarding', log),
    focusView: readSetting(config, 'focusView', log),
    respectGitIgnore: readSetting(config, 'respectGitIgnore', log),
    confidentialWorkspace: readSetting(config, 'confidentialWorkspace', log),
    allowDangerouslySkipPermissions: readSetting(config, 'allowDangerouslySkipPermissions', log),
    archiveInactiveSessions: readSetting(config, 'archiveInactiveSessions', log),
    museBinaryPath: readSetting(config, 'museBinaryPath', log),
    environmentVariables: readSetting(config, 'environmentVariables', log),
    'shell.passEnvironmentVariables': readSetting(config, 'shell.passEnvironmentVariables', log),
    syncPromptsAndBookmarks: readSetting(config, 'syncPromptsAndBookmarks', log),
    'questions.deferAfterSeconds': readSetting(config, 'questions.deferAfterSeconds', log),
    'reports.network': readSetting(config, 'reports.network', log),
    'reports.keepHistory': readSetting(config, 'reports.keepHistory', log),
    'reports.agentSources': readSetting(config, 'reports.agentSources', log),
    shellSandbox: readSetting(config, 'shellSandbox', log),
    backend: readSetting(config, 'backend', log),
    suggestedProvider: readSetting(config, 'suggestedProvider', log),
    enableNewConversationShortcut: readSetting(config, 'enableNewConversationShortcut', log),
    cleanupPeriodDays: readSetting(config, 'cleanupPeriodDays', log),
    modelApiWebSearch: readSetting(config, 'modelApiWebSearch', log),
    modelApiImageGeneration: readSetting(config, 'modelApiImageGeneration', log),
    modelApiVoice: readSetting(config, 'modelApiVoice', log),
    sandboxNetwork: readSetting(config, 'sandboxNetwork', log),
    modelApiPromptCacheRetention: readSetting(config, 'modelApiPromptCacheRetention', log),
    modelApiScheduledPrompts: readSetting(config, 'modelApiScheduledPrompts', log),
    schedules: readSetting(config, 'schedules', log),
    scheduleDefaultDelivery: readSetting(config, 'scheduleDefaultDelivery', log),
    scheduleAgentCreation: readSetting(config, 'scheduleAgentCreation', log),
    modelApiSubagents: readSetting(config, 'modelApiSubagents', log),
    modelApiBestOfN: readSetting(config, 'modelApiBestOfN', log),
    modelApiTeamWorkers: readSetting(config, 'modelApiTeamWorkers', log),
    modelApiHooks: readSetting(config, 'modelApiHooks', log),
    modelApiShellKeepsDirectory: readSetting(config, 'modelApiShellKeepsDirectory', log),
    modelApiHookModels: readSetting(config, 'modelApiHookModels', log),
    hookHttpAllowedHosts: readSetting(config, 'hookHttpAllowedHosts', log),
    diagnosticsAfterEdits: readSetting(config, 'diagnosticsAfterEdits', log),
    checkCommands: readSetting(config, 'checkCommands', log),
    formatOnEdit: readSetting(config, 'formatOnEdit', log),
    modelApiRepoMap: readSetting(config, 'modelApiRepoMap', log),
    modelApiObservationPacking: readSetting(config, 'modelApiObservationPacking', log),
    modelApiAutoCompaction: readSetting(config, 'modelApiAutoCompaction', log),
    turnCheckpoints: readSetting(config, 'turnCheckpoints', log),
    browserCheckExtraHosts: readSetting(config, 'browserCheckExtraHosts', log),
    browserCheckRuntime: readSetting(config, 'browserCheckRuntime', log),
    bundledSkills: readSetting(config, 'bundledSkills', log),
    showWhatsNewOnUpdate: readSetting(config, 'showWhatsNewOnUpdate', log),
    notifyOnBackgroundTurn: readSetting(config, 'notifyOnBackgroundTurn', log),
    modelApiReplyUsage: readSetting(config, 'modelApiReplyUsage', log),
    paidDailyBudgetUsd: readSetting(config, 'paidDailyBudgetUsd', log),
    usageHistory: readSetting(config, 'usageHistory', log),
    usageHistoryDays: readSetting(config, 'usageHistoryDays', log),
    dictationEngine: readSetting(config, 'dictationEngine', log),
    modelApiSessionBudgetUsd: readSetting(config, 'modelApiSessionBudgetUsd', log),
    modelApiCommandRules: readSetting(config, 'modelApiCommandRules', log),
    modelApiPermissionProfiles: readSetting(config, 'modelApiPermissionProfiles', log),
    modelApiPermissionProfile: readSetting(config, 'modelApiPermissionProfile', log),
    modelApiRepositoryRules: readSetting(config, 'modelApiRepositoryRules', log),
    modelApiAutoReviewer: readSetting(config, 'modelApiAutoReviewer', log),
    'judge.engine': readSetting(config, 'judge.engine', log),
    museCodeAutoReviewer: readSetting(config, 'museCodeAutoReviewer', log),
    modelApiTab: readSetting(config, 'modelApiTab', log),
    tabModel: readSetting(config, 'tabModel', log),
    tabDailyBudgetUsd: readSetting(config, 'tabDailyBudgetUsd', log),
    tabLanguages: readSetting(config, 'tabLanguages', log),
    tabMultiline: readSetting(config, 'tabMultiline', log),
    tabTrigger: readSetting(config, 'tabTrigger', log),
    tabWithCopilot: readSetting(config, 'tabWithCopilot', log),
    legalRegistryLookups: readSetting(config, 'legalRegistryLookups', log),
    legalExplanation: readSetting(config, 'legalExplanation', log),
    legalHeaderPolicy: readSetting(config, 'legalHeaderPolicy', log),
  }
}

/** The permission settings as the Model API backend reads them at each call (M78). */
export function permissionSettingsOf(settings: ExtensionSettings): PermissionSettings {
  return {
    commandRules: settings.modelApiCommandRules,
    profiles: settings.modelApiPermissionProfiles,
    profile: settings.modelApiPermissionProfile,
    repositoryRules: settings.modelApiRepositoryRules,
  }
}

/** The subset of settings the webview receives. */
export function toSettingsSnapshot(settings: ExtensionSettings): SettingsSnapshot {
  return {
    preferredLocation: settings.preferredLocation,
    initialPermissionMode: settings.initialPermissionMode,
    autosave: settings.autosave,
    attachOpenFile: settings.attachOpenFile,
    useCtrlEnterToSend: settings.useCtrlEnterToSend,
    hideOnboarding: settings.hideOnboarding,
    focusView: settings.focusView,
    respectGitIgnore: settings.respectGitIgnore,
    confidentialWorkspace: settings.confidentialWorkspace,
    allowDangerouslySkipPermissions: settings.allowDangerouslySkipPermissions,
    archiveInactiveSessions: settings.archiveInactiveSessions,
    modelApiReplyUsage: settings.modelApiReplyUsage,
    museCodeAutoReviewer: settings.museCodeAutoReviewer,
    schedules: settings.schedules,
  }
}
