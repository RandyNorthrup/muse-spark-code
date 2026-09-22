// The IDE tool server `muse serve` reaches from each session: MCP over
// streamable HTTP on a loopback port, guarded by a bearer token minted per
// extension host (never logged, never written to disk). One tool today,
// `getDiagnostics`; the JSON-RPC handling itself is pure (src/core/mcp.ts).

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { handleMcpMessage, type McpTool } from '../../core/mcp'
import {
  CLI_OUTPUT_MAX_BYTES,
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_PATH,
  IDE_MCP_SERVER_INFO,
  IDE_MCP_TOKEN_BYTES,
} from '../../shared/constants'
import type { Logger } from '../logger'

/** What `session/start` is told: where the server is and how to authenticate. */
export interface IdeMcpEndpoint {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

const AUTHORIZATION_HEADER = 'authorization'
const BEARER_PREFIX = 'Bearer '
const JSON_CONTENT_TYPE = 'application/json'
const POST = 'POST'

function readBody(request: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= maxBytes) {
        chunks.push(chunk)
      }
    })
    request.on('end', () => {
      resolve(size > maxBytes ? undefined : Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', () => {
      resolve(undefined)
    })
  })
}

function isSameSecret(presented: string, expected: string): boolean {
  const left = Buffer.from(presented)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export class IdeMcpServer {
  private readonly token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
  private server: Server | undefined
  private endpoint: IdeMcpEndpoint | undefined

  public constructor(
    private readonly tools: readonly McpTool[],
    private readonly log: Logger,
  ) {}

  private isAuthorised(request: IncomingMessage): boolean {
    const header = request.headers[AUTHORIZATION_HEADER]
    return (
      typeof header === 'string' &&
      header.startsWith(BEARER_PREFIX) &&
      isSameSecret(header.slice(BEARER_PREFIX.length), this.token)
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
    const body = await readBody(request, CLI_OUTPUT_MAX_BYTES)
    if (body === undefined) {
      response.writeHead(HTTP_STATUS.badRequest).end()
      return
    }
    const outcome = await handleMcpMessage(body, this.tools, IDE_MCP_SERVER_INFO)
    if (outcome.kind === 'accepted') {
      response.writeHead(HTTP_STATUS.accepted).end()
      return
    }
    response.writeHead(HTTP_STATUS.ok, { 'content-type': JSON_CONTENT_TYPE })
    response.end(JSON.stringify(outcome.body))
  }

  /** The endpoint once `start` has resolved; undefined before or after `close`. */
  public get current(): IdeMcpEndpoint | undefined {
    return this.endpoint
  }

  /** Listens on an ephemeral loopback port; idempotent. */
  public async start(): Promise<IdeMcpEndpoint> {
    if (this.endpoint !== undefined) {
      return this.endpoint
    }
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, IDE_MCP_LOOPBACK_HOST, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('IDE tool server has no TCP address')
    }
    this.endpoint = {
      url: `http://${IDE_MCP_LOOPBACK_HOST}:${String(address.port)}${IDE_MCP_PATH}`,
      headers: { Authorization: `${BEARER_PREFIX}${this.token}` },
    }
    this.log.info(`IDE tool server listening on ${this.endpoint.url}`)
    return this.endpoint
  }

  public close(): void {
    this.server?.close()
    this.server = undefined
    this.endpoint = undefined
  }
}
