import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import {
  type ClientRequest,
  createServer,
  type IncomingHttpHeaders,
  request as httpRequest,
  type Server,
} from 'node:http'
import type { Socket } from 'node:net'
import { PassThrough } from 'node:stream'
import { TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import type { PinnedTarget } from '../../src/core/web/webFetch'
import {
  pinnedHttpsRequest,
  pinnedOptions,
  type RequestFunction,
} from '../../src/host/web/pinnedRequest'
import {
  WEB_FETCH_ACCEPT_ENCODING,
  WEB_FETCH_DEFAULT_PORT,
  WEB_FETCH_NOT_TLS_CODE,
  WEB_FETCH_USER_AGENT,
} from '../../src/shared/constants'

const servers: Server[] = []
// The loopback server speaks plain HTTP, so these tests lift the TLS
// requirement, except the ones that show it.
const IS_TLS_REQUIRED = false

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections()
          server.close(resolve)
        }),
    ),
  )
})

interface Seen {
  host: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
}

/** A loopback server standing in for the pinned address; it records what it was asked. */
async function listen(
  handler: () => { body: string; hang?: boolean },
): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = []
  const server = createServer((request, response) => {
    seen.push({ host: request.headers.host, url: request.url, headers: request.headers })
    const reply = handler()
    response.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': ['a=1', 'b=2'] })
    if (reply.hang === true) {
      response.write(reply.body)
      return
    }
    response.end(reply.body)
  })
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the loopback server has no port')
  }
  return { port: address.port, seen }
}

function target(url: string, address = '127.0.0.1'): PinnedTarget {
  const parsed = new URL(url)
  return { url: parsed, host: parsed.hostname.replaceAll(/^\[|\]$/g, ''), address, family: 4 }
}

async function text(body: AsyncIterable<Uint8Array>): Promise<string> {
  return Buffer.concat(await Array.fromAsync(body)).toString('utf8')
}

/** Counts `onConnected`. */
function connections() {
  let count = 0
  return {
    onConnected: () => {
      count += 1
    },
    count: () => count,
  }
}

/** A request that only hands over a socket: what `onConnected` watches. */
function socketOnly(socket: Socket): { request: RequestFunction; outgoing: EventEmitter } {
  const outgoing = Object.assign(new EventEmitter(), {
    end: () => undefined,
    destroy: () => undefined,
  })
  const request: RequestFunction = () => outgoing as unknown as ClientRequest
  setImmediate(() => {
    outgoing.emit('socket', socket)
  })
  return { request, outgoing }
}

describe('pinnedHttpsRequest (M69)', () => {
  it('connects to the pinned address and names the page only in TLS and the Host header', () => {
    const options = pinnedOptions(
      target('https://docs.example.com/a/b?x=1#frag', '93.184.215.14'),
      new AbortController().signal,
    )
    expect(options).toMatchObject({
      method: 'GET',
      host: '93.184.215.14',
      family: 4,
      port: WEB_FETCH_DEFAULT_PORT,
      path: '/a/b?x=1',
      servername: 'docs.example.com',
      headers: {
        host: 'docs.example.com',
        'user-agent': WEB_FETCH_USER_AGENT,
        'accept-encoding': WEB_FETCH_ACCEPT_ENCODING,
      },
    })
    // A URL that names an address is verified as that address: no SNI name.
    const literal = pinnedOptions(
      target('https://8.8.8.8:8443/', '8.8.8.8'),
      new AbortController().signal,
    )
    expect(literal).toMatchObject({
      host: '8.8.8.8',
      port: 8443,
      headers: { host: '8.8.8.8:8443' },
    })
    expect(literal).not.toHaveProperty('servername')
  })

  it('sends the request to the address, never looking the name up, and says when it connected', async () => {
    const { port, seen } = await listen(() => ({ body: 'hello' }))
    const connected = connections()
    const response = await pinnedHttpsRequest(
      target(`https://never-resolved.invalid:${String(port)}/p?q=1`),
      new AbortController().signal,
      connected.onConnected,
      httpRequest,
      IS_TLS_REQUIRED,
    )
    expect(connected.count()).toBe(1)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/plain')
    expect(response.headers['set-cookie']).toBe('a=1, b=2')
    expect(await text(response.body)).toBe('hello')
    response.close()
    expect(seen).toMatchObject([{ host: `never-resolved.invalid:${String(port)}`, url: '/p?q=1' }])
    expect(seen[0]?.headers['user-agent']).toBe(WEB_FETCH_USER_AGENT)
  })

  it('stops reading when the fetch aborts, and rejects a connection it cannot make', async () => {
    const { port } = await listen(() => ({ body: 'partial', hang: true }))
    const controller = new AbortController()
    const response = await pinnedHttpsRequest(
      target(`https://docs.example.com:${String(port)}/`),
      controller.signal,
      connections().onConnected,
      httpRequest,
      IS_TLS_REQUIRED,
    )
    const reading = text(response.body)
    controller.abort()
    await expect(reading).rejects.toThrow()
    const closed = await listen(() => ({ body: '' }))
    await new Promise((resolve) => {
      servers.pop()?.close(resolve)
    })
    const never = connections()
    await expect(
      pinnedHttpsRequest(
        target(`https://docs.example.com:${String(closed.port)}/`),
        new AbortController().signal,
        never.onConnected,
        httpRequest,
        IS_TLS_REQUIRED,
      ),
    ).rejects.toThrow(/ECONNREFUSED/)
    expect(never.count()).toBe(0)
  })

  it("refuses an answer that did not come over TLS: a proxy's, never the page", async () => {
    const { port } = await listen(() => ({ body: 'Forbidden by policy' }))
    const connected = connections()
    let refused: unknown
    try {
      await pinnedHttpsRequest(
        target(`https://docs.example.com:${String(port)}/`),
        new AbortController().signal,
        connected.onConnected,
        httpRequest,
      )
    } catch (error: unknown) {
      refused = error
    }
    expect(refused).toMatchObject({ code: WEB_FETCH_NOT_TLS_CODE, status: 200 })
    expect(String(refused)).toContain('instead of a TLS connection to 127.0.0.1')
    // A plain connection never counts as connected when TLS is required.
    expect(connected.count()).toBe(0)
  })

  it('counts a TLS connection as up only once its handshake is done', async () => {
    const tls = new TLSSocket(new PassThrough())
    const { request } = socketOnly(tls)
    const connected = connections()
    void pinnedHttpsRequest(
      target('https://docs.example.com/'),
      new AbortController().signal,
      connected.onConnected,
      request,
    ).catch(() => undefined)
    await new Promise((resolve) => setImmediate(resolve))
    expect(connected.count()).toBe(0)
    tls.emit('secureConnect')
    expect(connected.count()).toBe(1)
    tls.destroy()
  })
})
