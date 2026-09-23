// Reads `museSpark.*` settings with runtime validation. VS Code already
// validates against the manifest schema, but settings.json can hold anything,
// so every value is parsed; an invalid value is logged and replaced by the
// documented default so one bad key cannot take the whole panel down.

import * as z from 'zod/mini'
import {
  BACKEND_MODES,
  type BackendMode,
  type EnvironmentVariable,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
} from '../shared/constants'
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
} as const

type SettingKey = keyof typeof settingSchemas

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
  log.warn(
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
  }
}
