import { describe, expect, it } from 'vitest'
import {
  isTabLanguageOn,
  readCopilotPosture,
  shouldYieldToCopilot,
  type CopilotPosture,
} from '../../src/host/tab/tabYield'

// M94 acceptance 14 (the yield decision) and acceptance 3 (the language
// switch): the pure decision the status bar and the provider share.

describe('isTabLanguageOn', () => {
  it('reads the exact switch first, then the wildcard, then on', () => {
    expect(isTabLanguageOn({ typescript: false, '*': true }, 'typescript')).toBe(false)
    expect(isTabLanguageOn({ typescript: true, '*': false }, 'typescript')).toBe(true)
    expect(isTabLanguageOn({ '*': false }, 'typescript')).toBe(false)
    expect(isTabLanguageOn({ python: false }, 'typescript')).toBe(true)
    expect(isTabLanguageOn({}, 'typescript')).toBe(true)
  })
})

describe('shouldYieldToCopilot', () => {
  const yielding: CopilotPosture = {
    extensionPresent: true,
    enabledForLanguage: true,
    aiFeaturesDisabled: false,
    tabWithCopilot: 'yield',
  }

  it('yields while Copilot is present, enabled and allowed', () => {
    expect(shouldYieldToCopilot(yielding)).toBe(true)
  })

  it.each([
    ['run both', { ...yielding, tabWithCopilot: 'both' }],
    ['no extension', { ...yielding, extensionPresent: false }],
    ['disabled for the language', { ...yielding, enabledForLanguage: false }],
    ['AI features off', { ...yielding, aiFeaturesDisabled: true }],
  ] as const)('suggests on %s', (_name, posture) => {
    expect(shouldYieldToCopilot(posture)).toBe(false)
  })
})

function readPosture(enable: unknown, disableAIFeatures: unknown, isPresent = true) {
  return readCopilotPosture({
    isCopilotExtensionPresent: () => isPresent,
    foreignSetting: (section) => (section === 'github.copilot' ? enable : disableAIFeatures),
    tabWithCopilot: 'yield',
    languageId: 'typescript',
  })
}

describe('readCopilotPosture', () => {
  const read = readPosture

  it('reads the language switch, else the wildcard, else enabled', () => {
    expect(read({ typescript: false, '*': true }, false).enabledForLanguage).toBe(false)
    expect(read({ typescript: true }, false).enabledForLanguage).toBe(true)
    expect(read({ '*': false }, false).enabledForLanguage).toBe(false)
    expect(read({}, false).enabledForLanguage).toBe(true)
    expect(read(undefined, false).enabledForLanguage).toBe(true)
  })

  it('treats a non-table enable setting as enabled', () => {
    expect(read(false, false).enabledForLanguage).toBe(true)
    expect(read(['typescript'], false).enabledForLanguage).toBe(true)
  })

  it('reads the AI-features switch and the extension presence', () => {
    expect(read({}, true).aiFeaturesDisabled).toBe(true)
    expect(read({}, false).aiFeaturesDisabled).toBe(false)
    expect(read({}, 'yes').aiFeaturesDisabled).toBe(false)
    expect(read({}, false, false).extensionPresent).toBe(false)
  })
})
