// The streamable-HTTP transport (M50, PLAN.md D42; both eras, PLAN.md
// D213; MCP 2025-06-18, "Transports"): every message is a POST to the
// server's one endpoint,
// accepting JSON or an event stream. A request's answer comes back in the
// POST's own reply, as one JSON body or as server-sent events that may carry
// the server's own requests and notifications first; a notification or an
// answer is accepted with 202. The session the server names in
// `Mcp-Session-Id` is sent back with every later message, and the agreed
// revision in `MCP-Protocol-Version`; a 404 on a known session means it
// expired (the connection starts a new one). A modern request also carries
// its envelope's version in `MCP-Protocol-Version`, its method in
// `Mcp-Method`, its tool in `Mcp-Name` and its tool's annotated arguments
// in `Mcp-Param-{Name}` (headers.ts), and a modern refusal in a 400 or
// 404 body is read for its code and versions (never its text). A modern
// `subscriptions/listen` holds its POST's own event stream until the
// server or the client ends it. Closing sends DELETE for the session. The
// headers of the server's entry (a bearer token) go with every message; a
// 401 or 403 says that sign-ins made with `muse mcp login` are Muse Code's
// own, which this backend never reads. A redirect is refused, so
// credentials never follow one elsewhere. Every reply is read up to
// MCP_MESSAGE_MAX_BYTES. A legacy server's own event stream (GET) is not
// opened: a notification it would carry arrives with the next reply
// instead.

import {
  BYTES_PER_MIB,
  HTTP_STATUS,
  MCP_ERROR_HEADER_MISMATCH,
  MCP_ERROR_MISSING_CLIENT_CAPABILITY,
  MCP_HTTP_CLOSE_TIMEOUT_MS,
  MCP_MESSAGE_MAX_BYTES,
  MCP_META_PROTOCOL_VERSION,
  MCP_MODERN_ERROR_CODES,
} from '../../../../shared/constants'
import type { CoreLogger } from '../../../logging'
import { parseSse } from '../sse'
import { type McpTransport, McpSessionExpiredError } from './connection'
import { encodeHeaderValue } from './headers'
import {
  incomingMessageSchema,
  isRequest,
  McpError,
  type OutgoingMessage,
  type RequestId,
  unsupportedVersionDataSchema,
} from './protocol'

export interface HttpTransportOptions {
  readonly name: string
  readonly url: string
  /** The entry's own headers, `${VAR}` already expanded. */
  readonly headers: Readonly<Record<string, string>>
  readonly fetch: typeof fetch
  readonly log: CoreLogger
}

const SESSION_HEADER = 'mcp-session-id'
const VERSION_HEADER = 'mcp-protocol-version'
const METHOD_HEADER = 'mcp-method'
const NAME_HEADER = 'mcp-name'
const CONTENT_TYPE = 'content-type'
const ACCEPT = 'accept'
const JSON_MEDIA_TYPE = 'application/json'
const EVENT_STREAM_MEDIA_TYPE = 'text/event-stream'
const ACCEPTED_MEDIA_TYPES = `${JSON_MEDIA_TYPE}, ${EVENT_STREAM_MEDIA_TYPE}`
const WWW_AUTHENTICATE = 'www-authenticate'
const AUTH_SCHEME = /^[A-Za-z][A-Za-z0-9_-]*$/
const TOOLS_CALL = 'tools/call'

/** The modern revision a message carries in its envelope, if it carries one. */
function modernVersionOf(message: OutgoingMessage): string | undefined {
  if (!('method' in message) || message.params === undefined) {
    return undefined
  }
  const meta: unknown = message.params['_meta']
  if (typeof meta !== 'object' || meta === null) {
    return undefined
  }
  for (const [key, value] of Object.entries(meta)) {
    if (key === MCP_META_PROTOCOL_VERSION) {
      return typeof value === 'string' ? value : undefined
    }
  }
  return undefined
}

