// R51 (M81 A1, design spec v4 §8, lead ruling v4-m1): why the owned proxy is
// on the browser's command line as well as on the private context. A
// test-only harness enters at private-context setup, after the production
// version and command-line checks. It launches the pinned runtime with the
// production command line, less its proxy switch in one run (the only
// change admitted), and puts the private context on the owned proxy.
//
// A page on loopback fetches a counter on this machine's own address every
// 150 ms. The proxy refuses that host, so any connection the counter sees
// came direct. The harness kills the browser's own network service
// mid-page.
// - Without the command-line proxy, the recreated service routes the page
//   direct, and the route assertion fails.
// - With the production construction (both), every request after the same
//   restart stays on the proxy.
//
// No Fetch gate, no resolver exception and no probe canary runs here, so
// none of them can mask the counter. Runs where MUSE_TEST_BROWSER_STORAGE
// names a storage folder holding the installed runtime (the rigs and the
// browser-check workflow); skipped elsewhere, saying why in its name. No
// model is called.
import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  browserEnvironment,
  browserLaunchArgs,
  commandLineVerdict,
} from '../../src/core/browser/browserLaunch'
import { CdpConnection } from '../../src/core/browser/cdpPipe'
import { startCheckProxy } from '../../src/core/browser/checkProxy'
import { createLifetime } from '../../src/core/browser/workLifetime'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import manifest from '../../src/host/browser/runtime/browserRuntime.json'
import { prepareRuntime } from '../../src/host/browser/runtime/runtimeStore'
import {
  BROWSER_HOST_RESOLVER_RULES,
  BROWSER_PRODUCT_PREFIX,
  BROWSER_PROXY_BYPASS,
  BROWSER_PROXY_SERVER_FLAG,
} from '../../src/shared/browserCheckConstants'

const BROWSER_RESOLVER_FLAG = '--host-resolver-rules='
import { childrenNaming, processesNaming } from './helpers/browserProcesses'

const STORAGE = process.env['MUSE_TEST_BROWSER_STORAGE']
// This machine's own address on its network: the proxy never forwards there.
const OWN_ADDRESS = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
function skippedBecause(): string | undefined {
  if (STORAGE === undefined) {
    return 'MUSE_TEST_BROWSER_STORAGE names no installed runtime here'
  }
  return OWN_ADDRESS === undefined ? 'this machine has no non-loopback IPv4 address' : undefined
}
const SKIPPED_BECAUSE = skippedBecause()
const SUITE =
  SKIPPED_BECAUSE === undefined
    ? 'R51: the route after a network-service restart'
    : `R51: the route after a network-service restart (skipped: ${SKIPPED_BECAUSE})`
const NETWORK_SERVICE = '--utility-sub-type=network.mojom.NetworkService'
const LIVE_TIMEOUT_MS = 120_000
const PREPARATION_MS = 60_000
const CLEANUP_MS = 10_000
const FETCH_EVERY_MS = 150
const WAIT_MS = 20_000
const POLL_MS = 100
const PROXIED_BEFORE_KILL = 4
const SEEN_AFTER_KILL = 6

/**
 * Where the private context's requests to the counter went, before and after
 * the kill; and the page's loopback heartbeat after it, through the proxy
 * (its `Connection: close` reserialization) or not.
 */
interface RouteCounts {
  proxiedBefore: number
  directBefore: number
  proxiedAfter: number
  directAfter: number
  heartbeatsViaProxyAfter: number
  heartbeatsDirectAfter: number
}

const NO_COUNTS: RouteCounts = {
  proxiedBefore: 0,
  directBefore: 0,
  proxiedAfter: 0,
  directAfter: 0,
  heartbeatsViaProxyAfter: 0,
  heartbeatsDirectAfter: 0,
}
const live = { pageUrl: '', counter: '', isAfterKill: false }
const counts: RouteCounts = { ...NO_COUNTS }
const sockets = new Set<Socket>()
const servers: Server[] = []

function track(server: Server): void {
  servers.push(server)
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
}

