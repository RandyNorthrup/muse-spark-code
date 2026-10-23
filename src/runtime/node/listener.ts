import { X509Certificate } from 'node:crypto'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import {
  NODE_HTTP_BODY_BYTES,
  NODE_HTTP_HEADER_BYTES,
  NODE_HTTP_MAX_HEADERS,
  NODE_HTTP_STATUS,
  NODE_HTTP_TIMEOUT_MS,
  NODE_LISTENER_MAX_CONNECTIONS,
  NODE_LISTENER_SOURCE_CONNECTIONS,
  NODE_MAX_AUTH_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { nodeConfigSchema, type NodeConfig, type NodeClock } from '../../shared/node'
import { nodeDigestSchema } from '../../shared/nodeAuth'
import { nodeMethods } from '../../shared/hostApi/nodeMethods'
import { NodePrivateFiles } from './privateFiles'
import {
  guardNodeRequest,
  nodeAuthenticate,
  nodeHeader,
  NodeListenerAdmission,
  NodeListenerError,
  type NodeListenerVerifier,
} from './listenerGuard'
import { dispatchNodeMethod, nodeRoute, type NodeListenerMethodFactory } from './listenerMethods'
import { upgradeNodeTerminal, type NodeTerminalSubscription } from './listenerSocket'

export interface NodeListenerOptions {
  readonly config: NodeConfig
  readonly ownerId: string
  readonly clock: NodeClock
  /** A1/S0-issued leaf and key in the private service root, with out-of-band pin. */
  readonly tls: {
    root: string
    certificateFile: string
    privateKeyFile: string
    fingerprint: string
  }
  readonly verifier?: NodeListenerVerifier
  readonly methods: NodeListenerMethodFactory
  readonly terminal?: NodeTerminalSubscription
  /** Console/TUI binding must show this complete line, never a shortened pin. */
  readonly print: (line: string) => void
}

function refuse(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const code = error instanceof NodeListenerError ? error.code : 'unavailable'
  response.writeHead(NODE_HTTP_STATUS[code], {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Connection: 'close',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify({ code }))
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (
    !['application/json', 'application/json; charset=utf-8'].includes(
      nodeHeader(request, 'content-type') ?? '',
    ) ||
    nodeHeader(request, 'content-encoding') !== undefined
  )
    throw new NodeListenerError('invalidRequest')
  const length = nodeHeader(request, 'content-length')
  if (length !== undefined && (Number(length) > NODE_HTTP_BODY_BYTES || !/^\d+$/u.test(length)))
    throw new NodeListenerError('tooLarge')
  const parts: Buffer[] = []
  let bytes = 0
  for await (const part of request) {
    // Node may emit text if an adapter changed encoding; account for its UTF8 bytes.
    if (typeof part !== 'string' && !(part instanceof Buffer))
      throw new NodeListenerError('invalidRequest')
    const buffer = Buffer.from(part)
    bytes += buffer.length
    if (bytes > NODE_HTTP_BODY_BYTES) throw new NodeListenerError('tooLarge')
    parts.push(buffer)
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)),
    )
    return value
  } catch (error: unknown) {
    // Only the decoders throw here: malformed JSON or non-UTF-8 bytes.
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error
    throw new NodeListenerError('invalidRequest', { cause: error })
  }
}

/** One opt-in HTTPS listener. No HTTP server, redirects, cookies or CORS. */
export class NodeListener {
  private server: Server | undefined
  private starting = false
  private readonly lifetime = new AbortController()
  private readonly sockets = new Set<Socket>()
  private readonly sources = new Map<string, number>()
  private readonly config: NodeConfig
  private readonly admission: NodeListenerAdmission

