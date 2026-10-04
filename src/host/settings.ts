// Reads `museSpark.*` settings with runtime validation. VS Code already
// validates against the manifest schema, but settings.json can hold anything,
// so every value is parsed; an invalid value is logged and replaced by the
// documented default so one bad key cannot take the whole panel down.

import * as z from 'zod/mini'
import { checkCommandsSchema } from '../core/verify/checkCommands'
import {
  BACKEND_MODES,
  type BackendMode,
  type CheckCommandSetting,
  type EnvironmentVariable,
  PROMPT_CACHE_RETENTIONS,
  type PromptCacheRetention,
  SANDBOX_NETWORK_MODES,
  type SandboxNetworkMode,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
} from '../shared/constants'
import type { PermissionSettings } from '../core/permissionSettings'
import { type SettingsSnapshot, settingsSnapshotShape } from '../shared/protocol'
import type { Logger } from './logger'

export interface ExtensionSettings extends SettingsSnapshot {
  /** Absolute path to the `muse` executable; empty means "discover". */
  readonly museBinaryPath: string
  readonly environmentVariables: readonly EnvironmentVariable[]
  /** Shell sandbox posture for `muse serve` (PLAN.md D12). */
  readonly shellSandbox: ShellSandboxMode
  /** Which backend hosts conversations (PLAN.md D1, M7). */
  readonly backend: BackendMode
  /** Ctrl+N for a new conversation (read by the keybinding, kept here for the schema). */
  readonly enableNewConversationShortcut: boolean
  /** Days an idle Model API conversation is kept; 0 keeps it (PLAN.md D26). */
  readonly cleanupPeriodDays: number
  /** The paid Model API features (M33–M35, PLAN.md D30): on only with the price accepted too. */
  readonly modelApiWebSearch: boolean
  readonly modelApiImageGeneration: boolean
  readonly modelApiVoice: boolean
  /** The shell sandbox's network for `muse serve` (M56, PLAN.md D43). */
  readonly sandboxNetwork: SandboxNetworkMode
  /** How long Meta is asked to keep the Model API's cached prompt prefix (M56). */
  readonly modelApiPromptCacheRetention: PromptCacheRetention
  readonly modelApiScheduledPrompts: boolean
  readonly modelApiSubagents: boolean
  /** Best-of-N parallel attempts (M77, PLAN.md D49): on only with the price accepted too. */
  readonly modelApiBestOfN: boolean
  /** Explicit machine opt-in for external hook commands (M51). */
  readonly modelApiHooks: boolean
  /**
   * M78 (PLAN.md D49): each kept whole here; the Model API bundle parses
   * every rule and profile and reports what it refuses (permissionPolicy.ts).
   */
  readonly modelApiCommandRules: readonly unknown[]
  readonly modelApiPermissionProfiles: Readonly<Record<string, unknown>>
  readonly modelApiPermissionProfile: unknown
  readonly modelApiRepositoryRules: unknown
  /** The paid Auto reviewer (M78): on only with its price accepted too. */
  readonly modelApiAutoReviewer: boolean
  /** The verify loop (M68, PLAN.md D49): diagnostics after edits, check commands, format on edit. */
  readonly diagnosticsAfterEdits: boolean
  readonly checkCommands: readonly CheckCommandSetting[]
  readonly formatOnEdit: boolean

  /** The repo map in the Model API's system prompt (M67). */
  readonly modelApiRepoMap: boolean
  /** Observation packing on the Model API backend (M73): a conversation reads it when it starts. */
  readonly modelApiObservationPacking: boolean
  /** A checkpoint of the workspace's files at each turn boundary (M72). */
  readonly turnCheckpoints: boolean
  /** The skills that ship with the extension (M89, PLAN.md D68). */
  readonly bundledSkills: boolean
  /** Notify when a turn needs attention while the window is unfocused (M82). */
  readonly notifyOnBackgroundTurn: boolean
  /** Tokens and the dollar estimate under each Model API reply (M82). */
  readonly modelApiReplyUsage: boolean
  /** Session budget cap in USD for Model API requests; 0 is no cap (M82). */
  readonly modelApiSessionBudgetUsd: number
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
  shellSandbox: z.enum(SHELL_SANDBOX_MODES),
  backend: z.enum(BACKEND_MODES),
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
  modelApiHooks: z.boolean(),
  modelApiCommandRules: z.array(z.unknown()),
  modelApiPermissionProfiles: z.record(z.string(), z.unknown()),
  modelApiPermissionProfile: z.unknown(),
  modelApiRepositoryRules: z.unknown(),
  modelApiAutoReviewer: z.boolean(),
  diagnosticsAfterEdits: z.boolean(),
  checkCommands: checkCommandsSchema,
  formatOnEdit: z.boolean(),

  modelApiRepoMap: z.boolean(),
  modelApiObservationPacking: z.boolean(),
  turnCheckpoints: z.boolean(),
  bundledSkills: z.boolean(),
  notifyOnBackgroundTurn: z.boolean(),
  modelApiReplyUsage: z.boolean(),
  modelApiSessionBudgetUsd: z.number().check(z.nonnegative()),
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
  const raw = config.get(key)
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
    shellSandbox: readSetting(config, 'shellSandbox', log),
    backend: readSetting(config, 'backend', log),
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
    modelApiHooks: readSetting(config, 'modelApiHooks', log),
    diagnosticsAfterEdits: readSetting(config, 'diagnosticsAfterEdits', log),
    checkCommands: readSetting(config, 'checkCommands', log),
    formatOnEdit: readSetting(config, 'formatOnEdit', log),
    modelApiRepoMap: readSetting(config, 'modelApiRepoMap', log),
    modelApiObservationPacking: readSetting(config, 'modelApiObservationPacking', log),
    turnCheckpoints: readSetting(config, 'turnCheckpoints', log),
    bundledSkills: readSetting(config, 'bundledSkills', log),
    notifyOnBackgroundTurn: readSetting(config, 'notifyOnBackgroundTurn', log),
    modelApiReplyUsage: readSetting(config, 'modelApiReplyUsage', log),
    modelApiSessionBudgetUsd: readSetting(config, 'modelApiSessionBudgetUsd', log),
    modelApiCommandRules: readSetting(config, 'modelApiCommandRules', log),
    modelApiPermissionProfiles: readSetting(config, 'modelApiPermissionProfiles', log),
    modelApiPermissionProfile: readSetting(config, 'modelApiPermissionProfile', log),
    modelApiRepositoryRules: readSetting(config, 'modelApiRepositoryRules', log),
    modelApiAutoReviewer: readSetting(config, 'modelApiAutoReviewer', log),
    museCodeAutoReviewer: readSetting(config, 'museCodeAutoReviewer', log),
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
  }
}
