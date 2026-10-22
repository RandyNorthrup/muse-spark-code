// One MCP client session over a transport (M50, PLAN.md D42; both eras,
// PLAN.md D213): the handshake (`initialize`, then
// `notifications/initialized`) with a legacy server, or the version on
// every request with a modern one, the tool list page by page, and tool
// calls, each request with the entry's own deadline when it names one —
// otherwise waited on until the server answers, the connection closes or
// a Stop tells the server it was cancelled (`notifications/cancelled`),
// saying so out loud while it waits. What the server asks of the client
// is answered: `ping` with an empty result, `elicitation/create` with the
// form's answer when the host offers one (M91, form mode only), anything
// else as a method this client does not offer; on a modern server the
// form is gathered through the multi-round-trip loop instead, the server
// never sending requests of its own. Its log lines go to the extension's
// log, and a changed tool list is announced. A transport that closes
// rejects every request still waiting and stops every waiting
// elicitation. Pure over the transport (stdio.ts, http.ts).

import {
  JSON_RPC_ERRORS,
  MCP_CLIENT_NAME,
  MCP_META_CLIENT_CAPABILITIES,
  MCP_META_CLIENT_INFO,
  MCP_META_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_ELICITATION_TIMEOUT_MS,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
  MCP_TRANSPORTS,
  MILLISECONDS_PER_SECOND,
} from '../../../../shared/constants'
import { clipForLog, type CoreLogger } from '../../../logging'
import { failureForLog } from '../../musecode/logText'
import { setLongTimeout, startStillWaiting, stillWaitingText } from '../../../timeouts'
import type { ElicitationOutcome, McpElicitationHandler } from './elicitation'
import {
  type CallToolResult,
  callToolResultSchema,
  type DiscoverResult,
  discoverResultSchema,
  type IncomingMessage,
  incomingMessageSchema,
  initializeResultSchema,
  inputRequiredResultSchema,
  inputRequestSchema,
  JSON_RPC_VERSION,
  listToolsResultSchema,
  logMessageSchema,
  McpError,
  type McpToolInfo,
  newestMutualModern,
  type OutgoingMessage,
  type RequestId,
  resultTypeOf,
  toolInfoSchema,
  unsupportedVersions,
} from './protocol'

/** How messages travel to and from one server. */
export interface McpTransport {
  /**
  Sends one message. Over HTTP a request's answer comes back in the reply
  to this send, and reaches `onMessage` before the promise resolves.
  Rejects with `McpSessionExpiredError` when the server forgot the session.
  */
  send(message: OutgoingMessage, signal: AbortSignal): Promise<void>
  /** The revision `initialize` agreed on (HTTP sends it with every request). */
  setProtocolVersion(version: string): void
  onMessage(listener: (message: unknown) => void): void
  /** The transport ended (a process exited, a stream failed): once, with the reason. */
  onClose(listener: (reason: string) => void): void
  close(): Promise<void>
}

/** A streamable-HTTP server no longer knows the session (HTTP 404): start a new one. */
export class McpSessionExpiredError extends Error {
  public constructor() {
    super('the server ended the MCP session')
    this.name = 'McpSessionExpiredError'
  }
}

export interface McpConnectionOptions {
  /** The server's name in the settings, for the log. */
  readonly name: string
  readonly clientVersion: string
  readonly log: CoreLogger
  /**
  Which transport this connection runs on: cancellation on modern HTTP is
  the request's stream closing, never a `notifications/cancelled` message.
  */
  readonly transport: (typeof MCP_TRANSPORTS)[keyof typeof MCP_TRANSPORTS]
  /**
  Answers a server's `elicitation/create` (M91, form mode only). When set,
  the handshake declares the `elicitation` capability, and a modern
  request declares it in its envelope; when absent, such a request is
  refused as an unoffered method, as before.
  */
  readonly elicitation?: McpElicitationHandler
}

export interface RequestOptions {
  /**
  The entry's own deadline in milliseconds, or undefined: then the answer
  is waited on until the server answers, the connection closes or the
  signal aborts (a Stop ends it), with a still-waiting notice on the log.
  */
  readonly timeoutMs: number | undefined
  readonly signal?: AbortSignal | undefined
}

