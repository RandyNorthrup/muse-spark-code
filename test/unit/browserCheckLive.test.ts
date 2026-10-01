// The browser check against the real system Chrome or Edge (M81, PLAN.md
// D49): the fixture page on 127.0.0.1 with its console error and failed
// request, the pipe and no TCP listener, the temporary profile removed, no
// browser process left after a deadline or a stop, and every way out beyond
// loopback blocked: a server on this machine's own network address counts
// every connection a page tries (and the widened check shows it can count).
// Runs where a browser is found (or MUSE_TEST_BROWSER names one, as the Mac
// mini rig's chrome-headless-shell); elsewhere the suite is skipped, and
// says why in its name.
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { hostname, networkInterfaces, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { findBrowserExecutable } from '../../src/core/browser/browserLaunch'
import {
  type BrowserCheckRequest,
  type BrowserCheckResult,
  type BrowserRunDeps,
  runBrowserCheck,
} from '../../src/core/browser/browserRun'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import { processesNaming, tcpListenersOf } from './helpers/browserProcesses'

const EXECUTABLE =
  process.env['MUSE_TEST_BROWSER'] ??
  findBrowserExecutable({
    platform: process.platform,
    pathVariable: process.env['PATH'],
    variable: (name) => process.env[name],
    fileExists: existsSync,
  })
const SUITE =
  EXECUTABLE === undefined
    ? 'the browser check in a real browser (skipped: no system Chrome or Edge here; MUSE_TEST_BROWSER names one)'
    : `the browser check in a real browser (${path.basename(EXECUTABLE)})`
// This machine's own address on its network: a page must never reach it.
const OUTSIDE_ADDRESS = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
const FIXTURE = readFileSync(new URL('../fixtures/browser-check.html', import.meta.url), 'utf8')
const LIVE_TIMEOUT_MS = 90_000
const SLOW_MS = 6000
const GONE_WAIT_MS = 10_000
const DEADLINE_MS = 3000
const STOP_AFTER_MS = 2000

/** Where the servers listen once started, and what the outside one has counted. */
const live = { page: '', pagePort: '', outside: '', outsidePort: '', outsideConnections: 0 }
const sockets = new Set<Socket>()
const servers: Server[] = []

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/html' }).end(body)
}

function script(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'content-type': 'text/javascript' }).end(body)
}

