import { describe, expect, it, vi } from 'vitest'
import {
  applyFontPreferences,
  fontAppearanceSettings,
  fontPreferencesSchema,
} from '../../src/runtime/fonts/preferences'
import { setUiText } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'

describe('D94 appearance settings in every standalone host', () => {
  it('defaults to the chosen standalone stacks and validates saved choices', async () => {
    const write = vi.fn(() => Promise.resolve())
    const settings = await fontAppearanceSettings({ read: () => Promise.resolve(undefined), write })
    expect(settings.preferences).toEqual({ ui: 'Inter', code: 'JetBrains Mono', ligatures: false })
    expect(settings.code.choices).toContain('Cascadia Code')
    await settings.save({ ui: 'system', code: 'Fira Code', ligatures: true })
    expect(write).toHaveBeenCalledWith({ ui: 'system', code: 'Fira Code', ligatures: true })
    await expect(settings.save({ code: '";url(https://evil)' })).rejects.toThrow()
    await expect(settings.save({ ui: 'system', unexpected: true })).rejects.toThrow()
    expect(write).toHaveBeenCalledOnce()
    expect(fontPreferencesSchema.safeParse({ ligatures: 'yes' }).success).toBe(false)
  })
  it('leaves every editor host font under its own settings', () => {
    const setProperty = vi.fn()
    applyFontPreferences(fontPreferencesSchema.parse({}), 'editor', {
      uiFallback: 'sans-serif',
      codeFallback: 'monospace',
      setProperty,
    })
    expect(setProperty).not.toHaveBeenCalled()
  })
  it('applies user choices, system fallback and optional ligatures to standalone tokens', () => {
    const setProperty = vi.fn()
    const port = {
      uiFallback: '"Inter", sans-serif',
      codeFallback: '"JetBrains Mono", monospace',
      setProperty,
    }
    applyFontPreferences(
      fontPreferencesSchema.parse({ code: 'Cascadia Code', ligatures: true }),
      'standalone',
      port,
    )
    expect(setProperty).toHaveBeenCalledWith(
      '--ms-font-code',
      '"Cascadia Code", "Muse Code CC", "JetBrains Mono", monospace',
    )
    expect(setProperty).toHaveBeenCalledWith('--ms-code-ligatures', 'normal')
    expect(setProperty).toHaveBeenCalledWith('--ms-code-font-features', 'normal')
    applyFontPreferences(
      fontPreferencesSchema.parse({ ui: 'system', code: 'system' }),
      'standalone',
      port,
    )
    expect(setProperty).toHaveBeenCalledWith('--ms-font-ui', 'system-ui, sans-serif')
    expect(setProperty).toHaveBeenCalledWith('--ms-font-code', 'monospace')
    expect(setProperty).toHaveBeenCalledWith('--ms-code-ligatures', 'none')
    expect(setProperty).toHaveBeenCalledWith(
      '--ms-code-font-features',
      '"calt" 0, "liga" 0, "clig" 0',
    )
  })
  it('reads labels after the host installs its language table', async () => {
    setUiText({ ...EN, acpFontUi: 'Police de l’interface' }, 'fr')
    try {
      const settings = await fontAppearanceSettings({
        read: () => Promise.resolve({}),
        write: () => Promise.resolve(),
      })
      expect(settings.ui.label).toBe('Police de l’interface')
    } finally {
      setUiText(EN, 'en')
    }
  })
})
