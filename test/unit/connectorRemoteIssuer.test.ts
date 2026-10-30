// The issuer is the one public name. A request must not be able to make
// discovery advertise a different token, key or revocation address: the
// real `serve-http` process, on loopback, with the request a stranger sends.
import { rm, stat } from 'node:fs/promises'
import { connect } from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONNECTOR_FILE_MODE, CONNECTOR_FOLDER } from '../../src/shared/constants'
import {
  TLS_ARGUMENTS,
  dataFolder,
  startRemote,
  trustFixtureCertificate,
  type RunningRemote,
} from './helpers/connectorRemote'

const PUBLIC = 'https://owner.example'
const running: RunningRemote[] = []
const folders: string[] = []

async function tunnel(): Promise<RunningRemote> {
  const data = await dataFolder()
  folders.push(data)
  const remote = await startRemote(data, ['--tunnel', '--public-url', PUBLIC])
  running.push(remote)
  return remote
}

function request(port: number, raw: string, isSecure: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = isSecure
      ? tls.connect({ host: '127.0.0.1', port, servername: 'localhost', rejectUnauthorized: true })
      : connect({ host: '127.0.0.1', port })
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    socket.setTimeout(3000, () => {
      fail(new Error('the connector did not answer'))
    })
    socket.once('error', fail)
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    socket.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    socket.once(isSecure ? 'secureConnect' : 'connect', () => {
      socket.write(raw)
    })
  })
}

function jsonBody(raw: string): Record<string, unknown> {
  const at = raw.indexOf('\r\n\r\n')
  const body = at === -1 ? raw : raw.slice(at + 4)
  return JSON.parse(body) as Record<string, unknown>
}

describe('M124 remote: discovery names only the configured issuer', () => {
  beforeAll(() => {
    trustFixtureCertificate()
  })

  afterAll(async () => {
    await Promise.all(running.splice(0).map(async (remote) => await remote.stop()))
    await Promise.all(
      folders.splice(0).map(async (folder) => {
        await rm(folder, { recursive: true, force: true })
      }),
    )
  })

  it('keeps the public URL when a tunnel request names another host', async () => {
    const remote = await tunnel()
    const url = `http://127.0.0.1:${String(remote.port)}/.well-known/oauth-authorization-server`
    const expected = {
      issuer: PUBLIC,
      authorization_endpoint: `${PUBLIC}/authorize`,
      token_endpoint: `${PUBLIC}/token`,
      jwks_uri: `${PUBLIC}/jwks.json`,
      revocation_endpoint: `${PUBLIC}/revoke`,
    }
    const cleanResponse = await fetch(url)
    const clean = (await cleanResponse.json()) as Record<string, unknown>
    expect(clean).toMatchObject(expected)
    const forwardedResponse = await fetch(url, { headers: { 'x-forwarded-host': 'evil.example' } })
    const forwarded = (await forwardedResponse.json()) as Record<string, unknown>
    expect(forwarded).toMatchObject(expected)
    const firstResponse = await fetch(url, {
      headers: { 'x-forwarded-host': 'evil.example, owner.example' },
    })
    const firstWins = (await firstResponse.json()) as Record<string, unknown>
    expect(firstWins).toMatchObject(expected)
    const absolute = jsonBody(
      await request(
        remote.port,
        `GET http://evil.example/.well-known/oauth-authorization-server HTTP/1.1\r\nHost: 127.0.0.1:${String(remote.port)}\r\nConnection: close\r\n\r\n`,
        false,
      ),
    )
    expect(absolute).toMatchObject(expected)
    expect(JSON.stringify(absolute)).not.toContain('evil.example')
    const resourceResponse = await fetch(
      `http://127.0.0.1:${String(remote.port)}/.well-known/oauth-protected-resource/mcp`,
      { headers: { 'x-forwarded-host': 'evil.example' } },
    )
    const resource = (await resourceResponse.json()) as Record<string, unknown>
    expect(resource['resource']).toBe(`${PUBLIC}/mcp`)
    expect(resource['authorization_servers']).toEqual([PUBLIC])
  })

  it('keeps the issuer when a TLS request uses an absolute-form request line', async () => {
    const data = await dataFolder()
    folders.push(data)
    const remote = await startRemote(data, TLS_ARGUMENTS)
    running.push(remote)
    const absolute = jsonBody(
      await request(
        remote.port,
        `GET http://evil.example/.well-known/oauth-authorization-server HTTP/1.1\r\nHost: 127.0.0.1:${String(remote.port)}\r\nConnection: close\r\n\r\n`,
        true,
      ),
    )
    expect(absolute['issuer']).toBe(remote.origin)
    expect(absolute['token_endpoint']).toBe(`${remote.origin}/token`)
    expect(absolute['authorization_endpoint']).toBe(`${remote.origin}/authorize`)
    expect(absolute['jwks_uri']).toBe(`${remote.origin}/jwks.json`)
    expect(JSON.stringify(absolute)).not.toContain('evil.example')
    const info = await stat(path.join(data, CONNECTOR_FOLDER, 'oauth', 'default.json'))
    expect(info.mode & 0o777).toBe(CONNECTOR_FILE_MODE)
  })

  it('refuses a Host or Origin that is not this connector', async () => {
    const remote = await tunnel()
    const foreignHost = await request(
      remote.port,
      `GET /.well-known/oauth-authorization-server HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n`,
      false,
    )
    expect(foreignHost.startsWith('HTTP/1.1 403')).toBe(true)
    const foreignOrigin = await fetch(
      `http://127.0.0.1:${String(remote.port)}/.well-known/oauth-authorization-server`,
      { headers: { origin: 'https://evil.example' } },
    )
    expect(foreignOrigin.status).toBe(403)
    expect(foreignOrigin.headers.get('access-control-allow-origin')).toBeNull()
  })
})
