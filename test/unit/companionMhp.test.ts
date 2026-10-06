import { request, type IncomingMessage } from 'node:http'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startCompanionServer } from '../../src/runtime/companion/server'
import {
  MhpPanelError,
  panelEnvelopeSchema,
  panelErrorSchema,
  panelLifecycleSchema,
} from '../../src/shared/hostApi/panel'
import { call, headers } from './helpers/companion'

const servers: Awaited<ReturnType<typeof startCompanionServer>>[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})
const binding = {
  mhp: '1.1',
  kind: 'surface',
  surface: 'a/b',
  sessionId: 'session',
  surfaceKind: 'chat',
  event: 'opened',
}
const input = {
  mhp: '1.1',
  kind: 'panel',
  surface: 'a/b',
  direction: 'toHost',
  seq: 1,
  payload: { type: 'ready' },
}
async function fixture() {
  let emit: ((message: unknown) => void) | undefined
  const post = vi.fn(() => Promise.resolve())
  const surface = vi.fn(() => Promise.resolve())
  const handler = {
    inputSchema: panelEnvelopeSchema,
    outputSchema: z.union([panelEnvelopeSchema, panelErrorSchema]),
    surfaceSchema: panelLifecycleSchema,
    post,
    surface,
    subscribe: (_id: string, listener: (message: unknown) => void) => {
      emit = listener
      return () => {
        emit = undefined
      }
    },
  }
  const server = await startCompanionServer({
    handler,
    limits: {
      maxBodyBytes: 1024,
      maxEventBytes: 4096,
      requestTimeoutMs: 1000,
      idleTimeoutMs: 5000,
      launchCodeTtlMs: 1000,
      sessionTtlMs: 5000,
      maxSessions: 2,
    },
    assets: new Map(),
    renderPage: () => '<html></html>',
  })
  servers.push(server)
  const code = new URLSearchParams(new URL(server.launchUrl()).hash.slice(1)).get('k')
  const signed = await call(server, '/session', 'POST', JSON.stringify({ code }))
  const token = signed.headers.authorization?.slice('Bearer '.length)
  if (token === undefined) throw new Error('missing fake bearer')
  return { server, post, surface, token, emit: (message: unknown) => emit?.(message) }
}
describe('MHP companion endpoints', () => {
  it('admits message and lifecycle at their frozen paths with empty 204 responses', async () => {
    const f = await fixture()
    const admissions: readonly [string, unknown][] = [
      ['/panel/message', input],
      ['/panel/surface', binding],
    ]
    for (const [path, body] of admissions) {
      const result = await call(
        f.server,
        path,
        'POST',
        JSON.stringify(body),
        headers(f.server, f.token),
      )
      expect(result.status).toBe(204)
      expect(result.body).toBe('')
    }
    expect(f.post).toHaveBeenCalledTimes(1)
    expect(f.surface).toHaveBeenCalledTimes(1)
    expect(
      await call(f.server, '/post', 'POST', JSON.stringify(input), headers(f.server, f.token)),
    ).toHaveProperty('status', 404)
  })
  it('returns typed redacted admission errors with their HTTP status', async () => {
    const f = await fixture()
    for (const [code, status] of [
      ['MHP_PANEL_UNKNOWN_SURFACE', 404],
      ['MHP_PANEL_OUT_OF_ORDER', 409],
      ['MHP_PANEL_TOO_LARGE', 413],
      ['MHP_PANEL_BACKPRESSURE', 429],
    ] as const) {
      f.post.mockRejectedValueOnce(
        new MhpPanelError({ mhp: '1.1', kind: 'panelError', surface: 'a/b', seq: 1, code }),
      )
      const result = await call(
        f.server,
        '/panel/message',
        'POST',
        JSON.stringify(input),
        headers(f.server, f.token),
      )
      expect(result.status).toBe(status)
      expect(panelErrorSchema.parse(JSON.parse(result.body))).toMatchObject({
        code,
        surface: 'a/b',
        seq: 1,
      })
    }
    const invalid = await call(f.server, '/panel/message', 'POST', '{}', headers(f.server, f.token))
    expect(invalid.status).toBe(400)
    expect(panelErrorSchema.parse(JSON.parse(invalid.body)).code).toBe('MHP_PANEL_INVALID_PAYLOAD')
  })
  it('streams named MHP events with encoded per-surface sequence ids', async () => {
    const f = await fixture()
    const outgoing = request(new URL('/panel/events', f.server.url), {
      headers: headers(f.server, f.token),
    })
    const ready = new Promise<IncomingMessage>((resolve, reject) => {
      outgoing.once('response', resolve)
      outgoing.once('error', reject)
    })
    outgoing.end()
    const response = await ready
    expect(response.statusCode).toBe(200)
    let received = ''
    response.setEncoding('utf8').on('data', (part: string) => {
      received += part
    })
    const output = {
      ...input,
      direction: 'toPanel',
      payload: { type: 'notice', level: 'info', text: 'safe' },
    }
    f.emit(output)
    await vi.waitFor(() => {
      expect(received).toContain(
        `event: mhp\nid: a%2Fb:toPanel:1\ndata: ${JSON.stringify(panelEnvelopeSchema.parse(output))}\n\n`,
      )
    })
    response.destroy()
    outgoing.destroy()
  })
})
