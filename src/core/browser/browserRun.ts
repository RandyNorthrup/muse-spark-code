// One browser check (M81, PLAN.md D49): a system Chrome or Edge started
// headless over `--remote-debugging-pipe` in a fresh temporary profile,
// the page opened, the click and type steps run, then the console errors,
// the failed requests and a screenshot read back, and the browser and its
// profile gone again whatever happened.
//
// A request beyond loopback is blocked twice. The Fetch domain is enabled
// on the browser itself, not on the page, so it pauses every request any
// target makes (the page, its frames in other processes, its workers and
// service workers, every redirect), and each is failed unless it is http(s)
// to loopback or a host this check may reach; the host is compared by name,
// never looked up. What Fetch cannot see (a WebSocket, a preconnect, the
// browser's own traffic) goes to the proxy that does not exist
// (browserLaunch.ts). Should anything from beyond those hosts still answer
// the page (an administrator's policy can replace the proxy), the check
// stops at once and hands back nothing from the page.
//
// The check ends at its deadline, when its caller stops it (Stop, the
// session or the window closing), or when the browser goes away; the
// browser is then killed, with everything it started. Pure: the browser,
// the profile folder and the clock's bounds are injected.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  BROWSER_CHECK_ACTION_SETTLE_MS,
  BROWSER_CHECK_CLOSE_GRACE_MS,
  BROWSER_CHECK_ENTRY_MAX_CHARS,
  BROWSER_CHECK_LOAD_TIMEOUT_MS,
  BROWSER_CHECK_MAX_ENTRIES,
  BROWSER_CHECK_TIMEOUT_MS,
  HTTP_STATUS,
  MAX_IMAGE_BYTES,
  PNG_MEDIA_TYPE,
} from '../../shared/constants'
import { readImageInfo } from '../imageDimensions'
import { browserLaunchArgs } from './browserLaunch'
import { isAllowedRequest, isNetworkUrl } from './browserPolicy'
import { CdpConnection, CdpError, type CdpEvent, type PipeReader, type PipeWriter } from './cdpPipe'

/** One click or type step, as the call's arguments gave it. */
export interface BrowserAction {
  readonly kind: 'click' | 'type'
  readonly selector: string
  /** The text a type step types; absent for a click. */
  readonly text?: string | undefined
}

export interface BrowserCheckRequest {
  /** The URL to open, placed by `browserPolicy` before any card. */
  readonly url: string
  readonly actions: readonly BrowserAction[]
  /**
   * The hosts beyond loopback this check may reach: the user's setting, and
   * the one an approval card widened for this call. Never the model's.
   */
  readonly allowedHosts: readonly string[]
  /** False for Muse Code, until a capture shows an `ide` tool's image reaches its model. */
  readonly includeScreenshot: boolean
  readonly signal: AbortSignal
}

/** Up to BROWSER_CHECK_MAX_ENTRIES entries of one kind, and how many more there were. */
export interface BrowserEntries {
  readonly shown: readonly string[]
  readonly more: number
}

export interface BrowserCheckReport {
  /** Where the page ended up, as the browser says: data from the page. */
  readonly finalUrl: string
  readonly consoleErrors: BrowserEntries
  /** `url (reason)`: a network error, or an HTTP status of 400 or more. */
  readonly failedRequests: BrowserEntries
  /** Requests beyond loopback the check failed. */
  readonly blockedRequests: BrowserEntries
  /** A PNG, read and measured, when the request asked for one. */
  readonly screenshot: BrowserScreenshot | undefined
}

export interface BrowserScreenshot {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
}

export type BrowserFailure =
  | { readonly kind: 'noBrowser' | 'pageBlocked' | 'timedOut' | 'leaked' | 'cancelled' }
  | { readonly kind: 'browserFailed' | 'pageFailed'; readonly detail: string }
  | { readonly kind: 'noElement'; readonly selector: string }

