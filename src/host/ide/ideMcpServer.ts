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
  UI_TEXT,
  CLI_OUTPUT_MAX_BYTES,
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_PATH,
  IDE_MCP_SERVER_INFO,
  IDE_MCP_TOKEN_BYTES,
} from '../../shared/constants'
import type { Logger } from '../logger'
import type { UnattendedRun } from '../../core/schedules/unattended'
import { failureForLog } from '../../core/backends/musecode/logText'
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

interface IdeCaller {
  readonly identity: string
  readonly resolve: () => { readonly isReady: boolean; readonly run?: UnattendedRun }
  readonly lifetime: AbortController
}

/** One requester binding under a session secret: its own resolve, lifetime and identity. */
interface SessionCaller extends IdeCaller {
  readonly secret: string
}

export class IdeMcpServer {
  private readonly token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
  private server: Server | undefined
  private endpoint: IdeMcpEndpoint | undefined
  private generation = 0
  private lifetime = new AbortController()
  /** A start in flight: concurrent callers share it instead of opening two ports. */
  private starting: Promise<IdeMcpEndpoint> | undefined
  /** The calls being answered, by request id, so a cancellation can stop them (M69). */
  private readonly inFlight = new Map<McpRequestKey, Set<AbortController>>()
  private readonly callers = new Map<string, Set<SessionCaller>>()
  /**
  The secret each session was loaded with in this window: every resume of a
  session re-presents it, so a re-resume in one `muse serve` life never trips
  the CLI's MCP conflict check (a fresh secret per resume did, deterministically).
  Cleared with the callers on close.
  */
  private readonly sessionSecrets = new Map<string, string>()

  public constructor(
    /** The tools offered now, asked on every request. */
    private readonly tools: () => readonly McpTool[],
    private readonly log: Logger,
    /** B authenticates and pins a requester-specific transport before supplying vault tools. */
    private readonly vaultTools?: (
      request: IncomingMessage,
      signal: AbortSignal,
    ) => Promise<readonly McpTool[]>,
  ) {}

  /**
  Stops every call in flight under the key (M69). Muse Code 1.4.0 sends
  `notifications/cancelled` for a stopped turn's call and closes its
  request; either one stops the tool. Bound endpoints scope the key to
  their authenticated session; the legacy window endpoint shares keys.
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
    request: IncomingMessage,
    caller?: IdeCaller,
  ): Promise<McpOutcome> {
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      this.lifetime.signal,
      ...(caller === undefined ? [] : [caller.lifetime.signal]),
    ])
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
      let vault: readonly McpTool[]
      try {
        vault = (await this.vaultTools?.(request, signal)) ?? []
      } catch (error: unknown) {
        // Requester bindings can fail privately; their exception text is never logged.
        throw new Error(UI_TEXT.vault.noAccess, { cause: error })
      }
      signal.throwIfAborted()
      return await handleMcpMessage(
        body,
        this.callerTools([...this.tools(), ...vault], caller),
        IDE_MCP_SERVER_INFO,
        signal,
      )
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

  private callerTools(tools: readonly McpTool[], caller?: IdeCaller): readonly McpTool[] {
    if (caller === undefined) return tools
    return tools.map((tool) => ({
      ...tool,
      call: async (args, signal) => {
        const owner = caller.resolve()
        if (caller.lifetime.signal.aborted || !owner.isReady)
          throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
        const run = owner.run
        if (run !== undefined) {
          const decision = await run.decide(
            {
              id: tool.name,
              class: 'mcp',
              tool: tool.name,
              paths: [],
              // These tools require their own interactive confirmations. Until
              // they have a run-scoped executor, no unattended popup or purchase.
              requiresAsking: tool.callUnattended === undefined,
              protectedPath: false,
            },
            true,
          )
          if (
            !decision.allowed ||
            !caller.resolve().isReady ||
            caller.resolve().run !== run ||
            !run.isActive()
          )
            throw new Error(decision.reason ?? run.modelText.approvalRefused)
        }
        signal.throwIfAborted()
        if (run !== undefined) {
          if (tool.callUnattended === undefined)
            throw new Error(run.modelText.requiresAskingRefused)
          const result = await tool.callUnattended(args, signal, run)
          signal.throwIfAborted()
          if (!caller.resolve().isReady || caller.resolve().run !== run || !run.isActive())
            throw new Error(run.modelText.approvalRefused)
          return result
        }
        return await tool.call(args, signal)
      },
    }))
  }

  private authenticatedCaller(request: IncomingMessage): SessionCaller | true | undefined {
    const header = request.headers[AUTHORIZATION_HEADER]
    if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) return undefined
    const token = header.slice(BEARER_PREFIX.length)
    if (isSameLoopbackSecret(token, this.token)) return true
    for (const [secret, entries] of this.callers) {
      if (!isSameLoopbackSecret(token, secret)) continue
      // One secret can back several attachers (two surfaces, one session):
      // the wire names only the secret, so the latest attacher scopes the call.
      let latest: SessionCaller | undefined
      for (const entry of entries) latest = entry
      return latest
    }
    return undefined
  }

  /**
  The same credential, even across a rebind: a session re-attached mid-request
  registers a new entry under its recorded secret, which must not fail the call
  the earlier entry authenticated.
  */
  private sameCredential(
    current: SessionCaller | true | undefined,
    expected: SessionCaller | true,
  ): boolean {
    return (
      current === expected ||
      (current !== undefined &&
        current !== true &&
        expected !== true &&
        isSameLoopbackSecret(current.secret, expected.secret))
    )
  }

