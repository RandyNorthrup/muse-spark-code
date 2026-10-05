// The MCP servers of one Model API host (M50, PLAN.md D42): read from Muse
// Code's settings when the first conversation starts, started together
// (each within its start-up deadline), their tools offered to the model
// while they are connected, and closed with the host (the window). Only a
// trusted workspace starts any: in Restricted Mode every server stays
// stopped, and trusting the workspace starts them with the next message.
// A server that cannot start, or stops later, keeps its reason for the
// notices and the MCP servers view; its tools are withdrawn. A server whose
// tool list changes is listed again. Pure over the spawner and `fetch`.

import path from 'node:path'
import {
  MCP_REQUEST_TIMEOUT_MS,
  MCP_START_CONCURRENCY,
  MCP_TOOLS_MAX_PER_SERVER,
  MCP_TRANSPORTS,
  MILLISECONDS_PER_SECOND,
  MODEL_API_MODEL_TEXT,
} from '../../../../shared/constants'
import type { CoreLogger } from '../../../logging'
import { withDeadline } from '../../../timeouts'
import type { McpSettingsEntries } from '../../musecode/museConfigView'
import type { FunctionToolDefinition } from '../schemas'
import { McpConnection, McpTimeoutError, type McpTransport } from './connection'
import {
  type McpCallOutcome,
  mcpCallOutcome,
  mcpFunctionDefinition,
  mcpFunctionName,
} from './functions'
import { McpHttpTransport } from './http'
import { McpError, type McpToolInfo } from './protocol'
import {
  type McpLaunch,
  type McpServerPlan,
  type McpServerSpec,
  type McpSettingsFault,
  type McpStdioLaunch,
  planMcpServers,
} from './servers'
import { type McpChildProcess, McpStdioTransport } from './stdio'

export type McpServerState =
  | { readonly status: 'starting' }
  | {
      readonly status: 'connected'
      readonly toolCount: number
      /** Listed by the server but not offered (the entry's filters, the cap). */
      readonly unofferedCount: number
    }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'disabled' }
  | { readonly status: 'restricted' }

export interface McpServerStatus {
  readonly name: string
  readonly isRequired: boolean
  readonly state: McpServerState
}

export interface McpPoolSnapshot {
  /** False until the first conversation asked for the servers. */
  readonly isStarted: boolean
  /** Why no server of the settings is loaded, when that is so. */
  readonly fault: McpSettingsFault | undefined
  readonly servers: readonly McpServerStatus[]
}

/** Which server's tool a function is, and whether the server marks it read-only. */
export interface McpToolRef {
  readonly server: string
  readonly tool: string
  readonly isReadOnly: boolean
}

/** What a Model API session needs of the MCP servers. */
export interface McpToolSource {
  /** Starts them, once (again after the workspace was trusted); resolves when each has settled. */
  start(): Promise<void>
  snapshot(): McpPoolSnapshot
  /** The functions offered now: the connected servers' tools. */
  definitions(): readonly FunctionToolDefinition[]
  find(functionName: string): McpToolRef | undefined
  /** Calls the tool; rejects on a Stop, a deadline, a JSON-RPC error or a lost server. */
  call(functionName: string, argsJson: string, signal: AbortSignal): Promise<McpCallOutcome>
  close(): Promise<void>
}

export interface McpPoolDeps {
  /** The settings file read by M31's reader; may throw when the file cannot be read. */
  readonly readSettings: () => McpSettingsEntries
  /** The extension host's environment, for `${VAR}`. */
  readonly lookupEnv: (name: string) => string | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** Starts a stdio server in `cwd`; throws when it cannot be started at all. */
  readonly spawn: (
    launch: McpStdioLaunch,
    cwd: string,
    isCancelled?: () => boolean,
  ) => McpChildProcess | Promise<McpChildProcess>
  readonly fetch: typeof fetch
  readonly clientVersion: string
  readonly log: CoreLogger
}