interface Waiting {
  resolve(result: unknown): void
  reject(error: Error): void
}

const METHOD_INITIALIZE = 'initialize'
const METHOD_DISCOVER = 'server/discover'
const METHOD_PING = 'ping'
const METHOD_ELICITATION = 'elicitation/create'
const METHOD_SAMPLING = 'sampling/createMessage'
const METHOD_ROOTS = 'roots/list'
/** What an `inputRequests` method the client never offers is called in the refusal. */
const UNOFFERED_NEEDS: Readonly<Record<string, string>> = {
  [METHOD_SAMPLING]: 'a model completion',
  [METHOD_ROOTS]: 'the workspace roots',
}
const METHOD_TOOLS_LIST = 'tools/list'
const METHOD_TOOLS_CALL = 'tools/call'
const RESULT_COMPLETE = 'complete'
const RESULT_INPUT_REQUIRED = 'input_required'
const NOTIFICATION_INITIALIZED = 'notifications/initialized'
const NOTIFICATION_CANCELLED = 'notifications/cancelled'
const NOTIFICATION_TOOLS_CHANGED = 'notifications/tools/list_changed'
const NOTIFICATION_LOG = 'notifications/message'
const CANCELLED_BY_USER = 'the user stopped the turn'

function seconds(ms: number): string {
  return String(Math.round(ms / MILLISECONDS_PER_SECOND))
}

/** Aborted by the deadline, or by the caller's own signal (the Stop button). */
class RequestAbort extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'McpCancelledError'
  }
}

/** A request that ran out of time; the server was told it is off. */
export class McpTimeoutError extends RequestAbort {
  public constructor(message: string) {
    super(message)
    this.name = 'McpTimeoutError'
  }
}

export class McpConnection {
  private readonly waiting = new Map<RequestId, Waiting>()
  private readonly toolListeners = new Set<() => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()
  private nextId = 0
  private closedReason: string | undefined
  private hasTools = false
  /** The modern revision every request carries, once the era is adopted. */
  private modernVersion: string | undefined
  /** The tool calls still waiting: stopping one stops its elicitation too. */
  private readonly liveSignals = new Set<AbortSignal>()
  /** What stops a waiting elicitation when the connection closes. */
  private readonly elicitationClosers = new Set<() => void>()
  /** The handshake's parameters, kept for a new session after an expired one. */
  private handshakeTimeoutMs: number | undefined = undefined

  public constructor(
    private readonly transport: McpTransport,
    private readonly options: McpConnectionOptions,
  ) {
    transport.onMessage((message) => {
      this.receive(message)
    })
    transport.onClose((reason) => {
      this.closed(reason)
    })
  }

  private closed(reason: string): void {
    if (this.closedReason !== undefined) {
      return
    }
    this.closedReason = reason
    for (const waiting of this.waiting.values()) {
      waiting.reject(new McpError(`the connection closed: ${reason}`))
    }
    this.waiting.clear()
    for (const closer of this.elicitationClosers) {
      closer()
    }
    this.elicitationClosers.clear()
    for (const listener of this.closeListeners) {
      listener(reason)
    }
  }

  private receive(raw: unknown): void {
    // Revision 2025-03-26 allowed batches; each member is one message.
    const candidates: readonly unknown[] = Array.isArray(raw) ? raw : [raw]
    for (const candidate of candidates) {
      const parsed = incomingMessageSchema.safeParse(candidate)
      if (!parsed.success) {
        this.options.log.warn(
          `MCP server ${this.options.name} sent a message that is not JSON-RPC 2.0; skipped: ${clipForLog(JSON.stringify(candidate))}`,
        )
        continue
      }
      this.dispatch(parsed.data)
    }
  }

  private dispatch(message: IncomingMessage): void {
    const { id, method } = message
    if (method === undefined) {
      this.settle(message)
      return
    }
    if (id === undefined || id === null) {
      this.notice(method, message.params)
      return
    }
    // A request of the server's own: `ping` is answered, and
    // `elicitation/create` goes to the form when one is offered; the client
    // offers nothing else (no sampling or roots).
    if (method === METHOD_PING) {
      void this.sendQuietly({ jsonrpc: JSON_RPC_VERSION, id, result: {} })
      return
    }
    if (method === METHOD_ELICITATION && this.options.elicitation !== undefined) {
      void this.answerElicitation(id, this.options.elicitation, message.params)
      return
    }
    void this.sendQuietly({
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: { code: JSON_RPC_ERRORS.methodNotFound, message: `Method not found: ${method}` },
    })
  }

