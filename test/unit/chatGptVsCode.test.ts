import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { connect } from 'node:net'
import path from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import * as vscode from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChatGptSignIn, startChatGptCallback } from '../../src/host/providers/chatgptSignIn'
import { chatGptRecordSchema } from '../../src/core/providers/subscriptions/chatgpt'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

const STATE = 'synthetic_state_123456789'
const SCOPE = 'openid chatgpt.tokens.use.direct'
const ISSUER = 'https://auth.openai.com'
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
  token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
  revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
  jwks_uri: `${ISSUER}/synthetic-jwks`,
}
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const directories: string[] = []
afterEach(async () => {
  setUiText(EN, 'en')
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true })
})

function callbackUrl(redirectUri: string): string {
  const url = new URL(redirectUri)
  url.search = new URLSearchParams({
    state: STATE,
    code: 'synthetic-code',
    scope: SCOPE,
    client_id: 'synthetic-issued-client',
  }).toString()
  return url.href
}

async function rig() {
  const directory = await mkdtemp(path.join(tmpdir(), 'm95b-v-'))
  directories.push(directory)
  const records = new Map<string, string>()
  let nonce = STATE
  let callback: string | undefined
  const secrets = {
    get: vi.fn((key: string) => Promise.resolve(records.get(key))),
    store: vi.fn((key: string, value: string) => {
      records.set(key, value)
      return Promise.resolve()
    }),
    delete: vi.fn((key: string) => {
      records.delete(key)
      return Promise.resolve()
    }),
  }
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    let url: string
    if (typeof input === 'string') url = input
    else url = input instanceof URL ? input.href : input.url
    if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json(DISCOVERY)
    if (url === DISCOVERY.jwks_uri) {
      return Response.json({
        keys: [{ ...keyPair.publicKey.export({ format: 'jwk' }), kid: 'key' }],
      })
    }
    if (url === DISCOVERY.revocation_endpoint) return new Response(null)
    await pause(20)
    const payload = [
      { alg: 'RS256', kid: 'key' },
      { iss: ISSUER, aud: 'synthetic-issued-client', nonce, exp: Date.now() / 1000 + 3600 },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.')
    const signature = sign('RSA-SHA256', Buffer.from(payload), keyPair.privateKey).toString(
      'base64url',
    )
    return Response.json({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: SCOPE,
      id_token: `${payload}.${signature}`,
    })
  })
  const browser = vi.fn(async (uri: vscode.Uri) => {
    const authorize = new URL(uri.path)
    nonce = authorize.searchParams.get('nonce')!
    callback = authorize.searchParams.get('redirect_uri')!
    const url = new URL(callbackUrl(callback))
    url.searchParams.set('state', authorize.searchParams.get('state')!)
    const response = await fetch(url)
    expect(response.status).toBe(200)
    return true
  })
  const deps = {
    secrets,
    globalStorageUri: vscode.Uri.file(directory),
    isRemote: false,
    fetch: fetcher,
    openExternal: browser,
    lockPollMs: 1,
    lockTimeoutMs: 1000,
  }
  return { directory, records, secrets, fetcher, browser, deps, callback: () => callback }
}

