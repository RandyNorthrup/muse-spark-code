// M110e lanes A2 and A3: passwords hash with scrypt and verify in
// constant time, TOTP matches RFC 6238's own vectors, recovery codes burn
// on use, PKCE matches RFC 7636's vector, proxy sign-in trusts only its
// socket, ACME answers follow RFC 8557, the installed certificate reads
// back from a recorded real capture, and passkeys refuse bare IPs by name.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { acmeDns01Digest, acmeKeyAuthorization } from '../../src/runtime/node/acme/challenge'
import {
  isCertificateLiveFor,
  readInstalledCertificate,
} from '../../src/runtime/node/acme/certificate'
import { checkPasskeyOrigin } from '../../src/runtime/node/acme/secureContext'
import { buildPwaManifest } from '../../src/runtime/node/acme/pwaManifest'
import {
  buildOidcAuthorizationUrl,
  createPkcePair,
  isOidcStateValid,
  pkceChallengeOf,
} from '../../src/runtime/node/auth/oidc'
import { hashNodePassword, isNodePasswordValid } from '../../src/runtime/node/auth/passwords'
import { acceptProxySignin } from '../../src/runtime/node/auth/proxySignin'
import { createRecoveryCodes, redeemRecoveryCode } from '../../src/runtime/node/auth/recoveryCodes'
import { decodeTotpSecret, isTotpCodeValid } from '../../src/runtime/node/auth/totp'

const TOTP_SETTINGS = { digits: 8, stepSeconds: 30, windowSteps: 0 }
// RFC 6238 Appendix B: the SHA-1 secret "12345678901234567890", base32.
const RFC6238_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('node passwords', () => {
  it('verifies only the password it hashed, and records its parameters', () => {
    const stored = hashNodePassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true)
    expect(isNodePasswordValid('correct horse battery staple', stored)).toBe(true)
    expect(isNodePasswordValid('wrong password', stored)).toBe(false)
    expect(isNodePasswordValid('correct horse battery staple', 'scrypt$broken')).toBe(false)
    expect(isNodePasswordValid('anything', 'scrypt$32768$8$1$c2FsdA$')).toBe(false)
    expect(isNodePasswordValid('anything', 'scrypt$32768$8$1$$aGFzaA==')).toBe(false)
    expect(() => hashNodePassword('')).toThrow('a password is not empty')
  })
})

describe('node TOTP', () => {
  it('matches RFC 6238 Appendix B for every listed instant', () => {
    // The RFC's SHA-1 vectors, 8 digits, 30-second steps.
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1_111_111_109, '07081804'],
      [1_111_111_111, '14050471'],
      [1_234_567_890, '89005924'],
      [2_000_000_000, '69279037'],
      [20_000_000_000, '65353130'],
    ]
    for (const [at, code] of vectors) {
      expect(isTotpCodeValid(RFC6238_SECRET, code, at, TOTP_SETTINGS)).toBe(true)
    }
    expect(isTotpCodeValid(RFC6238_SECRET, '94287082', 89, TOTP_SETTINGS)).toBe(false)
    expect(isTotpCodeValid('!!!!', '94287082', 59, TOTP_SETTINGS)).toBe(false)
    expect(decodeTotpSecret('A')).toBeUndefined()
    expect(isTotpCodeValid('A', '94287082', 59, TOTP_SETTINGS)).toBe(false)
  })

  it('honours the caller window and refuses its neighbours past it', () => {
    expect(
      isTotpCodeValid(RFC6238_SECRET, '94287082', 89, {
        digits: 8,
        stepSeconds: 30,
        windowSteps: 1,
      }),
    ).toBe(true)
    expect(
      isTotpCodeValid(RFC6238_SECRET, '94287082', 119, {
        digits: 8,
        stepSeconds: 30,
        windowSteps: 1,
      }),
    ).toBe(false)
    expect(decodeTotpSecret('JBSWY3DPEE')).toEqual(Uint8Array.from([72, 101, 108, 108, 111, 33]))
  })
})

describe('node recovery codes', () => {
  it('burns each code on use and keeps only hashes', () => {
    const book = createRecoveryCodes(3)
    expect(book.codes).toHaveLength(3)
    expect(book.hashes).toHaveLength(3)
    expect(book.codes[0]).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/)
    const stored = JSON.stringify(book.hashes)
    for (const code of book.codes) expect(stored).not.toContain(code)
    const first = book.codes[0]
    if (first === undefined) throw new Error('enrollment makes codes')
    const remaining = redeemRecoveryCode(book.hashes, first)
    expect(remaining).toHaveLength(2)
    expect(() => redeemRecoveryCode(remaining, first)).toThrow(
      'this recovery code is wrong or spent',
    )
    expect(() => redeemRecoveryCode(remaining, 'zzzz-zzzz-zzzz-zzzz')).toThrow(
      'this recovery code is wrong or spent',
    )
  })
})

