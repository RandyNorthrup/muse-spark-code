import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { discoverMcpOAuth } from '../../../src/core/mcp/oauth/discovery'
import { mcpOAuthTransport } from '../../../src/core/mcp/oauth/transport'
import { UI_TEXT, MCP_OAUTH_LIMITS } from '../../../src/shared/constants'
import { isWiped, oauthFixture } from './mcpOAuthFixture'

describe('M109 O OAuth audience and PKCE', () => {
  it.each([
    'access',
    'control',
    'type',
    'expiryMissing',
    'expiryZero',
    'expiryHuge',
    'refreshEmpty',
    'invalidJson',
    'contentType',
  ])('rejects unvalidated token reply: %s', async (fault) => {
    const f = oauthFixture()
    f.tokenResponse(() => {
      const body: Record<string, unknown> = {
        access_token: f.access,
        refresh_token: f.refresh,
        token_type: 'Bearer',
        expires_in: 3600,
      }
      switch (fault) {
        case 'access': {
          body['access_token'] = ''
          break
        }
        case 'control': {
          body['access_token'] = `${f.access}\n`
          break
        }
        case 'type': {
          body['token_type'] = 'Basic'
          break
        }
        case 'expiryMissing': {
          delete body['expires_in']
          break
        }
        case 'expiryZero': {
          body['expires_in'] = 0
          break
        }
        case 'expiryHuge': {
          body['expires_in'] = MCP_OAUTH_LIMITS.maxExpiresSeconds + 1
          break
        }
        case 'refreshEmpty': {
          body['refresh_token'] = ''
          break
        }
        case 'invalidJson': {
          return new Response('{', { headers: { 'content-type': 'application/json' } })
        }
        case 'contentType': {
          return Response.json(body, { headers: { 'content-type': 'text/plain' } })
        }
        // No default
      }
      return Response.json(body)
    })
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.create).not.toHaveBeenCalled()
  })

  it('requires response issuer when discovery advertises RFC 9207', async () => {
    const f = oauthFixture()
    const original = f.dispatch.getMockImplementation()!
    f.dispatch.mockImplementation((url, init) => {
      const response = original(url, init)
      return url.includes('/.well-known/oauth-authorization-server')
        ? Response.json({ ...f.metadata, authorization_response_iss_parameter_supported: true })
        : response
    })
    f.receive.mockImplementationOnce(() => {
      const url = new URL('http://127.0.0.1:32145/oauth/callback')
      url.searchParams.set('state', f.browser().searchParams.get('state')!)
      url.searchParams.set('code', 'generated-fixture-code')
      return Promise.resolve(url.href)
    })
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.create).not.toHaveBeenCalled()
  })

  it.each(['issuer', 'resource', 'handle', 'binding'])(
    'refuses stored %s mismatch before using access token',
    async (fault) => {
      const f = oauthFixture()
      await f.client.signIn(f.binding, f.signal)
      const item = f.item()
      if (item.material.kind !== 'oauth') throw new Error('expected OAuth fixture')
      switch (fault) {
        case 'issuer': {
          item.material.issuer = 'https://other.test/tenant/'
          break
        }
        case 'resource': {
          item.material.resource = `${f.binding.resource}/other`
          break
        }
        case 'handle': {
          item.metadata.name = 'other'
          item.metadata.handle = 'secret://other'

          break
        }
        case 'binding': {
          {
            item.metadata.bindings = []
            // No default
          }
          break
        }
      }
      await expect(f.client.fetch(f.binding, f.binding.resource, f.init)).rejects.toThrow(
        UI_TEXT.vault.noAccess,
      )
      expect(f.fetcher.mock.calls.filter(([url]) => url === f.binding.resource)).toHaveLength(0)
      expect(f.borrowed.every(isWiped)).toBe(true)
    },
  )

  it('binds pool OAuth by registry name and resource without accepting caller credentials', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    const choose = mcpOAuthTransport(f.client, (server) =>
      server === 'one' ? f.binding : undefined,
    )
    expect(choose('other', f.binding.resource)).toBeUndefined()
    expect(() => choose('one', 'https://other.test/mcp')).toThrow(UI_TEXT.vault.noAccess)
    const transport = choose('one', f.binding.resource)!
    await expect(transport(new Request(f.binding.resource), f.init)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    await expect(
      transport(f.binding.resource, { ...f.init, headers: { Authorization: f.access } }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    const response = await transport(f.binding.resource, f.init)
    expect(await response.text()).not.toContain(f.access)
  })

  it('tries root protected-resource metadata only after missing path metadata', async () => {
    const f = oauthFixture()
    f.dispatch.mockImplementationOnce(() => new Response(null, { status: 404 }))
    await f.client.signIn(f.binding, f.signal)
    expect(f.fetcher.mock.calls[1]?.[0]).toBe(
      'https://mcp.example.test/.well-known/oauth-protected-resource',
    )
  })

  it('discovers path-aware metadata, binds S256 and resource in both requests, stores only vault tokens', async () => {
    const f = oauthFixture()
    await expect(f.client.signIn(f.binding, f.signal)).resolves.toBeUndefined()
    expect(f.fetcher.mock.calls[0]?.[0]).toBe(
      'https://mcp.example.test/.well-known/oauth-protected-resource/mcp',
    )
    expect(f.fetcher.mock.calls[1]?.[0]).toBe(
      'https://login.example.test/.well-known/oauth-authorization-server/tenant/',
    )
    const browser = f.browser()
    const exchange = new URLSearchParams(
      typeof f.fetcher.mock.calls[2]?.[1]?.body === 'string' ? f.fetcher.mock.calls[2][1].body : '',
    )
    expect(browser.searchParams.get('resource')).toBe(f.binding.resource)
    expect(browser.searchParams.get('code_challenge_method')).toBe('S256')
    expect(browser.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url'),
    )
    expect(exchange.get('resource')).toBe(f.binding.resource)
    expect(exchange.get('redirect_uri')).toBe(browser.searchParams.get('redirect_uri'))
    expect(f.item().material.kind).toBe('oauth')
    expect(f.saved.every(isWiped)).toBe(true)
    expect(f.close).toHaveBeenCalledOnce()
    expect(browser.href).not.toContain(f.access)
    const response = await f.client.fetch(f.binding, f.binding.resource, f.init)
    expect(await response.text()).not.toContain(f.access)
    expect(f.borrowed.every(isWiped)).toBe(true)
    expect(f.authorize).toHaveBeenCalledWith(
      f.binding.handle,
      expect.objectContaining({ kind: 'oauth', resource: f.binding.resource }),
      expect.any(AbortSignal),
      'use',
    )
  })

  it.each(['resource', 'issuer', 'S256', 'endpoint', 'authMethod', 'responseType', 'grantType'])(
    'refuses discovery mismatch: %s',
    async (fault) => {
      const f = oauthFixture()
      switch (fault) {
        case 'resource': {
          f.dispatch.mockImplementationOnce(() =>
            Response.json({
              resource: 'https://other.test/mcp',
              authorization_servers: [f.binding.issuer],
            }),
          )
          break
        }
        case 'issuer': {
          f.metadata.issuer = `${f.binding.issuer}other`
          break
        }
        case 'S256': {
          f.metadata.code_challenge_methods_supported = ['plain']
          break
        }
        case 'responseType': {
          f.metadata.response_types_supported = ['token']
          break
        }
        case 'grantType': {
          f.metadata.grant_types_supported = ['password']
          break
        }
        case 'endpoint': {
          f.metadata.token_endpoint = f.metadata.token_endpoint.replace('https:', 'http:')
          break
        }
        case 'authMethod': {
          {
            f.metadata.token_endpoint_auth_methods_supported = ['client_secret_basic']
            // No default
          }
          break
        }
      }
      await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
      expect(f.vault.create).not.toHaveBeenCalled()
      expect(f.loopback.openBrowser).not.toHaveBeenCalled()
    },
  )

  it('preserves exact tenant issuer identity, refusing normalized aliases and unadvertised authorities', async () => {
    const f = oauthFixture()
    await expect(
      f.client.signIn({ ...f.binding, issuer: f.binding.issuer.slice(0, -1) }, f.signal),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    await expect(
      f.client.signIn({ ...f.binding, issuer: 'https://other.test/tenant/' }, f.signal),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.create).not.toHaveBeenCalled()
  })

  it('uses OIDC discovery only after missing RFC metadata, retaining exact issuer', async () => {
    const f = oauthFixture()
    f.dispatch
      .mockImplementationOnce(() =>
        Response.json({ resource: f.binding.resource, authorization_servers: [f.binding.issuer] }),
      )
      .mockImplementationOnce(() => new Response(null, { status: 404 }))
    await discoverMcpOAuth(
      { fetch: f.fetcher, allowEndpoint: f.allowEndpoint },
      f.binding.resource,
      f.binding.issuer,
      f.signal,
    )
    expect(f.fetcher.mock.calls[2]?.[0]).toBe(
      'https://login.example.test/tenant/.well-known/openid-configuration',
    )
  })

  it.each([
    'state',
    'duplicateState',
    'code',
    'duplicateCode',
    'issuer',
    'duplicateIssuer',
    'path',
    'origin',
    'error',
  ])('refuses callback %s before exchange', async (fault) => {
    const f = oauthFixture()
    f.receive.mockImplementation(() => {
      const callback = new URL('http://127.0.0.1:32145/oauth/callback')
      callback.searchParams.set('state', f.browser().searchParams.get('state')!)
      callback.searchParams.set('code', 'generated-fixture-code')
      switch (fault) {
        case 'state': {
          callback.searchParams.set('state', 'wrong')
          break
        }
        case 'duplicateState': {
          callback.searchParams.append('state', 'wrong')
          break
        }
        case 'code': {
          callback.searchParams.delete('code')
          break
        }
        case 'duplicateCode': {
          callback.searchParams.append('code', 'another-code')
          break
        }
        case 'duplicateIssuer': {
          callback.searchParams.append('iss', f.binding.issuer)
          callback.searchParams.append('iss', f.binding.issuer)
          break
        }
        case 'issuer': {
          callback.searchParams.set('iss', 'https://other.test/')
          break
        }
        case 'path': {
          callback.pathname = '/other'
          break
        }
        case 'origin': {
          callback.port = '32146'
          break
        }
        case 'error': {
          {
            callback.searchParams.set('error', 'access_denied')
            // No default
          }
          break
        }
      }
      return Promise.resolve(callback.href)
    })
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.create).not.toHaveBeenCalled()
    expect(f.fetcher.mock.calls).toHaveLength(2)
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('refuses non-loopback callbacks and private endpoint admission', async () => {
    const f = oauthFixture()
    f.allowEndpoint.mockResolvedValue(false)
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.fetcher).not.toHaveBeenCalled()
    f.allowEndpoint.mockResolvedValue(true)
    vi.mocked(f.loopback.open).mockResolvedValue({
      redirectUri: 'http://localhost:32145/oauth/callback',
      receive: f.receive,
      close: f.close,
    })
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.loopback.openBrowser).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalledOnce()
  })

  it.each(['body', 'type', 'oversize', 'redirect', 'exception'])(
    'never exposes token response %s to callers',
    async (fault) => {
      const f = oauthFixture()
      f.tokenResponse(() => {
        switch (fault) {
          case 'body': {
            return new Response(f.access, { status: 400 })
          }
          case 'type': {
            return Response.json({ access_token: f.access, token_type: 'Basic', expires_in: 10 })
          }
          case 'oversize': {
            return Response.json({
              access_token: 'x'.repeat(MCP_OAUTH_LIMITS.responseBytes + 1),
              refresh_token: f.refresh,
              token_type: 'Bearer',
              expires_in: 3600,
            })
          }
          case 'redirect': {
            const response = Response.json({
              access_token: f.access,
              refresh_token: f.refresh,
              token_type: 'Bearer',
              expires_in: 3600,
            })
            Object.defineProperty(response, 'redirected', { value: true })
            return response
          }
          // No default
        }
        throw new Error(f.access)
      })
      await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
      expect(f.vault.create).not.toHaveBeenCalled()
      expect(f.close).toHaveBeenCalledOnce()
    },
  )

  it('refuses passthrough, same-origin resource changes and another server before reading tokens', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    for (const url of ['https://other.test/mcp', `${f.binding.resource}/other`])
      await expect(f.client.fetch(f.binding, url, f.init)).rejects.toThrow(UI_TEXT.vault.noAccess)
    for (const headers of [
      { Authorization: f.access },
      { 'Proxy-Authorization': f.access },
      { Host: 'other.test' },
    ]) {
      await expect(
        f.client.fetch(f.binding, f.binding.resource, { ...f.init, headers }),
      ).rejects.toThrow(UI_TEXT.vault.noAccess)
    }
    await expect(
      f.client.fetch(f.binding, f.binding.resource, { ...f.init, redirect: 'follow' }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.read).not.toHaveBeenCalled()
    await expect(
      f.client.fetch(
        { ...f.binding, resource: 'https://other.test/mcp' },
        'https://other.test/mcp',
        f.init,
      ),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.borrowed.every(isWiped)).toBe(true)
  })
})