interface OfferedTool {
  readonly functionName: string
  readonly tool: McpToolInfo
  readonly definition: FunctionToolDefinition
  readonly isReadOnly: boolean
}

interface LiveServer {
  readonly spec: McpServerSpec
  state: McpServerState
  connection: McpConnection | undefined
  tools: readonly OfferedTool[]
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function initialState(spec: McpServerSpec, isTrusted: boolean): McpServerState {
  if (!spec.isEnabled) {
    return { status: 'disabled' }
  }
  if (!isTrusted) {
    return { status: 'restricted' }
  }
  return spec.launch.ok ? { status: 'starting' } : { status: 'failed', reason: spec.launch.reason }
}

function startupDeadline(spec: McpServerSpec, launch: McpLaunch): string {
  const seconds = String(Math.round(spec.startupTimeoutMs / MILLISECONDS_PER_SECOND))
  const hint =
    launch.transport === MCP_TRANSPORTS.stdio && launch.framing === 'auto'
      ? '; if it frames its messages with Content-Length, set "framing": "content_length" in its entry'
      : ''
  return `it did not finish starting within ${seconds} s${hint}`
}

export class McpServerPool implements McpToolSource {
  private servers: LiveServer[] = []
  private fault: McpSettingsFault | undefined
  private starting: Promise<void> | undefined
  private isStartedTrusted = false
  private isClosed = false
  /** A server that exited by itself can still have a Windows child to reap. */
  private readonly closing = new Set<Promise<void>>()
  private readonly byFunction = new Map<
    string,
    { readonly server: LiveServer; readonly offered: OfferedTool }
  >()

  public constructor(private readonly deps: McpPoolDeps) {}

  private plan(): McpServerPlan {
    try {
      return planMcpServers(this.deps.readSettings(), this.deps.lookupEnv)
    } catch (error: unknown) {
      return { kind: 'fault', fault: { kind: 'unreadable', reason: describe(error) } }
    }
  }

  private async startAll(isTrusted: boolean): Promise<void> {
    const plan = this.plan()
    if (plan.kind === 'fault') {
      this.fault = plan.fault
      this.servers = []
      this.deps.log.warn(
        `No MCP server is loaded on the Model API backend: ${plan.fault.kind} fault`,
      )
      return
    }
    this.fault = undefined
    this.servers = plan.specs.map((spec) => ({
      spec,
      state: initialState(spec, isTrusted),
      connection: undefined,
      tools: [],
    }))
    for (const server of this.servers) {
      if (server.state.status === 'failed') {
        this.deps.log.warn(`MCP server ${server.spec.name} is not started: ${server.state.reason}`)
      }
    }
    const starting = this.servers.filter((server) => server.state.status === 'starting')
    for (let index = 0; index < starting.length; index += MCP_START_CONCURRENCY) {
      if (this.isClosed) {
        break
      }
      await Promise.all(
        starting.slice(index, index + MCP_START_CONCURRENCY).map((server) => this.connect(server)),
      )
    }
  }

  private cwdOf(launch: McpStdioLaunch): string {
    const p = this.deps.platform === 'win32' ? path.win32 : path.posix
    return launch.cwd === undefined
      ? this.deps.workspaceRoot
      : p.resolve(this.deps.workspaceRoot, launch.cwd)
  }

  private async transportFor(
    spec: McpServerSpec,
    launch: McpLaunch,
    isCancelled: () => boolean,
  ): Promise<McpTransport> {
    if (launch.transport === MCP_TRANSPORTS.stdio) {
      return new McpStdioTransport(await this.deps.spawn(launch, this.cwdOf(launch), isCancelled), {
        name: spec.name,
        framing: launch.framing,
        log: this.deps.log,
      })
    }
    return new McpHttpTransport({
      name: spec.name,
      url: launch.url,
      headers: launch.headers,
      fetch: this.deps.fetch,
      log: this.deps.log,
    })
  }

