import { createServer } from 'node:http'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { call, headers, startPanel, trackedPanels } from './helpers/companion'

const tracked = trackedPanels()

/** Runs in the browser; both fetch overloads must retain the private bearer. */
async function postFromPage(isRequest: boolean): Promise<number> {
  const { fetch, Request, URL, location } = globalThis
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
    body: '{"kind":"ping"}',
  }
  const response = isRequest
    ? await fetch(new Request(new URL('/post', location.href), init))
    : await fetch('/post', init)
  return response.status
}

async function openPage(page: Page, launch: string): Promise<void> {
  await page.goto(launch)
  await page.waitForLoadState('networkidle')
  expect(await page.evaluate(() => Reflect.get(globalThis.window, 'panelLoaded') === true)).toBe(
    true,
  )
  const root = new URL(launch)
  root.hash = ''
  expect(page.url()).toBe(root.href)
}

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
    let capturedCookie: string | undefined
    let capturedAuthorization: string | undefined
    const foreign = createServer((request, response) => {
      capturedCookie = request.headers.cookie
      capturedAuthorization = request.headers.authorization
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
      await openPage(page, launch)
      expect(
        await page.evaluate(() =>
          globalThis
            .getComputedStyle(globalThis.document.body)
            .getPropertyValue('--companion-loaded')
            .trim(),
        ),
      ).toBe('yes')
      expect(requests.some((url) => url.includes(code))).toBe(false)
      expect(requests.some((url) => url.includes('#k='))).toBe(false)
      const cookies = await context.cookies(panel.url)
      expect(cookies).toHaveLength(0)
      expect(await page.evaluate(() => globalThis.document.cookie)).not.toContain('muse_panel')
      expect(
        await page.evaluate(
          async (foreignUrl) => {
            try {
              await globalThis.fetch(foreignUrl)
              return 'accepted'
            } catch (error) {
              return error instanceof Error ? error.message : 'unknown'
            }
          },
          `http://127.0.0.1:${String(address.port)}/`,
        ),
      ).toBe('EPANEL_ORIGIN')
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
      expect(capturedCookie).toBeUndefined()
      expect(capturedAuthorization).toBeUndefined()
      const replay = await call(panel, '/post', 'POST', '{"kind":"ping"}', [
        ...headers(panel),
        'Cookie',
        capturedCookie ?? '',
        'Authorization',
        capturedAuthorization ?? '',
      ])
      expect(replay.status).toBe(401)
      expect(
        await attack.evaluate(() => [
          globalThis.localStorage.length,
          globalThis.sessionStorage.length,
        ]),
      ).toEqual([0, 0])
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
  it('exchanges fresh codes in two tabs and opens independent authenticated streams', async () => {
    if (browser === undefined) throw new Error('browser startup failed')
    const panel = await tracked()
    const context = await browser.newContext()
    try {
      for (const index of [0, 1]) {
        const page = await context.newPage()
        const launch = panel.launchUrl()
        await openPage(page, launch)
        const code = new URLSearchParams(new URL(launch).hash.slice(1)).get('k')
        expect(await call(panel, '/session', 'POST', JSON.stringify({ code }))).toHaveProperty(
          'status',
          403,
        )
        expect(
          await page.evaluate(async () => {
            const { fetch, window } = globalThis
            const response = await fetch('/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
              body: '{}',
            })
            Reflect.set(window, 'streamReader', response.body?.getReader())
            return response.status
          }),
        ).toBe(200)
        expect(await page.evaluate(postFromPage, index === 1)).toBe(202)
      }
      expect(panel.handler.subscribe).toHaveBeenCalledTimes(2)
      expect(panel.listeners.size).toBe(2)
      expect(new Set(panel.handler.post.mock.calls.map((entry) => entry[1])).size).toBe(2)
      expect(await context.cookies()).toHaveLength(0)
    } finally {
      await context.close()
    }
  })
  it('keeps two runtimes authenticated in one browser context without cross-runtime bearer replay', async () => {
    if (browser === undefined) throw new Error('browser startup failed')
    const first = await tracked()
    const second = await tracked()
    const context = await browser.newContext()
    try {
      for (const panel of [first, second]) {
        const page = await context.newPage()
        await openPage(page, panel.launchUrl())
      }
      for (const [index, page] of context.pages().entries()) {
        const request = page.waitForRequest((value) => value.url().endsWith('/post'))
        expect(await page.evaluate(postFromPage, false)).toBe(202)
        const captured = await request
        const authorization = await captured.headerValue('authorization')
        expect(authorization?.startsWith('Bearer ')).toBe(true)
        const other = index === 0 ? second : first
        expect(
          await call(other, '/post', 'POST', '{"kind":"ping"}', [
            ...headers(other),
            'Authorization',
            authorization ?? '',
          ]),
        ).toHaveProperty('status', 401)
        expect(
          await page.evaluate(() => [
            globalThis.localStorage.length,
            globalThis.sessionStorage.length,
          ]),
        ).toEqual([0, 0])
      }
      expect(await context.cookies()).toHaveLength(0)
      expect(first.handler.post).toHaveBeenCalledTimes(1)
      expect(second.handler.post).toHaveBeenCalledTimes(1)
    } finally {
      await context.close()
    }
  })
  it.each(['missing', 'invalid', 'expired', 'exchange failure', 'invalid bearer', 'asset failure'])(
    'shows focused accessible reopen guidance on %s launch without an unhandled error',
    async (failure) => {
      if (browser === undefined) throw new Error('browser startup failed')
      const panel = await tracked(failure === 'expired' ? { launchCodeTtlMs: 1 } : {})
      const context = await browser.newContext({ viewport: { width: 320, height: 480 } })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => {
        errors.push(error.message)
      })
      try {
        if (failure === 'exchange failure' || failure === 'invalid bearer') {
          await page.route('**/session', (route) =>
            route.fulfill({
              status: failure === 'exchange failure' ? 500 : 200,
              headers: { Authorization: 'Bearer invalid' },
              body: failure === 'invalid bearer' ? panel.renderPage('fixture-nonce') : '',
            }),
          )
          if (failure === 'invalid bearer')
            await page.route('**/assets/client.*', (route) =>
              route.fulfill({
                status: 200,
                body: route.request().url().endsWith('.css')
                  ? 'body {}'
                  : 'window.panelLoaded = true',
              }),
            )
        } else if (failure === 'asset failure')
          await page.route('**/assets/client.js', (route) =>
            route.fulfill({ status: 500, body: '' }),
          )
        let launch = panel.url
        if (failure === 'invalid') launch = `${panel.url}#k=invalid`
        else if (failure !== 'missing') launch = panel.launchUrl()
        if (failure === 'expired') await new Promise((resolve) => setTimeout(resolve, 2))
        await page.goto(launch)
        const alert = page.getByRole('alert')
        await page.locator('html[data-launch]').waitFor()
        expect(await alert.isVisible()).toBe(true)
        expect(await alert.textContent()).toBe(UI_TEXT.companionLaunchFailed)
        expect(await alert.evaluate((element) => element === document.activeElement)).toBe(true)
        expect(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
        ).toBe(true)
        expect(page.url()).toBe(panel.url)
        expect(errors).toEqual([])
        expect(panel.handler.post).not.toHaveBeenCalled()
      } finally {
        await context.close()
      }
    },
  )
})
