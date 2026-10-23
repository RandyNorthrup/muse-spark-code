import { describe, expect, it } from 'vitest'
import { readSettings } from '../../src/host/settings'

const log = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function clientIdOf(value: unknown) {
  return readSettings(
    {
      get: (key: string) => (key === 'grokClientId' ? value : undefined),
    },
    log,
  ).grokClientId
}

describe('Grok client id setting (RLGROKAUTH)', () => {
  it('is empty until xAI issues one, and keeps the configured id', () => {
    expect(clientIdOf(undefined)).toBe('')
    expect(clientIdOf('muse-spark-code.test-client')).toBe('muse-spark-code.test-client')
  })

  it('falls back to empty for a non-string value', () => {
    expect(clientIdOf(42)).toBe('')
  })
})
