// M124 remote (D217): the connector served over HTTPS by the person's own PC,
// with the MCP authorization profile, against the official MCP SDK client.
// Everything is real: the runtime's own `serve-http` command, a real
// certificate (test/fixtures/connector-remote), a real data folder, real
// loopback sockets, and the owner code read from the connector's terminal
// output, as a person reads it.
import { readFile, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { refreshAuthorization } from '@modelcontextprotocol/sdk/client/auth.js'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CONNECTOR_FOLDER } from '../../src/shared/constants'
import {
  TLS_ARGUMENTS,
  dataFolder,
  freePort,
  grantUserLibrary,
  lanAddress,
  ownerCommand,
  registerClient,
  remoteCommand,
  startRemote,
  trustFixtureCertificate,
  type RunningRemote,
} from './helpers/connectorRemote'
import { SdkSession, isConnected, signIn, tryConnect } from './helpers/connectorSdkClient'

const folders: string[] = []
const running: RunningRemote[] = []

beforeAll(() => {
  trustFixtureCertificate()
})
afterEach(async () => {
  await Promise.all(running.splice(0).map(async (remote) => await remote.stop()))
})
afterAll(async () => {
  await Promise.all(
    folders.splice(0).map(async (folder) => {
      await rm(folder, { recursive: true, force: true })
    }),
  )
})

async function served(
  extra: readonly string[] = TLS_ARGUMENTS,
): Promise<{ remote: RunningRemote; data: string }> {
  const data = await dataFolder()
  folders.push(data)
  await grantUserLibrary(data, ['prompts:read', 'operations:read', 'control:stop'])
  const remote = await startRemote(data, extra)
  running.push(remote)
  return { remote, data }
}

async function signedInSession(
  remote: RunningRemote,
  data: string,
): Promise<{ session: SdkSession; clientId: string; page: string }> {
  const clientId = await registerClient(data)
  const session = new SdkSession({ client_id: clientId })
  const result = await signIn(remote, session)
  if (!isConnected(result)) throw new Error(`not signed in: ${result.rest}`)
  await result.client.close()
  return { session, clientId, page: result.page }
}

async function bearerPost(remote: RunningRemote, token: string): Promise<Response> {
  return await fetch(remote.mcpUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'raw' } },
    }),
  })
}

async function bearerStatus(remote: RunningRemote, token: string): Promise<number> {
  const response = await bearerPost(remote, token)
  return response.status
}

function accessTokenOf(session: SdkSession): string {
  const token = session.tokenSet?.access_token
  if (token === undefined) throw new Error('the client holds no access token')
  return token
}

async function refresh(
  remote: RunningRemote,
  clientId: string,
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string | undefined }> {
  return await refreshAuthorization(remote.origin, {
    clientInformation: { client_id: clientId },
    refreshToken,
    resource: new URL(remote.mcpUrl),
  })
}

describe('M124 remote: discovery and refusal', () => {
  it('refuses an unauthorized request and points the client to the authorization server', async () => {
    const { remote } = await served()
    const refused = await fetch(remote.mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      }),
    })
    expect(refused.status).toBe(401)
    const challenge = refused.headers.get('www-authenticate') ?? ''
    expect(challenge).toContain(
      `resource_metadata="${remote.origin}/.well-known/oauth-protected-resource/mcp"`,
    )
    expect(challenge).toContain('scope="')
    const resource = await fetch(`${remote.origin}/.well-known/oauth-protected-resource/mcp`)
    const resourceBody = (await resource.json()) as Record<string, unknown>
    expect(resourceBody['resource']).toBe(remote.mcpUrl)
    expect(resourceBody['authorization_servers']).toEqual([remote.origin])
    const metadata = await fetch(`${remote.origin}/.well-known/oauth-authorization-server`)
    const server = (await metadata.json()) as Record<string, unknown>
    expect(server['issuer']).toBe(remote.origin)
    expect(server['code_challenge_methods_supported']).toEqual(['S256'])
    expect(server['authorization_response_iss_parameter_supported']).toBe(true)
    expect(server['client_id_metadata_document_supported']).toBe(true)
    // Open registration is the person's to switch on.
    expect(server['registration_endpoint']).toBeUndefined()
    // A token in the query string is no token.
    const inQuery = await fetch(`${remote.mcpUrl}?access_token=anything`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(inQuery.status).toBe(401)
    expect(await bearerStatus(remote, 'not-a-token')).toBe(401)
  })

  it('refuses an unregistered client at the authorization endpoint', async () => {
    const { remote } = await served()
    const unknown = new URL(`${remote.origin}/authorize`)
    unknown.search = new URLSearchParams({
      response_type: 'code',
      client_id: 'nobody',
      redirect_uri: 'http://127.0.0.1:8765/callback',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      resource: remote.mcpUrl,
    }).toString()
    const response = await fetch(unknown, { redirect: 'manual' })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('invalid_client')
  })
})

