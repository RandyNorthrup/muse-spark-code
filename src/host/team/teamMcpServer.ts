// The `team` MCP server Muse Code orchestrators reach from each session
// (PLAN.md M96 lane T, D75 "Muse Code as the orchestrator"): MCP over
// streamable HTTP on a loopback port, with a Bearer [REDACTED] minted per
// conversation (never logged, never written to disk), so every call knows
// its orchestrator session: its budget, its approvals and its results.
//
// One token reaches only its own conversation's tasks: a token minted for
// another conversation is unknown here and refused, as is no token, and a
// revoked conversation's token stops working. The tool list is the five
// static team tools, byte-identical across sessions and team edits (their
// descriptions never name a role). The JSON-RPC handling itself is pure
// (src/core/mcp.ts).
//
// A conversation keeps its token across `session/resume`: resume reuses the
// endpoint, so the set is kept unchanged.

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { handleMcpMessage, type McpOutcome, mcpRequestKeys, type McpTool } from '../../core/mcp'
import type { SessionMcpHttpServer } from '../../core/agent/agentBackend'
import {
  teamMcpToolList,
  isTeamTool,
  parseTeamArgs,
  clampCollectWait,
  delegateArgs,
  TeamCommandRegistry,
  teamCommandRecordsSchema,
  type TeamCommandStore,
} from '../../core/team/teamTools'
import { TEAM_MCP_TOKEN_BYTES } from '../../core/team/teamConstants'
import {
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_PATH,
  CLI_OUTPUT_MAX_BYTES,
} from '../../shared/constants'
import type { Logger } from '../logger'

/** What `session/start` is told: where the server is and how to authenticate. */
export type TeamMcpEndpoint = SessionMcpHttpServer

/** Where a conversation's team tool calls run (lanes A/W/I own the runner). */
export interface TeamSessionBinding {
  /** Conversation-owned storage: rebinding and server reload use the same record. */
  readonly commandRecords?: TeamCommandStore
  /**
   * Answer one team tool call for this conversation; throw to report a tool
   * error. `signal` aborts when the caller stops waiting for it.
   */
  readonly run: (
    tool: string,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) => Promise<string>
}

const AUTHORIZATION_HEADER = 'authorization'
const BEARER_PREFIX = 'Bearer '
const JSON_CONTENT_TYPE = 'application/json'
const POST = 'POST'
const TEAM_SERVER_INFO = { name: 'muse_spark_team', version: '1' } as const

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const rawChunk of request) {
      const chunk: unknown = rawChunk
      if (!Buffer.isBuffer(chunk)) return undefined
      size += chunk.length
      // Continue draining an oversized frame so the caller receives its HTTP error.
      if (size <= maxBytes) chunks.push(chunk)
    }
    return size > maxBytes ? undefined : Buffer.concat(chunks).toString('utf8')
  } catch {
    // A broken body is refused; caller data is never logged.
    return undefined
  }
}

// The request bodies the server reads are MCP frames, never tool payloads:
// 1 MiB bounds the frame the same way the IDE server bounds CLI output.

function isSameSecret(presented: string, expected: string): boolean {
  return (
    presented.length === expected.length &&
    /^[0-9a-f]+$/.test(presented) &&
    timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'))
  )
}

export class TeamMcpServer {
  private server: Server | undefined
  private url: string | undefined
  /** A start in flight: concurrent callers share it instead of opening two ports. */
  private starting: Promise<string> | undefined
  private startingAbort: AbortController | undefined
  private lifetime = 0
  /** Tokens by value, each bound to exactly one conversation's binding. */
  private readonly bindings = new Map<string, TeamSessionBinding>()
  private readonly endpoints = new Map<TeamSessionBinding, TeamMcpEndpoint>()
  private readonly commands = new WeakMap<TeamSessionBinding, TeamCommandRegistry>()
  /** The calls being answered, by token and request id, so a cancellation stops its own (M96 lane B routes shared servers the same way). */
  private readonly inFlight = new Map<string, Set<AbortController>>()

  public constructor(private readonly log: Logger) {}

  private cancel(key: string | undefined): void {
    if (key === undefined) return
    const calls = this.inFlight.get(key) ?? []
    for (const controller of calls) {
      controller.abort()
    }
  }