describe('ChatGPT callback port', () => {
  it('binds only the captured loopback path, retains an early callback, and closes after one use', async () => {
    const server = await startChatGptCallback(STATE, 1000)
    try {
      expect(server.bindHost).toBe('127.0.0.1')
      expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
      const response = await fetch(callbackUrl(server.redirectUri))
      expect(response.status).toBe(200)
      await expect(server.waitForCallback()).resolves.toBe(callbackUrl(server.redirectUri))
      await expect(fetch(callbackUrl(server.redirectUri))).rejects.toThrow()
    } finally {
      server.close()
    }
  })

  it.each(['state=wrong', `state=${STATE}&state=duplicate`, `state=${STATE}&error=access_denied`])(
    'rejects untrusted callback %s without exposing provider text',
    async (query) => {
      const server = await startChatGptCallback(STATE, 1000)
      const failed = expect(server.waitForCallback()).rejects.toThrow(/^chatgpt.invalid-callback$/)
      try {
        const response = await fetch(
          `${server.redirectUri}?code=synthetic&scope=${SCOPE}&client_id=issued&${query}`,
        )
        expect(response.status).toBe(400)
        await failed
      } finally {
        server.close()
      }
    },
  )

  it('ignores unrelated paths and methods and translates the plain-text browser result at use time', async () => {
    const server = await startChatGptCallback(STATE, 1000)
    try {
      const missing = await fetch(`${server.redirectUri}/other`)
      expect(missing.status).toBe(404)
      const posted = await fetch(server.redirectUri, { method: 'POST' })
      expect(posted.status).toBe(405)
      setUiText({ ...EN, oauthCallbackDone: '<synthetic translated result>' }, 'en')
      const response = await fetch(callbackUrl(server.redirectUri))
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(await response.text()).toBe('<synthetic translated result>')
      await server.waitForCallback()
    } finally {
      server.close()
    }
  })

  it('starts its deadline at listen, even without a waiter, and releases the port', async () => {
    const server = await startChatGptCallback(STATE, 20)
    try {
      await pause(40)
      await expect(fetch(server.redirectUri)).rejects.toThrow()
      await expect(server.waitForCallback()).rejects.toThrow('chatgpt.invalid-callback')
    } finally {
      server.close()
    }
  })

  it('closes active incomplete HTTP connections at the deadline', async () => {
    const server = await startChatGptCallback(STATE, 40)
    const url = new URL(server.redirectUri)
    const socket = connect(Number(url.port), url.hostname)
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => {
        resolve()
      })
    })
    try {
      await new Promise<void>((resolve) => {
        socket.once('connect', () => {
          resolve()
        })
      })
      socket.write('GET /auth/callback HTTP/1.1\r\nHost: 127.0.0.1\r\n')
      await expect(server.waitForCallback()).rejects.toThrow('chatgpt.invalid-callback')
      const result = await Promise.race([closed, pause(100, 'timeout')])
      expect(result).toBeUndefined()
    } finally {
      socket.destroy()
      server.close()
    }
  })

  it('cancels a pending callback and closes idempotently', async () => {
    const server = await startChatGptCallback(STATE, 1000)
    server.close()
    server.close()
    await expect(server.waitForCallback()).rejects.toThrow('chatgpt.invalid-callback')
    await expect(fetch(server.redirectUri)).rejects.toThrow()
  })
})

