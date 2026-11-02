// The companion window's side of the MHP routes (M104 lane C), shared by
// the in-process routes suite and the packed companion suite: posts,
// streams, envelopes and lifecycle the way the window's bridge sends
// them, and the refusal shapes both suites assert.
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { expect } from 'vitest'
import { MHP_PANEL } from '../../../src/shared/constants'
import {
  panelEnvelopeSchema,
  panelErrorSchema,
  panelLifecycleSchema,
  type MhpPanelBinding,
} from '../../../src/shared/hostApi/panel'

export interface HttpReply {
  readonly status: number
  readonly authorization: string | undefined
  readonly body: string
}

export interface CompanionCallOptions {
  readonly headers?: Record<string, string>
  readonly body?: string
  /** A declared length without its body: the server refuses on the headers alone. */
  readonly contentLength?: number
}

export function call(url: string, options: CompanionCallOptions = {}): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const headers = { ...options.headers }
    if (options.contentLength !== undefined)
      headers['Content-Length'] = String(options.contentLength)
    else if (options.body !== undefined && headers['Content-Length'] === undefined)
      headers['Content-Length'] = String(Buffer.byteLength(options.body))
    const request = httpRequest(
      {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        response.on('end', () => {
          const authorization = response.headers.authorization
          resolve({
            status: response.statusCode ?? 0,
            authorization: Array.isArray(authorization) ? authorization.join(', ') : authorization,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        response.on('error', reject)
      },
    )
    request.on('error', reject)
    request.end(options.body)
  })
}

export interface CompanionStream {
  readonly opened: Promise<number>
  readonly frames: unknown[]
  readonly closed: Promise<void>
  close(): void
}

/** Reads data frames from a stream the way the window's bridge does. */
export function openStream(url: string, headers: Record<string, string>): CompanionStream {
  const frames: unknown[] = []
  let buffer = ''
  const parsed = new URL(url)
  const request = httpRequest({
    method: 'POST',
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname,
    headers,
  })
  const opened = new Promise<number>((resolve) => {
    request.on('response', (response: IncomingMessage) => {
      resolve(response.statusCode ?? 0)
    })
    request.on('error', () => {
      resolve(0)
    })
  })
  const closed = new Promise<void>((resolve) => {
    request.on('response', (response: IncomingMessage) => {
      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts)
          for (const line of part.split('\n'))
            if (line.startsWith('data:')) frames.push(JSON.parse(line.slice('data:'.length)))
      })
      // The stream always closes: after its last frame, or when it breaks.
      response.once('close', () => {
        resolve()
      })
    })
    request.on('error', () => {
      resolve()
    })
  })
  request.end('{}')
  return {
    opened,
    frames,
    closed,
    close: () => {
      request.destroy()
    },
  }
}

export async function waitFor(frames: readonly unknown[], count: number): Promise<void> {
  const started = Date.now()
  while (frames.length < count) {
    if (Date.now() - started > 4000)
      throw new Error(`only ${String(frames.length)} of ${String(count)} frames arrived`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export function panelHeaders(origin: string, token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: origin,
    'x-muse-panel': '1',
    ...(token !== undefined && { Authorization: `Bearer ${token}` }),
  }
}

export function envelope(surface: string, payload: unknown): string {
  return JSON.stringify(
    panelEnvelopeSchema.parse({
      mhp: MHP_PANEL.wireVersion,
      kind: 'panel',
      surface,
      seq: 1,
      direction: 'toHost',
      payload,
    }),
  )
}

export function lifecycle(binding: MhpPanelBinding, event: 'opened' | 'ready'): string {
  return JSON.stringify(
    panelLifecycleSchema.parse({ mhp: MHP_PANEL.wireVersion, kind: 'surface', ...binding, event }),
  )
}

/** An open window: the token it exchanged, its binding, and the server's origin. */
export interface CompanionWindow {
  readonly token: string
  readonly binding: MhpPanelBinding
  readonly origin: string
}

/** The guard's refusal: its status, and its code as the whole body. */
export function expectGuardRefusal(reply: HttpReply, status: number, code: string): void {
  expect(reply.status).toBe(status)
  expect(reply.body).toBe(JSON.stringify({ error: code }))
}

/** The contract's refusal: its status, and its frame carrying the code. */
export function expectPanelRefusal(reply: HttpReply, status: number, code: string): void {
  expect(reply.status).toBe(status)
  const frame = panelErrorSchema.parse(JSON.parse(reply.body))
  expect(frame.code).toBe(code)
}
