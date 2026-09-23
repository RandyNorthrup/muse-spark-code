// The Muse Code CLI's own settings file, read for one fact (PLAN.md D17):
// whether native subagent delegation is on. Muse Code 1.3.0 hides its
// subagent tools unless `run.subagent_delegation_mode` is `"auto"` in
// `$XDG_CONFIG_HOME/muse/settings.json` (else `~/.config/muse/settings.json`),
// and the panel can only spawn agents when the CLI lets the model do so.
// Read only; the extension never writes this file. The user opens it from
// the Agent map when they want to change it.

import * as z from 'zod/mini'
import { MUSE_DELEGATION_DEFAULT, MUSE_SETTINGS_FILE_SEGMENTS } from '../../shared/constants'
import type { CredentialPathInput } from '../../core/backends/musecode/launch'
import path from 'node:path'

export interface MuseSettingsDeps extends CredentialPathInput {
  /** Returns undefined when the file cannot be read. */
  readonly readTextFile: (filePath: string) => string | undefined
}

/** Only the member the extension reads; everything else is the CLI's business. */
const settingsSchema = z.object({
  run: z.optional(z.object({ subagent_delegation_mode: z.optional(z.string()) })),
})

export function museSettingsPath(input: CredentialPathInput): string {
  const p = input.platform === 'win32' ? path.win32 : path.posix
  const configHome = input.xdgConfigHome ?? p.join(input.homeDir, '.config')
  return p.join(configHome, ...MUSE_SETTINGS_FILE_SEGMENTS)
}

/** `run.subagent_delegation_mode`, or the CLI's default when unset or unreadable. */
export function readDelegationMode(deps: MuseSettingsDeps): string {
  const text = deps.readTextFile(museSettingsPath(deps))
  if (text === undefined) {
    return MUSE_DELEGATION_DEFAULT
  }
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(text))
    return parsed.success
      ? (parsed.data.run?.subagent_delegation_mode ?? MUSE_DELEGATION_DEFAULT)
      : MUSE_DELEGATION_DEFAULT
  } catch {
    return MUSE_DELEGATION_DEFAULT
  }
}