describe('node OIDC with PKCE', () => {
  it('matches RFC 7636 Appendix B and checks the state echo', () => {
    expect(pkceChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    const pair = createPkcePair()
    expect(pkceChallengeOf(pair.verifier)).toBe(pair.challenge)
    const url = buildOidcAuthorizationUrl(
      {
        issuer: 'https://accounts.example.com',
        clientId: 'node-client',
        redirectUri: 'https://node.example.com/signin/oidc',
        state: 'state-1',
      },
      pair.challenge,
    )
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain(`code_challenge=${pair.challenge}`)
    expect(url).toContain('state=state-1')
    expect(isOidcStateValid('state-1', 'state-1')).toBe(true)
    expect(isOidcStateValid('state-1', 'state-2')).toBe(false)
    expect(isOidcStateValid('state-1', undefined)).toBe(false)
  })
})

describe('node reverse-proxy sign-in', () => {
  it('trusts only its own socket and a named user', () => {
    const settings = { socketPath: '/run/node-proxy.sock', userHeader: 'X-Remote-User' }
    expect(
      acceptProxySignin(settings, {
        socketPath: '/run/node-proxy.sock',
        headers: new Map([['x-remote-user', 'randy']]),
      }),
    ).toEqual({ accepted: true, user: 'randy' })
    expect(
      acceptProxySignin(settings, {
        socketPath: '/run/other.sock',
        headers: new Map([['x-remote-user', 'randy']]),
      }),
    ).toEqual({ accepted: false, reason: 'proxy sign-in arrives only over its own socket' })
    expect(
      acceptProxySignin(settings, { socketPath: '/run/node-proxy.sock', headers: new Map() }),
    ).toEqual({ accepted: false, reason: 'the proxy named no user' })
  })
})

describe('node ACME answers', () => {
  it('builds the RFC 8557 key authorization and dns-01 digest', () => {
    const challenge = { token: 'evaGxfADs6pSRb2LAv9IZf17D', thumbprint: 'JWK-thumbprint' }
    expect(acmeKeyAuthorization(challenge)).toBe('evaGxfADs6pSRb2LAv9IZf17D.JWK-thumbprint')
    const digest = acmeDns01Digest(challenge)
    expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(acmeDns01Digest({ ...challenge, token: 'other' })).not.toBe(digest)
  })

  it('reads back the installed certificate from the recorded capture', () => {
    const pem = readFileSync(
      new URL('../fixtures/node-acme/example-com-2026-10-22.pem', import.meta.url),
      'utf8',
    )
    const read = readInstalledCertificate(pem)
    expect(read.ok).toBe(true)
    if (!read.ok) throw new Error('the recorded certificate parses')
    expect(read.certificate.dnsNames).toContain('example.com')
    expect(read.certificate.dnsNames).toContain('*.example.com')
    const inside = Date.parse('2026-11-01T00:00:00Z')
    expect(isCertificateLiveFor(read.certificate, 'example.com', inside)).toBe(true)
    expect(isCertificateLiveFor(read.certificate, 'www.example.com', inside)).toBe(true)
    expect(isCertificateLiveFor(read.certificate, 'a.b.example.com', inside)).toBe(false)
    expect(
      isCertificateLiveFor(read.certificate, 'example.com', Date.parse('2027-01-01T00:00:00Z')),
    ).toBe(false)
    expect(readInstalledCertificate('not a certificate')).toEqual({
      ok: false,
      reason: 'no certificate in this file',
    })
  })
})

describe('node passkey origins', () => {
  it('passes secure contexts and refuses bare IPs and plain http by name', () => {
    expect(checkPasskeyOrigin({ protocol: 'https:', host: 'node.example.com' })).toEqual({
      ok: true,
    })
    expect(checkPasskeyOrigin({ protocol: 'http:', host: 'localhost' })).toEqual({ ok: true })
    expect(checkPasskeyOrigin({ protocol: 'https:', host: '192.168.1.2' })).toEqual({
      ok: false,
      reason: 'passkeys need a domain name, not a bare IP address',
    })
    expect(checkPasskeyOrigin({ protocol: 'http:', host: 'node.example.com' })).toEqual({
      ok: false,
      reason: 'passkeys need https, or the machine itself',
    })
  })
})

describe('node PWA manifest', () => {
  it('serves the person manifest and refuses one without icons', () => {
    const manifest = buildPwaManifest({
      name: 'Muse Node',
      short_name: 'Node',
      start_url: '/',
      display: 'standalone',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [{ src: '/icon.png', sizes: '512x512' }],
    })
    expect(JSON.parse(manifest)).toMatchObject({ name: 'Muse Node', display: 'standalone' })
    expect(() =>
      buildPwaManifest({
        name: 'Muse Node',
        short_name: 'Node',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [],
      }),
    ).toThrow()
  })
})
