import { Usd, legacyUsdSchema, type UsdAmount } from '../shared/usd'
// Reads `museSpark.*` settings with runtime validation. VS Code already
// validates against the manifest schema, but settings.json can hold anything,
// so every value is parsed; an invalid value is logged and replaced by the
// documented default so one bad key cannot take the whole panel down.

import * as z from 'zod/mini'
import { widenedHost } from '../core/browser/browserPolicy'
import { checkCommandsSchema } from '../core/verify/checkCommands'
import {
  BACKEND_MODES,
  HOOK_RUNNING_COMMANDS_MIN,
  MEDIA_UPLOAD_EXPIRY_DAY_MIN,
  USAGE_HISTORY_DAY_MIN,
  BACKEND_SETTING,
  type BackendMode,
  VAULT_PROTECTION_MODES,
  type VaultProtectionMode,
  type CheckCommandSetting,
  type EnvironmentVariable,
  JUDGE_ENGINES,
  type JudgeEngine,
  LEGAL_HEADER_POLICIES,
  type LegalHeaderPolicy,
  MEDIA_AUDIO_ACTION_OPTIONS,
  MEDIA_CONVERTER_PATH_MAX_CHARS,
  ESTIMATE_OPTIMIZE_MODES,
  type EstimateOptimizeMode,
  PROMPT_CACHE_RETENTIONS,
  type PromptCacheRetention,
  PROMPT_CACHE_TTLS,
  type PromptCacheTtl,
  SANDBOX_NETWORK_MODES,
  type SandboxNetworkMode,
  SCHEDULE_AGENT_CREATIONS,
  SCHEDULE_DELIVERIES,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
  TAB_DAILY_BUDGET_MIN_USD,
  TAB_NO_BUDGET_USD,
  TAB_BYO_MODEL_PATTERN,
  TAB_MODELS,
  TAB_MULTILINE_MODES,
  TAB_TRIGGER_MODES,
  TAB_WITH_COPILOT_MODES,
  type TabModel,
  type TabMultiline,
  type TabTrigger,
  type TabWithCopilot,
} from '../shared/constants'
import { BROWSER_RUNTIME_MODES, type BrowserRuntimeMode } from '../shared/browserCheckConstants'
import type { PermissionSettings } from '../core/permissionSettings'
import { type SettingsSnapshot, settingsSnapshotShape } from '../shared/protocol'
import type { Logger } from './logger'

