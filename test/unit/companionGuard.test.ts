import { Buffer } from 'node:buffer'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  isSameOrigin,
  readJson,
  isSameSecret,
  secureHeaders,
  sessionCookie,
  singleHeader,
} from '../../src/runtime/companion/guard'

const origin = 'http://127.0.0.1:12345'
function request(headers: readonly string[], body?: Buffer) {
  const value = new IncomingMessage(new Socket())
  value.rawHeaders = [...headers]
  const distinct: Record<string, string[]> = {}
  for (let index = 0; index < headers.length; index += 2) {
    const name = headers[index]!.toLowerCase()
    ;(distinct[name] ??= []).push(headers[index + 1]!)
  }
  value.headersDistinct = distinct
  if (body !== undefined) {
    value.push(body)
    value.push(null)
  }
  return value
}
const same = ['Host', '127.0.0.1:12345', 'Origin', origin, 'Sec-Fetch-Site', 'same-origin']

describe('companion guard', () => {
  it('accepts an exact origin, or an initial navigation without Origin', () => {
    expect(isSameOrigin(request(same), origin, true)).toBe(true)
    expect(isSameOrigin(request(['Host', '127.0.0.1:12345']), origin, false)).toBe(true)
    expect(
      isSameOrigin(request(['Host', '127.0.0.1:12345', 'Sec-Fetch-Site', 'none']), origin, false),
    ).toBe(true)
  })
  it.each([
    ['missing Host', ['Origin', origin]],
    ['foreign Host', ['Host', 'localhost:12345', 'Origin', origin]],
    ['duplicate Host', [...same, 'Host', '127.0.0.1:12345']],
    ['foreign Origin', ['Host', '127.0.0.1:12345', 'Origin', 'http://127.0.0.1:12346']],
    ['null Origin', ['Host', '127.0.0.1:12345', 'Origin', 'null']],
    ['duplicate Origin', [...same, 'Origin', origin]],
    ['missing privileged Origin', ['Host', '127.0.0.1:12345']],
    ['cross-site metadata', [...same.slice(0, 4), 'Sec-Fetch-Site', 'cross-site']],
    ['same-site metadata', [...same.slice(0, 4), 'Sec-Fetch-Site', 'same-site']],
    ['none privileged metadata', [...same.slice(0, 4), 'Sec-Fetch-Site', 'none']],
    ['duplicate metadata', [...same, 'Sec-Fetch-Site', 'same-origin']],
  ])('refuses %s', (_name, headers) => {
    expect(isSameOrigin(request(headers), origin, true)).toBe(false)
  })
  it('also refuses foreign Origin or metadata on public navigation', () => {
    expect(
      isSameOrigin(
        request(['Host', '127.0.0.1:12345', 'Origin', 'https://foreign.test']),
        origin,
        false,
      ),
    ).toBe(false)
    expect(
      isSameOrigin(
        request(['Host', '127.0.0.1:12345', 'Sec-Fetch-Site', 'cross-site']),
        origin,
        false,
      ),
    ).toBe(false)
  })
  it('refuses missing or ambiguous cookies while allowing unrelated cookies', () => {
    expect(sessionCookie(request([]))).toBeUndefined()
    expect(
      sessionCookie(request(['Cookie', 'muse_panel=one', 'Cookie', 'muse_panel=two'])),
    ).toBeUndefined()
    expect(sessionCookie(request(['Cookie', 'muse_panel=one; muse_panel=two']))).toBeUndefined()
    expect(sessionCookie(request(['Cookie', 'unrelated=value; muse_panel=one']))).toBe('one')
    expect(sessionCookie(request(['Cookie', 'other_muse_panel=one']))).toBeUndefined()
  })
  it('rejects duplicate custom headers and compares secrets including length', () => {
    expect(
      singleHeader(request(['X-Muse-Panel', '1', 'X-Muse-Panel', '1']), 'x-muse-panel'),
    ).toBeUndefined()
    expect(isSameSecret('same', 'same')).toBe(true)
    expect(isSameSecret('same', 'diff')).toBe(false)
    expect(isSameSecret('short', 'longer')).toBe(false)
  })
  it('sets nonce CSP and all security headers, without CORS', () => {
    const response = new ServerResponse(request([]))
    secureHeaders(response, 'synthetic-nonce')
    expect(response.getHeader('Content-Security-Policy')).toContain("default-src 'none'")
    expect(response.getHeader('Content-Security-Policy')).toContain(
      "script-src 'nonce-synthetic-nonce'",
    )
    for (const directive of [
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ]) {
      expect(response.getHeader('Content-Security-Policy')).toContain(directive)
    }
    expect(response.getHeader('Cache-Control')).toBe('no-store')
    expect(response.getHeader('X-Content-Type-Options')).toBe('nosniff')
    expect(response.getHeader('Referrer-Policy')).toBe('no-referrer')
    expect(response.getHeader('Cross-Origin-Opener-Policy')).toBe('same-origin')
    expect(response.getHeader('Cross-Origin-Resource-Policy')).toBe('same-origin')
    expect(
      Object.keys(response.getHeaders()).some((name) => name.startsWith('access-control-allow-')),
    ).toBe(false)
  })
  it('reads valid JSON at its exact byte cap', async () => {
    const body = Buffer.from('{"text":"é"}')
    const value = request(
      ['Content-Type', 'application/json', 'Content-Length', String(body.length)],
      body,
    )
    expect(await readJson(value, body.length)).toEqual({ text: 'é' })
  })
  it('refuses a non-buffer stream chunk with the boundary error', async () => {
    const value = request(['Content-Type', 'application/json'], Buffer.from('{}'))
    const wrong = Readable.from(['unexpected'], { objectMode: true }).iterator()
    vi.spyOn(value, 'iterator').mockReturnValue(wrong)
    await expect(readJson(value, 100)).rejects.toThrow('EPANEL_BODY')
  })
  it.each([
    ['missing content type', [], Buffer.from('{}'), 2],
    ['form', ['Content-Type', 'application/x-www-form-urlencoded'], Buffer.from('code=x'), 100],
    [
      'duplicate content type',
      ['Content-Type', 'application/json', 'Content-Type', 'application/json'],
      Buffer.from('{}'),
      2,
    ],
    [
      'declared over-cap body',
      ['Content-Type', 'application/json', 'Content-Length', '3'],
      Buffer.from('{}'),
      2,
    ],
    ['chunked over-cap body', ['Content-Type', 'application/json'], Buffer.from('{} '), 2],
    [
      'invalid length',
      ['Content-Type', 'application/json', 'Content-Length', 'no'],
      Buffer.from('{}'),
      2,
    ],
    ['malformed JSON', ['Content-Type', 'application/json'], Buffer.from('{'), 2],
    ['invalid UTF-8', ['Content-Type', 'application/json'], Buffer.from([0x22, 0xff, 0x22]), 3],
  ] as const)('refuses %s', async (_name, headers, body, cap) => {
    await expect(readJson(request(headers, body), cap)).rejects.toThrow()
  })
})
