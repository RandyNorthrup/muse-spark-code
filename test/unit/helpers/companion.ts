import { Buffer } from 'node:buffer'
import { request, type IncomingHttpHeaders } from 'node:http'
import * as z from 'zod/mini'
import { afterEach, vi } from 'vitest'
import { startCompanionServer, type CompanionLimits } from '../../../src/runtime/companion/server'

export type Panel = Awaited<ReturnType<typeof startPanel>>

/** Each suite owns its starts; real sockets close after every case, including failures. */
export function trackedPanels() {
  const panels: Panel[] = []
  afterEach(async () => {
    for (const panel of panels.splice(0)) await panel.close()
  })
  return async (...args: Parameters<typeof startPanel>) => {
    const value = await startPanel(...args)
    panels.push(value)
    return value
  }
}

export async function startPanel(
  overrides: Partial<CompanionLimits> = {},
  host?: string,
  signal?: AbortSignal,
) {
  const listeners = new Map<string, (message: unknown) => void>()
  const stop = vi.fn((sessionId: string) => {
    listeners.delete(sessionId)
  })
  const handler = {
    inputSchema: z.strictObject({ kind: z.literal('ping') }),
    outputSchema: z.strictObject({ kind: z.literal('event'), text: z.string() }),
    post: vi.fn((_message: { kind: 'ping' }, _sessionId: string, _signal: AbortSignal) =>
      Promise.resolve(),
    ),
    subscribe: vi.fn((sessionId: string, emit: (message: unknown) => void) => {
      listeners.set(sessionId, emit)
      return () => {
        stop(sessionId)
      }
    }),
  }
  const renderPage = vi.fn(
    (nonce: string) =>
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/client.css"></head><body><script nonce="${nonce}" src="/assets/client.js"></script></body></html>`,
  )
  const server = await startCompanionServer({
    handler,
    limits: {
      maxBodyBytes: 256,
      maxEventBytes: 256,
      requestTimeoutMs: 1000,
      idleTimeoutMs: 5000,
      launchCodeTtlMs: 2000,
      sessionTtlMs: 3000,
      maxSessions: 8,
      ...overrides,
    },
    assets: new Map([
      [
        '/assets/client.css',
        { content: 'body { --companion-loaded: yes; }', contentType: 'text/css' },
      ],
      [
        '/assets/client.js',
        { content: 'window.panelLoaded = true', contentType: 'text/javascript' },
      ],
    ]),
    renderPage,
    ...(host !== undefined && { host }),
    ...(signal !== undefined && { signal }),
  })
  return { ...server, handler, listeners, stop, renderPage }
}

export function headers(panel: Pick<Panel, 'url'>, token?: string): string[] {
  const origin = new URL(panel.url).origin
  return [
    'Host',
    new URL(origin).host,
    'Origin',
    origin,
    'Sec-Fetch-Site',
    'same-origin',
    'X-Muse-Panel',
    '1',
    'Content-Type',
    'application/json',
    ...(token === undefined ? [] : ['Authorization', `Bearer ${token}`]),
  ]
}

export function call(
  panel: Pick<Panel, 'url'>,
  path: string,
  method = 'GET',
  body?: string | Buffer,
  supplied?: string[],
) {
  return new Promise<{
    status: number
    headers: IncomingHttpHeaders
    body: string
  }>((resolve, reject) => {
    const outgoing = request(
      new URL(path, panel.url),
      { method, headers: supplied ?? headers(panel), setHost: false },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

export async function login(panel: Panel): Promise<string> {
  const code = new URLSearchParams(new URL(panel.launchUrl()).hash.slice(1)).get('k')
  const result = await call(panel, '/session', 'POST', JSON.stringify({ code }))
  if (result.status !== 200) throw new Error(`login failed: ${result.body}`)
  const token = result.headers.authorization?.slice('Bearer '.length)
  if (token === undefined) throw new Error('login token absent')
  return token
}
