// @vitest-environment jsdom
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import { launchPage } from '../../src/runtime/companion/page'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('companion launch page', () => {
  it('reads the installed language at render time and escapes recovery copy', () => {
    setUiText({ ...EN, companionLaunchFailed: '<script> & recovery' }, 'es')
    const html = launchPage('test-nonce')
    expect(html).toContain('lang="es"')
    expect(html).toContain('&lt;script&gt; &amp; recovery')
    expect(html).not.toContain('<script> & recovery')
  })
  it('has no axe accessibility violations when the recovery alert is visible', async () => {
    document.documentElement.innerHTML = launchPage('test-nonce')
    document.documentElement.lang = 'en'
    const alert = document.querySelector<HTMLElement>('#launch-error')
    if (alert === null) throw new Error('missing recovery alert')
    alert.hidden = false
    // jsdom computes no colours; real-browser checks cover visible layout and focus.
    const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations).toEqual([])
  })
})
