import { createServer } from 'node:http'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startPanel } from './helpers/companion'

describe('companion browser security', () => {
  let browser: Browser | undefined
  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  })
  afterAll(async () => {
    await browser?.close()
  })
  it('exchanges the fragment without leaking it, then refuses a foreign form, fetch, EventSource and WebSocket', async () => {
    if (browser === undefined) throw new Error('browser startup failed')
    const panel = await startPanel()
    const foreign = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<!doctype html><html><body></body></html>')
    })
    await new Promise<void>((resolve) => foreign.listen(0, '127.0.0.1', resolve))
    const address = foreign.address()
    if (address === null || typeof address === 'string') throw new Error('foreign fixture bind')
    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      const requests: string[] = []
      page.on('request', (request) => {
        requests.push(request.url())
      })
      const launch = panel.launchUrl()
      const code = new URLSearchParams(new URL(launch).hash.slice(1)).get('k')!
      await page.goto(launch)
      await page.waitForFunction(() => Reflect.get(window, 'panelLoaded') === true)
      expect(page.url()).toBe(panel.url)
      expect(requests.some((url) => url.includes(code))).toBe(false)
      expect(requests.some((url) => url.includes('#k='))).toBe(false)
      const cookies = await context.cookies(panel.url)
      expect(cookies).toHaveLength(1)
      expect(cookies[0]?.httpOnly).toBe(true)
      expect(cookies[0]?.sameSite).toBe('Strict')
      expect(await page.evaluate(() => globalThis.document.cookie)).not.toContain('muse_panel')
      const opened = await page.evaluate(async (url) => {
        const { TextDecoder } = globalThis
        const response = await globalThis.fetch(`${url}events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
          body: '{}',
        })
        const reader = response.body?.getReader()
        const first = await reader?.read()
        await reader?.cancel()
        return response.status === 200 &&
          new TextDecoder().decode(first?.value).includes(': connected')
          ? 'open'
          : 'refused'
      }, panel.url)
      expect(opened).toBe('open')
      const nativeRequest = page.waitForRequest(
        (request) => request.url() === `${panel.url}events` && request.method() === 'GET',
      )
      const nativeResult = await page.evaluate(
        (url) =>
          new Promise<string>((resolve) => {
            const { EventSource } = globalThis
            const events = new EventSource(`${url}events`)
            events.addEventListener('open', () => {
              events.close()
              resolve('accepted')
            })
            events.addEventListener('error', () => {
              events.close()
              resolve('refused')
            })
          }),
        panel.url,
      )
      const captured = await nativeRequest
      expect(await captured.headerValue('origin')).toBe(null)
      expect(await captured.headerValue('sec-fetch-site')).toBe('same-origin')
      expect(nativeResult).toBe('refused')
      const attack = await context.newPage()
      await attack.goto(`http://127.0.0.1:${String(address.port)}/`)
      const formReply = attack.waitForResponse((response) => response.url() === `${panel.url}post`)
      await attack.evaluate((url) => {
        const frame = document.createElement('iframe')
        frame.name = 'attack'
        document.body.append(frame)
        const form = document.createElement('form')
        form.action = `${url}post`
        form.method = 'POST'
        form.target = 'attack'
        document.body.append(form)
        form.submit()
      }, panel.url)
      const refusedForm = await formReply
      expect(refusedForm.status()).toBe(403)
      const result = await attack.evaluate(async (url) => {
        let fetchResult: string
        try {
          await window.fetch(`${url}post`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
            body: '{"kind":"ping"}',
          })
          fetchResult = 'accepted'
        } catch {
          fetchResult = 'refused'
        }
        const eventsResult = await new Promise<string>((resolve) => {
          const events = new EventSource(`${url}events`, { withCredentials: true })
          events.addEventListener('open', () => {
            events.close()
            resolve('accepted')
          })
          events.addEventListener('error', () => {
            events.close()
            resolve('refused')
          })
        })
        const socketResult = await new Promise<string>((resolve) => {
          const socket = new WebSocket(`${url.replace('http:', 'ws:')}post`)
          socket.addEventListener('open', () => {
            socket.close()
            resolve('accepted')
          })
          socket.addEventListener('error', () => {
            resolve('refused')
          })
        })
        return [fetchResult, eventsResult, socketResult]
      }, panel.url)
      expect(result).toEqual(['refused', 'refused', 'refused'])
      expect(panel.handler.post).not.toHaveBeenCalled()
      expect(panel.handler.subscribe).toHaveBeenCalledTimes(1)
    } finally {
      for (const context of browser.contexts()) await context.close()
      await panel.close()
      await new Promise<void>((resolve) => {
        foreign.close(() => {
          resolve()
        })
        foreign.closeAllConnections()
      })
    }
  })
})
