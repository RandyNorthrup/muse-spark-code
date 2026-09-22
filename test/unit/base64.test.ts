// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { blobToBase64, bytesToBase64, parseUriList } from '../../src/webview/base64'

describe('bytesToBase64', () => {
  it('encodes small and multi-slice payloads identically to Buffer', () => {
    const small = Uint8Array.from([0, 1, 2, 250, 251, 255])
    expect(bytesToBase64(small)).toBe(Buffer.from(small).toString('base64'))
    const large = new Uint8Array(0x80_00 * 2 + 7).map((_, index) => index % 256)
    expect(bytesToBase64(large)).toBe(Buffer.from(large).toString('base64'))
  })

  it('reads a blob', async () => {
    const blob = new Blob([Uint8Array.from([104, 105])])
    await expect(blobToBase64(blob)).resolves.toBe('aGk=')
  })
})

describe('parseUriList', () => {
  it('keeps URIs and drops comments and blank lines', () => {
    expect(parseUriList('# note\r\nfile:///a.ts\r\n\r\n file:///b.ts \n')).toEqual([
      'file:///a.ts',
      'file:///b.ts',
    ])
    expect(parseUriList('')).toEqual([])
  })
})
