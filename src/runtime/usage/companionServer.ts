// M102 / D82: a capability URL serves only the packaged page on loopback.
// The fragment is never an HTTP URL/query, and no request or token is logged.
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  HTTP_STATUS,
  IDE_MCP_TOKEN_BYTES,
  USAGE_COMPANION_IDLE_MS,
  USAGE_RECORD_MAX_BYTES,
} from '../../shared/constants'
import {
  parseUsagePageToServiceMessage,
  usageServiceToPageMessageSchema,
} from '../../shared/usagePage'
import { usageCountSchema } from '../../shared/usageJournal'
import type { UsageServiceDeps, UsageService, UsageExportFile } from '../../core/usage/usageService'

export const usageCompanionReplySchema = z.strictObject({
  messages: z.array(usageServiceToPageMessageSchema),
  confirmation: z.optional(
    z.strictObject({
      title: z.string(),
      detail: z.string(),
      action: z.string(),
      cancel: z.string(),
      count: usageCountSchema,
    }),
  ),
  download: z.optional(
    z.strictObject({
      name: z.string(),
      mimeType: z.enum(['application/json', 'text/csv', 'text/plain']),
      content: z.string(),
    }),
  ),
})
export interface UsageCompanionDeps {
  /** Exact dist/webview directory, never a caller-supplied RPC path. */
  readonly webviewDirectory: string
  readonly indexHtml: string
  readonly createService: (ports: {
    readonly saveFile: (file: UsageExportFile) => Promise<boolean>
    readonly confirmDelete: UsageServiceDeps['confirmDelete']
  }) => UsageService
  readonly now?: () => number
}
export interface UsageCompanion {
  /** Includes the capability in its fragment. Treat it as private, not a log value. */
  readonly url: string
  readonly origin: string
  readonly close: () => Promise<void>
}
interface RequestContext {
  readonly confirmed: boolean
  readonly confirmedCount: number
  confirmation?: Parameters<UsageServiceDeps['confirmDelete']>[0]
  download?: UsageExportFile
}
const POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
const LOOPBACK = '127.0.0.1'
const AUTH_PREFIX = 'Bearer '
function isTokenMatch(value: string | undefined, expected: Buffer): boolean {
  if (!value?.startsWith(AUTH_PREFIX)) return false
  const supplied = Buffer.from(value.slice(AUTH_PREFIX.length))
  return supplied.byteLength === expected.byteLength && timingSafeEqual(supplied, expected)
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    if (!Buffer.isBuffer(chunk)) throw new Error('invalid body')
    bytes += chunk.byteLength
    if (bytes > USAGE_RECORD_MAX_BYTES) throw new Error('oversized body')
    chunks.push(chunk)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return value
}
/** All security headers apply to HTML, assets, RPC replies and errors. */
function reply(
  response: ServerResponse,
  status: number,
  mimeType = 'text/plain',
  content: string | Buffer = '',
): void {
  response.writeHead(status, {
    'Content-Type': mimeType,
    'Content-Security-Policy': POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  })
  response.end(content)
}
export async function startUsageCompanion(deps: UsageCompanionDeps): Promise<UsageCompanion> {
  const now = deps.now ?? Date.now
  const root = await realpath(deps.webviewDirectory)
  const token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
  const expected = Buffer.from(token)
  const context = new AsyncLocalStorage<RequestContext>()
  const service = deps.createService({
    saveFile(file) {
      const request = context.getStore()
      if (request === undefined) return Promise.resolve(false)
      request.download = file
      return Promise.resolve(true)
    },
    confirmDelete(prompt) {
      const request = context.getStore()
      if (request === undefined) return Promise.resolve(false)
      if (request.confirmed && request.confirmedCount === prompt.count) return Promise.resolve(true)
      request.confirmation = prompt
      return Promise.resolve(false)
    },
  })
  let origin = ''
  let lastActive = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing
    clearTimeout(timer)
    closing = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        expected.fill(0)
        if (error === undefined) resolve()
        else reject(error)
      })
      server.closeAllConnections()
    })
    return closing
  }
  function scheduleIdle(): void {
    clearTimeout(timer)
    timer = setTimeout(
      () => {
        if (now() - lastActive >= USAGE_COMPANION_IDLE_MS)
          void close().catch(() => expected.fill(0))
        else scheduleIdle()
      },
      Math.max(1, USAGE_COMPANION_IDLE_MS - (now() - lastActive)),
    )
    timer.unref()
  }
  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      request.socket.remoteAddress !== LOOPBACK ||
      request.headers.host !== origin.slice('http://'.length)
    ) {
      reply(response, HTTP_STATUS.forbidden)
      return
    }
    const resource = request.url ?? ''
    if (resource === '/rpc') {
      if (
        request.headers.origin !== origin ||
        !isTokenMatch(request.headers.authorization, expected)
      ) {
        reply(response, HTTP_STATUS.forbidden)
        return
      }
      if (request.method !== 'POST') {
        reply(response, HTTP_STATUS.methodNotAllowed)
        return
      }
      if (request.headers['content-type']?.split(';', 1)[0] !== 'application/json') {
        reply(response, HTTP_STATUS.badRequest)
        return
      }
      const parsed = parseUsagePageToServiceMessage(await body(request))
      if (!parsed.ok) {
        reply(response, HTTP_STATUS.badRequest)
        return
      }
      const requestContext: RequestContext = {
        confirmed: request.headers['x-usage-confirm-delete'] === 'confirmed',
        confirmedCount: Number(request.headers['x-usage-confirm-count']),
      }
      const result = await context.run(requestContext, async () =>
        usageCompanionReplySchema.parse({
          messages: await service.handle(parsed.message),
          ...(requestContext.confirmation !== undefined && {
            confirmation: requestContext.confirmation,
          }),
          ...(requestContext.download !== undefined && { download: requestContext.download }),
        }),
      )
      lastActive = now()
      scheduleIdle()
      reply(response, HTTP_STATUS.ok, 'application/json', JSON.stringify(result))
      return
    }
    if (request.method !== 'GET') {
      reply(response, HTTP_STATUS.methodNotAllowed)
      return
    }
    if (resource === '/') {
      reply(response, HTTP_STATUS.ok, 'text/html; charset=utf-8', deps.indexHtml)
      return
    }
    // Only generated JS/CSS names at the root or in chunks/. Refuse encoded traversal, queries,
    // directories, source maps and symlinks escaping the packaged root.
    if (!/^\/(?:chunks\/)?[\w.-]+\.(?:js|css)$/.test(resource)) {
      reply(response, HTTP_STATUS.notFound)
      return
    }
    const asset = await realpath(path.join(root, resource.slice(1)))
    if (asset !== path.join(root, resource.slice(1))) {
      reply(response, HTTP_STATUS.notFound)
      return
    }
    reply(
      response,
      HTTP_STATUS.ok,
      resource.endsWith('.css') ? 'text/css' : 'text/javascript',
      await readFile(asset),
    )
  }
  const server = createServer((request, response) => {
    void route(request, response).catch(() => {
      if (response.headersSent) {
        response.destroy()
      } else {
        reply(response, HTTP_STATUS.badRequest)
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string' || address.address !== LOOPBACK) {
    await close()
    throw new Error('companion refused non-loopback address')
  }
  origin = `http://${LOOPBACK}:${String(address.port)}`
  scheduleIdle()
  return { origin, url: `${origin}/#${token}`, close }
}