export type BrowserCheckResult =
  | { readonly ok: true; readonly report: BrowserCheckReport }
  | { readonly ok: false; readonly failure: BrowserFailure }

/** What runs a check: the host's browser bundle, loaded on the first call. */
export type BrowserChecker = (request: BrowserCheckRequest) => Promise<BrowserCheckResult>

/** A started browser: the two pipe ends, its exit, and a kill for it and all it started. */
export interface BrowserProcess {
  readonly writer: PipeWriter
  readonly reader: PipeReader
  /** Resolves once the browser has exited (or never started). */
  readonly exited: Promise<void>
  /** Ends the browser and everything it started, at once. */
  kill(): Promise<void>
}

export interface BrowserTimings {
  readonly checkMs: number
  readonly loadMs: number
  readonly settleMs: number
  readonly closeGraceMs: number
}

export interface BrowserRunDeps {
  /** The system Chrome or Edge, found anew for each check; undefined when none is installed. */
  readonly findExecutable: () => string | undefined
  /** A fresh, empty folder for the profile; never the user's. */
  readonly createProfile: () => Promise<string>
  readonly removeProfile: (directory: string) => Promise<void>
  readonly spawn: (executable: string, args: readonly string[]) => BrowserProcess
  /** A profile folder that could not be removed: reported, the check's result stands. */
  readonly onProfileLeft: (directory: string, error: unknown) => void
  /** The constants' bounds unless a test shortens them. */
  readonly timings?: Partial<BrowserTimings>
}

const DEFAULT_TIMINGS: BrowserTimings = {
  checkMs: BROWSER_CHECK_TIMEOUT_MS,
  loadMs: BROWSER_CHECK_LOAD_TIMEOUT_MS,
  settleMs: BROWSER_CHECK_ACTION_SETTLE_MS,
  closeGraceMs: BROWSER_CHECK_CLOSE_GRACE_MS,
}

// The shapes read off the protocol (Chrome 150 and Edge 154, probed over
// the pipe on the test rigs, docs/certification/m81.md).
const targetSchema = z.object({ targetId: z.string() })
const attachedSchema = z.object({ sessionId: z.string() })
const navigatedSchema = z.object({ errorText: z.optional(z.string()) })
const targetInfoSchema = z.object({ targetInfo: z.object({ url: z.string() }) })
const evaluatedSchema = z.object({
  result: z.object({ value: z.optional(z.unknown()) }),
  exceptionDetails: z.optional(z.unknown()),
})
const screenshotSchema = z.object({ data: z.string() })
const pausedSchema = z.object({ requestId: z.string(), request: z.object({ url: z.string() }) })
const requestSchema = z.object({
  requestId: z.string(),
  request: z.object({ url: z.string() }),
  redirectResponse: z.optional(z.object({ url: z.string() })),
})
const responseSchema = z.object({
  requestId: z.string(),
  response: z.object({
    url: z.string(),
    status: z.number(),
    fromServiceWorker: z.optional(z.boolean()),
  }),
})
const loadingFailedSchema = z.object({
  requestId: z.string(),
  errorText: z.string(),
  canceled: z.optional(z.boolean()),
  blockedReason: z.optional(z.string()),
})
const socketSchema = z.object({ requestId: z.string(), url: z.string() })
const handshakeSchema = z.object({ requestId: z.string() })
const consoleSchema = z.object({ type: z.string(), args: z.array(z.unknown()) })
const remoteObjectSchema = z.object({
  type: z.optional(z.string()),
  value: z.optional(z.unknown()),
  description: z.optional(z.string()),
})
const exceptionSchema = z.object({
  exceptionDetails: z.object({
    text: z.string(),
    exception: z.optional(z.object({ description: z.optional(z.string()) })),
  }),
})

