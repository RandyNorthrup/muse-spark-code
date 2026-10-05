import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { call, headers, login, trackedPanels } from './helpers/companion'
const panel = trackedPanels()
describe('companion HTTP server', () => {
  it('serves only the launch bootstrap anonymously, then the injected UI and exact packaged asset', async () => {
    const value = await panel()
    const anonymous = await call(value, '/')
    expect(anonymous.status).toBe(200)
    expect(anonymous.body).toContain('location.hash')
    expect(anonymous.body).toContain("history.replaceState(null, '', location.pathname)")
    expect(anonymous.body).toContain("'X-Muse-Panel': '1'")
    expect(value.renderPage).not.toHaveBeenCalled()
    expect(await call(value, '/assets/client.js')).toHaveProperty('status', 401)
    const cookie = await login(value)
    const page = await call(value, '/', 'GET', undefined, headers(value, cookie))
    expect(page.status).toBe(200)
    const nonce = /nonce="([^"]+)"/.exec(page.body)?.[1] ?? ''
    expect(nonce).toMatch(/^[a-f\d]{64}$/)
    expect(page.headers['content-security-policy']).toContain(`script-src 'nonce-${nonce}'`)
    expect(
      await call(value, '/assets/client.js', 'GET', undefined, headers(value, cookie)),
    ).toHaveProperty('body', 'window.panelLoaded = true')
    for (const path of [
      '/assets/../tokenFile.ts',
      '/assets/%2e%2e/tokenFile.ts',
      '/assets/client.js?key=anything',
      '/.env',
    ]) {
      expect(await call(value, path, 'GET', undefined, headers(value, cookie))).toHaveProperty(
        'status',
        404,
      )
    }
  })
  it('exchanges a code once, issues HttpOnly Strict cookies, and refuses replay or a cookie as a code', async () => {
    const value = await panel()
    const launch = value.launchUrl()
    expect(new URL(launch).search).toBe('')
    expect(launch).toContain('/#k=')
    const code = new URLSearchParams(new URL(launch).hash.slice(1)).get('k')
    const first = await call(value, '/session', 'POST', JSON.stringify({ code }))
    expect(first.status).toBe(200)
    expect(first.headers['set-cookie']?.[0]).toMatch(
      /^muse_panel=[a-f\d]{64}; HttpOnly; SameSite=Strict; Path=\/$/,
    )
    expect(await call(value, '/session', 'POST', JSON.stringify({ code }))).toHaveProperty(
      'status',
      403,
    )
    const id = first.headers['set-cookie']?.[0]?.split(';', 1)[0]?.split('=', 2)[1]
    expect(await call(value, '/session', 'POST', JSON.stringify({ code: id }))).toHaveProperty(
      'status',
      403,
    )
    expect(
      await call(value, '/session', 'POST', JSON.stringify({ code: 'wrong', extra: true })),
    ).toHaveProperty('status', 403)
  })
  it('validates messages before one controller dispatch and sanitizes handler errors', async () => {
    const value = await panel()
    const cookie = await login(value)
    expect(
      await call(value, '/post', 'POST', '{"kind":"ping"}', headers(value, cookie)),
    ).toHaveProperty('status', 202)
    expect(value.handler.post).toHaveBeenCalledTimes(1)
    expect(value.handler.post.mock.calls[0]?.[0]).toEqual({ kind: 'ping' })
    for (const body of ['{}', '{"kind":"ping","apiKey":"synthetic-private"}', '{']) {
      expect(await call(value, '/post', 'POST', body, headers(value, cookie))).toHaveProperty(
        'status',
        400,
      )
    }
    expect(value.handler.post).toHaveBeenCalledTimes(1)
    value.handler.post.mockRejectedValueOnce(new Error('synthetic private account or path'))
    const failed = await call(value, '/post', 'POST', '{"kind":"ping"}', headers(value, cookie))
    expect(failed.status).toBe(500)
    expect(failed.body).toBe('{"error":"EPANEL_HANDLER"}')
  })
  it.each([
    ['wrong Host', (base: string[]) => ['Host', 'foreign.test', ...base.slice(2)]],
    ['duplicate Host', (base: string[]) => [...base, 'Host', base[1]!]],
    ['missing Host', (base: string[]) => base.slice(2)],
    [
      'foreign Origin',
      (base: string[]) => [...base.slice(0, 2), 'Origin', 'http://127.0.0.1:1', ...base.slice(4)],
    ],
    ['missing Origin', (base: string[]) => [...base.slice(0, 2), ...base.slice(4)]],
    ['duplicate Origin', (base: string[]) => [...base, 'Origin', base[3]!]],
    [
      'cross-site metadata',
      (base: string[]) => [...base.slice(0, 4), 'Sec-Fetch-Site', 'cross-site', ...base.slice(6)],
    ],
    ['missing custom header', (base: string[]) => [...base.slice(0, 6), ...base.slice(8)]],
    [
      'wrong custom header',
      (base: string[]) => [...base.slice(0, 6), 'X-Muse-Panel', '0', ...base.slice(8)],
    ],
    ['duplicate custom header', (base: string[]) => [...base, 'X-Muse-Panel', '1']],
  ])('refuses %s before controller dispatch', async (_name, mutate) => {
    const value = await panel()
    const cookie = await login(value)
    const result = await call(
      value,
      '/post',
      'POST',
      '{"kind":"ping"}',
      mutate(headers(value, cookie)),
    )
    // Node rejects malformed HTTP/1.1 without Host before our handler runs.
    expect(result.status).toBe(_name === 'missing Host' ? 400 : 403)
    expect(value.handler.post).not.toHaveBeenCalled()
  })
  it('requires a valid unambiguous cookie and never accepts a bearer in its place', async () => {
    const value = await panel()
    const cookie = await login(value)
    const cases = [
      headers(value),
      headers(value, 'muse_panel=wrong'),
      headers(value, `${cookie}; ${cookie}`),
      [...headers(value, cookie), 'Cookie', cookie],
      [...headers(value), 'Authorization', 'Bearer synthetic-token'],
    ]
    for (const supplied of cases)
      expect(await call(value, '/post', 'POST', '{"kind":"ping"}', supplied)).toHaveProperty(
        'status',
        401,
      )
    expect(value.handler.post).not.toHaveBeenCalled()
  })
  it('caps declared and chunked bodies, refuses forms and invalid UTF-8 before dispatch', async () => {
    const value = await panel()
    const cookie = await login(value)
    const normal = headers(value, cookie)
    expect(
      await call(value, '/post', 'POST', ' '.repeat(257), [...normal, 'Content-Length', '257']),
    ).toHaveProperty('status', 400)
    expect(
      await call(value, '/post', 'POST', ' '.repeat(257), [
        ...normal,
        'Transfer-Encoding',
        'chunked',
      ]),
    ).toHaveProperty('status', 400)
    expect(await call(value, '/post', 'POST', Buffer.from([0xff]), normal)).toHaveProperty(
      'status',
      400,
    )
    const form = normal.map((part) =>
      part === 'application/json' ? 'application/x-www-form-urlencoded' : part,
    )
    expect(await call(value, '/post', 'POST', 'kind=ping', form)).toHaveProperty('status', 400)
    expect(value.handler.post).not.toHaveBeenCalled()
  })
  it('refuses preflight and wrong methods and emits no CORS headers on success or refusal', async () => {
    const value = await panel()
    const cookie = await login(value)
    const results = [
      await call(value, '/'),
      await call(value, '/post', 'POST', '{"kind":"ping"}', headers(value, cookie)),
      await call(value, '/post', 'OPTIONS'),
      await call(value, '/session', 'DELETE'),
      await call(value, '/missing', 'GET', undefined, headers(value, cookie)),
    ]
    expect(results.map((result) => result.status)).toEqual([200, 202, 405, 405, 404])
    for (const result of results) {
      expect(
        Object.keys(result.headers).some((name) => name.startsWith('access-control-allow-')),
      ).toBe(false)
      expect(result.headers['content-security-policy']).toContain("default-src 'none'")
      expect(result.headers['cache-control']).toBe('no-store')
      expect(result.headers['referrer-policy']).toBe('no-referrer')
    }
  })
})