export interface ExtensionSettings extends SettingsSnapshot {
  readonly usageHistory: boolean
  /** Null keeps history until the person sets a day count or clears it (D121). */
  readonly usageHistoryDays: number | null
  readonly paidDailyBudgetUsd: UsdAmount
  readonly linuxDictationModel: boolean
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
  /** Largest plan file reports read, in bytes; 0 reads the whole plan (D121). */
  readonly 'reports.planMaxBytes': number
  /** Shell sandbox posture for `muse serve` (PLAN.md D12). */
  readonly shellSandbox: ShellSandboxMode
  /** Which backend hosts conversations (PLAN.md D1, M7). */
  readonly backend: BackendMode
  /** Workspace preset suggestion, held by the host (M95, PLAN.md D74). */
  readonly suggestedProvider: string
  /** This app's own xAI OAuth client id; empty until xAI issues one (RLGROKAUTH). */
  readonly grokClientId: string
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
  /** The minimum cache lifetime asked of OpenAI GPT-5.6 and later (RLPROVSYNC). */
  readonly modelApiPromptCacheTtl: PromptCacheTtl
  /** OpenAI's explicit cache breakpoints on GPT-5.6 and later (M95c part 3). */
  readonly modelApiPromptCacheBreakpoints: boolean
  readonly modelApiScheduledPrompts: boolean
  /** The v2 schedules surface (M115, PLAN.md D95): on by default. */
  readonly schedules: boolean
  readonly scheduleDefaultDelivery: (typeof SCHEDULE_DELIVERIES)[number]
  readonly scheduleAgentCreation: (typeof SCHEDULE_AGENT_CREATIONS)[number]
  /**
  Consecutive failures that pause a schedule (M115, PLAN.md D95, D121:
  0 is never — a schedule pauses itself only at a count the person set).
  */
  readonly schedulePauseAfterFailures: number
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
  M78 (PLAN.md D49): each kept whole here; the Model API bundle parses
  every rule and profile and reports what it refuses (permissionPolicy.ts).
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
  readonly tabDailyBudgetUsd: UsdAmount
  /** The person's output cap per Tab request; 0 is the provider's maximum (M94 goal, D121). */
  readonly tabMaxOutputTokens: number
  /** The languages Tab suggests in, like `github.copilot.enable`. */
  readonly editorChatModels: readonly string[]
  readonly tabLanguages: Readonly<Record<string, boolean>>
  /** When Tab adds surrounding context for multi-line completions. */
  readonly tabMultiline: TabMultiline
  /** Whether Tab suggests automatically or only when invoked. */
  readonly tabTrigger: TabTrigger
  /** What Tab does where GitHub Copilot also suggests. */
  readonly tabWithCopilot: TabWithCopilot
  /** The Muse Judge's engine (M98, PLAN.md D77): `auto` is `same` in phase 1. */
  readonly 'judge.engine': JudgeEngine
  /** Configured separate source/model id; empty keeps today's single-model setup. */
  readonly 'judge.separate': string
  /** The fast judge's one switch (M125, D107): on keeps the same-model caution judge only. */
  readonly 'judge.fastPathOff': boolean
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
  /** TOOLCAP: the per-result byte guard. Validated where used; unusable values fall back. */
  readonly modelApiMaxToolOutputBytes: number
  readonly modelApiAutoCompaction: boolean
  readonly modelApiStrictTools: boolean
  readonly modelApiParallelReads: boolean
  readonly webSearchMaxPerRequest: number
  /** Lane RETRYLIMITS: the person's retry limit; null leaves the providers' own maxima in force. */
  readonly modelApiMaxRetries: number | null
  /** Lane RLF-AUTORETRY (D228): resends of a retryable failed Muse Code turn; null is the industry default (2). */
  readonly museCodeMaxRetries: number | null
  /** Stop-hook continuations in a row (M127, D121: 0 is no limit of ours). */
  readonly hooksMaxStopContinuations: number
  /** Running hook commands at once; 0 starts them all (M127, as Muse Code). */
  readonly hooksMaxRunningCommands: number
  /** Concurrent subagents (M127, D121: 0 is no limit of ours). */
  readonly subagentMaxConcurrent: number
  /** Seconds a plugin hook waits for its child (D121: 0 waits for the answer or Stop). */
  readonly pluginHookTimeoutSeconds: number
  /** A plugin child's memory ceiling in MiB (D121: 0 is the runtime's own default). */
  readonly pluginChildMaxMemoryMiB: number
  /** A plugin answer's frame cap in bytes (D121: 0 reads answers whole). */
  readonly pluginAnswerMaxBytes: number
  /** Windows job-launcher failures that set plugin hooks aside (D121: 0 keeps trying). */
  readonly pluginMaxFailures: number
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
  readonly modelApiSessionBudgetUsd: UsdAmount
  /** Drive the Model API backend from the Muse Code subscription (C-M95-SUB). */
  readonly useMuseCodeSubscription: boolean
  /** Copyright/SPDX header hygiene for the read-only legal scan (M97). */
  readonly legalRegistryLookups: boolean
  readonly legalExplanation: boolean
  readonly legalHeaderPolicy: LegalHeaderPolicy
  /** M105 (PLAN.md D85): multimodal input caps; machine scoped, billed on the key. */
  readonly mediaMaxUploadMiB: number
  readonly mediaUploadExpiryDays: number
  readonly screenRecordingMaxSeconds: number
  readonly mediaAudioAction: (typeof MEDIA_AUDIO_ACTION_OPTIONS)[number]
  /** M105 lane V: an absolute converter path; empty uses documented installs only. */
  readonly mediaConverterPath: string
  /** M108 (PLAN.md D88.5): swap at the next request boundary; on by default. */
  readonly accountSwap: boolean
  /** M108 (PLAN.md D88.5): spread background work across accounts; on by default. */
  readonly accountParallel: boolean
  /** D88 amendment b2: several accounts of one provider on this PC; off by default. */
  readonly 'accounts.severalOnThisDevice': boolean
  /** M123 (PLAN.md D104 source c): the user's `gh` login for GitHub; off by default. */
  readonly 'github.useGhLogin': boolean
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
The one method this module needs from `vscode.WorkspaceConfiguration`,
which satisfies it structurally. Keeping the dependency this narrow makes
the reader trivially fakeable in unit tests.
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
  // D121: no bound of ours — any whole number of seconds at or above zero
  // is taken as set (0 never defers); the host reader refuses the rest.
  'questions.deferAfterSeconds': z.int().check(z.gte(0)),
  'reports.network': z.enum(['whenSignedIn', 'always', 'off']),
  'reports.keepHistory': z.boolean(),
  'reports.planMaxBytes': z.int().check(z.gte(0)),
  'reports.agentSources': z
    .array(z.enum(['claudeCode', 'codex']))
    .check(z.refine((values) => new Set(values).size === values.length)),
  shellSandbox: z.enum(SHELL_SANDBOX_MODES),
  backend: z.enum(BACKEND_MODES),
  suggestedProvider: z.string(),
  grokClientId: z.string(),
  enableNewConversationShortcut: z.boolean(),
  cleanupPeriodDays: z.int().check(z.nonnegative()),
  modelApiWebSearch: z.boolean(),
  modelApiImageGeneration: z.boolean(),
  modelApiVoice: z.boolean(),
  sandboxNetwork: z.enum(SANDBOX_NETWORK_MODES),
  modelApiPromptCacheRetention: z.enum(PROMPT_CACHE_RETENTIONS),
  modelApiPromptCacheTtl: z.enum(PROMPT_CACHE_TTLS),
  modelApiPromptCacheBreakpoints: z.boolean(),
  modelApiScheduledPrompts: z.boolean(),
  schedules: z.boolean(),
  scheduleDefaultDelivery: z.enum(SCHEDULE_DELIVERIES),
  scheduleAgentCreation: z.enum(SCHEDULE_AGENT_CREATIONS),
  schedulePauseAfterFailures: z.number().check(z.int(), z.gte(0)),
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
  tabModel: z.union([
    z.enum(TAB_MODELS),
    z.custom<`${string}/${string}`>(
      (value) => typeof value === 'string' && TAB_BYO_MODEL_PATTERN.test(value),
    ),
  ]),
  // 0 is no budget; a set budget starts at the dust floor, with no ceiling.
  tabDailyBudgetUsd: legacyUsdSchema.check(
    z.refine(
      (value) =>
        Usd.from(value).compare(Usd.from(TAB_NO_BUDGET_USD)) === 0 ||
        Usd.from(value).compare(Usd.from(TAB_DAILY_BUDGET_MIN_USD)) >= 0,
    ),
  ),
  // D121: 0 is the provider's maximum for the model (the default); a set
  // whole count caps the request at what the person set.
  tabMaxOutputTokens: z.number().check(z.int(), z.gte(0)),
  editorChatModels: z.array(z.string().check(z.minLength(1))),
  tabLanguages: z.record(z.string(), z.boolean()),
  tabMultiline: z.enum(TAB_MULTILINE_MODES),
  tabTrigger: z.enum(TAB_TRIGGER_MODES),
  tabWithCopilot: z.enum(TAB_WITH_COPILOT_MODES),
  'judge.engine': z.enum(JUDGE_ENGINES),
  'judge.separate': z.string(),
  'judge.fastPathOff': z.boolean(),
  'estimator.optimize': z.enum(ESTIMATE_OPTIMIZE_MODES),
  'estimator.priceLookup': z.boolean(),
  diagnosticsAfterEdits: z.boolean(),
  checkCommands: checkCommandsSchema,
  formatOnEdit: z.boolean(),