describe('M124 remote: signing in with the official MCP SDK client', () => {
  it('signs in with a client the owner registered, calls a tool, and keeps no secret on disk', async () => {
    const { remote, data } = await served()
    const { session, page } = await signedInSession(remote, data)
    expect(page).toContain('SDK suite')
    expect(page).toContain('127.0.0.1:8765')
    for (const scope of ['operations:read', 'prompts:read', 'control:stop']) {
      expect(page).toContain(scope)
    }
    expect(session.tokenSet?.refresh_token).toBeDefined()
    const connected = await tryConnect(remote.mcpUrl, session)
    expect(connected).toBeDefined()
    const listed = await connected?.listTools()
    expect(listed?.tools.map((tool) => tool.name)).toContain('muse_prompt_list')
    const called = await connected?.callTool({
      name: 'muse_prompt_list',
      arguments: { scope: 'user' },
    })
    expect(called?.isError).not.toBe(true)
    await connected?.close()
    // The state file holds digests, never the tokens the client holds.
    const stored = await readFile(
      path.join(data, CONNECTOR_FOLDER, 'oauth', 'default.json'),
      'utf8',
    )
    expect(stored).not.toContain(accessTokenOf(session))
    expect(stored).not.toContain(session.tokenSet?.refresh_token ?? 'missing')
    expect(stored).toContain('"AccessToken"')
  })

  it('refuses a request the owner denied, and one with the wrong owner code', async () => {
    const { remote, data } = await served()
    const clientId = await registerClient(data)
    const denied = await signIn(remote, new SdkSession({ client_id: clientId }), {
      decision: 'deny',
    })
    expect(isConnected(denied)).toBe(false)
    if (isConnected(denied)) return
    expect(denied.landed.searchParams.get('error')).toBe('access_denied')
    expect(denied.landed.searchParams.get('code')).toBeNull()
    expect(denied.landed.searchParams.get('iss')).toBe(remote.origin)
    const wrong = await signIn(remote, new SdkSession({ client_id: clientId }), {
      decision: 'allow',
      code: 'AAAAAAAAAAAA',
    })
    expect(isConnected(wrong)).toBe(false)
    if (isConnected(wrong)) return
    expect(wrong.rest).toContain('That owner code is not right')
  })

  it('replaces the owner code after a run of wrong ones and after every approval', async () => {
    const { remote, data } = await served()
    const first = remote.ownerCode()
    const clientId = await registerClient(data)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(remote, new SdkSession({ client_id: clientId }), {
        decision: 'allow',
        code: 'AAAAAAAAAAAA',
      })
    }
    const second = remote.ownerCode()
    expect(second).not.toBe(first)
    const signedIn = await signIn(remote, new SdkSession({ client_id: clientId }))
    expect(isConnected(signedIn)).toBe(true)
    expect(remote.ownerCode()).not.toBe(second)
    if (isConnected(signedIn)) await signedIn.client.close()
  })

  it('rotates a refresh token, and ends the sign-in when a spent one comes back', async () => {
    const { remote, data } = await served()
    const { session, clientId } = await signedInSession(remote, data)
    const spent = session.tokenSet?.refresh_token ?? ''
    const rotated = await refresh(remote, clientId, spent)
    expect(rotated.refresh_token).toBeDefined()
    expect(rotated.refresh_token).not.toBe(spent)
    expect(rotated.access_token).not.toBe(accessTokenOf(session))
    expect(await bearerStatus(remote, rotated.access_token)).toBe(200)
    // The spent token is presented again: refused, and the whole sign-in goes with it.
    await expect(refresh(remote, clientId, spent)).rejects.toThrow()
    await expect(refresh(remote, clientId, rotated.refresh_token ?? '')).rejects.toThrow()
    expect(await bearerStatus(remote, rotated.access_token)).toBe(401)
  })

  it('refuses a token issued by another connector, even one it knows', async () => {
    const data = await dataFolder()
    folders.push(data)
    await grantUserLibrary(data, ['prompts:read'])
    const clientId = await registerClient(data)
    // A first connector (its own address) signs the client in; it then stops.
    const first = await startRemote(data, TLS_ARGUMENTS)
    const session = new SdkSession({ client_id: clientId })
    const signedIn = await signIn(first, session)
    expect(isConnected(signedIn)).toBe(true)
    if (isConnected(signedIn)) await signedIn.client.close()
    const foreign = accessTokenOf(session)
    expect(await bearerStatus(first, foreign)).toBe(200)
    await first.stop()
    // A second connector on the same folder holds that token's record, but at another address.
    const second = await startRemote(data, TLS_ARGUMENTS)
    running.push(second)
    expect(second.mcpUrl).not.toBe(first.mcpUrl)
    expect(await bearerStatus(second, foreign)).toBe(401)
  })
})

