import { createServer } from 'node:http'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { call, headers, startPanel, trackedPanels } from './helpers/companion'
import { warmBrowser } from './helpers/warmBrowser'

const tracked = trackedPanels()
// Warm the real browser during file loading, before the assertion hooks. Chrome
// startup contends with hosted-runner transforms; it is shared by all nine cases.
const browser: Browser = await chromium.launch({ channel: 'chrome', headless: true })
// Browser-wide first-page work once, under this hook's own limit (CIFIX017).
beforeAll(async () => {
  await warmBrowser(browser)
})
// Launch alone does not start a renderer. Warm one before the first timed case;
// every security case still gets its own fresh context and real navigation.
const warmContext = await browser.newContext()
try {
  const warmPage = await warmContext.newPage()
  await warmPage.goto('about:blank')
  await warmPage.evaluate(() => document.readyState)
} finally {
  await warmContext.close()
}
const SESSION_CLOCK_MS = Date.UTC(2026, 9, 7)
const BROWSER_CLOSE_GRACE_MS = 5000
// Each case drives a real Chrome page through the companion's authenticated
// server; three took 3.1 to 3.7 s on hosted runners with coverage.
// PLAN.md §8 (2026-10-07).
const REAL_BROWSER_CASE_TIMEOUT_MS = 20_000

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
  await page.goto(launch, { waitUntil: 'commit' })
  await page.locator('html[data-launch="ready"]').waitFor({ state: 'attached' })
  expect(await page.evaluate(() => Reflect.get(globalThis.window, 'panelLoaded') === true)).toBe(
    true,
  )
  const root = new URL(launch)
  root.hash = ''
  expect(page.url()).toBe(root.href)
}

describe('companion browser security', { timeout: REAL_BROWSER_CASE_TIMEOUT_MS }, () => {
  // Only the server's credential clock is controlled. Browser navigation and
  // socket deadlines stay real, while runner load cannot expire a valid bearer.
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(SESSION_CLOCK_MS)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  afterAll(async () => {
    // Contexts first: a renderer still holding a socket kept browser.close()
    // waiting past the hook deadline on hosted macOS. Close stays bounded;
    // Playwright also kills the launched browser when this worker exits.
    await Promise.allSettled(browser.contexts().map((context) => context.close()))
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      browser.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BROWSER_CLOSE_GRACE_MS)
      }),
    ])
    clearTimeout(timer)
  })
  it('renders hostile translated recovery text without creating markup or executing it', async () => {
    const copy = '</script><img src=x onerror="globalThis.companionXss=true"> & recuperación'
    setUiText({ ...EN, companionLaunchFailed: copy }, 'es')
    const context = await browser.newContext()
    try {
      const panel = await tracked()
      const page = await context.newPage()
      await page.goto(panel.url)
      const alert = page.getByRole('alert')
      await alert.waitFor({ state: 'visible' })
      expect(await alert.textContent()).toBe(copy)
      expect(await page.title()).toBe(copy)
      expect(await page.locator('img').count()).toBe(0)
      expect(await page.evaluate(() => Reflect.get(globalThis, 'companionXss') !== undefined)).toBe(
        false,
      )
      expect(await page.locator('html').getAttribute('lang')).toBe('es')
    } finally {
      await context.close()
      setUiText(EN, 'en')
    }
  })
  it('exchanges the fragment without leaking it, then refuses a foreign form, fetch, EventSource and WebSocket', async () => {
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
    let context: BrowserContext | undefined
    try {
      context = await browser.newContext()
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
      const [captured, nativeResult] = await Promise.all([
        page.waitForRequest(
          (request) => request.url() === `${panel.url}events` && request.method() === 'GET',
        ),
        page.evaluate(
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
        ),
      ])
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
      const [refusedForm] = await Promise.all([
        attack.waitForResponse((response) => response.url() === `${panel.url}post`),
        attack.evaluate((url) => {
          const frame = document.createElement('iframe')
          frame.name = 'attack'
          document.body.append(frame)
          const form = document.createElement('form')
          form.action = `${url}post`
          form.method = 'POST'
          form.target = 'attack'
          document.body.append(form)
          form.submit()
        }, panel.url),
      ])
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
      await context?.close()
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
    const first = await tracked()
    const second = await tracked()
    const context = await browser.newContext()
    try {
      for (const panel of [first, second]) {
        const page = await context.newPage()
        await openPage(page, panel.launchUrl())
      }
      for (const [index, page] of context.pages().entries()) {
        const [captured, status] = await Promise.all([
          page.waitForRequest((value) => value.url().endsWith('/post')),
          page.evaluate(postFromPage, false),
        ])
        expect(status).toBe(202)
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
        if (failure === 'expired') vi.mocked(Date.now).mockReturnValue(SESSION_CLOCK_MS + 2)
        await page.goto(launch, { waitUntil: 'commit' })
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
