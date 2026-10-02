// One browser check (M81, PLAN.md D49): a system Chrome or Edge started
// headless over `--remote-debugging-pipe` in a fresh temporary profile,
// the page opened, the click and type steps run, then the console errors,
// the failed requests and a screenshot read back, and the browser and its
// profile gone again whatever happened.
//
// A request beyond loopback is blocked twice, and watched for a third time.
// The Fetch domain is enabled on the browser itself, so it pauses every
// request any target makes (the page, its frames in other processes, its
// workers and service workers, every redirect), and each is failed unless it
// is http(s) to loopback or a host this check may reach; the host is
// compared by name, never looked up. What Fetch cannot see (a WebSocket, a
// preconnect, the browser's own traffic) goes to the proxy that does not
// exist (browserLaunch.ts); a machine whose administrator's policy could
// replace that proxy is refused before any browser starts
// (browserManagedPolicy.ts). And every target is watched: the browser and
// each target it attaches attach every target they start, each held before
// its first line runs until its Network events (and Fetch, where it has the
// domain) are on, so a WebSocket beyond those hosts, or any answer from
// beyond, from the page or any frame or worker, stops the check at once and
// hands back nothing from the page. What a connection sent before the stop
// cannot be taken back (PLAN.md §9).
//
// The check ends at its deadline, when its caller stops it (Stop, the
// session or the window closing), or when the browser goes away; the
// connection is closed at that moment, so nothing more reaches the browser,
// and the browser is then killed, with everything it started. Pure: the
// browser, the profile folder, the policy reads and the clock's bounds are
// injected.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  BROWSER_CHECK_ACTION_SETTLE_MS,
  BROWSER_CHECK_CLOSE_GRACE_MS,
  BROWSER_CHECK_LOAD_TIMEOUT_MS,
  BROWSER_CHECK_MAX_ENTRIES,
  BROWSER_CHECK_MAX_TARGETS,
  BROWSER_CHECK_TIMEOUT_MS,
  HTTP_STATUS,
  MAX_IMAGE_BYTES,
  PNG_MEDIA_TYPE,
} from '../../shared/constants'
import { readImageInfo } from '../imageDimensions'
import { browserLaunchArgs } from './browserLaunch'
import type { ManagedPolicyVerdict } from './browserManagedPolicy'
import { isAllowedRequest, isNetworkUrl } from './browserPolicy'
import { CdpConnection, CdpError, type CdpEvent, type PipeReader, type PipeWriter } from './cdpPipe'
import { clipEntry, RequestLog } from './requestLog'

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
  /** An administrator's policy that could override the block; nothing started. */
  | { readonly kind: 'managedPolicy'; readonly where: string }
  /** A policy location that could not be read; nothing started. */
  | { readonly kind: 'policyUnreadable'; readonly where: string; readonly detail: string }

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
  /** Whether an administrator's policy could override the block, read anew for each check. */
  readonly findManagedPolicy: () => Promise<ManagedPolicyVerdict>
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
const attachedSchema = z.object({
  sessionId: z.string(),
  targetInfo: z.object({ targetId: z.string() }),
})
const detachedSchema = z.object({ sessionId: z.string() })
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
const finishedSchema = z.object({ requestId: z.string() })
const loadingFailedSchema = z.object({
  requestId: z.string(),
  errorText: z.string(),
  canceled: z.optional(z.boolean()),
  blockedReason: z.optional(z.string()),
})
// A WebSocket (`requestId`) or a WebTransport (`transportId`): what Fetch cannot pause.
const socketSchema = z.object({ url: z.string() })
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
const nothing = z.object({})

// Every target attached as it starts, held until the check lets it run.
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }
const EVERY_REQUEST = { patterns: [{ urlPattern: '*' }] }
// Console calls the check reports: `console.error` and a failed `console.assert`.
const CONSOLE_ERROR_TYPES: ReadonlySet<string> = new Set(['error', 'assert'])
// What a request the check failed itself carries in `Network.loadingFailed`.
const BLOCKED_BY_CHECK = 'inspector'
// Page.navigate's error when the check failed the page's own request.
const NAVIGATION_BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT'
const STEP_DONE = 'done'
const STEP_MISSING = 'missing'
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
    const entry = clipEntry(text)
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

