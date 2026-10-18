import { beforeEach, describe, expect, it } from 'vitest'
import { composerPlaceholderFor } from '../../src/host/views/composerPlaceholder'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

beforeEach(() => {
  setUiText(EN, 'en')
})

describe('composer invitation', () => {
  it('invites a message and names only this machine’s shortcut', () => {
    expect(composerPlaceholderFor('darwin')).toBe('Ask Muse… (Cmd+Esc to focus)')
    expect(composerPlaceholderFor('win32')).toBe('Ask Muse… (Ctrl+Alt+Esc to focus)')
    expect(composerPlaceholderFor('linux')).toBe('Ask Muse… (Ctrl+Esc to focus)')
  })

  it('never lists all three platforms at once', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const text = composerPlaceholderFor(platform)
      expect(text).not.toContain('macOS')
      expect(text).not.toContain('Windows')
      expect(text.split('\n')).toHaveLength(1)
    }
  })
})
