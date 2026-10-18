// README's legacy vault switch: an explicitly stored `museSpark.vault`
// boolean stays effective until `museSpark.vault.enabled` is explicitly
// configured. Drives the real readSettings through its designed
// SettingsSource seam (plain stored values, no stand-ins).
import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { readSettings, type SettingsSource } from '../../src/host/settings'
import { recordLogger } from './helpers/recordLogger'

function setup(stored: Readonly<Record<string, unknown>> = {}, explicit: readonly string[] = []) {
  const { log, logged } = recordLogger()
  const source: SettingsSource = {
    get: (section) => stored[section],
    inspect: (section) => (explicit.includes(section) ? { globalValue: stored[section] } : {}),
  }
  return { settings: readSettings(source, log), logged }
}

describe('vault.enabled legacy precedence', () => {
  it('stays on when nothing is stored', () => {
    expect(setup().settings['vault.enabled']).toBe(true)
  })
  it('honours an explicitly stored legacy false until the new flag is configured', () => {
    expect(setup({ vault: false }).settings['vault.enabled']).toBe(false)
  })
  it('honours an explicitly stored legacy true', () => {
    expect(setup({ vault: true }).settings['vault.enabled']).toBe(true)
  })
  it('prefers the explicitly configured new flag over the legacy boolean', () => {
    expect(
      setup({ vault: true, 'vault.enabled': false }, ['vault.enabled']).settings['vault.enabled'],
    ).toBe(false)
    expect(
      setup({ vault: false, 'vault.enabled': true }, ['vault.enabled']).settings['vault.enabled'],
    ).toBe(true)
  })
  it('defaults on for a non-boolean legacy value', () => {
    const { settings, logged } = setup({ vault: 'off' })
    expect(settings['vault.enabled']).toBe(true)
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
    const source: SettingsSource = { get: (section) => ({ vault: false })[section] }
    expect(readSettings(source, log)['vault.enabled']).toBe(false)
    expect(logged).toEqual([])
  })
})
