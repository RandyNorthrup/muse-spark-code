import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { ChatGptSignIn, type ChatGptRecord } from '../../src/core/providers/subscriptions/chatgpt'
import { createRuntimeChatGptHost } from '../../src/runtime/chatGptHost'
import {
  runChatGptProviderCommand,
  parseChatGptProviderAction,
  type ChatGptCommandText,
} from '../../src/runtime/chatGptProviderCommands'
import { keyringSecretStore, StoreUnavailableError } from '../../src/runtime/keyStore'

const ACCOUNT = 'museSpark.provider.chatgpt'
const HOST_ACCOUNT = `${ACCOUNT}.host-id`
const ISSUER = 'https://auth.openai.com'
const API = 'https://api.openai.com/v1/responses'
const SCOPE = 'openid chatgpt.tokens.use.direct'
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = keyPair.publicKey.export({ format: 'jwk' })
const TEXT: ChatGptCommandText = {
  beforeSignIn: () => 'Synthetic Plus/Pro plan notice with credit caveat.',
  alreadyAdded: () => 'Synthetic: remove before replacing.',
  status: (state) => `Synthetic ${state}`,
  failure: (code) => `Synthetic failure ${code}`,
}

const fail = () => Promise.reject(new Error('synthetic-private-detail'))

function record(): ChatGptRecord {
  return {
    v: 1,
    auth: 'subscription',
    origin: 'https://api.openai.com',
    issuer: ISSUER,
    clientId: 'oaiapp_synthetic',
    hostId: 'synthetic_host_123456789',
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    expiresAt: Date.now() + 3_600_000,
    scope: SCOPE,
    nonce: 'synthetic_nonce_123456789',
  }
}

