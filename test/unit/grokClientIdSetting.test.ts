import { describe, expect, it } from 'vitest'
import { readSettings, type SettingsSource } from '../../src/host/settings'
import { collectingLogger } from './helpers/collectingLogger'

function grokClientIdFrom(values: ReadonlyMap<string, unknown>): string {
  const source: SettingsSource = { get: (key) => values.get(key) }
  return readSettings(source, collectingLogger([])).grokClientId
}

describe('Grok client id setting (RLGROKAUTH)', () => {
  it('is empty until xAI issues one, and keeps the configured id', () => {
    expect(grokClientIdFrom(new Map())).toBe('')
    expect(grokClientIdFrom(new Map([['grokClientId', 'muse-spark-code.test-client']]))).toBe(
      'muse-spark-code.test-client',
    )
  })

  it('falls back to empty for a non-string value', () => {
    expect(grokClientIdFrom(new Map([['grokClientId', 42]]))).toBe('')
  })
})
