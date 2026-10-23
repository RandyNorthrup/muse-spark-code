import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import * as z from 'zod/mini'
import { handleMcpMessage, type McpTool } from '../../core/mcp'
import {
  HTTP_STATUS,
  RUNTIME_MAKER_HTTP_NO_CONTENT,
  RUNTIME_MAKER_HOST,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_TIMEOUT_MS,
  RUNTIME_MAKER_TOKEN_BYTES,
  RUNTIME_MAKER_LAUNCH_CODE_MS,
  MAKER_COMPANION_PORT_FIRST,
  MAKER_COMPANION_PORT_END,
  UI_TEXT,
} from '../../shared/constants'
import { makerSurfaceMessageSchema, type MakerSurfaceMessage } from '../../shared/makerProtocol'
import type { RuntimeMakerHost } from './runtimeMakerHost'
import {
  companionBootstrapSchema,
  companionPresenceSchema,
  companionLaunchSchema,
} from '../../shared/companionProtocol'
import { registerMakerCompanion } from '../../core/maker/companionRegistry'

export interface CompanionDeps {
  readonly host?: RuntimeMakerHost
  readonly provider?: { readonly host: string; readonly port: number; readonly token: string }
  readonly bind?: string
  readonly dispatch: (message: MakerSurfaceMessage, signal: AbortSignal) => Promise<unknown>
  readonly tools: () => readonly McpTool[]
  /** Installed shared UI assets only; never workspace paths. */
  readonly assets: ReadonlyMap<
    string,
    { readonly body: string | Uint8Array; readonly type: string }
  >
}
function isSame(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const raw of request) {
    const chunk = z.instanceof(Buffer).parse(raw)
    bytes += chunk.length
    if (bytes > RUNTIME_MAKER_MAX_BYTES) throw new Error('maker-body-size')
    chunks.push(chunk)
  }
  const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return raw
}
export async function startCompanion(deps: CompanionDeps) {
  const bind = deps.bind ?? RUNTIME_MAKER_HOST
  if (bind !== RUNTIME_MAKER_HOST && bind !== '::1') throw new Error('maker-loopback-required')
  let launch = ''
  let isLaunchDelivered = false
  let launchExpires = 0
  const instance = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
  const session = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
  const mcp = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
  const streams = new Set<ServerResponse>()
  const active = new Set<AbortController>()
  // One dereference: the host reference is fixed for the server's lifetime.
  const host = deps.host
  let origin = ''
  const server = createServer((request, response) => {
    void (async () => {
      const [attempt] = await Promise.allSettled([handle(request, response)])
      if (attempt.status !== 'rejected') {
        return
      }

      if (!response.headersSent) response.writeHead(HTTP_STATUS.badRequest)
      response.end()
    })()
  })
  server.requestTimeout = RUNTIME_MAKER_TIMEOUT_MS
  server.headersTimeout = RUNTIME_MAKER_TIMEOUT_MS
  // Bootstrap is a session, never physical approval authority.
  function bootstrap(response: ServerResponse): void {
    response.writeHead(HTTP_STATUS.ok, { 'Content-Type': 'application/json' }).end(
      JSON.stringify(
        companionBootstrapSchema.parse({
          ...(deps.provider !== undefined && { provider: deps.provider }),
        }),
      ),
    )
  }
  function beginRequest(response: ServerResponse): AbortController {
    const controller = new AbortController()
    active.add(controller)
    response.once('close', () => {
      if (!response.writableFinished) controller.abort()
    })
    return controller
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authority = new URL(origin).host
    if (request.headers.host !== authority) {
      response.writeHead(HTTP_STATUS.forbidden).end()
      return
    }
    const incomingOrigin = request.headers.origin
    if (incomingOrigin !== undefined && incomingOrigin !== origin) {
      response.writeHead(HTTP_STATUS.forbidden).end()
      return
    }
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/launch-code' && request.method === 'POST') {
      if (incomingOrigin !== origin) {
        response.writeHead(HTTP_STATUS.forbidden).end()
        return
      }
      if (launch === '' || isLaunchDelivered || Date.now() >= launchExpires) {
        response.writeHead(HTTP_STATUS.unauthorized).end()
        return
      }
      isLaunchDelivered = true
      response
        .writeHead(HTTP_STATUS.ok, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(companionLaunchSchema.parse({ launch })))
      return
    }
    if (request.url === '/launch' && request.method === 'POST') {
      if (incomingOrigin !== origin) {
        response.writeHead(HTTP_STATUS.forbidden).end()
        return
      }
      const input = z.strictObject({ launch: z.string() }).parse(await body(request))
      if (
        launch === '' ||
        !isLaunchDelivered ||
        Date.now() >= launchExpires ||
        !isSame(input.launch, launch)
      ) {
        response.writeHead(HTTP_STATUS.unauthorized).end()
        return
      }
      launch = ''
      host?.newDocument()
      // HTTP loopback cannot use Secure/__Host-. Name and value bind this host-only cookie to this instance and port.
      response.setHeader(
        'Set-Cookie',
        `${cookieName()}=${cookieValue()}; HttpOnly; SameSite=Strict; Path=/`,
      )
      bootstrap(response)
      return
    }
    if (request.url === '/mcp') {
      if (
        incomingOrigin !== undefined ||
        request.method !== 'POST' ||
        !isSame(request.headers.authorization ?? '', `Bearer ${mcp}`)
      ) {
        response.writeHead(HTTP_STATUS.forbidden).end()
        return
      }
      const controller = beginRequest(response)
      try {
        const message = await body(request)
        const outcome = await handleMcpMessage(
          JSON.stringify(message),
          deps.tools(),
          { name: 'muse_spark_maker', version: '1' },
          controller.signal,
        )
        if (outcome.kind === 'accepted') response.writeHead(HTTP_STATUS.accepted).end()
        else
          response
            .writeHead(HTTP_STATUS.ok, { 'Content-Type': 'application/json' })
            .end(JSON.stringify(outcome.body))
      } finally {
        active.delete(controller)
      }
      return
    }
    const asset = request.method === 'GET' ? deps.assets.get(request.url ?? '') : undefined
    if (asset !== undefined) {
      response.writeHead(HTTP_STATUS.ok, { 'Content-Type': asset.type }).end(asset.body)
      return
    }
    const cookie =
      request.headers.cookie
        ?.split(';')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(`${cookieName()}=`))
        ?.slice(cookieName().length + 1) ?? ''
    if (!isSame(cookie, cookieValue())) {
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    // A reloaded document holds the session cookie; the launch code is already spent.
    if (request.url === '/session' && request.method === 'POST') {
      if (incomingOrigin !== origin) {
        response.writeHead(HTTP_STATUS.forbidden).end()
        return
      }
      host?.newDocument()
      bootstrap(response)
      return
    }
    if (request.url === '/events' && request.method === 'GET') {
      response.writeHead(HTTP_STATUS.ok, { 'Content-Type': 'text/event-stream' })
      streams.add(response)
      const unsubscribe = host?.subscribe((message) => {
        const frame = `data: ${JSON.stringify(message)}\n\n`
        if (response.writableLength + Buffer.byteLength(frame) > RUNTIME_MAKER_MAX_BYTES)
          response.destroy()
        else response.write(frame)
      })
      response.once('close', () => {
        streams.delete(response)
        unsubscribe?.()
      })
      return
    }
    if (
      ['/message', '/answer', '/presence'].includes(request.url ?? '') &&
      request.method === 'POST'
    ) {
      if (incomingOrigin !== origin) {
        response.writeHead(HTTP_STATUS.forbidden).end()
        return
      }
      // The review binds to the document that sent it: stamp the epoch before
      // the body can suspend across a replacement document's reset.
      const epoch = host?.epoch
      const raw = await body(request)
      if (request.url === '/answer' || request.url === '/presence') {
        const parsed = makerSurfaceMessageSchema.safeParse(raw)
        if (!parsed.success || parsed.data.type !== 'makerAnswer') {
          response.writeHead(HTTP_STATUS.forbidden).end()
          return
        }
        if (request.url === '/presence') {
          const [attempt] = await Promise.allSettled([
            (async () => await host?.authorize(parsed.data.answer))(),
          ])
          if (attempt.status === 'fulfilled') {
            const grant = attempt.value
            response
              .writeHead(grant === undefined ? HTTP_STATUS.forbidden : HTTP_STATUS.ok, {
                'Content-Type': 'application/json',
              })
              .end(
                JSON.stringify(
                  companionPresenceSchema.parse(
                    grant === undefined ? { error: UI_TEXT.makerPresenceDenied } : { grant },
                  ),
                ),
              )
          } else {
            response.writeHead(HTTP_STATUS.forbidden, { 'Content-Type': 'application/json' }).end(
              JSON.stringify({
                error:
                  attempt.reason instanceof Error
                    ? attempt.reason.message
                    : UI_TEXT.makerPresenceUnavailable,
              }),
            )
          }
          return
        }
        response
          .writeHead(
            host?.answer(parsed.data.answer, request.headers['x-maker-approval']?.toString())
              ? RUNTIME_MAKER_HTTP_NO_CONTENT
              : HTTP_STATUS.forbidden,
          )
          .end()
        return
      }
      const parsed = makerSurfaceMessageSchema.safeParse(raw)
      if (!parsed.success) {
        response.writeHead(HTTP_STATUS.badRequest).end()
        return
      }
      const message = parsed.data
      // The request channel never carries approval authority, even with a valid session cookie.
      // A review upload started in an older document cannot review the new one.
      if (
        message.type === 'makerAnswer' ||
        (message.type === 'makerPayloadReviewed' && epoch !== host?.epoch)
      ) {
        response.writeHead(HTTP_STATUS.forbidden).end()
        return
      }
      const controller = beginRequest(response)
      try {
        const result = await deps.dispatch(message, controller.signal)
        response
          .writeHead(HTTP_STATUS.ok, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(result ?? null))
      } finally {
        active.delete(controller)
      }
      return
    }
    response.writeHead(HTTP_STATUS.notFound).end()
  }
  let isListening = false
  const first = randomInt(MAKER_COMPANION_PORT_FIRST, MAKER_COMPANION_PORT_END)
  for (
    let offset = 0;
    offset < MAKER_COMPANION_PORT_END - MAKER_COMPANION_PORT_FIRST;
    offset += 1
  ) {
    const port =
      MAKER_COMPANION_PORT_FIRST +
      ((first - MAKER_COMPANION_PORT_FIRST + offset) %
        (MAKER_COMPANION_PORT_END - MAKER_COMPANION_PORT_FIRST))
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, bind, () => {
          server.off('error', reject)
          resolve()
        })
      })
      isListening = true
      break
    } catch (error) {
      server.removeAllListeners('error')
      if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) throw error
    }
  }
  if (!isListening) throw new Error(UI_TEXT.makerCompanionUnavailable)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('maker-listen-address')
  const port = address.port
  origin = `http://${bind === '::1' ? '[::1]' : bind}:${String(port)}`
  let unregister
  try {
    unregister = await registerMakerCompanion([
      port,
      ...(deps.provider === undefined ? [] : [deps.provider.port]),
    ])
  } catch (error) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    throw error
  }
  function cookieName() {
    return `maker_${instance}_${String(port)}`
  }
  function cookieValue() {
    return `${instance}.${String(port)}.${session}`
  }
  return {
    url: origin,
    async open(): Promise<string> {
      if (host === undefined) throw new Error(UI_TEXT.makerPresenceUnavailable)
      await host.requirePresence(UI_TEXT.makerLaunchConnect, { panel: origin })
      launch = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
      isLaunchDelivered = false
      launchExpires = Date.now() + RUNTIME_MAKER_LAUNCH_CODE_MS
      return `${origin}/`
    },
    mcp: {
      url: `${origin}/mcp`,
      headers: { Authorization: `Bearer ${mcp}` },
    },
    async close(): Promise<void> {
      host?.cancelApprovals()
      for (const controller of active) controller.abort()
      for (const response of streams) response.end()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
      await unregister()
    },
  }
}
