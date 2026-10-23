import { armHttpServerShutdown, listenHttpServer } from '../httpServer'
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { JudgeRuntime } from '../../core/judge/engine'
import {
  judgeOutcomeSchema,
  judgeRequestSchema,
  type JudgeRequest,
  type JudgeResult,
} from '../../core/judge/schema'
import { HTTP_STATUS, JUDGE_MAX_BODY_BYTES, JUDGE_REQUEST_TIMEOUT_MS } from '../../shared/constants'
import { createJudgeTokenFile, type JudgeWindowsAcl } from './tokenFile'

export interface JudgeServeOptions {
  readonly runtime: JudgeRuntime
  readonly tokenDirectory: string
  readonly host?: string
  readonly port?: number
  readonly windowsAcl?: JudgeWindowsAcl
  readonly signal?: AbortSignal
}

function hasSingleHeader(request: IncomingMessage, name: string): boolean {
  return request.headersDistinct[name]?.length === 1
}
function isAuthenticated(request: IncomingMessage, token: string): boolean {
  if (!hasSingleHeader(request, 'authorization')) return false
  const supplied = Buffer.from(request.headers.authorization ?? '')
  const expected = Buffer.from(`Bearer ${token}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
function reply(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    connection: 'close',
  })
  response.end(body === undefined ? undefined : JSON.stringify(body))
}
async function readRequest(request: IncomingMessage): Promise<JudgeRequest | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  const stream = request.iterator({ destroyOnReturn: false })
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk)) return undefined
    size += chunk.length
    if (size > JUDGE_MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  try {
    const body: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    )
    const parsed = judgeRequestSchema.safeParse(body)
    return parsed.success ? parsed.data : undefined
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined
    if (error instanceof TypeError) return undefined
    throw error
  }
}
function isAligned(request: JudgeRequest, result: JudgeResult): boolean {
  const questions = Object.entries(request.questions)
  return (
    questions.length === Object.keys(result.answers).length &&
    questions.every(([id, question]) => result.answers[id]?.type === question.type)
  )
}

/** Request-only local boundary. The injected runtime owns per-attempt admission. */
export async function startJudgeServer(options: JudgeServeOptions) {
  const host = options.host ?? '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('EJUDGE_BIND')
  options.signal?.throwIfAborted()
  const credential = await createJudgeTokenFile(options.tokenDirectory, options.windowsAcl)
  let authority = ''
  const calls = new Set<AbortController>()
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (response.headersSent) response.destroy()
      else
        reply(response, HTTP_STATUS.internalServerError, {
          outcome: 'no-answer',
          reason: 'engine-failure',
        })
    })
  })
  server.requestTimeout = JUDGE_REQUEST_TIMEOUT_MS
  server.headersTimeout = JUDGE_REQUEST_TIMEOUT_MS
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (
      !hasSingleHeader(request, 'host') ||
      request.headers.host !== authority ||
      request.headersDistinct['origin'] !== undefined
    ) {
      reply(response, HTTP_STATUS.forbidden)
      return
    }
    if (!isAuthenticated(request, credential.token)) {
      reply(response, HTTP_STATUS.unauthorized)
      return
    }
    if (request.url !== '/v1/systemone') {
      reply(response, HTTP_STATUS.notFound)
      return
    }
    if (request.method !== 'POST') {
      reply(response, HTTP_STATUS.methodNotAllowed)
      return
    }
    const controller = new AbortController()
    calls.add(controller)
    const abort = () => {
      controller.abort()
    }
    response.once('close', abort)
    const deadline = setTimeout(() => {
      controller.abort()
      response.destroy()
    }, JUDGE_REQUEST_TIMEOUT_MS)
    try {
      const input = await readRequest(request)
      if (!input) {
        reply(response, HTTP_STATUS.badRequest)
        return
      }
      controller.signal.throwIfAborted()
      // Exactly one independent engine call per inference request. The runtime
      // must durably reserve each attempt (and retry) before its own dispatch.
      const outcome = judgeOutcomeSchema.parse(
        await options.runtime.judge(input, controller.signal),
      )
      if (controller.signal.aborted) return
      if (outcome.outcome === 'answered') {
        if (!isAligned(input, outcome.result)) throw new Error('EJUDGE_RESULT')
        reply(response, HTTP_STATUS.ok, outcome.result)
      } else reply(response, HTTP_STATUS.forbidden, outcome)
    } finally {
      clearTimeout(deadline)
      response.off('close', abort)
      calls.delete(controller)
    }
  }
  let closing: Promise<void> | undefined
  function close(): Promise<void> {
    if (closing !== undefined) return closing
    // Yield before shutdown callbacks; publish the promise before aborting.
    closing = (async () => {
      await Promise.resolve()
      const stopped = new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      server.closeAllConnections()
      await stopped
      await credential.remove()
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      options.signal?.removeEventListener('abort', onSignal)
    })()
    for (const controller of calls) controller.abort()
    return closing
  }
  function onSignal() {
    void close().catch(() => {
      process.exitCode = 1
    })
  }
  try {
    const address = await listenHttpServer(server, host, options.port ?? 0, 'EJUDGE_BIND')
    authority = `${host === '::1' ? '[::1]' : host}:${String(address.port)}`
    armHttpServerShutdown(options.signal, onSignal)
    return {
      url: `http://${authority}/v1/systemone`,
      tokenPath: credential.path,
      aclReceipt: credential.aclReceipt,
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
