// Desktop observability (M111 lane OB, PLAN.md D91.22): the local OTLP
// receiver. A small OTLP/HTTP JSON server (not the collector: too large
// for a Pi, research §11) on loopback only — anything but a loopback
// bind is refused, never widened (D65). Batches validate through the
// core ingest and land in the ring store; refusals answer in fixed words.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  NODE_HTTP_STATUS,
  NODE_HTTP_TIMEOUT_MS,
  O11Y_RECEIVER_HOST,
  O11Y_RECEIVER_MAX_BODY_BYTES,
  O11Y_RECEIVER_PORT,
} from '../../shared/constants'
import {
  O11Y_SIGNAL_ROUTES,
  ingestOtlpLogs,
  ingestOtlpMetrics,
  ingestOtlpTraces,
  type O11ySignal,
} from '../../core/o11y/signals'
import type { O11yRingStore } from './store'

/** A loopback host: the only bind the receiver allows. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost'])

/** The JSON content type the receiver parses, before any `;` suffix; protobuf is refused. */
const JSON_CONTENT_TYPE = 'application/json'

export interface O11yReceiverOptions {
  readonly store: O11yRingStore
  /** Loopback only; anything else throws. Defaults to 127.0.0.1. */
  readonly host?: string
  /** Defaults to O11Y_RECEIVER_PORT; 0 takes any free loopback port. */
  readonly port?: number
  /**
  Files a store failure the batch already answered; implementations print
  a fixed sentence, never the error's text. Anything else a batch throws
  is a bug and surfaces, as the node's listener does.
  */
  readonly report?: (error: unknown) => void
}

export interface O11yReceiver {
  readonly url: string
  /** Batches refused since start, by fixed reason. */
  readonly refused: ReadonlyMap<string, number>
  close(): Promise<void>
}

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

/** The signal routes by path, for the request router. */
const SIGNAL_ROUTES: Readonly<Record<string, O11ySignal>> = {
  [O11Y_SIGNAL_ROUTES.metrics]: 'metrics',
  [O11Y_SIGNAL_ROUTES.logs]: 'logs',
  [O11Y_SIGNAL_ROUTES.traces]: 'traces',
}

function signalForPath(path: string | undefined): O11ySignal | undefined {
  return path === undefined ? undefined : SIGNAL_ROUTES[path]
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let isSettled = false
    let isTooLarge = false
    const done = (body: string | undefined): void => {
      if (isSettled) return
      isSettled = true
      resolve(body)
    }
    request.on('data', (chunk: Buffer) => {
      // Past the cap the rest drains unread: the socket stays open so the
      // 413 below still reaches the sender.
      if (isTooLarge) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        isTooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      done(isTooLarge ? undefined : Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', () => {
      done(undefined)
    })
  })
}

function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(body)
}

/** Start the local OTLP receiver; throws when the bind is not loopback. */
export async function startO11yReceiver(options: O11yReceiverOptions): Promise<O11yReceiver> {
  const host = options.host ?? O11Y_RECEIVER_HOST
  if (!isLoopback(host)) throw new RangeError('o11y receiver binds loopback only')
  const refused = new Map<string, number>()
  const countRefused = (reason: string): void => {
    refused.set(reason, (refused.get(reason) ?? 0) + 1)
  }
  const server: Server = createServer((request, response) => {
    void handleRequest(request, response, options.store, countRefused, options.report)
  })
  // A sender that never finishes never holds a connection past this, as
  // on the node's own listener.
  server.headersTimeout = NODE_HTTP_TIMEOUT_MS
  server.requestTimeout = NODE_HTTP_TIMEOUT_MS
  server.timeout = NODE_HTTP_TIMEOUT_MS
  const port = options.port ?? O11Y_RECEIVER_PORT
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host, port, exclusive: true }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  return {
    url: `http://${host}:${String(bound)}`,
    refused,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    },
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: O11yRingStore,
  countRefused: (reason: string) => void,
  report: ((error: unknown) => void) | undefined,
): Promise<void> {
  const signal = signalForPath(request.url?.split('?', 2)[0])
  if (signal === undefined || request.method !== 'POST') {
    countRefused('not-found')
    send(response, NODE_HTTP_STATUS.notFound, '{"error":"not-found"}')
    return
  }
  const contentType = request.headers['content-type']?.split(';', 2)[0]?.trim().toLowerCase()
  if (contentType !== undefined && contentType !== JSON_CONTENT_TYPE) {
    countRefused('not-json')
    send(response, NODE_HTTP_STATUS.notText, '{"error":"not-json"}')
    return
  }
  const body = await readBody(request, O11Y_RECEIVER_MAX_BODY_BYTES)
  // A destroyed response (a timeout beat the read) takes no answer; the
  // request itself always reads destroyed after its end, so only the
  // response decides.
  if (response.destroyed) {
    countRefused('aborted')
    return
  }
  if (body === undefined) {
    countRefused('too-large')
    send(response, NODE_HTTP_STATUS.tooLarge, '{"error":"too-large"}')
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body) as unknown
  } catch (error: unknown) {
    // Only a malformed batch refuses: anything else keeps its kind past
    // the receiver.
    if (!(error instanceof SyntaxError)) throw error
    countRefused('malformed')
    send(response, NODE_HTTP_STATUS.invalidRequest, '{"error":"malformed"}')
    return
  }
  const refuseIngest = (reason: string): void => {
    countRefused(reason)
    send(response, NODE_HTTP_STATUS.invalidRequest, JSON.stringify({ error: reason }))
  }
  try {
    if (signal === 'metrics') {
      const ingested = ingestOtlpMetrics(parsed)
      if (!ingested.ok) {
        refuseIngest(ingested.reason)
        return
      }
      await store.appendMetrics(ingested.records)
    } else if (signal === 'logs') {
      const ingested = ingestOtlpLogs(parsed)
      if (!ingested.ok) {
        refuseIngest(ingested.reason)
        return
      }
      await store.appendLogs(ingested.records)
    } else {
      const ingested = ingestOtlpTraces(parsed)
      if (!ingested.ok) {
        refuseIngest(ingested.reason)
        return
      }
      await store.appendSpans(ingested.records)
    }
  } catch (error: unknown) {
    // Only a store failure fails the batch: anything else keeps its kind
    // past the receiver.
    if (!(error instanceof Error)) throw error
    report?.(error)
    countRefused('store-failed')
    send(response, NODE_HTTP_STATUS.unavailable, '{"error":"store-failed"}')
    return
  }
  send(response, NODE_HTTP_STATUS.ok, '{}')
}
