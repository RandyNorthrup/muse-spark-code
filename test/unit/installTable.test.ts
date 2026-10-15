// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { UI_TEXT, WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, uiLocale } from '../../src/shared/l10n/text'
import { installEmbeddedTable } from '../../src/webview/installTable'

/** The page as the host writes it (src/host/html.ts): the table in a JSON data block. */
function embed(text: string): void {
  const element = document.createElement('script')
  element.type = 'application/json'
  element.id = WEBVIEW_L10N_ELEMENT_ID
  element.textContent = text
  document.body.append(element)
}

function expectEnglish(): void {
  expect(uiLocale()).toBe('en')
  expect(UI_TEXT.transcriptLabel).toBe(EN.transcriptLabel)
}

describe('installEmbeddedTable (M40)', () => {
  afterEach(() => {
    document.body.replaceChildren()
    setUiText(EN, 'en')
  })

  it('installs a table with English’s shape, and its language', () => {
    embed(JSON.stringify({ locale: 'de', table: { ...EN, transcriptLabel: 'Unterhaltung' } }))
    expect(installEmbeddedTable(document)).toBeUndefined()
    expect(UI_TEXT.transcriptLabel).toBe('Unterhaltung')
    expect(uiLocale()).toBe('de')
  })

  it('leaves a page without the element in English, with nothing to report', () => {
    expect(installEmbeddedTable(document)).toBeUndefined()
    expectEnglish()
  })

  it('keeps English and says why when the element is not JSON', () => {
    embed('{ locale: de')
    expect(installEmbeddedTable(document)?.message).toMatch(/stays English/)
    expectEnglish()
  })

  it('keeps English when the element is not { locale, table }', () => {
    embed(JSON.stringify({ table: EN }))
    expect(installEmbeddedTable(document)?.message).toMatch(/not \{ locale, table \}/)
    expectEnglish()
  })

  it('keeps English when the language tag is not one Intl accepts', () => {
    embed(JSON.stringify({ locale: 'not a tag!', table: EN }))
    expect(installEmbeddedTable(document)?.message).toMatch(/"not a tag!" is not a language tag/)
    expectEnglish()
  })

  it('keeps English and names the problems of a table that does not match', () => {
    const missing = Object.fromEntries(
      Object.entries(EN).filter(([key]) => key !== 'transcriptLabel'),
    )
    embed(
      JSON.stringify({
        locale: 'de',
        table: { ...missing, thoughtFor: 'Nachgedacht', extra: 'x' },
      }),
    )
    const message = installEmbeddedTable(document)?.message ?? ''
    expect(message).toMatch(/transcriptLabel: missing/)
    expect(message).toMatch(/thoughtFor: slots \{duration\} expected/)
    expect(message).toMatch(/extra: not in the English table/)
    expectEnglish()
  })
})
