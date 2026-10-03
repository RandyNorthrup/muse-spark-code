// The browser check's own proxy (M81 A1, design spec v4 §3.2), over real
// sockets on loopback: what it forwards and to where, what it refuses
// before any lookup or connection, the sign-in challenges and credentials
// it never relays, the tunnels it opens only to explicitly widened hosts,
// the heads it refuses, and everything closed with it.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import {
  connect,
  createServer as createTcpServer,
  type Server as TcpServer,
  type Socket,
} from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type CheckProxy,
  type FrozenScope,
  type ProxyObservation,
  startCheckProxy,
} from '../../src/core/browser/checkProxy'

const servers: (Server | TcpServer)[] = []
const proxies: CheckProxy[] = []

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close()
  }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve)
        }),
    ),
  )
})

async function listen(server: Server | TcpServer, host = '127.0.0.1'): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, host, resolve)
  })
  const address = server.address()
  return typeof address === 'object' && address !== null ? address.port : 0
}

function scope(explicitHosts: readonly string[] = []): FrozenScope {
  return { url: 'http://localhost:3000/', explicitHosts, approvalKey: 'key' }
}

async function proxyFor(
  explicitHosts: readonly string[] = [],
  lookup = vi.fn((_host: string) => Promise.resolve('127.0.0.1')),
): Promise<{ proxy: CheckProxy; port: number; seen: ProxyObservation[]; lookup: typeof lookup }> {
  const proxy = await startCheckProxy(scope(explicitHosts), lookup)
  proxies.push(proxy)
  const seen: ProxyObservation[] = []
  proxy.observe((record) => {
    seen.push(record)
  })
  return { proxy, port: Number(new URL(proxy.endpoint).port), seen, lookup }
}

/** A raw request on a fresh connection to the proxy; everything it answered until it closed. */
async function raw(port: number, text: string | Buffer, keepOpenMs = 0): Promise<string> {
  return await new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    const parts: Buffer[] = []
    socket.on('data', (chunk) => {
      parts.push(chunk)
    })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      resolve(Buffer.concat(parts).toString('latin1'))
    })
    socket.write(text)
    if (keepOpenMs > 0) {
      setTimeout(() => socket.end(), keepOpenMs)
    }
  })
}

/** An upstream that records each request's raw head and answers with sign-in challenges and hop-by-hop fields. */
async function upstream(): Promise<{ port: number; heads: IncomingMessage[] }> {
  const heads: IncomingMessage[] = []
  const server = createServer((request, response) => {
    heads.push(request)
    request.resume()
    response.writeHead(401, [
      'WWW-Authenticate',
      'Negotiate',
      'www-authenticate',
      'NTLM',
      'WWW-AUTHENTICATE',
      'Basic realm="x"',
      'Proxy-Authenticate',
      'Negotiate',
      'Connection',
      'close, X-Hop',
      'X-Hop',
      'gone',
      'Keep-Alive',
      'timeout=5',
      'Set-Cookie',
      'a=b',
      'Content-Type',
      'text/plain',
    ])
    response.end('denied')
  })
  return { port: await listen(server), heads }
}

