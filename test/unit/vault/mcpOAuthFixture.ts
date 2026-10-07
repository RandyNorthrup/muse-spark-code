import { randomBytes } from 'node:crypto'
import { vi } from 'vitest'
import {
  McpOAuthClient,
  type McpOAuthBinding,
  type McpOAuthVaultPort,
  type McpOAuthLoopbackPort,
} from '../../../src/core/mcp/oauth/client'
import type { VaultItem } from '../../../src/shared/vault'

export function oauthFixture() {
  const binding: McpOAuthBinding = {
    handle: 'secret://mcp-one',
    resource: 'https://mcp.example.test/mcp',
    issuer: 'https://login.example.test/tenant/',
    clientId: 'public-client',
    label: 'MCP one',
    scopes: ['tools:read'],
  }
  const access = randomBytes(32).toString('base64url')
  const refresh = randomBytes(32).toString('base64url')
  const nextAccess = randomBytes(32).toString('base64url')
  const nextRefresh = randomBytes(32).toString('base64url')
  let now = 100_000
  let persisted: VaultItem | undefined
  const borrowed: VaultItem[] = []
  const saved: VaultItem[] = []
  const vault: McpOAuthVaultPort = {
    read: vi.fn<McpOAuthVaultPort['read']>(() => {
      if (persisted === undefined) return Promise.reject(new Error('fixture item missing'))
      const item = structuredClone(persisted)
      borrowed.push(item)
      return Promise.resolve(item)
    }),
    create: vi.fn<McpOAuthVaultPort['create']>((item, authorize) => {
      authorize()
      if (persisted !== undefined) return Promise.reject(new Error('fixture duplicate name'))
      persisted = structuredClone(item)
      saved.push(item)
      return Promise.resolve()
    }),
    save: vi.fn<McpOAuthVaultPort['save']>((item, authorize) => {
      authorize()
      persisted = structuredClone(item)
      saved.push(item)
      return Promise.resolve()
    }),
    invalidate: vi.fn(() => {
      persisted = undefined
      return Promise.resolve()
    }),
  }
  let browser = new URL('https://login.example.test/authorize')
  const redirectUri = 'http://127.0.0.1:32145/oauth/callback'
  const receive = vi.fn(() => {
    const callback = new URL(redirectUri)
    callback.searchParams.set('state', browser.searchParams.get('state') ?? '')
    callback.searchParams.set('code', randomBytes(32).toString('base64url'))
    callback.searchParams.set('iss', binding.issuer)
    return Promise.resolve(callback.href)
  })
  const close = vi.fn()
  const loopback: McpOAuthLoopbackPort = {
    open: vi.fn(() => Promise.resolve({ redirectUri, receive, close })),
    openBrowser: vi.fn<McpOAuthLoopbackPort['openBrowser']>((url) => {
      browser = new URL(url)
      return Promise.resolve()
    }),
  }
  const metadata = {
    issuer: binding.issuer,
    authorization_endpoint: 'https://login.example.test/authorize',
    token_endpoint: 'https://login.example.test/token',
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
  }
  const dispatch = vi.fn((url: string, init: RequestInit | undefined): Response => {
    if (url.includes('/.well-known/oauth-protected-resource'))
      return Response.json({ resource: binding.resource, authorization_servers: [binding.issuer] })
    if (url.includes('/.well-known/')) return Response.json(metadata)
    if (url === metadata.token_endpoint) {
      const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
      return Response.json({
        access_token: body.get('grant_type') === 'refresh_token' ? nextAccess : access,
        refresh_token: body.get('grant_type') === 'refresh_token' ? nextRefresh : refresh,
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (url === binding.resource)
      return Response.json({ result: new Headers(init?.headers).get('authorization') })
    throw new Error('fixture unexpected destination')
  })
  const fetcher = vi.fn<typeof fetch>((target, init) => {
    if (typeof target !== 'string') throw new Error('fixture expects string URL')
    return Promise.resolve(dispatch(target, init))
  })
  const tokenResponse = (reply: () => Response) => {
    const original = dispatch.getMockImplementation()
    if (original === undefined) throw new Error('fixture dispatcher missing')
    dispatch.mockImplementation((url, init) =>
      url === metadata.token_endpoint ? reply() : original(url, init),
    )
  }
  const allowEndpoint = vi.fn(() => Promise.resolve(true))
  const finish = vi.fn(() => Promise.resolve())
  const authorize = vi.fn<ConstructorParameters<typeof McpOAuthClient>[0]['authorize']>(() =>
    Promise.resolve({ assertCurrent: () => undefined, finish }),
  )
  const scrub = vi.fn(async (response: Response) => {
    let body = await response.text()
    for (const secret of [access, refresh, nextAccess, nextRefresh])
      body = body.replaceAll(secret, '[redacted]')
    return new Response(body, { status: response.status, headers: response.headers })
  })
  const client = new McpOAuthClient({
    network: { fetch: fetcher, allowEndpoint },
    vault,
    loopback,
    now: () => now,
    authorize,
    scrub,
  })
  return {
    client,
    binding,
    access,
    refresh,
    nextAccess,
    nextRefresh,
    vault,
    borrowed,
    saved,
    receive,
    close,
    loopback,
    dispatch,
    tokenResponse,
    fetcher,
    allowEndpoint,
    authorize,
    finish,
    scrub,
    metadata,
    browser: () => browser,
    item: () => persisted!,
    advance: () => {
      now += 3_600_000
    },
    signal: new AbortController().signal,
    init: { method: 'POST', redirect: 'error' } satisfies RequestInit,
  }
}

export function isWiped(item: VaultItem): boolean {
  return Object.values(item.material).every(
    (field) => !(field instanceof Uint8Array) || field.every((byte) => byte === 0),
  )
}