async function listen(server: Server, host: string): Promise<string> {
  track(server)
  await new Promise<void>((resolve) => {
    server.listen(0, host, resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no address')
  }
  return String(address.port)
}

function servePage(request: IncomingMessage, response: ServerResponse): void {
  if (request.url === '/beat') {
    if (live.isAfterKill) {
      if ((request.headers.connection ?? '').toLowerCase() === 'close') {
        counts.heartbeatsViaProxyAfter += 1
      } else {
        counts.heartbeatsDirectAfter += 1
      }
    }
    response.writeHead(204).end()
    return
  }
  if (request.url !== '/page') {
    response.writeHead(404).end()
    return
  }
  response
    .writeHead(200, { 'content-type': 'text/html' })
    .end(
      `<!doctype html><title>r51</title><script>setInterval(() => { fetch('http://${live.counter}/n', { mode: 'no-cors' }).catch(() => {}); fetch('/beat').catch(() => {}) }, ${String(FETCH_EVERY_MS)})</script>`,
    )
}

/** The route assertion: nothing reached the counter except through the proxy (which refuses it). */
function isRouteHeld(seen: RouteCounts): boolean {
  return seen.directBefore + seen.directAfter === 0
}

async function waitUntil(stage: string, isDone: () => boolean | Promise<boolean>): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await isDone(), `${stage}: ${JSON.stringify(counts)}`).toBe(true)
    },
    { timeout: WAIT_MS, interval: POLL_MS },
  )
}

/**
 * The check's own network service: a child, with the service type, of a
 * process naming the check's profile folder (the browser). Chrome does not
 * hand the folder to that helper on every OS.
 */
async function networkService(root: string): Promise<number | undefined> {
  const owned = await childrenNaming(await processesNaming(root), NETWORK_SERVICE)
  return owned.length === 1 ? owned[0] : undefined
}

/** One launch: the production command line, or that line less its proxy switch. */
async function runRoute(isProxyOnCommandLine: boolean): Promise<RouteCounts> {
  Object.assign(counts, NO_COUNTS)
  live.isAfterKill = false
  const storage = STORAGE ?? ''
  const deps = hostBrowserRunDeps({
    platform: process.platform,
    env: process.env,
    warn: () => undefined,
  })
  const lifetime = createLifetime(PREPARATION_MS, [], CLEANUP_MS)
  const prepared = await prepareRuntime(
    {
      storageDir: storage,
      lifetime,
      admissionStillValid: () => true,
      consent: () => Promise.resolve('decline'),
    },
    {
      platform: process.platform,
      arch: process.arch,
      now: () => Date.now(),
      fetch: () => Promise.reject(new Error('R51 downloads nothing')),
      manifest,
    },
  )
  lifetime.end()
  if (!prepared.ok) {
    throw new Error(`no verified runtime: ${prepared.reason}`)
  }
  const folder = await deps.createFolder(storage)
  const proxy = await startCheckProxy({
    url: live.pageUrl,
    explicitHosts: [],
    approvalKey: 'r51',
  })
  const stopObserving = proxy.observe((record) => {
    if (record.host !== OWN_ADDRESS) {
      return
    }
    if (live.isAfterKill) {
      counts.proxiedAfter += 1
    } else {
      counts.proxiedBefore += 1
    }
  })
  const production = browserLaunchArgs(proxy.endpoint, folder.profile)
  // Rf (spec §7): the production resolver rule plus the counter's own
  // address, in both runs, so the rule cannot mask a direct connection.
  const resolverRule = `${BROWSER_RESOLVER_FLAG}${BROWSER_HOST_RESOLVER_RULES}`
  const calibrated = production.map((arg) =>
    arg === resolverRule ? `${resolverRule}, EXCLUDE ${OWN_ADDRESS ?? ''}` : arg,
  )
  expect(calibrated.filter((arg, index) => arg !== production[index])).toHaveLength(1)
  // The other change admitted: the proxy switch, and only in the context-only run.
  const args = isProxyOnCommandLine
    ? calibrated
    : calibrated.filter((arg) => !arg.startsWith(BROWSER_PROXY_SERVER_FLAG))
  expect(production.length - args.length).toBe(isProxyOnCommandLine ? 0 : 1)
  const browser = deps.spawn(
    prepared.runtime.executable,
    args,
    browserEnvironment(process.platform, process.env, folder),
  )
  const cdp = new CdpConnection(browser.writer, browser.reader)
  try {
    // The production checks first: the pinned product, the command line as launched.
    const version = (await cdp.send('Browser.getVersion')) as { product: string }
    expect(version.product).toBe(`${BROWSER_PRODUCT_PREFIX}${prepared.runtime.version}`)
    const commandLine = (await cdp.send('Browser.getBrowserCommandLine')) as {
      arguments: string[]
    }
    expect(commandLineVerdict(commandLine.arguments, args).kind).toBe('ok')
    // Enter at private-context setup: the context on the owned proxy, as in production.
    const { browserContextId } = (await cdp.send('Target.createBrowserContext', {
      proxyServer: proxy.endpoint,
      proxyBypassList: BROWSER_PROXY_BYPASS,
      disposeOnDetach: true,
    })) as { browserContextId: string }
    await cdp.send('Target.createTarget', { url: live.pageUrl, browserContextId })
    await waitUntil('the page on the proxy', () => counts.proxiedBefore >= PROXIED_BEFORE_KILL)
    const service = await networkService(folder.root)
    expect(service).toBeDefined()
    live.isAfterKill = true
    process.kill(service ?? 0, 'SIGKILL')
    await waitUntil('a new network service', async () => {
      const next = await networkService(folder.root)
      return next !== undefined && next !== service
    })
    await waitUntil(
      'requests after the restart',
      () => counts.proxiedAfter + counts.directAfter >= SEEN_AFTER_KILL,
    )
    return { ...counts }
  } finally {
    stopObserving()
    cdp.close(new Error('R51 ended'))
    await browser.kill()
    await proxy.close()
    await deps.removeFolder(folder)
    await waitUntil('no process left', async () => {
      const left = await processesNaming(folder.root)
      return left.length === 0
    })
    expect(existsSync(folder.root)).toBe(false)
  }
}

