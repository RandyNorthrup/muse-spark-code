// The Grok sign-in core's rules, driven without any stand-in for xAI: the
// discovery fixture is the recorded document
// (`test/fixtures/grok/discovery.json`, captured 2026-10-22 with
// `curl -sm 20 https://auth.x.ai/.well-known/openid-configuration`), and
// every other fetch in these tests refuses — the tests assert our own
// request shapes and refusal codes instead. PKCE and identity-token checks
// run real crypto (node:crypto random bytes, SHA-256 and ephemeral P-256
// keys); constructed inputs are standard OAuth/RFC 8628 shapes to our own
// parsers, never xAI's private wire format.
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildGrokAuthorizeUrl,
  GrokSignIn,
  GrokSignInError,
  grokAccountIdHash,
  grokRecordSchema,
  parseGrokCallback,
  parseGrokDeviceCode,
  requireGrokClientId,
  resolveGrokScopes,
  verifyGrokIdToken,
  type GrokHostPort,
  type GrokRecord,
} from '../../src/core/providers/subscriptions/grok'
import { createPkcePair, pkceChallenge, pkceRandom } from '../../src/core/providers/pkce'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { GROK_DEFAULT_SCOPES, PKCE_STATE_BYTES } from '../../src/shared/constants'
import { grokGrantRecord } from './helpers/grokGrant'
import { mapSecrets } from './helpers/mapSecrets'

const CLIENT_ID = 'muse-spark-code.test-client'
const DISCOVERY_URL = 'https://auth.x.ai/.well-known/openid-configuration'
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'

function discoveryFixture(): unknown {
  return JSON.parse(
    readFileSync(new URL('../fixtures/grok/discovery.json', import.meta.url), 'utf8'),
  )
}

function jsonResponse(json: unknown, status = 200): Response {
  return Response.json(json, { status })
}

interface FetchCall {
  readonly url: string
  readonly method: string
  readonly form: URLSearchParams | undefined
}

/**
A fetch that answers only with the recorded discovery document and refuses
everything else: the tests assert our request shapes from its calls, and
xAI's other answers are never invented here.
*/
function discoveryOnlyFetch(
  options: {
    readonly discovery?: unknown
    readonly calls?: FetchCall[]
  } = {},
): typeof fetch {
  const discovery = options.discovery === undefined ? discoveryFixture() : options.discovery
  const stub: typeof fetch = (url, init) => {
    const href = url instanceof Request ? url.url : String(url)
    const method = init?.method ?? (url instanceof Request ? url.method : 'GET')
    const body = init?.body
    let form: URLSearchParams | undefined
    if (typeof body === 'string') form = new URLSearchParams(body)
    else if (body instanceof URLSearchParams) form = body
    options.calls?.push({ url: href, method, form })
    return href === DISCOVERY_URL && method === 'GET'
      ? Promise.resolve(jsonResponse(discovery))
      : Promise.reject(new Error(`no recorded answer for ${method} ${href}`))
  }
  return stub
}

function testHost(
  overrides: Partial<GrokHostPort> & { readonly secrets: SecretStore },
): GrokHostPort {
  return {
    clientId: CLIENT_ID,
    scopes: undefined,
    fetch: discoveryOnlyFetch(),
    now: Date.now,
    openBrowser: () => Promise.resolve(),
    startCallback: () => Promise.reject(new Error('no callback in this test')),
    readRecord: async () => {
      const stored = await overrides.secrets.get('museSpark.provider.grok')
      if (stored === undefined) return undefined
      try {
        return JSON.parse(stored) as unknown
      } catch (error) {
        // The product hosts name a corrupt entry the same way.
        if (!(error instanceof SyntaxError)) throw error
        throw new GrokSignInError('grant-unreadable')
      }
    },
    writeRecord: async (record: GrokRecord) => {
      await overrides.secrets.store('museSpark.provider.grok', JSON.stringify(record))
    },
    deleteRecord: async () => {
      await overrides.secrets.delete('museSpark.provider.grok')
    },
    withRefreshLock: (work) => work(),
    ...overrides,
  }
}

