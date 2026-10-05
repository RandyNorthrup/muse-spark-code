import { request, type IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { call, headers, login, startPanel, trackedPanels, type Panel } from './helpers/companion'
const tracked = trackedPanels()

function holdUntilAbort(panel: Panel) {
  let signal: AbortSignal | undefined
  panel.handler.post.mockImplementation((_message, _id, passed) => {
    signal = passed
    return new Promise<void>((resolve) => {
      passed.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
  })
  return () => signal
}
function stream(panel: Panel, cookie: string) {
  const outgoing = request(new URL('/events', panel.url), { headers: headers(panel, cookie) })
  const ready = new Promise<IncomingMessage>((resolve, reject) => {
    outgoing.once('response', resolve)
    outgoing.once('error', reject)
  })
  outgoing.end()
  return { outgoing, ready }
}

function streamText(response: IncomingMessage) {
  let text = ''
  response.setEncoding('utf8')
  response.on('data', (chunk: string) => {
    text += chunk
  })
  return () => text
}
describe('companion lifecycle and SSE', () => {
  it.each(['0.0.0.0', '192.168.1.2', 'localhost', '127.1', '::', 'example.test'])(
    'refuses nonliteral loopback bind %s',
    async (host) => {
      await expect(startPanel({}, host)).rejects.toThrow('EPANEL_BIND')
    },
  )
  it('binds explicit IPv6 loopback with bracketed authority', async () => {
    const panel = await tracked({}, '::1')
    expect(new URL(panel.url).hostname).toBe('[::1]')
    expect(await call(panel, '/')).toHaveProperty('status', 200)
    expect(await login(panel)).toMatch(/^muse_panel=/)
  })
  it.each([0, -1, 1.5, NaN, Infinity])('refuses invalid limits %s', async (idleTimeoutMs) => {
    await expect(startPanel({ idleTimeoutMs })).rejects.toThrow('EPANEL_LIMITS')
  })
  it('closes and revokes launch URLs on runtime abort; close remains idempotent', async () => {
    const controller = new AbortController()
    const panel = await tracked({}, undefined, controller.signal)
    controller.abort()
    await panel.closed
    expect(() => panel.launchUrl()).toThrow('EPANEL_CLOSED')
    await expect(call(panel, '/')).rejects.toThrow()
    await panel.close()
    await panel.close()
    await expect(startPanel({}, undefined, controller.signal)).rejects.toThrow()
  })
  it('exits on idle even while an untrusted caller repeats bootstrap requests', async () => {
    const panel = await tracked({ idleTimeoutMs: 150 })
    await call(panel, '/')
    await panel.closed
    expect(() => panel.launchUrl()).toThrow('EPANEL_CLOSED')
  })
  it('renews idle on authenticated activity', async () => {
    const panel = await tracked({ idleTimeoutMs: 250 })
    const cookie = await login(panel)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await call(panel, '/', 'GET', undefined, headers(panel, cookie))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await call(panel, '/', 'GET', undefined, headers(panel, cookie))).toHaveProperty(
      'status',
      200,
    )
  })
  it('streams validated events once, refuses duplicate streams, then unsubscribes on disconnect', async () => {
    const panel = await tracked()
    const cookie = await login(panel)
    const live = stream(panel, cookie)
    const response = await live.ready
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream')
    const received = streamText(response)
    expect(await call(panel, '/events', 'GET', undefined, headers(panel, cookie))).toHaveProperty(
      'status',
      403,
    )
    const emit = panel.listeners.values().next().value!
    emit({ kind: 'event', text: 'line one\nline two' })
    await vi.waitFor(() => {
      expect(received()).toContain('data: {"kind":"event","text":"line one\\nline two"}\n\n')
    })
    response.destroy()
    live.outgoing.destroy()
    await vi.waitFor(() => {
      expect(panel.stop).toHaveBeenCalledTimes(1)
    })
    expect(panel.listeners.size).toBe(0)
    emit({ kind: 'event', text: 'late' })
    const fresh = stream(panel, cookie)
    const second = await fresh.ready
    second.destroy()
    fresh.outgoing.destroy()
  })
  it('keeps a fast stream alive after a large valid frame crosses the Node high-water mark', async () => {
    const panel = await tracked({ maxEventBytes: 200_000 })
    const cookie = await login(panel)
    const live = stream(panel, cookie)
    const response = await live.ready
    const received = streamText(response)
    const emit = panel.listeners.values().next().value!
    emit({ kind: 'event', text: 'x'.repeat(100_000) })
    await vi.waitFor(() => {
      expect(received().length).toBeGreaterThan(100_000)
    })
    expect(panel.stop).not.toHaveBeenCalled()
    emit({ kind: 'event', text: 'still-live' })
    await vi.waitFor(() => {
      expect(received()).toContain('still-live')
    })
    response.destroy()
    live.outgoing.destroy()
  })
  it.each([
    ['invalid schema', { kind: 'event', text: 'safe', apiKey: 'synthetic-secret' }],
    ['over-cap event', { kind: 'event', text: 'x'.repeat(257) }],
  ])('disconnects on %s without sending that event', async (_name, message) => {
    const panel = await tracked()
    const cookie = await login(panel)
    const live = stream(panel, cookie)
    const response = await live.ready
    const received = streamText(response)
    const ended = new Promise<void>((resolve) => response.once('end', resolve))
    const emit = panel.listeners.values().next().value!
    emit(message)
    await ended
    expect(received()).not.toContain('data:')
    expect(received()).not.toContain('synthetic-secret')
    expect(panel.stop).toHaveBeenCalledTimes(1)
  })
  it('requires exact Origin and cookie for events', async () => {
    const panel = await tracked()
    const cookie = await login(panel)
    expect(await call(panel, '/events')).toHaveProperty('status', 401)
    const base = headers(panel, cookie)
    expect(
      await call(panel, '/events', 'GET', undefined, [...base.slice(0, 2), ...base.slice(4)]),
    ).toHaveProperty('status', 403)
    expect(
      await call(panel, '/events', 'GET', undefined, [
        ...base.slice(0, 2),
        'Origin',
        'http://127.0.0.1:1',
        ...base.slice(4),
      ]),
    ).toHaveProperty('status', 403)
    expect(panel.handler.subscribe).not.toHaveBeenCalled()
  })
  it('validates the POST SSE body before subscribing', async () => {
    const panel = await tracked()
    const cookie = await login(panel)
    const bad = await call(
      panel,
      '/events',
      'POST',
      '{"apiKey":"synthetic-private"}',
      headers(panel, cookie),
    )
    expect(bad.status).toBe(400)
    expect(panel.handler.subscribe).not.toHaveBeenCalled()
  })
  it('refuses a cookie that expires while the request body is arriving', async () => {
    const panel = await tracked({ sessionTtlMs: 100 })
    const cookie = await login(panel)
    const outgoing = request(new URL('/post', panel.url), {
      method: 'POST',
      headers: [...headers(panel, cookie), 'Content-Length', '15'],
    })
    const reply = new Promise<number>((resolve, reject) => {
      outgoing.once('response', (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      outgoing.once('error', reject)
    })
    outgoing.write('{')
    await new Promise((resolve) => setTimeout(resolve, 150))
    outgoing.end('"kind":"ping"}')
    expect(await reply).toBe(401)
    expect(panel.handler.post).not.toHaveBeenCalled()
  })
  it('expires cookies and terminates their SSE subscriptions', async () => {
    const panel = await tracked({ sessionTtlMs: 200 })
    const cookie = await login(panel)
    const live = stream(panel, cookie)
    const response = await live.ready
    response.resume()
    await new Promise<void>((resolve) => response.once('end', resolve))
    expect(panel.stop).toHaveBeenCalledTimes(1)
    expect(
      await call(panel, '/post', 'POST', '{"kind":"ping"}', headers(panel, cookie)),
    ).toHaveProperty('status', 401)
  })
  it('aborts a stuck handler at request deadline and hides private errors', async () => {
    const panel = await tracked({ requestTimeoutMs: 100 })
    const cookie = await login(panel)
    const signal = holdUntilAbort(panel)
    await expect(
      call(panel, '/post', 'POST', '{"kind":"ping"}', headers(panel, cookie)),
    ).rejects.toThrow()
    expect(signal()?.aborted).toBe(true)
  })
  it('aborts active calls and closes SSE on shutdown, releasing subscriptions once', async () => {
    const panel = await tracked()
    const cookie = await login(panel)
    const live = stream(panel, cookie)
    const response = await live.ready
    response.resume()
    const signal = holdUntilAbort(panel)
    const pending = call(panel, '/post', 'POST', '{"kind":"ping"}', headers(panel, cookie))
    const failed = expect(pending).rejects.toThrow()
    await vi.waitFor(() => {
      expect(signal()).toBeDefined()
    })
    await panel.close()
    await failed
    expect(signal()?.aborted).toBe(true)
    expect(panel.stop).toHaveBeenCalledTimes(1)
  })
})
