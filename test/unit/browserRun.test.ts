// One browser check (M81, PLAN.md D49) against a scripted browser on the
// other end of the pipe: the framing, the browser-wide request gate (every
// request beyond loopback failed, redirects and other targets included,
// names never looked up), what comes back, and the browser and its profile
// gone whatever ended the check. The real browser runs in
// browserCheckLive.test.ts.
import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  type BrowserCheckRequest,
  type BrowserProcess,
  type BrowserRunDeps,
  runBrowserCheck,
} from '../../src/core/browser/browserRun'
import { CdpConnection } from '../../src/core/browser/cdpPipe'

// A 1×1 PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PAGE = 'http://localhost:3000/'
// Plain HTTP to a named host is what these cases test; spelled so the
// lint's HTTPS rule, whose fix would rewrite them, leaves them alone.
const HTTP = 'http:'
const PROFILE = '/tmp/muse-spark-browser-test'
const SESSION = 'S1'
/** Answer nothing: the call stays pending. */
const HOLD = Symbol('hold')

interface Sent {
  readonly id: number
  readonly method: string
  readonly params: Record<string, unknown>
  readonly sessionId?: string
}

type Handler = (params: Record<string, unknown>, sessionId: string | undefined) => unknown

/** The browser's side of the pipe, scripted call by call. */
class FakeBrowser implements BrowserProcess {
  private exit: () => void = () => undefined
  public readonly sent: Sent[] = []
  public readonly handlers = new Map<string, Handler>()
  public kills = 0
  public isGone = false
  public readonly exited: Promise<void>
  /** File descriptor 4 as the parent reads it. */
  public readonly reader = new PassThrough()

