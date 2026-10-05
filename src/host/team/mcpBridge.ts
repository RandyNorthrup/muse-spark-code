// The team's MCP bridge (M96 lane B, PLAN.md D75): one instance of each MCP
// server on M50's pool, served to the orchestrator and every worker of the
// window.
//
// Each caller (the orchestrator's session, each task) gets a loopback
// endpoint of its own with a token of its own, on the `ide` server's
// transport (streamable HTTP on 127.0.0.1, an ephemeral port). A call is
// keyed by caller registration, configured server client and request id.
// Two workers' or server clients' identical ids never cross. The registry
// owns every lease/call transition, including exact cancellation records.
// Exclusive servers pass calls through the lease (and shared ones through
// their concurrency limit) on every call; a read-only role is served only
// tools that declare `readOnlyHint: true`; every worker starts with only its
// role's servers.
//
// How each kind reaches it: engine workers call it in-process (`callAs`);
// Muse Code sessions (the orchestrator's included) get its servers by name
// in their `config.mcpServers`, pointing at the bridge (`serverEntriesFor`,
// merged after lane T's entries at integration); external agents get it in
// `session/new` `mcpServers`, as HTTP where they advertise it.
//
// One instance serves the window; the scheduler (M96c) owns it beside the
// registry. Until the team runs (single-model mode), nothing constructs it:
// no endpoint listens, no pool is touched, and no request changes. Every
// incoming message is parsed with a zod schema before use. Wire failures
// answer 500 instead of leaving an unhandled rejection (D25).

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import type { SessionMcpServer } from '../../core/agent/agentBackend'
import { type CallToolResult, McpError } from '../../core/backends/modelapi/mcp/protocol'
import type {
  BridgeOfferedTool,
  McpPoolSnapshot,
  McpToolRef,
} from '../../core/backends/modelapi/mcp/pool'
import { messageSchema, type McpRequestKey } from '../../core/mcp'
import {
  busyText,
  type LeaseHolder,
  type ResourceRegistry,
  type ServerIdentity,
} from '../../core/team/resources'
import {
  CLI_OUTPUT_MAX_BYTES,
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_TOKEN_BYTES,
  JSON_RPC_ERRORS,
  MCP_PROTOCOL_VERSION,
  MODEL_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { isSameLoopbackSecret, listenLoopback, readLoopbackBody } from '../mcpLoopback'

/** What M50's pool gives the bridge: the single instance of every server. */
export interface TeamBridgePool {
  snapshot(): McpPoolSnapshot
  find(functionName: string): McpToolRef | undefined
  bridgeTools(): readonly BridgeOfferedTool[]
  callRaw(functionName: string, argsJson: string, signal: AbortSignal): Promise<CallToolResult>
}

/** Whether the window started the server (stdio) or reaches it remotely. */
export type TeamServerOrigin = 'local' | 'remote'

/** A caller the bridge serves: the orchestrator's session, or one task. */
export interface BridgeCaller {
  readonly id: string
  readonly holder: LeaseHolder
  /** A read-only role sees only tools that declare `readOnlyHint: true`. */
  readonly readOnly: boolean
  /** Further restricts the servers explicitly assigned to the caller's role. */
  readonly servers?: readonly string[] | undefined
}

export interface BridgeEndpoint {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface TeamBridgeDeps {
  readonly pool: TeamBridgePool
  readonly leases: ResourceRegistry
  /**
   * This window's servers by origin, from the settings entries (M31's
   * reader) at the glue: stdio entries are local, streamable-HTTP ones
   * remote. Absent means unknown: treated as remote, never restarted.
   */
  readonly serverOrigins: Readonly<Record<string, TeamServerOrigin>>
  /** Command and package per server, for the registry's defaults. */
  readonly serverIdentities?: Readonly<Record<string, ServerIdentity>> | undefined
  /** The extension's version, sent as the bridge's in `initialize`. */
  readonly clientVersion: string
  readonly log: Logger
}

const BRIDGE_ROUTE_PREFIX = '/mcp/'
const BRIDGE_SERVER_NAME = 'muse-spark-team-bridge'
const AUTHORIZATION_HEADER = 'authorization'
const BEARER_PREFIX = 'Bearer '
const JSON_CONTENT_TYPE = 'application/json'
const POST = 'POST'

const bridgeCallSchema = z.object({
  name: z.string(),
  arguments: z.optional(z.unknown()),
})

const bridgeArgumentsSchema = z.record(z.string(), z.unknown())

const bridgeInitializeSchema = z.object({
  protocolVersion: z.optional(z.string()),
})

const bridgeCancelledSchema = z.object({
  method: z.literal('notifications/cancelled'),
  params: z.object({ requestId: z.union([z.string(), z.number()]) }),
})

function keyOfId(id: string | number): McpRequestKey {
  return typeof id === 'number' ? `n:${String(id)}` : `s:${id}`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

interface LiveCaller {
  readonly caller: BridgeCaller
  readonly token: string
  readonly endpoint: BridgeEndpoint
  readonly clients: Set<string>
}

/** What the bridge answers a request with: a tool result, a handshake, a list, or an error. */
type BridgeAnswer =
  | CallToolResult
  | Record<string, never>
  | {
      readonly protocolVersion: string
      readonly capabilities: { readonly tools: Record<string, never> }
      readonly serverInfo: { readonly name: string; readonly version: string }
    }
  | { readonly tools: readonly BridgeToolListing[] }
  | { readonly error: { readonly code: number; readonly message: string } }

export class TeamMcpBridge {
  private readonly callers = new Map<string, LiveCaller>()
  private server: Server | undefined
  private port: number | undefined
  private starting: Promise<void> | undefined
  private closed = false
  private nextEngineId = 0

  public constructor(private readonly deps: TeamBridgeDeps) {}

  private clientId(caller: LiveCaller, serverName?: string): string {
    // The token identifies this registration, including after an id is reused.
    // Kept in memory only, never returned in call identities or logs.
    const id = `${caller.token}\n${serverName ?? ''}`
    caller.clients.add(id)
    return id
  }

  private liveCaller(callerId: string): LiveCaller {
    const live = this.callers.get(callerId)
    if (live === undefined) {
      throw new Error(`The team bridge has no caller ${callerId}`)
    }
    return live
  }

  /** This window's servers with tools offered: what a caller's entries may name. */
  private offeredServers(): readonly string[] {
    const names = new Set<string>()
    for (const offered of this.deps.pool.bridgeTools()) {
      names.add(offered.server)
    }
    return [...names]
  }

  private allowedServers(caller: BridgeCaller): readonly string[] {
    const offered = this.offeredServers()
    const assigned = this.deps.leases.serversForRole(caller.holder.role)
    return (caller.servers ?? offered).filter(
      (name) => offered.includes(name) && assigned.includes(name),
    )
  }

  private refused(text: string): CallToolResult {
    return toolError(text)
  }

  private listed(caller: BridgeCaller): readonly BridgeToolListing[] {
    const allowed = new Set(this.allowedServers(caller))
    return this.deps.pool
      .bridgeTools()
      .filter((offered) => allowed.has(offered.server))
      .filter((offered) => !caller.readOnly || offered.isReadOnly)
      .map((offered) => ({
        name: offered.functionName,
        ...(offered.tool.description !== undefined && { description: offered.tool.description }),
        inputSchema: offered.tool.inputSchema ?? { type: 'object' },
      }))
  }

  private async invoke(
    live: LiveCaller,
    functionName: string,
    argsJson: string,
    signal: AbortSignal,
    requestId: string,
    serverName?: string,
  ): Promise<CallToolResult> {
    const caller = live.caller
    const ref = this.deps.pool.find(functionName)
    if (
      ref === undefined ||
      !this.allowedServers(caller).includes(ref.server) ||
      (serverName !== undefined && serverName !== ref.server)
    ) {
      return this.refused(`Unknown tool: ${functionName}`)
    }
    if (caller.readOnly && !ref.isReadOnly) {
      return this.refused(`Not offered to a read-only role: ${functionName}`)
    }
    // Validate before any pending record exists; M50 accepts JSON objects only.
    let args: unknown
    try {
      args = argsJson.trim() === '' ? {} : JSON.parse(argsJson)
    } catch {
      return this.refused(MODEL_TEXT.mcpArgumentsNotObject)
    }
    if (!bridgeArgumentsSchema.safeParse(args).success) {
      return this.refused(MODEL_TEXT.mcpArgumentsNotObject)
    }
    if (this.closed || this.callers.get(caller.id) !== live) {
      return this.refused('The team bridge is closed')
    }
    this.deps.leases.ensureServer(ref.server, this.deps.serverIdentities?.[ref.server])
    const outcome = await this.deps.leases.acquireCall(
      ref.server,
      caller.holder,
      this.clientId(live, serverName),
      requestId,
      signal,
    )
    if (outcome.status === 'busy') return this.refused(busyText(outcome.holder))
    if (outcome.status === 'stale') {
      return this.refused(
        `The task's attempt ${String(caller.holder.attempt)} ended; the call is refused`,
      )
    }
    if (outcome.status === 'closed') return this.refused('The team bridge is closed')
    if (outcome.status === 'cancelled') return this.refused(describe(outcome.reason))
    if (outcome.status === 'duplicate') return this.refused('Invalid tools/call params')
    if (!this.allowedServers(caller).includes(ref.server)) {
      this.deps.leases.cancelCall(outcome.call)
      return this.refused(`Unknown tool: ${functionName}`)
    }
    const admittedSignal = this.deps.leases.dispatch(outcome.call)
    if (admittedSignal === undefined) {
      const current = this.deps.leases.checkCall(ref.server, caller.holder)
      if (current.status === 'stale-attempt') {
        return this.refused(
          `The task's attempt ${String(caller.holder.attempt)} ended; the call is refused`,
        )
      }
      return this.refused(
        current.status === 'taken-back'
          ? busyText(current.holder)
          : describe(outcome.signal.reason),
      )
    }
    try {
      const result = await this.deps.pool.callRaw(functionName, argsJson, admittedSignal)
      this.deps.leases.settle(outcome.call, 'answered')
      return result
    } catch (error: unknown) {
      // Only a server JSON-RPC error proves dispatch ended; timeout/transport
      // loss/cancel stays dispatched until exit or the explicit user override.
      if (error instanceof McpError && error.code !== undefined) {
        this.deps.leases.settle(outcome.call, 'failed')
      }
      return this.refused(describe(error))
    }
  }

  private isAuthorised(caller: LiveCaller, request: IncomingMessage): boolean {
    const header = request.headers[AUTHORIZATION_HEADER]
    return (
      typeof header === 'string' &&
      header.startsWith(BEARER_PREFIX) &&
      isSameLoopbackSecret(header.slice(BEARER_PREFIX.length), caller.token)
    )
  }

  private errorBody(id: unknown, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  }

  private resultBody(id: unknown, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result })
  }

  private async answer(
    caller: LiveCaller,
    method: string | undefined,
    params: Readonly<Record<string, unknown>> | undefined,
    signal: AbortSignal,
    requestId: string,
    serverName?: string,
  ): Promise<BridgeAnswer> {
    switch (method) {
      case 'initialize': {
        const hello = bridgeInitializeSchema.safeParse(params ?? {})
        const requested = hello.success ? hello.data.protocolVersion : undefined
        return {
          protocolVersion: requested ?? MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: BRIDGE_SERVER_NAME, version: this.deps.clientVersion },
        }
      }
      case 'ping': {
        return {}
      }
      case 'tools/list': {
        return {
          tools: this.listed(caller.caller).filter(
            (tool) =>
              serverName === undefined || this.deps.pool.find(tool.name)?.server === serverName,
          ),
        }
      }
      case 'tools/call': {
        const call = bridgeCallSchema.safeParse(params ?? {})
        if (!call.success) {
          return {
            error: { code: JSON_RPC_ERRORS.invalidParams, message: 'Invalid tools/call params' },
          }
        }
        const rawArgs = call.data.arguments
        let argsJson = '{}'
        if (typeof rawArgs === 'string') {
          argsJson = rawArgs
        } else if (rawArgs !== undefined) {
          argsJson = JSON.stringify(rawArgs)
        }
        return await this.invoke(caller, call.data.name, argsJson, signal, requestId, serverName)
      }
      default: {
        return {
          error: {
            code: JSON_RPC_ERRORS.methodNotFound,
            message: `Method not found: ${method ?? ''}`,
          },
        }
      }
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== POST) {
      response.writeHead(HTTP_STATUS.methodNotAllowed).end()
      return
    }
    if (!request.url?.startsWith(BRIDGE_ROUTE_PREFIX)) {
      response.writeHead(HTTP_STATUS.notFound).end()
      return
    }
    let callerId: string
    let serverName: string | undefined
    try {
      const parts = request.url.slice(BRIDGE_ROUTE_PREFIX.length).split('/')
      if (parts.length > 2) {
        response.writeHead(HTTP_STATUS.notFound).end()
        return
      }
      callerId = decodeURIComponent(parts[0] ?? '')
      serverName = parts[1] === undefined ? undefined : decodeURIComponent(parts[1])
    } catch {
      response.writeHead(HTTP_STATUS.notFound).end()
      return
    }
    const caller = this.callers.get(callerId)
    if (
      caller === undefined ||
      (serverName !== undefined && !this.allowedServers(caller.caller).includes(serverName))
    ) {
      response.writeHead(HTTP_STATUS.notFound).end()
      return
    }
    if (!this.isAuthorised(caller, request)) {
      this.deps.log.warn('Team MCP bridge refused a request without its caller token')
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    const body = await readLoopbackBody(request, CLI_OUTPUT_MAX_BYTES)
    if (body === undefined) {
      response.writeHead(HTTP_STATUS.badRequest).end()
      return
    }
    if (this.closed || this.callers.get(callerId) !== caller) {
      response.writeHead(HTTP_STATUS.notFound).end()
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      response
        .writeHead(HTTP_STATUS.ok, { 'content-type': JSON_CONTENT_TYPE })
        .end(this.errorBody(null, JSON_RPC_ERRORS.parseError, 'Parse error'))
      return
    }
    const message = messageSchema.safeParse(parsed)
    if (!message.success) {
      response
        .writeHead(HTTP_STATUS.ok, { 'content-type': JSON_CONTENT_TYPE })
        .end(this.errorBody(null, JSON_RPC_ERRORS.invalidRequest, 'Invalid request'))
      return
    }
    const cancelled = bridgeCancelledSchema.safeParse(parsed)
    if (cancelled.success) {
      this.deps.leases.cancelClient(
        this.clientId(caller, serverName),
        serverName,
        keyOfId(cancelled.data.params.requestId),
      )
    }
    if (message.data.id === undefined || message.data.id === null) {
      response.writeHead(HTTP_STATUS.accepted).end()
      return
    }
    const id = message.data.id
    const controller = new AbortController()
    const onClose = () => {
      if (response.writableFinished) {
        return
      }

      controller.abort()
    }
    response.once('close', onClose)
    try {
      const result = await this.answer(
        caller,
        message.data.method,
        message.data.params,
        controller.signal,
        keyOfId(id),
        serverName,
      )
      if (response.destroyed) {
        return
      }
      if ('error' in result) {
        response
          .writeHead(HTTP_STATUS.ok, { 'content-type': JSON_CONTENT_TYPE })
          .end(this.errorBody(id, result.error.code, result.error.message))
        return
      }
      response
        .writeHead(HTTP_STATUS.ok, { 'content-type': JSON_CONTENT_TYPE })
        .end(this.resultBody(id, result))
    } finally {
      response.off('close', onClose)
    }
  }

  /** `handle`, with a failure answered 500 instead of left as an unhandled rejection (D25). */
  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.handle(request, response)
    } catch (error: unknown) {
      this.deps.log.error(`Team MCP bridge request failed: ${describe(error)}`)
      if (response.headersSent) {
        response.end()
      } else {
        response.writeHead(HTTP_STATUS.internalServerError).end()
      }
    }
  }

  private async listenOnce(): Promise<void> {
    try {
      await this.listen()
    } finally {
      this.starting = undefined
    }
  }

  private async listen(): Promise<void> {
    const { server, port } = await listenLoopback(
      (request, response) => {
        void this.respond(request, response)
      },
      this.deps.log,
      'Team MCP bridge',
    )
    if (this.closed) {
      server.close()
      throw new Error('The team bridge is closed')
    }
    this.server = server
    this.port = port
    this.deps.log.info(`Team MCP bridge listening on ${IDE_MCP_LOOPBACK_HOST}:${String(port)}`)
  }

  /** The filtered `tools/list`: the role's servers, and only read-only tools for a read-only role. */
  public listTools(callerId: string): readonly BridgeToolListing[] {
    return this.listed(this.liveCaller(callerId).caller)
  }

  /**
   * A call from an engine worker, in process: lease admission, the pool's raw
   * result, and the lease's terminal answer. Refusals come back as tool
   * errors, never thrown, so the worker hears them as the orchestrator does.
   */
  public async callAs(
    callerId: string,
    functionName: string,
    argsJson: string,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    const caller = this.liveCaller(callerId)
    this.nextEngineId += 1
    return await this.invoke(
      caller,
      functionName,
      argsJson,
      signal,
      `engine:${String(this.nextEngineId)}`,
    )
  }

  /**
   * The bridge's entries for `config.mcpServers` (Muse Code sessions) and
   * `session/new` `mcpServers` (external agents): every allowed server under
   * its own name, pointing at this caller's endpoint with its token. Merged
   * after lane T's entries by the backend manager at integration.
   */
  public serverEntriesFor(callerId: string): Readonly<Record<string, SessionMcpServer>> {
    const live = this.liveCaller(callerId)
    return Object.fromEntries(
      this.allowedServers(live.caller).map((name) => [
        name,
        { url: `${live.endpoint.url}/${encodeURIComponent(name)}`, headers: live.endpoint.headers },
      ]),
    )
  }

  /** Local (the window started it) or remote; unknown is treated as remote, never restarted. */
  public serverOrigin(name: string): TeamServerOrigin | 'unknown' {
    return this.deps.serverOrigins[name] ?? 'unknown'
  }

  /**
   * Registers a caller and mints its endpoint and token. The bridge must be
   * started first; registering the same id twice is refused.
   */
  public registerCaller(caller: BridgeCaller): BridgeEndpoint {
    if (this.closed || this.port === undefined) {
      throw new Error('The team bridge is not started')
    }
    if (caller.id === '' || this.callers.has(caller.id)) {
      throw new Error(`The team bridge cannot register caller ${caller.id}`)
    }
    const token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    const endpoint: BridgeEndpoint = {
      url: `http://${IDE_MCP_LOOPBACK_HOST}:${String(this.port)}${BRIDGE_ROUTE_PREFIX}${encodeURIComponent(caller.id)}`,
      headers: { Authorization: `${BEARER_PREFIX}${token}` },
    }
    this.callers.set(caller.id, { caller, token, endpoint, clients: new Set() })
    return endpoint
  }

  /** Unregisters a caller: its endpoint stops answering, and its calls are stopped. */
  public unregisterCaller(callerId: string): void {
    const live = this.callers.get(callerId)
    if (live === undefined) return
    this.callers.delete(callerId)
    for (const client of live.clients) this.deps.leases.cancelClient(client)
  }

  /** Listens on an ephemeral loopback port; idempotent while started. */
  public start(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('The team bridge is closed'))
    }
    if (this.port !== undefined) {
      return Promise.resolve()
    }
    this.starting ??= this.listenOnce()
    return this.starting
  }

  /** The window going away: every call stops, every endpoint with it. */
  public close(): void {
    this.closed = true
    for (const callerId of this.callers.keys()) this.unregisterCaller(callerId)
    this.server?.close()
    this.server = undefined
    this.port = undefined
  }
}

/** One `tools/list` entry the bridge serves: the pool's names, the server's shapes. */
export interface BridgeToolListing {
  readonly name: string
  readonly description?: string | undefined
  readonly inputSchema: Readonly<Record<string, unknown>>
}