describe('M124 remote: the owner ends a sign-in', () => {
  it('ends every sign-in when the connection grant is revoked, and keeps them ended after a new grant', async () => {
    const { remote, data } = await served()
    const { session, clientId } = await signedInSession(remote, data)
    const access = accessTokenOf(session)
    const refreshToken = session.tokenSet?.refresh_token ?? ''
    expect(await bearerStatus(remote, access)).toBe(200)
    expect(await ownerCommand(data, ['revoke'])).toBe(0)
    expect(await bearerStatus(remote, access)).toBe(401)
    await grantUserLibrary(data, ['prompts:read', 'operations:read', 'control:stop'])
    expect(await bearerStatus(remote, access)).toBe(401)
    await expect(refresh(remote, clientId, refreshToken)).rejects.toThrow()
  })

  it('ends one client at once, from another terminal, while the connector runs', async () => {
    const { remote, data } = await served()
    const { session, clientId } = await signedInSession(remote, data)
    const access = accessTokenOf(session)
    expect(await bearerStatus(remote, access)).toBe(200)
    const listed = await remoteCommand(data, ['client', 'list'])
    expect(listed.output).toContain(clientId)
    const removed = await remoteCommand(data, ['client', 'remove', '--client-id', clientId])
    expect(removed.code).toBe(0)
    expect(await bearerStatus(remote, access)).toBe(401)
    const remaining = await remoteCommand(data, ['client', 'list'])
    expect(remaining.output).not.toContain(clientId)
    const again = await remoteCommand(data, ['client', 'remove', '--client-id', clientId])
    expect(again.code).toBe(1)
  })
})

describe('M124 remote: clients that register themselves', () => {
  it('has no registration endpoint until the person turns it on, then lets the SDK client register and sign in', async () => {
    const { remote: closed } = await served()
    const refused = await fetch(`${closed.origin}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:8765/callback'] }),
    })
    expect(refused.status).toBe(404)
    const { remote: open, data } = await served([...TLS_ARGUMENTS, '--open-registration'])
    const session = new SdkSession()
    const signedIn = await signIn(open, session)
    expect(isConnected(signedIn)).toBe(true)
    if (!isConnected(signedIn)) return
    expect(session.registration?.client_id).toBeDefined()
    expect(signedIn.page).toContain('SDK test client')
    expect(await signedIn.client.listTools()).toBeDefined()
    await signedIn.client.close()
    // The owner sees the client that registered itself, once approved.
    const listed = await remoteCommand(data, ['client', 'list'])
    expect(listed.output).toContain(session.registration?.client_id)
    expect(listed.output).toContain('registered by the client itself')
  })
})

/** Whether a plain TCP connection to the address is accepted at all. */
async function canConnect(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
  })
}

describe('M124 remote: reach is the person’s to widen', () => {
  const lan = lanAddress()

  it.skipIf(lan === undefined)(
    'listens on loopback alone until the person names a wider address',
    async () => {
      const { remote, data } = await served()
      if (lan === undefined) return
      expect(await canConnect('127.0.0.1', remote.port)).toBe(true)
      // The same PC's network address: nobody is listening there.
      expect(await canConnect(lan, remote.port)).toBe(false)
      await remote.stop()
      const port = await freePort()
      const widened = await startRemote(
        data,
        [...TLS_ARGUMENTS, '--bind', lan, '--public-url', `https://${lan}:${String(port)}`],
        port,
      )
      running.push(widened)
      expect(widened.output()).toContain('can be reached from beyond this PC')
      expect(await canConnect(lan, port)).toBe(true)
    },
  )

  it('serves plain HTTP on loopback behind the person’s own tunnel, under its public name', async () => {
    const data = await dataFolder()
    folders.push(data)
    await grantUserLibrary(data, ['prompts:read'])
    const port = await freePort()
    const remote = await startRemote(
      data,
      ['--tunnel', '--public-url', 'https://connector.example'],
      port,
    )
    running.push(remote)
    const resource = await fetch(
      `http://127.0.0.1:${String(port)}/.well-known/oauth-protected-resource/mcp`,
    )
    const body = (await resource.json()) as Record<string, unknown>
    expect(body['resource']).toBe('https://connector.example/mcp')
    expect(body['authorization_servers']).toEqual(['https://connector.example'])
  })

  it('refuses to start without HTTPS, a public name for a wider address, or loopback for a tunnel', async () => {
    const data = await dataFolder()
    folders.push(data)
    const bare = await remoteCommand(data, ['serve-http'])
    expect(bare.code).toBe(2)
    expect(bare.output).toContain('Give --tls-cert and --tls-key')
    const unnamed = await remoteCommand(data, ['serve-http', '--bind', 'lan', ...TLS_ARGUMENTS])
    expect(unnamed.code).toBe(2)
    expect(unnamed.output).toContain('A wider address needs --public-url')
    const wideTunnel = await remoteCommand(data, [
      'serve-http',
      '--tunnel',
      '--bind',
      'lan',
      '--public-url',
      'https://connector.example',
    ])
    expect(wideTunnel.code).toBe(2)
    expect(wideTunnel.output).toContain('--tunnel serves plain HTTP')
  })
})