  private bindingOf(
    request: IncomingMessage,
  ): { binding: TeamSessionBinding; token: string } | undefined {
    const header = request.headers[AUTHORIZATION_HEADER]
    if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
      return undefined
    }
    const presented = header.slice(BEARER_PREFIX.length)
    for (const [token, binding] of this.bindings) {
      if (isSameSecret(presented, token)) {
        return { binding, token }
      }
    }
    return undefined
  }

  private toolsFor(binding: TeamSessionBinding, token: string): McpTool[] {
    return teamMcpToolList().map((tool) => ({
      ...tool,
      call: async (args, signal) => {
        signal.throwIfAborted()
        if (this.bindings.get(token) !== binding) throw new Error('Conversation token was revoked')
        if (!isTeamTool(tool.name)) throw new Error('Unknown team tool')
        const parsed = parseTeamArgs(tool.name, args)
        if (!parsed.ok) throw new Error(parsed.reason)
        if (tool.name === 'collect') {
          const wait = parsed.args['wait_seconds']
          return await binding.run(
            tool.name,
            {
              ...parsed.args,
              wait_seconds: clampCollectWait(typeof wait === 'number' ? wait : 0),
            },
            signal,
          )
        }
        if (tool.name !== 'delegate') return await binding.run(tool.name, parsed.args, signal)
        const delegation = delegateArgs.parse(parsed.args)
        if (delegation.dry_run === true) return await binding.run(tool.name, delegation, signal)
        const commands = this.commands.get(binding)
        if (commands === undefined) throw new Error('Conversation is no longer available')
        if (delegation.command_id !== undefined && binding.commandRecords === undefined)
          throw new Error('Durable conversation retry storage is unavailable')
        const result = await commands.run(delegation.command_id, delegation.tasks, async () => {
          signal.throwIfAborted()
          return { output: await binding.run(tool.name, delegation, signal), visibleOutput: '' }
        })
        return result.output
      },
    }))
  }

  private async handleInFlight(
    body: string,
    binding: TeamSessionBinding,
    token: string,
    flightKey: string | undefined,
    response: ServerResponse,
  ): Promise<McpOutcome> {
    const controller = new AbortController()
    response.once('close', () => {
      if (!response.writableFinished) controller.abort()
    })
    const calls = flightKey === undefined ? undefined : (this.inFlight.get(flightKey) ?? new Set())
    if (flightKey !== undefined && calls !== undefined) {
      calls.add(controller)
      this.inFlight.set(flightKey, calls)
    }
    try {
      return await handleMcpMessage(
        body,
        this.toolsFor(binding, token),
        TEAM_SERVER_INFO,
        controller.signal,
      )
    } finally {
      if (flightKey !== undefined && calls !== undefined) {
        calls.delete(controller)
        if (calls.size === 0) {
          this.inFlight.delete(flightKey)
        }
      }
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== POST || request.url !== IDE_MCP_PATH) {
      const status = request.method === POST ? HTTP_STATUS.notFound : HTTP_STATUS.methodNotAllowed
      response.writeHead(status).end()
      return
    }
    const found = this.bindingOf(request)
    if (found === undefined) {
      this.log.warn('Team tool server refused a request without its conversation token')
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    const body = await readBody(request, CLI_OUTPUT_MAX_BYTES)
    if (body === undefined) {
      response.statusCode = HTTP_STATUS.badRequest
      response.end()
      return
    }
    const keys = mcpRequestKeys(body)
    // Keyed by token and request id: two conversations' identical ids never
    // meet, so one's cancellation cannot stop the other's call.
    const flightKeyOf = (id: string): string => `${found.token}:${id}`
    this.cancel(keys.cancelled === undefined ? undefined : flightKeyOf(keys.cancelled))
    const flightKey = keys.request === undefined ? undefined : flightKeyOf(keys.request)
    const outcome = await this.handleInFlight(body, found.binding, found.token, flightKey, response)
    if (response.destroyed) return
    const reply = outcome.kind === 'response' ? JSON.stringify(outcome.body) : undefined
    response
      .writeHead(
        reply === undefined ? HTTP_STATUS.accepted : HTTP_STATUS.ok,
        reply === undefined ? {} : { 'content-type': JSON_CONTENT_TYPE },
      )
      .end(reply)
  }

  /** `handle`, with a failure answered 500 instead of left as an unhandled rejection (D25). */
  private async respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.handle(request, response)
    } catch {
      // Fixed words: a runner failure can contain caller data or the bearer header.
      this.log.error('Team tool server request failed')
      if (!response.headersSent) response.statusCode = HTTP_STATUS.internalServerError
      response.end()
    }
  }

  /** `listen`, forgetting the shared start once it settles. */
  private async listenOnce(controller: AbortController): Promise<string> {
    try {
      return await this.listen(controller.signal)
    } finally {
      // A cancelled start must never clear a later restart's shared promise.
      if (this.startingAbort === controller) {
        this.starting = undefined
        this.startingAbort = undefined
      }
    }
  }

  private async listen(signal: AbortSignal): Promise<string> {
    const server = createServer((request, response) => {
      void this.respond(request, response)
    })
    this.server = server
    const listening = once(server, 'listening', { signal })
    server.listen({ port: 0, host: IDE_MCP_LOOPBACK_HOST, signal })
    await listening
    signal.throwIfAborted()
    // Errors after the listen (a socket fault) are logged, never thrown at the host.
    server.on('error', (error) => {
      this.log.error(`Team tool server error: ${error.message}`)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Team tool server has no TCP address')
    }
    this.url = `http://${IDE_MCP_LOOPBACK_HOST}:${String(address.port)}${IDE_MCP_PATH}`
    this.log.info(`Team tool server listening on ${this.url}`)
    return this.url
  }

  /** Listens on an ephemeral loopback port; idempotent, and callable again after a failed start. */
  public async start(): Promise<string> {
    if (this.url !== undefined) {
      return this.url
    }
    if (this.starting === undefined) {
      const controller = new AbortController()
      this.startingAbort = controller
      this.starting = this.listenOnce(controller)
    }
    return await this.starting
  }

  /**
   * This conversation's endpoint: a token minted for it, refused everywhere
   * else. Stable for the conversation's life, so `session/resume` keeps the
   * set unchanged.
   */
  public async endpointForConversation(binding: TeamSessionBinding): Promise<TeamMcpEndpoint> {
    const lifetime = this.lifetime
    const url = await this.start()
    if (this.lifetime !== lifetime) throw new Error('Team tool server closed during startup')
    const existing = this.endpoints.get(binding)
    if (existing !== undefined) return existing
    const commands = new TeamCommandRegistry(binding.commandRecords?.save)
    if (binding.commandRecords !== undefined) {
      const saved = binding.commandRecords.load()
      if (saved !== undefined) commands.restore(teamCommandRecordsSchema.parse(saved))
    }
    const token = randomBytes(TEAM_MCP_TOKEN_BYTES).toString('hex')
    this.bindings.set(token, binding)
    const endpoint = { url, headers: { Authorization: `${BEARER_PREFIX}${token}` } }
    this.endpoints.set(binding, endpoint)
    this.commands.set(binding, commands)
    return endpoint
  }

  /** Forget a conversation's token: its calls are refused from now on. */
  public revokeConversation(endpoint: TeamMcpEndpoint): void {
    const presented = endpoint.headers['Authorization']?.slice(BEARER_PREFIX.length)
    if (presented !== undefined) {
      for (const [token, binding] of this.bindings) {
        if (!isSameSecret(presented, token)) {
          continue
        }

        this.bindings.delete(token)
        this.endpoints.delete(binding)
        this.commands.delete(binding)
        for (const key of this.inFlight.keys()) {
          if (key.startsWith(`${token}:`)) this.cancel(key)
        }
      }
    }
  }

  public close(): void {
    this.lifetime += 1
    this.startingAbort?.abort()
    this.startingAbort = undefined
    this.starting = undefined
    for (const key of this.inFlight.keys()) this.cancel(key)
    this.server?.closeAllConnections()
    this.server?.close()
    this.server = undefined
    this.url = undefined
    this.bindings.clear()
    this.endpoints.clear()
  }
}
