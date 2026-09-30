import { describe, expect, it } from 'vitest'
import { approvalHost, checkPageUrl } from '../../src/core/web/pageUrl'
import { WEB_FETCH_URL_MAX_CHARS } from '../../src/shared/constants'

function refusal(raw: string): string | undefined {
  const checked = checkPageUrl(raw)
  return checked.ok ? undefined : checked.failure.kind
}

describe('checkPageUrl (M69)', () => {
  it('accepts a public https URL, drops its fragment and keeps its query', () => {
    const checked = checkPageUrl('https://Docs.Example.com/a/b?x=1#part')
    expect(checked).toMatchObject({ ok: true, host: 'docs.example.com', address: undefined })
    expect(checked.ok && checked.url.href).toBe('https://docs.example.com/a/b?x=1')
  })

  it('refuses anything but https, and addresses with credentials', () => {
    expect(refusal('https://example.com/'.replace('https:', 'http:'))).toBe('notHttps')
    expect(refusal('ftp://example.com/')).toBe('notHttps')
    expect(refusal('file:///etc/passwd')).toBe('notHttps')
    expect(refusal('javascript:alert(1)')).toBe('notHttps')
    expect(refusal('https://name:word@example.com/')).toBe('credentials')
    expect(refusal('https://user@example.com/')).toBe('credentials')
    expect(refusal('example.com/page')).toBe('invalidUrl')
    expect(refusal('')).toBe('invalidUrl')
  })

  it('refuses an address longer than the limit before parsing it', () => {
    const long = `https://example.com/${'a'.repeat(WEB_FETCH_URL_MAX_CHARS)}`
    expect(refusal(long)).toBe('urlTooLong')
  })

  it('refuses local, reserved and single-label names before any lookup', () => {
    for (const raw of [
      'https://localhost/',
      'https://app.localhost/',
      'https://printer.local/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://router.home.arpa/',
      'https://a.test/',
      'https://x.invalid/',
      'https://example/',
      'https://abc.onion/',
      'https://intranet/',
      'https://intranet./',
      'https://intranet../',
      'https://localhost../',
      'https://x.onion../',
      'https://printer.local.../',
    ]) {
      expect(refusal(raw), raw).toBe('reservedHost')
    }
  })

  it('refuses a name with an empty label, and one that is only dots', () => {
    expect(refusal('https://a..example.com/')).toBe('invalidUrl')
    expect(refusal('https://.example.com/')).toBe('invalidUrl')
    expect(checkPageUrl('https://docs.example.com../')).toMatchObject({
      ok: true,
      host: 'docs.example.com',
    })
  })

  it('judges an address in the URL however it is spelled', () => {
    for (const raw of [
      'https://127.0.0.1/',
      'https://2130706433/',
      'https://0x7f.1/',
      'https://017700000001/',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[fd00:ec2::254]/',
      'https://10.0.0.1:8443/',
    ]) {
      expect(refusal(raw), raw).toBe('privateAddress')
    }
    expect(checkPageUrl('https://8.8.8.8/')).toMatchObject({ ok: true, address: '8.8.8.8' })
    expect(checkPageUrl('https://[2606:4700::1111]/')).toMatchObject({
      ok: true,
      host: '2606:4700::1111',
      address: '2606:4700::1111',
    })
  })

  it('keys an approval on the host and a port other than 443', () => {
    expect(approvalHost(new URL('https://Docs.Example.com/x'))).toBe('docs.example.com')
    expect(approvalHost(new URL('https://docs.example.com:443/x'))).toBe('docs.example.com')
    expect(approvalHost(new URL('https://docs.example.com:8443/x'))).toBe('docs.example.com:8443')
    expect(approvalHost(new URL('https://docs.example.com../x'))).toBe('docs.example.com')
    expect(approvalHost(new URL('https://[2606:4700::1111]:444/'))).toBe('[2606:4700::1111]:444')
  })
})