/**
A 400 or 404 body read for a modern JSON-RPC error: the error with its
code and versions, or undefined when the body carries anything else (a
legacy error, prose, or nothing at all).
*/
export function modernRefusalError(text: string): McpError | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    // Not JSON: not a modern refusal.
    if (error instanceof SyntaxError) {
      return undefined
    }
    throw error
  }
  const parsed = incomingMessageSchema.safeParse(body)
  if (!parsed.success) {
    return undefined
  }
  const code = parsed.data.error?.code
  return code === undefined || !MCP_MODERN_ERROR_CODES.has(code)
    ? undefined
    : new McpError(
        modernRefusalMessage(code, parsed.data.error?.data),
        code,
        parsed.data.error?.data,
      )
}

/** A modern refusal's fixed sentence: its code, and the versions it names. Never the server's text. */
function modernRefusalMessage(code: number, data: unknown): string {
  if (code === MCP_ERROR_HEADER_MISMATCH) {
    return `MCP error ${String(code)}: the request headers do not match the request body`
  }
  if (code === MCP_ERROR_MISSING_CLIENT_CAPABILITY) {
    return `MCP error ${String(code)}: the request needs a client capability this client did not declare`
  }
  const versions = unsupportedVersionDataSchema.safeParse(data)
  const supported = versions.success ? versions.data.supported : []
  if (supported.length === 0) {
    return `MCP error ${String(code)}: the server refused the protocol version`
  }
  const requested = versions.success ? versions.data.requested : undefined
  return requested === undefined
    ? `MCP error ${String(code)}: the server serves only MCP ${supported.join(', ')}`
    : `MCP error ${String(code)}: the server does not speak MCP ${requested}; it serves ${supported.join(', ')}`
}

function tooLarge(): McpError {
  return new McpError(
    `the server's reply is over ${String(MCP_MESSAGE_MAX_BYTES / BYTES_PER_MIB)} MiB`,
  )
}

/** The body's chunks, refusing one that runs past the cap. */
async function* capped(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  let size = 0
  for await (const chunk of body) {
    size += chunk.length
    if (size > MCP_MESSAGE_MAX_BYTES) {
      throw tooLarge()
    }
    yield chunk
  }
}

async function cappedText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (body === null) {
    return ''
  }
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of capped(body)) {
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}

/** Whether a parsed reply is (or, as a batch, holds) the answer to `id`. */
function isAnswerTo(message: unknown, id: RequestId): boolean {
  const members: readonly unknown[] = Array.isArray(message) ? message : [message]
  return members.some(
    (member) =>
      typeof member === 'object' &&
      member !== null &&
      'id' in member &&
      member.id === id &&
      !('method' in member),
  )
}

export class McpHttpTransport implements McpTransport {
  private sessionId: string | undefined
  private protocolVersion: string | undefined
  private readonly messageListeners = new Set<(message: unknown) => void>()
  private isClosed = false

  public constructor(private readonly options: HttpTransportOptions) {}

  private headers(
    message?: OutgoingMessage,
    paramHeaders?: Readonly<Record<string, string>>,
  ): Headers {
    const headers = new Headers(this.options.headers)
    headers.set(CONTENT_TYPE, JSON_MEDIA_TYPE)
    headers.set(ACCEPT, ACCEPTED_MEDIA_TYPES)
    if (this.sessionId !== undefined) {
      headers.set(SESSION_HEADER, this.sessionId)
    }
    // A modern message names its own revision in its envelope; the
    // header mirrors that same value, so the two cannot mismatch. A
    // legacy message carries the revision the handshake agreed on.
    const modern = message === undefined ? undefined : modernVersionOf(message)
    const version = modern ?? this.protocolVersion
    if (version !== undefined) {
      headers.set(VERSION_HEADER, version)
    }
    if (modern !== undefined && message !== undefined && isRequest(message)) {
      headers.set(METHOD_HEADER, message.method)
      if (message.method === TOOLS_CALL) {
        const name: unknown = message.params?.['name']
        if (typeof name === 'string') {
          headers.set(NAME_HEADER, encodeHeaderValue(name))
        }
      }
      // A tool call's annotated arguments, mirrored by the connection
      // from the tool's latest listing; a legacy message never has any.
      const mirrored = Object.entries(paramHeaders ?? {})
      for (const [header, value] of mirrored) {
        headers.set(header, value)
      }
    }
    return headers
  }