async function failureCode(work: () => unknown): Promise<{ code: string; reason?: string }> {
  let failure: unknown
  try {
    await work()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(GrokSignInError)
  if (!(failure instanceof GrokSignInError)) throw new Error('unreachable')
  return { code: failure.code, ...(failure.reason !== undefined && { reason: failure.reason }) }
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** Real ES256 JWTs from an ephemeral P-256 key; the JWKS carries its public half. */
function es256Fixture() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const publicJwk = pair.publicKey.export({ format: 'jwk' })
  const kid = 'test-key-1'
  const jwks = {
    keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }],
  }
  const mint = (header: Record<string, unknown>, claims: Record<string, unknown>): string => {
    const body = `${base64urlJson(header)}.${base64urlJson(claims)}`
    const signature = sign('SHA256', Buffer.from(body), {
      key: pair.privateKey,
      dsaEncoding: 'ieee-p1363',
    })
    return `${body}.${signature.toString('base64url')}`
  }
  return { mint, jwks }
}

describe('grok configuration', () => {
  it('refuses a missing client id before any request goes out', async () => {
    expect(await failureCode(() => requireGrokClientId(undefined))).toMatchObject({
      code: 'client-id-unset',
    })
    expect(await failureCode(() => requireGrokClientId(' '.repeat(3)))).toMatchObject({
      code: 'client-id-unset',
    })
    expect(requireGrokClientId(`  ${CLIENT_ID} `)).toBe(CLIENT_ID)
    let calls = 0
    const counting: typeof fetch = () => {
      calls += 1
      return Promise.reject(new Error('must not be called'))
    }
    const signIn = new GrokSignIn(
      testHost({ secrets: mapSecrets({}), clientId: undefined, fetch: counting }),
    )
    expect(await failureCode(() => signIn.signIn())).toMatchObject({ code: 'client-id-unset' })
    expect(calls).toBe(0)
  })

  it('asks pure OpenID scopes until xAI names an app-specific scope', () => {
    expect(resolveGrokScopes(undefined)).toBe('openid offline_access')
    expect(resolveGrokScopes(' '.repeat(3))).toBe(GROK_DEFAULT_SCOPES)
    expect(resolveGrokScopes('  openid offline_access grok-x  ')).toBe(
      'openid offline_access grok-x',
    )
  })

  it('refuses the device flow on a host without that surface, before any request', async () => {
    let calls = 0
    const counting: typeof fetch = () => {
      calls += 1
      return Promise.reject(new Error('must not be called'))
    }
    const signIn = new GrokSignIn(testHost({ secrets: mapSecrets({}), fetch: counting }))
    expect(await failureCode(() => signIn.signInWithDevice())).toEqual({
      code: 'local-failed',
      reason: 'device-unsupported',
    })
    expect(calls).toBe(0)
  })
})

function pkceFlow(): { verifier: string; challenge: string; state: string; nonce: string } {
  const pair = createPkcePair()
  return { ...pair, nonce: pkceRandom(PKCE_STATE_BYTES) }
}

describe('grok authorize url', () => {
  it('builds the documented authorize request with a real S256 challenge', () => {
    const secrets = pkceFlow()
    const url = new URL(
      buildGrokAuthorizeUrl({
        redirectUri: 'http://127.0.0.1:54123/auth/callback',
        clientId: CLIENT_ID,
        scopes: 'openid offline_access',
        verifier: secrets.verifier,
        state: secrets.state,
        nonce: secrets.nonce,
      }),
    )
    expect(url.origin + url.pathname).toBe('https://auth.x.ai/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54123/auth/callback')
    expect(url.searchParams.get('scope')).toBe('openid offline_access')
    expect(url.searchParams.get('state')).toBe(secrets.state)
    expect(url.searchParams.get('nonce')).toBe(secrets.nonce)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // The challenge is really SHA-256 over the verifier, recomputed here.
    const expected = createHash('sha256')
      .update(secrets.verifier, 'utf8')
      .digest('base64')
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/u, '')
    expect(url.searchParams.get('code_challenge')).toBe(expected)
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(secrets.verifier))
  })

  it('refuses anything but a loopback callback without userinfo or query', async () => {
    const secrets = pkceFlow()
    const build = (redirectUri: string): string =>
      buildGrokAuthorizeUrl({
        redirectUri,
        clientId: CLIENT_ID,
        scopes: 'openid offline_access',
        verifier: secrets.verifier,
        state: secrets.state,
        nonce: secrets.nonce,
      })
    for (const redirectUri of [
      'not-a-url',
      'https://127.0.0.1:54123/auth/callback',
      'http://localhost:54123/auth/callback',
      'http://127.0.0.1/auth/callback',
      'http://127.0.0.1:54123/callback',
      'http://user@127.0.0.1:54123/auth/callback',
      'http://127.0.0.1:54123/auth/callback?stray=1',
      'http://127.0.0.1:54123/auth/callback#fragment',
    ]) {
      expect(await failureCode(() => build(redirectUri)), redirectUri).toMatchObject({
        code: 'invalid-callback',
      })
    }
    expect(
      await failureCode(() =>
        buildGrokAuthorizeUrl({
          redirectUri: 'http://127.0.0.1:54123/auth/callback',
          clientId: CLIENT_ID,
          scopes: 'openid offline_access',
          verifier: 'too-short',
          state: secrets.state,
          nonce: secrets.nonce,
        }),
      ),
    ).toMatchObject({ code: 'invalid-callback' })
    expect(
      await failureCode(() =>
        buildGrokAuthorizeUrl({
          redirectUri: 'http://127.0.0.1:54123/auth/callback',
          clientId: '  ',
          scopes: 'openid offline_access',
          verifier: secrets.verifier,
          state: secrets.state,
          nonce: secrets.nonce,
        }),
      ),
    ).toMatchObject({ code: 'client-id-unset' })
  })
})

