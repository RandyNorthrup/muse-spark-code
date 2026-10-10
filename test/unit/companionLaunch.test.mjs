// M114 C-M114-1 R2: the real launch handshake without a browser.
//
// Executes the served launchPage bootstrap in an isolated document against a
// mocked transport: the initial nonce, the /session render nonce, the asset
// fetches and the font bytes all behave as the companion server's. Fails when
// the installed page keeps the session render's theme nonce (finding 1: the
// theme consumer then names a nonce the launch document's policy refuses) or
// when a packaged font leaves the bootstrap unauthenticated (finding 2).
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { launchPage, renderCompanionPage } from '../../src/runtime/companion/page'
import { IDE_MCP_TOKEN_BYTES } from '../../src/shared/constants'

const LAUNCH_NONCE = 'c'.repeat(64)
const SESSION_NONCE = 'd'.repeat(64)
const BEARER = `Bearer ${'e'.repeat(IDE_MCP_TOKEN_BYTES * 2)}`
const ORIGIN = 'http://localhost:3000'

function sessionHtml() {
  return renderCompanionPage(SESSION_NONCE, {
    locale: 'en',
    title: 'Usage & cost',
    stylesheets: ['/app.css', '/fonts/fonts.css'],
    modules: ['/app.js'],
    imports: {},
    uiTable: { locale: 'en', table: {} },
    usageTable: { type: 'usage/table' },
  })
}

function cssResponse(text) {
  return new globalThis.Response(text, { headers: { 'Content-Type': 'text/css' } })
}

async function runLaunch(html, files) {
  const seen = []
  const serve = async (input, init) => {
    // Undici needs an absolute URL where the browser resolves against the
    // document; resolve here so the mock serves the same routes.
    const request = new globalThis.Request(
      input instanceof globalThis.Request ? input : new URL(String(input), `${ORIGIN}/`),
      init,
    )
    const url = new URL(request.url)
    if (url.pathname === '/session' && request.method === 'POST') {
      return new globalThis.Response(html, {
        headers: { Authorization: BEARER, 'Content-Type': 'text/html' },
      })
    }
    seen.push({
      url: url.href,
      authorization: request.headers.get('Authorization'),
    })
    const file = files.get(url.pathname)
    return file === undefined ? new globalThis.Response('missing', { status: 404 }) : file
  }
  // A fresh document per run: the bootstrap replaces its document through
  // document.write, which a shared document does not survive twice.
  const injections = Object.entries({
    fetch: serve,
    Request: globalThis.Request,
    Headers: globalThis.Headers,
    Response: globalThis.Response,
    Blob: globalThis.Blob,
  })
  const dom = new JSDOM(launchPage(LAUNCH_NONCE), {
    url: `${ORIGIN}/#k=0123456789abcdef`,
    runScripts: 'dangerously',
    beforeParse(window) {
      for (const [key, value] of injections)
        Object.defineProperty(window, key, { value, configurable: true, writable: true })
      Object.defineProperty(window.URL, 'createObjectURL', {
        value: (blob) => `blob:${ORIGIN}/${String(blob.size)}`,
        configurable: true,
        writable: true,
      })
    },
  })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (dom.window.document.documentElement.dataset.launch !== undefined) break
    await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
  }
  const { document } = dom.window
  expect(document.documentElement.dataset.launch).toBe('ready')
  return { seen, document }
}

describe('companion launch handshake', () => {
  it('installs the session page under the launch document nonce', async () => {
    const { seen, document } = await runLaunch(
      sessionHtml(),
      new Map([
        ['/app.css', cssResponse('/* app */')],
        ['/fonts/fonts.css', cssResponse('/* fonts */')],
        [
          '/app.js',
          new globalThis.Response('export {}', { headers: { 'Content-Type': 'text/javascript' } }),
        ],
      ]),
    )
    expect(document.querySelector('#root')?.dataset.themeNonce).toBe(LAUNCH_NONCE)
    expect(document.querySelector('#root')?.dataset.themeNonce).not.toBe(SESSION_NONCE)
    for (const script of document.querySelectorAll('script[nonce]'))
      expect(script.getAttribute('nonce')).toBe(LAUNCH_NONCE)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('serves packaged fonts through the authenticated bootstrap', async () => {
    const { seen, document } = await runLaunch(
      sessionHtml(),
      new Map([
        ['/app.css', cssResponse('/* app */')],
        [
          '/fonts/fonts.css',
          cssResponse(
            '@font-face{font-family:"Muse UI";src:url("inter.woff2") format("woff2");font-style:normal;font-weight:400 700;font-display:swap;}',
          ),
        ],
        [
          '/app.js',
          new globalThis.Response('export {}', { headers: { 'Content-Type': 'text/javascript' } }),
        ],
        [
          '/fonts/inter.woff2',
          new globalThis.Response('wOF2', { headers: { 'Content-Type': 'font/woff2' } }),
        ],
      ]),
    )
    const font = seen.find((request) => request.url.endsWith('/fonts/inter.woff2'))
    expect(font?.authorization).toBe(BEARER)
    const styles = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '')
    expect(styles.some((text) => text.includes('blob:'))).toBe(true)
    expect(styles.some((text) => text.includes('url("inter.woff2")'))).toBe(false)
    expect(styles.some((text) => text.includes('/inter.woff2'))).toBe(false)
  })
})
