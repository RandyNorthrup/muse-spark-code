// The Muse Code CLI's own settings file, read for two facts. Whether native
// subagent delegation is on (PLAN.md D17): Muse Code 1.3.0 hides its
// subagent tools unless `run.subagent_delegation_mode` is `"auto"` in
// `$XDG_CONFIG_HOME/muse/settings.json` (else `~/.config/muse/settings.json`),
// and the panel can only spawn agents when the CLI lets the model do so. And
// when the model may start a workflow (M47, PLAN.md D40):
// `run.workflow_trigger_mode`, `auto`, `explicit` or `off`.
// Read only; the extension never writes this file. The user opens it from
// the Agent map when they want to change it.

import * as z from 'zod/mini'
import {
  MUSE_DELEGATION_DEFAULT,
  MUSE_SETTINGS_FILE_SEGMENTS,
  MUSE_WORKFLOW_TRIGGER_DEFAULT,
} from '../../../shared/constants'
import type { CredentialPathInput } from './launch'
import path from 'node:path'

export interface MuseSettingsDeps extends CredentialPathInput {
  /** Returns undefined when the file cannot be read. */
  readonly readTextFile: (filePath: string) => string | undefined
}

/**
 * Only the members the extension reads are checked, each on its own, so one
 * of another type costs that fact alone, never the other. Anything else in
 * the file is ignored, never kept. `contributor_mode_enabled` is the CLI's
 * own top-level price tier flag (captured 2026-10-14, CLI 1.4.6).
 */
const settingsSchema = z.object({
  run: z.optional(z.record(z.string(), z.unknown())),
  contributor_mode_enabled: z.optional(z.boolean()),
})

export function museSettingsPath(input: CredentialPathInput): string {
  const p = input.platform === 'win32' ? path.win32 : path.posix
  const configHome = input.xdgConfigHome ?? p.join(input.homeDir, '.config')
  return p.join(configHome, ...MUSE_SETTINGS_FILE_SEGMENTS)
}

/** One string member of the file's `run` block; undefined when missing, unreadable or not a string. */
function readRunSetting(deps: MuseSettingsDeps, key: string): string | undefined {
  const text = deps.readTextFile(museSettingsPath(deps))
  if (text === undefined) {
    return undefined
  }
  try {
    const value = settingsSchema.safeParse(JSON.parse(text)).data?.run?.[key]
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** `run.subagent_delegation_mode`, or the CLI's default when unset or unreadable. */
export function readDelegationMode(deps: MuseSettingsDeps): string {
  return readRunSetting(deps, 'subagent_delegation_mode') ?? MUSE_DELEGATION_DEFAULT
}

/** `run.workflow_trigger_mode` (M47), or the CLI's default when unset or unreadable. */
export function readWorkflowTriggerMode(deps: MuseSettingsDeps): string {
  return readRunSetting(deps, 'workflow_trigger_mode') ?? MUSE_WORKFLOW_TRIGGER_DEFAULT
}

/**
 * The CLI's contributor mode: true or false when its settings say so,
 * undefined when the file is missing, unreadable or says otherwise. Never a
 * guess: the problem report prints unknown instead.
 */
export function readContributorMode(deps: MuseSettingsDeps): boolean | undefined {
  const text = deps.readTextFile(museSettingsPath(deps))
  if (text === undefined) return undefined
  try {
    const value = settingsSchema.safeParse(JSON.parse(text)).data?.contributor_mode_enabled
    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}
