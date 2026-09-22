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
  private nextServerRequestId = 1
  public readonly incoming = new PushIterable()
  /** Every request the client sent, in order. */
  public readonly requests: JsonRpcFrame[] = []
  /** Every response the client sent to a server request. */
  public readonly clientResponses: JsonRpcFrame[] = []

  public handle(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler)
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
      if (frame.id === undefined) {
        continue
      }
      const response =
        handler === undefined
          ? {
              jsonrpc: '2.0',
              id: frame.id,
              error: { code: METHOD_NOT_FOUND, message: 'no handler' },
            }
          : { jsonrpc: '2.0', id: frame.id, result: handler(frame.params ?? {}) }
      this.incoming.push(`${JSON.stringify(response)}\n`)
    }
    return Promise.resolve()
  }

  public notify(method: string, params: Record<string, unknown>): void {
    this.incoming.push(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  public serverRequest(method: string, params: Record<string, unknown>): number {
    const id = this.nextServerRequestId
    this.nextServerRequestId += 1
    this.incoming.push(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return id
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

export function fakeMspHost(): FakeHostHandle {
  const server = new FakeMspServer()
  const connection = new Connection(server)
  const exited = Promise.withResolvers<{ code: number | null; signal: string | null }>()
  let closeCount = 0
  const host: MspHost = {
    connection,
    initializeResult: fakeInitializeResult,
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

/** Yields to the event loop enough times for a notification to be dispatched. */
export async function settle(): Promise<void> {
  const TICKS = 5
  for (let index = 0; index < TICKS; index += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
  }
}
