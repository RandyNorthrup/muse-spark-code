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
  VAULT_PROTECTION_MODES,
  type VaultProtectionMode,
  BROWSER_CHECK_EXTRA_HOSTS_MAX,
  BROWSER_RUNTIME_MODES,
  type BrowserRuntimeMode,
  type CheckCommandSetting,
  type EnvironmentVariable,
  JUDGE_ENGINES,
  type JudgeEngine,
  LEGAL_HEADER_POLICIES,
  type LegalHeaderPolicy,
  MEDIA_AUDIO_ACTION_OPTIONS,
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_UPLOAD_EXPIRY_MAX_DAYS,
  MEDIA_UPLOAD_EXPIRY_MIN_DAYS,
  ESTIMATE_OPTIMIZE_MODES,
  type EstimateOptimizeMode,
  PROMPT_CACHE_RETENTIONS,
  QUESTION_DEFER_MAX_SECONDS,
  type PromptCacheRetention,
  SANDBOX_NETWORK_MODES,
  type SandboxNetworkMode,
  SCREEN_RECORDING_MAX_SECONDS,
  SCREEN_RECORDING_MIN_SECONDS,
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
  /** The capacity estimator's setup search (M117, PLAN.md D97). */
  readonly 'estimator.optimize': EstimateOptimizeMode
  /** Public catalog price lookup for rented servers (M117, PLAN.md D97). */
  readonly 'estimator.priceLookup': boolean
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
  /** M105 (PLAN.md D85): multimodal input caps; machine scoped, billed on the key. */
  readonly mediaMaxUploadMiB: number
  readonly mediaUploadExpiryDays: number
  readonly screenRecordingMaxSeconds: number
  readonly mediaAudioAction: (typeof MEDIA_AUDIO_ACTION_OPTIONS)[number]
  /** M108 (PLAN.md D88.5): swap at the next request boundary; on by default. */
  readonly accountSwap: boolean
  /** M108 (PLAN.md D88.5): spread background work across accounts; on by default. */
  readonly accountParallel: boolean
  /** D88 amendment b2: several accounts of one provider on this PC; off by default. */
  readonly 'accounts.severalOnThisDevice': boolean
  /** The per-user credential vault, shared by every editor (M109, PLAN.md D89). */
  readonly 'vault.enabled': boolean
  /** How the vault key is protected; `auto` is hardware plus the OS store. */
  readonly 'vault.protection': VaultProtectionMode
  /** Fence agent processes from ambient credential routes. */
  readonly 'vault.agentFence': boolean
  /** Idle minutes before the vault locks. */
  readonly 'vault.lockAfterIdleMinutes': number
  /** Lock the vault when the OS reports a screen lock. */
  readonly 'vault.lockOnScreenLock': boolean
}

/**
 * The one method this module needs from `vscode.WorkspaceConfiguration`,
 * which satisfies it structurally. Keeping the dependency this narrow makes
 * the reader trivially fakeable in unit tests.
 */
interface StoredSettingValues {
  readonly globalValue?: unknown
  readonly workspaceValue?: unknown
  readonly workspaceFolderValue?: unknown
}

export interface SettingsSource {
  get(section: string): unknown
  inspect?(section: string): StoredSettingValues | undefined
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
  'estimator.optimize': z.enum(ESTIMATE_OPTIMIZE_MODES),
  'estimator.priceLookup': z.boolean(),
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
  mediaMaxUploadMiB: z.int().check(z.gte(1), z.lte(MEDIA_MAX_UPLOAD_MIB)),
  mediaUploadExpiryDays: z
    .int()
    .check(z.gte(MEDIA_UPLOAD_EXPIRY_MIN_DAYS), z.lte(MEDIA_UPLOAD_EXPIRY_MAX_DAYS)),
  screenRecordingMaxSeconds: z
    .int()
    .check(z.gte(SCREEN_RECORDING_MIN_SECONDS), z.lte(SCREEN_RECORDING_MAX_SECONDS)),
  mediaAudioAction: z.enum(MEDIA_AUDIO_ACTION_OPTIONS),
  accountSwap: z.boolean(),
  accountParallel: z.boolean(),
  'accounts.severalOnThisDevice': z.boolean(),
  'vault.enabled': z.boolean(),
  'vault.protection': z.enum(VAULT_PROTECTION_MODES),
  'vault.agentFence': z.boolean(),
  'vault.lockAfterIdleMinutes': z.int().check(z.nonnegative()),
  'vault.lockOnScreenLock': z.boolean(),
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
  let raw = config.get(key)
  if (key === 'vault.enabled') {
    const configured = config.inspect?.(key)
    const hasExplicit =
      configured === undefined
        ? raw !== undefined
        : [configured.globalValue, configured.workspaceValue, configured.workspaceFolderValue].some(
            (value) => value !== undefined,
          )
    if (!hasExplicit) {
      // A legacy scalar collides with the new group defaults, so inspect its
      // stored value rather than relying on VS Code's merged group object.
      const legacy = config.inspect?.('vault')?.globalValue ?? config.get('vault')
      if (typeof legacy === 'boolean') raw = legacy
    }
  }
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
    'estimator.optimize': readSetting(config, 'estimator.optimize', log),
    'estimator.priceLookup': readSetting(config, 'estimator.priceLookup', log),
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
    mediaMaxUploadMiB: readSetting(config, 'mediaMaxUploadMiB', log),
    mediaUploadExpiryDays: readSetting(config, 'mediaUploadExpiryDays', log),
    screenRecordingMaxSeconds: readSetting(config, 'screenRecordingMaxSeconds', log),
    mediaAudioAction: readSetting(config, 'mediaAudioAction', log),
    accountSwap: readSetting(config, 'accountSwap', log),
    accountParallel: readSetting(config, 'accountParallel', log),
    'accounts.severalOnThisDevice': readSetting(config, 'accounts.severalOnThisDevice', log),
    'vault.enabled': readSetting(config, 'vault.enabled', log),
    'vault.protection': readSetting(config, 'vault.protection', log),
    'vault.agentFence': readSetting(config, 'vault.agentFence', log),
    'vault.lockAfterIdleMinutes': readSetting(config, 'vault.lockAfterIdleMinutes', log),
    'vault.lockOnScreenLock': readSetting(config, 'vault.lockOnScreenLock', log),
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
    'estimator.optimize': settings['estimator.optimize'],
  }
}
