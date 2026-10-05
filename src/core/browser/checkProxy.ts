// The browser check's own proxy (M81 A1, design spec v4 §3.2): the
// enforcing boundary. One per check, on 127.0.0.1 at a port the OS picks;
// the browser sends everything to it (`--proxy-server`, `<-loopback>`, and
// the same proxy on the private browser context), loopback included, and
// a network-service restart returns to it, since it is the command line's.
//
// - Plain absolute-form HTTP goes on to `localhost`, 127.0.0.0/8, `[::1]`
//   or a host the user explicitly widened; anything else is refused with a
//   fixed 403 before any lookup or connection.
// - CONNECT goes on only to an explicitly widened host: implicit loopback
//   never tunnels (an HTTPS or WebSocket page on loopback needs its host
//   widened). The reserved auth sentinel is never a destination.
// - Every request is parsed strictly (Node's parser), reserialized with a
//   canonical Host and `Connection: close`, its hop-by-hop fields and the
//   fields they nominate dropped, and Authorization and
//   Proxy-Authorization never forwarded. Every response loses every
//   WWW-Authenticate and Proxy-Authenticate field (duplicates, any case);
//   its trailers and informational heads are never relayed, so a sign-in
//   challenge cannot reach the browser over plain HTTP.
// - Heads are bounded (16 KiB; a request head within 3 s, an upstream
//   answer's head within 3 s of its first byte), connections too (64), and
//   bodies stream with backpressure; the check's deadline bounds the rest.
//   The proxy never answers 407 and never sends a credential.
// - `localhost` connects to fixed loopback literals; a numeric host
//   connects as written; a widened name is looked up once, after approval,
//   and that answer is connected without a second lookup.
//
// Observations (form, host, port, forwarded, challenge stripped) are for
// the check's canaries only: no path, query, header, body or raw error.
// `forwarded: false` is a refusal before any lookup or connection, and only
// that: an admitted destination is recorded as forwarded even when its
// lookup or connection then fails. Opaque tunnels to widened hosts are not
// inspected (spec §3.4).

import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { connect, isIPv4, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  BROWSER_AUTH_SENTINEL,
  BROWSER_LOCALHOST_ADDRESSES,
  BROWSER_PROXY_BYPASS,
  BROWSER_PROXY_CHECK_INTERVAL_MS,
  BROWSER_PROXY_HEAD_MAX_BYTES,
  BROWSER_PROXY_HEAD_TIMEOUT_MS,
  BROWSER_PROXY_HOST,
  BROWSER_PROXY_MAX_CONNECTIONS,
} from '../../shared/browserCheckConstants'
import { isLoopbackHost } from './browserPolicy'
import { listen } from './canaries'

/** What a check may reach, frozen when the user approved it. */
export interface FrozenScope {
  readonly url: string
  /** Hosts the user explicitly widened, as `browserPolicy` writes them; loopback is implicit. */
  readonly explicitHosts: readonly string[]
  readonly approvalKey: string
}

export type ProxyForm = 'http' | 'connect'

export interface ProxyObservation {
  readonly form: ProxyForm
  readonly host: string
  readonly port: number
  /** Admitted and tried; false only for a refusal before any lookup or connection. */
  readonly forwarded: boolean
  readonly challengeStripped: boolean
}

export interface CheckProxy {
  /** `http://127.0.0.1:<port>`: trusted host data, never the model's. */
  readonly endpoint: string
  readonly bypassList: typeof BROWSER_PROXY_BYPASS
  observe(listener: (record: ProxyObservation) => void): () => void
  /** Closes the listener and every connection it made or accepted. */
  close(): Promise<void>
}

/** One lookup of an approved name: the address its first answer gives (tests replace it). */
export type ProxyLookup = (host: string) => Promise<string>

interface Destination {
  readonly host: string
  readonly port: number
  /** `host[:port]` as the canonical URL writes it, for the Host field. */
  readonly authority: string
  readonly path: string
}

const HTTP_PREFIX = 'http://'
const DENIED = 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
const TUNNEL_OPEN = 'HTTP/1.1 200 Connection Established\r\n\r\n'
const MAX_PORT = 65_535
const HTTP_PORT = 80
const STATUS_FORBIDDEN = 403
const STATUS_BAD_GATEWAY = 502
const STATUS_FIRST_FINAL = 200
// Never forwarded either way; and whatever a Connection field nominates.
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'proxy-connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'http2-settings',
  'authorization',
  'proxy-authorization',
])
const CHALLENGES: ReadonlySet<string> = new Set(['www-authenticate', 'proxy-authenticate'])
const NOMINATING: ReadonlySet<string> = new Set(['connection', 'proxy-connection'])

function ignore(): void {
  // A socket that already failed has nothing more to say.
}

/** A port as a URL gives it, or the scheme's default; undefined outside 1–65535. */
function portOf(url: URL): number | undefined {
  const port = url.port === '' ? HTTP_PORT : Number(url.port)
  return Number.isSafeInteger(port) && port >= 1 && port <= MAX_PORT ? port : undefined
}

