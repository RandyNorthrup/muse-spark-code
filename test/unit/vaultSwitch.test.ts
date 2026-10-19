// README's legacy vault switch: an explicitly stored `museSpark.vault`
// boolean stays effective until `museSpark.vault.enabled` is explicitly
// configured. Drives the real deferred switch resolver through its designed
// source seam (plain stored values, no stand-ins).
import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { isVaultEnabled, type VaultSwitchSource } from '../../src/host/vault/vaultSwitch'
import { recordingLogger } from './helpers/recordingLogger'

function setup(stored: Readonly<Record<string, unknown>> = {}, explicit: readonly string[] = []) {
  const { log, logged } = recordingLogger()
  const source: VaultSwitchSource = {
    get: (section) => stored[section],
    inspect: (section) => (explicit.includes(section) ? { globalValue: stored[section] } : {}),
  }
  return { enabled: isVaultEnabled(source, log), logged }
}

describe('vault.enabled legacy precedence', () => {
  it('stays on when nothing is stored', () => {
    expect(setup().enabled).toBe(true)
  })
  it('honours an explicitly stored legacy false until the new flag is configured', () => {
    expect(setup({ vault: false }).enabled).toBe(false)
  })
  it('honours an explicitly stored legacy true', () => {
    expect(setup({ vault: true }).enabled).toBe(true)
  })
  it('prefers the explicitly configured new flag over the legacy boolean', () => {
    expect(setup({ vault: true, 'vault.enabled': false }, ['vault.enabled']).enabled).toBe(false)
    expect(setup({ vault: false, 'vault.enabled': true }, ['vault.enabled']).enabled).toBe(true)
  })
  it('defaults on for a non-boolean legacy value', () => {
    const { enabled, logged } = setup({ vault: 'off' })
    expect(enabled).toBe(true)
    expect(logged).toEqual([])
  })
  it('reads the new flag alone from a source without inspect', () => {
    const logged: string[] = []
    const log: Logger = {
      trace: () => undefined,
      info: () => undefined,
      warn: (message) => {
        logged.push(message)
      },
      error: () => undefined,
    }
    const source: VaultSwitchSource = { get: (section) => ({ vault: false })[section] }
    expect(isVaultEnabled(source, log)).toBe(false)
    expect(logged).toEqual([])
  })
})
