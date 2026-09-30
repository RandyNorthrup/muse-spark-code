import { afterEach, describe, expect, it } from 'vitest'
import { MODEL_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, formatBytes, setUiText } from '../../src/shared/l10n/text'
import { parseWebPageHeader } from '../../src/shared/webPage'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('parseWebPageHeader (M69)', () => {
  it('reads back the facts the fetch wrote in its first line', () => {
    const header = fill(MODEL_TEXT.webFetchHeader, {
      url: 'https://docs.example.com/a?b=(1)',
      status: '203',
      type: 'application/xhtml+xml',
      bytes: '0',
    })
    expect(parseWebPageHeader(`${header} ${MODEL_TEXT.webFetchConverted}\nrest`)).toEqual({
      url: 'https://docs.example.com/a?b=(1)',
      status: 203,
      type: 'application/xhtml+xml',
      bytes: 0,
    })
  })

  it('reads nothing from another first line, or from the page below it', () => {
    expect(parseWebPageHeader('Error: the server answered HTTP 404')).toBeUndefined()
    expect(
      parseWebPageHeader('x\nFetched https://a.example/ (HTTP 200, text/html, 1 bytes).'),
    ).toBeUndefined()
    expect(
      parseWebPageHeader('Fetched https://a.example/ (HTTP 2000, text/html, 1 bytes).'),
    ).toBeUndefined()
  })
})

describe('formatBytes (M69)', () => {
  it('writes a size in the largest decimal unit below it, as the language does', () => {
    expect(formatBytes(512)).toBe('512 byte')
    expect(formatBytes(48_213)).toBe('48.2 kB')
    expect(formatBytes(5_242_880)).toBe('5.2 MB')
    setUiText(EN, 'de')
    expect(formatBytes(48_213)).toBe('48,2 kB')
  })
})