function rig(initial?: ChatGptRecord) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(ACCOUNT, JSON.stringify(initial))
  const accounts: string[] = []
  const secrets = keyringSecretStore((service, account) => {
    accounts.push(`${service}/${account}`)
    return {
      getPassword: () => Promise.resolve(values.get(account) ?? null),
      setPassword: (value) => {
        values.set(account, value)
        return Promise.resolve()
      },
      deletePassword: () => Promise.resolve(values.delete(account)),
    }
  })
  const requests: { url: string; init: RequestInit | undefined }[] = []
  let nonce = ''
  let callbackUrl = ''
  let status = 200
  const fetcher: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push({ url, init })
    if (url.endsWith('/.well-known/openid-configuration'))
      return Promise.resolve(
        Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/api/accounts/authorize`,
          token_endpoint: `${ISSUER}/api/accounts/oauth/token`,
          revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
          jwks_uri: `${ISSUER}/jwks`,
        }),
      )
    if (url.endsWith('/jwks'))
      return Promise.resolve(
        Response.json({ keys: [{ ...jwk, kid: 'synthetic', alg: 'RS256', use: 'sig' }] }),
      )
    if (url.endsWith('/token')) {
      const unsigned = [
        { alg: 'RS256', kid: 'synthetic' },
        { iss: ISSUER, aud: 'oaiapp_synthetic', exp: Date.now() / 1000 + 3600, nonce },
      ]
        .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
        .join('.')
      return Promise.resolve(
        Response.json(
          {
            access_token: 'synthetic-rotated-access',
            refresh_token: 'synthetic-rotated-refresh',
            token_type: 'Bearer',
            expires_in: 3600,
            ...(nonce !== '' && {
              id_token: `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), keyPair.privateKey).toString('base64url')}`,
            }),
            scope: SCOPE,
          },
          { status },
        ),
      )
    }
    return Promise.resolve(new Response('', { status }))
  }
  const printed: string[] = []
  const errors: string[] = []
  const controller = new AbortController()
  const createHost = () =>
    createRuntimeChatGptHost({
      secrets,
      fetch: fetcher,
      signal: controller.signal,
      callbackText: () => 'Synthetic callback done.',
      openBrowser: async (url) => {
        printed.push(url)
        const params = new URL(url).searchParams
        nonce = params.get('nonce') ?? ''
        callbackUrl = params.get('redirect_uri') ?? ''
        await fetch(
          `${callbackUrl}?${new URLSearchParams({ code: 'synthetic-code', state: params.get('state') ?? '', client_id: 'oaiapp_synthetic', scope: SCOPE }).toString()}`,
        )
      },
    })
  const deps = {
    createHost,
    providers: {
      add: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    },
    text: TEXT,
    print: (line: string) => {
      printed.push(line)
    },
    printError: (line: string) => {
      errors.push(line)
    },
  }
  return {
    values,
    secrets,
    accounts,
    requests,
    printed,
    errors,
    controller,
    deps,
    createHost,
    callback: () => callbackUrl,
    setStatus: (value: number) => {
      status = value
    },
  }
}

describe('ACP ChatGPT OS-store adapter and commands', () => {
  it.each([
    'Windows ERROR_NO_SUCH_LOGON_SESSION synthetic-private-detail',
    'macOS errSecInteractionNotAllowed synthetic-private-detail',
    'macOS errSecAuthFailed synthetic-private-detail',
    'Linux org.freedesktop.DBus.Error.ServiceUnknown synthetic-private-detail',
  ])(
    'classifies native store unavailability through factory and grant lock: %s',
    async (message) => {
      const run = rig(record())
      const unavailable = keyringSecretStore(() => {
        throw new Error(message)
      })
      for (const operation of [
        () => unavailable.get(HOST_ACCOUNT),
        () => unavailable.store(ACCOUNT, 'synthetic'),
        () => unavailable.delete(ACCOUNT),
      ]) {
        await expect(operation()).rejects.toThrow(StoreUnavailableError)
        await expect(operation()).rejects.toThrow(/^store-unavailable$/u)
      }
      const createHost = () =>
        createRuntimeChatGptHost({
          secrets: unavailable,
          fetch,
          openBrowser: () => Promise.resolve(),
          callbackText: () => '',
        })
      await expect(createHost()).rejects.toThrow(/^chatgpt.store-unavailable$/u)
      expect(await runChatGptProviderCommand('status', { ...run.deps, createHost })).toBe(1)
      expect(run.errors).toEqual(['Synthetic failure store-unavailable'])
      const host = await run.createHost()
      await expect(
        host.withRefreshLock(async () => await unavailable.get(ACCOUNT)),
      ).rejects.toThrow(/^chatgpt.store-unavailable$/u)
      expect(run.requests).toEqual([])
    },
  )

  it('classifies asynchronous native read, write and delete failures without retaining their text', async () => {
    const unavailable = keyringSecretStore(() => ({
      getPassword: fail,
      setPassword: fail,
      deletePassword: fail,
    }))
    for (const operation of [
      () => unavailable.get(ACCOUNT),
      () => unavailable.store(ACCOUNT, 'synthetic'),
      () => unavailable.delete(ACCOUNT),
    ])
      await expect(operation()).rejects.toThrow(/^store-unavailable$/u)
  })

  it('accepts only the three exact ChatGPT provider commands', () => {
    for (const action of ['add', 'remove', 'status']) {
      expect(parseChatGptProviderAction(['providers', action, 'chatgpt'])).toBe(action)
    }
    for (const args of [
      [],
      ['providers', 'add'],
      ['providers', 'add', 'copilot'],
      ['providers', 'other', 'chatgpt'],
      ['auth', 'add', 'chatgpt'],
      ['providers', 'add', 'chatgpt', 'synthetic-credential'],
      ['providers', 'add', 'chatgpt', '--key-stdin'],
    ]) {
      expect(parseChatGptProviderAction(args)).toBeUndefined()
    }
  })
  it('adds through the real callback, keeps only our origin-bound OS record, then reports and revokes it', async () => {
    const run = rig()
    expect(await runChatGptProviderCommand('add', run.deps)).toBe(0)
    expect(run.deps.providers.add).toHaveBeenCalledOnce()
    expect(run.printed[0]).toContain('Plus/Pro')
    expect(run.printed[1]).toMatch(/^https:\/\/auth\.openai\.com\/api\/accounts\/authorize/u)
    const host = await run.createHost()
    const stored = await host.readRecord()
    expect(stored).toMatchObject({
      auth: 'subscription',
      origin: 'https://api.openai.com',
      issuer: ISSUER,
      clientId: 'oaiapp_synthetic',
      hostId: host.hostId,
    })
    expect(new Set(run.accounts)).toEqual(
      new Set([
        `Muse Spark Code (Unofficial)/${ACCOUNT}`,
        `Muse Spark Code (Unofficial)/${HOST_ACCOUNT}`,
      ]),
    )
    await expect(fetch(run.callback())).rejects.toThrow()
    const count = run.requests.length
    expect(await runChatGptProviderCommand('status', run.deps)).toBe(0)
    expect(run.requests).toHaveLength(count)
    expect(await runChatGptProviderCommand('remove', run.deps)).toBe(0)
    expect(run.deps.providers.remove).toHaveBeenCalledOnce()
    expect(run.values.has(ACCOUNT)).toBe(false)
    expect(run.values.has(HOST_ACCOUNT)).toBe(true)
    expect(run.requests.at(-1)?.url).toBe(`${ISSUER}/api/accounts/oauth/revoke`)
    const revokeBody = run.requests.at(-1)?.init?.body
    expect(revokeBody instanceof URLSearchParams ? revokeBody.get('token') : undefined).toBe(
      'synthetic-rotated-refresh',
    )
    expect(run.requests.every((request) => request.init?.redirect === 'error')).toBe(true)
    expect([...run.printed, ...run.errors].join('\n')).not.toMatch(
      /synthetic-(?:access|refresh|rotated|code)|oaiapp_synthetic/u,
    )
  })

  it('initializes one opaque installation id under the process lock', async () => {
    const run = rig()
    const [one, two] = await Promise.all([run.createHost(), run.createHost()])
    expect(one.hostId).toBe(two.hostId)
    expect(one.hostId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(run.values.size).toBe(1)
  })

  it('refuses an invalid record at the write boundary before touching the OS store', async () => {
    const run = rig()
    const host = await run.createHost()
    const candidate = record()
    Object.defineProperty(candidate, 'origin', { value: 'https://evil.example' })
    await expect(host.writeRecord(candidate)).rejects.toThrow('invalid-token')
    expect(run.values.has(ACCOUNT)).toBe(false)
  })

  it('rotates once across two runtime hosts and rereads the OS record inside the lock', async () => {
    const run = rig({ ...record(), expiresAt: Date.now() - 1 })
    const [one, two] = await Promise.all([run.createHost(), run.createHost()])
    const tokens = await Promise.all([
      new ChatGptSignIn(one).accessToken(API, 1000),
      new ChatGptSignIn(two).accessToken(API, 1000),
    ])
    expect(tokens).toEqual(['synthetic-rotated-access', 'synthetic-rotated-access'])
    expect(run.requests.filter((request) => request.url.endsWith('/token'))).toHaveLength(1)
    expect(await two.readRecord()).toMatchObject({ refreshToken: 'synthetic-rotated-refresh' })
  })

  it('reports missing and expired grants without a network call or credential detail', async () => {
    const empty = rig()
    expect(await runChatGptProviderCommand('status', empty.deps)).toBe(1)
    expect(empty.printed).toEqual(['Synthetic signed-out'])
    const expired = rig({ ...record(), expiresAt: Date.now() - 1 })
    expect(await runChatGptProviderCommand('status', expired.deps)).toBe(0)
    expect(expired.printed).toEqual(['Synthetic expired'])
    expect([...empty.requests, ...expired.requests]).toEqual([])
  })

  it('refuses to overwrite a grant, including two concurrent add commands', async () => {
    const run = rig()
    const results = await Promise.all([
      runChatGptProviderCommand('add', run.deps),
      runChatGptProviderCommand('add', run.deps),
    ])
    expect(results.toSorted((a, b) => a - b)).toEqual([0, 1])
    expect(run.requests.filter((request) => request.url.endsWith('/token'))).toHaveLength(1)
    expect(run.errors).toEqual(['Synthetic: remove before replacing.'])
    const expired = rig({ ...record(), expiresAt: Date.now() - 1 })
    expect(await runChatGptProviderCommand('add', expired.deps)).toBe(1)
    expect(expired.requests).toEqual([])
  })

  it('deletes locally and reports a revocation refusal without its body', async () => {
    const run = rig(record())
    run.setStatus(403)
    expect(await runChatGptProviderCommand('remove', run.deps)).toBe(1)
    expect(run.values.has(ACCOUNT)).toBe(false)
    expect(run.deps.providers.remove).toHaveBeenCalledOnce()
    expect(run.errors).toEqual(['Synthetic failure sign-in-required'])
  })

  it('revokes and rolls back the grant if provider configuration cannot be saved', async () => {
    const run = rig()
    run.deps.providers.add.mockImplementation(fail)
    expect(await runChatGptProviderCommand('add', run.deps)).toBe(1)
    expect(run.values.has(ACCOUNT)).toBe(false)
    expect(run.requests.at(-1)?.url).toBe(`${ISSUER}/api/accounts/oauth/revoke`)
    expect(run.errors).toEqual(['Synthetic failure request-failed'])
    expect(run.printed).not.toContain('Added provider chatgpt.')
  })

  it('holds the grant lock until provider configuration finishes before removing', async () => {
    const run = rig()
    const host = await run.createHost()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    run.deps.providers.add.mockImplementation(async () => {
      entered.resolve(undefined)
      await release.promise
    })
    const deps = { ...run.deps, createHost: () => Promise.resolve(host) }
    const adding = runChatGptProviderCommand('add', deps)
    const finishedEarly = async () => {
      await adding
      throw new Error('add finished before provider configuration was entered')
    }
    await Promise.race([entered.promise, finishedEarly()])
    const removing = runChatGptProviderCommand('remove', deps)
    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(run.deps.providers.remove).not.toHaveBeenCalled()
      release.resolve(undefined)
      await expect(adding).resolves.toBe(0)
      await expect(removing).resolves.toBe(0)
      expect(run.values.has(ACCOUNT)).toBe(false)
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([adding, removing])
    }
  })

  it('closes the real callback after a browser handoff failure and withholds its detail', async () => {
    const run = rig()
    const host = await run.createHost()
    let redirect = ''
    const signIn = new ChatGptSignIn({
      ...host,
      openBrowser: (url) => {
        redirect = new URL(url).searchParams.get('redirect_uri') ?? ''
        return fail()
      },
    })
    await expect(signIn.signIn()).rejects.toThrow('chatgpt.request-failed')
    await expect(fetch(redirect)).rejects.toThrow()
    expect(run.values.has(ACCOUNT)).toBe(false)
  })

  it.each([
    'not-json',
    JSON.stringify({ ...record(), origin: 'https://evil.example' }),
    JSON.stringify({ ...record(), issuer: 'https://evil.example' }),
  ])('refuses a malformed stored record before a request', async (value) => {
    const run = rig()
    run.values.set(ACCOUNT, value)
    const host = await run.createHost()
    await expect(host.readRecord()).rejects.toThrow('invalid-token')
    expect(await runChatGptProviderCommand('status', run.deps)).toBe(1)
    expect(run.errors).toEqual(['Synthetic failure invalid-token'])
    expect(run.requests).toEqual([])
    expect(await runChatGptProviderCommand('remove', run.deps)).toBe(1)
    expect(run.values.has(ACCOUNT)).toBe(false)
  })

  it('refuses a nonopaque host id and sanitizes secret-store failures', async () => {
    const run = rig()
    run.values.set(HOST_ACCOUNT, 'synthetic@example.test')
    expect(await runChatGptProviderCommand('status', run.deps)).toBe(1)
    expect(run.errors).toEqual(['Synthetic failure request-failed'])
    await expect(
      createRuntimeChatGptHost({
        secrets: { get: fail, store: fail, delete: fail },
        fetch: fetch,
        openBrowser: () => Promise.resolve(),
        callbackText: () => '',
      }),
    ).rejects.toThrow('chatgpt.request-failed')
  })

  it('sanitizes a secret-bearing command dependency failure', async () => {
    const run = rig()
    expect(await runChatGptProviderCommand('status', { ...run.deps, createHost: fail })).toBe(1)
    expect(run.errors).toEqual(['Synthetic failure request-failed'])
  })

  it('validates status records from the injected host port', async () => {
    const run = rig()
    const host = await run.createHost()
    expect(
      await runChatGptProviderCommand('status', {
        ...run.deps,
        createHost: () =>
          Promise.resolve({
            ...host,
            readRecord: () => Promise.resolve({ ...record(), origin: 'https://evil.example' }),
          }),
      }),
    ).toBe(1)
    expect(run.errors).toEqual(['Synthetic failure invalid-token'])
  })

  it('propagates cancellation to HTTP requests without sending any credential to a child', async () => {
    const run = rig()
    const host = await run.createHost()
    const observed = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})))
    const cancelHost = await createRuntimeChatGptHost({
      secrets: run.secrets,
      fetch: observed,
      openBrowser: () => Promise.resolve(),
      callbackText: () => '',
      signal: run.controller.signal,
    })
    const other = new AbortController()
    await cancelHost.fetch(`${ISSUER}/jwks`, { signal: other.signal })
    const merged = observed.mock.calls[0]?.[1]?.signal
    await cancelHost.fetch(`${ISSUER}/jwks`)
    expect(observed.mock.calls[1]?.[1]?.signal).toBe(run.controller.signal)
    await host.writeRecord(record())
    run.controller.abort()
    expect(merged?.aborted).toBe(true)
    expect(other.signal.aborted).toBe(false)
    await expect(new ChatGptSignIn(host).accessToken(API, 0)).rejects.toThrow('request-failed')
    expect(run.requests).toEqual([])
  })

  it('has no dependency on another application credential path or a child launcher', async () => {
    for (const name of [
      'chatGptHost',
      'chatGptCallback',
      'chatGptRefreshLock',
      'chatGptProviderCommands',
    ]) {
      const source = await readFile(
        new URL(`../../src/runtime/${name}.ts`, import.meta.url),
        'utf8',
      )
      expect(source).not.toMatch(/auth\.json|\.codex|\.claude|\.gemini|backend-api|child_process/u)
    }
  })
})