  /** Registers one attacher under an existing secret; the caller disposes it. */
  private bindUnderSecret(
    secret: string,
    url: string,
    resolve: IdeCaller['resolve'],
  ): {
    readonly endpoint: IdeMcpEndpoint
    dispose(): void
  } {
    const identity = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    const lifetime = new AbortController()
    const entry: SessionCaller = { identity, resolve, lifetime, secret }
    const entries = this.callers.get(secret) ?? new Set<SessionCaller>()
    entries.add(entry)
    this.callers.set(secret, entries)
    let isDisposed = false
    return {
      endpoint: { url, headers: { Authorization: `${BEARER_PREFIX}${secret}` } },
      dispose: () => {
        if (isDisposed) return
        isDisposed = true
        lifetime.abort()
        for (const [key, calls] of this.inFlight)
          if (typeof key === 'string' && key.startsWith(JSON.stringify([identity]).slice(0, -1)))
            for (const call of calls) call.abort()
        const live = this.callers.get(secret)
        if (live === undefined) return
        live.delete(entry)
        if (live.size === 0) this.callers.delete(secret)
      },
    }
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
    const caller = this.authenticatedCaller(request)
    if (caller === undefined) {
      this.log.warn('IDE tool server refused a request without the session token')
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    const lifetime = this.lifetime
    const body = await readLoopbackBody(
      request,
      CLI_OUTPUT_MAX_BYTES,
      AbortSignal.any([lifetime.signal, ...(caller === true ? [] : [caller.lifetime.signal])]),
    )
    if (
      lifetime.signal.aborted ||
      !this.sameCredential(this.authenticatedCaller(request), caller) ||
      (caller !== true && caller.lifetime.signal.aborted)
    ) {
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    if (body === undefined) {
      response.writeHead(HTTP_STATUS.badRequest).end()
      return
    }
    const keys = mcpRequestKeys(body)
    const scoped = (key: McpRequestKey): McpRequestKey =>
      caller === true ? key : JSON.stringify([caller.identity, key])
    if (keys.cancelled !== undefined) {
      this.cancel(scoped(keys.cancelled))
    }
    const outcome = await this.handleInFlight(
      body,
      keys.request === undefined ? undefined : scoped(keys.request),
      response,
      request,
      caller === true ? undefined : caller,
    )
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
      this.log.error(`IDE tool server request failed: ${failureForLog(error)}`)
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
  Binds a requester. With a session id the endpoint is stable for the session's
  life in this window: a first bind mints and records the secret, later binds
  re-present it (re-registered when its entry is gone) so every resume sends
  the config the serve runtime was loaded with. Without one every bind is fresh,
  as a session start needs. Host-minted identity uses captured MSP HTTP headers;
  no vendor field is guessed.
  */
  public async bindCaller(
    resolve: IdeCaller['resolve'],
    sessionId?: string,
  ): Promise<{
    readonly endpoint: IdeMcpEndpoint
    dispose(): void
  }> {
    const endpoint = await this.start()
    const recorded = sessionId === undefined ? undefined : this.sessionSecrets.get(sessionId)
    if (recorded !== undefined) return this.bindUnderSecret(recorded, endpoint.url, resolve)
    const secret = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    if (sessionId !== undefined) this.sessionSecrets.set(sessionId, secret)
    return this.bindUnderSecret(secret, endpoint.url, resolve)
  }

  /**
  Records the secret a session was started with (the start knows its session id
  only after the bind): a later resume re-presents it instead of minting fresh.
  Unknown or server-token endpoints are ignored.
  */
  public noteSessionSecret(sessionId: string, endpoint: IdeMcpEndpoint): void {
    const header = endpoint.headers['Authorization'] ?? endpoint.headers['authorization']
    if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) return
    const secret = header.slice(BEARER_PREFIX.length)
    if (
      secret.length === 0 ||
      isSameLoopbackSecret(secret, this.token) ||
      !this.callers.has(secret) ||
      this.sessionSecrets.has(sessionId)
    ) {
      return
    }
    this.sessionSecrets.set(sessionId, secret)
  }

  /**
  Listens on an ephemeral loopback port; idempotent, and callable again
  after a failed start (PLAN.md D25: a first failure no longer leaves the
  diagnostics tool off for the window's life).
  */
  public start(): Promise<IdeMcpEndpoint> {
    if (this.endpoint !== undefined) {
      return Promise.resolve(this.endpoint)
    }
    this.starting ??= this.listenOnce()
    return this.starting
  }

  public close(): void {
    this.lifetime.abort()
    this.lifetime = new AbortController()
    this.generation += 1
    this.server?.close()
    this.server = undefined
    this.endpoint = undefined
    for (const entries of this.callers.values())
      for (const caller of entries) caller.lifetime.abort()
    this.callers.clear()
    this.sessionSecrets.clear()
    for (const calls of this.inFlight.values()) for (const call of calls) call.abort()
  }
}