/** The check's targets: the gate on every request, the watch on every target, and the steps. */
class PageCheck {
  private readonly allowed: ReadonlySet<string>
  private readonly consoleErrors = new EntryList(false)
  private readonly failedRequests = new EntryList(true)
  private readonly blockedRequests = new EntryList(true)
  private readonly requests = new RequestLog()
  /** The sessions watched: the page's, its frames' and workers', and those they start. */
  private readonly watched = new Set<string>()
  /** The session of each target whose watch is up, by target id. */
  private readonly ready = new Map<string, string>()
  private readonly waiters = new Set<() => void>()
  private pageSession: string | undefined
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
      this.wakeWaiters()
    })
  }

  private onEvent(event: CdpEvent): void {
    switch (event.method) {
      case 'Fetch.requestPaused': {
        this.gate(event)
        return
      }
      case 'Target.attachedToTarget': {
        void this.watch(event.params)
        return
      }
      case 'Target.detachedFromTarget': {
        const detached = detachedSchema.safeParse(event.params)
        if (detached.success) {
          this.unwatch(detached.data.sessionId)
        }
        return
      }
      default: {
        break
      }
    }
    const { sessionId } = event
    if (sessionId === undefined || !this.watched.has(sessionId)) {
      return
    }
    this.onNetworkEvent(event, sessionId)
    if (sessionId === this.pageSession) {
      this.onPageEvent(event)
    }
  }

  /**
   * A target attached as it started, held before its first line runs: its
   * Network events on (and Fetch, which a worker does not have: the
   * browser's gate pauses its requests anyway), the targets it starts
   * attached in turn, and only then let run. One whose watch could not be
   * set up, or one past the bound, is never let run.
   */
  private async watch(params: unknown): Promise<void> {
    const attached = attachedSchema.safeParse(params)
    if (!attached.success || this.watched.size >= BROWSER_CHECK_MAX_TARGETS) {
      return
    }
    const { sessionId, targetInfo } = attached.data
    this.watched.add(sessionId)
    try {
      await this.connection.send('Network.enable', {}, sessionId)
      await this.enableFetch(sessionId)
      await this.connection.send('Target.setAutoAttach', AUTO_ATTACH, sessionId)
      await this.connection.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
    } catch {
      return
    }
    // Gone again while its watch went up: nothing of it is kept.
    if (!this.watched.has(sessionId)) {
      return
    }
    this.ready.set(targetInfo.targetId, sessionId)
    this.wakeWaiters()
  }

  /** Fetch on a target's own session, where it has the domain (a worker does not). */
  private async enableFetch(sessionId: string): Promise<void> {
    try {
      await this.connection.send('Fetch.enable', EVERY_REQUEST, sessionId)
    } catch {
      // The browser's own gate pauses this target's requests anyway.
    }
  }

  /** A target gone (a worker ended, a frame removed): its session forgotten. */
  private unwatch(sessionId: string): void {
    this.watched.delete(sessionId)
    for (const [targetId, watchedSession] of this.ready) {
      if (watchedSession === sessionId) {
        this.ready.delete(targetId)
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

  /** Any watched target's traffic: the failed requests, and a way out that ends the check. */
  private onNetworkEvent(event: CdpEvent, sessionId: string): void {
    switch (event.method) {
      case 'Network.requestWillBeSent': {
        const sent = requestSchema.safeParse(event.params)
        if (!sent.success) {
          break
        }
        this.requests.add(sessionId, sent.data.requestId, sent.data.request.url)
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
      case 'Network.loadingFinished': {
        const finished = finishedSchema.safeParse(event.params)
        if (finished.success) {
          this.requests.take(sessionId, finished.data.requestId)
        }
        break
      }
      case 'Network.loadingFailed': {
        this.onLoadingFailed(event.params, sessionId)
        break
      }
      case 'Network.webSocketCreated':
      case 'Network.webTransportCreated': {
        // Fetch cannot hold it back: beyond the allowed hosts, the check ends.
        const socket = socketSchema.safeParse(event.params)
        if (socket.success && this.isBeyondAllowed(socket.data.url)) {
          this.end({ kind: 'leaked' })
        }
        break
      }
      default: {
        break
      }
    }
  }

  /** The page's own events: its loads, and its console. */
  private onPageEvent(event: CdpEvent): void {
    switch (event.method) {
      case 'Page.loadEventFired': {
        this.loads += 1
        this.wakeWaiters()
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

  private onLoadingFailed(params: unknown, sessionId: string): void {
    const failed = loadingFailedSchema.safeParse(params)
    if (!failed.success) {
      return
    }
    const url = this.requests.take(sessionId, failed.data.requestId)
    if (failed.data.blockedReason === BLOCKED_BY_CHECK || failed.data.canceled === true) {
      return
    }
    if (url !== undefined && isNetworkUrl(url)) {
      this.failedRequests.add(`${url} (${failed.data.errorText})`)
    }
  }

  /** A network URL to a host the check may not reach. */
  private isBeyondAllowed(url: string): boolean {
    return isNetworkUrl(url) && !isAllowedRequest(url, this.allowed)
  }

  private wakeWaiters(): void {
    // A waiter that finishes takes itself out of the set; iteration allows it.
    for (const wake of this.waiters) {
      wake()
    }
  }

  /** Until `isDone()` holds, at most `ms`; at once when the connection ends. */
  private waitUntil(isDone: () => boolean, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        if (isDone() || this.connection.closedBy !== undefined) {
          finish()
        }
      }
      const timer = setTimeout(() => {
        finish()
      }, ms)
      const finish = (): void => {
        clearTimeout(timer)
        this.waiters.delete(wake)
        resolve()
      }
      this.waiters.add(wake)
      wake()
    })
  }

  /** Until the page's next load event, at most `ms`. */
  private waitForLoad(ms: number): Promise<void> {
    const seen = this.loads
    return this.waitUntil(() => this.loads > seen, ms)
  }

  /** The session of a target the check created, once its watch is up. */
  private async watchedSession(targetId: string): Promise<string> {
    await this.waitUntil(() => this.ready.has(targetId), this.timings.loadMs)
    const sessionId = this.ready.get(targetId)
    if (sessionId === undefined) {
      throw this.connection.closedBy ?? new CdpError('the page was not attached in time')
    }
    return sessionId
  }

  /** Nothing more is asked of a browser whose check has ended. */
  private ensureOpen(): void {
    const closed = this.connection.closedBy
    if (closed !== undefined) {
      throw closed
    }
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

  /** The page opened and loaded, or why it was not; undefined once it is there. */
  private async open(sessionId: string): Promise<BrowserCheckResult | undefined> {
    for (const domain of ['Page', 'Runtime']) {
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
    return undefined
  }

  /** The click and type steps, in order; the one whose element is missing ends them. */
  private async step(sessionId: string): Promise<BrowserCheckResult | undefined> {
    for (const action of this.request.actions) {
      // Stopped, out of time or leaking: no further step reaches the page.
      this.ensureOpen()
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
    return undefined
  }

  private async screenshot(sessionId: string): Promise<BrowserScreenshot> {
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
    return { png, width: info.width, height: info.height }
  }

  /** The check itself, start to screenshot. Rejects when the browser fails it. */
  public async run(): Promise<BrowserCheckResult> {
    // The gate and the watch go up on the browser before the page exists.
    await this.call('Fetch.enable', nothing, EVERY_REQUEST)
    await this.call('Target.setAutoAttach', nothing, AUTO_ATTACH)
    const { targetId } = await this.call('Target.createTarget', targetSchema, {
      url: 'about:blank',
    })
    const sessionId = await this.watchedSession(targetId)
    this.pageSession = sessionId
    const stopped = (await this.open(sessionId)) ?? (await this.step(sessionId))
    if (stopped !== undefined) {
      return stopped
    }
    this.ensureOpen()
    const { targetInfo } = await this.call('Target.getTargetInfo', targetInfoSchema, { targetId })
    const screenshot = this.request.includeScreenshot ? await this.screenshot(sessionId) : undefined
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
 * caller's stop, the browser going away, or a leak. The first end closes
 * the connection there and then: every call still waiting is rejected and
 * nothing more is sent, before the browser's kill is even started.
 */
async function checkUntilEnded(
  connection: CdpConnection,
  request: BrowserCheckRequest,
  timings: BrowserTimings,
): Promise<BrowserCheckResult> {
  let isEnded = false
  let end: (failure: BrowserFailure) => void = ignore
  // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
  const ended = new Promise<BrowserCheckResult>((resolve) => {
    end = (failure) => {
      if (isEnded) {
        return
      }
      isEnded = true
      resolve({ ok: false, failure })
      connection.close(new CdpError('the browser check has ended'))
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
  const page = new PageCheck(connection, request, timings, end)
  let checked = ended
  if (request.signal.aborted) {
    // Stopped while the policy was read, the profile made or the browser started.
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

/** The machine's policy as a refusal, or undefined when none stands in the way. */
async function policyRefusal(deps: BrowserRunDeps): Promise<BrowserCheckResult | undefined> {
  let verdict: ManagedPolicyVerdict
  try {
    verdict = await deps.findManagedPolicy()
  } catch (error: unknown) {
    return { ok: false, failure: { kind: 'browserFailed', detail: describe(error) } }
  }
  switch (verdict.kind) {
    case 'none': {
      return undefined
    }
    case 'found': {
      return { ok: false, failure: { kind: 'managedPolicy', where: verdict.where } }
    }
    case 'unreadable': {
      return {
        ok: false,
        failure: { kind: 'policyUnreadable', where: verdict.where, detail: verdict.detail },
      }
    }
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
  // A policy that could override the block refuses the check before anything starts.
  const refused = await policyRefusal(deps)
  if (refused !== undefined) {
    return refused
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
