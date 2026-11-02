import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { MachineHttp } from '../../src/core/maker/machines/http'
import { requestOctoprintAppKey } from '../../src/core/maker/machines/octoprint'
import type { MachineRecord, MakerLanPolicy } from '../../src/core/maker/registry'
import { makerLimits as limits } from './helpers/makerMachineSimulator'
import { listenOnLoopback } from './helpers/loopbackPort'

// OctoPrint's documented application-keys API (docs.octoprint.org appkeys),
// served over real loopback HTTP: probe, request, then poll. The bodies below
// are the documented shapes, not captures: no OctoPrint answers on a rig.
interface ScriptedRoute {
  readonly status: number
  readonly body?: unknown
}
interface SeenRequest {
  readonly method: string | undefined
  readonly path: string
  readonly body: unknown
  readonly hasKey: boolean
}
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
})
function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      resolve(text === '' ? null : (JSON.parse(text) as unknown))
    })
  })
}
async function appkeysServer(routes: (seen: SeenRequest) => ScriptedRoute): Promise<{
  port: number
  requests: SeenRequest[]
}> {
  const requests: SeenRequest[] = []
  const server = createServer((request, response: ServerResponse) => {
    void readBody(request).then((body) => {
      const seen: SeenRequest = {
        method: request.method,
        path: request.url ?? '',
        body,
        hasKey: typeof request.headers['x-api-key'] === 'string',
      }
      requests.push(seen)
      const route = routes(seen)
      const text = route.body === undefined ? '' : JSON.stringify(route.body)
      response.writeHead(route.status, { 'Content-Type': 'application/json' })
      response.end(text)
    })
  })
  servers.push(server)
  return { port: await listenOnLoopback(server), requests }
}
const lan: MakerLanPolicy = {
  classify: () => 'private',
  resolve: () => Promise.resolve(['127.0.0.1']),
}
function http(port: number): MachineHttp {
  const record: MachineRecord = {
    registrationId: randomUUID(),
    id: 'octo',
    name: 'OctoPrint',
    endpoint: `http://127.0.0.1:${String(port)}`,
    kind: 'octoprint',
    category: 'printer',
    allowPlainHttp: true,
    limits,
  }
  const secrets = {
    get: () => Promise.resolve(undefined),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
  return new MachineHttp(record, lan, secrets, {
    timeoutMs: 2000,
    maxResponseBytes: 65_536,
  })
}

describe('OctoPrint application keys', () => {
  it('polls a granted request to its key without ever sending one', async () => {
    let polls = 0
    const dialogs: string[] = []
    const { port, requests } = await appkeysServer((seen) => {
      if (seen.path === '/plugin/appkeys/probe') return { status: 204 }
      if (seen.path === '/plugin/appkeys/request')
        return {
          status: 201,
          body: { app_token: 'app-token-1', auth_dialog: 'http://octo.local/auth/1' },
        }
      polls += 1
      return polls < 2 ? { status: 202 } : { status: 200, body: { api_key: 'issued-key-1' } }
    })
    const result = await requestOctoprintAppKey({
      http: http(port),
      app: 'Test App',
      user: 'me',
      pollIntervalMs: 5,
      timeoutMs: 2000,
      onAuthDialog: (url) => {
        dialogs.push(url)
      },
    })
    expect(result).toEqual({ status: 'granted', apiKey: 'issued-key-1' })
    expect(dialogs).toEqual(['http://octo.local/auth/1'])
    expect(polls).toBe(2)
    expect(requests.map((seen) => seen.path)).toEqual([
      '/plugin/appkeys/probe',
      '/plugin/appkeys/request',
      '/plugin/appkeys/request/app-token-1',
      '/plugin/appkeys/request/app-token-1',
    ])
    expect(requests[1]?.body).toEqual({ app: 'Test App', user: 'me' })
    expect(requests.every((seen) => !seen.hasKey)).toBe(true)
  })
  it('reports denied when OctoPrint answers 404 to the poll', async () => {
    const { port } = await appkeysServer((seen) => {
      if (seen.path === '/plugin/appkeys/probe') return { status: 204 }
      return seen.path === '/plugin/appkeys/request'
        ? { status: 201, body: { app_token: 'app-token-2', auth_dialog: 'http://o/2' } }
        : { status: 404, body: { error: 'denied' } }
    })
    const result = await requestOctoprintAppKey({
      http: http(port),
      app: 'Test App',
      pollIntervalMs: 5,
      timeoutMs: 2000,
    })
    expect(result).toEqual({ status: 'denied' })
  })
  it('reports unsupported when the probe misses and sends no request', async () => {
    const { port, requests } = await appkeysServer(() => ({ status: 404 }))
    const result = await requestOctoprintAppKey({
      http: http(port),
      app: 'Test App',
      pollIntervalMs: 5,
      timeoutMs: 2000,
    })
    expect(result).toEqual({ status: 'unsupported' })
    expect(requests.map((seen) => seen.path)).toEqual(['/plugin/appkeys/probe'])
  })
  it('stops polling at its timeout and refuses an aborted wait', async () => {
    const { port, requests } = await appkeysServer((seen) => {
      if (seen.path === '/plugin/appkeys/probe') return { status: 204 }
      return seen.path === '/plugin/appkeys/request'
        ? { status: 201, body: { app_token: 'app-token-3', auth_dialog: 'http://o/3' } }
        : { status: 202 }
    })
    const result = await requestOctoprintAppKey({
      http: http(port),
      app: 'Test App',
      pollIntervalMs: 5,
      timeoutMs: 120,
    })
    expect(result).toEqual({ status: 'timeout' })
    expect(requests.length).toBeGreaterThan(2)
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      requestOctoprintAppKey({
        http: http(port),
        app: 'Test App',
        pollIntervalMs: 5,
        timeoutMs: 2000,
        signal: aborted.signal,
      }),
    ).rejects.toThrow()
  })
})
