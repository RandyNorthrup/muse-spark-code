import { randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http'
import * as z from 'zod/mini'
import {
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_TOKEN_BYTES,
  MHP_PANEL,
} from '../../shared/constants'
import type { panelLifecycleSchema } from '../../shared/hostApi/panel'
import { MhpPanelError } from '../../shared/hostApi/panelError'
import { CompanionEvents } from './events'
import { isSameOrigin, readJson, secureHeaders, sessionBearer, singleHeader } from './guard'
import { launchPage } from './page'
import { CompanionSessions, type CompanionSession } from './sessions'

/** The runtime supplies its real schemas and controller; transport owns no MHP methods. */
export interface CompanionHandler<Input, Output> {
  readonly inputSchema: z.ZodMiniType<Input>
  readonly outputSchema: z.ZodMiniType<Output>
  post(message: Input, sessionId: string, signal: AbortSignal): Promise<void>
  surface?(
    message: z.infer<typeof panelLifecycleSchema>,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<void>
  readonly isBindingAllowed?: (message: unknown, context: string | undefined) => boolean
  readonly surfaceSchema?: typeof panelLifecycleSchema
  readonly eventId?: (message: unknown) => string | undefined
  subscribe(sessionId: string, emit: (message: unknown, complete?: () => void) => void): () => void
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
  /** Optional MHP UI RPC uses the same guards and an independent window stream. */
  readonly services?: CompanionHandler<unknown, unknown>
  readonly limits: CompanionLimits
  /** Exact URL paths to packaged assets. No filesystem path is derived from a request. */
  readonly assets: ReadonlyMap<string, CompanionAsset>
  /** Trusted packaged UI, with nonce on every script. No credential or launch code is passed. */
  readonly renderPage: (nonce: string, context?: string) => string
  readonly host?: string
  readonly signal?: AbortSignal
}

const launchSchema = z.strictObject({ code: z.string().check(z.regex(/^[a-f\d]+$/)) })
const eventsSchema = z.strictObject({})

function reply(response: ServerResponse, status: number, error?: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
  response.end(error === undefined ? undefined : JSON.stringify({ error }))
}

function admissionError(code: MhpPanelError['frame']['code']): MhpPanelError {
  return new MhpPanelError({
    mhp: MHP_PANEL.wireVersion,
    kind: 'panelError',
    surface: null,
    seq: null,
    code,
  })
}
function panelReply(response: ServerResponse, error: MhpPanelError): void {
  let status: number = HTTP_STATUS.badRequest
  switch (error.frame.code) {
    case 'MHP_PANEL_UNKNOWN_SURFACE': {
      status = HTTP_STATUS.notFound
      break
    }
    case 'MHP_PANEL_TOO_LARGE': {
      status = HTTP_STATUS.payloadTooLarge
      break
    }
    case 'MHP_PANEL_BACKPRESSURE': {
      status = HTTP_STATUS.tooManyRequests
      break
    }
    case 'MHP_PANEL_OUT_OF_ORDER':
    case 'MHP_PANEL_NOT_READY':
    case 'MHP_PANEL_BINDING_MISMATCH': {
      status = HTTP_STATUS.conflict
      break
    }
  }
  response.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' })
  response.end(JSON.stringify(error.frame))
}

/** Browser boundary. Close on runtime abort, process signal, or authenticated inactivity. */
export async function startCompanionServer<Input, Output>(
  options: CompanionOptions<Input, Output>,
  /** Embedding gate: build the HTTP transport. Production passes node:http;
  tests pass a socket-free fake so startup races stay deterministic. */
  createTransport: (requestListener: RequestListener) => Server = createServer,
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
  const events = new CompanionEvents(limits.maxEventBytes, handler.eventId)
  const serviceEvents = new CompanionEvents(limits.maxEventBytes)
  const calls = new Map<AbortController, string | undefined>()
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
  const server = createTransport((request, response) => {
    const nonce = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
    secureHeaders(response, nonce)
    void handle(request, response, nonce).catch((error: unknown) => {
      if (response.headersSent) response.destroy()
      else if (error instanceof MhpPanelError) panelReply(response, error)
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

  function openEvents(
    session: CompanionSession,
    response: ServerResponse,
    stream = events,
    owner: Pick<CompanionHandler<unknown, unknown>, 'subscribe' | 'outputSchema'> = handler,
  ): void {
    if (stream.has(session.id)) {
      reply(response, HTTP_STATUS.forbidden, 'EPANEL_STREAM')
      return
    }
    activity()
    stream.open(
      session.id,
      response,
      session.expiresAt,
      (emit) => owner.subscribe(session.id, emit),
      (message) => JSON.stringify(owner.outputSchema.parse(message)),
      activity,
    )
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    nonce: string,
  ): Promise<void> {
    const isPrivileged = request.method === 'POST' || request.url === '/panel/events'
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
        response.end(
          session === undefined ? launchPage(nonce) : options.renderPage(nonce, session.context),
        )
        if (session !== undefined) activity()
      } else if (session !== undefined && request.url === '/panel/events') {
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
    if (
      request.url !== '/session' &&
      request.url !== '/panel/message' &&
      request.url !== '/panel/surface' &&
      request.url !== '/panel/events' &&
      (options.services === undefined ||
        !(request.url === '/host/events' || request.url === '/host/message'))
    ) {
      reply(response, HTTP_STATUS.notFound, 'EPANEL_PATH')
      return
    }
    const controller = new AbortController()
    controller.signal.addEventListener(
      'abort',
      () => {
        response.destroy()
      },
      { once: true },
    )
    const abort = () => {
      controller.abort()
    }
    calls.set(controller, session?.context)
    response.once('close', abort)
    const deadline = setTimeout(() => {
      controller.abort()
      response.destroy()
    }, limits.requestTimeoutMs)
    try {
      let input: unknown
      try {
        input = await readJson(request, limits.maxBodyBytes)
      } catch (error: unknown) {
        if (request.url === '/panel/message' || request.url === '/panel/surface') {
          panelReply(
            response,
            admissionError(
              error instanceof Error && error.message === 'EPANEL_TOO_LARGE'
                ? 'MHP_PANEL_TOO_LARGE'
                : 'MHP_PANEL_INVALID_ENVELOPE',
            ),
          )
          return
        }
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
        response.end(options.renderPage(nonce, created.context))
      } else if (session !== undefined) {
        if (sessions.get(session.id) === undefined) {
          reply(response, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
          return
        }
        if (
          options.services !== undefined &&
          (request.url === '/host/events' || request.url === '/host/message')
        ) {
          if (request.url === '/host/events') {
            if (!eventsSchema.safeParse(input).success) {
              reply(response, HTTP_STATUS.badRequest, 'EPANEL_MESSAGE')
              return
            }
            openEvents(session, response, serviceEvents, options.services)
          } else {
            const parsed = options.services.inputSchema.safeParse(input)
            if (!parsed.success) {
              reply(response, HTTP_STATUS.badRequest, 'EPANEL_MESSAGE')
              return
            }
            await options.services.post(parsed.data, session.id, controller.signal)
            if (!controller.signal.aborted) reply(response, HTTP_STATUS.noContent)
          }
          activity()
          return
        }
        if (request.url === '/panel/events') {
          if (!eventsSchema.safeParse(input).success) {
            reply(response, HTTP_STATUS.badRequest, 'EPANEL_MESSAGE')
            return
          }
          openEvents(session, response)
          return
        }
        if (request.url === '/panel/surface') {
          const parsed = handler.surfaceSchema?.safeParse(input)
          if (parsed?.success !== true || handler.surface === undefined) {
            panelReply(response, admissionError('MHP_PANEL_INVALID_LIFECYCLE'))
            return
          }
          if (handler.isBindingAllowed?.(parsed.data, session.context) === false) {
            panelReply(response, admissionError('MHP_PANEL_UNKNOWN_SURFACE'))
            return
          }
          await handler.surface(parsed.data, session.id, controller.signal)
          if (!controller.signal.aborted) reply(response, HTTP_STATUS.noContent)
          activity()
          return
        }
        const parsed = handler.inputSchema.safeParse(input)
        if (!parsed.success) {
          panelReply(response, admissionError('MHP_PANEL_INVALID_PAYLOAD'))
          return
        }
        if (handler.isBindingAllowed?.(parsed.data, session.context) === false) {
          panelReply(response, admissionError('MHP_PANEL_UNKNOWN_SURFACE'))
          return
        }
        await handler.post(parsed.data, session.id, controller.signal)
        if (controller.signal.aborted) return
        reply(response, HTTP_STATUS.noContent)
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
      for (const controller of calls.keys()) controller.abort()
      events.close()
      serviceEvents.close()
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

  // Every lifecycle listener is attached before the first await below, so no
  // event can fire before its subscriber exists. An error or close that lands
  // while the bind is in flight rejects startup; a process signal that lands
  // in the same window is buffered and shuts the server down once it is up;
  // aborting options.signal in the same window rejects startup at once with
  // the signal's reason instead of waiting out the bind.
  let isListening = false
  let rejectStartup: ((error: unknown) => void) | undefined
  const earlySignal = new AbortController()
  const onEarlySignal = (): void => {
    earlySignal.abort()
  }
  const onCallerAbort = (): void => {
    try {
      options.signal?.throwIfAborted()
    } catch (error) {
      rejectStartup?.(error)
    }
  }
  const onServerError = (error: unknown): void => {
    if (isListening) onSignal()
    else rejectStartup?.(error)
  }
  server.on('error', onServerError)
  server.once('close', () => {
    if (!isListening) {
      rejectStartup?.(new Error('EPANEL_BIND'))
      return
    }
    if (closing === undefined) onSignal()
  })
  options.signal?.addEventListener('abort', onCallerAbort)
  process.once('SIGINT', onEarlySignal)
  process.once('SIGTERM', onEarlySignal)
  try {
    await new Promise<void>((resolve, reject) => {
      rejectStartup = reject
      server.listen(0, host, () => {
        isListening = true
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
    if (earlySignal.signal.aborted) await close()
    return {
      url: `${origin}/`,
      launchUrl: (context?: string) => {
        if (closing !== undefined) throw new Error('EPANEL_CLOSED')
        return `${origin}/#k=${sessions.issue(context)}`
      },
      retireContext: (context: string) => {
        for (const id of sessions.retireContext(context)) {
          events.retire(id)
          serviceEvents.retire(id)
        }
        for (const [call, owner] of calls) if (owner === context) call.abort()
      },
      close,
      closed,
    }
  } catch (error) {
    await close()
    throw error
  } finally {
    options.signal?.removeEventListener('abort', onCallerAbort)
    process.off('SIGINT', onEarlySignal)
    process.off('SIGTERM', onEarlySignal)
  }
}
