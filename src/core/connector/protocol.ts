// M124 (D106): the MCP subset the connector speaks over stdio: initialize
// (version negotiation), ping, tools/list, tools/call and the cancelled /
// initialized notifications. Built on the repository's own pure MCP server
// core (src/core/mcp.ts's message schema and request keys); no SDK. The
// server never sends requests of its own (no sampling, elicitation, roots or
// subscriptions), so a client's response frame is ignored, never read as an
// answer to anything.
import * as z from 'zod/mini'
import {
  CONNECTOR_PROTOCOL_VERSIONS,
  CONNECTOR_RPC_ERRORS,
  JSON_RPC_ERRORS,
  MCP_CANCELLED_NOTIFICATION,
} from '../../shared/constants'
import { mcpRequestKeys, messageSchema, type McpRequestKey } from '../mcp'

export interface ConnectorToolEntry {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly annotations: Readonly<Record<string, unknown>>
}

export interface ConnectorCallResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly structuredContent?: Readonly<Record<string, unknown>>
  readonly isError: boolean
}

/** What the transport needs from the registry. */
export interface ConnectorServer {
  readonly serverInfo: { readonly name: string; readonly version: string }
  readonly initialized: (client: string, protocolVersion: string) => Promise<string>
  readonly list: () => Promise<readonly ConnectorToolEntry[]>
  readonly call: (
    name: string,
    args: unknown,
    protocolVersion: string,
    signal: AbortSignal,
  ) => Promise<ConnectorCallResult>
  /** The client is gone: nothing is admitted again and pending intents are cancelled. */
  readonly disconnect: () => void
  /** A frame refused before any call existed: one receipt with its JSON-RPC code only. */
  readonly transport: (code: number) => void
}

const REFUSED_WORDS: Readonly<Record<number, string>> = {
  [JSON_RPC_ERRORS.parseError]: 'Parse error',
  [JSON_RPC_ERRORS.invalidRequest]: 'Invalid request',
  [JSON_RPC_ERRORS.methodNotFound]: 'Method not found',
  [JSON_RPC_ERRORS.invalidParams]: 'Invalid params',
  [CONNECTOR_RPC_ERRORS.requestTooLarge]: 'Request too large',
  [CONNECTOR_RPC_ERRORS.busy]: 'Server busy',
}

const initializeParamsSchema = z.object({
  protocolVersion: z.string(),
  clientInfo: z.optional(z.object({ name: z.optional(z.string()) })),
})
const callParamsSchema = z.object({ name: z.string(), arguments: z.optional(z.unknown()) })
const CLIENT_NAME_CHARS = 64
/** Stop's reserved path keeps room in a full transport. */
const CONTROL_TOOLS: ReadonlySet<string> = new Set(['muse_stop', 'muse_schedule_cancel'])

export function negotiateVersion(requested: string): string {
  const supported: readonly string[] = CONNECTOR_PROTOCOL_VERSIONS
  return supported.includes(requested) ? requested : CONNECTOR_PROTOCOL_VERSIONS[0]
}

function error(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function result(id: unknown, value: unknown) {
  return { jsonrpc: '2.0', id, result: value }
}

export type FrameReply = Readonly<Record<string, unknown>> | undefined

export class ConnectorProtocol {
  /** Read only when the transport is full: the frame's id, and whether it is Stop's path. */
  public static classify(raw: string): { readonly id: unknown; readonly isControl: boolean } {
    try {
      const message = messageSchema.parse(JSON.parse(raw))
      const call = callParamsSchema.safeParse(message.params)
      return {
        id: message.id,
        isControl:
          message.method === MCP_CANCELLED_NOTIFICATION ||
          (message.method === 'tools/call' && call.success && CONTROL_TOOLS.has(call.data.name)),
      }
    } catch {
      return { id: null, isControl: false }
    }
  }

  private protocolVersion: string | undefined
  private readonly inFlight = new Map<McpRequestKey, AbortController>()

  public constructor(private readonly server: ConnectorServer) {}

  /**
  A refused frame's answer, with its one receipt (the code only: nothing
  the client sent is recorded). The transport uses it for frames it never
  hands over: over the bound, invalid UTF-8, or beyond its task bound.
  */
  public refuse(code: number, id: unknown): Readonly<Record<string, unknown>> {
    this.server.transport(code)
    return error(id, code, REFUSED_WORDS[code] ?? 'Error')
  }

  /** One frame in; the reply to write, if any. A cancelled request gets none. */
  public async handle(raw: string): Promise<FrameReply> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return this.refuse(JSON_RPC_ERRORS.parseError, null)
    }
    // JSON-RPC batches left MCP in 2025-06-18; one message per line.
    const message = messageSchema.safeParse(parsed)
    if (!message.success) return this.refuse(JSON_RPC_ERRORS.invalidRequest, null)
    const { id, method, params } = message.data
    const keys = mcpRequestKeys(raw)
    if (method === MCP_CANCELLED_NOTIFICATION) {
      if (keys.cancelled !== undefined) this.inFlight.get(keys.cancelled)?.abort()
      return undefined
    }
    // Notifications (initialized among them) and client responses get no reply.
    if (id === undefined || id === null || method === undefined) return undefined
    if (method === 'ping') return result(id, {})
    if (method === 'initialize') {
      const init = initializeParamsSchema.safeParse(params)
      if (!init.success) return this.refuse(JSON_RPC_ERRORS.invalidParams, id)
      const version = negotiateVersion(init.data.protocolVersion)
      this.protocolVersion = version
      const client = (init.data.clientInfo?.name ?? '').slice(0, CLIENT_NAME_CHARS)
      const instructions = await this.server.initialized(client, version)
      return result(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: this.server.serverInfo,
        instructions,
      })
    }
    if (this.protocolVersion === undefined) return this.refuse(JSON_RPC_ERRORS.invalidRequest, id)
    if (method === 'tools/list') return result(id, { tools: await this.server.list() })
    if (method !== 'tools/call') return this.refuse(JSON_RPC_ERRORS.methodNotFound, id)
    const call = callParamsSchema.safeParse(params)
    if (!call.success) return this.refuse(JSON_RPC_ERRORS.invalidParams, id)
    const controller = new AbortController()
    const key = keys.request
    if (key !== undefined) this.inFlight.set(key, controller)
    try {
      const answer = await this.server.call(
        call.data.name,
        call.data.arguments,
        this.protocolVersion,
        controller.signal,
      )
      return controller.signal.aborted ? undefined : result(id, answer)
    } catch {
      return controller.signal.aborted
        ? undefined
        : error(id, CONNECTOR_RPC_ERRORS.internal, 'Internal error')
    } finally {
      if (key !== undefined) this.inFlight.delete(key)
    }
  }

  /** Disconnect: the server closes first, then every call in flight stops. */
  public close(): void {
    this.server.disconnect()
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }
}