  private async connect(server: LiveServer): Promise<void> {
    const { spec } = server
    if (!spec.launch.ok) {
      return
    }
    const launch = spec.launch.value
    try {
      await withDeadline(
        this.open(server, launch),
        spec.startupTimeoutMs,
        startupDeadline(spec, launch),
      )
    } catch (error: unknown) {
      const { connection } = server
      server.connection = undefined
      await connection?.close()
      // The handshake's own requests share the start-up deadline: either
      // running out says the same, with the framing hint.
      this.fail(
        server,
        error instanceof McpTimeoutError ? startupDeadline(spec, launch) : describe(error),
      )
    }
  }

  /** Starts the server and lists its tools; the state says connected only if nothing ended it meanwhile. */
  private async open(server: LiveServer, launch: McpLaunch): Promise<void> {
    const { spec } = server
    const isCancelled = () => this.isClosed || server.state.status !== 'starting'
    const transport = await this.transportFor(spec, launch, isCancelled)
    if (isCancelled()) {
      await transport.close()
      throw new McpError('the servers were closed while it started')
    }
    const connection = new McpConnection(transport, {
      name: spec.name,
      clientVersion: this.deps.clientVersion,
      log: this.deps.log,
    })
    server.connection = connection
    connection.onClose((reason) => {
      this.lost(server, connection, reason)
    })
    connection.onToolsChanged(() => {
      void this.relist(server, connection)
    })
    await connection.initialize(spec.startupTimeoutMs)
    const tools = await connection.listTools(spec.startupTimeoutMs)
    if (this.isClosed || server.connection !== connection) {
      throw new McpError('the servers were closed while it started')
    }
    this.offer(server, tools)
    this.deps.log.info(
      `MCP server ${spec.name} connected (${launch.transport}): ${String(server.tools.length)} tools offered`,
    )
  }

  private fail(server: LiveServer, reason: string): void {
    this.withdraw(server)
    server.state = { status: 'failed', reason }
    this.deps.log.warn(`MCP server ${server.spec.name} could not start: ${reason}`)
  }

  /** A connected server's connection ended by itself: its tools go, its reason stays. */
  private lost(server: LiveServer, connection: McpConnection, reason: string): void {
    if (this.isClosed || server.connection !== connection || server.state.status !== 'connected') {
      return
    }
    server.connection = undefined
    this.withdraw(server)
    server.state = { status: 'failed', reason: `it stopped: ${reason}` }
    this.deps.log.warn(`MCP server ${server.spec.name} stopped: ${reason}`)
    const cleanup = (async () => {
      try {
        await connection.close()
      } catch (error: unknown) {
        this.deps.log.warn(
          `MCP server ${server.spec.name} could not finish closing: ${describe(error)}`,
        )
      }
    })()
    this.closing.add(cleanup)
    void cleanup.then(() => {
      this.closing.delete(cleanup)
    })
  }

  private withdraw(server: LiveServer): void {
    for (const offered of server.tools) {
      this.byFunction.delete(offered.functionName)
    }
    server.tools = []
  }

  /** The server's tools, filtered by its entry and capped, under their function names. */
  private offer(server: LiveServer, listed: readonly McpToolInfo[]): void {
    this.withdraw(server)
    const { spec } = server
    const allowed = listed.filter(
      (tool) =>
        (spec.enabledTools === undefined || spec.enabledTools.has(tool.name)) &&
        !spec.disabledTools.has(tool.name),
    )
    const kept = allowed.slice(0, MCP_TOOLS_MAX_PER_SERVER)
    if (allowed.length > kept.length) {
      this.deps.log.warn(
        `MCP server ${spec.name} offers ${String(allowed.length)} tools; the first ${String(MCP_TOOLS_MAX_PER_SERVER)} are offered to the model`,
      )
    }
    const taken = new Set(this.byFunction.keys())
    server.tools = kept.map((tool) => {
      const functionName = mcpFunctionName(spec.name, tool.name, taken)
      taken.add(functionName)
      const { definition, notes } = mcpFunctionDefinition(functionName, tool)
      if (notes.length > 0) {
        this.deps.log.info(
          `MCP tool ${tool.name} of ${spec.name}: its schema was fitted to the Model API (${notes.join('; ')})`,
        )
      }
      return {
        functionName,
        tool,
        definition,
        isReadOnly: tool.annotations?.readOnlyHint === true,
      }
    })
    for (const offered of server.tools) {
      this.byFunction.set(offered.functionName, { server, offered })
    }
    server.state = {
      status: 'connected',
      toolCount: server.tools.length,
      unofferedCount: listed.length - server.tools.length,
    }
  }