describe('the browser check’s proxy (M81 A1)', () => {
  it('listens on 127.0.0.1 only, at a port the OS picked, with the loopback subtraction as its bypass list', async () => {
    const { proxy } = await proxyFor()
    expect(proxy.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(proxy.bypassList).toBe('<-loopback>')
  })

  it('forwards plain HTTP to loopback reserialized: a canonical Host, closed, no credentials or hop-by-hop fields', async () => {
    const { port, seen } = await proxyFor()
    const target = await upstream()
    const answer = await raw(
      port,
      [
        `GET http://127.0.0.1:${String(target.port)}/x?y=1 HTTP/1.1`,
        `Host: 127.0.0.1:${String(target.port)}`,
        'Authorization: Negotiate YIIsecret',
        'Proxy-Authorization: Basic c2VjcmV0',
        'Connection: keep-alive, X-Secret',
        'X-Secret: nominated',
        'Proxy-Connection: keep-alive',
        'X-Kept: yes',
        '',
        '',
      ].join('\r\n'),
    )
    const [head] = target.heads
    expect(head?.url).toBe('/x?y=1')
    expect(head?.headers.host).toBe(`127.0.0.1:${String(target.port)}`)
    expect(head?.headers.connection).toBe('close')
    expect(head?.headers['x-kept']).toBe('yes')
    for (const name of ['authorization', 'proxy-authorization', 'x-secret', 'proxy-connection']) {
      expect(head?.headers[name], name).toBeUndefined()
    }
    // The answer: its status and body, every challenge and hop-by-hop field gone.
    expect(answer).toMatch(/^HTTP\/1\.1 401 /)
    expect(answer).toMatch(/\r\nConnection: close\r\n/i)
    expect(answer).toContain('Set-Cookie: a=b')
    expect(answer.toLowerCase()).not.toMatch(/www-authenticate|proxy-authenticate|x-hop|keep-alive/)
    expect(answer).toContain('denied')
    expect(seen).toEqual([
      {
        form: 'http',
        host: '127.0.0.1',
        port: target.port,
        forwarded: true,
        challengeStripped: true,
      },
    ])
  })

  it('connects localhost to fixed loopback literals and numeric hosts as written, never looking either up', async () => {
    const { port, seen, lookup } = await proxyFor()
    const target = await upstream()
    for (const host of ['localhost', '127.0.0.1']) {
      const authority = `${host}:${String(target.port)}`
      const answer = await raw(
        port,
        `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      )
      expect(answer, host).toMatch(/^HTTP\/1\.1 401 /)
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(seen.map((record) => record.host)).toEqual(['localhost', '127.0.0.1'])
  })

  it('refuses every other destination with a fixed 403, before any lookup or connection', async () => {
    const counter = createTcpServer((socket) => {
      socket.destroy()
    })
    const counted = vi.fn()
    counter.on('connection', counted)
    const counterPort = await listen(counter)
    const { port, seen, lookup } = await proxyFor(['app.test'])
    for (const host of [
      '10.0.0.5',
      'example.com',
      `c8-${'a'.repeat(32)}.localhost`,
      '169.254.169.254',
      'x.app.test',
      '[::ffff:7f00:1]',
      '[fe80::1]',
      'muse-spark-no-ambient-auth.invalid',
    ]) {
      const authority = `${host}:${String(counterPort)}`
      const answer = await raw(
        port,
        `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      )
      expect(answer, host).toMatch(/^HTTP\/1\.1 403 /)
      expect(answer.toLowerCase(), host).not.toContain('authenticate')
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(counted).not.toHaveBeenCalled()
    expect(seen.every((record) => !record.forwarded)).toBe(true)
  })

  it('looks a widened name up once, after its approval, and connects to that answer', async () => {
    const target = await upstream()
    const { port, lookup, seen } = await proxyFor(['app.test'])
    const authority = `app.test:${String(target.port)}`
    const answer = await raw(
      port,
      `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
    )
    expect(answer).toMatch(/^HTTP\/1\.1 401 /)
    expect(lookup.mock.calls).toEqual([['app.test']])
    expect(target.heads[0]?.headers.host).toBe(authority)
    expect(seen).toEqual([
      {
        form: 'http',
        host: 'app.test',
        port: target.port,
        forwarded: true,
        challengeStripped: true,
      },
    ])
  })

  it('refuses every ambiguous, malformed or unsupported request form', async () => {
    const target = await upstream()
    const { port, seen } = await proxyFor(['app.test'])
    const p = String(target.port)
    for (const head of [
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n\r\n`,
      `GET https://127.0.0.1:${p}/ HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n\r\n`,
      `GET http://user:pass@127.0.0.1:${p}/ HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n\r\n`,
      `GET http://127.0.0.1:${p}/#frag HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n\r\n`,
      `GET http://127.0.0.1:${p}/ HTTP/1.1\r\nHost: 10.0.0.5:${p}\r\n\r\n`,
      `GET http://127.0.0.1:${p}/ HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\nHost: 127.0.0.1:${p}\r\n\r\n`,
      `GET http://127.0.0.1:${p}/ HTTP/1.1\r\n\r\n`,
      `GET http://127.1:${p}/ HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\n\r\n`,
      `GET http://127.0.0.1:0/ HTTP/1.1\r\nHost: 127.0.0.1:0\r\n\r\n`,
      `GET http://127.0.0.1:${p}/ HTTP/1.1\r\nHost: 127.0.0.1:${p}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
    ]) {
      const answer = await raw(port, head)
      expect(answer.startsWith('HTTP/1.1 200') || answer.startsWith('HTTP/1.1 401'), head).toBe(
        false,
      )
    }
    expect(target.heads).toEqual([])
    expect(seen.every((record) => !record.forwarded)).toBe(true)
  })

  it('tunnels only to an explicitly widened host, loopback included, never to implicit loopback or the sentinel', async () => {
    const echo = createTcpServer((socket) => {
      socket.pipe(socket)
    })
    const echoPort = String(await listen(echo))
    const implicit = await proxyFor()
    for (const authority of [
      `127.0.0.1:${echoPort}`,
      `localhost:${echoPort}`,
      `[::1]:${echoPort}`,
    ]) {
      const answer = await raw(
        implicit.port,
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      )
      expect(answer, authority).toMatch(/^HTTP\/1\.1 403 /)
    }
    const sentinel = await proxyFor(['muse-spark-no-ambient-auth.invalid'])
    expect(
      await raw(sentinel.port, 'CONNECT muse-spark-no-ambient-auth.invalid:443 HTTP/1.1\r\n\r\n'),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(sentinel.lookup).not.toHaveBeenCalled()

    const widened = await proxyFor(['127.0.0.1'])
    const answer = await raw(
      widened.port,
      `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\nProxy-Authorization: Basic c2VjcmV0\r\n\r\nping`,
      300,
    )
    expect(answer.startsWith('HTTP/1.1 200 Connection Established\r\n\r\n')).toBe(true)
    expect(answer.endsWith('ping')).toBe(true)
    expect(widened.seen).toEqual([
      {
        form: 'connect',
        host: '127.0.0.1',
        port: Number(echoPort),
        forwarded: true,
        challengeStripped: false,
      },
    ])
    for (const head of [
      `CONNECT 127.0.0.1 HTTP/1.1\r\n\r\n`,
      `CONNECT 127.0.0.1:${echoPort}/x HTTP/1.1\r\n\r\n`,
    ]) {
      expect(await raw(widened.port, head), head).toMatch(/^HTTP\/1\.1 403 /)
    }
  })

  it('records a refused CONNECT with its host and port, the way the canaries read it', async () => {
    const { port, seen } = await proxyFor()
    await raw(port, 'CONNECT c3-abc.invalid:443 HTTP/1.1\r\nHost: c3-abc.invalid:443\r\n\r\n')
    await raw(port, 'CONNECT c2-abc.invalid:80 HTTP/1.1\r\nHost: c2-abc.invalid:80\r\n\r\n')
    expect(seen).toEqual([
      {
        form: 'connect',
        host: 'c3-abc.invalid',
        port: 443,
        forwarded: false,
        challengeStripped: false,
      },
      {
        form: 'connect',
        host: 'c2-abc.invalid',
        port: 80,
        forwarded: false,
        challengeStripped: false,
      },
    ])
  })

  it('closes a head past 16 KiB and one that does not complete within its bound', async () => {
    const { port } = await proxyFor()
    const big = await raw(
      port,
      `GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: 127.0.0.1:1\r\nX-Big: ${'a'.repeat(17_000)}\r\n\r\n`,
    )
    expect(big).toBe('')
    const started = Date.now()
    const slow = await raw(
      port,
      'GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: 127.0.0.1:1\r\n',
      10_000,
    )
    expect(slow).not.toMatch(/^HTTP\/1\.1 200/)
    expect(Date.now() - started).toBeLessThan(8000)
  }, 15_000)

  it('never relays a switch of protocols or an informational head from upstream', async () => {
    const rude = createTcpServer((socket) => {
      socket.once('data', () => {
        socket.end(
          'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nraw-bytes',
        )
      })
    })
    const rudePort = String(await listen(rude))
    const { port } = await proxyFor()
    const answer = await raw(
      port,
      `GET http://127.0.0.1:${rudePort}/ HTTP/1.1\r\nHost: 127.0.0.1:${rudePort}\r\n\r\n`,
    )
    expect(answer).not.toContain('101')
    expect(answer).not.toContain('raw-bytes')
  })

  it('answers 502 when loopback refuses the connection, and closes every connection with itself', async () => {
    const closed = createTcpServer()
    const closedPort = String(await listen(closed))
    await new Promise((resolve) => {
      closed.close(resolve)
    })
    servers.splice(servers.indexOf(closed), 1)
    const { proxy, port, seen } = await proxyFor()
    expect(
      await raw(
        port,
        `GET http://127.0.0.1:${closedPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${closedPort}\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 502 /)
    expect(seen[0]?.forwarded).toBe(true)

    const held: Socket = connect(port, '127.0.0.1')
    await new Promise((resolve) => held.once('connect', resolve))
    const gone = new Promise((resolve) => held.once('close', resolve))
    await proxy.close()
    await gone
    expect(held.destroyed).toBe(true)
  })
})
