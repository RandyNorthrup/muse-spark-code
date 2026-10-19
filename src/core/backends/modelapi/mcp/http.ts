// The streamable-HTTP transport (M50, PLAN.md D42; MCP 2025-06-18,
// "Transports"): every message is a POST to the server's one endpoint,
// accepting JSON or an event stream. A request's answer comes back in the
// POST's own reply, as one JSON body or as server-sent events that may carry
// the server's own requests and notifications first; a notification or an
// answer is accepted with 202. The session the server names in
// `Mcp-Session-Id` is sent back with every later message, and the agreed
// revision in `MCP-Protocol-Version`; a 404 on a known session means it
// expired (the connection starts a new one). Closing sends DELETE for the
// session. The headers of the server's entry (a bearer token) go with every
// message; a 401 or 403 says that sign-ins made with `muse mcp login` are
// Muse Code's own, which this backend never reads. A redirect is refused, so
// credentials never follow one elsewhere. Every reply is read up to
// MCP_MESSAGE_MAX_BYTES. The server's own event stream (GET) is not opened:
// a notification it would carry arrives with the next reply instead.

import {
  BYTES_PER_MIB,
  HTTP_STATUS,
  MCP_HTTP_CLOSE_TIMEOUT_MS,
  MCP_MESSAGE_MAX_BYTES,
} from '../../../../shared/constants'
import type { CoreLogger } from '../../../logging'
import { parseSse } from '../sse'
import { type McpTransport, McpSessionExpiredError } from './connection'
import { isRequest, McpError, type OutgoingMessage, type RequestId } from './protocol'

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
const CONTENT_TYPE = 'content-type'
const ACCEPT = 'accept'
const JSON_MEDIA_TYPE = 'application/json'
const EVENT_STREAM_MEDIA_TYPE = 'text/event-stream'
const ACCEPTED_MEDIA_TYPES = `${JSON_MEDIA_TYPE}, ${EVENT_STREAM_MEDIA_TYPE}`
const WWW_AUTHENTICATE = 'www-authenticate'
const AUTH_SCHEME = /^[A-Za-z][A-Za-z0-9_-]*$/

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

  private headers(): Headers {
    const headers = new Headers(this.options.headers)
    headers.set(CONTENT_TYPE, JSON_MEDIA_TYPE)
    headers.set(ACCEPT, ACCEPTED_MEDIA_TYPES)
    if (this.sessionId !== undefined) {
      headers.set(SESSION_HEADER, this.sessionId)
    }
    if (this.protocolVersion !== undefined) {
      headers.set(VERSION_HEADER, this.protocolVersion)
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
    await response.body?.cancel()
    // A remote server may echo a credential in its error body. The status is
    // enough to diagnose the failure without handing that body to the log or model.
    return new McpError(`HTTP ${String(response.status)} ${response.statusText}`.trim())
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

  public async send(message: OutgoingMessage, signal: AbortSignal): Promise<void> {
    if (this.isClosed) {
      throw new McpError('the connection is closed')
    }
    let response: Response
    try {
      response = await this.options.fetch(this.options.url, {
        method: 'POST',
        headers: this.headers(),
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
    const request = isRequest(message) ? message : undefined
    const isAnswered = await this.readReply(response, request?.id)
    if (request !== undefined && !isAnswered) {
      throw new McpError(`the server's reply to ${request.method} carried no answer`)
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