/** The fields of a raw head, in pairs, with the names a Connection field nominates. */
function headPairs(raw: readonly string[]): {
  readonly pairs: readonly (readonly [string, string])[]
  readonly nominated: ReadonlySet<string>
} {
  const pairs: [string, string][] = []
  const nominated = new Set<string>()
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index] ?? ''
    const value = raw[index + 1] ?? ''
    pairs.push([name, value])
    if (NOMINATING.has(name.toLowerCase())) {
      for (const token of value.split(',')) {
        nominated.add(token.trim().toLowerCase())
      }
    }
  }
  return { pairs, nominated }
}

/** An ordinary proxy request's destination: absolute-form `http:` only, one matching Host. */
function httpDestination(request: IncomingMessage): Destination | undefined {
  const raw = request.url ?? ''
  if (!raw.startsWith(HTTP_PREFIX) || raw.includes('#')) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  const sent = raw.slice(HTTP_PREFIX.length).split(/[/?]/, 1)[0]
  const port = portOf(url)
  const hosts = headPairs(request.rawHeaders).pairs.filter(
    ([name]) => name.toLowerCase() === 'host',
  )
  return port === undefined ||
    url.protocol !== 'http:' ||
    url.username !== '' ||
    url.password !== '' ||
    sent !== url.host ||
    hosts.length !== 1 ||
    hosts[0]?.[1].toLowerCase() !== url.host
    ? undefined
    : { host: url.hostname, port, authority: url.host, path: `${url.pathname}${url.search}` }
}

/** A CONNECT's destination: an authority only, `host:port`, written canonically. */
function connectDestination(request: IncomingMessage): Destination | undefined {
  const raw = request.url ?? ''
  let url: URL
  try {
    url = new URL(`${HTTP_PREFIX}${raw}/`)
  } catch {
    return undefined
  }
  const port = portOf(url)
  return port === undefined ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    `${url.hostname}:${String(port)}` !== raw
    ? undefined
    : { host: url.hostname, port, authority: raw, path: '' }
}

/**
 * A head's fields as passed on, either way: no hop-by-hop field, none a
 * Connection field nominates, no credential and no sign-in challenge; then
 * `Connection: close`. Whether a challenge was taken out.
 */
function cleanHead(raw: readonly string[]): {
  readonly head: string[]
  readonly stripped: boolean
} {
  const { pairs, nominated } = headPairs(raw)
  const head: string[] = []
  let isStripped = false
  for (const [name, value] of pairs) {
    const lower = name.toLowerCase()
    if (CHALLENGES.has(lower)) {
      isStripped = true
    } else if (!HOP_BY_HOP.has(lower) && !nominated.has(lower)) {
      head.push(name, value)
    }
  }
  head.push('Connection', 'close')
  return { head, stripped: isStripped }
}

const NODE_LOOKUP: ProxyLookup = async (host) => {
  const { address } = await lookup(host)
  return address
}

/**
 * Starts the check's proxy on 127.0.0.1, ready before the browser is
 * spawned. Its listener and every connection close with `close()`.
 */
