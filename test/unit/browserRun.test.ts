// One browser check (M81 A1, PLAN.md D49; design spec v4 §§4.1, 6) against a
// scripted browser on the other end of the pipe, with a fake proxy and probe
// fixture that record what the canaries' probes would make arrive: the
// framing and its bound; the two lifetimes (preparation, then the check)
// and admission read around them; the verified runtime's identity read
// again before the spawn; the pin's contract (product, command line, first
// target, network service); the gate and the watch; the canary phases and
// the audit; the page's results; the closed failures; nothing sent once the
// check has ended; and the browser, the proxy, the fixture and the folder
// gone whatever ended it. The real browser runs in browserCheckLive.test.ts.
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type * as NodeFsPromises from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { browserLaunchArgs } from '../../src/core/browser/browserLaunch'
import {
  type BrowserCheckRequest,
  type BrowserCheckResult,
  type BrowserHostOptions,
  type BrowserProcess,
  type BrowserRunDeps,
  type CheckFolder,
  runBrowserCheck,
} from '../../src/core/browser/browserRun'
import type { ProbeFixture } from '../../src/core/browser/canaries'
import { CdpConnection } from '../../src/core/browser/cdpPipe'
import type { CheckProxy, ProxyObservation } from '../../src/core/browser/checkProxy'
import { RequestLog } from '../../src/core/browser/requestLog'
import type { RuntimePreparation, VerifiedRuntime } from '../../src/core/browser/runtimeTypes'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import { browserCheckOutcome } from '../../src/core/backends/modelapi/browserCalls'
import {
  BROWSER_CHECK_ENTRY_MAX_CHARS,
  BROWSER_CHECK_MAX_TRACKED_REQUESTS,
  BROWSER_NETWORK_SERVICE_TYPE,
  BROWSER_PROXY_BYPASS,
  MODEL_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { installGerman, restoreEnglish } from './helpers/germanTable'

// Fails the real folder's profile subdirectories once set: the root and
// the owner file already exist, so only its own cleanup removes them.
const folderFault = vi.hoisted(() => ({ failProfileSubdir: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFsPromises>()
  return {
    ...fs,
    mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
      const base = String(args[0]).split(/[\\/]/).at(-1)
      if (base !== undefined && folderFault.failProfileSubdir && ['p', 't', 'h'].includes(base)) {
        throw Object.assign(new Error('EACCES test'), { code: 'EACCES' })
      }
      return await fs.mkdir(...args)
    },
  }
})

// A 1×1 PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PAGE = 'http://localhost:3000/'
const HTTP = 'http:'
const SESSION = 'S1'
const EXECUTABLE = '/storage/browser-runtime/154.0.8037.92/linux64/chrome-headless-shell'
const PROXY_PORT = 47_001
const PROXY = `http://127.0.0.1:${String(PROXY_PORT)}`
const FIXTURE_PORT = 47_002
const OWN = { address: '192.168.7.9', tcpPort: 47_003, udpPort: 47_004 }
const RUNTIME: VerifiedRuntime = {
  version: '154.0.8037.92',
  platform: 'linux64',
  executable: EXECUTABLE,
  manifestDigest: 'm'.repeat(64),
  executableDigest: 'e'.repeat(64),
  executableBytes: 1000,
  executableMtimeMs: 5,
  publishedAtMs: 1_790_706_629_983,
}
const FOLDER: CheckFolder = {
  root: '/storage/bc/0a1b2c3d',
  profile: '/storage/bc/0a1b2c3d/p',
  temp: '/storage/bc/0a1b2c3d/t',
  home: '/storage/bc/0a1b2c3d/h',
}
/** Answer nothing: the call stays pending. */
const HOLD = Symbol('hold')

interface Sent {
  readonly id: number
  readonly method: string
  readonly params: Record<string, unknown>
  readonly sessionId?: string
}

type Handler = (params: Record<string, unknown>, sessionId: string | undefined) => unknown

/** The probe page's input, as the script carries it. */
interface ProbeInput {
  readonly get: readonly string[]
  readonly ws: Readonly<Record<string, string>>
  readonly auth: string | null
  readonly ice: { readonly address: string; readonly port: number } | null
  readonly wt: string | null
}

/** What the fake proxy and fixture record, and the faults a test injects into a phase's probes. */
interface Network {
  readonly observations: ((record: ProxyObservation) => void)[]
  readonly hits: Map<string, string[]>
  readonly challenges: Map<string, number>
  authorizations: number
  tcpConnections: number
  datagrams: number
  own: typeof OWN | undefined
  /** Probes that never arrive (by host), from the phase of this index on (0 default, 1 page, 2 audit). */
  readonly dropped: { phase: number; host: string } | undefined
  /** The probe page's report overrides. */
  readonly report: Partial<{ wt: string; ice: string; candidates: string[]; open: boolean }>
  readonly closed: string[]
  /** Every phase on one fixture port (no real fixture does that): only each phase's own records tell them apart. */
  readonly isPortShared: boolean
  /**
   * The audit's own loopback answers reach the fixture (its hits and
   * challenges are there) but not through the proxy as built: no record of
   * forwarding, or answers whose challenge was not stripped.
   */
  readonly audit: 'unforwarded' | 'unstripped' | undefined
  /** The page phase's records arrive again during the audit, as late answers to its probes would. */
  readonly isPageLate: boolean
}

function network(overrides: Partial<Network> = {}): Network {
  return {
    observations: [],
    hits: new Map(),
    challenges: new Map(),
    authorizations: 0,
    tcpConnections: 0,
    datagrams: 0,
    own: OWN,
    dropped: undefined,
    report: {},
    closed: [],
    isPortShared: false,
    audit: undefined,
    isPageLate: false,
    ...overrides,
  }
}

/** The browser's side of the pipe, scripted call by call. */
function noUnsubscribe(): void {
  // The fake proxy has no listener to take out.
}

/** The gate's answers to paused requests, in order: `continue <id>` or `fail <id>`. */
function gateDecisions(browser: FakeBrowser): string[] {
  const decisions: string[] = []
  browser.on('Fetch.continueRequest', (params) => {
    decisions.push(`continue ${String(params['requestId'])}`)
    return {}
  })
  browser.on('Fetch.failRequest', (params) => {
    decisions.push(`fail ${String(params['requestId'])}`)
    return {}
  })
  return decisions
}

/** A setup step that fails with an OS message the check must never repeat. */
function reject(): Promise<never> {
  return Promise.reject(new Error('EACCES /secret'))
}

function idle(): void {
  // Nothing comes of it.
}

/** A setup step that never answers. */
function pending(): Promise<never> {
  return new Promise<never>(idle)
}

class FakeBrowser implements BrowserProcess {
  private exit: () => void = () => undefined
  private targets = 0
  public phase = -1
  public readonly sent: Sent[] = []
  public readonly handlers = new Map<string, Handler>()
  public kills = 0
  public isGone = false
  public readonly exited: Promise<void>
  /** The spawn's own error code: a test refuses the executable after it returned by resolving one. */
  public spawnError: Promise<string | undefined> = Promise.resolve(undefined)
  /** File descriptor 4 as the parent reads it. */
  public readonly reader = new PassThrough()
  /** The command line it reports: set from what was launched. */
  public commandLine: readonly string[] = []
  public serviceIds = [41, 41]
  public pageSession = ''
  /** What each phase's probes left at the proxy, in order. */
  public readonly phaseRecords: ProxyObservation[][] = []

  public kill: () => Promise<void> = () => {
    this.kills += 1
    this.end()
    return Promise.resolve()
  }

  public readonly writer = {
    write: (chunk: string): boolean => {
      expect(chunk.endsWith('\0')).toBe(true)
      const message = JSON.parse(chunk.slice(0, -1)) as Sent
      this.sent.push(message)
      queueMicrotask(() => {
        this.answer(message)
      })
      return true
    },
  }

  public constructor(
    public readonly net: Network,
    public targetUrl = PAGE,
  ) {
    this.exited = new Promise((resolve) => {
      this.exit = resolve
    })
    this.on('Browser.getVersion', () => ({ product: 'HeadlessChrome/154.0.8037.92' }))
    this.on('Browser.getBrowserCommandLine', () => ({ arguments: this.commandLine }))
    this.on('Target.getTargets', () => ({ targetInfos: [{ type: 'page', url: 'about:blank' }] }))
    this.on('SystemInfo.getProcessInfo', () => ({
      processInfo: [
        { type: 'browser', id: 1 },
        { type: BROWSER_NETWORK_SERVICE_TYPE, id: this.serviceIds.shift() ?? 41 },
      ],
    }))
    this.on('Target.createTarget', () => {
      this.targets += 1
      const targetId = `T${String(this.targets)}`
      const sessionId = `S${String(this.targets)}`
      // The default phase's probe, the page phase's, then the model's page.
      if (this.targets === 3) {
        this.pageSession = sessionId
      }
      this.attach(sessionId, targetId, 'page')
      return { targetId }
    })
    this.on('Target.createBrowserContext', () => ({ browserContextId: 'CTX' }))
    this.on('Storage.getCookies', () => ({ cookies: [] }))
    this.on('Page.getFrameTree', (_params, sessionId) => ({
      frameTree: { frame: { id: `F-${sessionId ?? ''}` } },
    }))
    this.on('Page.navigate', (_params, sessionId) => {
      queueMicrotask(() => {
        this.emit('Page.loadEventFired', {}, sessionId)
      })
      return { frameId: 'F1' }
    })
    this.on('Runtime.evaluate', (params) => this.answerProbe(String(params['expression'])))
    this.on('WebAuthn.addVirtualAuthenticator', () => ({ authenticatorId: 'A1' }))
    this.on('Target.getTargetInfo', () => ({ targetInfo: { url: this.targetUrl } }))
    this.on('Page.captureScreenshot', () => ({ data: PNG_BASE64 }))
    this.on('Browser.close', () => {
      queueMicrotask(() => {
        this.end()
      })
      return {}
    })
  }

  /** A probe script makes its probes arrive where the construction routes them; a step is done. */
  public answerProbe(expression: string): unknown {
    const at = expression.lastIndexOf(')({')
    if (at === -1 || !expression.startsWith('(async o=>')) {
      return { result: { type: 'string', value: 'done' } }
    }
    this.phase += 1
    const input = JSON.parse(expression.slice(at + 2, -1)) as ProbeInput
    const nonce = /c1-([\da-f]+)\.invalid/.exec(input.get[0] ?? '')?.[1] ?? ''
    // The phase's own fixture port, as its loopback probes name it.
    const fixturePort = Number(/http:\/\/localhost:(\d+)\//.exec(input.get.join(' '))?.[1])
    const { net } = this
    const isAudit = this.phase === 2
    const send = (record: ProxyObservation): void => {
      for (const listener of net.observations) {
        listener(record)
      }
    }
    const pagePhaseRecords = this.phaseRecords[1] ?? []
    if (isAudit && net.isPageLate) {
      for (const late of pagePhaseRecords) {
        send(late)
      }
    }
    const isDropped = (host: string): boolean =>
      net.dropped !== undefined && this.phase >= net.dropped.phase && host === net.dropped.host
    const left: ProxyObservation[] = []
    this.phaseRecords.push(left)
    const record = (record: ProxyObservation): void => {
      if (isDropped(record.host)) {
        return
      }
      left.push(record)
      send(record)
    }
    const hits = net.hits.get(nonce) ?? []
    for (const raw of input.get) {
      const url = new URL(raw)
      const host = url.hostname
      if (['localhost', '127.0.0.1', '[::1]'].includes(host)) {
        if (!isDropped(host)) {
          hits.push(url.pathname.split('/').slice(2).join('/'))
        }
        if (!(isAudit && net.audit === 'unforwarded')) {
          record({
            form: 'http',
            host,
            port: Number(url.port),
            forwarded: true,
            challengeStripped: false,
          })
        }
      } else {
        const isTls = url.protocol === 'https:'
        record({
          form: isTls ? 'connect' : 'http',
          host,
          port: url.port === '' ? (isTls ? 443 : 80) : Number(url.port),
          forwarded: false,
          challengeStripped: false,
        })
      }
    }
    net.hits.set(nonce, hits)
    for (const raw of Object.values(input.ws)) {
      const url = new URL(raw)
      record({
        form: 'connect',
        host: url.hostname,
        port: url.port === '' ? (url.protocol === 'wss:' ? 443 : 80) : Number(url.port),
        forwarded: false,
        challengeStripped: false,
      })
    }
    if (input.auth !== null) {
      net.challenges.set(nonce, 2)
      for (let index = 0; index < 2; index += 1) {
        record({
          form: 'http',
          host: 'localhost',
          port: fixturePort,
          forwarded: true,
          challengeStripped: !(isAudit && net.audit === 'unstripped'),
        })
      }
    }
    if (input.ice !== null) {
      record({
        form: 'connect',
        host: input.ice.address,
        port: input.ice.port,
        forwarded: false,
        challengeStripped: false,
      })
    }
    const sockets = Object.fromEntries(
      Object.keys(input.ws).map((key) => [key, net.report.open === true ? 'open' : 'error']),
    )
    const report = {
      sockets,
      wt: net.report.wt ?? (input.wt === null ? 'none' : 'rejected'),
      candidates: net.report.candidates ?? [],
      ice: net.report.ice ?? (input.ice === null ? 'none' : 'tried'),
    }
    return { result: { type: 'string', value: JSON.stringify(report) } }
  }

  public answer(message: Sent): void {
    if (this.isGone) {
      return
    }
    const handler = this.handlers.get(message.method)
    const result = handler === undefined ? {} : handler(message.params, message.sessionId)
    if (result === HOLD) {
      return
    }
    this.send(
      result instanceof Error
        ? { id: message.id, error: { message: result.message } }
        : { id: message.id, result },
    )
  }

  public on(method: string, handler: Handler): void {
    this.handlers.set(method, handler)
  }

  /** Bytes onto the pipe exactly as given. */
  public raw(bytes: Uint8Array): void {
    if (!this.isGone) {
      this.reader.write(bytes)
    }
  }

  public send(message: unknown): void {
    this.raw(Buffer.from(`${JSON.stringify(message)}\0`))
  }

  /** An event from a session (the model's page unless another is named). */
  public emit(
    method: string,
    params: unknown,
    sessionId: string | undefined = this.pageSession,
  ): void {
    this.send({ method, params, sessionId })
  }

  /** A target attached as it started, held for the debugger: by the browser, or by `parent`'s session. */
  public attach(sessionId: string, targetId: string, type: string, parent?: string): void {
    this.send({
      method: 'Target.attachedToTarget',
      params: { sessionId, targetInfo: { targetId, type, url: '' }, waitingForDebugger: true },
      ...(parent !== undefined && { sessionId: parent }),
    })
  }

  /** A request the browser-wide Fetch gate paused: an event of the browser's own session. */
  public paused(requestId: string, url: string, frameId = 'F-page'): void {
    this.send({
      method: 'Fetch.requestPaused',
      params: { requestId, frameId, request: { url }, resourceType: 'XHR' },
    })
  }

  public calls(method: string): Sent[] {
    return this.sent.filter((message) => message.method === method)
  }

  /** The calls sent to one session, in order. */
  public callsTo(sessionId: string): string[] {
    return this.sent.filter((message) => message.sessionId === sessionId).map((m) => m.method)
  }

  public end(): void {
    if (this.isGone) {
      return
    }
    this.isGone = true
    this.reader.end()
    this.exit()
  }
}

function fakeProxy(net: Network): CheckProxy {
  return {
    endpoint: PROXY,
    bypassList: BROWSER_PROXY_BYPASS,
    observe: (listener) => {
      net.observations.push(listener)
      return noUnsubscribe
    },
    close: () => {
      net.closed.push('proxy')
      return Promise.resolve()
    },
  }
}

function fakeFixture(net: Network): ProbeFixture {
  let opened = 0
  return {
    open: (nonce) => {
      // A port of its own per phase, as the real fixture opens one.
      const port = net.isPortShared ? FIXTURE_PORT : FIXTURE_PORT + 10 * opened
      opened += 1
      net.hits.set(nonce, [])
      return Promise.resolve({
        nonce,
        port,
        loopbackHosts: ['localhost', '127.0.0.1', '[::1]'],
        own: net.own,
        get hits() {
          return net.hits.get(nonce) ?? []
        },
        get challenges() {
          return net.challenges.get(nonce) ?? 0
        },
        get tcpConnections() {
          return net.tcpConnections
        },
      })
    },
    get authorizations() {
      return net.authorizations
    },
    get datagrams() {
      return net.datagrams
    },
    close: () => {
      net.closed.push('fixture')
      return Promise.resolve()
    },
  }
}

interface Setup {
  readonly deps: BrowserRunDeps
  readonly options: BrowserHostOptions
  readonly admission: AbortController
  readonly spawned: { executable: string; args: readonly string[]; env: Record<string, string> }[]
  readonly removed: CheckFolder[]
  readonly order: string[]
  readonly prepared: number[]
}

function setup(
  browser: FakeBrowser,
  overrides: Partial<BrowserRunDeps> = {},
  options: Partial<BrowserHostOptions> = {},
): Setup {
  const spawned: Setup['spawned'] = []
  const removed: CheckFolder[] = []
  const order: string[] = []
  const prepared: number[] = []
  let nonce = 0
  const admission = new AbortController()
  const deps: BrowserRunDeps = {
    platform: 'linux',
    env: { LANG: 'C.UTF-8', HTTPS_PROXY: 'https://proxy.example:3128', KRB5CCNAME: '/tmp/k' },
    createFolder: () => {
      order.push('folder')
      return Promise.resolve(FOLDER)
    },
    removeFolder: (folder) => {
      removed.push(folder)
      order.push('folder gone')
      return Promise.resolve()
    },
    statExecutable: () => Promise.resolve({ bytes: 1000, mtimeMs: 5 }),
    startProxy: () => {
      order.push('proxy')
      return Promise.resolve(fakeProxy(browser.net))
    },
    startFixture: () => {
      order.push('fixture')
      return Promise.resolve(fakeFixture(browser.net))
    },
    spawn: (executable, args, env) => {
      order.push('spawn')
      spawned.push({ executable, args, env: { ...env } })
      const launched = args.filter((arg) => arg.startsWith('-'))
      browser.commandLine = [executable, ...launched, '--headless', '--use-gl=angle', 'about:blank']
      return browser
    },
    randomHex: (bytes) => {
      nonce += 1
      return String(nonce).padStart(bytes * 2, '0')
    },
    timings: {
      preparationMs: 2000,
      checkMs: 5000,
      loadMs: 200,
      settleMs: 10,
      closeGraceMs: 50,
      phaseMs: 400,
      initialCanaryMs: 1000,
    },
    ...overrides,
  }
  const hostOptions: BrowserHostOptions = {
    storageDir: '/storage',
    prepareRuntime: () => {
      prepared.push(Date.now())
      order.push('prepare')
      return Promise.resolve({ ok: true, runtime: RUNTIME })
    },
    admissionSignal: admission.signal,
    admissionStillValid: () => !admission.signal.aborted,
    warn: () => undefined,
    ...options,
  }
  return { deps, options: hostOptions, admission, spawned, removed, order, prepared }
}

function request(overrides: Partial<BrowserCheckRequest> = {}): BrowserCheckRequest {
  return {
    url: PAGE,
    actions: [],
    allowedHosts: [],
    approvalKey: 'key',
    includeScreenshot: true,
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function run(
  t: Setup,
  overrides: Partial<BrowserCheckRequest> = {},
): Promise<BrowserCheckResult> {
  return await runBrowserCheck(t.deps, request(overrides), t.options)
}

/** The page's traffic once it is navigated: what a dev server's page asks for. */
function scriptPage(browser: FakeBrowser, onNavigate: () => void): void {
  browser.on('Page.navigate', (_params, sessionId) => {
    queueMicrotask(() => {
      browser.emit('Page.loadEventFired', {}, sessionId)
      if (sessionId === browser.pageSession) {
        onNavigate()
      }
    })
    return { frameId: 'F1' }
  })
}

describe('the CDP pipe (M81)', () => {
  it('reads messages split across chunks and several in one, and skips what is not a message', async () => {
    const browser = new FakeBrowser(network())
    browser.on('Browser.getVersion', () => HOLD)
    const connection = new CdpConnection(browser.writer, browser.reader)
    const events: string[] = []
    connection.onEvent((event) => {
      events.push(`${event.method}@${event.sessionId ?? 'browser'}`)
    })
    const answer = connection.send('Browser.getVersion')
    const reply = Buffer.from(`${JSON.stringify({ id: 1, result: { product: 'Chrome/150' } })}\0`)
    browser.raw(reply.subarray(0, 7))
    browser.raw(
      Buffer.concat([
        reply.subarray(7),
        Buffer.from('not json\0{"id":"x"}\0'),
        Buffer.from(`${JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'S1' })}\0`),
        Buffer.from(`${JSON.stringify({ method: 'Target.targetCreated' })}\0`),
      ]),
    )
    await expect(answer).resolves.toEqual({ product: 'Chrome/150' })
    expect(events).toEqual(['Page.loadEventFired@S1', 'Target.targetCreated@browser'])
    expect(browser.sent[0]).toEqual({ id: 1, method: 'Browser.getVersion', params: {} })
  })

  it('rejects a refused call, every waiting call when the pipe closes, and a message past its bound', async () => {
    const browser = new FakeBrowser(network())
    browser.on('Page.navigate', () => new Error('Cannot navigate'))
    browser.on('Page.reload', () => HOLD)
    const connection = new CdpConnection(browser.writer, browser.reader, 64)
    await expect(connection.send('Page.navigate')).rejects.toThrow('Cannot navigate')
    const waiting = connection.send('Page.reload')
    browser.raw(Buffer.alloc(65, 'a'))
    await expect(waiting).rejects.toThrow('a message past the bound')
    await expect(connection.send('Page.enable')).rejects.toThrow('a message past the bound')
  })

  it('ends the connection at a whole message past its bound, in one chunk or split, before parsing it (RV81)', () => {
    const pad = 'x'.repeat(200)
    const frame = Buffer.from(
      `${JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { pad } })}\0`,
    )
    expect(frame.length).toBeGreaterThan(64)
    for (const chunks of [[frame], [frame.subarray(0, 60), frame.subarray(60)]]) {
      const browser = new FakeBrowser(network())
      const connection = new CdpConnection(browser.writer, browser.reader, 64)
      const events: string[] = []
      connection.onEvent((event) => {
        events.push(event.method)
      })
      for (const chunk of chunks) {
        browser.reader.emit('data', chunk)
      }
      expect(events).toEqual([])
      expect(connection.closedBy?.message).toBe('a message past the bound')
    }
  })
})

describe('the URLs of requests in flight (RV81)', () => {
  it('forgets each request that finished, keeps at most its bound, and cuts each URL', () => {
    const log = new RequestLog()
    for (let index = 0; index < 10_000; index += 1) {
      log.add(SESSION, `r${String(index)}`, `http://localhost:3000/${String(index)}`)
      log.take(SESSION, `r${String(index)}`)
    }
    expect(log.size).toBe(0)
    for (let index = 0; index < 10_000; index += 1) {
      log.add(SESSION, `r${String(index)}`, `http://localhost:3000/?${'q'.repeat(5000)}`)
    }
    expect(log.size).toBe(BROWSER_CHECK_MAX_TRACKED_REQUESTS)
    expect(log.take(SESSION, 'r0')).toBeUndefined()
    expect(log.take(SESSION, 'r9999')).toHaveLength(BROWSER_CHECK_ENTRY_MAX_CHARS + 1)
    // The same id in another session is another request.
    const sessions = new RequestLog()
    sessions.add('W1', 'r1', 'http://localhost:3000/worker')
    expect(sessions.take(SESSION, 'r1')).toBeUndefined()
    expect(sessions.take('W1', 'r1')).toBe('http://localhost:3000/worker')
  })
})

describe('a browser check on the verified runtime (M81 A1)', () => {
  it('prepares the runtime first, then folder, proxy and fixture before the spawn, and tears all down after', async () => {
    const browser = new FakeBrowser(network())
    const t = setup(browser)
    const result = await run(t)
    expect(result.ok).toBe(true)
    expect(t.order.slice(0, 5)).toEqual(['prepare', 'folder', 'proxy', 'fixture', 'spawn'])
    expect(t.spawned[0]?.executable).toBe(EXECUTABLE)
    expect(t.spawned[0]?.args).toEqual(browserLaunchArgs(PROXY, FOLDER.profile))
    // The browser closed itself; the fixture, the proxy and the folder followed.
    expect(browser.calls('Browser.close')).toHaveLength(1)
    expect(browser.kills).toBe(0)
    expect(browser.net.closed).toEqual(['fixture', 'proxy'])
    expect(t.removed).toEqual([FOLDER])
    expect(t.order.at(-1)).toBe('folder gone')
  })

  it('gives the browser a projected environment, never this process’s proxy or credential variables', async () => {
    const t = setup(new FakeBrowser(network()))
    await run(t)
    const env = t.spawned[0]?.env ?? {}
    expect(env['LANG']).toBe('C.UTF-8')
    expect(env['HOME']).toBe(FOLDER.home)
    expect(env['TMPDIR']).toBe(FOLDER.temp)
    expect(env).not.toHaveProperty('HTTPS_PROXY')
    expect(env).not.toHaveProperty('KRB5CCNAME')
  })

  it('maps each preparation outcome to its closed failure and starts nothing', async () => {
    for (const reason of [
      'runtimeMissing',
      'runtimeUnsupported',
      'runtimeOutdated',
      'runtimeIntegrity',
      'runtimeBlocked',
      'runtimeDeclined',
      'preparationTimedOut',
      'cancelled',
    ] as const) {
      const t = setup(
        new FakeBrowser(network()),
        {},
        {
          prepareRuntime: () => Promise.resolve<RuntimePreparation>({ ok: false, reason }),
        },
      )
      expect(await run(t), reason).toEqual({ ok: false, failure: { kind: reason } })
      expect(t.spawned).toEqual([])
      expect(t.order).toEqual([])
    }
  })

  it('keeps a missing Windows system directory as its own failure and starts no browser (SECWINPATH3 P3-2)', async () => {
    expect(await installGerman(new FakeLogOutputChannel())).toBe('de')
    try {
      const browser = new FakeBrowser(network())
      const t = setup(browser, { platform: 'win32', env: {} })
      const result = await run(t)
      expect(result).toEqual({ ok: false, failure: { kind: 'systemDirectoryUnavailable' } })
      // No browser was spawned, and the folder, the fixture and the proxy still went away.
      expect(t.spawned).toEqual([])
      expect(t.removed).toEqual([FOLDER])
      expect(browser.net.closed).toEqual(['fixture', 'proxy'])
      expect(browserCheckOutcome(PAGE, result)).toEqual({
        output: `Error: ${MODEL_TEXT.browserCheckSystemDirectoryUnavailable}`,
        visibleOutput:
          'Das Windows-Systemverzeichnis ist nicht verfügbar; setzen Sie SystemRoot auf seinen tatsächlichen Pfad.',
        failureReason:
          'Das Windows-Systemverzeichnis ist nicht verfügbar; setzen Sie SystemRoot auf seinen tatsächlichen Pfad.',
      })
    } finally {
      restoreEnglish()
    }
  })

  it('ends a preparation at its own bound, and the check’s 60 seconds start only after it', async () => {
    const t = setup(
      new FakeBrowser(network()),
      { timings: { preparationMs: 30, checkMs: 5000 } },
      { prepareRuntime: () => new Promise<RuntimePreparation>(() => undefined) },
    )
    expect(await run(t)).toEqual({ ok: false, failure: { kind: 'preparationTimedOut' } })
    expect(t.spawned).toEqual([])

    // A preparation longer than the whole check budget still leads to a check.
    const slow = setup(
      new FakeBrowser(network()),
      { timings: { checkMs: 2000 } },
      {
        prepareRuntime: () =>
          new Promise<RuntimePreparation>((resolve) => {
            setTimeout(() => {
              resolve({ ok: true, runtime: RUNTIME })
            }, 2500)
          }),
      },
    )
    expect(await run(slow)).toMatchObject({ ok: true })
  }, 15_000)

  it('refuses before anything when stopped or no longer admitted, and reads admission again once ready', async () => {
    const stopped = setup(new FakeBrowser(network()))
    const stop = new AbortController()
    stop.abort()
    expect(await run(stopped, { signal: stop.signal })).toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
    })
    expect(stopped.order).toEqual([])

    const gone = setup(new FakeBrowser(network()))
    gone.admission.abort('scopeChanged')
    expect(await run(gone)).toEqual({ ok: false, failure: { kind: 'scopeChanged' } })
    expect(gone.prepared).toEqual([])

    // Admission lost while the runtime was prepared: nothing is created.
    let isAdmitted = true
    const late = setup(
      new FakeBrowser(network()),
      {},
      {
        admissionStillValid: () => isAdmitted,
        prepareRuntime: () => {
          isAdmitted = false
          return Promise.resolve({ ok: true, runtime: RUNTIME })
        },
      },
    )
    expect(await run(late)).toEqual({ ok: false, failure: { kind: 'notOffered' } })
    expect(late.order).toEqual([])
  })

  it('aborts a preparation under way when admission goes, with its reason', async () => {
    const t = setup(
      new FakeBrowser(network()),
      {},
      {
        prepareRuntime: (prepare) =>
          new Promise<RuntimePreparation>((resolve) => {
            prepare.lifetime.signal.addEventListener('abort', () => {
              resolve({ ok: false, reason: 'cancelled' })
            })
          }),
      },
    )
    const pending = run(t)
    setTimeout(() => {
      t.admission.abort('scopeChanged')
    }, 20)
    expect(await pending).toEqual({ ok: false, failure: { kind: 'scopeChanged' } })
  })

  it('refuses a runtime whose executable changed after its verification, before any spawn', async () => {
    for (const identity of [undefined, { bytes: 999, mtimeMs: 5 }, { bytes: 1000, mtimeMs: 6 }]) {
      const t = setup(new FakeBrowser(network()), {
        statExecutable: () => Promise.resolve(identity),
      })
      expect(await run(t)).toEqual({ ok: false, failure: { kind: 'runtimeIntegrity' } })
      expect(t.spawned).toEqual([])
      expect(t.removed).toEqual([FOLDER])
    }
  })

  it('says the OS blocked the runtime when it refuses to run it, and that it could not start otherwise', async () => {
    for (const [code, kind] of [
      ['EPERM', 'runtimeBlocked'],
      ['EACCES', 'runtimeBlocked'],
      ['ENOENT', 'launch'],
    ] as const) {
      const t = setup(new FakeBrowser(network()), {
        spawn: () => {
          throw Object.assign(new Error(`spawn ${code} /secret/path`), { code })
        },
      })
      expect(await run(t)).toEqual({ ok: false, failure: { kind } })
      expect(t.removed).toEqual([FOLDER])
    }
  })

  it('says the OS blocked the runtime when the spawn fails only after it returned', async () => {
    for (const code of ['EPERM', 'EACCES'] as const) {
      const browser = new FakeBrowser(network())
      browser.spawnError = Promise.resolve(code)
      const t = setup(browser)
      expect(await run(t), code).toEqual({ ok: false, failure: { kind: 'runtimeBlocked' } })
      expect(t.removed).toEqual([FOLDER])
    }
  })

  it('returns nothing from the page when stopped during teardown, after the last admission read', async () => {
    const browser = new FakeBrowser(network())
    const inner = setup(browser)
    const stop = new AbortController()
    const t: Setup = {
      ...inner,
      deps: {
        ...inner.deps,
        removeFolder: (folder) => {
          stop.abort()
          return inner.deps.removeFolder(folder)
        },
      },
    }
    expect(await run(t, { signal: stop.signal })).toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
    })
    expect(t.removed).toEqual([FOLDER])
  })

  it('refuses a folder, proxy or fixture that cannot be made, with its own failure', async () => {
    expect(await run(setup(new FakeBrowser(network()), { createFolder: reject }))).toEqual({
      ok: false,
      failure: { kind: 'profile' },
    })
    expect(await run(setup(new FakeBrowser(network()), { startProxy: reject }))).toEqual({
      ok: false,
      failure: { kind: 'launch' },
    })
    expect(await run(setup(new FakeBrowser(network()), { startFixture: reject }))).toEqual({
      ok: false,
      failure: { kind: 'unverifiable' },
    })
  })

  it('holds the browser to the pin: its exact product, its command line, one blank page and its network service', async () => {
    const cases: [(browser: FakeBrowser) => void, string][] = [
      [
        (browser) => {
          browser.on('Browser.getVersion', () => ({ product: 'HeadlessChrome/154.0.8037.93' }))
        },
        'unrecognized',
      ],
      [
        (browser) => {
          browser.on('Browser.getBrowserCommandLine', () => ({
            arguments: browser.commandLine.map((arg) =>
              arg.startsWith('--host-resolver-rules=')
                ? '--host-resolver-rules=MAP * ^NOTFOUND'
                : arg,
            ),
          }))
        },
        'resolverUnconfirmed',
      ],
      [
        (browser) => {
          browser.on('Browser.getBrowserCommandLine', () => ({
            arguments: [...browser.commandLine, '--remote-debugging-port=9222'],
          }))
        },
        'unrecognized',
      ],
      [
        (browser) => {
          browser.on('Target.getTargets', () => ({
            targetInfos: [
              { type: 'page', url: 'about:blank' },
              { type: 'service_worker', url: 'http://localhost/sw.js' },
            ],
          }))
        },
        'unrecognized',
      ],
      [
        (browser) => {
          browser.on('SystemInfo.getProcessInfo', () => ({
            processInfo: [{ type: 'browser', id: 1 }],
          }))
        },
        'unrecognized',
      ],
    ]
    for (const [script, kind] of cases) {
      const browser = new FakeBrowser(network())
      script(browser)
      const t = setup(browser)
      expect(await run(t), kind).toEqual({ ok: false, failure: { kind } })
      expect(browser.calls('Target.createTarget'), kind).toEqual([])
      // Not a graceful end: the browser is killed at once.
      expect(browser.kills, kind).toBe(1)
    }
  })

  it('logs only the command line’s count of other switches, never their names or values', async () => {
    const facts: string[] = []
    const browser = new FakeBrowser(network())
    const t = setup(
      browser,
      {},
      {
        warn: (fact) => {
          facts.push(fact)
        },
      },
    )
    await run(t)
    expect(facts).toEqual(['Browser check: command line held, 2 other switches'])
    expect(facts.join(' ')).not.toContain('use-gl')
  })

  it('puts the gate, the watch and the download refusal on the browser before any page exists', async () => {
    const browser = new FakeBrowser(network())
    await run(setup(browser))
    const browserCalls = browser.sent
      .filter((message) => message.sessionId === undefined)
      .map((message) => message.method)
    const firstTarget = browserCalls.indexOf('Target.createTarget')
    expect(browserCalls.slice(0, firstTarget)).toEqual([
      'Browser.getVersion',
      'Browser.getBrowserCommandLine',
      'Target.getTargets',
      'SystemInfo.getProcessInfo',
      'Fetch.enable',
      'Target.setAutoAttach',
      'Browser.setDownloadBehavior',
    ])
    expect(browser.calls('Fetch.enable')[0]?.params).toEqual({
      patterns: [{ urlPattern: '*' }],
      handleAuthRequests: true,
    })
    expect(browser.calls('Target.setAutoAttach')[0]?.params).toEqual({
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    })
  })

  it('creates the private context with the same proxy and the loopback subtraction, its cookies empty and downloads denied', async () => {
    const browser = new FakeBrowser(network())
    expect(await run(setup(browser))).toMatchObject({ ok: true })
    expect(browser.calls('Target.createBrowserContext')[0]?.params).toEqual({
      proxyServer: PROXY,
      proxyBypassList: '<-loopback>',
      disposeOnDetach: true,
    })
    expect(browser.calls('Storage.getCookies')[0]?.params).toEqual({ browserContextId: 'CTX' })
    expect(browser.calls('Browser.setDownloadBehavior').map((call) => call.params)).toEqual([
      { behavior: 'deny' },
      { behavior: 'deny', browserContextId: 'CTX' },
    ])
    // The model's page is in that context.
    expect(
      browser
        .calls('Target.createTarget')
        .map((call) => call.params['browserContextId'] ?? 'default'),
    ).toEqual(['default', 'CTX', 'CTX', 'CTX'])
  })

  it('refuses a private context that cannot be made or is not fresh', async () => {
    const failing = new FakeBrowser(network())
    failing.on('Target.createBrowserContext', () => new Error('not supported'))
    expect(await run(setup(failing))).toEqual({ ok: false, failure: { kind: 'profile' } })
    const used = new FakeBrowser(network())
    used.on('Storage.getCookies', () => ({ cookies: [{ name: 'sid' }] }))
    expect(await run(setup(used))).toEqual({ ok: false, failure: { kind: 'profile' } })
  })

  it('sets every page and frame up before it runs: Network, a virtual authenticator without presence, the chooser held', async () => {
    const browser = new FakeBrowser(network())
    await run(setup(browser))
    const page = browser.pageSession
    expect(browser.callsTo(page).slice(0, 6)).toEqual([
      'Network.enable',
      'Target.setAutoAttach',
      'WebAuthn.enable',
      'WebAuthn.addVirtualAuthenticator',
      'Page.setInterceptFileChooserDialog',
      'Runtime.runIfWaitingForDebugger',
    ])
    const authenticator = browser
      .calls('WebAuthn.addVirtualAuthenticator')
      .find((call) => call.sessionId === page)
    expect(authenticator?.params).toEqual({
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasUserVerification: true,
        isUserVerified: false,
        automaticPresenceSimulation: false,
      },
    })
  })

  it('watches a worker with Network only, and ends unwatchable on a failed setup, an unknown type or too many targets', async () => {
    const worker = new FakeBrowser(network())
    scriptPage(worker, () => {
      worker.attach('W1', 'TW', 'worker', worker.pageSession)
    })
    expect(await run(setup(worker))).toMatchObject({ ok: true })
    expect(worker.callsTo('W1')).toEqual([
      'Network.enable',
      'Target.setAutoAttach',
      'Runtime.runIfWaitingForDebugger',
    ])

    for (const attach of [
      (browser: FakeBrowser) => {
        browser.attach('X1', 'TX', 'auction_worklet', browser.pageSession)
      },
      (browser: FakeBrowser) => {
        browser.on('Network.enable', (_params, sessionId) =>
          sessionId === 'W2' ? new Error('Network.enable failed') : {},
        )
        browser.attach('W2', 'TW2', 'worker', browser.pageSession)
      },
      (browser: FakeBrowser) => {
        for (let index = 0; index < 70; index += 1) {
          browser.attach(`F${String(index)}`, `TF${String(index)}`, 'iframe', browser.pageSession)
        }
      },
    ]) {
      const browser = new FakeBrowser(network())
      browser.on('Runtime.runIfWaitingForDebugger', (_params, sessionId) =>
        sessionId === 'X1' ? HOLD : {},
      )
      scriptPage(browser, () => {
        attach(browser)
      })
      expect(await run(setup(browser))).toEqual({ ok: false, failure: { kind: 'unwatchable' } })
      expect(browser.kills).toBe(1)
    }
  })

  it('runs three canary phases, each on its own probe target with fresh nonces and its own exceptions', async () => {
    const browser = new FakeBrowser(network())
    const t = setup(browser)
    expect(await run(t)).toMatchObject({ ok: true })
    const probes = browser
      .calls('Runtime.evaluate')
      .map((call) => String(call.params['expression']))
      .filter((expression) => expression.startsWith('(async o=>'))
    expect(probes).toHaveLength(3)
    const nonces = probes.map((probe) => /c1-([\da-f]+)\.invalid/.exec(probe)?.[1])
    expect(new Set(nonces).size).toBe(3)
    expect(nonces.every((nonce) => nonce?.length === 32)).toBe(true)
    // The default phase routes only; the page and audit phases test everything.
    expect(probes[0]).toContain('"auth":null')
    expect(probes[1]).toContain(`"ice":{"address":"${OWN.address}"`)
    expect(probes[2]).toContain(`"wt":"https://${OWN.address}:${String(OWN.udpPort)}/`)
  })

  it('lets a phase’s exact probe URLs through from its own frame only, and fails them anywhere else or after it', async () => {
    const browser = new FakeBrowser(network())
    const decisions = gateDecisions(browser)
    let probeUrl = ''
    let pagePhaseUrl = ''
    browser.on('Runtime.evaluate', (params) => {
      const expression = String(params['expression'])
      if (expression.startsWith('(async o=>')) {
        const url = /"(http:\/\/c1-[\da-f]+\.invalid\/)"/.exec(expression)?.[1] ?? ''
        if (probeUrl === '') {
          probeUrl = url
          // From the probe frame (its session S1's main frame), then from the page's frame.
          browser.paused('p1', probeUrl, 'F-S1')
          browser.paused('p2', probeUrl, 'F-other')
        } else if (pagePhaseUrl === '') {
          pagePhaseUrl = url
        }
      }
      return browser.answerProbe(expression)
    })
    scriptPage(browser, () => {
      browser.paused('p3', probeUrl, 'F-S1')
      // The page phase's own frame and URL, once that phase has ended: revoked.
      browser.paused('p4', pagePhaseUrl, 'F-S2')
    })
    await run(setup(browser))
    expect(pagePhaseUrl).not.toBe('')
    expect(decisions).toEqual(
      expect.arrayContaining(['continue p1', 'fail p2', 'fail p3', 'fail p4']),
    )
  })

  it('ends with the canary’s own failure when a probe does not arrive where the construction routes it', async () => {
    const cases: [Partial<Network>, string][] = [
      [{ dropped: { phase: 0, host: 'localhost' } }, 'routeUnconfirmed'],
      [{ dropped: { phase: 1, host: OWN.address } }, 'webrtc'],
      [{ report: { wt: 'ready' } }, 'transport'],
      [
        { report: { candidates: ['candidate:1 1 udp 2122260223 192.168.7.9 50000 typ host'] } },
        'webrtc',
      ],
      [{ report: { open: true } }, 'routeUnconfirmed'],
      [{ authorizations: 1 }, 'signIn'],
      [{ own: undefined }, 'unverifiable'],
    ]
    for (const [faults, kind] of cases) {
      const browser = new FakeBrowser(network(faults))
      const t = setup(browser)
      expect(await run(t), kind).toEqual({ ok: false, failure: { kind } })
      // Nothing of the page ran.
      expect(browser.pageSession, kind).toBe('')
      expect(browser.kills, kind).toBe(1)
    }
  }, 30_000)

  it('discards the page’s results when the audit after it fails, or the network service restarted', async () => {
    const audit = new FakeBrowser(network({ dropped: { phase: 2, host: 'localhost' } }))
    expect(await run(setup(audit))).toEqual({ ok: false, failure: { kind: 'auditFailed' } })
    expect(audit.calls('Page.captureScreenshot')).toHaveLength(1)

    const restarted = new FakeBrowser(network())
    restarted.serviceIds = [41, 77]
    expect(await run(setup(restarted))).toEqual({ ok: false, failure: { kind: 'restartObserved' } })
  }, 15_000)

  it('fails the audit on its own records alone: the page phase’s, early or late, never stand in for them (A1-1)', async () => {
    const cases: Partial<Network>[] = [
      { isPortShared: true, audit: 'unstripped' },
      { isPortShared: true, audit: 'unforwarded' },
      { isPageLate: true, audit: 'unstripped' },
      { isPageLate: true, audit: 'unforwarded' },
    ]
    for (const faults of cases) {
      const browser = new FakeBrowser(network(faults))
      const name = JSON.stringify(faults)
      expect(await run(setup(browser)), name).toEqual({
        ok: false,
        failure: { kind: 'auditFailed' },
      })
      // The page phase held: the model's page ran, and its results were discarded.
      expect(browser.calls('Page.captureScreenshot'), name).toHaveLength(1)
    }
    // The audit's own records intact: the same runs pass.
    for (const faults of [{ isPortShared: true }, { isPageLate: true }]) {
      expect(
        await run(setup(new FakeBrowser(network(faults)))),
        JSON.stringify(faults),
      ).toMatchObject({ ok: true })
    }
  }, 30_000)

  it('ends with the end’s own kind when a stop, admission or the deadline comes during setup (P3-1)', async () => {
    const holds: [
      string,
      (browser: FakeBrowser, reached: () => void) => Partial<BrowserRunDeps>,
    ][] = [
      [
        'folder',
        (_browser, reached) => ({
          createFolder: () => {
            reached()
            return pending()
          },
        }),
      ],
      [
        'executable',
        (_browser, reached) => ({
          statExecutable: () => {
            reached()
            return pending()
          },
        }),
      ],
      [
        'private context',
        (browser, reached) => {
          browser.on('Target.createBrowserContext', () => {
            reached()
            return HOLD
          })
          return {}
        },
      ],
    ]
    const ends = [
      ['stop', 'cancelled'],
      ['admission', 'scopeChanged'],
      ['deadline', 'timedOut'],
    ] as const
    for (const [where, hold] of holds) {
      for (const [end, kind] of ends) {
        const browser = new FakeBrowser(network())
        const stop = new AbortController()
        const trigger = { fire: idle }
        const t = setup(browser, {
          ...hold(browser, () => {
            setTimeout(() => {
              trigger.fire()
            }, 10)
          }),
          timings: {
            preparationMs: 2000,
            checkMs: end === 'deadline' ? 400 : 5000,
            loadMs: 200,
            settleMs: 10,
            closeGraceMs: 50,
            phaseMs: 400,
            initialCanaryMs: 1000,
          },
        })
        if (end === 'stop') {
          trigger.fire = () => {
            stop.abort()
          }
        } else if (end === 'admission') {
          trigger.fire = () => {
            t.admission.abort('scopeChanged')
          }
        }
        expect(await run(t, { signal: stop.signal }), `${where} ${end}`).toEqual({
          ok: false,
          failure: { kind },
        })
      }
    }
  }, 30_000)

  it('removes a folder that resolves after a stop, starting nothing', async () => {
    const browser = new FakeBrowser(network())
    const inner = setup(browser)
    const gate = Promise.withResolvers<CheckFolder>()
    const stop = new AbortController()
    let isCreating = false
    const t: Setup = {
      ...inner,
      deps: {
        ...inner.deps,
        createFolder: () => {
          isCreating = true
          return gate.promise
        },
      },
    }
    const running = run(t, { signal: stop.signal })
    await vi.waitFor(() => {
      expect(isCreating).toBe(true)
    })
    stop.abort()
    gate.resolve(FOLDER)
    expect(await running).toEqual({ ok: false, failure: { kind: 'cancelled' } })
    await vi.waitFor(() => {
      expect(t.removed).toEqual([FOLDER])
    })
    expect(t.order).not.toContain('proxy')
    expect(t.spawned).toEqual([])
  })

  it('removes a half-made folder when its creation fails, ending with the profile failure', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'bc-partial-'))
    try {
      const browser = new FakeBrowser(network())
      const inner = setup(browser)
      const host = hostBrowserRunDeps({ platform: 'linux', env: {}, warn: () => undefined })
      const t: Setup = {
        ...inner,
        deps: { ...inner.deps, createFolder: (dir) => host.createFolder(dir) },
        options: { ...inner.options, storageDir: storage },
      }
      folderFault.failProfileSubdir = true
      try {
        expect(await run(t)).toEqual({ ok: false, failure: { kind: 'profile' } })
      } finally {
        folderFault.failProfileSubdir = false
      }
      await expect(readdir(path.join(storage, 'bc'))).resolves.toEqual([])
      expect(t.spawned).toEqual([])
    } finally {
      await rm(storage, { recursive: true, force: true })
    }
  })

  it('removes the folder exactly once on a normal run', async () => {
    const browser = new FakeBrowser(network())
    const t = setup(browser)
    expect(await run(t)).toMatchObject({ ok: true })
    expect(t.removed).toEqual([FOLDER])
  })

  it('reads a probe page that never loaded (its route not the one built) as the phase’s own failure', async () => {
    // As on the pinned shell with the proxy or its loopback subtraction gone:
    // localhost goes direct, where the resolver rule fails it.
    for (const [phase, kind] of [
      ['S1', 'routeUnconfirmed'],
      ['S2', 'routeUnconfirmed'],
    ] as const) {
      const browser = new FakeBrowser(network())
      browser.on('Page.navigate', (_params, sessionId) => {
        if (sessionId === phase) {
          return { frameId: `F-${phase}`, errorText: 'net::ERR_NAME_NOT_RESOLVED' }
        }
        queueMicrotask(() => {
          browser.emit('Page.loadEventFired', {}, sessionId)
        })
        return { frameId: 'F1' }
      })
      expect(await run(setup(browser)), phase).toEqual({ ok: false, failure: { kind } })
      expect(browser.pageSession, phase).toBe('')
    }
  })

  it('ends a phase that outlasts its bound', async () => {
    const browser = new FakeBrowser(network())
    browser.on('Page.getFrameTree', () => HOLD)
    expect(await run(setup(browser))).toEqual({ ok: false, failure: { kind: 'routeUnconfirmed' } })
    expect(browser.calls('Runtime.evaluate')).toEqual([])
  })

  it('reads back the console errors, the failed requests, what was blocked and a screenshot', async () => {
    const browser = new FakeBrowser(network())
    scriptPage(browser, () => {
      browser.emit('Runtime.consoleAPICalled', {
        type: 'error',
        args: [
          { type: 'string', value: 'boom' },
          { type: 'number', value: 7 },
        ],
      })
      browser.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'quiet' }],
      })
      browser.emit('Runtime.exceptionThrown', {
        exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: x' } },
      })
      browser.emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: `${PAGE}missing.json` },
      })
      browser.emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: `${PAGE}missing.json`,
          status: 404,
          remoteIPAddress: '127.0.0.1',
          remotePort: PROXY_PORT,
        },
      })
      browser.emit('Network.requestWillBeSent', { requestId: 'r2', request: { url: `${PAGE}api` } })
      browser.emit('Network.loadingFailed', {
        requestId: 'r2',
        errorText: 'net::ERR_CONNECTION_REFUSED',
      })
      browser.emit('Network.requestWillBeSent', {
        requestId: 'r3',
        request: { url: `${HTTP}//10.0.0.5/x` },
      })
      browser.emit('Network.loadingFailed', {
        requestId: 'r3',
        errorText: 'net::ERR_BLOCKED_BY_CLIENT',
        blockedReason: 'inspector',
      })
      browser.emit('Network.webSocketCreated', { requestId: 'w1', url: 'ws://10.0.0.5/live' })
    })
    const result = await run(setup(browser))
    expect(result).toEqual({
      ok: true,
      report: {
        finalUrl: PAGE,
        consoleErrors: { shown: ['boom 7', 'TypeError: x'], more: 0 },
        failedRequests: {
          shown: [`${PAGE}missing.json (HTTP 404)`, `${PAGE}api (net::ERR_CONNECTION_REFUSED)`],
          more: 0,
        },
        blockedRequests: { shown: [`${HTTP}//10.0.0.5/x`, 'ws://10.0.0.5/live'], more: 0 },
        screenshot: { png: expect.any(Uint8Array), width: 1, height: 1 },
      },
    })
  })

  it('ends leaked, with nothing from the page, at an answer from beyond that did not come back through the proxy', async () => {
    const answers: ((browser: FakeBrowser) => void)[] = [
      (browser) => {
        browser.emit('Network.responseReceived', {
          requestId: 'r9',
          response: {
            url: `${HTTP}//10.0.0.5/`,
            status: 200,
            remoteIPAddress: '10.0.0.5',
            remotePort: 80,
          },
        })
      },
      // Loopback, but not the check's proxy: another local process answered.
      (browser) => {
        browser.emit('Network.responseReceived', {
          requestId: 'r8',
          response: {
            url: `${HTTP}//10.0.0.5/`,
            status: 200,
            remoteIPAddress: '127.0.0.1',
            remotePort: PROXY_PORT + 1,
          },
        })
      },
      (browser) => {
        browser.emit('Network.requestWillBeSent', {
          requestId: 'r9',
          request: { url: `${PAGE}next` },
          redirectResponse: {
            url: `${HTTP}//evil.example/`,
            remoteIPAddress: '203.0.113.9',
            remotePort: 80,
          },
        })
      },
      (browser) => {
        browser.emit('Network.webSocketCreated', { requestId: 'w9', url: 'ws://10.0.0.5/' })
        browser.emit('Network.webSocketHandshakeResponseReceived', { requestId: 'w9' })
      },
      (browser) => {
        browser.emit('Network.webTransportCreated', {
          transportId: 'x9',
          url: 'https://10.0.0.5:4433/',
        })
        browser.emit('Network.webTransportConnectionEstablished', { transportId: 'x9' })
      },
    ]
    for (const answer of answers) {
      const browser = new FakeBrowser(network())
      browser.on('Page.captureScreenshot', () => HOLD)
      scriptPage(browser, () => {
        answer(browser)
      })
      expect(await run(setup(browser))).toEqual({ ok: false, failure: { kind: 'leaked' } })
      expect(browser.kills).toBe(1)
    }
  })

  it('counts the proxy’s own refusal of a host beyond as blocked, not leaked, and lets a service worker’s answer be', async () => {
    const browser = new FakeBrowser(network())
    scriptPage(browser, () => {
      browser.emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: `${HTTP}//10.0.0.5/`,
          status: 403,
          remoteIPAddress: '127.0.0.1',
          remotePort: PROXY_PORT,
        },
      })
      browser.emit('Network.responseReceived', {
        requestId: 'r2',
        response: { url: `${HTTP}//10.0.0.6/`, status: 200, fromServiceWorker: true },
      })
    })
    const result = await run(setup(browser))
    expect(result.ok && result.report.blockedRequests.shown).toEqual([`${HTTP}//10.0.0.5/`])
  })

  it('lets through approved hosts only, and every request beyond fails at the gate', async () => {
    const browser = new FakeBrowser(network())
    const decisions = gateDecisions(browser)
    scriptPage(browser, () => {
      browser.paused('a', `${HTTP}//127.0.0.1:5173/x`)
      browser.paused('b', `${HTTP}//staging.example.com/api`)
      browser.paused('c', `${HTTP}//other.example.com/api`)
      browser.paused('d', 'file:///etc/passwd')
    })
    await run(setup(browser), { allowedHosts: ['staging.example.com'] })
    expect(decisions).toEqual(
      expect.arrayContaining(['continue a', 'continue b', 'fail c', 'fail d']),
    )
  })

  it('answers every sign-in challenge with CancelAuth on its own session, never with credentials', async () => {
    const browser = new FakeBrowser(network())
    scriptPage(browser, () => {
      browser.send({
        method: 'Fetch.authRequired',
        params: { requestId: 'auth1', authChallenge: {} },
      })
    })
    await run(setup(browser))
    expect(browser.calls('Fetch.continueWithAuth')).toEqual([
      expect.objectContaining({
        params: { requestId: 'auth1', authChallengeResponse: { response: 'CancelAuth' } },
      }),
    ])
  })

  it('runs the click and type steps in order, the selector and text passed as data, and stops at a missing element', async () => {
    const browser = new FakeBrowser(network())
    await run(setup(browser), {
      actions: [
        { kind: 'type', selector: 'input[name="q"]', text: 'a"b' },
        { kind: 'click', selector: '#go' },
      ],
    })
    const steps = browser
      .calls('Runtime.evaluate')
      .map((call) => String(call.params['expression']))
      .filter((expression) => !expression.startsWith('(async o=>'))
    expect(steps).toHaveLength(2)
    expect(steps[0]).toContain(String.raw`("type", "input[name=\"q\"]", "a\"b")`)

    const missing = new FakeBrowser(network())
    missing.on('Runtime.evaluate', (params) => {
      const expression = String(params['expression'])
      return expression.startsWith('(async o=>')
        ? missing.answerProbe(expression)
        : { result: { type: 'string', value: 'missing' } }
    })
    expect(await run(setup(missing), { actions: [{ kind: 'click', selector: '#nope' }] })).toEqual({
      ok: false,
      failure: { kind: 'noElement', selector: '#nope' },
    })
  })

  it('keeps only a net::ERR_ code of a page that did not load, and says a block stopped it', async () => {
    for (const [errorText, failure] of [
      [
        'net::ERR_CONNECTION_REFUSED',
        { kind: 'pageFailed', netError: 'net::ERR_CONNECTION_REFUSED' },
      ],
      [
        'Cannot navigate to invalid URL /home/someone/secret',
        { kind: 'pageFailed', netError: undefined },
      ],
      ['net::ERR_BLOCKED_BY_CLIENT', { kind: 'pageBlocked' }],
    ] as const) {
      const browser = new FakeBrowser(network())
      browser.on('Page.navigate', (_params, sessionId) => {
        if (sessionId === browser.pageSession) {
          return { frameId: 'F1', errorText }
        }
        queueMicrotask(() => {
          browser.emit('Page.loadEventFired', {}, sessionId)
        })
        return { frameId: 'F1' }
      })
      expect(await run(setup(browser))).toEqual({ ok: false, failure })
    }
  })

  it('ends at its deadline and when stopped, killing the browser at once and sending nothing more', async () => {
    const late = new FakeBrowser(network())
    late.on('Page.captureScreenshot', () => HOLD)
    const lateRun = setup(late, {
      timings: {
        checkMs: 300,
        loadMs: 50,
        phaseMs: 100,
        initialCanaryMs: 200,
        closeGraceMs: 50,
        settleMs: 10,
      },
    })
    expect(await run(lateRun)).toEqual({ ok: false, failure: { kind: 'timedOut' } })
    expect(late.kills).toBe(1)
    expect(late.calls('Browser.close')).toEqual([])

    const stopped = new FakeBrowser(network())
    const stop = new AbortController()
    stopped.on('Page.captureScreenshot', () => {
      stop.abort()
      return HOLD
    })
    const t = setup(stopped)
    expect(await run(t, { signal: stop.signal })).toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
    })
    const sentAfterStop = stopped.sent.slice(
      stopped.sent.findIndex((m) => m.method === 'Page.captureScreenshot') + 1,
    )
    expect(sentAfterStop).toEqual([])
    expect(stopped.kills).toBe(1)
    expect(t.removed).toEqual([FOLDER])
  })

  it('ends when admission goes during the check, with its reason, and returns nothing from the page after it', async () => {
    const browser = new FakeBrowser(network())
    const t = setup(browser)
    browser.on('Page.captureScreenshot', () => {
      t.admission.abort('notOffered')
      return HOLD
    })
    expect(await run(t)).toEqual({ ok: false, failure: { kind: 'notOffered' } })

    // Admission read once more before the result goes back.
    let reads = 0
    const lastRead = setup(
      new FakeBrowser(network()),
      {},
      {
        admissionStillValid: () => {
          reads += 1
          return reads < 3
        },
      },
    )
    expect(await run(lastRead)).toEqual({ ok: false, failure: { kind: 'notOffered' } })
  })

  it('reports a browser that went away mid-check, and kills one that will not close when asked', async () => {
    const gone = new FakeBrowser(network())
    scriptPage(gone, () => {
      gone.end()
    })
    expect(await run(setup(gone))).toEqual({ ok: false, failure: { kind: 'browserFailed' } })

    const stubborn = new FakeBrowser(network())
    stubborn.on('Browser.close', () => ({}))
    expect(await run(setup(stubborn))).toMatchObject({ ok: true })
    expect(stubborn.calls('Browser.close')).toHaveLength(1)
    expect(stubborn.kills).toBe(1)
  })

  it('refuses a screenshot that is not a PNG', async () => {
    const browser = new FakeBrowser(network())
    browser.on('Page.captureScreenshot', () => ({ data: Buffer.from('GIF89a').toString('base64') }))
    expect(await run(setup(browser))).toEqual({ ok: false, failure: { kind: 'browserFailed' } })
  })

  it('leaves the screenshot out when the caller asked for text only', async () => {
    const browser = new FakeBrowser(network())
    const result = await run(setup(browser), { includeScreenshot: false })
    expect(result.ok && result.report.screenshot).toBeUndefined()
    expect(browser.calls('Page.captureScreenshot')).toEqual([])
  })
})