describe('grok callback', () => {
  const REDIRECT = 'http://127.0.0.1:54123/auth/callback'
  const STATE = pkceRandom(32)

  it('keeps the code and lets anything else through unread', () => {
    const parsed = parseGrokCallback(
      `${REDIRECT}?code=the-code&state=${STATE}&scope=openid+offline_access&iss=https%3A%2F%2Fauth.x.ai`,
      REDIRECT,
      STATE,
    )
    expect(parsed.code).toBe('the-code')
    expect(parsed.scope).toBe('openid offline_access')
    expect(parseGrokCallback(`${REDIRECT}?code=the-code&state=${STATE}`, REDIRECT, STATE)).toEqual({
      code: 'the-code',
      scope: undefined,
    })
  })

  it('says an xAI refusal with xAI’s own code, never free text', () => {
    const failure = (url: string): GrokSignInError => {
      try {
        parseGrokCallback(url, REDIRECT, STATE)
      } catch (error) {
        expect(error).toBeInstanceOf(GrokSignInError)
        if (error instanceof GrokSignInError) return error
      }
      throw new Error('the callback should have failed')
    }
    expect(failure(`${REDIRECT}?error=access_denied&state=${STATE}`)).toMatchObject({
      code: 'authorize-refused',
      reason: 'access_denied',
    })
    // A refusal shaped outside the opaque-token pattern is unusable, not echoed.
    expect(failure(`${REDIRECT}?error=<script>&state=${STATE}`)).toMatchObject({
      code: 'invalid-callback',
    })
    // A refusal for another attempt is a state mismatch first.
    expect(failure(`${REDIRECT}?error=access_denied&state=another-attempt-state`)).toMatchObject({
      code: 'invalid-state',
    })
  })

  it('refuses callbacks that do not match this attempt', async () => {
    const invalid = async (url: string): Promise<void> => {
      expect(await failureCode(() => parseGrokCallback(url, REDIRECT, STATE))).toMatchObject({
        code: 'invalid-callback',
      })
    }
    await invalid(`${REDIRECT}?state=${STATE}`)
    await invalid(`${REDIRECT}?code=a&code=b&state=${STATE}`)
    await invalid(`${REDIRECT}?code=a&state=${STATE}&scope=x&scope=y`)
    await invalid(`http://127.0.0.1:9999/auth/callback?code=a&state=${STATE}`)
    await invalid(`http://127.0.0.1:54123/other?code=a&state=${STATE}`)
    expect(
      await failureCode(() =>
        parseGrokCallback(`${REDIRECT}?code=a&state=another-attempt-state`, REDIRECT, STATE),
      ),
    ).toMatchObject({ code: 'invalid-state' })
  })
})

const DEVICE_NOW = 1_790_000_000_000

function deviceReply(): {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
} {
  return {
    device_code: 'device-code-value',
    user_code: 'ABCD-1234',
    verification_uri: 'https://auth.x.ai/device',
    expires_in: 1800,
    interval: 5,
  }
}

async function expectInvalidToken(value: unknown): Promise<void> {
  expect(await failureCode(() => parseGrokDeviceCode(value, DEVICE_NOW))).toMatchObject({
    code: 'invalid-token',
  })
}

async function expectVerificationRefused(value: unknown): Promise<void> {
  expect(await failureCode(() => parseGrokDeviceCode(value, DEVICE_NOW))).toMatchObject({
    code: 'verification-refused',
  })
}

