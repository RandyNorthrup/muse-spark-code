import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { changedEncoding, charsetInMetaContent, decodeHtml } from '../../src/core/web/htmlCharset'
import { convertHtmlJob } from '../../src/core/web/htmlToMarkdown'

// The Encoding standard's name for UTF-8, as TextDecoder reports it.
const UTF_8 = new TextDecoder().encoding

// 0xE9 is "é" in windows-1252 and ISO-8859-2; 0xB1 is "±" in windows-1252,
// "ą" in ISO-8859-2; 0x80 is "€" in windows-1252.
const E9 = 0xe9
const B1 = 0xb1
const EURO_1252 = 0x80

function page(head: string, body: readonly number[]): Uint8Array {
  return new Uint8Array([...Buffer.from(head, 'latin1'), ...body])
}

function text(bytes: Uint8Array, header?: string): string {
  return decodeHtml(bytes, header).text
}

describe("an HTML page's encoding, sniffed as HTML does (M69)", () => {
  it('reads a <meta charset> and a <meta http-equiv> content charset', () => {
    expect(text(page('<meta charset="windows-1252">', [E9, EURO_1252]))).toBe(
      '<meta charset="windows-1252">é€',
    )
    const equiv = page('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2">', [
      B1,
    ])
    expect(text(equiv).endsWith('ą')).toBe(true)
  })

  it('ignores a charset in a comment, or in an attribute that is not the declaration', () => {
    const commented = page('<!-- <meta charset="iso-8859-2"> --><meta charset="windows-1252">', [
      B1,
    ])
    expect(text(commented).endsWith('±')).toBe(true)
    // `content` counts only with http-equiv="content-type".
    const otherAttribute = page('<meta name="x" content="text/html; charset=iso-8859-2">', [E9])
    expect(text(otherAttribute).endsWith('\u{FFFD}')).toBe(true)
    expect(text(page('<p>charset=iso-8859-2</p>', [E9])).endsWith('\u{FFFD}')).toBe(true)
  })

  it('lets a byte order mark, then the header, win over the markup, and makes those certain', () => {
    const declared = page('<meta charset="iso-8859-2">', [B1])
    expect(decodeHtml(declared, 'windows-1252')).toMatchObject({
      encoding: 'windows-1252',
      isTentative: false,
    })
    expect(decodeHtml(declared, undefined)).toMatchObject({
      encoding: 'iso-8859-2',
      isTentative: true,
    })
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('<p>é</p>', 'utf8')])
    expect(decodeHtml(withBom, 'windows-1252')).toMatchObject({
      text: '<p>é</p>',
      isTentative: false,
    })
  })

  it('reads a page that declares nothing, or an unknown label, as UTF-8', () => {
    const plain = new Uint8Array(Buffer.from('<p>é</p>', 'utf8'))
    expect(decodeHtml(plain, undefined)).toEqual({
      text: '<p>é</p>',
      encoding: UTF_8,
      isTentative: true,
    })
    expect(text(plain, 'no-such-label')).toBe('<p>é</p>')
  })

  it('survives a malformed <meta> content, reading on without the prescan', () => {
    // html-encoding-sniffer 6.0.0 throws on these.
    for (const content of ['text/html; charset=', 'charset']) {
      const malformed = page(`<meta http-equiv="Content-Type" content="${content}"><p>é`, [])
      expect(decodeHtml(malformed, undefined)).toMatchObject({
        encoding: UTF_8,
        isTentative: true,
      })
    }
  })

  it('reads a replacement encoding as a single U+FFFD, as a browser does', () => {
    expect(text(page('<p>secret</p>', []), 'iso-2022-kr')).toBe('\u{FFFD}')
    expect(text(page('<meta charset="hz-gb-2312"><p>secret', []))).toBe('\u{FFFD}')
  })

  it('changes a tentative encoding when a later <meta> declares another, as HTML reparses', () => {
    // A <meta charset> past the 1,024 bytes the prescan reads.
    const late = page(`<p>${'x'.repeat(1100)}</p><meta charset="windows-1252"><p>`, [EURO_1252])
    const converted = convertHtmlJob({
      bytes: late,
      charset: undefined,
      url: 'https://docs.example.com/',
      maxChars: 100_000,
    })
    expect(converted.markdown.endsWith('€')).toBe(true)
    // A header makes it certain: the late <meta> changes nothing.
    const certain = convertHtmlJob({
      bytes: late,
      charset: UTF_8,
      url: 'https://docs.example.com/',
      maxChars: 100_000,
    })
    expect(certain.markdown.endsWith('\u{FFFD}')).toBe(true)
  })

  it('changes the encoding as the standard says: UTF-16 as UTF-8, x-user-defined as windows-1252', () => {
    expect(changedEncoding('windows-1252', 'utf-16le')).toBe(UTF_8)
    expect(changedEncoding(UTF_8, 'x-user-defined')).toBe('windows-1252')
    expect(changedEncoding(UTF_8, 'unicode-1-1-utf-8')).toBeUndefined()
    expect(changedEncoding('utf-16le', 'windows-1252')).toBeUndefined()
    expect(changedEncoding(UTF_8, 'iso-2022-kr')).toBe('replacement')
    expect(changedEncoding(UTF_8, 'no-such-label')).toBeUndefined()
  })

  it("extracts a <meta http-equiv> content's charset as the standard does", () => {
    expect(charsetInMetaContent('text/html; charset=iso-8859-2')).toBe('iso-8859-2')
    expect(charsetInMetaContent('text/html;CHARSET = "koi8-r"; x=y')).toBe('koi8-r')
    expect(charsetInMetaContent("charset='gbk'")).toBe('gbk')
    expect(charsetInMetaContent('charsetx; charset=big5')).toBe('big5')
    expect(charsetInMetaContent('charset="unterminated')).toBeUndefined()
    expect(charsetInMetaContent('text/html')).toBeUndefined()
  })
})
