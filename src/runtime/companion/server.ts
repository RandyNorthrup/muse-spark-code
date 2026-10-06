import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import { HTTP_STATUS, IDE_MCP_LOOPBACK_HOST, IDE_MCP_TOKEN_BYTES } from '../../shared/constants'
import { CompanionEvents } from './events'
import { isSameOrigin, readJson, secureHeaders, sessionBearer, singleHeader } from './guard'
import { launchPage } from './page'
import { CompanionSessions, type CompanionSession } from './sessions'

/** The runtime supplies its real schemas and controller; transport owns no MHP methods. */
export interface CompanionHandler<Input, Output> {
  readonly inputSchema: z.ZodMiniType<Input>
  readonly outputSchema: z.ZodMiniType<Output>
  post(message: Input, sessionId: string, signal: AbortSignal): Promise<void>
  subscribe(sessionId: string, emit: (message: unknown) => void): () => void
}

export interface CompanionLimits {
  readonly maxBodyBytes: number
  readonly maxEventBytes: number
  readonly requestTimeoutMs: number
  readonly idleTimeoutMs: number
  readonly launchCodeTtlMs: number
  readonly sessionTtlMs: number
  readonly maxSessions: number
}

export interface CompanionAsset {
  readonly content: string | Uint8Array
  readonly contentType: string
}

export interface CompanionOptions<Input, Output> {
  readonly handler: CompanionHandler<Input, Output>
  readonly limits: CompanionLimits
  /** Exact URL paths to packaged assets. No filesystem path is derived from a request. */
  readonly assets: ReadonlyMap<string, CompanionAsset>
  /** Trusted packaged UI, with nonce on every script. No credential or launch code is passed. */
  readonly renderPage: (nonce: string) => string
  readonly host?: string
  readonly signal?: AbortSignal
}

const launchSchema = z.strictObject({ code: z.string().check(z.regex(/^[a-f\d]+$/)) })
const eventsSchema = z.strictObject({})

function reply(response: ServerResponse, status: number, error?: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
  response.end(error === undefined ? undefined : JSON.stringify({ error }))
}

