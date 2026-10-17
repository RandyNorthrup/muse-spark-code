import { describe, expect, it } from 'vitest'
import { mimeParameter } from '../../src/core/web/mimeType'

describe("a Content-Type header's parameters, as MIME Sniffing reads them (M69)", () => {
  it('reads a charset, quoted or not, the name in any case', () => {
    expect(mimeParameter('text/html; charset=big5', 'charset')).toBe('big5')
    expect(mimeParameter('text/html;CHARSET="windows-1252"', 'charset')).toBe('windows-1252')
    expect(mimeParameter(String.raw`text/html; charset="a\"b"`, 'charset')).toBe('a"b')
    expect(mimeParameter('text/html; charset=koi8-r  ', 'charset')).toBe('koi8-r')
  })

  it('reads parameters, not text that looks like one', () => {
    // A quoted value holding "charset=" is another parameter's value.
    expect(mimeParameter('text/html; x="charset=utf-16"; charset=gbk', 'charset')).toBe('gbk')
    expect(mimeParameter('text/html; xcharset=utf-16', 'charset')).toBeUndefined()
    expect(mimeParameter('text/html', 'charset')).toBeUndefined()
    expect(mimeParameter('text/html; charset=', 'charset')).toBeUndefined()
    expect(mimeParameter('text/html; charset', 'charset')).toBeUndefined()
  })

  it('keeps the first of a name, and skips a name that is not a token', () => {
    expect(mimeParameter('text/html; charset=gbk; charset=utf-16', 'charset')).toBe('gbk')
    expect(mimeParameter('text/html; char set=utf-16; charset=big5', 'charset')).toBe('big5')
    expect(mimeParameter('text/html; charset="unterminated', 'charset')).toBe('unterminated')
  })
})