// Console calls the check reports: `console.error` and a failed `console.assert`.
const CONSOLE_ERROR_TYPES: ReadonlySet<string> = new Set(['error', 'assert'])
// What a request the check failed itself carries in `Network.loadingFailed`.
const BLOCKED_BY_CHECK = 'inspector'
// Page.navigate's error when the check failed the page's own request.
const NAVIGATION_BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT'
const STEP_DONE = 'done'
const STEP_MISSING = 'missing'
const CLIPPED = '…'
// The page side of one step, in the page's own words: the element, then a
// click, or the text set through the native value setter (so a framework
// that watches the property sees it) and announced as input.
const STEP_SCRIPT = `(kind, selector, text) => {
  const element = document.querySelector(selector)
  if (element === null) return '${STEP_MISSING}'
  if (kind === 'click') { element.click(); return '${STEP_DONE}' }
  element.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
  if (setter === undefined) return '${STEP_MISSING}'
  setter.call(element, text)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  return '${STEP_DONE}'
}`

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ignore(): void {
  // A call whose answer no longer matters: the check has ended.
}

/** Entries of one kind, kept up to the bound and cut to length; the rest are counted. */
class EntryList {
  private readonly entries: string[] = []
  private extra = 0

  public constructor(private readonly isDistinct: boolean) {}

  public add(text: string): void {
    const entry =
      text.length > BROWSER_CHECK_ENTRY_MAX_CHARS
        ? `${text.slice(0, BROWSER_CHECK_ENTRY_MAX_CHARS)}${CLIPPED}`
        : text
    if (this.isDistinct && this.entries.includes(entry)) {
      return
    }
    if (this.entries.length < BROWSER_CHECK_MAX_ENTRIES) {
      this.entries.push(entry)
      return
    }
    this.extra += 1
  }

  public get value(): BrowserEntries {
    return { shown: [...this.entries], more: this.extra }
  }
}

/** A console argument in words: its value, else its description, else its type. */
function consoleArgText(argument: unknown): string {
  const parsed = remoteObjectSchema.safeParse(argument)
  if (!parsed.success) {
    return ''
  }
  const { value, description, type } = parsed.data
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : (description ?? type ?? '')
}

/** Whether the browser exits within `ms`. */
async function hasExitedWithin(exited: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false)
    }, ms)
  })
  const gone = (async (): Promise<boolean> => {
    await exited
    return true
  })()
  try {
    return await Promise.race([gone, late])
  } finally {
    clearTimeout(timer)
  }
}

// Ends after which the browser is killed at once rather than asked to close:
// it is unresponsive, out of time, stopped by its caller, or leaking.
const ABRUPT_ENDS: ReadonlySet<BrowserFailure['kind']> = new Set([
  'browserFailed',
  'timedOut',
  'cancelled',
  'leaked',
])

/** Whether the check came to its own end, so the browser may close itself. */
function isGracefulEnd(result: BrowserCheckResult | undefined): boolean {
  return result !== undefined && (result.ok || !ABRUPT_ENDS.has(result.failure.kind))
}

/**
 * The browser gone: asked to close when the check came to its own end,
 * killed at once otherwise, and killed anyway if it is still there after
 * the grace.
 */
async function stopBrowser(
  browser: BrowserProcess,
  connection: CdpConnection,
  isGraceful: boolean,
  graceMs: number,
): Promise<void> {
  if (isGraceful && connection.closedBy === undefined) {
    void connection.send('Browser.close').catch(ignore)
    if (await hasExitedWithin(browser.exited, graceMs)) {
      return
    }
  }
  await browser.kill()
  await hasExitedWithin(browser.exited, graceMs)
}

/** The page's session: its events, the request gate, and the steps of the check. */
class PageCheck {
  private readonly allowed: ReadonlySet<string>
  private readonly consoleErrors = new EntryList(false)
  private readonly failedRequests = new EntryList(true)
  private readonly blockedRequests = new EntryList(true)
  private readonly requestUrls = new Map<string, string>()
  private readonly socketUrls = new Map<string, string>()
  private readonly loadWaiters = new Set<() => void>()
  private sessionId: string | undefined
  private loads = 0