describe('VS Code subscription ports', () => {
  it('opens the system browser and stores only the verified record in SecretStorage', async () => {
    const tester = await rig()
    const core = await createChatGptSignIn(tester.deps)
    expect(tester.fetcher).not.toHaveBeenCalled()
    await core.signIn()
    expect(tester.browser).toHaveBeenCalledOnce()
    const record = chatGptRecordSchema.parse(
      JSON.parse(tester.records.get('museSpark.provider.chatgpt')!),
    )
    expect(record).toMatchObject({ clientId: 'synthetic-issued-client', auth: 'subscription' })
    expect(await readdir(tester.directory)).toEqual(['chatgpt.host-id'])
    expect(await readFile(path.join(tester.directory, 'chatgpt.host-id'), 'utf8')).toBe(
      record.hostId,
    )
    expect(tester.secrets.store).toHaveBeenCalledOnce()
    await expect(fetch(tester.callback()!)).rejects.toThrow()
  })

  it('persists one opaque host id across simultaneous windows and serializes token rotation', async () => {
    const tester = await rig()
    const [first, second] = await Promise.all([
      createChatGptSignIn(tester.deps),
      createChatGptSignIn(tester.deps),
    ])
    await first.signIn()
    const key = 'museSpark.provider.chatgpt'
    const initial = chatGptRecordSchema.parse(JSON.parse(tester.records.get(key)!))
    tester.records.set(key, JSON.stringify({ ...initial, expiresAt: 1 }))
    tester.fetcher.mockClear()
    await expect(
      Promise.all([
        first.accessToken('https://api.openai.com/v1/models', 0),
        second.accessToken('https://api.openai.com/v1/models', 0),
      ]),
    ).resolves.toEqual(['synthetic-access', 'synthetic-access'])
    expect(
      tester.fetcher.mock.calls.filter(([url]) => url === DISCOVERY.token_endpoint),
    ).toHaveLength(1)
    await second.signIn()
    const next = chatGptRecordSchema.parse(JSON.parse(tester.records.get(key)!))
    expect(next.hostId).toBe(initial.hostId)
  })

  it('never steals an occupied lock and releases the lock after failure', async () => {
    const tester = await rig()
    await writeFile(path.join(tester.directory, 'chatgpt.refresh.lock'), '')
    await expect(createChatGptSignIn({ ...tester.deps, lockTimeoutMs: 20 })).rejects.toThrow(
      'chatgpt.request-failed',
    )
    expect(await readdir(tester.directory)).toEqual(['chatgpt.refresh.lock'])
    await rm(path.join(tester.directory, 'chatgpt.refresh.lock'))
    tester.browser.mockResolvedValueOnce(false)
    const core = await createChatGptSignIn(tester.deps)
    await expect(core.signIn()).rejects.toThrow('chatgpt.request-failed')
    expect(tester.records.size).toBe(0)
    expect(await readdir(tester.directory)).toEqual(['chatgpt.host-id'])
  })

  it('rejects a damaged non-opaque installation id before using it', async () => {
    const tester = await rig()
    await writeFile(
      path.join(tester.directory, 'chatgpt.host-id'),
      'synthetic account@example.test',
    )
    await expect(createChatGptSignIn(tester.deps)).rejects.toThrow('chatgpt.request-failed')
    expect(tester.browser).not.toHaveBeenCalled()
    expect(tester.fetcher).not.toHaveBeenCalled()
    expect(await readdir(tester.directory)).toEqual(['chatgpt.host-id'])
  })

  it('revokes on remove and deletes the record even when revocation fails', async () => {
    const tester = await rig()
    const core = await createChatGptSignIn(tester.deps)
    await core.signIn()
    tester.fetcher.mockImplementationOnce(() => Promise.resolve(Response.json(DISCOVERY)))
    tester.fetcher.mockImplementationOnce(() =>
      Promise.resolve(new Response(null, { status: 400 })),
    )
    await expect(core.remove()).rejects.toThrow('chatgpt.sign-in-required')
    expect(tester.secrets.delete).toHaveBeenCalledWith('museSpark.provider.chatgpt')
    expect(tester.records.size).toBe(0)
  })

  it('refuses an uncaptured remote callback before opening the browser or saving tokens', async () => {
    const tester = await rig()
    const core = await createChatGptSignIn({ ...tester.deps, isRemote: true })
    await expect(core.signIn()).rejects.toThrow('chatgpt.invalid-callback')
    expect(tester.browser).not.toHaveBeenCalled()
    expect(tester.secrets.store).not.toHaveBeenCalled()
  })

  it.each([
    { stored: '{bad-json', code: 'request-failed' },
    { stored: JSON.stringify({ origin: 'https://attacker.test' }), code: 'invalid-token' },
  ])('rejects malformed SecretStorage records', async ({ stored, code }) => {
    const tester = await rig()
    tester.records.set('museSpark.provider.chatgpt', stored)
    const core = await createChatGptSignIn(tester.deps)
    await expect(core.accessToken('https://api.openai.com/v1/models', 0)).rejects.toThrow(
      `chatgpt.${code}`,
    )
    expect(tester.fetcher).not.toHaveBeenCalled()
  })

  it('has no dependency on other applications credential storage, children, logs or UI bridges', async () => {
    const source = await readFile(
      new URL('../../src/host/providers/chatgptSignIn.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(
      /auth\.json|\.codex|\.claude|\.gemini|backend-api|node:child_process|postMessage|console\./,
    )
  })
})
