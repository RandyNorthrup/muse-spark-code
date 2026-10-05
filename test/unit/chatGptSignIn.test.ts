import { generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  buildChatGptAuthorizeUrl,
  ChatGptSignIn,
  chatGptRecordSchema,
  parseChatGptCallback,
  verifyChatGptIdToken,
  type ChatGptHostPort,
  type ChatGptRecord,
} from '../../src/core/providers/subscriptions/chatgpt'
import { createPkcePair, pkceChallenge } from '../../src/core/providers/pkce'

// Synthetic credentials only, with the flow/claim names recorded by the owner's
// two 2026-10-05 captures in M95B-FINDINGS.md (0 + 1 model attempts).
const ISSUER = 'https://auth.openai.com'
const CLIENT = 'oaiapp_synthetic_client'
const REDIRECT = 'http://127.0.0.1:49152/auth/callback'
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const NOW = 1_800_000_000_000
const NONCE = 'synthetic_nonce_123456789'
const HOST = 'synthetic_host_123456789'
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk: JsonWebKey = keyPair.publicKey.export({ format: 'jwk' })
const JWKS = { keys: [{ ...jwk, kid: 'captured-key', alg: 'RS256', use: 'sig' }] }
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
  token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
  revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
  jwks_uri: `${ISSUER}/synthetic-jwks`,
}

