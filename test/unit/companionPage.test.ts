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
  it('reads the installed language and transports recovery copy as inert data', () => {
    const copy = '</script><img src=x onerror="alert(1)"> & recovery'
    setUiText({ ...EN, companionLaunchFailed: copy }, 'es')
    const html = launchPage('test-nonce')
    expect(html).toContain('lang="es"')
    const page = new DOMParser().parseFromString(html, 'text/html')
    expect(page.querySelector<HTMLElement>('#launch-error')?.dataset['launchText']).toBe(
      encodeURIComponent(copy),
    )
    expect(page.querySelectorAll('img')).toHaveLength(0)
    expect(page.querySelectorAll('script')).toHaveLength(1)
    expect(html).not.toContain(copy)
  })
  it('has no axe accessibility violations when the recovery alert is visible', async () => {
    document.documentElement.innerHTML = launchPage('test-nonce')
    document.documentElement.lang = 'en'
    const alert = document.querySelector<HTMLElement>('#launch-error')
    if (alert === null) throw new Error('missing recovery alert')
    // Model the bootstrap's text installation; the real browser suite executes it.
    document.title = EN.companionLaunchFailed
    alert.textContent = EN.companionLaunchFailed
    alert.hidden = false
    // jsdom computes no colours; real-browser checks cover visible layout and focus.
    const result = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations).toEqual([])
  })
})