  /** `notifications/tools/list_changed`: the list read again; a failure is logged. */
  private async relist(server: LiveServer, connection: McpConnection): Promise<void> {
    try {
      const tools = await connection.listTools(MCP_REQUEST_TIMEOUT_MS)
      if (!this.isClosed && server.connection === connection) {
        this.offer(server, tools)
        this.deps.log.info(
          `MCP server ${server.spec.name} changed its tools: ${String(server.tools.length)} offered`,
        )
      }
    } catch (error: unknown) {
      this.deps.log.warn(
        `MCP server ${server.spec.name} changed its tools, and they could not be listed again: ${describe(error)}`,
      )
    }
  }

  public start(): Promise<void> {
    if (this.isClosed) {
      return Promise.resolve()
    }
    const isTrusted = this.deps.isWorkspaceTrusted()
    // Started in Restricted Mode and trusted since: the servers start now.
    if ((!isTrusted || this.isStartedTrusted) && this.starting !== undefined) {
      return this.starting
    }
    this.isStartedTrusted = isTrusted
    this.starting = this.startAll(isTrusted)
    return this.starting
  }

  public snapshot(): McpPoolSnapshot {
    return {
      isStarted: this.starting !== undefined,
      fault: this.fault,
      servers: this.servers.map((server) => ({
        name: server.spec.name,
        isRequired: server.spec.isRequired,
        state: server.state,
      })),
    }
  }

  public definitions(): readonly FunctionToolDefinition[] {
    return this.servers.flatMap((server) => server.tools.map((offered) => offered.definition))
  }

  public find(functionName: string): McpToolRef | undefined {
    const found = this.byFunction.get(functionName)
    return found === undefined
      ? undefined
      : {
          server: found.server.spec.name,
          tool: found.offered.tool.name,
          isReadOnly: found.offered.isReadOnly,
        }
  }

  public async call(
    functionName: string,
    argsJson: string,
    signal: AbortSignal,
  ): Promise<McpCallOutcome> {
    const found = this.byFunction.get(functionName)
    const connection = found?.server.connection
    if (found === undefined || connection === undefined) {
      throw new McpError(`${functionName} ${MODEL_API_MODEL_TEXT.mcpToolUnavailable}`)
    }
    let args: unknown
    try {
      args = argsJson.trim() === '' ? {} : JSON.parse(argsJson)
    } catch {
      args = undefined
    }
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new McpError(MODEL_API_MODEL_TEXT.mcpArgumentsNotObject)
    }
    const result = await connection.callTool(
      found.offered.tool.name,
      Object.fromEntries(Object.entries(args)),
      { timeoutMs: found.server.spec.toolTimeoutMs, signal },
    )
    return mcpCallOutcome(result)
  }

  /** Every server stopped (a stdio one's process tree killed); nothing is offered afterwards. */
  public async close(): Promise<void> {
    this.isClosed = true
    const connections = this.servers.flatMap((server) => {
      const { connection } = server
      server.connection = undefined
      this.withdraw(server)
      return connection === undefined ? [] : [connection]
    })
    await Promise.all([
      ...connections.map((connection) => connection.close()),
      ...this.closing,
      ...(this.starting === undefined ? [] : [this.starting]),
    ])
  }
}
