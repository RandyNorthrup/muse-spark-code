// @vitest-environment jsdom
// M114 C: the launch handshake over the real companion server.
//
// Starts the real server, opens its real launch URL in an isolated document
// that executes the served bootstrap against the real transport, and proves
// the installed page runs under the launch document's nonce with packaged
// fonts fetched through the authenticated bootstrap. Fails when the
// installed page keeps the session render's theme nonce (the theme consumer
// would name a nonce the launch document's policy refuses) or when a
// packaged font leaves the bootstrap unauthenticated.
//
// The injected fetch is the platform's own with the one header a browser
// adds to every request on its own (Origin): the isolated document
// performs no request on its own, and the platform fetch sends none.
// Every byte is served by the real server.
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { renderCompanionPage } from '../../src/runtime/companion/page'
import { startCompanionServer } from '../../src/runtime/companion/server'
import {
  USAGE_COMPANION_EVENT_BYTES,
  USAGE_COMPANION_IDLE_MS,
  USAGE_COMPANION_MAX_WINDOWS,
  USAGE_COMPANION_REQUEST_MS,
  USAGE_RECORD_MAX_BYTES,
  USAGE_STALE_MS,
} from '../../src/shared/constants'

const FONT_CSS =
  '@font-face{font-family:"Muse UI";src:url("inter.woff2") format("woff2");font-style:normal;font-weight:400 700;font-display:swap;}'

function browserFetchFor(origin) {
  return (input, init) => {
    // A browser resolves relative URLs against the document and sends
    // Origin; the platform fetch needs both spelled out.
    if (input instanceof Request) {
      const headers = new Headers(input.headers)
      headers.set('Origin', origin)
      return fetch(input, { headers })
    }
    const headers = new Headers(init?.headers ?? {})
    headers.set('Origin', origin)
    return fetch(new URL(String(input), `${origin}/`), { ...init, headers })
  }
}

async function startServer(seen) {
  return await startCompanionServer({
    limits: {
      maxBodyBytes: USAGE_RECORD_MAX_BYTES,
      maxEventBytes: USAGE_COMPANION_EVENT_BYTES,
      requestTimeoutMs: USAGE_COMPANION_REQUEST_MS,
      idleTimeoutMs: USAGE_COMPANION_IDLE_MS,
      launchCodeTtlMs: USAGE_STALE_MS,
      sessionTtlMs: USAGE_COMPANION_IDLE_MS,
      maxSessions: USAGE_COMPANION_MAX_WINDOWS,
    },
    assets: new Map([
      ['/app.js', { content: 'export {}', contentType: 'text/javascript' }],
      ['/app.css', { content: '/* app */', contentType: 'text/css' }],
      ['/fonts/fonts.css', { content: FONT_CSS, contentType: 'text/css' }],
      ['/fonts/inter.woff2', { content: 'wOF2-test-bytes', contentType: 'font/woff2' }],
    ]),
    renderPage: (nonce) => {
      seen.nonces.push(nonce)
      return renderCompanionPage(nonce, {
        locale: 'en',
        title: 'Usage & cost',
        stylesheets: ['/app.css', '/fonts/fonts.css'],
        modules: ['/app.js'],
        imports: {},
        uiTable: { locale: 'en', table: {} },
        usageTable: { type: 'usage/table' },
      })
    },
    handler: {
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({}),
      post: async (message) => {
        seen.posts.push(message)
      },
      subscribe: (sessionId) => {
        seen.subscriptions.push(sessionId)
        return () => {
          seen.unsubscribed.push(sessionId)
        }
      },
    },
  })
}

async function runLaunch(server) {
  const launchUrl = server.launchUrl()
  const origin = new URL(launchUrl).origin
  const launchResponse = await fetch(`${origin}/`, { headers: { Origin: origin } })
  const launchHtml = await launchResponse.text()
  const launchNonce = new JSDOM(launchHtml).window.document
    .querySelector('script[nonce]')
    ?.getAttribute('nonce')
  if ([null, undefined, ''].includes(launchNonce)) throw new Error('launch page carries no nonce')
  const injectedFetch = browserFetchFor(origin)
  const dom = new JSDOM(launchHtml, {
    url: launchUrl,
    runScripts: 'dangerously',
    beforeParse(window) {
      const injections = {
        fetch: injectedFetch,
        Request,
        Headers,
        Blob,
        URL,
      }
      for (const [key, value] of Object.entries(injections))
        Object.defineProperty(window, key, { value, configurable: true, writable: true })
    },
  })
  try {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (dom.window.document.documentElement.dataset.launch !== undefined) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return { document: dom.window.document, launchNonce, origin }
  } finally {
    dom.window.close()
  }
}

describe('companion launch handshake', () => {
  it('installs the session page under the launch document nonce', async () => {
    const seen = { nonces: [], posts: [], subscriptions: [], unsubscribed: [] }
    const server = await startServer(seen)
    try {
      const { document, launchNonce } = await runLaunch(server)
      expect(document.documentElement.dataset.launch).toBe('ready')
      // The server rendered the session with its own fresh nonce; the
      // installed page must not keep it.
      expect(seen.nonces).toHaveLength(1)
      expect(seen.nonces[0]).not.toBe(launchNonce)
      expect(document.querySelector('#root')?.dataset.themeNonce).toBe(launchNonce)
      for (const script of document.querySelectorAll('script[nonce]'))
        expect(script.getAttribute('nonce')).toBe(launchNonce)
      // The handshake uses the session exchange and asset routes only.
      expect(seen.posts).toEqual([])
      expect(seen.subscriptions).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('serves packaged fonts through the authenticated bootstrap', async () => {
    const seen = { nonces: [], posts: [], subscriptions: [], unsubscribed: [] }
    const server = await startServer(seen)
    try {
      const { document, origin } = await runLaunch(server)
      expect(document.documentElement.dataset.launch).toBe('ready')
      const installed = [...document.querySelectorAll('style')]
        .map((element) => element.textContent ?? '')
        .join('\n')
      // The sheet reached the page with its font reference rewritten to a
      // page-owned object URL instead of a bare native load.
      expect(installed).toContain('blob:')
      expect(installed).not.toContain('inter.woff2')
      // The font route answers only with the session bearer, so the
      // installed object URL proves the bootstrap fetched it authenticated.
      const bare = await fetch(`${origin}/fonts/inter.woff2`, {
        headers: { Origin: origin },
      })
      expect(bare.status).toBe(401)
    } finally {
      await server.close()
    }
  })
})
