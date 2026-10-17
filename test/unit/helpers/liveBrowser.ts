// The live controls' harness (M81 A1, design spec v4 §7 and §8): the pinned
// runtime the store installed and verified, launched by the production
// command line with only the changes a control admits, each one counted.
// The production version and command-line checks run first, so a control
// enters where the production check would, at private-context setup. Used
// by the R51 control and the §7 positive controls; the browser-check
// workflow runs them on each hosted OS. No model is called.
import { existsSync } from 'node:fs'
import { createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { expect, vi } from 'vitest'
import {
  browserEnvironment,
  browserLaunchArgs,
  commandLineVerdict,
} from '../../../src/core/browser/browserLaunch'
import type { CheckFolder } from '../../../src/core/browser/browserRun'
import { CdpConnection } from '../../../src/core/browser/cdpPipe'
import type { VerifiedRuntime } from '../../../src/core/browser/runtimeTypes'
import { createLifetime } from '../../../src/core/browser/workLifetime'
import { hostBrowserRunDeps } from '../../../src/host/browser/browserProcess'
import manifest from '../../../src/host/browser/runtime/browserRuntime.json'
import { prepareRuntime } from '../../../src/host/browser/runtime/runtimeStore'
import {
  BROWSER_HOST_RESOLVER_RULES,
  BROWSER_PRODUCT_PREFIX,
  BROWSER_PROXY_BYPASS,
  BROWSER_PROXY_SERVER_FLAG,
} from '../../../src/shared/browserCheckConstants'
import { childrenNaming, processesNaming } from './browserProcesses'

export const LIVE_STORAGE = process.env['MUSE_TEST_BROWSER_STORAGE']
/** This machine's own address on its network: the owned proxy never forwards there. */
export const OWN_ADDRESS = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
export const LIVE_TIMEOUT_MS = 120_000
const PREPARATION_MS = 60_000
const CLEANUP_MS = 10_000
const WAIT_MS = 20_000
const POLL_MS = 100
const NETWORK_SERVICE = '--utility-sub-type=network.mojom.NetworkService'
const RESOLVER_FLAG = '--host-resolver-rules='
const RESOLVER_SWITCH = `${RESOLVER_FLAG}${BROWSER_HOST_RESOLVER_RULES}`

/** Why a live control cannot run here, or undefined when it can. */
export function liveSkipReason(): string | undefined {
  if (LIVE_STORAGE === undefined) {
    return 'MUSE_TEST_BROWSER_STORAGE names no installed runtime here'
  }
  return OWN_ADDRESS === undefined ? 'this machine has no non-loopback IPv4 address' : undefined
}

/** A suite's name, saying why when it is skipped. */
export function liveSuiteName(name: string): string {
  const reason = liveSkipReason()
  return reason === undefined ? name : `${name} (skipped: ${reason})`
}

/** The servers a suite started, and every connection they accepted, closed at its end. */
export class LiveServers {
  readonly #servers: Server[] = []
  readonly #sockets = new Set<Socket>()

  public async listen(server: Server, host: string): Promise<number> {
    this.#servers.push(server)
    server.on('connection', (socket: Socket) => {
      this.#sockets.add(socket)
      socket.on('close', () => this.#sockets.delete(socket))
    })
    await new Promise<void>((resolve) => {
      server.listen(0, host, resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('no address')
    }
    return address.port
  }

  /** A TCP listener on `host` that counts each connection and answers 204. */
  public async counter(host: string, onConnection: () => void): Promise<number> {
    return await this.listen(
      createTcpServer((socket) => {
        onConnection()
        socket.end('HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n')
      }),
      host,
    )
  }

  public async closeAll(): Promise<void> {
    for (const socket of this.#sockets) {
      socket.destroy()
    }
    await Promise.all(
      this.#servers.map(
        (server) =>
          new Promise((resolve) => {
            server.close(resolve)
          }),
      ),
    )
  }
}

/** Waits for `isDone`, naming the stage and the counts when it never comes. */
export async function waitUntil(
  stage: string,
  isDone: () => boolean | Promise<boolean>,
  state?: unknown,
): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await isDone(), `${stage}: ${JSON.stringify(state ?? {})}`).toBe(true)
    },
    { timeout: WAIT_MS, interval: POLL_MS },
  )
}

/**
 * The check's own network service: a child, with the service type, of a
 * process naming the check's profile folder (the browser). Chrome does not
 * hand the folder to that helper on every OS.
 */
export async function networkService(root: string): Promise<number | undefined> {
  const owned = await childrenNaming(await processesNaming(root), NETWORK_SERVICE)
  return owned.length === 1 ? owned[0] : undefined
}

/**
 * Kills the check's own network service and waits for the browser to start
 * another. `beforeKill` runs once the service is found, just before the kill,
 * so a control counts only what the page sends from then on.
 */
export async function restartNetworkService(root: string, beforeKill: () => void): Promise<void> {
  const service = await networkService(root)
  expect(service).toBeDefined()
  beforeKill()
  process.kill(service ?? 0, 'SIGKILL')
  await waitUntil('a new network service', async () => {
    const next = await networkService(root)
    return next !== undefined && next !== service
  })
}

