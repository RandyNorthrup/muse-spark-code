// Every upstream connection is pinned to one resolved address. Private addresses
// require an exact dev origin; companion ports are never allowed.

import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { connect, isIPv4, isIPv6, type Socket } from 'node:net'
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
import { isMakerCompanionPort, isExplicitDevOrigin, isMachineBrowserUrl } from './browserPolicy'
import {
  BROWSER_MACHINE_PORTS,
  BROWSER_MACHINE_UI,
  BROWSER_DEV_HTML_MAX_BYTES,
} from '../../shared/constants'
import { isPublicAddress } from '../publicAddress'
import type { Nat64Discovery } from '../web/webFetch'
import * as z from 'zod/mini'
import type { PhaseFixture } from './canaries'
import { listen } from './canaries'
import { makerCompanionPorts } from '../maker/companionRegistry'

/** What a check may reach, frozen when the user approved it. */
export interface FrozenScope {
  readonly url: string
  /** Public widened hosts and confirmed user-level dev origins, as browserPolicy writes them. */
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
  /** Trusted canary controller only, exact nonce path, revoked before page traffic. */
  allowProbe?(target: Pick<PhaseFixture, 'port' | 'nonce' | 'loopbackHosts'>): () => void
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
  readonly scheme: 'http:' | 'https:'
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
  'accept-encoding',
])
const CHALLENGES: ReadonlySet<string> = new Set(['www-authenticate', 'proxy-authenticate'])
const NOMINATING: ReadonlySet<string> = new Set(['connection', 'proxy-connection'])

class DestinationDenied extends Error {}

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
  } catch (error) {
    // The URL parser answers a malformed destination with a TypeError;
    // anything else is not the destination and reaches the caller.
    if (!(error instanceof TypeError)) throw error
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
    : {
        host: url.hostname,
        port,
        authority: url.host,
        path: `${url.pathname}${url.search}`,
        scheme: 'http:',
      }
}

