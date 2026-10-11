import { connect, Server } from 'node:net'
import { request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { startChatGptCallback } from '../../src/runtime/chatGptCallback'
import { OAUTH_CODE_TTL_MS } from '../../src/shared/constants'

const STATE = 'synthetic_state_123456789'
const PAGE = '<script>synthetic</script> & done'
const QUERY = new URLSearchParams({
  code: 'synthetic-code',
  state: STATE,
  client_id: 'oaiapp_synthetic',
  scope: 'chatgpt.tokens.use.direct',
})

describe('ACP ChatGPT callback', () => {
  it('binds the exact loopback route and returns one captured callback with a plain localized page', async () => {
    let text = PAGE
    const listening = vi.spyOn(Server.prototype, 'listen')
    const callback = await startChatGptCallback(STATE, 1000, () => text)
    try {
      expect(listening).toHaveBeenLastCalledWith(0, '127.0.0.1', expect.any(Function))
      expect(callback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/u)
      const waiting = callback.waitForCallback()
      text = 'changed at use time <&>'
      const response = await fetch(`${callback.redirectUri}?${QUERY.toString()}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.text()).toBe(text)
      await expect(waiting).resolves.toBe(`${callback.redirectUri}?${QUERY.toString()}`)
      await expect(callback.waitForCallback()).rejects.toThrow('invalid-callback')
      await expect(fetch(callback.redirectUri)).rejects.toThrow()
    } finally {
      callback.close()
      listening.mockRestore()
    }
  })

  it.each([
    '?code=synthetic&state=wrong&client_id=issued&scope=direct',
    `?${QUERY.toString()}&state=${STATE}`,
    `?${QUERY.toString()}&code=another`,
    `?state=${STATE}&scope=direct&code=synthetic`,
    `?state=${STATE}&client_id=dynamic_agent_client&scope=direct&code=synthetic`,
    `?state=${STATE}&client_id=issued&scope=direct`,
    '?error=access_denied&error_description=synthetic-private-detail',
  ])('rejects malformed, forged or refused callback %s without reflecting it', async (query) => {
    const callback = await startChatGptCallback(STATE, 1000, () => PAGE)
    const refused = expect(callback.waitForCallback()).rejects.toThrow('invalid-callback')
    try {
      const response = await fetch(`${callback.redirectUri}${query}`)
      expect(response.status).toBe(400)
      expect(await response.text()).toBe(PAGE)
      await refused
      await expect(fetch(callback.redirectUri)).rejects.toThrow()
    } finally {
      callback.close()
    }
  })

  it('ignores wrong paths, methods and Host headers without consuming the callback', async () => {
    const callback = await startChatGptCallback(STATE, 1000, () => PAGE)
    try {
      const waiting = callback.waitForCallback()
      const missing = await fetch(`${callback.redirectUri}/wrong`)
      const posted = await fetch(callback.redirectUri, { method: 'POST' })
      expect(missing.status).toBe(404)
      expect(posted.status).toBe(405)
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const sent = request(
          callback.redirectUri,
          { headers: { Host: 'phishing.example' } },
          (response) => {
            response.resume()
            resolve(response.statusCode)
          },
        )
        sent.once('error', reject)
        sent.end()
      })
      expect(status).toBe(400)
      const absolute = await new Promise<number | undefined>((resolve, reject) => {
        const sent = request(
          callback.redirectUri,
          { path: `https://phishing.example/auth/callback?${QUERY.toString()}` },
          (response) => {
            response.resume()
            resolve(response.statusCode)
          },
        )
        sent.once('error', reject)
        sent.end()
      })
      expect(absolute).toBe(400)
      const valid = await fetch(`${callback.redirectUri}?${QUERY.toString()}`)
      expect(valid.status).toBe(200)
      await expect(waiting).resolves.toContain('synthetic-code')
    } finally {
      callback.close()
    }
  })

  it('starts its deadline before wait and closes on timeout', async () => {
    const callback = await startChatGptCallback(STATE, 20, () => PAGE)
    try {
      await new Promise((resolve) => setTimeout(resolve, 40))
      await expect(fetch(callback.redirectUri)).rejects.toThrow()
      await expect(callback.waitForCallback()).rejects.toThrow('invalid-callback')
    } finally {
      callback.close()
    }
  })

  it('cancels and destroys incomplete requests, including cancellation before wait', async () => {
    const controller = new AbortController()
    const callback = await startChatGptCallback(STATE, 1000, () => PAGE, controller.signal)
    const url = new URL(callback.redirectUri)
    const socket = connect(Number(url.port), url.hostname)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      socket.write('GET /auth/callback HTTP/1.1\r\n')
      const closed = new Promise((resolve) => socket.once('close', resolve))
      controller.abort()
      await Promise.race([
        closed,
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('cancellation did not close the socket promptly'))
          }, 200)
        }),
      ])
      await expect(callback.waitForCallback()).rejects.toThrow('invalid-callback')
      await expect(fetch(callback.redirectUri)).rejects.toThrow()
      callback.close()
    } finally {
      socket.destroy()
      callback.close()
    }
  })

  it('makes close idempotent and rejects a waiting callback', async () => {
    const callback = await startChatGptCallback(STATE, 1000, () => PAGE)
    const waiting = callback.waitForCallback()
    callback.close()
    callback.close()
    await expect(waiting).rejects.toThrow('invalid-callback')
  })

  it.each([0, -1, NaN, Infinity, OAUTH_CODE_TTL_MS + 1])(
    'refuses an invalid callback lifetime %s',
    async (timeout) => {
      await expect(startChatGptCallback(STATE, timeout, () => PAGE)).rejects.toThrow(
        'invalid-callback',
      )
    },
  )

  it('refuses an invalid state and an already cancelled start', async () => {
    await expect(startChatGptCallback('short', 1000, () => PAGE)).rejects.toThrow(
      'invalid-callback',
    )
    const controller = new AbortController()
    controller.abort()
    await expect(startChatGptCallback(STATE, 1000, () => PAGE, controller.signal)).rejects.toThrow()
  })
})
