// M124 remote (D217): Streamable HTTP, served by the person's own PC. One
// MCP endpoint (`/mcp`) beside the OAuth endpoints on the same origin.
// The protocol revisions are the connector's legacy era (D213): `initialize`
// opens a session named by `Mcp-Session-Id`, and each session is one
// registry under an authority narrowed to its token's scopes. Every request
// re-verifies its bearer token for this one resource before any dispatch
// (MCP authorization 2025-11-25, "Token Handling"); the token is read from
// the Authorization header only, never from the query string. The server
// sends nothing of its own accord, so it offers no event stream: GET
// answers 405, as the transport chapter provides. Host and Origin are
// validated on every request (the chapter's DNS-rebinding rule). It listens
// where the person said and nowhere else: loopback unless they asked for a
// wider address, and plain HTTP only behind their own tunnel on loopback.
import { randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import {
  CONNECTOR_LIMITS,
  CONNECTOR_PROTOCOL_VERSIONS,
  CONNECTOR_REMOTE_PATHS,
  CONNECTOR_RPC_ERRORS,
  HTTP_STATUS,
  JSON_RPC_ERRORS,
} from '../../shared/constants'
import { messageSchema } from '../../core/mcp'
import { ConnectorProtocol } from '../../core/connector/protocol'
import type { AuthorityPort, ConnectorRegistry } from '../../core/connector/registry'
import type { ConnectorScope } from '../../shared/connector'
import { listenHttpServer } from '../httpServer'
import type { ConnectorRegistryHost } from './registryHost'
import { scopedAuthority } from './registryHost'
import type { ConnectorOAuth } from './oauth/server'

export interface ConnectorHttpOptions {
  /** The exact interface address to bind; loopback unless the person asked for more. */
  readonly host: string
  readonly port: number
  /** The person's own certificate; absent only behind their tunnel, which ends TLS. */
  readonly tls: { readonly cert: string; readonly key: string } | undefined
  /** The public origin clients use; its hostname is an allowed Host. */
  readonly issuer: string
  readonly oauth: ConnectorOAuth
  readonly registries: ConnectorRegistryHost
  readonly authority: AuthorityPort
  /** Told the failure of a request that went wrong inside; the request is answered 500. */
  readonly onError: (error: unknown) => void
}

export interface ConnectorHttpServer {
  /** The bound port (the requested one, or the chosen one when 0 was asked). */
  readonly port: number
  readonly close: () => Promise<void>
}

interface Session {
  readonly protocol: ConnectorProtocol
  readonly registry: ConnectorRegistry
  readonly clientId: string
  readonly holder: { scopes: readonly ConnectorScope[] }
}

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost']
const SESSION_HEADER = 'mcp-session-id'
const VERSION_HEADER = 'mcp-protocol-version'
const JSON_TYPE = 'application/json'
/** The revision a server assumes for a request that names none (transports, "Protocol Version Header"). */
const UNVERSIONED_ASSUMED = '2025-03-26'
const BEARER = /^Bearer[ \t]+([!-~]+)$/iu

/** A Host header is a host and an optional port, nothing else (no userinfo, path or space). */
const HOST_HEADER = /^[A-Za-z0-9.\-[\]:]+$/u

function hostnameOf(header: string | undefined): string | undefined {
  if (header === undefined || !HOST_HEADER.test(header)) return undefined
  const candidate = `https://${header}`
  return URL.canParse(candidate)
    ? new URL(candidate).hostname.replaceAll(/^\[|\]$/gu, '')
    : undefined
}

function singleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

/** The whole body as text, or undefined when it passed the bound. */
async function readBody(request: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > maxBytes) return undefined
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function send(
  response: ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string,
): void {
  response.writeHead(status, headers)
  response.end(body)
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  send(
    response,
    status,
    { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...headers },
    JSON.stringify(value),
  )
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

export async function startConnectorHttp(
  options: ConnectorHttpOptions,
): Promise<ConnectorHttpServer> {
  const issuerHost = new URL(options.issuer).hostname.replaceAll(/^\[|\]$/gu, '')
  const allowedHosts = new Set<string>([issuerHost, ...LOOPBACK_HOSTS])
  if (options.host !== '0.0.0.0' && options.host !== '::') allowedHosts.add(options.host)
  const supported: readonly string[] = CONNECTOR_PROTOCOL_VERSIONS
  const sessions = new Map<string, Session>()
  let isClosing = false

  const dropSession = (id: string): void => {
    const session = sessions.get(id)
    if (session === undefined) return
    sessions.delete(id)
    session.protocol.close()
    void options.registries.release(session.registry)
  }

  /** Origin is present only from a browser; it must name a host this server answers to. */
  const isOriginAllowed = (request: IncomingMessage): boolean => {
    const origin = singleHeader(request, 'origin')
    return (
      origin === undefined ||
      (URL.canParse(origin) &&
        allowedHosts.has(new URL(origin).hostname.replaceAll(/^\[|\]$/gu, '')))
    )
  }

  const refuseToken = (response: ServerResponse, isInvalid: boolean): void => {
    send(
      response,
      HTTP_STATUS.unauthorized,
      {
        'content-type': JSON_TYPE,
        'cache-control': 'no-store',
        'www-authenticate': options.oauth.challenge(isInvalid),
      },
      JSON.stringify(rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'Unauthorized')),
    )
  }

  const handleMcp = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? ''
    if (method !== 'POST' && method !== 'DELETE') {
      // No event stream is offered (transports, "Listening for Messages from the Server").
      sendJson(
        response,
        HTTP_STATUS.methodNotAllowed,
        rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'Method not allowed'),
        { allow: 'POST, DELETE' },
      )
      return
    }
    const header = singleHeader(request, 'authorization')
    const token = header === undefined ? undefined : BEARER.exec(header)?.[1]
    const verified = token === undefined ? undefined : await options.oauth.verifyAccessToken(token)
    if (verified === undefined) {
      refuseToken(response, token !== undefined)
      return
    }
    const sessionId = singleHeader(request, SESSION_HEADER)
    const known = sessionId === undefined ? undefined : sessions.get(sessionId)
    const session = known?.clientId === verified.clientId ? known : undefined
    if (method === 'DELETE') {
      if (sessionId === undefined || session === undefined) {
        sendJson(
          response,
          HTTP_STATUS.notFound,
          rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'Session not found'),
        )
        return
      }
      dropSession(sessionId)
      send(response, HTTP_STATUS.ok, { 'cache-control': 'no-store' }, '')
      return
    }
    const contentType = (singleHeader(request, 'content-type') ?? '').split(';', 1)[0]?.trim()
    if (contentType !== JSON_TYPE) {
      sendJson(
        response,
        HTTP_STATUS.unsupportedMediaType,
        rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'Unsupported content type'),
      )
      return
    }
    const version = singleHeader(request, VERSION_HEADER) ?? UNVERSIONED_ASSUMED
    if (!supported.includes(version)) {
      // A legacy-only server's refusal; a dual-era client then falls back to `initialize` (D213).
      sendJson(
        response,
        HTTP_STATUS.badRequest,
        rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'Unsupported protocol version'),
      )
      return
    }
    const body = await readBody(request, CONNECTOR_LIMITS.frameBytes)
    if (body === undefined) {
      sendJson(
        response,
        HTTP_STATUS.requestTooLarge,
        rpcError(null, CONNECTOR_RPC_ERRORS.requestTooLarge, 'Request too large'),
      )
      return
    }
    let rpcMethod: string | undefined
    let id: unknown
    try {
      const parsed = messageSchema.safeParse(JSON.parse(body))
      if (parsed.success) {
        rpcMethod = parsed.data.method
        id = parsed.data.id
      }
    } catch (error: unknown) {
      // Not JSON: the protocol answers the parse error itself, with its receipt.
      if (!(error instanceof SyntaxError)) throw error
    }
    if (rpcMethod === 'initialize') {
      const holder: Session['holder'] = { scopes: verified.scopes }
      const registry = options.registries.create(
        scopedAuthority(options.authority, () => holder.scopes),
      )
      const protocol = new ConnectorProtocol(registry)
      const newId = randomUUID()
      sessions.set(newId, { protocol, registry, clientId: verified.clientId, holder })
      const reply = await protocol.handle(body)
      send(
        response,
        reply === undefined ? HTTP_STATUS.accepted : HTTP_STATUS.ok,
        { 'content-type': JSON_TYPE, 'cache-control': 'no-store', [SESSION_HEADER]: newId },
        reply === undefined ? '' : JSON.stringify(reply),
      )
      return
    }
    if (sessionId === undefined) {
      sendJson(
        response,
        HTTP_STATUS.badRequest,
        rpcError(id, JSON_RPC_ERRORS.invalidRequest, 'Session required'),
      )
      return
    }
    if (session === undefined) {
      // Unknown, ended, or another client's: the client starts a new session.
      sendJson(
        response,
        HTTP_STATUS.notFound,
        rpcError(id, JSON_RPC_ERRORS.invalidRequest, 'Session not found'),
      )
      return
    }
    // A later token can only narrow the session's authority, never widen it.
    session.holder.scopes = session.holder.scopes.filter((scope) => verified.scopes.includes(scope))
    const reply = await session.protocol.handle(body)
    send(
      response,
      reply === undefined ? HTTP_STATUS.accepted : HTTP_STATUS.ok,
      { 'content-type': JSON_TYPE, 'cache-control': 'no-store' },
      reply === undefined ? '' : JSON.stringify(reply),
    )
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const host = hostnameOf(singleHeader(request, 'host'))
    if (host === undefined || !allowedHosts.has(host) || !isOriginAllowed(request)) {
      sendJson(response, HTTP_STATUS.forbidden, { error: 'forbidden' })
      return
    }
    const pathname = new URL(request.url ?? '/', options.issuer).pathname
    if (options.oauth.handles(pathname)) {
      await options.oauth.handle(request, response)
      return
    }
    if (pathname === CONNECTOR_REMOTE_PATHS.mcp) {
      await handleMcp(request, response)
      return
    }
    sendJson(response, HTTP_STATUS.notFound, { error: 'not_found' })
  }

  const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
    void handle(request, response).catch((error: unknown) => {
      options.onError(error)
      if (response.headersSent) response.destroy()
      else sendJson(response, HTTP_STATUS.internalServerError, { error: 'internal' })
    })
  }
  const server: Server =
    options.tls === undefined
      ? createHttpServer(onRequest)
      : createHttpsServer(
          { cert: options.tls.cert, key: options.tls.key, minVersion: 'TLSv1.2' },
          onRequest,
        )
  server.requestTimeout = CONNECTOR_LIMITS.requestDeadlineMs
  server.headersTimeout = CONNECTOR_LIMITS.requestDeadlineMs
  const address = await listenHttpServer(server, options.host, options.port, 'ECONNECTORHTTP')
  return {
    port: address.port,
    close: async () => {
      if (isClosing) return
      isClosing = true
      for (const id of sessions.keys()) dropSession(id)
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      })
    },
  }
}
