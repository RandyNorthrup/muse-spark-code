import { createServer as createHttpServer, type ServerResponse } from 'node:http'
import { createServer, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS } from '../../src/shared/constants'
import {
  createTabEngine,
  type TabEngine,
  type TabEngineRequest,
  type TabStream,
} from '../../src/core/tab/tabEngine'
import { transportTestDeps } from './helpers/modelApiTransport'

// The engine's send paths (M94 acceptance 7): what a cancelled trigger,
// a failed transport, an empty answer and a mid-flight cancellation do.
// The stream is the product's own `ModelApiClient` over real loopback the
// test owns: a silent connection, an empty answer, a delayed one, or a
// closed port. No provider bytes cross any test (an answer carries zero
// content bytes; the statuses are plain transport input), and every
// assertion is about the engine's own settlement (sent or not, usage or
// none) plus what the loopback observed (hits, timing).

function requestOf(isCancelled: () => boolean): TabEngineRequest {
  return {
    model: 'muse-spark-1.3',
    absolutePath: '/workspace/src/example.ts',
    relativePath: 'src/example.ts',
    languageId: 'typescript',
    prefix: 'export function add(a: number, b: number) {\n  return ',
    suffix: '\n}\n',
    snippets: '',
    mode: 'fast',
    maxOutputTokens: MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    isInvoke: true,
    cursorLineBefore: '  return ',
    lineAbove: 'export function add(a: number, b: number) {',
    linesBelow: ['}', ''],
    isCancelled,
  }
}

function engineOf(
  stream: TabStream,
  requestTimeoutMs?: number,
  onSent?: (model: string) => void,
): TabEngine {
  return createTabEngine({
    stream,
    onSent: onSent ?? (() => undefined),
    onUsage: () => undefined,
    ...(requestTimeoutMs !== undefined && { requestTimeoutMs }),
  })
}

/** The product's own key client, sending at the test's loopback. */
function clientFor(baseUrl: string): ModelApiClient {
  return new ModelApiClient({
    ...transportTestDeps({ fetch: globalThis.fetch }),
    baseUrl,
    apiKey: () => Promise.resolve('tab-engine-test-key'),
  })
}

/** The client's stream as the engine takes it, counting entries. */
function streamOf(client: ModelApiClient, entered: () => void): TabStream {
  return (body, signal, budget, admit) => {
    entered()
    return client.streamResponse(body, signal, undefined, budget, admit)
  }
}

interface HttpEndpoint {
  readonly url: string
  readonly hits: () => number
  readonly close: () => Promise<void>
}

async function httpEndpoint(handler: (response: ServerResponse) => void): Promise<HttpEndpoint> {
  let hits = 0
  const server = createHttpServer((_request, response) => {
    hits += 1
    handler(response)
  })
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('tab test server never bound')
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    hits: () => hits,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((done) => {
        server.close(() => {
          done()
        })
      })
    },
  }
}

/** An answer with zero content bytes: an empty event stream, no provider text. */
function answerEmpty(response: ServerResponse): void {
  response.writeHead(200, { 'content-length': '0', 'content-type': 'text/event-stream' })
  response.end()
}