function jwt(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const parts = [
    { alg: 'RS256', kid: 'captured-key', ...header },
    { iss: ISSUER, aud: CLIENT, exp: NOW / 1000 + 3600, nonce: NONCE, ...claims },
  ].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
  const unsigned = parts.join('.')
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), keyPair.privateKey).toString('base64url')}`
}

function verifyToken(token = jwt(), jwks: unknown = JWKS): void {
  verifyChatGptIdToken({ token, jwks, clientId: CLIENT, nonce: NONCE, now: NOW })
}

function record(): ChatGptRecord {
  return {
    v: 1,
    auth: 'subscription',
    origin: 'https://api.openai.com',
    issuer: ISSUER,
    clientId: CLIENT,
    hostId: HOST,
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    expiresAt: NOW + 3600 * 1000,
    scope: SCOPE,
    nonce: NONCE,
  }
}

function rig(initial?: unknown) {
  let stored: unknown = initial
  let nonce = NONCE
  let currentNow = NOW
  let callbackValue: string | undefined
  const pendingCallback = Promise.withResolvers<string>()
  let queue = Promise.resolve<undefined>(undefined)
  const responses = new Map<string, unknown>()
  const requests: { url: string; init: RequestInit | undefined }[] = []
  let status = 200
  let tokenOverrides: Record<string, unknown> = {}
  const fetcher: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({ url, init })
    let body = responses.get(url)
    if (body === undefined) {
      switch (url) {
        case `${ISSUER}/.well-known/openid-configuration`: {
          body = DISCOVERY
          break
        }
        case DISCOVERY.jwks_uri: {
          body = JWKS
          break
        }
        case DISCOVERY.token_endpoint: {
          body = {
            access_token: 'synthetic-new-access',
            refresh_token: 'synthetic-new-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: jwt({ nonce }),
            scope: SCOPE,
            ...tokenOverrides,
          }
          break
        }
        default: {
          body = {}
        }
      }
    }
    return Promise.resolve(Response.json(body, { status }))
  }
  const writeRecord = vi.fn((value: ChatGptRecord) => {
    stored = value
    return Promise.resolve()
  })
  const deleteRecord = vi.fn(() => {
    stored = undefined
    return Promise.resolve()
  })
  const close = vi.fn()
  const openBrowser = vi.fn((url: string) => {
    const params = new URL(url).searchParams
    nonce = params.get('nonce') ?? ''
    const callback =
      callbackValue ??
      `${REDIRECT}?${new URLSearchParams({
        code: 'synthetic-code',
        state: params.get('state') ?? '',
        scope: SCOPE,
        client_id: CLIENT,
      }).toString()}`
    pendingCallback.resolve(callback)
    return Promise.resolve()
  })
  const startCallback = vi.fn(() =>
    Promise.resolve({
      redirectUri: REDIRECT,
      waitForCallback: () => pendingCallback.promise,
      close,
    }),
  )
  const host: ChatGptHostPort = {
    hostId: HOST,
    fetch: fetcher,
    now: () => currentNow,
    openBrowser,
    startCallback,
    readRecord: () => Promise.resolve(stored),
    writeRecord,
    deleteRecord,
    withRefreshLock: async <T>(work: () => Promise<T>): Promise<T> => {
      const previous = queue
      const release = Promise.withResolvers<undefined>()
      queue = release.promise
      await previous
      try {
        return await work()
      } finally {
        release.resolve(undefined)
      }
    },
  }
  return {
    host,
    core: new ChatGptSignIn(host),
    requests,
    responses,
    token: (value: Record<string, unknown>) => {
      tokenOverrides = value
    },
    writeRecord,
    deleteRecord,
    close,
    openBrowser,
    startCallback,
    stored: () => stored,
    clock: (value: number) => {
      currentNow = value
    },
    status: (value: number) => {
      status = value
    },
    callback: (value: string) => {
      callbackValue = value
    },
  }
}

function tokenRequests(tester: ReturnType<typeof rig>) {
  return tester.requests.filter((request) => request.url === DISCOVERY.token_endpoint)
}

function form(init: RequestInit | undefined): URLSearchParams {
  expect(init?.body).toBeInstanceOf(URLSearchParams)
  if (!(init?.body instanceof URLSearchParams)) throw new Error('missing form')
  return init.body
}

function insecureApiUrl(): string {
  const url = new URL('https://api.openai.com/v1/responses')
  url.protocol = 'http:'
  return url.href
}

describe('ChatGPT authorize and callback', () => {
  it('requests the dynamic client, exact resource/scopes, S256 and opaque host id', () => {
    const pair = createPkcePair()
    const url = new URL(
      buildChatGptAuthorizeUrl({ ...pair, redirectUri: REDIRECT, hostId: HOST, nonce: NONCE }),
    )
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'dynamic_agent_client',
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: SCOPE,
      resource: 'https://api.openai.com/v1',
      state: pair.state,
      nonce: NONCE,
      code_challenge: pkceChallenge(pair.verifier),
      code_challenge_method: 'S256',
      agent_name_hint: 'Muse Spark Code (Unofficial)',
      ext_agent_host_id: HOST,
    })
    expect(url.href).not.toContain(pair.verifier)
  })

  it.each([
    'http://localhost:49152/auth/callback',
    'http://127.0.0.2:49152/auth/callback',
    'https://127.0.0.1:49152/auth/callback',
    'http://127.0.0.1/auth/callback',
    `${REDIRECT}?extra=x`,
    `${REDIRECT}#fragment`,
    'http://user@127.0.0.1:49152/auth/callback',
    'http://127.0.0.1:49152/callback',
  ])('refuses an unsafe redirect %s', (redirectUri) => {
    expect(() =>
      buildChatGptAuthorizeUrl({ ...createPkcePair(), redirectUri, hostId: HOST, nonce: NONCE }),
    ).toThrow('chatgpt.invalid-callback')
  })

  it.each(['state', 'nonce', 'hostId', 'verifier'] as const)('refuses a non-opaque %s', (field) => {
    expect(() =>
      buildChatGptAuthorizeUrl({
        ...createPkcePair(),
        redirectUri: REDIRECT,
        hostId: HOST,
        nonce: NONCE,
        [field]: 'email@example.test',
      }),
    ).toThrow()
  })

  it('refuses a wrong state before any token exchange and closes the callback', async () => {
    const tester = rig()
    tester.callback(`${REDIRECT}?code=synthetic-code&client_id=${CLIENT}&scope=openid&state=wrong`)
    await expect(tester.core.signIn()).rejects.toThrow('chatgpt.invalid-state')
    expect(tokenRequests(tester)).toHaveLength(0)
    expect(tester.writeRecord).not.toHaveBeenCalled()
    expect(tester.close).toHaveBeenCalledOnce()
  })

  it.each(['code', 'client_id', 'scope', 'state'])(
    'refuses duplicate %s callback fields',
    (field) => {
      const query = new URLSearchParams({
        code: 'synthetic-code',
        client_id: CLIENT,
        scope: SCOPE,
        state: NONCE,
      })
      query.append(field, query.get(field) ?? '')
      expect(() =>
        parseChatGptCallback(`${REDIRECT}?${query.toString()}`, REDIRECT, NONCE),
      ).toThrow('chatgpt.invalid-callback')
    },
  )

  it('refuses another callback origin, dynamic client, missing fields and provider refusal', () => {
    for (const suffix of [
      '?error=denied',
      '?code=x',
      `?code=x&client_id=dynamic_agent_client&scope=openid&state=${NONCE}`,
    ]) {
      expect(() => parseChatGptCallback(`${REDIRECT}${suffix}`, REDIRECT, NONCE)).toThrow()
    }
    expect(() =>
      parseChatGptCallback(
        `${REDIRECT.replace('49152', '49153')}?code=x&client_id=${CLIENT}&scope=openid&state=${NONCE}`,
        REDIRECT,
        NONCE,
      ),
    ).toThrow()
  })
})