/** Browser boundary. Close on runtime abort, process signal, or authenticated inactivity. */
export async function startCompanionServer<Input, Output>(
  options: CompanionOptions<Input, Output>,
) {
  const host = options.host ?? IDE_MCP_LOOPBACK_HOST
  if (host !== IDE_MCP_LOOPBACK_HOST && host !== '::1') throw new Error('EPANEL_BIND')
  if (Object.values(options.limits).some((limit) => !Number.isSafeInteger(limit) || limit <= 0))
    throw new Error('EPANEL_LIMITS')
  options.signal?.throwIfAborted()
  const { handler, limits } = options
  const sessions = new CompanionSessions(
    limits.launchCodeTtlMs,
    limits.sessionTtlMs,
    limits.maxSessions,
  )
  const events = new CompanionEvents(limits.maxEventBytes)
  const calls = new Set<AbortController>()
  let origin = ''
  let idle: ReturnType<typeof setTimeout> | undefined
  let closing: Promise<void> | undefined
  const ending = new AbortController()
  const closed = new Promise<void>((resolve) => {
    ending.signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
  const server = createServer((request, response) => {
    const nonce = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    secureHeaders(response, nonce)
    void handle(request, response, nonce).catch(() => {
      if (response.headersSent) response.destroy()
      else reply(response, HTTP_STATUS.internalServerError, 'EPANEL_HANDLER')
    })
  })
  server.requestTimeout = limits.requestTimeoutMs
  server.headersTimeout = limits.requestTimeoutMs

  function activity(): void {
    if (closing !== undefined) return
    clearTimeout(idle)
    idle = setTimeout(onSignal, limits.idleTimeoutMs)
  }

  function openEvents(session: CompanionSession, response: ServerResponse): void {
    if (events.has(session.id)) {
      reply(response, HTTP_STATUS.forbidden, 'EPANEL_STREAM')
      return
    }
    activity()
    events.open(
      session.id,
      response,
      session.expiresAt,
      (emit) => handler.subscribe(session.id, emit),
      (message) => JSON.stringify(handler.outputSchema.parse(message)),
      activity,
    )
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    nonce: string,
  ): Promise<void> {
    const isPrivileged = request.method === 'POST' || request.url === '/events'
    if (!isSameOrigin(request, origin, isPrivileged)) {
      reply(response, HTTP_STATUS.forbidden, 'EPANEL_ORIGIN')
      return
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      reply(response, HTTP_STATUS.methodNotAllowed, 'EPANEL_METHOD')
      return
    }
    if (request.method === 'POST' && singleHeader(request, 'x-muse-panel') !== '1') {
      reply(response, HTTP_STATUS.forbidden, 'EPANEL_HEADER')
      return
    }
    const session = sessions.get(sessionBearer(request))
    const asset = request.method === 'GET' ? options.assets.get(request.url ?? '') : undefined
    if (
      session === undefined &&
      request.url !== '/' &&
      !(request.url === '/session' && request.method === 'POST')
    ) {
      reply(response, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
      return
    }
    if (request.method === 'GET') {
      if (request.url === '/') {
        response.writeHead(HTTP_STATUS.ok, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(session === undefined ? launchPage(nonce) : options.renderPage(nonce))
        if (session !== undefined) activity()
      } else if (session !== undefined && request.url === '/events') {
        openEvents(session, response)
      } else {
        if (asset === undefined) {
          reply(response, HTTP_STATUS.notFound, 'EPANEL_PATH')
          return
        }
        response.writeHead(HTTP_STATUS.ok, { 'Content-Type': asset.contentType })
        response.end(asset.content)
        activity()
      }
      return
    }
    if (request.url !== '/session' && request.url !== '/post' && request.url !== '/events') {
      reply(response, HTTP_STATUS.notFound, 'EPANEL_PATH')
      return
    }
    const controller = new AbortController()
    const abort = () => {
      controller.abort()
    }
    calls.add(controller)
    response.once('close', abort)
    const deadline = setTimeout(() => {
      controller.abort()
      response.destroy()
    }, limits.requestTimeoutMs)
    try {
      let input: unknown
      try {
        input = await readJson(request, limits.maxBodyBytes)
      } catch {
        reply(response, HTTP_STATUS.badRequest, 'EPANEL_BODY')
        return
      }
      controller.signal.throwIfAborted()
      if (request.url === '/session') {
        const parsed = launchSchema.safeParse(input)
        const created = parsed.success ? sessions.exchange(parsed.data.code) : undefined
        if (created === undefined) {
          reply(response, HTTP_STATUS.forbidden, 'EPANEL_LAUNCH')
          return
        }
        response.setHeader('Authorization', `Bearer ${created.id}`)
        response.writeHead(HTTP_STATUS.ok, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(options.renderPage(nonce))
      } else if (session !== undefined) {
        if (sessions.get(session.id) === undefined) {
          reply(response, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
          return
        }
        if (request.url === '/events') {
          if (!eventsSchema.safeParse(input).success) {
            reply(response, HTTP_STATUS.badRequest, 'EPANEL_MESSAGE')
            return
          }
          openEvents(session, response)
          return
        }
        const parsed = handler.inputSchema.safeParse(input)
        if (!parsed.success) {
          reply(response, HTTP_STATUS.badRequest, 'EPANEL_MESSAGE')
          return
        }
        await handler.post(parsed.data, session.id, controller.signal)
        if (controller.signal.aborted) return
        reply(response, HTTP_STATUS.accepted)
      }
      activity()
    } finally {
      clearTimeout(deadline)
      response.off('close', abort)
      calls.delete(controller)
    }
  }

  function close(): Promise<void> {
    if (closing !== undefined) return closing
    closing = (async () => {
      await Promise.resolve()
      clearTimeout(idle)
      for (const controller of calls) controller.abort()
      events.close()
      sessions.clear()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      })
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      options.signal?.removeEventListener('abort', onSignal)
      ending.abort()
    })()
    return closing
  }
  function onSignal(): void {
    void close().catch(() => {
      process.exitCode = 1
    })
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('EPANEL_BIND')
    origin = `http://${host === '::1' ? '[::1]' : host}:${String(address.port)}`
    options.signal?.throwIfAborted()
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    options.signal?.addEventListener('abort', onSignal, { once: true })
    activity()
    return {
      url: `${origin}/`,
      launchUrl: () => {
        if (closing !== undefined) throw new Error('EPANEL_CLOSED')
        return `${origin}/#k=${sessions.issue()}`
      },
      close,
      closed,
    }
  } catch (error) {
    await close()
    throw error
  }
}