/** A port nothing listens on: dialling it refuses for real. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('tab test server never bound')
  }
  const { port } = address
  await new Promise<void>((done) => {
    server.close(() => {
      done()
    })
  })
  return port
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createTabEngine send paths (M94 acceptance 7)', () => {
  it('sends nothing for a trigger cancelled before the send', async () => {
    let entered = 0
    const stream = streamOf(clientFor('http://127.0.0.1:1/'), () => {
      entered += 1
    })
    const answer = await engineOf(stream).complete(requestOf(() => true))
    expect(entered).toBe(0)
    expect(answer.completion).toBeUndefined()
    await expect(answer.usage).resolves.toEqual({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    })
  })

  it('settles at zero when the gate refuses at the send (nothing POSTed)', async () => {
    const endpoint = await httpEndpoint(answerEmpty)
    try {
      let entered = 0
      const sent: string[] = []
      // The TabStream contract: the client runs the guard last,
      // synchronously, before the HTTP send. The scheduler reads the
      // trigger first (Invoke fires at once): that read passes, and the
      // guard's own read refuses, so the client is entered but posts
      // nothing.
      let reads = 0
      const isCancelled = (): boolean => {
        reads += 1
        return reads > 1
      }
      const stream = streamOf(clientFor(endpoint.url), () => {
        entered += 1
      })
      const answer = await engineOf(stream, undefined, (model) => {
        sent.push(model)
      }).complete(requestOf(isCancelled))
      expect(entered).toBe(1)
      expect(endpoint.hits()).toBe(0)
      expect(sent).toEqual([])
      expect(answer.completion).toBeUndefined()
      await expect(answer.usage).resolves.toEqual({
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
      })
    } finally {
      await endpoint.close()
    }
  })

  it('fails the trigger when the transport fails', async () => {
    const port = await closedPort()
    let entered = 0
    const stream = streamOf(clientFor(`http://127.0.0.1:${String(port)}/`), () => {
      entered += 1
    })
    let failure: unknown
    try {
      await engineOf(stream).complete(requestOf(() => false))
    } catch (error: unknown) {
      failure = error
    }
    expect(entered).toBe(1)
    expect(failure).toBeInstanceOf(Error)
    // The client's own failure for a refused connection, surfaced as it
    // came: the sentence plus the refused code (the port varies per run).
    expect((failure as Error).message).toContain('Meta’s server could not be reached')
    expect((failure as Error).message).toContain('ECONNREFUSED')
  })

  it('rejects the usage when a sent request reports none (its reservation stands)', async () => {
    const endpoint = await httpEndpoint(answerEmpty)
    try {
      let entered = 0
      const stream = streamOf(clientFor(endpoint.url), () => {
        entered += 1
      })
      const answer = await engineOf(stream).complete(requestOf(() => false))
      expect(entered).toBe(1)
      expect(endpoint.hits()).toBe(1)
      expect(answer.completion).toBeUndefined()
      await expect(answer.usage).rejects.toThrow('reported no usage')
    } finally {
      await endpoint.close()
    }
  })

  it('runs a sent request to its end past a mid-flight cancellation (never aborts)', async () => {
    const timings: { received: number; answered: number }[] = []
    const endpoint = await httpEndpoint((response) => {
      const received = Date.now()
      setTimeout(() => {
        timings.push({ received, answered: Date.now() })
        answerEmpty(response)
      }, 200)
    })
    try {
      let isCancelled = false
      let entered = 0
      const stream = streamOf(clientFor(endpoint.url), () => {
        entered += 1
      })
      const engine = engineOf(stream)
      const started = Date.now()
      const answered = engine.complete(requestOf(() => isCancelled))
      await sleep(50)
      isCancelled = true
      const answer = await answered
      const elapsed = Date.now() - started
      // The stream ran to its end instead of aborting: no suggestion, and
      // the usage rejects for want of usage rather than failing abandoned.
      // The client waited out the delayed answer (its own elapsed covers
      // the loopback's delay) instead of ending the request at the
      // cancellation; the loopback's timestamps prove the delay happened.
      expect(entered).toBe(1)
      expect(endpoint.hits()).toBe(1)
      expect(timings).toHaveLength(1)
      expect((timings[0]?.answered ?? 0) - (timings[0]?.received ?? 0)).toBeGreaterThanOrEqual(150)
      expect(elapsed).toBeGreaterThanOrEqual(150)
      expect(answer.completion).toBeUndefined()
      await expect(answer.usage).rejects.toThrow('reported no usage')
    } finally {
      await endpoint.close()
    }
  })

  it('ends a hung request at the backstop with words (safety limit, RLF-SAFELIMITS)', async () => {
    // The product's own client and platform fetch send to a loopback
    // connection that is accepted and never answered: a hung provider, with
    // no provider bytes anywhere. Unbounded code would wait here past the
    // suite's own timeout; the backstop aborts the send after 200 ms and the
    // trigger fails with its words.
    const held = new Set<Socket>()
    const silent = createServer((socket) => {
      held.add(socket)
    })
    await new Promise<void>((done) => {
      silent.listen(0, '127.0.0.1', done)
    })
    try {
      const client = new ModelApiClient({
        ...transportTestDeps({ fetch: globalThis.fetch }),
        baseUrl: `http://127.0.0.1:${String((silent.address() as { readonly port: number }).port)}`,
        apiKey: () => Promise.resolve('tab-backstop-test-key'),
      })
      const stream: TabStream = (body, signal, budget, admit) =>
        client.streamResponse(body, signal, undefined, budget, admit)
      await expect(engineOf(stream, 200).complete(requestOf(() => false))).rejects.toThrow(
        'timed out waiting for the provider',
      )
      expect(held.size).toBe(1)
    } finally {
      for (const socket of held) socket.destroy()
      await new Promise<void>((done) => {
        silent.close(() => {
          done()
        })
      })
    }
  })
})