  public constructor(
    private readonly connection: CdpConnection,
    private readonly request: BrowserCheckRequest,
    private readonly timings: BrowserTimings,
    /** Ends the whole check at once with this failure. */
    private readonly end: (failure: BrowserFailure) => void,
  ) {
    this.allowed = new Set(request.allowedHosts)
    connection.onEvent((event) => {
      this.onEvent(event)
    })
    connection.onClose(() => {
      this.wakeLoadWaiters()
    })
  }

  private onEvent(event: CdpEvent): void {
    if (event.method === 'Fetch.requestPaused') {
      this.gate(event)
      return
    }
    if (this.sessionId === undefined || event.sessionId !== this.sessionId) {
      return
    }
    switch (event.method) {
      case 'Page.loadEventFired': {
        this.loads += 1
        this.wakeLoadWaiters()
        break
      }
      case 'Network.requestWillBeSent': {
        const sent = requestSchema.safeParse(event.params)
        if (!sent.success) {
          break
        }
        this.requestUrls.set(sent.data.requestId, sent.data.request.url)
        // A redirect is an answer too: one from beyond the allowed hosts is a leak.
        const redirect = sent.data.redirectResponse?.url
        if (redirect !== undefined && this.isBeyondAllowed(redirect)) {
          this.end({ kind: 'leaked' })
        }
        break
      }
      case 'Network.responseReceived': {
        this.onResponse(event.params)
        break
      }
      case 'Network.loadingFailed': {
        this.onLoadingFailed(event.params)
        break
      }
      case 'Network.webSocketCreated': {
        const socket = socketSchema.safeParse(event.params)
        if (socket.success) {
          this.socketUrls.set(socket.data.requestId, socket.data.url)
          if (this.isBeyondAllowed(socket.data.url)) {
            // The proxy that does not exist refuses it (browserLaunch.ts).
            this.blockedRequests.add(socket.data.url)
          }
        }
        break
      }
      case 'Network.webSocketHandshakeResponseReceived': {
        const handshake = handshakeSchema.safeParse(event.params)
        const url = handshake.success ? this.socketUrls.get(handshake.data.requestId) : undefined
        if (url !== undefined && this.isBeyondAllowed(url)) {
          this.end({ kind: 'leaked' })
        }
        break
      }
      case 'Runtime.consoleAPICalled': {
        const called = consoleSchema.safeParse(event.params)
        if (called.success && CONSOLE_ERROR_TYPES.has(called.data.type)) {
          this.consoleErrors.add(
            called.data.args.map((argument) => consoleArgText(argument)).join(' '),
          )
        }
        break
      }
      case 'Runtime.exceptionThrown': {
        const thrown = exceptionSchema.safeParse(event.params)
        if (thrown.success) {
          const { text, exception } = thrown.data.exceptionDetails
          this.consoleErrors.add(exception?.description ?? text)
        }
        break
      }
      default: {
        break
      }
    }
  }

