// R51 (M81 A1, design spec v4 §8, lead ruling v4-m1): why the owned proxy is
// on the browser's command line as well as on the private context. The
// harness (helpers/liveBrowser.ts) runs the production version and
// command-line checks, then enters at private-context setup. It launches
// the pinned runtime with the production command line, less its proxy
// switch in one run, and puts the private context on the owned proxy.
//
// A page on loopback fetches a counter on this machine's own address every
// 150 ms (the proxy refuses that host, so any connection the counter sees
// came direct), and a loopback heartbeat. The harness kills the browser's
// own network service mid-page.
// - Without the command-line proxy, the recreated service drops the
//   context's proxy. The heartbeat comes direct, the counter is reached
//   direct, and the route assertion fails.
// - With the production construction (both), every request after the same
//   restart stays on the proxy.
//
// Both runs use Rf (the production resolver rule plus the counter's
// address). With R0 alone the rule maps the numeric counter to NOTFOUND and
// masks the direct connection. No Fetch gate and no probe canary runs here,
// so neither can mask the counter. Skipped without an installed runtime,
// saying why in its name. No model is called.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startCheckProxy } from '../../src/core/browser/checkProxy'
import {
  LIVE_TIMEOUT_MS,
  LiveServers,
  OWN_ADDRESS,
  launchLive,
  liveSkipReason,
  liveSuiteName,
  restartNetworkService,
  waitUntil,
  withResolverExclusions,
  withoutProxySwitch,
} from './helpers/liveBrowser'

const FETCH_EVERY_MS = 150
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
const servers = new LiveServers()

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

/** One launch: the production command line, or that line less its proxy switch; Rf in both. */
async function runRoute(isProxyOnCommandLine: boolean): Promise<RouteCounts> {
  Object.assign(counts, NO_COUNTS)
  live.isAfterKill = false
  const proxy = await startCheckProxy({ url: live.pageUrl, explicitHosts: [], approvalKey: 'r51' })
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
  const browser = await launchLive({
    proxyEndpoint: proxy.endpoint,
    admit: (production) => {
      const calibrated = withResolverExclusions(production, [OWN_ADDRESS ?? ''])
      return isProxyOnCommandLine ? calibrated : withoutProxySwitch(calibrated)
    },
    // The resolver rule changed, and the proxy switch gone in the context-only run.
    changes: isProxyOnCommandLine ? 1 : 2,
  })
  try {
    await browser.openPage(live.pageUrl, proxy.endpoint)
    await waitUntil(
      'the page on the proxy',
      () => counts.proxiedBefore >= PROXIED_BEFORE_KILL,
      counts,
    )
    await restartNetworkService(browser.folder.root, () => {
      live.isAfterKill = true
    })
    await waitUntil(
      'requests after the restart',
      () => counts.proxiedAfter + counts.directAfter >= SEEN_AFTER_KILL,
      counts,
    )
    return { ...counts }
  } finally {
    stopObserving()
    await browser.close()
    await proxy.close()
  }
}

describe.skipIf(liveSkipReason() !== undefined)(
  liveSuiteName('R51: the route after a network-service restart'),
  () => {
    beforeAll(async () => {
      const port = await servers.listen(createServer(servePage), '127.0.0.1')
      live.pageUrl = `http://127.0.0.1:${String(port)}/page`
      // Counts every connection that reaches it: the proxy never forwards here.
      const counterPort = await servers.counter(OWN_ADDRESS ?? '', () => {
        if (live.isAfterKill) {
          counts.directAfter += 1
        } else {
          counts.directBefore += 1
        }
      })
      live.counter = `${OWN_ADDRESS ?? ''}:${String(counterPort)}`
    })

    afterAll(async () => {
      await servers.closeAll()
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
  },
)