  private emit(message: unknown): void {
    for (const listener of this.messageListeners) {
      listener(message)
    }
  }

  /** Why a reply that is not a success fails the message. */
  private async refusal(response: Response): Promise<Error> {
    if (response.status === HTTP_STATUS.notFound && this.sessionId !== undefined) {
      this.sessionId = undefined
      await response.body?.cancel()
      return new McpSessionExpiredError()
    }
    if (response.status === HTTP_STATUS.unauthorized || response.status === HTTP_STATUS.forbidden) {
      await response.body?.cancel()
      const challenge = response.headers.get(WWW_AUTHENTICATE)
      const first = challenge?.trim().split(/\s+/, 1)[0]
      const scheme = first !== undefined && AUTH_SCHEME.test(first) ? first : undefined
      return new McpError(
        `HTTP ${String(response.status)}: the server refused the credentials${scheme === undefined ? '' : ` (it asks for ${scheme})`}. A sign-in made with muse mcp login is Muse Code's own; give this backend the credential as a header in the server's entry`,
      )
    }
    // A modern refusal arrives in the body of a 400 (or a 404 for an
    // unknown method): its code and versions are read, since the era
    // verdict and the version retry need them. Anything else keeps the
    // status-only refusal: a remote server may echo a credential in its
    // error body, and the status is enough to diagnose the failure
    // without handing that body to the log or model.
    const modern = await this.modernRefusal(response)
    if (modern !== undefined) {
      return modern
    }
    await response.body?.cancel()
    return new McpError(`HTTP ${String(response.status)} ${response.statusText}`.trim())
  }

  /** A 400 or 404 body carrying a modern JSON-RPC error, read for its code and versions. */
  private async modernRefusal(response: Response): Promise<McpError | undefined> {
    if (response.status !== HTTP_STATUS.badRequest && response.status !== HTTP_STATUS.notFound) {
      return undefined
    }
    let text: string
    try {
      text = await cappedText(response.body)
    } catch (error: unknown) {
      // A body that runs past the cap is not a modern refusal: the
      // status-only refusal says enough.
      if (error instanceof McpError) {
        return undefined
      }
      throw error
    }
    return modernRefusalError(text)
  }

  /** Delivers the messages of an event stream until the answer to `id` has come. */
  private async readEvents(
    body: ReadableStream<Uint8Array>,
    id: RequestId | undefined,
  ): Promise<boolean> {
    let isAnswered = false
    const events = parseSse(capped(body))
    for await (const event of events) {
      if (event.data.trim() === '') {
        continue
      }
      let message: unknown
      try {
        message = JSON.parse(event.data)
      } catch {
        this.options.log.warn(
          `MCP server ${this.options.name} sent an event that is not JSON; skipped`,
        )
        continue
      }
      this.emit(message)
      if (id !== undefined && isAnswerTo(message, id)) {
        isAnswered = true
        break
      }
    }
    return isAnswered
  }

  /** The reply's messages delivered; whether it held the answer to `id`. */
  private async readReply(response: Response, id: RequestId | undefined): Promise<boolean> {
    const type = response.headers.get(CONTENT_TYPE) ?? ''
    if (type.includes(EVENT_STREAM_MEDIA_TYPE) && response.body !== null) {
      try {
        return await this.readEvents(response.body, id)
      } finally {
        // A server may keep the stream open after the answer; it is not needed.
        try {
          await response.body.cancel()
        } catch {
          // The stream had already ended.
        }
      }
    }
    const text = await cappedText(response.body)
    if (text.trim() === '') {
      return false
    }
    if (!type.includes(JSON_MEDIA_TYPE)) {
      throw new McpError(`the server answered with ${type === '' ? 'no content type' : type}`)
    }
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch (error: unknown) {
      if (!(error instanceof SyntaxError)) throw error
      throw new McpError('the server answered with JSON that does not parse')
    }
    this.emit(message)
    return id !== undefined && isAnswerTo(message, id)
  }