  modelApiRepoMap: z.boolean(),
  modelApiObservationPacking: z.boolean(),
  modelApiMaxToolOutputBytes: z.number().check(z.int(), z.gte(0)),
  modelApiAutoCompaction: z.boolean(),
  modelApiStrictTools: z.boolean(),
  modelApiParallelReads: z.boolean(),
  // D121: 0 is no search bound of ours (the default); a set whole count of
  // at least 1 sends as set (NOLIMITSSET: the removed 20 was ours — no
  // capability record carries one). Anything else refuses with the setting
  // named, never clamped silently.
  webSearchMaxPerRequest: z.number().check(z.int(), z.gte(0)),
  // Lane RETRYLIMITS: null (unset) is the default; 0 never retries.
  modelApiMaxRetries: z.nullable(z.int().check(z.gte(0))),
  // Lane RLF-AUTORETRY (D228): null (unset) resends twice, the industry default; 0 never resends.
  museCodeMaxRetries: z.nullable(z.int().check(z.gte(0))),
  // D121: 0 is no limit of ours (the default); a set whole count governs as
  // set (NOLIMITSSET: the removed 8 was ours — no provider documents one).
  // Anything else refuses with the setting named, never clamped silently.
  hooksMaxStopContinuations: z.number().check(z.int(), z.gte(0)),
  hooksMaxRunningCommands: z.number().check(z.int(), z.gte(HOOK_RUNNING_COMMANDS_MIN)),
  // D121: 0 is no limit of ours (the default); a set whole count governs as
  // set (NOLIMITSSET: the removed 64 was ours — no provider documents one).
  subagentMaxConcurrent: z.number().check(z.int(), z.gte(0)),
  pluginHookTimeoutSeconds: z.number().check(z.int(), z.gte(0)),
  pluginChildMaxMemoryMiB: z.number().check(z.int(), z.gte(0)),
  pluginAnswerMaxBytes: z.number().check(z.int(), z.gte(0)),
  pluginMaxFailures: z.number().check(z.int(), z.gte(0)),
  turnCheckpoints: z.boolean(),
  // Each entry a plain host name or IP address (no port, path or wildcard):
  // one that is not refuses the whole list, so a typo warns rather than
  // widening something else.
  // NOLIMITSSET (PLAN.md D121): no host-count ceiling of ours — every host
  // the person names is kept (the removed 32 was ours). Each entry stays a
  // plain host name or IP address; one that is not refuses the whole list.
  browserCheckExtraHosts: z.array(
    z.string().check(z.refine((entry) => widenedHost(entry) !== undefined)),
  ),
  browserCheckRuntime: z.enum(BROWSER_RUNTIME_MODES),
  bundledSkills: z.boolean(),
  showWhatsNewOnUpdate: z.boolean(),
  notifyOnBackgroundTurn: z.boolean(),
  modelApiReplyUsage: z.boolean(),
  // D121: a limit the person sets; 0 is none (the default), and no upper bound is ours.
  paidDailyBudgetUsd: legacyUsdSchema,
  linuxDictationModel: z.boolean(),
  dictationEngine: z.enum(['system', 'museVoice']),
  modelApiSessionBudgetUsd: legacyUsdSchema,
  useMuseCodeSubscription: z.boolean(),
  legalRegistryLookups: z.boolean(),
  legalExplanation: z.boolean(),
  legalHeaderPolicy: z.enum(LEGAL_HEADER_POLICIES),
  usageHistory: z.boolean(),
  // NOLIMITSSET (PLAN.md D121): null (the default) keeps history until the
  // person sets a day count or clears it; a set whole number of days of at
  // least 1 trims as set. Anything else refuses with the setting named.
  usageHistoryDays: z.nullable(z.int().check(z.gte(USAGE_HISTORY_DAY_MIN))),
  // No ceiling of ours: the person sets any MiB, the provider refuses what it cannot take.
  // D121: 0 is no cap of ours (the default).
  mediaMaxUploadMiB: z.int().check(z.gte(0)),
  // NOLIMITSSET (PLAN.md D121): the person's whole days, honoured as set —
  // 7 by default; no capability record carries a range, so the removed 1–30
  // was ours. Anything else refuses with the setting named.
  mediaUploadExpiryDays: z.int().check(z.gte(MEDIA_UPLOAD_EXPIRY_DAY_MIN)),
  // D121: 0 records until stopped (the default); any other whole number of
  // seconds is used as set, with no floor or ceiling of ours.
  screenRecordingMaxSeconds: z.int().check(z.gte(0)),
  mediaAudioAction: z.enum(MEDIA_AUDIO_ACTION_OPTIONS),
  mediaConverterPath: z.string().check(z.maxLength(MEDIA_CONVERTER_PATH_MAX_CHARS)),
  accountSwap: z.boolean(),
  accountParallel: z.boolean(),
  'accounts.severalOnThisDevice': z.boolean(),
  'github.useGhLogin': z.boolean(),
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
  let previousKey: string | undefined
  if (key === 'scheduleDefaultDelivery') previousKey = 'schedules.defaultDelivery'
  const raw = config.get(key) ?? (previousKey === undefined ? undefined : config.get(previousKey))
  // The keyed schema validates its matching default; TypeScript cannot correlate indexed K (PLAN §8).
  const fallback = settingSchemas[key].parse(SETTING_DEFAULTS[key]) as ExtensionSettings[K]
  if (raw === undefined) {
    return fallback
  }
  const result = settingSchemas[key].safeParse(raw)
  if (result.success) {
    // The schema belongs to this exact key; indexed schema results lose that correlation (PLAN §8).
    return result.data as ExtensionSettings[K]
  }
  warnOnce(
    log,
    `${key}=${JSON.stringify(raw)}`,
    `Setting ${SETTINGS_SECTION}.${key} is invalid and its default is in effect: ${z.prettifyError(result.error)}`,
  )
  return fallback
}

