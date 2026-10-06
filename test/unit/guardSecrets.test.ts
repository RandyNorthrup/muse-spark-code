import { describe, expect, it } from 'vitest'
import { countSecretMatches as realCount, redactSecrets as realRedact } from '../../src/core/redact'
import {
  configureHardwareSecrets,
  countSecretMatches,
  redactSecrets,
} from '../../src/core/maker/guardSecrets'
import { UI_TEXT } from '../../src/shared/constants'

describe('F12: same-build shared hardware secret readers', () => {
  it('fails closed without installation, then uses the original detector and redactor', () => {
    expect(() => countSecretMatches('ordinary', [])).toThrow(UI_TEXT.hardwareRefused)
    expect(() => redactSecrets('ordinary')).toThrow(UI_TEXT.hardwareRefused)
    configureHardwareSecrets({ countSecretMatches: realCount, redactSecrets: realRedact })
    const synthetic = `LLM_${'x'.repeat(20)}`
    expect(countSecretMatches(synthetic, [])).toBe(realCount(synthetic, []))
    expect(redactSecrets(synthetic)).toBe(realRedact(synthetic))
    expect(redactSecrets(synthetic)).not.toContain(synthetic)
  })
})