  /** Every paused request: on to loopback or an allowed host, failed otherwise. */
  private gate(event: CdpEvent): void {
    const paused = pausedSchema.safeParse(event.params)
    if (!paused.success) {
      return
    }
    const { requestId, request } = paused.data
    if (isAllowedRequest(request.url, this.allowed)) {
      void this.connection
        .send('Fetch.continueRequest', { requestId }, event.sessionId)
        .catch(ignore)
      return
    }
    if (isNetworkUrl(request.url)) {
      this.blockedRequests.add(request.url)
    }
    void this.connection
      .send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, event.sessionId)
      .catch(ignore)
  }

  private onResponse(params: unknown): void {
    const received = responseSchema.safeParse(params)
    if (!received.success) {
      return
    }
    const { url, status, fromServiceWorker } = received.data.response
    // A service worker's own requests pass the gate like any other; what it
    // answers from itself never left the browser.
    if (fromServiceWorker !== true && this.isBeyondAllowed(url)) {
      this.end({ kind: 'leaked' })
      return
    }
    if (status >= HTTP_STATUS.badRequest) {
      this.failedRequests.add(`${url} (HTTP ${String(status)})`)
    }
  }

  private onLoadingFailed(params: unknown): void {
    const failed = loadingFailedSchema.safeParse(params)
    if (
      !failed.success ||
      failed.data.blockedReason === BLOCKED_BY_CHECK ||
      failed.data.canceled === true
    ) {
      return
    }
    const url = this.requestUrls.get(failed.data.requestId)
    if (url !== undefined && isNetworkUrl(url)) {
      this.failedRequests.add(`${url} (${failed.data.errorText})`)
    }
  }

  /** A network URL to a host the check may not reach. */
  private isBeyondAllowed(url: string): boolean {
    return isNetworkUrl(url) && !isAllowedRequest(url, this.allowed)
  }

  private wakeLoadWaiters(): void {
    // A waiter that finishes takes itself out of the set; iteration allows it.
    for (const wake of this.loadWaiters) {
      wake()
    }
  }

  /** Until the page's next load event, at most `ms`; at once when the connection ends. */
  private waitForLoad(ms: number): Promise<void> {
    const seen = this.loads
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        if (this.loads > seen || this.connection.closedBy !== undefined) {
          finish()
        }
      }
      const timer = setTimeout(() => {
        finish()
      }, ms)
      const finish = (): void => {
        clearTimeout(timer)
        this.loadWaiters.delete(wake)
        resolve()
      }
      this.loadWaiters.add(wake)
    })
  }

  private async call<T>(
    method: string,
    schema: z.ZodMiniType<T>,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<T> {
    const parsed = schema.safeParse(await this.connection.send(method, params, sessionId))
    if (!parsed.success) {
      throw new CdpError(`${method} answered in an unexpected shape`)
    }
    return parsed.data
  }

  /** The check itself, start to screenshot. Rejects when the browser fails it. */
  public async run(): Promise<BrowserCheckResult> {
    const nothing = z.object({})
    // The gate goes up on the browser before the page exists.
    await this.call('Fetch.enable', nothing, { patterns: [{ urlPattern: '*' }] })
    const { targetId } = await this.call('Target.createTarget', targetSchema, {
      url: 'about:blank',
    })
    const { sessionId } = await this.call('Target.attachToTarget', attachedSchema, {
      targetId,
      flatten: true,
    })
    this.sessionId = sessionId
    for (const domain of ['Page', 'Runtime', 'Network']) {
      await this.call(`${domain}.enable`, nothing, {}, sessionId)
    }
    const loaded = this.waitForLoad(this.timings.loadMs)
    const navigated = await this.call(
      'Page.navigate',
      navigatedSchema,
      { url: this.request.url },
      sessionId,
    )
    if (navigated.errorText !== undefined) {
      return {
        ok: false,
        failure:
          navigated.errorText === NAVIGATION_BLOCKED
            ? { kind: 'pageBlocked' }
            : { kind: 'pageFailed', detail: navigated.errorText },
      }
    }
    // A page still loading at the bound is read as it stands.
    await loaded
    for (const action of this.request.actions) {
      const settled = this.waitForLoad(this.timings.settleMs)
      const stepped = await this.call(
        'Runtime.evaluate',
        evaluatedSchema,
        {
          expression: `(${STEP_SCRIPT})(${JSON.stringify(action.kind)}, ${JSON.stringify(action.selector)}, ${JSON.stringify(action.text ?? '')})`,
          returnByValue: true,
        },
        sessionId,
      )
      if (stepped.exceptionDetails !== undefined || stepped.result.value !== STEP_DONE) {
        return { ok: false, failure: { kind: 'noElement', selector: action.selector } }
      }
      await settled
    }
    const { targetInfo } = await this.call('Target.getTargetInfo', targetInfoSchema, { targetId })
    let screenshot: BrowserScreenshot | undefined
    if (this.request.includeScreenshot) {
      const shot = await this.call(
        'Page.captureScreenshot',
        screenshotSchema,
        { format: 'png' },
        sessionId,
      )
      const png = new Uint8Array(Buffer.from(shot.data, 'base64'))
      const info = readImageInfo(png)
      if (png.length > MAX_IMAGE_BYTES || info?.mediaType !== PNG_MEDIA_TYPE) {
        throw new CdpError('the screenshot is not a PNG within the image limit')
      }
      screenshot = { png, width: info.width, height: info.height }
    }
    return {
      ok: true,
      report: {
        finalUrl: targetInfo.url,
        consoleErrors: this.consoleErrors.value,
        failedRequests: this.failedRequests.value,
        blockedRequests: this.blockedRequests.value,
        screenshot,
      },
    }
  }
}