/** A setting's name under the section; the runtime's settings store keys by it (M104 lane B). */
export type SettingName = SettingKey

/** Whether `name` is one of the settings this product declares. */
export function isSettingName(name: string): name is SettingName {
  return Object.hasOwn(settingSchemas, name)
}

/** `value` as setting `name` accepts it; throws the schema's error when it is not one. */
export function parseSettingValue(name: SettingName, value: unknown): unknown {
  return settingSchemas[name].parse(value)
}

export function readSettings(config: SettingsSource, log: Logger): ExtensionSettings {
  // C-X-1: unbound settings retain their stored values, but have no runtime reader.
  // Typed contracts carry defaults until their actual owners bind.
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
    'reports.planMaxBytes': readSetting(config, 'reports.planMaxBytes', log),
    'reports.agentSources': readSetting(config, 'reports.agentSources', log),
    shellSandbox: readSetting(config, 'shellSandbox', log),
    backend: readSetting(config, 'backend', log),
    suggestedProvider: readSetting(config, 'suggestedProvider', log),
    grokClientId: readSetting(config, 'grokClientId', log),
    enableNewConversationShortcut: readSetting(config, 'enableNewConversationShortcut', log),
    cleanupPeriodDays: readSetting(config, 'cleanupPeriodDays', log),
    modelApiWebSearch: readSetting(config, 'modelApiWebSearch', log),
    modelApiImageGeneration: readSetting(config, 'modelApiImageGeneration', log),
    modelApiVoice: readSetting(config, 'modelApiVoice', log),
    sandboxNetwork: readSetting(config, 'sandboxNetwork', log),
    modelApiPromptCacheRetention: readSetting(config, 'modelApiPromptCacheRetention', log),
    modelApiPromptCacheTtl: readSetting(config, 'modelApiPromptCacheTtl', log),
    modelApiPromptCacheBreakpoints: readSetting(config, 'modelApiPromptCacheBreakpoints', log),
    modelApiScheduledPrompts: readSetting(config, 'modelApiScheduledPrompts', log),
    schedules: readSetting(config, 'schedules', log),
    scheduleDefaultDelivery: readSetting(config, 'scheduleDefaultDelivery', log),
    scheduleAgentCreation: SETTING_DEFAULTS.scheduleAgentCreation,
    schedulePauseAfterFailures: readSetting(config, 'schedulePauseAfterFailures', log),
    modelApiSubagents: readSetting(config, 'modelApiSubagents', log),
    modelApiBestOfN: readSetting(config, 'modelApiBestOfN', log),
    modelApiTeamWorkers: SETTING_DEFAULTS.modelApiTeamWorkers,
    modelApiHooks: readSetting(config, 'modelApiHooks', log),
    modelApiShellKeepsDirectory: readSetting(config, 'modelApiShellKeepsDirectory', log),
    modelApiHookModels: readSetting(config, 'modelApiHookModels', log),
    hookHttpAllowedHosts: readSetting(config, 'hookHttpAllowedHosts', log),
    diagnosticsAfterEdits: readSetting(config, 'diagnosticsAfterEdits', log),
    checkCommands: readSetting(config, 'checkCommands', log),
    formatOnEdit: readSetting(config, 'formatOnEdit', log),
    modelApiRepoMap: readSetting(config, 'modelApiRepoMap', log),
    modelApiObservationPacking: readSetting(config, 'modelApiObservationPacking', log),
    modelApiMaxToolOutputBytes: readSetting(config, 'modelApiMaxToolOutputBytes', log),
    modelApiAutoCompaction: readSetting(config, 'modelApiAutoCompaction', log),
    modelApiStrictTools: readSetting(config, 'modelApiStrictTools', log),
    modelApiParallelReads: readSetting(config, 'modelApiParallelReads', log),
    webSearchMaxPerRequest: readSetting(config, 'webSearchMaxPerRequest', log),
    modelApiMaxRetries: readSetting(config, 'modelApiMaxRetries', log),
    museCodeMaxRetries: readSetting(config, 'museCodeMaxRetries', log),
    hooksMaxStopContinuations: readSetting(config, 'hooksMaxStopContinuations', log),
    hooksMaxRunningCommands: readSetting(config, 'hooksMaxRunningCommands', log),
    subagentMaxConcurrent: readSetting(config, 'subagentMaxConcurrent', log),
    pluginHookTimeoutSeconds: readSetting(config, 'pluginHookTimeoutSeconds', log),
    pluginChildMaxMemoryMiB: readSetting(config, 'pluginChildMaxMemoryMiB', log),
    pluginAnswerMaxBytes: readSetting(config, 'pluginAnswerMaxBytes', log),
    pluginMaxFailures: readSetting(config, 'pluginMaxFailures', log),
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
    linuxDictationModel: readSetting(config, 'linuxDictationModel', log),
    dictationEngine: readSetting(config, 'dictationEngine', log),
    modelApiSessionBudgetUsd: readSetting(config, 'modelApiSessionBudgetUsd', log),
    useMuseCodeSubscription: readSetting(config, 'useMuseCodeSubscription', log),
    modelApiCommandRules: readSetting(config, 'modelApiCommandRules', log),
    modelApiPermissionProfiles: readSetting(config, 'modelApiPermissionProfiles', log),
    modelApiPermissionProfile: readSetting(config, 'modelApiPermissionProfile', log),
    modelApiRepositoryRules: readSetting(config, 'modelApiRepositoryRules', log),
    modelApiAutoReviewer: readSetting(config, 'modelApiAutoReviewer', log),
    'judge.engine': readSetting(config, 'judge.engine', log),
    'judge.separate': readSetting(config, 'judge.separate', log),
    'judge.fastPathOff': readSetting(config, 'judge.fastPathOff', log),
    'estimator.optimize': SETTING_DEFAULTS['estimator.optimize'],
    'estimator.priceLookup': SETTING_DEFAULTS['estimator.priceLookup'],
    museCodeAutoReviewer: readSetting(config, 'museCodeAutoReviewer', log),
    modelApiTab: readSetting(config, 'modelApiTab', log),
    tabModel: readSetting(config, 'tabModel', log),
    tabDailyBudgetUsd: readSetting(config, 'tabDailyBudgetUsd', log),
    tabMaxOutputTokens: readSetting(config, 'tabMaxOutputTokens', log),
    editorChatModels: readSetting(config, 'editorChatModels', log),
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
    mediaConverterPath: readSetting(config, 'mediaConverterPath', log),
    // M108: swap and spread stay readable while uncertified, like the lane's
    // certified state; the certification switch and unbound owners refuse
    // every binding, so reading them enables nothing until C-M108-2 closes.
    // The visible several-accounts toggle stays compatibility-only (main's
    // neutering) until its own completion slice restores text and reading.
    accountSwap: readSetting(config, 'accountSwap', log),
    accountParallel: readSetting(config, 'accountParallel', log),
    'accounts.severalOnThisDevice': SETTING_DEFAULTS['accounts.severalOnThisDevice'],
    'github.useGhLogin': readSetting(config, 'github.useGhLogin', log),
    // The live switch (with its legacy precedence) resolves where the vault
    // runs; activation carries the configured flag for the round trip only.
    'vault.enabled': readSetting(config, 'vault.enabled', log),
    'vault.protection': SETTING_DEFAULTS['vault.protection'],
    'vault.agentFence': readSetting(config, 'vault.agentFence', log),
    'vault.lockAfterIdleMinutes': SETTING_DEFAULTS['vault.lockAfterIdleMinutes'],
    'vault.lockOnScreenLock': SETTING_DEFAULTS['vault.lockOnScreenLock'],
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
    'estimator.optimize': settings['estimator.optimize'],
  }
}

/** Configuration that changes the credential source must restart the backend. */
export function requiresBackendRestart(isAffected: (key: string) => boolean): boolean {
  return isAffected(BACKEND_SETTING) || isAffected(`${SETTINGS_SECTION}.useMuseCodeSubscription`)
}
