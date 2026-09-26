// An in-memory Muse Session Protocol host for unit tests: a DuplexTransport
// the SDK's Connection speaks to, plus a scriptable request table and a way
// to push notifications and server requests at the client.

import { Connection, type DuplexTransport } from '@muse-code/sdk'
import type { MspHost } from '../../../src/core/backends/musecode/MuseCodeHost'

/** Any JSON-RPC frame the client can write: a request, or a response to ours. */
interface JsonRpcFrame {
  readonly id?: number | string
  readonly method?: string
  readonly params?: Record<string, unknown>
  readonly result?: unknown
  readonly error?: { code: number; message: string }
}

type RequestHandler = (params: Record<string, unknown>) => Record<string, unknown>

const METHOD_NOT_FOUND = -32_601
const HANDLER_ERROR = -32_000

class PushIterable implements AsyncIterable<string> {
  private readonly queue: string[] = []
  private wake: (() => void) | undefined
  private isEnded = false

  public push(line: string): void {
    this.queue.push(line)
    this.wake?.()
  }

  public end(): void {
    this.isEnded = true
    this.wake?.()
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<string> {
    while (!this.isEnded || this.queue.length > 0) {
      const next = this.queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.isEnded) {
        return
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
      this.wake = undefined
    }
  }
}

export class FakeMspServer implements DuplexTransport {
  private readonly handlers = new Map<string, RequestHandler>()
  /** Methods the host never answers (a wedged CLI, D25). */
  private readonly silenced = new Set<string>()
  /** Frames the host sends in the same read as a method's answer (D26). */
  private readonly followers = new Map<
    string,
    (params: Record<string, unknown>) => readonly Record<string, unknown>[]
  >()
  private nextServerRequestId = 1
  public readonly incoming = new PushIterable()
  /** Every request the client sent, in order. */
  public readonly requests: JsonRpcFrame[] = []
  /** Every response the client sent to a server request. */
  public readonly clientResponses: JsonRpcFrame[] = []

  private respond(
    id: number | string,
    handler: RequestHandler | undefined,
    params: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (handler === undefined) {
      return { jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: 'no handler' } }
    }
    try {
      return { jsonrpc: '2.0', id, result: handler(params ?? {}) }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      // The SDK requires a typed `data.kind` on every error response; a
      // handler may name one by throwing an error with a `kind`.
      const kind =
        typeof error === 'object' &&
        error !== null &&
        'kind' in error &&
        typeof error.kind === 'string'
          ? error.kind
          : 'commandRejected'
      // And its JSON-RPC code, when it names one (a retryable refusal, M39).
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'number'
          ? error.code
          : HANDLER_ERROR
      // Goal refusals name a reason directly (M45); task refusals carry data (M46).
      const reason =
        typeof error === 'object' &&
        error !== null &&
        'reason' in error &&
        typeof error.reason === 'string'
          ? { reason: error.reason }
          : {}
      const data =
        typeof error === 'object' &&
        error !== null &&
        'data' in error &&
        typeof error.data === 'object' &&
        error.data !== null
          ? error.data
          : {}
      return { jsonrpc: '2.0', id, error: { code, message, data: { ...data, ...reason, kind } } }
    }
  }

  public handle(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler)
  }

  /** From now on requests for `method` get no response at all. */
  public silence(method: string): void {
    this.silenced.add(method)
  }

  /**
   * The answer to `method` arrives in one chunk with these frames after it,
   * as `muse serve` writes the prompts it re-issues after a resume (D26).
   */
  public followWith(
    method: string,
    frames: (params: Record<string, unknown>) => readonly Record<string, unknown>[],
  ): void {
    this.followers.set(method, frames)
  }

  /** A server-request frame with the next id, for `followWith`. */
  public serverRequestFrame(method: string, params: Record<string, unknown>) {
    const id = this.nextServerRequestId
    this.nextServerRequestId += 1
    return { jsonrpc: '2.0', id, method, params }
  }

  public write(chunk: string): Promise<void> {
    for (const line of chunk.split('\n')) {
      if (line.trim() === '') {
        continue
      }
      const frame = JSON.parse(line) as JsonRpcFrame
      if (frame.method === undefined) {
        this.clientResponses.push(frame)
        continue
      }
      this.requests.push(frame)
      const handler = this.handlers.get(frame.method)
      if (frame.id === undefined || this.silenced.has(frame.method)) {
        continue
      }
      const following = this.followers.get(frame.method)?.(frame.params ?? {}) ?? []
      const chunk = [this.respond(frame.id, handler, frame.params), ...following]
        .map((line) => `${JSON.stringify(line)}\n`)
        .join('')
      this.incoming.push(chunk)
    }
    return Promise.resolve()
  }

  public notify(method: string, params: Record<string, unknown>): void {
    this.incoming.push(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  public serverRequest(method: string, params: Record<string, unknown>): number {
    const frame = this.serverRequestFrame(method, params)
    this.incoming.push(`${JSON.stringify(frame)}\n`)
    return frame.id
  }

  public close(): void {
    this.incoming.end()
  }

  public requestsFor(method: string): JsonRpcFrame[] {
    return this.requests.filter((request) => request.method === method)
  }
}

export const fakeInitializeResult = {
  serverInfo: { name: 'muse', version: '1.3.0-test' },
  museHome: '/home/test/.local/share/muse',
  experimentalApi: false,
  grantedCapabilities: [],
  platformFamily: 'posix',
  platformOs: 'linux',
  schema: { fingerprint: 'test' },
  userAgent: 'muse-test',
}

export interface FakeHostHandle {
  readonly server: FakeMspServer
  readonly host: MspHost
  readonly exit: (code: number | null, signal?: string | null) => void
  readonly closeCalls: () => number
}

export function fakeMspHost(initializeResult: unknown = fakeInitializeResult): FakeHostHandle {
  const server = new FakeMspServer()
  const connection = new Connection(server)
  const exited = Promise.withResolvers<{ code: number | null; signal: string | null }>()
  let closeCount = 0
  const host: MspHost = {
    connection,
    initializeResult,
    exited: exited.promise,
    close: () => {
      closeCount += 1
      server.close()
      return Promise.resolve()
    },
  }
  return {
    server,
    host,
    exit: (code, signal = null) => {
      exited.resolve({ code, signal })
    },
    closeCalls: () => closeCount,
  }
}

/**
 * A request handler that refuses with this MSP error kind (the host's
 * `data.kind`), and code with a reason or further data when given.
 */
export function refusalOf(
  kind: string,
  code?: number,
  detail?: string | Record<string, unknown>,
): () => never {
  return () => {
    throw Object.assign(new Error(`refused: ${typeof detail === 'string' ? detail : kind}`), {
      kind,
      ...(code !== undefined && { code }),
      ...(typeof detail === 'string' && { reason: detail }),
      ...(typeof detail === 'object' && { data: detail }),
    })
  }
}

/** MSP's goal refusal (captured live 2026-09-25): `commandRejected`, -32030, with its reason. */
const COMMAND_REJECTED_CODE = -32_030
export function goalRefusal(reason: 'missing_goal' | 'invalid_goal_state'): () => never {
  return refusalOf('commandRejected', COMMAND_REJECTED_CODE, reason)
}

/** Yields to the event loop enough times for a notification to be dispatched. */
export async function settle(): Promise<void> {
  const TICKS = 5
  for (let index = 0; index < TICKS; index += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
}