/** A URL by name for the outside server: a name is blocked whatever it resolves to. */
function byName(): string {
  return new URL(`http://${hostname()}:${live.outsidePort}/byname`).href
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
fetch('${byName()}').catch(() => {})
fetch('http://169.254.169.254/latest/meta-data/').catch(() => {})
try { new WebSocket('ws://${outside}/ws') } catch {}
new Worker('/worker.js')
navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(() => {})
</script>`
}

function serve(request: IncomingMessage, response: ServerResponse): void {
  const outside = live.outside
  switch (request.url) {
    case '/': {
      html(response, FIXTURE)
      return
    }
    case '/favicon.ico': {
      // The browser asks for it by itself; only the fixture's own request fails.
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
      // Never answers: the check must end at its deadline or its stop.
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
      script(response, `fetch('http://${outside}/fromworker').catch(() => {})`)
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
      // An image: the page's load, and so the check, waits for its request.
      html(response, `<img src="http://${outside}/widened.png">`)
      return
    }
    default: {
      response.writeHead(404).end()
    }
  }
}

/** The server listening on `host`; its port. */
async function listen(server: Server, host: string): Promise<string> {
  servers.push(server)
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, host, resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no address')
  }
  return String(address.port)
}

interface Watched {
  /** Read the browser's processes and listeners while it runs (the pipe test only). */
  readonly isProbed?: boolean
  profile?: string
  isProfileEmpty?: boolean
  args?: readonly string[]
  /** The browser's processes and their TCP listeners, read while it ran. */
  probe?: Promise<{ readonly pids: readonly number[]; readonly listeners: readonly string[] }>
}

/** The browser's processes and listeners, read while it still runs. */
async function probeBrowser(profile: string) {
  let pids: number[] = []
  await vi.waitFor(
    async () => {
      pids = await processesNaming(profile)
      expect(pids.length).toBeGreaterThan(0)
    },
    { timeout: GONE_WAIT_MS, interval: 200 },
  )
  const listeners = await tcpListenersOf(pids)
  // Still running when its listeners were read, or the reading proves nothing.
  const stillRunning = await processesNaming(profile)
  expect(stillRunning.length).toBeGreaterThan(0)
  return { pids, listeners }
}

/** The real browser, folders and processes, watched. */
function liveDeps(watched: Watched, checkMs = LIVE_TIMEOUT_MS): BrowserRunDeps {
  const base = hostBrowserRunDeps({
    platform: process.platform,
    env: process.env,
    warn: () => undefined,
  })
  return {
    ...base,
    findExecutable: () => EXECUTABLE,
    createProfile: async () => {
      const directory = await base.createProfile()
      watched.profile = directory
      const entries = await readdir(directory)
      watched.isProfileEmpty = entries.length === 0
      return directory
    },
    spawn: (executable, args) => {
      watched.args = args
      const browser = base.spawn(executable, args)
      if (watched.isProbed === true) {
        watched.probe = probeBrowser(watched.profile ?? '')
      }
      return browser
    },
    timings: { checkMs },
  }
}

function request(url: string, overrides: Partial<BrowserCheckRequest> = {}): BrowserCheckRequest {
  return {
    url,
    actions: [],
    allowedHosts: [],
    includeScreenshot: true,
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** No process naming the profile, and no profile folder, once the check returned. */
async function expectGone(watched: Watched): Promise<void> {
  const profile = watched.profile ?? ''
  expect(profile).not.toBe('')
  await vi.waitFor(
    async () => {
      expect(await processesNaming(profile)).toEqual([])
    },
    { timeout: GONE_WAIT_MS, interval: 250 },
  )
  expect(existsSync(profile)).toBe(false)
}

function report(result: BrowserCheckResult) {
  if (!result.ok) {
    throw new Error(`the check failed: ${JSON.stringify(result.failure)}`)
  }
  return result.report
}

describe.skipIf(EXECUTABLE === undefined)(SUITE, () => {
  beforeAll(async () => {
    live.pagePort = await listen(createServer(serve), '127.0.0.1')
    live.page = `127.0.0.1:${live.pagePort}`
    if (OUTSIDE_ADDRESS === undefined) {
      return
    }
    const counter = createTcpServer((socket) => {
      live.outsideConnections += 1
      socket.end('HTTP/1.1 200 OK\r\ncontent-length: 6\r\n\r\nsecret')
    })
    live.outsidePort = await listen(counter, OUTSIDE_ADDRESS)
    live.outside = `${OUTSIDE_ADDRESS}:${live.outsidePort}`
  })

  afterAll(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve)
          }),
      ),
    )
  })

  it(
    'reads back the fixture page: its console error, its failed request, the steps and a screenshot',
    async () => {
      const watched: Watched = {}
      const result = await runBrowserCheck(
        liveDeps(watched),
        request(`http://${live.page}/`, {
          actions: [
            { kind: 'type', selector: '#name', text: 'Ada' },
            { kind: 'click', selector: '#go' },
          ],
        }),
      )
      const found = report(result)
      expect(found.consoleErrors.shown).toEqual(
        expect.arrayContaining(['fixture console error 7', 'clicked with Ada']),
      )
      expect(found.failedRequests.shown).toEqual([`http://${live.page}/missing.json (HTTP 404)`])
      expect(found.blockedRequests.shown).toEqual([])
      expect(found.finalUrl).toBe(`http://${live.page}/`)
      expect(found.screenshot?.width).toBeGreaterThan(0)
      expect(found.screenshot?.height).toBeGreaterThan(0)
      await expectGone(watched)
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'talks over the pipe with no TCP listener, in a fresh temporary profile it removes',
    async () => {
      const watched: Watched = { isProbed: true }
      const result = await runBrowserCheck(
        liveDeps(watched),
        request(`http://${live.page}/escape`, { includeScreenshot: false }),
      )
      expect(result.ok).toBe(true)
      expect(watched.args).toContain('--remote-debugging-pipe')
      expect(watched.args?.filter((arg) => arg.includes('remote-debugging-port'))).toEqual([])
      expect(watched.isProfileEmpty).toBe(true)
      expect(path.dirname(watched.profile ?? '')).toBe(tmpdir())
      expect(path.basename(watched.profile ?? '')).toMatch(/^muse-spark-browser-/)
      const probe = await watched.probe
      expect(probe?.pids.length).toBeGreaterThan(0)
      expect(probe?.listeners).toEqual([])
      await expectGone(watched)
    },
    LIVE_TIMEOUT_MS,
  )

  // The outside server's count can be trusted only if a page can reach it:
  // widened, it is reached.
  it.skipIf(OUTSIDE_ADDRESS === undefined)(
    'reaches a host only once it is widened for the check',
    async () => {
      const before = live.outsideConnections
      const result = await runBrowserCheck(
        liveDeps({}),
        request(`http://${live.page}/widen`, {
          includeScreenshot: false,
          allowedHosts: [OUTSIDE_ADDRESS ?? ''],
        }),
      )
      expect(result.ok).toBe(true)
      expect(live.outsideConnections - before).toBeGreaterThan(0)
    },
    LIVE_TIMEOUT_MS,
  )

  it.skipIf(OUTSIDE_ADDRESS === undefined)(
    'lets nothing reach beyond loopback: subresources, redirects, frames, workers, sockets, names',
    async () => {
      const before = live.outsideConnections
      const result = await runBrowserCheck(
        liveDeps({}),
        request(`http://${live.page}/escape`, { includeScreenshot: false }),
      )
      const found = report(result)
      expect(live.outsideConnections - before).toBe(0)
      const outside = live.outside
      expect(found.blockedRequests.shown).toEqual(
        expect.arrayContaining([
          `http://${outside}/img.png`,
          `http://${outside}/fetch`,
          `http://${outside}/redirected`,
          `http://${outside}/fromframe`,
          `http://${outside}/fromworker`,
          `ws://${outside}/ws`,
          byName(),
          'http://169.254.169.254/latest/meta-data/',
        ]),
      )
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'kills the browser at its deadline and when stopped, leaving no process and no profile',
    async () => {
      const late: Watched = {}
      const timedOut = await runBrowserCheck(
        liveDeps(late, DEADLINE_MS),
        request(`http://${live.page}/hang`),
      )
      expect(timedOut).toEqual({ ok: false, failure: { kind: 'timedOut' } })
      await expectGone(late)

      const stopped: Watched = {}
      const cancelled = await runBrowserCheck(
        liveDeps(stopped),
        request(`http://${live.page}/hang`, { signal: AbortSignal.timeout(STOP_AFTER_MS) }),
      )
      expect(cancelled).toEqual({ ok: false, failure: { kind: 'cancelled' } })
      await expectGone(stopped)
    },
    LIVE_TIMEOUT_MS,
  )
})