/** The installed runtime, verified against the pin; this harness downloads nothing. */
async function verifiedRuntime(storage: string): Promise<VerifiedRuntime> {
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
      fetch: () => Promise.reject(new Error('the live controls download nothing')),
      manifest,
    },
  )
  lifetime.end()
  if (!prepared.ok) {
    throw new Error(`no verified runtime: ${prepared.reason}`)
  }
  return prepared.runtime
}

/** Rf (spec §7): the production resolver rule plus exact numeric literals. */
export function withResolverExclusions(
  args: readonly string[],
  addresses: readonly string[],
): readonly string[] {
  const exclusions = addresses.map((address) => `, EXCLUDE ${address}`).join('')
  return args.map((arg) => (arg === RESOLVER_SWITCH ? `${RESOLVER_SWITCH}${exclusions}` : arg))
}

/** The command line without the switches starting with `prefix`. */
export function withoutSwitch(args: readonly string[], prefix: string): readonly string[] {
  return args.filter((arg) => !arg.startsWith(prefix))
}

/** No command-line proxy: N (spec §7). */
export function withoutProxySwitch(args: readonly string[]): readonly string[] {
  return withoutSwitch(args, BROWSER_PROXY_SERVER_FLAG)
}

/** How many switches differ between the production command line and the launched one. */
function changedSwitches(production: readonly string[], launched: readonly string[]): number {
  const removed = production.filter((arg) => !launched.includes(arg)).length
  const added = launched.filter((arg) => !production.includes(arg)).length
  return Math.max(removed, added)
}

export interface LiveLaunch {
  /** The proxy endpoint the production command line names. */
  readonly proxyEndpoint: string
  /** The control's admitted changes to the production command line. */
  readonly admit: (production: readonly string[]) => readonly string[]
  /** How many switches those changes touch, asserted. */
  readonly changes: number
}

export interface LiveBrowser {
  readonly cdp: CdpConnection
  readonly folder: CheckFolder
  /** A page in a fresh private context: on `proxy` (with the loopback subtraction) or on none. */
  openPage(url: string, proxy: string | undefined): Promise<{ sessionId: string }>
  /** Evaluates `expression` in the page's session and returns its value. */
  evaluate(sessionId: string, expression: string): Promise<unknown>
  close(): Promise<void>
}

/** Launches the pinned runtime and runs the production version and command-line checks. */
export async function launchLive(launch: LiveLaunch): Promise<LiveBrowser> {
  const storage = LIVE_STORAGE ?? ''
  const runtime = await verifiedRuntime(storage)
  const deps = hostBrowserRunDeps({
    platform: process.platform,
    env: process.env,
    warn: () => undefined,
  })
  const folder = await deps.createFolder(storage)
  const production = browserLaunchArgs(launch.proxyEndpoint, folder.profile)
  const args = launch.admit(production)
  expect(changedSwitches(production, args)).toBe(launch.changes)
  const browser = deps.spawn(
    runtime.executable,
    args,
    browserEnvironment(process.platform, process.env, folder),
  )
  const cdp = new CdpConnection(browser.writer, browser.reader)
  const close = async (): Promise<void> => {
    cdp.close(new Error('the live control ended'))
    await browser.kill()
    await deps.removeFolder(folder)
    await waitUntil('no process left', async () => {
      const left = await processesNaming(folder.root)
      return left.length === 0
    })
  }
  try {
    const version = (await cdp.send('Browser.getVersion')) as { product: string }
    expect(version.product).toBe(`${BROWSER_PRODUCT_PREFIX}${runtime.version}`)
    const commandLine = (await cdp.send('Browser.getBrowserCommandLine')) as {
      arguments: string[]
    }
    expect(commandLineVerdict(commandLine.arguments, args).kind).toBe('ok')
  } catch (error: unknown) {
    await close()
    throw error
  }
  return {
    cdp,
    folder,
    openPage: async (url, proxy) => {
      const { browserContextId } = (await cdp.send('Target.createBrowserContext', {
        ...(proxy !== undefined && { proxyServer: proxy, proxyBypassList: BROWSER_PROXY_BYPASS }),
        disposeOnDetach: true,
      })) as { browserContextId: string }
      const { targetId } = (await cdp.send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      })) as { targetId: string }
      const { sessionId } = (await cdp.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      })) as { sessionId: string }
      await cdp.send('Page.enable', {}, sessionId)
      await cdp.send('Page.navigate', { url }, sessionId)
      return { sessionId }
    },
    evaluate: async (sessionId, expression) => {
      const answer = (await cdp.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      )) as { result?: { value?: unknown }; exceptionDetails?: unknown }
      if (answer.exceptionDetails !== undefined) {
        throw new Error(`the page threw: ${JSON.stringify(answer.exceptionDetails)}`)
      }
      return answer.result?.value
    },
    close: async () => {
      await close()
      expect(existsSync(folder.root)).toBe(false)
    },
  }
}
