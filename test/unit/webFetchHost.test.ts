// The window fetch's host shortener (src/host/web/webFetcher.ts): the log
// names a fetch's host, or the fixed not-a-URL words when the real URL
// parser rejects the input. Only the parser's own malformed-input failure
// reads that way; anything else still throws.
import { expect, it } from 'vitest'
import { hostOf } from '../../src/host/web/webFetcher'

it('names the host of a valid URL', () => {
  expect(hostOf('https://example.com:8443/x?y=1')).toBe('example.com:8443')
})

it('reads the parser malformed-input failure as not-a-URL', () => {
  for (const raw of ['', 'not a url', '://missing-scheme', 'https://exa mple.com']) {
    expect(() => new URL(raw)).toThrow(TypeError)
    expect(hostOf(raw)).toBe('(not a URL)')
  }
})
