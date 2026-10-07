// The IDE tool server `muse serve` reaches from each session: MCP over
// streamable HTTP on a loopback port, guarded by a bearer token minted per
// extension host (never logged, never written to disk). Its tools are
// `getDiagnostics`, web fetch in a trusted workspace (M69) and, while paid
// image generation is on and a key is stored, the image tools (M44); the
// list is read on every request, so a session started after a change sees
// it. A call whose caller stops waiting (its request closed, or
// `notifications/cancelled` naming it) is told through its signal. The
// JSON-RPC handling itself is pure (src/core/mcp.ts).

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import {
  handleMcpMessage,
  type McpOutcome,
  type McpRequestKey,
  mcpRequestKeys,
  type McpTool,
} from '../../core/mcp'
import {
  CLI_OUTPUT_MAX_BYTES,
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_PATH,
  IDE_MCP_SERVER_INFO,
  IDE_MCP_TOKEN_BYTES,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { isSameLoopbackSecret, listenLoopback, readLoopbackBody } from '../mcpLoopback'

/** What `session/start` is told: where the server is and how to authenticate. */
export interface IdeMcpEndpoint {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

const AUTHORIZATION_HEADER = 'authorization'
const BEARER_PREFIX = 'Bearer '
const JSON_CONTENT_TYPE = 'application/json'
const POST = 'POST'

export class IdeMcpServer {
  private readonly token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
  private server: Server | undefined
  private endpoint: IdeMcpEndpoint | undefined
  private generation = 0
  /** A start in flight: concurrent callers share it instead of opening two ports. */
  private starting: Promise<IdeMcpEndpoint> | undefined
  /** The calls being answered, by request id, so a cancellation can stop them (M69). */
  private readonly inFlight = new Map<McpRequestKey, Set<AbortController>>()

  public constructor(
    /** The tools offered now, asked on every request. */
    private readonly tools: () => readonly McpTool[],
    private readonly log: Logger,
  ) {}

  /**
   * Stops every call in flight under the key (M69). Muse Code 1.4.0 sends
   * `notifications/cancelled` for a stopped turn's call and closes its
   * request; either one stops the tool. The server has no session identity,
   * so two sessions' calls with the same id are both stopped: a stopped call
   * fails, which no call takes as success.
   */
  private cancel(key: McpRequestKey): void {
    const calls = this.inFlight.get(key) ?? []
    for (const controller of calls) {
      controller.abort()
    }
  }

  /** The body handled with a signal that aborts when its caller stops waiting. */
  private async handleInFlight(
    body: string,
    key: McpRequestKey | undefined,
    response: ServerResponse,
  ): Promise<McpOutcome> {
    const controller = new AbortController()
    const onClose = () => {
      if (!response.writableFinished) {
        controller.abort()
      }
    }
    response.once('close', onClose)
    const calls = key === undefined ? undefined : (this.inFlight.get(key) ?? new Set())
    if (key !== undefined && calls !== undefined) {
      calls.add(controller)
      this.inFlight.set(key, calls)
    }
    try {
      return await handleMcpMessage(body, this.tools(), IDE_MCP_SERVER_INFO, controller.signal)
    } finally {
      response.off('close', onClose)
      if (key !== undefined && calls !== undefined) {
        calls.delete(controller)
        if (calls.size === 0) {
          this.inFlight.delete(key)
        }
      }
    }
  }

  private isAuthorised(request: IncomingMessage): boolean {
    const header = request.headers[AUTHORIZATION_HEADER]
    return (
      typeof header === 'string' &&
      header.startsWith(BEARER_PREFIX) &&
      isSameLoopbackSecret(header.slice(BEARER_PREFIX.length), this.token)
    )
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== POST) {
      response.writeHead(HTTP_STATUS.methodNotAllowed).end()
      return
    }
    if (request.url !== IDE_MCP_PATH) {
      response.writeHead(HTTP_STATUS.notFound).end()
      return
    }
    if (!this.isAuthorised(request)) {
      this.log.warn('IDE tool server refused a request without the session token')
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    const body = await readLoopbackBody(request, CLI_OUTPUT_MAX_BYTES)
    if (body === undefined) {
      response.writeHead(HTTP_STATUS.badRequest).end()
      return
    }
    const keys = mcpRequestKeys(body)
    if (keys.cancelled !== undefined) {
      this.cancel(keys.cancelled)
    }
    const outcome = await this.handleInFlight(body, keys.request, response)
    if (response.destroyed) {
      return
    }
    if (outcome.kind === 'accepted') {
      response.writeHead(HTTP_STATUS.accepted).end()
      return
    }
    response.writeHead(HTTP_STATUS.ok, { 'content-type': JSON_CONTENT_TYPE })
    response.end(JSON.stringify(outcome.body))
  }

  /** The endpoint once `start` has resolved; undefined before or after `close`. */
  /** `handle`, with a failure answered 500 instead of left as an unhandled rejection (D25). */
  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.handle(request, response)
    } catch (error: unknown) {
      this.log.error(`IDE tool server request failed: ${String(error)}`)
      if (response.headersSent) {
        response.end()
      } else {
        response.writeHead(HTTP_STATUS.internalServerError).end()
      }
    }
  }

  /** `listen`, forgetting the shared start once it settles. */
  private async listenOnce(): Promise<IdeMcpEndpoint> {
    try {
      return await this.listen()
    } finally {
      this.starting = undefined
    }
  }

  private async listen(): Promise<IdeMcpEndpoint> {
    const generation = this.generation
    const { server, port } = await listenLoopback(
      (request, response) => {
        void this.respond(request, response)
      },
      this.log,
      'IDE tool server',
    )
    if (generation !== this.generation) {
      server.close()
      throw new Error('IDE tool server closed during start')
    }
    this.server = server
    this.endpoint = {
      url: `http://${IDE_MCP_LOOPBACK_HOST}:${String(port)}${IDE_MCP_PATH}`,
      headers: { Authorization: `${BEARER_PREFIX}${this.token}` },
    }
    this.log.info(`IDE tool server listening on ${this.endpoint.url}`)
    return this.endpoint
  }

  public get current(): IdeMcpEndpoint | undefined {
    return this.endpoint
  }

  /**
   * Listens on an ephemeral loopback port; idempotent, and callable again
   * after a failed start (PLAN.md D25: a first failure no longer leaves the
   * diagnostics tool off for the window's life).
   */
  public start(): Promise<IdeMcpEndpoint> {
    if (this.endpoint !== undefined) {
      return Promise.resolve(this.endpoint)
    }
    this.starting ??= this.listenOnce()
    return this.starting
  }

  public close(): void {
    this.generation += 1
    this.server?.close()
    this.server = undefined
    this.endpoint = undefined
  }
}