describe.skipIf(SKIPPED_BECAUSE !== undefined)(SUITE, () => {
  beforeAll(async () => {
    const page = createServer(servePage)
    live.pageUrl = `http://127.0.0.1:${await listen(page, '127.0.0.1')}/page`
    // Counts every connection that reaches it: the proxy never forwards here.
    const counter = createTcpServer((socket) => {
      if (live.isAfterKill) {
        counts.directAfter += 1
      } else {
        counts.directBefore += 1
      }
      socket.end('HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n')
    })
    live.counter = `${OWN_ADDRESS ?? ''}:${await listen(counter, OWN_ADDRESS ?? '')}`
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
    'without the command-line proxy, a recreated network service sends the page direct',
    async () => {
      const seen = await runRoute(false)
      // The initial observation: the private context's requests on the proxy, none direct.
      expect(seen.proxiedBefore).toBeGreaterThanOrEqual(PROXIED_BEFORE_KILL)
      expect(seen.directBefore).toBe(0)
      // The recreated service dropped the context's proxy: the loopback
      // heartbeat comes direct, the counter is reached direct, and the route
      // assertion fails.
      expect(seen.heartbeatsDirectAfter).toBeGreaterThan(0)
      expect(seen.heartbeatsViaProxyAfter).toBe(0)
      expect(seen.directAfter).toBeGreaterThan(0)
      expect(isRouteHeld(seen)).toBe(false)
    },
    LIVE_TIMEOUT_MS,
  )

  it(
    'with the proxy on both, every request after the same restart stays on the proxy',
    async () => {
      const seen = await runRoute(true)
      expect(seen.proxiedBefore).toBeGreaterThanOrEqual(PROXIED_BEFORE_KILL)
      expect(seen.proxiedAfter).toBeGreaterThan(0)
      expect(seen.heartbeatsViaProxyAfter).toBeGreaterThan(0)
      expect(seen.heartbeatsDirectAfter).toBe(0)
      expect(seen.directAfter).toBe(0)
      expect(isRouteHeld(seen)).toBe(true)
    },
    LIVE_TIMEOUT_MS,
  )
})