describe('ChatGPT ID-token verification', () => {
  it('verifies an RS256 signature without returning identity claims', () => {
    verifyToken(jwt({ email: 'synthetic@example.test', sub: 'synthetic-account' }))
  })
  it('refuses a signature from another key', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const [header, claims] = jwt().split('.', 2)
    const unsigned = `${header ?? ''}.${claims ?? ''}`
    expect(() => {
      verifyToken(
        `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), other.privateKey).toString(
          'base64url',
        )}`,
      )
    }).toThrow('chatgpt.invalid-id-token')
  })
  it.each([
    ['issuer', { iss: 'https://phishing.example' }],
    ['audience', { aud: 'another-client' }],
    ['expiry', { exp: NOW / 1000 }],
    ['nonce', { nonce: 'another-nonce' }],
    ['missing nonce', { nonce: undefined }],
    ['multiple audiences without azp', { aud: [CLIENT, 'other'] }],
    ['wrong azp', { aud: [CLIENT, 'other'], azp: 'other' }],
    ['single audience wrong azp', { azp: 'other' }],
  ])('refuses invalid %s claims', (_name, claims) => {
    expect(() => {
      verifyToken(jwt(typeof claims === 'string' ? {} : claims))
    }).toThrow('chatgpt.invalid-id-token')
  })
  it.each([{ alg: 'none' }, { alg: 'HS256' }, { kid: 'unknown' }])(
    'refuses an untrusted header %j',
    (header) => {
      expect(() => {
        verifyToken(jwt({}, header))
      }).toThrow('chatgpt.invalid-id-token')
    },
  )
  it.each([
    { kty: 'EC' },
    { alg: 'HS256' },
    { use: 'enc' },
    { n: undefined },
    { e: undefined },
    { n: 'invalid' },
  ])('refuses an unsuitable JWKS key %j', (change) => {
    expect(() => {
      verifyToken(jwt(), { keys: [{ ...JWKS.keys[0], ...change }] })
    }).toThrow('chatgpt.invalid-id-token')
  })
  it('refuses duplicate key ids, malformed JWTs and malformed JWKS', () => {
    expect(() => {
      verifyToken(jwt(), { keys: [...JWKS.keys, ...JWKS.keys] })
    }).toThrow()
    for (const token of ['', 'a.b.c', `${jwt()}.extra`, jwt().replace(/.$/u, '!')]) {
      expect(() => {
        verifyToken(token)
      }).toThrow('chatgpt.invalid-id-token')
    }
    expect(() => {
      verifyToken(jwt(), { keys: 'wrong' })
    }).toThrow('chatgpt.invalid-id-token')
  })
  it('allows multiple audiences only with our authorized party', () => {
    verifyToken(jwt({ aud: [CLIENT, 'other'], azp: CLIENT }))
  })
  it('permits an omitted nonce only on refresh and refuses a changed refresh nonce', () => {
    const options = { jwks: JWKS, clientId: CLIENT, nonce: NONCE, now: NOW, isRefresh: true }
    verifyChatGptIdToken({ ...options, token: jwt({ nonce: undefined }) })
    expect(() => {
      verifyChatGptIdToken({ ...options, token: jwt({ nonce: 'changed' }) })
    }).toThrow()
  })
})

