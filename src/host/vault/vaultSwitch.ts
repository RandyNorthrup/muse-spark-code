// The credential vault's on/off switch (README's legacy flag), resolved where
// the vault runs: dist/vault.js reads it on the first vault use, so nothing
// on the activation path grows past the loader. Activation keeps the default;
// this resolution is the live one.
import * as z from 'zod/mini'
import { SETTINGS_SECTION } from '../../shared/constants'
import type { Logger } from '../logger'

/** What the switch reads: VS Code's configuration section doubles as this. */
export interface VaultSwitchSource {
  get(section: string): unknown
  inspect?(section: string): { readonly globalValue?: unknown } | undefined
}

// An invalid flag value is reported once per logger. Mirrors the settings
// reader's warning; keep the schema in step with settingSchemas['vault.enabled'].
const reported = new WeakMap<Logger, Set<string>>()

/**
 * README's legacy vault switch: an explicitly stored `museSpark.vault`
 * boolean stays effective until `museSpark.vault.enabled` is explicitly
 * configured. Explicitness needs `inspect` (VS Code's `get` merges the true
 * default, so it cannot tell configured from defaulted); a source without
 * it reads the new flag alone.
 */
export function isVaultEnabled(config: VaultSwitchSource, log: Logger): boolean {
  // The new flag is machine-scoped, so only its global value can be set;
  // the legacy key is unregistered, so `get` (which merges no default for
  // it) reports exactly what is stored. A non-boolean legacy value is not a
  // switch position, so the default stays in effect for it.
  const explicit = config.inspect?.('vault.enabled')?.globalValue
  const legacy = explicit === undefined ? config.get('vault') : undefined
  if (typeof legacy === 'boolean') {
    return legacy
  }
  const raw = config.get('vault.enabled')
  if (raw === undefined) {
    return true
  }
  const result = z.boolean().safeParse(raw)
  if (result.success) {
    return result.data
  }
  const key = 'vault.enabled'
  const seenKey = `${key}=${JSON.stringify(raw)}`
  let seen = reported.get(log)
  if (seen === undefined) {
    seen = new Set<string>()
    reported.set(log, seen)
  }
  if (!seen.has(seenKey)) {
    seen.add(seenKey)
    log.warn(
      `Setting ${SETTINGS_SECTION}.${key} is invalid and its default is in effect: ${z.prettifyError(result.error)}`,
    )
  }
  return true
}