describe('grok device code', () => {
  it('parses the RFC 8628 reply with its expiry and interval', () => {
    const code = parseGrokDeviceCode(deviceReply(), DEVICE_NOW)
    expect(code.deviceCode).toBe('device-code-value')
    expect(code.userCode).toBe('ABCD-1234')
    expect(code.verificationUri).toBe('https://auth.x.ai/device')
    expect(code.expiresAt).toBe(DEVICE_NOW + 1_800_000)
    expect(code.intervalS).toBe(5)
  })

  it('waits five seconds where xAI names no interval', () => {
    const { interval: _dropped, ...rest } = deviceReply()
    expect(parseGrokDeviceCode(rest, DEVICE_NOW).intervalS).toBe(5)
  })

  it('prefers the complete address, falling back to the plain one', () => {
    const complete = parseGrokDeviceCode(
      { ...deviceReply(), verification_uri_complete: 'https://auth.x.ai/device?code=ABCD-1234' },
      DEVICE_NOW,
    )
    expect(complete.verificationUri).toBe('https://auth.x.ai/device?code=ABCD-1234')
    const fallback = parseGrokDeviceCode(
      { ...deviceReply(), verification_uri_complete: 'not a url' },
      DEVICE_NOW,
    )
    expect(fallback.verificationUri).toBe('https://auth.x.ai/device')
  })

  it('refuses a malformed reply or an unshowable code or address', async () => {
    const { device_code: _device, ...noDevice } = deviceReply()
    await expectInvalidToken(noDevice)
    const { expires_in: _expires, ...noExpiry } = deviceReply()
    await expectInvalidToken(noExpiry)
    await expectInvalidToken({ ...deviceReply(), user_code: 'has a space' })
    await expectInvalidToken({ ...deviceReply(), user_code: 'line\nbreak' })
    await expectInvalidToken({ ...deviceReply(), user_code: '' })
    // Any scheme but https is refused, an http downgrade with it.
    await expectVerificationRefused({
      ...deviceReply(),
      verification_uri: 'gopher://auth.x.ai/device',
    })
    await expectVerificationRefused({ ...deviceReply(), verification_uri: 'not-a-url' })
    await expectVerificationRefused({
      ...deviceReply(),
      verification_uri: 'https://user@auth.x.ai/device',
    })
    await expectVerificationRefused({
      ...deviceReply(),
      verification_uri: 'gopher://auth.x.ai/device',
      verification_uri_complete: 'not a url either',
    })
  })
})