/** A CONNECT's destination: an authority only, `host:port`, written canonically. */
function connectDestination(request: IncomingMessage): Destination | undefined {
  const raw = request.url ?? ''
  let url: URL
  try {
    url = new URL(`${HTTP_PREFIX}${raw}/`)
  } catch (error) {
    // The URL parser answers a malformed authority with a TypeError;
    // anything else is not the authority and reaches the caller.
    if (!(error instanceof TypeError)) throw error
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
    : { host: url.hostname, port, authority: raw, path: '', scheme: 'https:' }
}

/**
A head's fields as passed on, either way: no hop-by-hop field, none a
Connection field nominates, no credential and no sign-in challenge; then
`Connection: close`. Whether a challenge was taken out.
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
Starts the check's proxy on 127.0.0.1, ready before the browser is
spawned. Its listener and every connection close with `close()`.
*/
export async function startCheckProxy(
  scope: FrozenScope,
  lookupName: ProxyLookup = NODE_LOOKUP,
  nat64: () => Promise<Nat64Discovery> = () =>
    Promise.resolve({ isKnown: false, detail: 'no-discovery' }),
  registeredMachines?: () => Promise<readonly string[]>,
): Promise<CheckProxy> {
  const explicit = new Set(scope.explicitHosts.filter((host) => host !== BROWSER_AUTH_SENTINEL))
  const probes = new Set<Pick<PhaseFixture, 'port' | 'nonce' | 'loopbackHosts'>>()
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
    const address = await lookupName(host)
    return [isIPv6(address) ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address]
  }
  const connectFirst = async (destination: Destination): Promise<Socket> => {
    const { host, port } = destination
    const url = new URL(`${destination.scheme}//${destination.authority}/`)
    const isDev =
      isExplicitDevOrigin(url, explicit) ||
      (destination.path === '' &&
        isExplicitDevOrigin(new URL(`http://${destination.authority}/`), explicit))
    const isProbe =
      destination.scheme === 'http:' &&
      [...probes].some(
        (target) =>
          target.port === port &&
          target.loopbackHosts.includes(host) &&
          destination.path.startsWith(`/${target.nonce}/`),
      )
    let blockedAddresses: readonly string[] = []
    if (!isProbe) {
      if (
        registeredMachines === undefined ||
        isMachineBrowserUrl(new URL(destination.path || '/', url))
      )
        throw new DestinationDenied('browser-machine-origin-denied')
      const endpoints = await registeredMachines()
      const hosts = endpoints.map((endpoint) => new URL(endpoint).hostname)
      if (hosts.includes(host)) throw new DestinationDenied('browser-registered-machine-denied')
      const resolved = await Promise.all(
        hosts.map(async (machineHost) => await addressesOf(machineHost)),
      )
      blockedAddresses = resolved.flat()
    }
    // Re-read before every upstream connection, including redirects and newly started panels.
    const deniedPorts = await makerCompanionPorts()
    if (isMakerCompanionPort(port) || deniedPorts.has(port))
      throw new DestinationDenied('maker-companion-navigation-denied')
    let last: unknown = new Error('no address')
    const addresses = await addressesOf(host)
    const translation =
      !isProbe && addresses.some((address) => isIPv6(address))
        ? await nat64()
        : { isKnown: true as const, prefixes: [] }
    for (const address of addresses) {
      if (!isProbe && blockedAddresses.includes(address))
        throw new DestinationDenied('browser-registered-machine-denied')
      if (
        !isProbe &&
        translation.isKnown &&
        !isPublicAddress(address, translation.prefixes) &&
        (BROWSER_MACHINE_PORTS.has(port) || destination.scheme === 'https:')
      )
        throw new DestinationDenied('browser-machine-ui-denied')
      if (
        !isProbe &&
        ((!translation.isKnown && isIPv6(address)) ||
          (!isDev && !isPublicAddress(address, translation.isKnown ? translation.prefixes : [])))
      )
        throw new DestinationDenied('browser-private-address-denied')
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
    const isProbe = [...probes].some(
      (target) =>
        target.port === destination.port &&
        target.loopbackHosts.includes(destination.host) &&
        destination.path.startsWith(`/${target.nonce}/`),
    )
    const isDev = isExplicitDevOrigin(new URL(`http://${destination.authority}/`), explicit)
    if (!isProbe && !isDev && !explicit.has(destination.host)) {
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
    } catch (error) {
      note('http', destination, !(error instanceof DestinationDenied))
      response
        .writeHead(error instanceof DestinationDenied ? STATUS_FORBIDDEN : STATUS_BAD_GATEWAY, {
          'Content-Length': '0',
        })
        .end()
      request.resume()
      return
    }
    const upstream = httpRequest({
      createConnection: () => socket,
      method: request.method,
      path: destination.path,
      headers: [
        ...cleanHead(request.rawHeaders).head,
        'Host',
        destination.authority,
        'Accept-Encoding',
        'identity',
      ],
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
      if (
        answer.headers['content-type']?.toLowerCase().includes('html') === true ||
        ['document', 'iframe', 'frame'].includes(
          request.headers['sec-fetch-dest']?.toString() ?? '',
        )
      ) {
        void (async () => {
          const chunks: Buffer[] = []
          let bytes = 0
          for await (const raw of answer) {
            const chunk = z.instanceof(Buffer).parse(raw)
            bytes += chunk.length
            if (bytes > BROWSER_DEV_HTML_MAX_BYTES) throw new DestinationDenied('browser-html-size')
            chunks.push(chunk)
          }
          const page = Buffer.concat(chunks)
          if (
            answer.headers['content-encoding'] !== undefined ||
            BROWSER_MACHINE_UI.test(page.toString('utf8'))
          )
            throw new DestinationDenied('browser-machine-ui-denied')
          note('http', destination, true, stripped)
          response.writeHead(status, head).end(page)
        })().catch(() => {
          answer.destroy()
          note('http', destination, false)
          response.writeHead(STATUS_FORBIDDEN, { 'Content-Length': '0' }).end()
        })
        return
      }
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
    if (
      destination === undefined ||
      (!explicit.has(destination.host) &&
        !isExplicitDevOrigin(new URL(`https://${destination.authority}/`), explicit) &&
        !isExplicitDevOrigin(new URL(`http://${destination.authority}/`), explicit))
    ) {
      if (destination !== undefined) {
        note('connect', destination, false)
      }
      client.end(DENIED)
      return
    }
    void tunnel(client, head, destination)
  }

  const tunnel = async (client: Duplex, head: Buffer, destination: Destination): Promise<void> => {
    let upstream: Socket
    try {
      upstream = await connectFirst(destination)
    } catch (error) {
      note('connect', destination, !(error instanceof DestinationDenied))
      client.end(DENIED)
      return
    }
    note('connect', destination, true)
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
    allowProbe: (target) => {
      probes.add(target)
      return () => {
        probes.delete(target)
      }
    },
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