/** The page's check, or why the browser failed it. */
async function runPage(page: PageCheck): Promise<BrowserCheckResult> {
  try {
    return await page.run()
  } catch (error: unknown) {
    return { ok: false, failure: { kind: 'browserFailed', detail: describe(error) } }
  }
}

/**
 * The check, or the failure that ended it first: the deadline, the
 * caller's stop, the browser going away, or a leak.
 */
async function checkUntilEnded(
  connection: CdpConnection,
  request: BrowserCheckRequest,
  timings: BrowserTimings,
): Promise<BrowserCheckResult> {
  let end: (failure: BrowserFailure) => void = ignore
  const ended = new Promise<BrowserCheckResult>((resolve) => {
    end = (failure) => {
      resolve({ ok: false, failure })
    }
  })
  const timer = setTimeout(() => {
    end({ kind: 'timedOut' })
  }, timings.checkMs)
  const onAbort = (): void => {
    end({ kind: 'cancelled' })
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  const stopWatchingClose = connection.onClose((reason) => {
    end({ kind: 'browserFailed', detail: reason.message })
  })
  const page = new PageCheck(connection, request, timings, (failure) => {
    end(failure)
  })
  let checked = ended
  if (request.signal.aborted) {
    // Stopped while the profile was made or the browser started.
    end({ kind: 'cancelled' })
  } else {
    checked = runPage(page)
  }
  try {
    return await Promise.race([ended, checked])
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', onAbort)
    stopWatchingClose()
  }
}

/** One check, from finding the browser to removing its profile. Never throws. */
export async function runBrowserCheck(
  deps: BrowserRunDeps,
  request: BrowserCheckRequest,
): Promise<BrowserCheckResult> {
  if (request.signal.aborted) {
    return { ok: false, failure: { kind: 'cancelled' } }
  }
  const executable = deps.findExecutable()
  if (executable === undefined) {
    return { ok: false, failure: { kind: 'noBrowser' } }
  }
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings }
  let profile: string
  try {
    profile = await deps.createProfile()
  } catch (error: unknown) {
    return { ok: false, failure: { kind: 'browserFailed', detail: describe(error) } }
  }
  try {
    let browser: BrowserProcess
    try {
      browser = deps.spawn(executable, browserLaunchArgs(profile, request.allowedHosts))
    } catch (error: unknown) {
      return { ok: false, failure: { kind: 'browserFailed', detail: describe(error) } }
    }
    const connection = new CdpConnection(browser.writer, browser.reader)
    let result: BrowserCheckResult | undefined
    try {
      result = await checkUntilEnded(connection, request, timings)
      return result
    } finally {
      await stopBrowser(browser, connection, isGracefulEnd(result), timings.closeGraceMs)
      connection.close(new CdpError('the browser check has ended'))
    }
  } finally {
    try {
      await deps.removeProfile(profile)
    } catch (error: unknown) {
      deps.onProfileLeft(profile, error)
    }
  }
}