  public kill = (): Promise<void> => {
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

  public constructor(public targetUrl = PAGE) {
    this.exited = new Promise((resolve) => {
      this.exit = resolve
    })
    this.on('Target.createTarget', () => ({ targetId: 'T1' }))
    this.on('Target.attachToTarget', () => ({ sessionId: SESSION }))
    this.on('Page.navigate', () => ({ frameId: 'F1' }))
    this.on('Runtime.evaluate', () => ({ result: { type: 'string', value: 'done' } }))
    this.on('Target.getTargetInfo', () => ({ targetInfo: { url: this.targetUrl } }))
    this.on('Page.captureScreenshot', () => ({ data: PNG_BASE64 }))
    this.on('Browser.close', () => {
      queueMicrotask(() => {
        this.end()
      })
      return {}
    })
  }

  private answer(message: Sent): void {
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

  /** An event from a page's session, the check's own unless another is named. */
  public emit(method: string, params: unknown, sessionId = SESSION): void {
    this.send({ method, params, sessionId })
  }

  /** A request the browser-wide Fetch gate paused: an event of the browser's own session. */
  public paused(requestId: string, url: string): void {
    this.send({
      method: 'Fetch.requestPaused',
      params: { requestId, request: { url }, resourceType: 'XHR' },
    })
  }

  public calls(method: string): Sent[] {
    return this.sent.filter((message) => message.method === method)
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

function setup(browser: FakeBrowser, overrides: Partial<BrowserRunDeps> = {}) {
  const spawned: { executable: string; args: readonly string[] }[] = []
  const removed: string[] = []
  const left: string[] = []
  let created = 0
  const deps: BrowserRunDeps = {
    findExecutable: () => '/usr/bin/google-chrome',
    createProfile: () => {
      created += 1
      return Promise.resolve(PROFILE)
    },
    removeProfile: (directory) => {
      removed.push(directory)
      return Promise.resolve()
    },
    spawn: (executable, args) => {
      spawned.push({ executable, args })
      return browser
    },
    onProfileLeft: (directory) => {
      left.push(directory)
    },
    timings: { checkMs: 2000, loadMs: 50, settleMs: 10, closeGraceMs: 50 },
    ...overrides,
  }
  return { deps, spawned, removed, left, created: () => created }
}

function request(overrides: Partial<BrowserCheckRequest> = {}): BrowserCheckRequest {
  return {
    url: PAGE,
    actions: [],
    allowedHosts: [],
    includeScreenshot: true,
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** The page's traffic on navigation: what a dev server's page asks for. */
function scriptPage(browser: FakeBrowser, onNavigate: () => void): void {
  browser.on('Page.navigate', () => {
    queueMicrotask(onNavigate)
    return { frameId: 'F1' }
  })
}

describe('the CDP pipe (M81)', () => {
  it('reads messages split across chunks and several in one, and skips what is not a message', async () => {
    const browser = new FakeBrowser()
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
    const browser = new FakeBrowser()
    browser.on('Page.navigate', () => new Error('Cannot navigate'))
    browser.on('Page.reload', () => HOLD)
    const connection = new CdpConnection(browser.writer, browser.reader, 64)
    await expect(connection.send('Page.navigate')).rejects.toThrow('Cannot navigate')
    const waiting = connection.send('Page.reload')
    browser.raw(Buffer.alloc(65, 'a'))
    await expect(waiting).rejects.toThrow('larger than the check accepts')
    await expect(connection.send('Page.enable')).rejects.toThrow('larger than the check accepts')
  })
})

describe('a browser check (M81)', () => {
  it('starts the system browser over the pipe in a fresh profile, and removes it afterwards', async () => {
    const browser = new FakeBrowser()
    const t = setup(browser)
    const result = await runBrowserCheck(t.deps, request())
    expect(result.ok).toBe(true)
    expect(t.spawned).toHaveLength(1)
    const args = t.spawned[0]?.args ?? []
    expect(args).toContain('--remote-debugging-pipe')
    expect(args.filter((arg) => arg.includes('remote-debugging-port'))).toEqual([])
    expect(args).toContain(`--user-data-dir=${PROFILE}`)
    // Asked to close when the check came to its own end; never killed.
    expect(browser.calls('Browser.close')).toHaveLength(1)
    expect(browser.kills).toBe(0)
    expect(t.removed).toEqual([PROFILE])
  })

  it('puts the request gate on the browser itself before the page exists', async () => {
    const browser = new FakeBrowser()
    await runBrowserCheck(setup(browser).deps, request())
    const order = browser.sent.map((message) => message.method)
    expect(order.indexOf('Fetch.enable')).toBeLessThan(order.indexOf('Target.createTarget'))
    expect(browser.calls('Fetch.enable')[0]).toMatchObject({
      params: { patterns: [{ urlPattern: '*' }] },
    })
    expect(browser.calls('Fetch.enable')[0]?.sessionId).toBeUndefined()
    expect(browser.calls('Page.navigate')[0]).toMatchObject({
      params: { url: PAGE },
      sessionId: SESSION,
    })
  })

  it('fails every request beyond loopback, redirects and other targets included, and never looks a name up', async () => {
    const browser = new FakeBrowser()
    scriptPage(browser, () => {
      browser.paused('r1', PAGE)
      browser.paused('r2', 'http://127.0.0.1:3000/app.js')
      browser.paused('r3', 'ws://localhost:3000/hmr')
      // A subresource, the redirect a loopback request was sent to, a name
      // that may well resolve to loopback, the metadata address.
      browser.paused('r4', 'http://192.168.1.20/x.png')
      browser.paused('r5', `${HTTP}//evil.example/redirected`)
      browser.paused('r6', `${HTTP}//lvh.me:3000/`)
      browser.paused('r7', 'http://169.254.169.254/latest/meta-data/')
      browser.paused('r8', 'chrome-extension://abc/x.js')
      browser.paused('r4', 'http://192.168.1.20/x.png')
      browser.emit('Page.loadEventFired', {})
    })
    const result = await runBrowserCheck(setup(browser).deps, request())
    const continued = browser.calls('Fetch.continueRequest').map((call) => call.params['requestId'])
    const failed = browser.calls('Fetch.failRequest')
    expect(continued).toEqual(['r1', 'r2', 'r3'])
    expect(failed.map((call) => call.params['requestId'])).toEqual([
      'r4',
      'r5',
      'r6',
      'r7',
      'r8',
      'r4',
    ])
    expect(failed.every((call) => call.params['errorReason'] === 'BlockedByClient')).toBe(true)
    // Answered on the browser's own session, where the gate is.
    expect(failed.every((call) => call.sessionId === undefined)).toBe(true)
    expect(result).toMatchObject({
      ok: true,
      report: {
        blockedRequests: {
          shown: [
            'http://192.168.1.20/x.png',
            `${HTTP}//evil.example/redirected`,
            `${HTTP}//lvh.me:3000/`,
            'http://169.254.169.254/latest/meta-data/',
          ],
          more: 0,
        },
      },
    })
  })

  it('lets through the hosts this check may reach, and those only', async () => {
    const browser = new FakeBrowser(`${HTTP}//dev.example.com/`)
    scriptPage(browser, () => {
      browser.paused('r1', `${HTTP}//dev.example.com/`)
      browser.paused('r2', `${HTTP}//cdn.dev.example.com/x.js`)
      browser.emit('Page.loadEventFired', {})
    })
    const t = setup(browser)
    await runBrowserCheck(
      t.deps,
      request({ url: `${HTTP}//dev.example.com/`, allowedHosts: ['dev.example.com'] }),
    )
    expect(browser.calls('Fetch.continueRequest').map((call) => call.params['requestId'])).toEqual([
      'r1',
    ])
    expect(browser.calls('Fetch.failRequest').map((call) => call.params['requestId'])).toEqual([
      'r2',
    ])
    // The proxy that does not exist is bypassed for that host too.
    expect(t.spawned[0]?.args).toContain(
      '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1/8;[::1];dev.example.com',
    )
  })

  it('reads back the console errors, the failed requests and a screenshot', async () => {
    const browser = new FakeBrowser()
    scriptPage(browser, () => {
      browser.emit('Network.requestWillBeSent', {
        requestId: 'n1',
        request: { url: 'http://localhost:3000/missing.json' },
      })
      browser.emit('Network.responseReceived', {
        requestId: 'n1',
        response: { url: 'http://localhost:3000/missing.json', status: 404 },
      })
      browser.emit('Network.requestWillBeSent', {
        requestId: 'n2',
        request: { url: 'http://localhost:4000/api' },
      })
      browser.emit('Network.loadingFailed', {
        requestId: 'n2',
        errorText: 'net::ERR_CONNECTION_REFUSED',
      })
      // The check's own block is reported once, as blocked, never as failed.
      browser.emit('Network.requestWillBeSent', {
        requestId: 'n3',
        request: { url: 'http://10.0.0.1/' },
      })
      browser.emit('Network.loadingFailed', {
        requestId: 'n3',
        errorText: 'net::ERR_BLOCKED_BY_CLIENT.Inspector',
        blockedReason: 'inspector',
      })
      browser.emit('Network.loadingFailed', {
        requestId: 'n2',
        errorText: 'net::ERR_ABORTED',
        canceled: true,
      })
      browser.emit('Runtime.consoleAPICalled', {
        type: 'error',
        args: [
          { type: 'string', value: 'fixture console error' },
          { type: 'object', description: 'Object' },
          { type: 'number', value: 7 },
        ],
      })
      browser.emit('Runtime.consoleAPICalled', {
        type: 'log',
        args: [{ type: 'string', value: 'not an error' }],
      })
      browser.emit('Runtime.exceptionThrown', {
        exceptionDetails: {
          text: 'Uncaught',
          exception: { description: 'TypeError: x is undefined' },
        },
      })
      // Another session's events are not this page's.
      browser.emit(
        'Runtime.consoleAPICalled',
        { type: 'error', args: [{ type: 'string', value: 'elsewhere' }] },
        'S2',
      )
      browser.emit('Page.loadEventFired', {})
    })
    const result = await runBrowserCheck(setup(browser).deps, request())
    expect(result).toEqual({
      ok: true,
      report: {
        finalUrl: PAGE,
        consoleErrors: {
          shown: ['fixture console error Object 7', 'TypeError: x is undefined'],
          more: 0,
        },
        failedRequests: {
          shown: [
            'http://localhost:3000/missing.json (HTTP 404)',
            'http://localhost:4000/api (net::ERR_CONNECTION_REFUSED)',
          ],
          more: 0,
        },
        blockedRequests: { shown: [], more: 0 },
        screenshot: { png: new Uint8Array(Buffer.from(PNG_BASE64, 'base64')), width: 1, height: 1 },
      },
    })
  })

  it('keeps at most twenty entries of a kind, each cut to length, and counts the rest', async () => {
    const browser = new FakeBrowser()
    scriptPage(browser, () => {
      for (let index = 0; index < 25; index += 1) {
        browser.emit('Runtime.consoleAPICalled', {
          type: 'error',
          args: [{ type: 'string', value: `${String(index)} ${'x'.repeat(600)}` }],
        })
      }
      browser.emit('Page.loadEventFired', {})
    })
    const result = await runBrowserCheck(setup(browser).deps, request())
    if (!result.ok) {
      throw new Error('expected a report')
    }
    expect(result.report.consoleErrors.shown).toHaveLength(20)
    expect(result.report.consoleErrors.more).toBe(5)
    expect(result.report.consoleErrors.shown[0]).toHaveLength(501)
    expect(result.report.consoleErrors.shown[0]?.endsWith('…')).toBe(true)
  })

  it('leaves the screenshot out when the caller asked for text only', async () => {
    const browser = new FakeBrowser()
    const result = await runBrowserCheck(setup(browser).deps, request({ includeScreenshot: false }))
    expect(result).toMatchObject({ ok: true, report: { screenshot: undefined } })
    expect(browser.calls('Page.captureScreenshot')).toEqual([])
  })

  it('runs the click and type steps in order, the selector and text passed as data', async () => {
    const browser = new FakeBrowser()
    await runBrowserCheck(
      setup(browser).deps,
      request({
        actions: [
          { kind: 'type', selector: 'input[name="q"]', text: 'hi "there"\n' },
          { kind: 'click', selector: '#go' },
        ],
      }),
    )
    const steps = browser.calls('Runtime.evaluate')
    expect(steps).toHaveLength(2)
    expect(steps[0]?.sessionId).toBe(SESSION)
    expect(steps[0]?.params['expression']).toContain(
      String.raw`("type", "input[name=\"q\"]", "hi \"there\"\n")`,
    )
    expect(steps[1]?.params['expression']).toContain(`("click", "#go", "")`)
  })

  it('stops at a step whose selector matches nothing, or whose script threw', async () => {
    for (const answer of [
      { result: { type: 'string', value: 'missing' } },
      { result: { type: 'object' }, exceptionDetails: { text: 'SyntaxError' } },
    ]) {
      const browser = new FakeBrowser()
      browser.on('Runtime.evaluate', () => answer)
      const result = await runBrowserCheck(
        setup(browser).deps,
        request({
          actions: [
            { kind: 'click', selector: '#nope' },
            { kind: 'click', selector: '#b' },
          ],
        }),
      )
      expect(result).toEqual({ ok: false, failure: { kind: 'noElement', selector: '#nope' } })
      expect(browser.calls('Runtime.evaluate')).toHaveLength(1)
      expect(browser.calls('Browser.close')).toHaveLength(1)
    }
  })

  it('says why the page did not load, and that a block stopped it', async () => {
    for (const [errorText, failure] of [
      [
        'net::ERR_CONNECTION_REFUSED',
        { kind: 'pageFailed', detail: 'net::ERR_CONNECTION_REFUSED' },
      ],
      ['net::ERR_BLOCKED_BY_CLIENT', { kind: 'pageBlocked' }],
    ] as const) {
      const browser = new FakeBrowser()
      browser.on('Page.navigate', () => ({ frameId: 'F1', errorText }))
      const t = setup(browser)
      expect(await runBrowserCheck(t.deps, request())).toEqual({ ok: false, failure })
      expect(t.removed).toEqual([PROFILE])
    }
  })

  it('stops at once, kills the browser and hands back nothing when anything beyond the allowed hosts answers', async () => {
    for (const leak of [
      (browser: FakeBrowser) => {
        browser.emit('Network.responseReceived', {
          requestId: 'n9',
          response: { url: 'http://10.0.0.9/secret', status: 200 },
        })
      },
      (browser: FakeBrowser) => {
        browser.emit('Network.requestWillBeSent', {
          requestId: 'n9',
          request: { url: 'http://localhost:3000/next' },
          redirectResponse: { url: 'http://10.0.0.9/moved' },
        })
      },
      (browser: FakeBrowser) => {
        browser.emit('Network.webSocketCreated', { requestId: 'w1', url: 'ws://10.0.0.9/socket' })
        browser.emit('Network.webSocketHandshakeResponseReceived', {
          requestId: 'w1',
          response: { status: 101 },
        })
      },
    ]) {
      const browser = new FakeBrowser()
      browser.on('Target.getTargetInfo', () => HOLD)
      scriptPage(browser, () => {
        browser.emit('Page.loadEventFired', {})
        leak(browser)
      })
      const t = setup(browser)
      expect(await runBrowserCheck(t.deps, request())).toEqual({
        ok: false,
        failure: { kind: 'leaked' },
      })
      expect(browser.kills).toBe(1)
      expect(browser.calls('Page.captureScreenshot')).toEqual([])
      expect(t.removed).toEqual([PROFILE])
    }
  })

  it('reports a WebSocket beyond loopback as blocked, and an answer a service worker made itself as no leak', async () => {
    const browser = new FakeBrowser()
    scriptPage(browser, () => {
      browser.emit('Network.webSocketCreated', { requestId: 'w1', url: 'ws://10.0.0.9/socket' })
      browser.emit('Network.webSocketCreated', { requestId: 'w2', url: 'ws://localhost:3000/hmr' })
      browser.emit('Network.webSocketHandshakeResponseReceived', {
        requestId: 'w2',
        response: { status: 101 },
      })
      browser.emit('Network.responseReceived', {
        requestId: 'n1',
        response: { url: 'http://10.0.0.9/cached', status: 200, fromServiceWorker: true },
      })
      browser.emit('Page.loadEventFired', {})
    })
    const result = await runBrowserCheck(setup(browser).deps, request())
    expect(result).toMatchObject({
      ok: true,
      report: { blockedRequests: { shown: ['ws://10.0.0.9/socket'], more: 0 } },
    })
  })

  it('goes on with a page that never finishes loading, as it stands', async () => {
    const browser = new FakeBrowser()
    const result = await runBrowserCheck(setup(browser).deps, request())
    expect(result.ok).toBe(true)
  })

  it('kills the browser at its deadline and removes the profile', async () => {
    const browser = new FakeBrowser()
    browser.on('Page.navigate', () => HOLD)
    const t = setup(browser, {
      timings: { checkMs: 30, loadMs: 10, settleMs: 10, closeGraceMs: 20 },
    })
    expect(await runBrowserCheck(t.deps, request())).toEqual({
      ok: false,
      failure: { kind: 'timedOut' },
    })
    expect(browser.kills).toBe(1)
    expect(browser.calls('Browser.close')).toEqual([])
    expect(t.removed).toEqual([PROFILE])
  })

  it('kills the browser when its caller stops it, and starts nothing for a caller already gone', async () => {
    const browser = new FakeBrowser()
    browser.on('Page.navigate', () => HOLD)
    const stop = new AbortController()
    const t = setup(browser)
    const checking = runBrowserCheck(t.deps, request({ signal: stop.signal }))
    await vi.waitFor(() => {
      expect(browser.calls('Page.navigate')).toHaveLength(1)
    })
    stop.abort()
    expect(await checking).toEqual({ ok: false, failure: { kind: 'cancelled' } })
    expect(browser.kills).toBe(1)
    expect(t.removed).toEqual([PROFILE])

    const late = setup(new FakeBrowser())
    expect(await runBrowserCheck(late.deps, request({ signal: AbortSignal.abort() }))).toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
    })
    expect(late.spawned).toEqual([])
    expect(late.created()).toBe(0)
  })

  it('kills a browser that will not close when asked', async () => {
    const browser = new FakeBrowser()
    browser.on('Browser.close', () => ({}))
    const result = await runBrowserCheck(setup(browser).deps, request())
    expect(result.ok).toBe(true)
    expect(browser.calls('Browser.close')).toHaveLength(1)
    expect(browser.kills).toBe(1)
  })

  it('reports a browser that went away mid-check', async () => {
    const browser = new FakeBrowser()
    scriptPage(browser, () => {
      browser.end()
    })
    expect(await runBrowserCheck(setup(browser).deps, request())).toEqual({
      ok: false,
      failure: { kind: 'browserFailed', detail: 'the browser closed the debugging pipe' },
    })
  })

  it('refuses a screenshot that is not a PNG', async () => {
    const browser = new FakeBrowser()
    browser.on('Page.captureScreenshot', () => ({ data: Buffer.from('GIF89a').toString('base64') }))
    expect(await runBrowserCheck(setup(browser).deps, request())).toMatchObject({
      ok: false,
      failure: { kind: 'browserFailed' },
    })
  })

  it('says so when no browser is installed, and starts nothing', async () => {
    const t = setup(new FakeBrowser(), { findExecutable: () => undefined })
    expect(await runBrowserCheck(t.deps, request())).toEqual({
      ok: false,
      failure: { kind: 'noBrowser' },
    })
    expect(t.created()).toBe(0)
    expect(t.spawned).toEqual([])
  })

  it('removes the profile when the browser cannot start, and reports a profile it could not remove', async () => {
    const t = setup(new FakeBrowser(), {
      spawn: () => {
        throw new Error('spawn EACCES')
      },
    })
    expect(await runBrowserCheck(t.deps, request())).toEqual({
      ok: false,
      failure: { kind: 'browserFailed', detail: 'spawn EACCES' },
    })
    expect(t.removed).toEqual([PROFILE])

    const stuck = setup(new FakeBrowser(), {
      removeProfile: () => Promise.reject(new Error('EBUSY')),
    })
    const kept = await runBrowserCheck(stuck.deps, request())
    expect(kept.ok).toBe(true)
    expect(stuck.left).toEqual([PROFILE])
  })
})