describe('grok identity token', () => {
  const NOW = 1_790_000_000_000
  const claims = (overrides: Record<string, unknown> = {}) => ({
    sub: 'test-subject',
    iss: 'https://auth.x.ai',
    aud: CLIENT_ID,
    exp: NOW / 1000 + 3600,
    iat: NOW / 1000,
    ...overrides,
  })

  it('verifies a real ES256 token and hashes the verified subject', () => {
    const { mint, jwks } = es256Fixture()
    const nonce = pkceRandom(PKCE_STATE_BYTES)
    const token = mint({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' }, claims({ nonce }))
    expect(
      verifyGrokIdToken({ token, jwks, clientId: CLIENT_ID, expectedNonce: nonce, now: NOW }),
    ).toBe(grokAccountIdHash('https://auth.x.ai', 'test-subject'))
    // A device grant carries no nonce to bind; the signature still decides.
    const device = mint({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' }, claims())
    expect(
      verifyGrokIdToken({
        token: device,
        jwks,
        clientId: CLIENT_ID,
        expectedNonce: undefined,
        now: NOW,
      }),
    ).toBe(grokAccountIdHash('https://auth.x.ai', 'test-subject'))
    // The hash is stable and binds issuer and subject together.
    expect(grokAccountIdHash('https://auth.x.ai', 'test-subject')).toBe(
      grokAccountIdHash('https://auth.x.ai', 'test-subject'),
    )
    expect(grokAccountIdHash('https://auth.x.ai', 'other')).not.toBe(
      grokAccountIdHash('https://auth.x.ai', 'test-subject'),
    )
  })

  it('refuses anything but a valid ES256 token for this client', async () => {
    const { mint, jwks } = es256Fixture()
    const nonce = pkceRandom(PKCE_STATE_BYTES)
    const valid = mint({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' }, claims({ nonce }))
    const invalid = async (token: string, keySet: unknown = jwks): Promise<void> => {
      expect(
        await failureCode(() =>
          verifyGrokIdToken({
            token,
            jwks: keySet,
            clientId: CLIENT_ID,
            expectedNonce: nonce,
            now: NOW,
          }),
        ),
      ).toMatchObject({ code: 'invalid-id-token' })
    }
    const parts = valid.split('.')
    const header = parts[0]
    const body = parts[1]
    if (header === undefined || body === undefined) throw new Error('the test token is malformed')
    await invalid(`${header}.${body}.tampered-signature`)
    await invalid(`${header}.${body}`)
    await invalid('not-a-jwt')
    await invalid(mint({ alg: 'ES256', kid: 'unknown-key', typ: 'JWT' }, claims({ nonce })))
    await invalid(mint({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' }, claims({ nonce })))
    await invalid(
      mint({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' }, claims({ aud: 'another-app' })),
    )
    await invalid(
      mint(
        { alg: 'ES256', kid: 'test-key-1', typ: 'JWT' },
        claims({ aud: [CLIENT_ID, 'another-app'] }),
      ),
    )
    await invalid(
      mint({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' }, claims({ nonce: 'a-different-nonce' })),
    )
    await invalid(
      mint(
        { alg: 'ES256', kid: 'test-key-1', typ: 'JWT' },
        claims({ exp: NOW / 1000 - 10, nonce }),
      ),
    )
    await invalid(valid, { keys: [] })
    const firstKey = jwks.keys[0]
    if (firstKey === undefined) throw new Error('the test key set is empty')
    await invalid(valid, { keys: [{ ...firstKey, kty: 'RSA' }] })
  })

  it('verifies without a subject and returns no hash', () => {
    const { mint, jwks } = es256Fixture()
    const { sub: _dropped, ...rest } = claims()
    const token = mint({ alg: 'ES256', kid: 'test-key-1', typ: 'JWT' }, rest)
    expect(
      verifyGrokIdToken({
        token,
        jwks,
        clientId: CLIENT_ID,
        expectedNonce: undefined,
        now: NOW,
      }),
    ).toBeUndefined()
  })
})

describe('grok grant storage', () => {
  it('parses a stored grant and refuses malformed ones', () => {
    expect(grokRecordSchema.safeParse(grokGrantRecord()).success).toBe(true)
    expect(grokRecordSchema.safeParse({ ...grokGrantRecord(), v: 999 }).success).toBe(false)
    expect(grokRecordSchema.safeParse({ ...grokGrantRecord(), accessToken: '' }).success).toBe(
      false,
    )
    expect(grokRecordSchema.safeParse('not-a-record').success).toBe(false)
  })

  it('serves a live grant without any request', async () => {
    let calls = 0
    const counting: typeof fetch = () => {
      calls += 1
      return Promise.reject(new Error('must not be called'))
    }
    const secrets = mapSecrets({ 'museSpark.provider.grok': JSON.stringify(grokGrantRecord()) })
    const signIn = new GrokSignIn(testHost({ secrets, fetch: counting }))
    expect(await signIn.accessToken('https://api.x.ai/v1/responses', 0)).toBe(
      'test-access-token-placeholder',
    )
    expect(calls).toBe(0)
  })

  it('binds the grant to the model origin and refuses misuse plainly', async () => {
    const secrets = mapSecrets({ 'museSpark.provider.grok': JSON.stringify(grokGrantRecord()) })
    const signIn = new GrokSignIn(testHost({ secrets }))
    expect(
      await failureCode(() => signIn.accessToken('https://evil.example/v1/responses', 0)),
    ).toMatchObject({ code: 'origin-mismatch' })
    await expect(signIn.accessToken('https://api.x.ai/v1/responses', -1)).rejects.toThrow(
      RangeError,
    )
    const missing = new GrokSignIn(testHost({ secrets: mapSecrets({}) }))
    expect(
      await failureCode(() => missing.accessToken('https://api.x.ai/v1/responses', 0)),
    ).toMatchObject({
      code: 'not-signed-in',
    })
    const malformed = new GrokSignIn(
      testHost({ secrets: mapSecrets({ 'museSpark.provider.grok': '{oops' }) }),
    )
    expect(
      await failureCode(() => malformed.accessToken('https://api.x.ai/v1/responses', 0)),
    ).toMatchObject({ code: 'grant-unreadable' })
    const wrongShape = new GrokSignIn(
      testHost({
        secrets: mapSecrets({ 'museSpark.provider.grok': JSON.stringify({ v: 1 }) }),
      }),
    )
    expect(
      await failureCode(() => wrongShape.accessToken('https://api.x.ai/v1/responses', 0)),
    ).toMatchObject({ code: 'grant-unreadable' })
  })

  it('starts a refresh at the recorded discovery document', async () => {
    const calls: FetchCall[] = []
    const expired = grokGrantRecord({ expiresAt: Date.now() - 1000 })
    const secrets = mapSecrets({ 'museSpark.provider.grok': JSON.stringify(expired) })
    const signIn = new GrokSignIn(
      testHost({ secrets, fetch: discoveryOnlyFetch({ calls }), now: () => Date.now() }),
    )
    // Discovery validates; the token endpoint has no recorded answer, so the
    // refresh fails there — the test asserts the attempt's shape, not xAI's answer.
    expect(
      await failureCode(() => signIn.accessToken('https://api.x.ai/v1/responses', 0)),
    ).toMatchObject({
      code: 'request-failed',
    })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${DISCOVERY_URL}`,
      `POST ${TOKEN_URL}`,
    ])
    const refresh = calls[1]?.form
    expect(refresh?.get('grant_type')).toBe('refresh_token')
    expect(refresh?.get('client_id')).toBe(CLIENT_ID)
    expect(refresh?.get('refresh_token')).toBe('test-refresh-token-placeholder')
    expect(refresh?.has('client_secret')).toBe(false)
  })

  it('refuses a discovery document outside the recorded shape', async () => {
    const expired = grokGrantRecord({ expiresAt: Date.now() - 1000 })
    const attempt = async (discovery: unknown): Promise<{ code: string; reason?: string }> => {
      const secrets = mapSecrets({ 'museSpark.provider.grok': JSON.stringify(expired) })
      const signIn = new GrokSignIn(
        testHost({ secrets, fetch: discoveryOnlyFetch({ discovery }), now: () => Date.now() }),
      )
      return await failureCode(() => signIn.accessToken('https://api.x.ai/v1/responses', 0))
    }
    const recorded = discoveryFixture() as Record<string, unknown>
    // The recorded document validates: the failure below is the unrecorded
    // token endpoint, never the discovery.
    expect(await attempt(recorded)).toMatchObject({ code: 'request-failed' })
    expect(await attempt({ ...recorded, issuer: 'https://evil.example' })).toMatchObject({
      code: 'invalid-discovery',
    })
    expect(
      await attempt({ ...recorded, token_endpoint: 'https://evil.example/oauth2/token' }),
    ).toMatchObject({ code: 'invalid-discovery' })
    expect(
      await attempt({
        ...recorded,
        device_authorization_endpoint: 'https://evil.example/oauth2/device/code',
      }),
    ).toMatchObject({ code: 'invalid-discovery' })
    expect(
      await attempt({ ...recorded, grant_types_supported: ['authorization_code'] }),
    ).toMatchObject({ code: 'invalid-discovery' })
    expect(
      await attempt({ ...recorded, code_challenge_methods_supported: ['plain'] }),
    ).toMatchObject({ code: 'invalid-discovery' })
    expect(
      await attempt({ ...recorded, id_token_signing_alg_values_supported: ['RS256'] }),
    ).toMatchObject({ code: 'invalid-discovery' })
    expect(
      await attempt({ ...recorded, jwks_uri: 'https://evil.example/jwks.json' }),
    ).toMatchObject({
      code: 'invalid-discovery',
    })
    expect(await attempt({ unexpected: 'shape' })).toMatchObject({ code: 'invalid-discovery' })
  })

  it('signs out locally even when revocation cannot be attempted', async () => {
    const calls: FetchCall[] = []
    const secrets = mapSecrets({ 'museSpark.provider.grok': JSON.stringify(grokGrantRecord()) })
    const signIn = new GrokSignIn(testHost({ secrets, fetch: discoveryOnlyFetch({ calls }) }))
    expect(await failureCode(() => signIn.remove())).toMatchObject({ code: 'request-failed' })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET ${DISCOVERY_URL}`,
      'POST https://auth.x.ai/oauth2/revoke',
    ])
    const revoke = calls[1]?.form
    expect(revoke?.get('client_id')).toBe(CLIENT_ID)
    expect(revoke?.get('token')).toBe('test-refresh-token-placeholder')
    expect(revoke?.get('token_type_hint')).toBe('refresh_token')
    // The local grant is gone either way.
    expect(await secrets.get('museSpark.provider.grok')).toBeUndefined()
    const missing = new GrokSignIn(testHost({ secrets: mapSecrets({}) }))
    await missing.remove()
  })
})