  constructor(private readonly options: NodeListenerOptions) {
    this.config = nodeConfigSchema.parse(options.config)
    this.admission = new NodeListenerAdmission(() => options.clock.monotonicMs())
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let release: ((hasFailed: boolean, hasAuthenticated: boolean) => void) | undefined
    let isFailed = true
    let hasAuthenticated = false
    const pending = new AbortController()
    const timeout = setTimeout(() => {
      pending.abort()
      response.destroy()
    }, NODE_HTTP_TIMEOUT_MS)
    let signal = AbortSignal.any([pending.signal, this.lifetime.signal])
    response.once('close', () => {
      pending.abort()
    })
    try {
      guardNodeRequest(request, this.config, false)
      if (request.method !== 'POST') throw new NodeListenerError('invalidRequest')
      const method = nodeRoute(request.url)
      hasAuthenticated = [
        'node/auth/signin',
        'node/auth/enroll',
        'node/auth/stepUp/complete',
      ].includes(method)
      const entry = nodeMethods[method]
      release = this.admission.enter(request.socket.remoteAddress ?? '', hasAuthenticated)
      const auth = nodeHeader(request, 'authorization')
      const session =
        entry.access === 'public'
          ? null
          : await nodeAuthenticate(
              this.options.verifier,
              auth?.startsWith('Bearer ') === true ? auth.slice('Bearer '.length) : undefined,
              this.options.ownerId,
              signal,
            )
      if (this.options.verifier === undefined) throw new NodeListenerError('unavailable')
      if (session !== null)
        signal = AbortSignal.any([signal, this.options.verifier.sessionSignal(session.id)])
      signal.throwIfAborted()
      const body = await readBody(request)
      const result = await dispatchNodeMethod(
        method,
        body,
        session,
        {
          source: request.socket.remoteAddress ?? '',
          methods: this.options.methods,
          verifier: this.options.verifier,
          now: () => this.options.clock.now(),
        },
        signal,
      )
      signal.throwIfAborted()
      response.writeHead(NODE_HTTP_STATUS.ok, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(JSON.stringify(result))
      isFailed = false
    } catch (error: unknown) {
      // Admission refusal is not a failed proof and cannot extend source backoff.
      if (error instanceof NodeListenerError && error.code === 'rateLimited') isFailed = false
      refuse(response, error)
      // Protocol failures are answered above; anything else is a bug and surfaces.
      if (error instanceof Error && error.name === 'AbortError') return
      if (!(error instanceof NodeListenerError)) throw error
    } finally {
      clearTimeout(timeout)
      release?.(isFailed, hasAuthenticated)
    }
  }

  async start(): Promise<void> {
    if (this.starting || this.server !== undefined || this.lifetime.signal.aborted)
      throw new NodeListenerError('unavailable')
    const listener = this.config.listener
    if (listener === null) throw new NodeListenerError('unavailable')
    this.starting = true
    try {
      const tls = this.options.tls
      const files = new NodePrivateFiles(tls.root)
      const cert = await files.read(tls.certificateFile, NODE_MAX_AUTH_BYTES)
      const key = await files.read(tls.privateKeyFile, NODE_MAX_AUTH_BYTES)
      const certificate = new X509Certificate(cert)
      const fingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase()
      if (
        fingerprint !== nodeDigestSchema.parse(tls.fingerprint) ||
        certificate.ca ||
        Date.parse(certificate.validFrom) > this.options.clock.now() ||
        Date.parse(certificate.validTo) <= this.options.clock.now() ||
        this.config.browserNames.some(
          (name) => certificate.checkHost(name, { subject: 'never', wildcards: false }) !== name,
        )
      )
        throw new NodeListenerError('forbidden')
      this.lifetime.signal.throwIfAborted()
      const server = createServer(
        {
          cert,
          key,
          minVersion: 'TLSv1.3',
          maxHeaderSize: NODE_HTTP_HEADER_BYTES,
          handshakeTimeout: NODE_HTTP_TIMEOUT_MS,
        },
        (request, response) => {
          void this.handle(request, response)
        },
      )
      server.maxHeadersCount = NODE_HTTP_MAX_HEADERS
      server.headersTimeout = NODE_HTTP_TIMEOUT_MS
      server.requestTimeout = NODE_HTTP_TIMEOUT_MS
      server.timeout = NODE_HTTP_TIMEOUT_MS
      server.maxConnections = NODE_LISTENER_MAX_CONNECTIONS
      server.on('connection', (socket) => {
        if (!(socket instanceof Socket)) {
          socket.destroy()
          return
        }
        const source = socket.remoteAddress ?? ''
        const count = this.sources.get(source) ?? 0
        if (count >= NODE_LISTENER_SOURCE_CONNECTIONS) {
          socket.destroy()
          return
        }
        this.sources.set(source, count + 1)
        this.sockets.add(socket)
        socket.once('close', () => {
          this.sockets.delete(socket)
          const remaining = (this.sources.get(source) ?? 1) - 1
          if (remaining === 0) this.sources.delete(source)
          else this.sources.set(source, remaining)
        })
      })
      server.on('upgrade', (request, socket, head) => {
        try {
          guardNodeRequest(request, this.config, true)
          upgradeNodeTerminal(request, socket, head, this.options, this.lifetime.signal)
        } catch (error: unknown) {
          // Guard and upgrade failures are NodeListenerErrors by construction.
          if (error instanceof NodeListenerError) {
            socket.destroy()
          } else {
            throw error
          }
        }
      })
      // Plain HTTP and malformed TLS are refused on this same port, with no redirect.
      server.on('tlsClientError', (_error, socket) => socket.destroy())
      this.server = server
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen({ host: listener.address, port: listener.port, exclusive: true }, () => {
          server.off('error', reject)
          resolve()
        })
      })
      this.options.print(`${UI_TEXT.nodeLabels.fingerprint}: ${certificate.fingerprint256}`)
    } catch (error: unknown) {
      await this.close()
      throw error
    } finally {
      this.starting = false
    }
  }

  async close(): Promise<void> {
    this.lifetime.abort()
    for (const socket of this.sockets) socket.destroy()
    const server = this.server
    this.server = undefined
    if (server !== undefined)
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
  }
}