describe('shared ChatGPT sign-in, refresh and removal', () => {
  it('stores the issued client and verified origin-bound grant using the host port', async () => {
    const tester = rig()
    await tester.core.signIn()
    const result = chatGptRecordSchema.parse(tester.stored())
    expect(result).toMatchObject({
      ...record(),
      accessToken: 'synthetic-new-access',
      refreshToken: 'synthetic-new-refresh',
      nonce: result.nonce,
    })
    expect(result.nonce).not.toBe(NONCE)
    expect(tester.startCallback).toHaveBeenCalledWith(expect.any(String), 600_000)
    expect(tester.close).toHaveBeenCalledOnce()
    const exchange = tokenRequests(tester)[0]
    const body = form(exchange?.init)
    expect(body.get('client_id')).toBe(CLIENT)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('redirect_uri')).toBe(REDIRECT)
    expect(body.get('resource')).toBe('https://api.openai.com/v1')
    const opened = new URL(tester.openBrowser.mock.calls[0]?.[0] ?? '')
    expect(pkceChallenge(body.get('code_verifier') ?? '')).toBe(
      opened.searchParams.get('code_challenge'),
    )
    for (const request of tester.requests) expect(request.init?.redirect).toBe('error')
    expect(Object.keys(result)).not.toContain('email')
    expect(JSON.stringify(result)).not.toContain('synthetic-account')
  })

  it('refuses missing plan scope without storing any credential', async () => {
    const tester = rig()
    tester.token({ scope: 'openid' })
    await expect(tester.core.signIn()).rejects.toThrow('chatgpt.missing-plan-scope')
    expect(tester.writeRecord).not.toHaveBeenCalled()
    const refresh = rig({ ...record(), expiresAt: NOW, scope: 'openid' })
    await expect(
      refresh.core.accessToken('https://api.openai.com/v1/responses', 0),
    ).rejects.toThrow('chatgpt.missing-plan-scope')
    expect(refresh.requests).toHaveLength(0)
  })

  it('serializes rotation across two windows and re-reads the stored grant under the lock', async () => {
    const tester = rig({ ...record(), expiresAt: NOW + 1000 })
    const other = new ChatGptSignIn(tester.host)
    const result = await Promise.all([
      tester.core.accessToken('https://api.openai.com/v1/responses', 2000),
      other.accessToken('https://api.openai.com/v1/responses', 2000),
    ])
    expect(result).toEqual(['synthetic-new-access', 'synthetic-new-access'])
    expect(tokenRequests(tester)).toHaveLength(1)
    expect(form(tokenRequests(tester)[0]?.init).get('refresh_token')).toBe('synthetic-refresh')
    expect(tester.stored()).toMatchObject({
      refreshToken: 'synthetic-new-refresh',
      clientId: CLIENT,
    })
  })

  it.each(['sign-in', 'refresh'])(
    'anchors %s expiry to token receipt before a slow JWKS read',
    async (flow) => {
      const tester = rig(flow === 'refresh' ? { ...record(), expiresAt: NOW } : undefined)
      const core = new ChatGptSignIn({
        ...tester.host,
        fetch: (input, init) => {
          if (input === DISCOVERY.jwks_uri) tester.clock(NOW + 60_000)
          return tester.host.fetch(input, init)
        },
      })
      if (flow === 'refresh') await core.accessToken('https://api.openai.com/v1/models', 0)
      else await core.signIn()
      expect(tester.stored()).toMatchObject({ expiresAt: NOW + 3_600_000 })
    },
  )

  it('returns a valid token without any network call', async () => {
    const tester = rig(record())
    expect(await tester.core.accessToken('https://api.openai.com/v1/models', 1000)).toBe(
      'synthetic-access',
    )
    expect(tester.requests).toHaveLength(0)
  })

  it.each([
    'https://attacker.test/v1/responses',
    insecureApiUrl(),
    'https://api.openai.com:444/v1/responses',
    'https://user@api.openai.com/v1/models',
    'invalid',
  ])('refuses access-token origin escape before refresh: %s', async (url) => {
    const tester = rig({ ...record(), expiresAt: NOW })
    await expect(tester.core.accessToken(url, 0)).rejects.toThrow('chatgpt.origin-mismatch')
    expect(tester.requests).toHaveLength(0)
  })

  it.each(['issuer', 'origin'] as const)(
    'refuses an altered stored %s before sending secrets',
    async (field) => {
      const tester = rig({ ...record(), [field]: 'https://attacker.test', expiresAt: NOW })
      await expect(tester.core.accessToken('https://api.openai.com/v1/models', 0)).rejects.toThrow(
        'chatgpt.invalid-token',
      )
      expect(tester.requests).toHaveLength(0)
    },
  )

  it.each([
    'issuer',
    'token_endpoint',
    'revocation_endpoint',
    'authorization_endpoint',
    'jwks_uri',
  ])('refuses an altered discovery %s', async (field) => {
    const tester = rig()
    tester.responses.set(`${ISSUER}/.well-known/openid-configuration`, {
      ...DISCOVERY,
      [field]: 'https://attacker.test/credential-target',
    })
    await expect(tester.core.signIn()).rejects.toThrow('chatgpt.invalid-discovery')
    expect(tester.requests).toHaveLength(1)
    expect(tester.openBrowser).not.toHaveBeenCalled()
  })

  it('asks to sign in again for a revoked grant and leaves the record unrotated', async () => {
    const tester = rig({ ...record(), expiresAt: NOW })
    tester.status(400)
    await expect(tester.core.accessToken('https://api.openai.com/v1/models', 0)).rejects.toThrow(
      'chatgpt.sign-in-required',
    )
    expect(tester.writeRecord).not.toHaveBeenCalled()
  })

  it('revokes the refresh token at its issuer before deleting the record', async () => {
    const tester = rig(record())
    await tester.core.remove()
    const request = tester.requests.find((item) => item.url === DISCOVERY.revocation_endpoint)
    expect(Object.fromEntries(form(request?.init))).toEqual({
      client_id: CLIENT,
      token: 'synthetic-refresh',
      token_type_hint: 'refresh_token',
    })
    expect(tester.deleteRecord).toHaveBeenCalledOnce()
    expect(tester.stored()).toBeUndefined()
  })

  it('deletes the record even when revocation is refused', async () => {
    const tester = rig(record())
    tester.status(400)
    await expect(tester.core.remove()).rejects.toThrow('chatgpt.sign-in-required')
    expect(tester.stored()).toBeUndefined()
  })

  it.each([
    { access_token: '' },
    { refresh_token: '' },
    { expires_in: 0 },
    { expires_in: -1 },
    { token_type: 'Basic' },
    { id_token: undefined },
  ])('refuses malformed initial token response %j without storing it', async (change) => {
    const tester = rig()
    tester.token(change)
    await expect(tester.core.signIn()).rejects.toThrow()
    expect(tester.writeRecord).not.toHaveBeenCalled()
    expect(tester.close).toHaveBeenCalledOnce()
  })

  it('refuses reduced scope on refresh without overwriting the prior grant', async () => {
    const tester = rig({ ...record(), expiresAt: NOW })
    tester.token({ scope: 'openid' })
    await expect(tester.core.accessToken('https://api.openai.com/v1/models', 0)).rejects.toThrow(
      'chatgpt.missing-plan-scope',
    )
    expect(tester.writeRecord).not.toHaveBeenCalled()
    expect(tester.stored()).toMatchObject({ refreshToken: 'synthetic-refresh' })
  })

  it('requires a rotated refresh token instead of silently reusing the old one', async () => {
    const tester = rig({ ...record(), expiresAt: NOW })
    tester.token({ refresh_token: undefined })
    await expect(tester.core.accessToken('https://api.openai.com/v1/models', 0)).rejects.toThrow(
      'chatgpt.invalid-token',
    )
    expect(tester.writeRecord).not.toHaveBeenCalled()
  })

  it('allows an OAuth refresh to omit scope and ID token without losing the stored scope', async () => {
    const tester = rig({ ...record(), expiresAt: NOW })
    tester.token({ id_token: undefined, scope: undefined })
    await expect(tester.core.accessToken('https://api.openai.com/v1/models', 0)).resolves.toBe(
      'synthetic-new-access',
    )
    expect(tester.stored()).toMatchObject({ scope: SCOPE })
    expect(tester.requests.some((request) => request.url === DISCOVERY.jwks_uri)).toBe(false)
  })

  it('closes the callback when the browser cannot open', async () => {
    const tester = rig()
    tester.openBrowser.mockRejectedValueOnce(new Error('browser unavailable'))
    await expect(tester.core.signIn()).rejects.toThrow('chatgpt.request-failed')
    expect(tester.close).toHaveBeenCalledOnce()
    expect(tokenRequests(tester)).toHaveLength(0)
  })

  it('reports no stored grant as sign-in required without network', async () => {
    const tester = rig()
    await expect(tester.core.accessToken('https://api.openai.com/v1/models', 0)).rejects.toThrow(
      'chatgpt.sign-in-required',
    )
    expect(tester.requests).toHaveLength(0)
    await tester.core.remove()
    expect(tester.requests).toHaveLength(0)
  })

  it.each([-1, NaN, Infinity])('refuses invalid validity margin %s', async (margin) => {
    const tester = rig(record())
    await expect(
      tester.core.accessToken('https://api.openai.com/v1/models', margin),
    ).rejects.toThrow('chatgpt.invalid-token')
    expect(tester.requests).toHaveLength(0)
  })

  it('does not surface a transport error containing synthetic secret values', async () => {
    const tester = rig(record())
    const core = new ChatGptSignIn({
      ...tester.host,
      fetch: () => Promise.reject(new Error('synthetic-refresh confidential')),
    })
    await expect(core.remove()).rejects.toThrow(/^chatgpt.request-failed$/)
    expect(tester.stored()).toBeUndefined()
  })

  it.each(['openBrowser', 'readRecord', 'writeRecord', 'deleteRecord'] as const)(
    'does not expose a secret-bearing host %s failure',
    async (method) => {
      const tester = rig(record())
      const host = {
        ...tester.host,
        [method]: () => Promise.reject(new Error('synthetic-refresh confidential')),
      }
      const core = new ChatGptSignIn(host)
      let operation: Promise<unknown>
      if (method === 'readRecord')
        operation = core.accessToken('https://api.openai.com/v1/models', 0)
      else if (method === 'deleteRecord') operation = core.remove()
      else operation = core.signIn()
      await expect(operation).rejects.toThrow(/^chatgpt.request-failed$/)
    },
  )

  it('rejects malformed JSON and deletes a malformed record without sending it', async () => {
    const tester = rig(record())
    const core = new ChatGptSignIn({
      ...tester.host,
      fetch: () => Promise.resolve(new Response('invalid-json')),
    })
    await expect(core.remove()).rejects.toThrow('chatgpt.invalid-token')
    const damaged = rig({ ...record(), issuer: 'https://attacker.test' })
    await expect(damaged.core.remove()).rejects.toThrow('chatgpt.invalid-token')
    expect(damaged.requests).toHaveLength(0)
    expect(damaged.stored()).toBeUndefined()
  })

  it('has no dependency on another application credential path, editor API or children', async () => {
    const source = await readFile(
      new URL('../../src/core/providers/subscriptions/chatgpt.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(
      /auth\.json|\.codex|\.claude|\.gemini|backend-api|node:fs|node:child_process|from ['"]vscode/,
    )
  })
})
