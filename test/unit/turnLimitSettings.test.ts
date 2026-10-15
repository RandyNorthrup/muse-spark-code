import { describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { readSettings, type SettingsSource } from '../../src/host/settings'

// Lane TURNLIMIT: the museSpark.modelApiMaxTurnRequests setting reads 0–1000
// (0 is no limit); anything else keeps the default and warns. Pure: the real
// reader, values passed in as data.
function source(values: Record<string, unknown>): SettingsSource {
  return { get: (section: string) => values[section] }
}

function silentLog(): Logger & { warnings: string[] } {
  const warnings: string[] = []
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      warnings.push(message)
    },
    error: () => undefined,
    warnings,
  }
}

describe('modelApiMaxTurnRequests setting', () => {
  it('defaults to no limit', () => {
    const log = silentLog()
    expect(readSettings(source({}), log).modelApiMaxTurnRequests).toBe(0)
    expect(log.warnings).toHaveLength(0)
  })

  it('takes a round count in range', () => {
    const log = silentLog()
    expect(readSettings(source({ modelApiMaxTurnRequests: 50 }), log).modelApiMaxTurnRequests).toBe(
      50,
    )
    expect(log.warnings).toHaveLength(0)
  })

  it.each([-1, 1001, 'fifty', true])('refuses %j and keeps the default', (value) => {
    const log = silentLog()
    expect(
      readSettings(source({ modelApiMaxTurnRequests: value }), log).modelApiMaxTurnRequests,
    ).toBe(0)
    expect(log.warnings).toHaveLength(1)
  })
})
