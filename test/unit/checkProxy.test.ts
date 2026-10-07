// The browser check's own proxy (M81 A1, design spec v4 §3.2), over real
// sockets on loopback: what it forwards and to where, what it refuses
// before any lookup or connection, the sign-in challenges and credentials
// it never relays, the tunnels it opens only to explicitly widened hosts,
// the heads it refuses, and everything closed with it.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import * as net from 'node:net'
import { nat64PrefixesOf } from '../../src/core/publicAddress'
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
import { rawExchange } from './helpers/proxyExchange'
import { registerMakerCompanion } from '../../src/core/maker/companionRegistry'

const servers: (Server | TcpServer)[] = []
const proxies: CheckProxy[] = []
// The proxy's ordinary request form is HTTP; preserve it under the HTTPS lint rule.
const HTTP = 'http:'
vi.mock('node:net', { spy: true })

afterEach(async () => {
  vi.restoreAllMocks()
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
  machines: () => Promise<readonly string[]> = () => Promise.resolve([]),
): Promise<{ proxy: CheckProxy; port: number; seen: ProxyObservation[]; lookup: typeof lookup }> {
  const proxy = await startCheckProxy(
    scope(explicitHosts),
    lookup,
    () => Promise.resolve({ isKnown: true, prefixes: [] }),
    machines,
  )
  proxies.push(proxy)
  const seen: ProxyObservation[] = []
  proxy.observe((record) => {
    seen.push(record)
  })
  return { proxy, port: Number(new URL(proxy.endpoint).port), seen, lookup }
}

/** A raw request on a fresh connection to the proxy; everything it answered until it closed. */
const raw = rawExchange

/** A public/NAT64 destination uses a local fixture or fails before any external socket. */
async function fakeDial(address: string, operation: () => Socket) {
  const actual = await vi.importActual<typeof net>('node:net')
  const dial = vi.fn(operation)
  const mock = vi.spyOn(net, 'connect').mockImplementation((...args: unknown[]) => {
    const options = args[0]
    if (
      typeof options === 'object' &&
      options !== null &&
      'host' in options &&
      options.host === address
    )
      return dial()
    if (typeof options === 'number' && typeof args[1] === 'string')
      return actual.connect(options, args[1])
    throw new Error('unexpected fixture socket')
  })
  return {
    dial,
    restore: () => {
      mock.mockRestore()
    },
  }
}

/** A loopback port nothing listens on any more. */
async function closedPort(): Promise<string> {
  const closed = createTcpServer()
  const port = String(await listen(closed))
  await new Promise((resolve) => {
    closed.close(resolve)
  })
  servers.splice(servers.indexOf(closed), 1)
  return port
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
  it('refuses when the registered machine reader is absent', async () => {
    const target = await upstream()
    const authority = `127.0.0.1:${String(target.port)}`
    const proxy = await startCheckProxy(scope([`http://${authority}`]))
    proxies.push(proxy)
    expect(
      await raw(
        Number(new URL(proxy.endpoint).port),
        `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(target.heads).toEqual([])
  })
  it('refuses a registered IPv6 machine alias despite expanded DNS address spelling', async () => {
    const address = '2606:4700::1111'
    const lookup = vi.fn(() => Promise.resolve('2606:4700:0:0:0:0:0:1111'))
    const { port } = await proxyFor(['allowed.example'], lookup, () =>
      Promise.resolve([`${HTTP}//[${address}]:7125`]),
    )
    const upstream = await fakeDial(address, () => {
      throw new Error('fixture-upstream-refused')
    })
    try {
      expect(
        await raw(port, `GET ${HTTP}//allowed.example/ HTTP/1.1\r\nHost: allowed.example\r\n\r\n`),
      ).toMatch(/^HTTP\/1\.1 403 /)
      expect(upstream.dial).not.toHaveBeenCalled()
    } finally {
      upstream.restore()
    }
  })
  it('refuses a registered machine host on every port and alias, including registrations added during a check', async () => {
    const target = await upstream()
    let registered: readonly string[] = []
    const authority = `allowed.example:${String(target.port)}`
    const { port } = await proxyFor([`http://${authority}`], undefined, () =>
      Promise.resolve(registered),
    )
    registered = [`${HTTP}//allowed.example:7125`]
    expect(
      await raw(port, `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    ).toMatch(/^HTTP\/1\.1 403 /)
    registered = ['http://127.0.0.1:7125']
    expect(
      await raw(port, `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(target.heads).toEqual([])
  })
  it.each([
    'OctoPrint',
    'Mainsail',
    'Fluidd',
    'Moonraker',
    'Duet Web Control',
    'PrusaLink',
    'Bambu LAN',
    'Repetier',
    'Snapmaker Luban',
  ])(
    'refuses an allowlisted %s page on a nonstandard dev port before the browser can click',
    async (ui) => {
      const target = createServer((_request, response) => {
        response
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end(`<title>${ui}</title><button>Move</button>`)
      })
      const targetPort = await listen(target)
      const authority = `127.0.0.1:${String(targetPort)}`
      const { port } = await proxyFor([`http://${authority}`])
      const page = await raw(
        port,
        `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      )
      expect(page).toMatch(/^HTTP\/1\.1 403 /)
      expect(page).not.toContain('<button>')
    },
  )
  it.each([
    ['oversize', 'x'.repeat(64 * 1024 + 1)],
    ['compressed', '<title>Dev</title>'],
    ['sniffed document', '<title>Mainsail</title>'],
  ])('refuses an %s document before it reaches the browser', async (kind, body) => {
    const target = createServer((_request, response) => {
      response
        .writeHead(200, {
          'Content-Type': kind === 'sniffed document' ? 'application/octet-stream' : 'text/html',
          ...(kind === 'compressed' && { 'Content-Encoding': 'gzip' }),
        })
        .end(body)
    })
    const authority = `127.0.0.1:${String(await listen(target))}`
    const { port } = await proxyFor([`http://${authority}`])
    expect(
      await raw(
        port,
        `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\nSec-Fetch-Dest: document\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 403 /)
  })
  it.each([
    ['network-specific private', '2001:4860:64::c0a8:132', true],
    ['network-specific loopback', '2001:4860:64::7f00:1', true],
    ['well-known private', '64:ff9b::c0a8:132', true],
    ['unknown translator', '2001:4860:64::c0a8:132', false],
  ])('refuses %s NAT64 before any upstream socket', async (_name, address, isKnown) => {
    const lookup = vi.fn(() => Promise.resolve(address))
    const nat64 = vi.fn(() =>
      Promise.resolve(
        isKnown
          ? { isKnown: true as const, prefixes: nat64PrefixesOf(['2001:4860:64::c000:aa']) }
          : { isKnown: false as const, detail: 'fixture' },
      ),
    )
    const proxy = await startCheckProxy(scope(['allowed.example']), lookup, nat64, () =>
      Promise.resolve([]),
    )
    proxies.push(proxy)
    const upstream = await fakeDial(address, () => {
      throw new Error('fixture-upstream-refused')
    })
    const port = Number(new URL(proxy.endpoint).port)
    try {
      for (const head of [
        `GET ${HTTP}//allowed.example/ HTTP/1.1\r\nHost: allowed.example\r\n\r\n`,
        'CONNECT allowed.example:443 HTTP/1.1\r\nHost: allowed.example:443\r\n\r\n',
      ])
        expect(await raw(port, head)).toMatch(/^HTTP\/1\.1 403 /)
      expect(nat64).toHaveBeenCalledTimes(2)
      expect(upstream.dial).not.toHaveBeenCalled()
    } finally {
      upstream.restore()
    }
  })
  it('blocks companion ports before connections, including aliases, tunnels and panels started after the check', async () => {
    const target = await upstream()
    const { port, lookup } = await proxyFor([
      `http://allowed.example:${String(target.port)}`,
      `http://localhost:${String(target.port)}`,
    ])
    const unregister = await registerMakerCompanion([target.port])
    try {
      for (const host of ['127.0.0.1', 'localhost', 'allowed.example']) {
        const authority = `${host}:${String(target.port)}`
        const answer = await raw(
          port,
          `GET http://${authority}/launch HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
        )
        expect(answer).toMatch(/^HTTP\/1\.1 (403|502) /)
        const tunnel = await raw(
          port,
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
        )
        expect(tunnel).toMatch(/^HTTP\/1\.1 (403|502) /)
      }
      expect(target.heads).toEqual([])
      expect(lookup).not.toHaveBeenCalled()
    } finally {
      await unregister()
    }
    expect(
      await raw(
        port,
        `GET http://localhost:${String(target.port)}/ HTTP/1.1\r\nHost: localhost:${String(target.port)}\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 401 /)
  })
  it.each([
    '127.0.0.2',
    '[::1]',
    '0.0.0.0',
    '2130706433',
    '0177.0.0.1',
    '[::ffff:127.0.0.1]',
    '169.254.1.1',
    '10.1.2.3',
    '172.16.1.1',
    '192.168.1.1',
    '[fc00::1]',
  ])('default denies private destination %s in HTTP and CONNECT', async (host) => {
    const { port, seen } = await proxyFor([new URL(`http://${host}/`).hostname])
    const authority = new URL(`http://${host}:3000/`).host
    expect(
      await raw(port, `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(await raw(port, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)).toMatch(
      /^HTTP\/1\.1 403 /,
    )
    expect(seen.every((item) => !item.forwarded)).toBe(true)
  })
  it('refuses a widened DNS name resolving to loopback and a relay on a second port', async () => {
    const target = await upstream()
    const { port, lookup, seen } = await proxyFor(['relay.test'])
    const authority = `relay.test:${String(target.port)}`
    expect(
      await raw(port, `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(lookup).toHaveBeenCalledOnce()
    expect(target.heads).toEqual([])
    expect(seen[0]?.forwarded).toBe(false)
  })
  it('companion origin remains refused even if allowlisted and discovery is erased', async () => {
    const { port, lookup } = await proxyFor(['http://127.0.0.1:47830', 'https://127.0.0.1:47830'])
    const unregister = await registerMakerCompanion([47_830])
    await unregister()
    expect(
      await raw(port, 'GET http://127.0.0.1:47830/ HTTP/1.1\r\nHost: 127.0.0.1:47830\r\n\r\n'),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(
      await raw(port, 'CONNECT 127.0.0.1:47830 HTTP/1.1\r\nHost: 127.0.0.1:47830\r\n\r\n'),
    ).toMatch(/^HTTP\/1\.1 403 /)
    expect(lookup).not.toHaveBeenCalled()
  })
  it('canary allowance is confined to its own nonce path and revoked before page traffic', async () => {
    const target = await upstream()
    const { port, proxy } = await proxyFor()
    const revoke = proxy.allowProbe?.({
      port: target.port,
      nonce: 'private-canary',
      loopbackHosts: ['127.0.0.1'],
    })
    const authority = `127.0.0.1:${String(target.port)}`
    expect(
      await raw(
        port,
        `GET http://${authority}/private-canary/p HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 401 /)
    expect(
      await raw(port, `GET http://${authority}/other HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    ).toMatch(/^HTTP\/1\.1 403 /)
    revoke?.()
    expect(
      await raw(
        port,
        `GET http://${authority}/private-canary/p HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 403 /)
  })
  it('listens on 127.0.0.1 only, at a port the OS picked, with the loopback subtraction as its bypass list', async () => {
    const { proxy } = await proxyFor()
    expect(proxy.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(proxy.bypassList).toBe('<-loopback>')
  })

  it('forwards plain HTTP to loopback reserialized: a canonical Host, closed, no credentials or hop-by-hop fields', async () => {
    const target = await upstream()
    const { port, seen } = await proxyFor([`http://127.0.0.1:${String(target.port)}`])
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
    const target = await upstream()
    const { port, seen, lookup } = await proxyFor([
      `http://localhost:${String(target.port)}`,
      `http://127.0.0.1:${String(target.port)}`,
    ])
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
    const { port, lookup, seen } = await proxyFor([`http://app.test:${String(target.port)}`])
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

  it('refuses private encrypted tunnels even when allowlisted, implicit loopback and the sentinel', async () => {
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

    const widened = await proxyFor([`https://127.0.0.1:${echoPort}`])
    const answer = await raw(
      widened.port,
      `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\nProxy-Authorization: Basic c2VjcmV0\r\n\r\nping`,
      300,
    )
    expect(answer).toMatch(/^HTTP\/1\.1 403 /)
    expect(answer.endsWith('ping')).toBe(false)
    expect(widened.seen).toEqual([
      {
        form: 'connect',
        host: '127.0.0.1',
        port: Number(echoPort),
        forwarded: false,
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

  it('records an admitted CONNECT as admitted when its lookup or its connection then fails, never as a refusal (A1-2)', async () => {
    const nobody = await closedPort()
    const failing = vi.fn((host: string): Promise<string> =>
      host === 'app.test'
        ? Promise.reject(new Error('ENOTFOUND app.test'))
        : Promise.resolve('1.1.1.1'),
    )
    const { port, seen } = await proxyFor(['app.test', 'socket.test'], failing)
    const upstream = await fakeDial('1.1.1.1', () => {
      throw new Error('fixture-connect-failed')
    })
    try {
      expect(
        await raw(port, 'CONNECT app.test:443 HTTP/1.1\r\nHost: app.test:443\r\n\r\n'),
      ).toMatch(/^HTTP\/1\.1 403 /)
      const authority = `socket.test:${nobody}`
      expect(
        await raw(port, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
      ).toMatch(/^HTTP\/1\.1 403 /)
      expect(failing.mock.calls).toEqual([['app.test'], ['socket.test']])
      expect(upstream.dial).toHaveBeenCalledOnce()
      expect(seen).toEqual([
        { form: 'connect', host: 'app.test', port: 443, forwarded: true, challengeStripped: false },
        {
          form: 'connect',
          host: 'socket.test',
          port: Number(nobody),
          forwarded: true,
          challengeStripped: false,
        },
      ])
    } finally {
      upstream.restore()
    }
  })
  it('still tunnels to an approved public address pinned to one lookup, over a local transport fake', async () => {
    const echo = createTcpServer((socket) => {
      socket.pipe(socket)
    })
    const port = await listen(echo)
    const actual = await vi.importActual<typeof net>('node:net')
    const upstream = await fakeDial('1.1.1.1', () => actual.connect({ host: '127.0.0.1', port }))
    const proxy = await proxyFor(
      ['allowed.example'],
      vi.fn(() => Promise.resolve('1.1.1.1')),
    )
    try {
      const authority = `allowed.example:${String(port)}`
      const answer = await raw(
        proxy.port,
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\nping`,
        100,
      )
      expect(answer).toMatch(/^HTTP\/1\.1 200 Connection Established/)
      expect(answer).toMatch(/ping$/)
      expect(proxy.lookup).toHaveBeenCalledOnce()
      expect(upstream.dial).toHaveBeenCalledOnce()
    } finally {
      upstream.restore()
    }
  })

  it('ends an exchange whose upstream answer’s head does not complete within 3 s of its first byte (A1-5)', async () => {
    let isUpstreamClosed = false
    const stalling = createTcpServer((socket) => {
      socket.on('error', () => undefined)
      socket.on('close', () => {
        isUpstreamClosed = true
      })
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Len')
      })
    })
    const stallPort = String(await listen(stalling))
    const { port, seen } = await proxyFor([`http://127.0.0.1:${stallPort}`])
    const started = Date.now()
    // The request's own head is complete: only the answer's bound can end it.
    const answer = await raw(
      port,
      `GET http://127.0.0.1:${stallPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${stallPort}\r\n\r\n`,
      12_000,
    )
    const took = Date.now() - started
    expect(answer).toBe('')
    expect(took).toBeGreaterThanOrEqual(2900)
    expect(took).toBeLessThan(6000)
    await vi.waitFor(() => {
      expect(isUpstreamClosed).toBe(true)
    })
    expect(seen).toEqual([
      {
        form: 'http',
        host: '127.0.0.1',
        port: Number(stallPort),
        forwarded: true,
        challengeStripped: false,
      },
    ])
  }, 20_000)

  it('lets an upstream take its time before its answer starts: the bound is the head’s own', async () => {
    const slow = createServer((request, response) => {
      request.resume()
      setTimeout(() => {
        response.writeHead(200, { 'Content-Length': '2' }).end('ok')
      }, 3500)
    })
    const slowPort = String(await listen(slow))
    const { port } = await proxyFor([`http://127.0.0.1:${slowPort}`])
    const answer = await raw(
      port,
      `GET http://127.0.0.1:${slowPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${slowPort}\r\n\r\n`,
    )
    expect(answer).toMatch(/^HTTP\/1\.1 200 /)
    expect(answer.endsWith('ok')).toBe(true)
  }, 15_000)

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
    const { port } = await proxyFor([`http://127.0.0.1:${rudePort}`])
    const answer = await raw(
      port,
      `GET http://127.0.0.1:${rudePort}/ HTTP/1.1\r\nHost: 127.0.0.1:${rudePort}\r\n\r\n`,
    )
    expect(answer).not.toContain('101')
    expect(answer).not.toContain('raw-bytes')
  })

  it('answers 502 when loopback refuses the connection, and closes every connection with itself', async () => {
    const nobody = await closedPort()
    const { proxy, port, seen } = await proxyFor([`http://127.0.0.1:${nobody}`])
    expect(
      await raw(
        port,
        `GET http://127.0.0.1:${nobody}/ HTTP/1.1\r\nHost: 127.0.0.1:${nobody}\r\n\r\n`,
      ),
    ).toMatch(/^HTTP\/1\.1 502 /)
    expect(seen[0]?.forwarded).toBe(true)

    const held: Socket = connect(port, '127.0.0.1')
    // The proxy's close resets it (ECONNRESET on macOS): that is the point.
    held.on('error', () => undefined)
    await new Promise((resolve) => held.once('connect', resolve))
    const gone = new Promise((resolve) => held.once('close', resolve))
    await proxy.close()
    await gone
    expect(held.destroyed).toBe(true)
  })
})