  /**
  A signal for one elicitation: it ends when the connection closes, when
  a tool call still waiting stops (a Stop ends the form as a cancel), or
  when the caller's own signal ends (the modern loop passes its call's).
  */
  private elicitationSignal(extra?: AbortSignal): {
    readonly signal: AbortSignal
    readonly cancel: () => void
    readonly release: () => void
  } {
    const controller = new AbortController()
    if (this.closedReason !== undefined) {
      controller.abort()
      return {
        signal: controller.signal,
        cancel: () => {
          controller.abort()
        },
        release: () => {
          controller.abort()
        },
      }
    }
    const stop = () => {
      controller.abort()
    }
    this.elicitationClosers.add(stop)
    const releases: (() => void)[] = [
      () => {
        this.elicitationClosers.delete(stop)
      },
    ]
    const stoppers: readonly AbortSignal[] =
      extra === undefined ? [...this.liveSignals] : [...this.liveSignals, extra]
    for (const live of stoppers) {
      if (live.aborted) {
        stop()
        break
      }
      live.addEventListener('abort', stop, { once: true })
      releases.push(() => {
        live.removeEventListener('abort', stop)
      })
    }
    return {
      signal: controller.signal,
      cancel: stop,
      release: () => {
        controller.abort()
        for (const release of releases) {
          release()
        }
      },
    }
  }