  /** One message POSTed; the reply when it is a success, else its refusal thrown. */
  private async post(
    message: OutgoingMessage,
    signal: AbortSignal,
    paramHeaders?: Readonly<Record<string, string>>,
  ): Promise<Response> {
    if (this.isClosed) {
      throw new McpError('the connection is closed')
    }
    let response: Response
    try {
      response = await this.options.fetch(this.options.url, {
        method: 'POST',
        headers: this.headers(message, paramHeaders),
        body: JSON.stringify(message),
        signal,
        redirect: 'error',
      })
    } catch (error: unknown) {
      if (signal.aborted) {
        throw error
      }
      // A failed fetch rejects with TypeError; anything else is not the
      // server's fault. The record names the server, never the failure text.
      if (!(error instanceof TypeError)) throw error
      throw new McpError('the server could not be reached')
    }
    const session = response.headers.get(SESSION_HEADER)
    if (session !== null && session !== '') {
      this.sessionId = session
    }
    if (!response.ok) {
      throw await this.refusal(response)
    }
    return response
  }

  public async send(
    message: OutgoingMessage,
    signal: AbortSignal,
    paramHeaders?: Readonly<Record<string, string>>,
  ): Promise<void> {
    const response = await this.post(message, signal, paramHeaders)
    const request = isRequest(message) ? message : undefined
    const isAnswered = await this.readReply(response, request?.id)
    if (request !== undefined && !isAnswered) {
      throw new McpError(`the server's reply to ${request.method} carried no answer`)
    }
  }

  /**
  Holds a `subscriptions/listen` POST's event stream (spec
  `basic/patterns/subscriptions`), delivering each message as it comes,
  until the stream ends: resolves when the server ends it or the signal
  closes it (the client's cancellation on HTTP), rejects when the listen
  itself is refused. A JSON reply answers the listen at once (a refusal
  or a graceful end) and is delivered like any answer.
  */
  public async subscribe(message: OutgoingMessage, signal: AbortSignal): Promise<void> {
    let response: Response
    try {
      response = await this.post(message, signal)
    } catch (error: unknown) {
      // Closing the stream before the reply is the cancellation itself.
      if (signal.aborted) {
        return
      }
      throw error
    }
    const type = response.headers.get(CONTENT_TYPE) ?? ''
    if (!type.includes(EVENT_STREAM_MEDIA_TYPE) || response.body === null) {
      await this.readReply(response, undefined)
      return
    }
    try {
      await this.readEvents(response.body, undefined)
    } catch (error: unknown) {
      // Closing the stream is the cancellation; anything else is the
      // stream's own failure, which the connection hears as a drop.
      if (!signal.aborted) throw error
    }
  }

  public setProtocolVersion(version: string): void {
    this.protocolVersion = version
  }

  public onMessage(listener: (message: unknown) => void): void {
    this.messageListeners.add(listener)
  }

  public onClose(): void {
    // An HTTP server has no process to exit: a failure shows in the reply to a message.
  }

  /** Ends the session on the server (DELETE); a server that refuses it is left to expire it. */
  public async close(): Promise<void> {
    this.isClosed = true
    const { sessionId } = this
    if (sessionId === undefined) {
      return
    }
    this.sessionId = undefined
    const headers = this.headers()
    headers.set(SESSION_HEADER, sessionId)
    try {
      const response = await this.options.fetch(this.options.url, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(MCP_HTTP_CLOSE_TIMEOUT_MS),
        redirect: 'error',
      })
      await response.body?.cancel()
    } catch {
      // The record names the unended session, never the failure's text.
      this.options.log.info(`MCP server ${this.options.name}'s session was not ended`)
    }
  }
}
