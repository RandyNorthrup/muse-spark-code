import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'node:http'
import { createServer as rawServer, type Server, Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localEndpoint, requestLocal } from '../../src/core/judge/local/transport'
import { LOCAL_JUDGE_MAX_RESPONSE_BYTES } from '../../src/shared/constants'

const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve()
      }),
    )
  }
})

async function listen(server: Server): Promise<{ address: string; port: number }> {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test listener')
  return { address: '127.0.0.1', port: address.port }
}

describe('M98-2j pinned transport', () => {
  it('resolves once and pins the loopback literal', async () => {
    const resolve = vi.fn().mockResolvedValue({ address: '127.0.0.1', family: 4 })
    expect(await localEndpoint('http://localhost:11434', resolve)).toEqual({
      address: '127.0.0.1',
      port: 11_434,
    })
    expect(resolve).toHaveBeenCalledExactlyOnceWith('localhost')
    expect(await localEndpoint('http://[::1]:11434', resolve)).toEqual({
      address: '::1',
      port: 11_434,
    })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(await localEndpoint('http://127.0.0.1:0', resolve)).toEqual({
      address: '127.0.0.1',
      port: 0,
    })
  })

  it.each([
    'https://127.0.0.1',
    'http://user:pass@127.0.0.1',
    'http://127.0.0.1/api',
    'http://127.0.0.1/?query',
    'http://127.0.0.1/#hash',
    'http://192.0.2.1',
  ])('refuses %s', async (value) => {
    await expect(localEndpoint(value)).rejects.toThrow('unverified')
  })

  it('refuses a hostname resolving outside loopback', async () => {
    await expect(
      localEndpoint('http://localhost', () => Promise.resolve({ address: '192.0.2.1', family: 4 })),
    ).rejects.toThrow('unverified-address')
  })

  it('sends only on the exact verified socket, after the asynchronous verifier', async () => {
    const ports: number[] = []
    const bytes: Buffer[] = []
    let verifiedPort: number | undefined
    let requestPort: number | undefined
    let hasEarlyBytes = false
    const server = createServer((incoming, response) => {
      requestPort = incoming.socket.remotePort
      incoming.on('data', (chunk: Buffer) => {
        bytes.push(chunk)
      })
      incoming.on('end', () => response.end('{"ok":true}'))
    })
    server.on('connection', (socket) => {
      ports.push(socket.remotePort!)
      socket.on('data', () => {
        if (verifiedPort === undefined) hasEarlyBytes = true
      })
    })
    const endpoint = await listen(server)
    const result = await requestLocal(
      endpoint,
      '/api/chat',
      async (socket) => {
        await delay(20)
        expect(bytes).toEqual([])
        expect(ports).toHaveLength(1)
        verifiedPort = socket.localPort
      },
      '{"state":"synthetic"}',
    )
    expect(result).toEqual({ ok: true })
    expect(ports).toEqual([verifiedPort])
    expect(requestPort).toBe(verifiedPort)
    expect(hasEarlyBytes).toBe(false)
    expect(Buffer.concat(bytes).toString()).toBe('{"state":"synthetic"}')
  })

  it('writes zero bytes when verification fails', async () => {
    let received = 0
    const server = rawServer((socket) =>
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length
      }),
    )
    const endpoint = await listen(server)
    const closed = (async () => {
      const [socket] = await once(server, 'connection')
      if (!(socket instanceof Socket)) throw new Error('missing test socket')
      await once(socket, 'close')
    })()
    await expect(
      requestLocal(
        endpoint,
        '/api/chat',
        () => Promise.reject(new Error('unverified')),
        'private-state',
      ),
    ).rejects.toThrow('unverified')
    await closed
    expect(received).toBe(0)
  })

  it('refuses a peer that closes while its verifier is running', async () => {
    const server = rawServer((socket) => socket.end())
    const endpoint = await listen(server)
    await expect(
      requestLocal(
        endpoint,
        '/api/chat',
        async (socket) => {
          await once(socket, 'end')
        },
        'private-state',
      ),
    ).rejects.toThrow('unverified-closed')
  })

  it('checks every reconnect and refuses replacement inside a former TTL', async () => {
    let connection = 0
    let requests = 0
    const server = createServer((_incoming, response) => {
      requests++
      response.end('{}')
    })
    const endpoint = await listen(server)
    const verify = vi.fn(() =>
      ++connection === 1 ? Promise.resolve() : Promise.reject(new Error('unverified-replacement')),
    )
    await expect(requestLocal(endpoint, '/api/tags', verify)).resolves.toEqual({})
    await expect(requestLocal(endpoint, '/api/chat', verify, 'private-state')).rejects.toThrow(
      'unverified-replacement',
    )
    expect(verify).toHaveBeenCalledTimes(2)
    expect(requests).toBe(1)
  })

  it.each([
    { status: 302, body: '{}', reason: 'refused-http-status' },
    { status: 200, body: 'not-json', reason: 'JSON' },
    {
      status: 200,
      body: 'x'.repeat(LOCAL_JUDGE_MAX_RESPONSE_BYTES + 1),
      reason: 'response-too-large',
    },
  ])(
    'refuses malformed, oversized and redirect responses: $reason',
    async ({ status, body, reason }) => {
      let requests = 0
      const endpoint = await listen(
        createServer((_incoming, response) => {
          requests++
          response.writeHead(status, { location: 'http://192.0.2.1/' }).end(body)
        }),
      )
      await expect(requestLocal(endpoint, '/api/tags', () => Promise.resolve())).rejects.toThrow(
        reason,
      )
      expect(requests).toBe(1)
    },
  )

  it('bounds outgoing content and rejects non-loopback direct inputs', async () => {
    const verify = vi.fn(() => Promise.resolve())
    const endpoint = await listen(createServer((_incoming, response) => response.end('{}')))
    await expect(
      requestLocal({ address: '192.0.2.1', port: 80 }, '/api/chat', verify),
    ).rejects.toThrow('unverified-address')
    await expect(
      requestLocal(endpoint, '/api/chat', verify, 'x'.repeat(LOCAL_JUDGE_MAX_RESPONSE_BYTES + 1)),
    ).rejects.toThrow('request-too-large')
    expect(verify).not.toHaveBeenCalled()
  })

  it.each([-1, 0, 65_536, 1.5, NaN])('refuses invalid port %s before connecting', async (port) => {
    await expect(
      requestLocal({ address: '127.0.0.1', port }, '/api/tags', () => Promise.resolve()),
    ).rejects.toThrow('unverified-port')
  })
})