  /**
  One elicitation's answer, shared by the legacy wire answer and the
  modern multi-round-trip loop: parsed, schema-checked (an unsupported
  schema declines, as before), asked of the host, and checked back into
  shape. Throws the refusal, which never contains request values.
  */
  private async resolveElicitation(
    elicit: McpElicitationHandler,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<ElicitationOutcome> {
    const { signal: stop, cancel, release } = this.elicitationSignal(signal)
    const stopped = new Promise<ElicitationOutcome>((resolve) => {
      const onStop = () => {
        resolve({ action: 'cancel' })
      }
      stop.addEventListener('abort', onStop, { once: true })
      if (stop.aborted) onStop()
    })
    const timer = setTimeout(cancel, MCP_ELICITATION_TIMEOUT_MS)
    try {
      // The params crossed the wire parsed (rule 7); the answer is checked
      // into shape before it goes back the same way. The checks load with the
      // hook and MCP-form runtime (dist/hookRuntime.js, M91): a bundle that
      // cannot load refuses the request, never accepts it.
      const {
        checkElicitationOutcome,
        parseElicitationParams,
        validateElicitationSchema,
        validateElicitationValues,
      } = await import('../hookRuntimeEntry.js')
      // The parser throws only its fixed diagnostics, which never contain
      // request values.
      const parsed = parseElicitationParams(params)
      const schema = validateElicitationSchema(parsed.requestedSchema)
      if (!schema.ok) {
        this.options.log.warn(
          `MCP server ${this.options.name} elicitation declined: ${schema.reason}`,
        )
        return { action: 'decline' }
      }
      let outcome: ElicitationOutcome
      try {
        outcome = checkElicitationOutcome(
          await Promise.race([elicit({ params, signal: stop }), stopped]),
        )
      } catch (error: unknown) {
        // The host's failure keeps its kind in the log; the refusal stays fixed.
        this.options.log.warn(
          `MCP server ${this.options.name} elicitation handler failed: ${failureForLog(error)}`,
        )
        throw new McpError('the elicitation handler failed')
      }
      if (outcome.action === 'accept') {
        const checked = validateElicitationValues(schema.fields, outcome.content ?? {})
        if (!checked.ok) {
          throw new McpError('the elicitation answer does not fit the requested schema')
        }
      }
      return outcome
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  /** The form's answer back to the server; a refusal carries its reason. */
  private async answerElicitation(
    id: RequestId,
    elicit: McpElicitationHandler,
    params: unknown,
  ): Promise<void> {
    try {
      await this.sendQuietly({
        jsonrpc: JSON_RPC_VERSION,
        id,
        result: await this.resolveElicitation(elicit, params),
      })
    } catch (error: unknown) {
      const refusal = error instanceof McpError ? error.message : 'the elicitation handler failed'
      this.options.log.warn(`MCP server ${this.options.name} elicitation was refused: ${refusal}`)
      await this.sendQuietly({
        jsonrpc: JSON_RPC_VERSION,
        id,
        error: { code: JSON_RPC_ERRORS.invalidParams, message: refusal },
      })
    }
  }

  private settle(message: IncomingMessage): void {
    const { id } = message
    const waiting = id === undefined || id === null ? undefined : this.waiting.get(id)
    if (waiting === undefined) {
      this.options.log.warn(
        `MCP server ${this.options.name} answered a request that is not waiting (${String(id)})`,
      )
      return
    }
    if (message.error === undefined) {
      waiting.resolve(message.result)
      return
    }
    waiting.reject(
      new McpError(
        `MCP error ${String(message.error.code)}: ${message.error.message}`,
        message.error.code,
        message.error.data,
      ),
    )
  }

  private notice(method: string, params: unknown): void {
    if (method === NOTIFICATION_TOOLS_CHANGED) {
      for (const listener of this.toolListeners) {
        listener()
      }
      return
    }
    // Progress, cancellation and resource notifications need nothing here.
    const parsed = method === NOTIFICATION_LOG ? logMessageSchema.safeParse(params) : undefined
    if (parsed?.success !== true) {
      return
    }
    const { level, data } = parsed.data
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    this.options.log.info(`MCP server ${this.options.name} (${level}): ${clipForLog(text)}`)
  }

  /** A message whose failure is only logged: an answer, a notification after the fact. */
  private async sendQuietly(message: OutgoingMessage): Promise<void> {
    try {
      await this.transport.send(message, new AbortController().signal)
    } catch {
      // The record names the undelivered message, never the failure's text.
      this.options.log.warn(`A message to MCP server ${this.options.name} was not delivered`)
    }
  }

  /** `send`, starting a new session once when the server forgot the old one. */
  private async sendRenewing(message: OutgoingMessage, signal: AbortSignal): Promise<void> {
    try {
      await this.transport.send(message, signal)
    } catch (error: unknown) {
      if (!(error instanceof McpSessionExpiredError) || !('method' in message)) {
        throw error
      }
      this.options.log.info(
        `MCP server ${this.options.name} ended its session; starting a new one and sending ${message.method} again`,
      )
      await this.handshake(this.handshakeTimeoutMs)
      await this.transport.send(message, signal)
    }
  }

  /**
  The modern per-request envelope (spec `basic/index#meta`): the version,
  the client identity and the capabilities relevant to the request. A
  legacy request passes through untouched.
  */
  private envelope(params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const version = this.modernVersion
    if (version === undefined) {
      return params
    }
    const existing: unknown = params['_meta']
    const kept = typeof existing === 'object' && existing !== null && existing
    return {
      ...params,
      _meta: {
        ...kept,
        [MCP_META_PROTOCOL_VERSION]: version,
        [MCP_META_CLIENT_INFO]: { name: MCP_CLIENT_NAME, version: this.options.clientVersion },
        [MCP_META_CLIENT_CAPABILITIES]:
          this.options.elicitation === undefined ? {} : { elicitation: {} },
      },
    }
  }

  private async request(
    method: string,
    params: Readonly<Record<string, unknown>>,
    options: RequestOptions,
  ): Promise<unknown> {
    let retryVersion: string | undefined
    try {
      return await this.attempt(method, params, options)
    } catch (error: unknown) {
      // A modern server names the versions it serves in a `-32022`; the
      // request goes again once at a mutual one (the spec's corrective
      // continuation), never to the version already in use. The probe
      // itself never retries: its answer is the era verdict.
      const versions = error instanceof McpError ? unsupportedVersions(error) : undefined
      const mutual = versions === undefined ? undefined : newestMutualModern(versions.supported)
      if (method === METHOD_DISCOVER || this.modernVersion === undefined) {
        throw error
      }
      if (mutual === undefined || mutual === this.modernVersion) {
        throw error
      }
      this.options.log.info(
        `MCP server ${this.options.name} does not speak MCP ${this.modernVersion}; trying MCP ${mutual}`,
      )
      retryVersion = mutual
    }
    this.modernVersion = retryVersion
    return await this.attempt(method, params, options)
  }

  private async attempt(
    method: string,
    params: Readonly<Record<string, unknown>>,
    options: RequestOptions,
  ): Promise<unknown> {
    if (this.closedReason !== undefined) {
      throw new McpError(`the connection closed: ${this.closedReason}`)
    }
    this.nextId += 1
    const id = this.nextId
    const answered = new Promise<unknown>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
    })
    const controller = new AbortController()
    this.liveSignals.add(controller.signal)
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          const reason: unknown = controller.signal.reason
          reject(reason instanceof Error ? reason : new Error(String(reason)))
        },
        { once: true },
      )
    })
    // The entry's own deadline ends the wait; without one the answer is
    // waited on until the server answers, the connection closes or a Stop
    // aborts, saying so out loud on the log (owner 2026-10-16: no silent
    // hangs, no arbitrary limits). The entry's number is honoured whole,
    // past one timer's range too.
    const timeoutMs = options.timeoutMs
    const cancelTimer =
      timeoutMs === undefined
        ? undefined
        : setLongTimeout(() => {
            controller.abort(
              new McpTimeoutError(`${method} timed out after ${seconds(timeoutMs)} s`),
            )
          }, timeoutMs)
    const stopNoticing =
      timeoutMs === undefined
        ? startStillWaiting((elapsedMs) => {
            this.options.log.info(
              stillWaitingText(
                { key: 'mcpServerRequest', name: this.options.name, method },
                elapsedMs,
              ),
            )
          })
        : undefined
    const onStop = () => {
      controller.abort(new RequestAbort(CANCELLED_BY_USER))
    }
    if (options.signal?.aborted === true) {
      onStop()
    }
    options.signal?.addEventListener('abort', onStop, { once: true })
    try {
      await Promise.race([
        this.sendRenewing(
          { jsonrpc: JSON_RPC_VERSION, id, method, params: this.envelope(params) },
          controller.signal,
        ),
        aborted,
      ])
      return await Promise.race([answered, aborted])
    } catch (error: unknown) {
      // The server is told a request it may still be working on is off;
      // `initialize` and `server/discover` are never cancelled (the
      // specification), and on modern HTTP closing the request's stream
      // is the signal, so no message is sent there either.
      const isModernHttp =
        this.modernVersion !== undefined && this.options.transport === MCP_TRANSPORTS.streamableHttp
      if (
        method !== METHOD_INITIALIZE &&
        method !== METHOD_DISCOVER &&
        !isModernHttp &&
        error instanceof RequestAbort
      ) {
        void this.sendQuietly({
          jsonrpc: JSON_RPC_VERSION,
          method: NOTIFICATION_CANCELLED,
          params: { requestId: id, reason: error.message },
        })
      }
      throw error
    } finally {
      cancelTimer?.()
      stopNoticing?.()
      options.signal?.removeEventListener('abort', onStop)
      this.waiting.delete(id)
      this.liveSignals.delete(controller.signal)
      controller.abort(new RequestAbort(CANCELLED_BY_USER))
    }
  }

  private async handshake(timeoutMs: number | undefined): Promise<string> {
    const raw = await this.request(
      METHOD_INITIALIZE,
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        // The form capability is declared for the whole session when the
        // host answers elicitations, so a server's tool list stays stable
        // within the session (M91 lane M).
        capabilities: this.options.elicitation === undefined ? {} : { elicitation: {} },
        clientInfo: { name: MCP_CLIENT_NAME, version: this.options.clientVersion },
      },
      { timeoutMs },
    )
    const parsed = initializeResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new McpError('initialize was answered with something that is not an initialize result')
    }
    const { protocolVersion, capabilities } = parsed.data
    if (!MCP_SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
      throw new McpError(
        `the server speaks MCP ${protocolVersion}; this client speaks ${[...MCP_SUPPORTED_PROTOCOL_VERSIONS].join(', ')}`,
      )
    }
    this.transport.setProtocolVersion(protocolVersion)
    this.hasTools = capabilities.tools !== undefined
    await this.transport.send(
      { jsonrpc: JSON_RPC_VERSION, method: NOTIFICATION_INITIALIZED },
      new AbortController().signal,
    )
    return protocolVersion
  }

  /**
  One multi-round-trip round (spec `basic/patterns/mrtr`): the
  `inputRequests` answered through the host, the opaque `requestState`
  echoed back untouched, and the retry's params. A repeated state means
  the server is not advancing: the call stops and says so instead of
  looping, like a repeated page cursor.
  */
  private async fulfillInput(
    name: string,
    args: Readonly<Record<string, unknown>>,
    raw: unknown,
    options: RequestOptions,
    seenStates: Set<string>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const parsed = inputRequiredResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new McpError('tools/call asked for input it did not describe')
    }
    const { inputRequests, requestState } = parsed.data
    if (inputRequests === undefined && requestState === undefined) {
      throw new McpError('tools/call asked for input with neither requests nor state')
    }
    if (requestState !== undefined) {
      if (seenStates.has(requestState)) {
        throw new McpError(`tools/call for ${name} repeated its request state instead of advancing`)
      }
      seenStates.add(requestState)
    }
    const elicit = this.options.elicitation
    const responses: Record<string, ElicitationOutcome> = {}
    const requests = Object.entries(inputRequests ?? {})
    for (const [key, candidate] of requests) {
      const entry = inputRequestSchema.safeParse(candidate)
      if (!entry.success) {
        throw new McpError(`tools/call for ${name} asked for input through a malformed request`)
      }
      const { method, params } = entry.data
      if (method !== METHOD_ELICITATION) {
        const need = UNOFFERED_NEEDS[method] ?? 'an input'
        throw new McpError(`tools/call for ${name} needs ${need}, which this client does not offer`)
      }
      if (elicit === undefined) {
        throw new McpError(
          `tools/call for ${name} asked for an answer the client did not offer to give`,
        )
      }
      try {
        responses[key] = await this.resolveElicitation(elicit, params, options.signal)
      } catch (error: unknown) {
        const refusal = error instanceof McpError ? error.message : 'the elicitation handler failed'
        if (error instanceof McpError) {
          this.options.log.warn(
            `MCP server ${this.options.name} elicitation was refused: ${refusal}`,
          )
          throw error
        }
        this.options.log.warn(
          `MCP server ${this.options.name} elicitation handler failed: ${failureForLog(error)}`,
        )
        throw new McpError(refusal)
      }
    }
    return {
      name,
      arguments: args,
      ...(inputRequests !== undefined && { inputResponses: responses }),
      ...(requestState !== undefined && { requestState }),
    }
  }

  /**
  The modern era, adopted from a `server/discover` verdict: every request
  from now on carries the version, and the tools capability is the
  verdict's.
  */
  public adoptModern(version: string, hasTools: boolean): void {
    this.modernVersion = version
    this.hasTools = hasTools
  }

  /** One `server/discover` at the adopted version; the raw verdict, parsed. */
  public async discover(
    timeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<DiscoverResult> {
    const raw = await this.request(
      METHOD_DISCOVER,
      {},
      signal === undefined ? { timeoutMs } : { timeoutMs, signal },
    )
    const parsed = discoverResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new McpError('server/discover was answered without a discovery result')
    }
    return parsed.data
  }

  /** The handshake; resolves with the settled revision, rejects when the server cannot be spoken to. */
  public async initialize(timeoutMs: number | undefined): Promise<string> {
    this.handshakeTimeoutMs = timeoutMs
    let corrective: { mutual: string; failure: unknown } | undefined
    try {
      return await this.handshake(timeoutMs)
    } catch (error: unknown) {
      // The probe may have timed out client-side while the server was
      // still starting; a `-32022` naming a mutual modern version is
      // positive modern evidence, so the session goes modern instead of
      // failing (the official Python client's corrective step).
      const versions = error instanceof McpError ? unsupportedVersions(error) : undefined
      const mutual = versions === undefined ? undefined : newestMutualModern(versions.supported)
      if (mutual === undefined) {
        throw error
      }
      this.options.log.info(
        `MCP server ${this.options.name} speaks modern MCP; adopting ${mutual} after all`,
      )
      corrective = { mutual, failure: error }
    }
    this.adoptModern(corrective.mutual, true)
    const discover = await this.discover(timeoutMs)
    if (newestMutualModern(discover.supportedVersions) === undefined) {
      throw corrective.failure
    }
    this.hasTools = discover.capabilities.tools !== undefined
    return corrective.mutual
  }

  /** Every tool the server lists, page by page; a malformed tool is skipped and logged. */
  public async listTools(timeoutMs: number | undefined): Promise<readonly McpToolInfo[]> {
    if (!this.hasTools) {
      return []
    }
    const tools: McpToolInfo[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const raw = await this.request(METHOD_TOOLS_LIST, cursor === undefined ? {} : { cursor }, {
        timeoutMs,
      })
      // A modern answer names its `resultType`; a legacy one names none
      // and reads as complete. `input_required` never answers a list.
      const resultType = resultTypeOf(raw)
      if (resultType !== undefined && resultType !== RESULT_COMPLETE) {
        throw new McpError(
          resultType === RESULT_INPUT_REQUIRED
            ? 'tools/list was answered asking for input, which a list never does'
            : 'tools/list was answered with an unrecognized result type',
        )
      }
      const parsed = listToolsResultSchema.safeParse(raw)
      if (!parsed.success) {
        throw new McpError('tools/list was answered without a list of tools')
      }
      for (const candidate of parsed.data.tools) {
        const tool = toolInfoSchema.safeParse(candidate)
        if (tool.success) {
          tools.push(tool.data)
        } else {
          this.options.log.warn(
            `MCP server ${this.options.name} listed a tool without a name or with a malformed schema; skipped: ${clipForLog(JSON.stringify(candidate))}`,
          )
        }
      }
      cursor = parsed.data.nextCursor ?? undefined
      if (cursor === undefined || cursor === '') {
        return tools
      }
      // No page cap (B8), but a cursor the server already named would page
      // forever: stop at the repeat and say so instead of hanging.
      if (seenCursors.has(cursor)) {
        this.options.log.warn(
          `MCP server ${this.options.name} repeated a tools/list cursor; the tools read so far are offered`,
        )
        return tools
      }
      seenCursors.add(cursor)
    }
  }

  /** Calls one tool; rejects on a JSON-RPC error, the entry's own deadline when named, a Stop or a closed connection. */
  public async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: RequestOptions,
  ): Promise<CallToolResult> {
    // A modern call may come back `input_required`: the rounds run with
    // the host's answers until the tool completes. A legacy call answers
    // once; it names no `resultType` and reads as complete.
    let params: Readonly<Record<string, unknown>> = { name, arguments: args }
    const seenStates = new Set<string>()
    for (;;) {
      const raw = await this.request(METHOD_TOOLS_CALL, params, options)
      const resultType = resultTypeOf(raw)
      if (
        resultType !== undefined &&
        resultType !== RESULT_COMPLETE &&
        resultType !== RESULT_INPUT_REQUIRED
      ) {
        throw new McpError('tools/call was answered with an unrecognized result type')
      }
      if (resultType !== RESULT_INPUT_REQUIRED) {
        const parsed = callToolResultSchema.safeParse(raw)
        if (!parsed.success) {
          throw new McpError('tools/call was answered with something that is not a tool result')
        }
        return parsed.data
      }
      params = await this.fulfillInput(name, args, raw, options, seenStates)
    }
  }

  /** The server said its tool list changed (`notifications/tools/list_changed`). */
  public onToolsChanged(listener: () => void): void {
    this.toolListeners.add(listener)
  }

  /** The connection ended by itself (the process exited, the stream failed). */
  public onClose(listener: (reason: string) => void): void {
    this.closeListeners.add(listener)
  }

  public get isOpen(): boolean {
    return this.closedReason === undefined
  }

  /** Closes the transport; whatever still waits is rejected. Listeners are not told. */
  public async close(): Promise<void> {
    this.closeListeners.clear()
    this.toolListeners.clear()
    this.closed('the client closed it')
    await this.transport.close()
  }
}