export async function startCheckProxy(
  scope: FrozenScope,
  lookupName: ProxyLookup = NODE_LOOKUP,
): Promise<CheckProxy> {
  const explicit = new Set(scope.explicitHosts.filter((host) => host !== BROWSER_AUTH_SENTINEL))
  const listeners = new Set<(record: ProxyObservation) => void>()
  const sockets = new Set<Duplex>()
  let isClosed = false
  const track = (socket: Duplex): void => {
    if (isClosed) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', ignore)
  }
  const note = (
    form: ProxyForm,
    { host, port }: Destination,
    isForwarded: boolean,
    isChallengeStripped = false,
  ): void => {
    for (const listener of listeners) {
      listener({
        form,
        host,
        port,
        forwarded: isForwarded,
        challengeStripped: isChallengeStripped,
      })
    }
  }
  const addressesOf = async (host: string): Promise<readonly string[]> => {
    if (host === 'localhost') {
      return BROWSER_LOCALHOST_ADDRESSES
    }
    if (isIPv4(host)) {
      return [host]
    }
    if (host.startsWith('[')) {
      return [host.slice(1, -1)]
    }
    // An explicitly widened name, approved before this lookup: one answer.
    return [await lookupName(host)]
  }
  const connectFirst = async ({ host, port }: Destination): Promise<Socket> => {
    let last: unknown = new Error('no address')
    const addresses = await addressesOf(host)
    for (const address of addresses) {
      try {
        return await new Promise<Socket>((resolve, reject) => {
          const socket = connect({ host: address, port })
          track(socket)
          socket.once('connect', () => {
            resolve(socket)
          })
          socket.once('error', (error) => {
            socket.destroy()
            reject(error)
          })
        })
      } catch (error: unknown) {
        last = error
      }
    }
    throw last
  }

  const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
    response.shouldKeepAlive = false
    const destination = httpDestination(request)
    if (destination === undefined) {
      response.writeHead(STATUS_FORBIDDEN, { 'Content-Length': '0' }).end()
      return
    }
    if (!isLoopbackHost(destination.host) && !explicit.has(destination.host)) {
      note('http', destination, false)
      response.writeHead(STATUS_FORBIDDEN, { 'Content-Length': '0' }).end()
      request.resume()
      return
    }
    void forward(request, response, destination)
  }

  const forward = async (
    request: IncomingMessage,
    response: ServerResponse,
    destination: Destination,
  ): Promise<void> => {
    let socket: Socket
    try {
      socket = await connectFirst(destination)
    } catch {
      note('http', destination, true)
      response.writeHead(STATUS_BAD_GATEWAY, { 'Content-Length': '0' }).end()
      request.resume()
      return
    }
    const upstream = httpRequest({
      createConnection: () => socket,
      method: request.method,
      path: destination.path,
      headers: [...cleanHead(request.rawHeaders).head, 'Host', destination.authority],
      setHost: false,
      maxHeaderSize: BROWSER_PROXY_HEAD_MAX_BYTES,
    })
    // The answer's final head completes within 3 s of its first byte, or the
    // exchange ends both ways (a server may take its time to start answering;
    // the check's deadline bounds that).
    let headTimer: ReturnType<typeof setTimeout> | undefined
    let isHeadDone = false
    let isExpired = false
    const headDone = (): void => {
      isHeadDone = true
      clearTimeout(headTimer)
    }
    upstream.once('socket', (used) => {
      used.once('data', () => {
        if (!isHeadDone) {
          headTimer = setTimeout(() => {
            isExpired = true
            note('http', destination, true)
            response.destroy()
            upstream.destroy()
          }, BROWSER_PROXY_HEAD_TIMEOUT_MS)
        }
      })
    })
    upstream.once('close', headDone)
    upstream.on('error', () => {
      if (isExpired || response.headersSent) {
        response.destroy()
        return
      }
      note('http', destination, true)
      response.writeHead(STATUS_BAD_GATEWAY, { 'Content-Length': '0' }).end()
    })
    // A switch of protocols is never relayed or tunnelled.
    upstream.on('upgrade', (_answer, upgraded: Duplex) => {
      upgraded.destroy()
      response.destroy()
    })
    upstream.on('response', (answer) => {
      headDone()
      const status = answer.statusCode ?? 0
      if (status < STATUS_FIRST_FINAL) {
        answer.destroy()
        response.destroy()
        return
      }
      const { head, stripped } = cleanHead(answer.rawHeaders)
      note('http', destination, true, stripped)
      response.writeHead(status, head)
      answer.pipe(response)
      answer.on('error', () => response.destroy())
    })
    response.on('close', () => upstream.destroy())
    request.pipe(upstream)
  }

  const onConnect = (request: IncomingMessage, client: Duplex, head: Buffer): void => {
    track(client)
    const destination = connectDestination(request)
    if (destination === undefined || !explicit.has(destination.host)) {
      if (destination !== undefined) {
        note('connect', destination, false)
      }
      client.end(DENIED)
      return
    }
    // Admitted, so recorded as such before any lookup: one that then fails
    // is never a refusal.
    note('connect', destination, true)
    void tunnel(client, head, destination)
  }

  const tunnel = async (client: Duplex, head: Buffer, destination: Destination): Promise<void> => {
    let upstream: Socket
    try {
      upstream = await connectFirst(destination)
    } catch {
      client.end(DENIED)
      return
    }
    client.write(TUNNEL_OPEN)
    if (head.length > 0) {
      upstream.write(head)
    }
    client.pipe(upstream)
    upstream.pipe(client)
    upstream.once('close', () => client.destroy())
    client.once('close', () => upstream.destroy())
  }

  const server = createServer(
    {
      maxHeaderSize: BROWSER_PROXY_HEAD_MAX_BYTES,
      headersTimeout: BROWSER_PROXY_HEAD_TIMEOUT_MS,
      requestTimeout: 0,
      connectionsCheckingInterval: BROWSER_PROXY_CHECK_INTERVAL_MS,
      keepAlive: false,
    },
    onRequest,
  )
  server.maxConnections = BROWSER_PROXY_MAX_CONNECTIONS
  server.on('connection', (socket: Socket) => {
    track(socket)
  })
  server.on('connect', onConnect)
  // An Upgrade on an ordinary request is never supported.
  server.on('upgrade', (_request: IncomingMessage, socket: Duplex) => {
    socket.end(DENIED)
  })
  // Oversize, slow or invalid heads: the connection closes.
  server.on('clientError', (_error, socket: Duplex) => {
    socket.destroy()
  })
  const port = await listen(server, 0, BROWSER_PROXY_HOST)
  return {
    endpoint: `${HTTP_PREFIX}${BROWSER_PROXY_HOST}:${String(port)}`,
    bypassList: BROWSER_PROXY_BYPASS,
    observe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close: async () => {
      if (isClosed) {
        return
      }
      isClosed = true
      listeners.clear()
      const closed = new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      for (const socket of sockets) {
        socket.destroy()
      }
      sockets.clear()
      await closed
    },
  }
}
