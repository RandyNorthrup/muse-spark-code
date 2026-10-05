// The browser check's targets (M81 A1, design spec v4 §6.1): the request
// gate, the watch on every target, and the model's page.
//
// - The gate: `Fetch.enable` on the browser itself, before any page exists,
//   pauses every request any target makes (pages, frames in other
//   processes, workers, service workers, every redirect); each goes on only
//   if it is http(s) or ws(s) to loopback or an approved host, or is one of
//   the current canary phase's exact probe URLs from that phase's own probe
//   frame. Everything else fails with `BlockedByClient`. Every
//   `Fetch.authRequired` is answered `CancelAuth` on its own session, never
//   with credentials. The owned proxy stays the boundary behind it. One
//   gate on the browser, not one per target: it already pauses every
//   target's requests (captured at the pin), and a dedicated worker has no
//   Fetch domain of its own.
// - The watch: the browser and every target it attaches attach every
//   target they start, held before their first line runs. Every target gets
//   its Network events; pages and frames also a virtual authenticator with
//   no presence and no verification, and the file chooser intercepted. Any
//   setup failure, a target type outside the known ones, or more than 64
//   targets ends the check `unwatchable` before that target runs.
// - The page: a response, a redirect or a WebSocket/WebTransport handshake
//   from beyond the approved hosts that did not come back through the
//   proxy's refusal ends the check `leaked` with nothing returned; a socket
//   the page merely tries is listed as blocked.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import {
  BROWSER_CHECK_DOCUMENT_TYPES,
  BROWSER_CHECK_MAX_ENTRIES,
  BROWSER_CHECK_MAX_TARGETS,
  BROWSER_CHECK_TARGET_TYPES,
  BROWSER_NET_ERROR,
  BROWSER_PROXY_HOST,
  BROWSER_FAILED_STATUS,
} from '../../shared/browserCheckConstants'
import { isAllowedRequest, isNetworkUrl } from './browserPolicy'
import type {
  BrowserCheckRequest,
  BrowserCheckResult,
  BrowserEntries,
  BrowserFailure,
  BrowserScreenshot,
  BrowserTimings,
} from './browserRun'
import { type CdpConnection, CdpError, type CdpEvent } from './cdpPipe'
import { clipEntry, RequestLog } from './requestLog'

// The shapes read off the protocol at the pin (154.0.8037.92, captured on
// the rigs; docs/certification/m81.md).
const targetSchema = z.object({ targetId: z.string() })
const attachedSchema = z.object({
  sessionId: z.string(),
  targetInfo: z.object({ targetId: z.string(), type: z.string() }),
})
const detachedSchema = z.object({ sessionId: z.string() })
const navigatedSchema = z.object({ errorText: z.optional(z.string()) })
const frameTreeSchema = z.object({ frameTree: z.object({ frame: z.object({ id: z.string() }) }) })
const targetInfoSchema = z.object({ targetInfo: z.object({ url: z.string() }) })
const evaluatedSchema = z.object({
  result: z.object({ value: z.optional(z.unknown()) }),
  exceptionDetails: z.optional(z.unknown()),
})
const screenshotSchema = z.object({ data: z.string() })
const pausedSchema = z.object({
  requestId: z.string(),
  frameId: z.optional(z.string()),
  request: z.object({ url: z.string() }),
})
// Fetch.authRequired, Network.loadingFinished and a WebSocket's handshake.
const requestIdSchema = z.object({ requestId: z.string() })
const remoteSchema = z.object({
  url: z.string(),
  remoteIPAddress: z.optional(z.string()),
  remotePort: z.optional(z.number()),
})
const requestSchema = z.object({
  requestId: z.string(),
  request: z.object({ url: z.string() }),
  redirectResponse: z.optional(remoteSchema),
})
const responseSchema = z.object({
  requestId: z.string(),
  response: z.object({
    url: z.string(),
    remoteIPAddress: z.optional(z.string()),
    remotePort: z.optional(z.number()),
    status: z.number(),
    fromServiceWorker: z.optional(z.unknown()),
  }),
})
const loadingFailedSchema = z.object({
  requestId: z.string(),
  errorText: z.string(),
  canceled: z.optional(z.unknown()),
  blockedReason: z.optional(z.string()),
})
// A WebSocket (`requestId`) or a WebTransport (`transportId`), created or answered.
const socketSchema = z.object({
  requestId: z.optional(z.string()),
  transportId: z.optional(z.string()),
  url: z.optional(z.string()),
})
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
const EVERY_REQUEST = { patterns: [{ urlPattern: '*' }], handleAuthRequests: true }
const CANCEL_AUTH = { response: 'CancelAuth' }
// A virtual authenticator that never sees a user: no presence, no verification.
const NO_PRESENCE = {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasUserVerification: true,
    isUserVerified: false,
    automaticPresenceSimulation: false,
  },
}
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
// The signature and IHDR up to its height; IHDR's width and height, big-endian.
const PNG_HEAD_BYTES = 24
const PNG_WIDTH_AT = 16
const PNG_HEIGHT_AT = 20
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
const STEP_SCRIPT = `(k,s,t)=>{const e=document.querySelector(s);if(e===null)return'${STEP_MISSING}';if(k==='click'){e.click();return'${STEP_DONE}'}e.focus();const v=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(v===undefined)return'${STEP_MISSING}';v.call(e,t);for(const n of['input','change'])e.dispatchEvent(new Event(n,{bubbles:true}));return'${STEP_DONE}'}`

function ignore(): void {
  // A call whose answer no longer matters: the check has ended.
}

/** Entries of one kind, kept up to the bound and cut to length; the rest are counted. */
class EntryList {
  readonly #entries: string[] = []
  readonly #isDistinct: boolean
  #extra = 0

  public constructor(isDistinct: boolean) {
    this.#isDistinct = isDistinct
  }

  public add(text: string): void {
    const entry = clipEntry(text)
    if (this.#isDistinct && this.#entries.includes(entry)) {
      return
    }
    if (this.#entries.length < BROWSER_CHECK_MAX_ENTRIES) {
      this.#entries.push(entry)
      return
    }
    this.#extra += 1
  }

  public get value(): BrowserEntries {
    return { shown: [...this.#entries], more: this.#extra }
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

/** One canary phase's exceptions: exact URLs, from one frame only. */
interface ProbeBinding {
  readonly frameId: string
  readonly urls: ReadonlySet<string>
}

export interface PageCheckOptions {
  readonly request: BrowserCheckRequest
  readonly timings: BrowserTimings
  /** The proxy's port: a refusal comes back from 127.0.0.1 at it. */
  readonly proxyPort: number
  /** Ends the whole check at once with this failure. */
  readonly end: (failure: BrowserFailure) => void
}

/** The check's targets: the gate, the watch, the canaries' probe frames and the model's page. */
export class PageCheck {
  readonly #allowed: ReadonlySet<string>
  readonly #consoleErrors = new EntryList(false)
  readonly #failedRequests = new EntryList(true)
  readonly #blockedRequests = new EntryList(true)
  readonly #requests = new RequestLog()
  /** Beyond-host sockets the page tried, by id: a handshake from one is a leak. */
  readonly #beyondSockets = new Set<string>()
  /** The sessions watched, and those of the canaries' probe targets (never reported). */
  readonly #watched = new Set<string>()
  readonly #probes = new Set<string>()
  /** The session of each target whose watch is up, by target id. */
  readonly #ready = new Map<string, string>()
  readonly #waiters = new Set<() => void>()
  #binding: ProbeBinding | undefined
  #pageSession: string | undefined
  #loads = 0
  readonly #probeLoads = new Set<string>()

  readonly #connection: CdpConnection
  readonly #options: PageCheckOptions

  public constructor(connection: CdpConnection, options: PageCheckOptions) {
    this.#connection = connection
    this.#options = options
    this.#allowed = new Set(options.request.allowedHosts)
    connection.onEvent((event) => {
      this.#onEvent(event)
    })
    connection.onClose(() => {
      this.#wakeWaiters()
    })
  }

  #onEvent(event: CdpEvent): void {
    switch (event.method) {
      case 'Fetch.requestPaused': {
        this.#gate(event)
        return
      }
      case 'Fetch.authRequired': {
        const auth = requestIdSchema.safeParse(event.params)
        if (auth.success) {
          void this.#connection
            .send(
              'Fetch.continueWithAuth',
              { requestId: auth.data.requestId, authChallengeResponse: CANCEL_AUTH },
              event.sessionId,
            )
            .catch(ignore)
        }
        return
      }
      case 'Target.attachedToTarget': {
        void this.#watch(event.params)
        return
      }
      case 'Target.detachedFromTarget': {
        const detached = detachedSchema.safeParse(event.params)
        if (detached.success) {
          this.#unwatch(detached.data.sessionId)
        }
        return
      }
      default: {
        break
      }
    }
    const { sessionId } = event
    if (sessionId === undefined || !this.#watched.has(sessionId)) {
      return
    }
    // A probe page's own load; nothing else of a probe is the page's.
    if (this.#probes.has(sessionId)) {
      if (event.method === 'Page.loadEventFired') {
        this.#probeLoads.add(sessionId)
        this.#wakeWaiters()
      }
      return
    }
    this.#onNetworkEvent(event, sessionId)
    if (sessionId === this.#pageSession) {
      this.#onPageEvent(event)
    }
  }

  /**
   * A target attached as it started, held before its first line runs: set
   * up by its type, the targets it starts attached in turn, then let run.
   * One that cannot be watched ends the check; it is never let run.
   */
  async #watch(params: unknown): Promise<void> {
    const attached = attachedSchema.safeParse(params)
    if (!attached.success) {
      this.#options.end({ kind: 'unwatchable' })
      return
    }
    const { sessionId, targetInfo } = attached.data
    const { type } = targetInfo
    if (
      this.#watched.size >= BROWSER_CHECK_MAX_TARGETS ||
      !BROWSER_CHECK_TARGET_TYPES.includes(type)
    ) {
      this.#options.end({ kind: 'unwatchable' })
      return
    }
    this.#watched.add(sessionId)
    try {
      await this.#connection.send('Network.enable', {}, sessionId)
      await this.#connection.send('Target.setAutoAttach', AUTO_ATTACH, sessionId)
      if (BROWSER_CHECK_DOCUMENT_TYPES.includes(type)) {
        await this.#connection.send('WebAuthn.enable', {}, sessionId)
        await this.#connection.send('WebAuthn.addVirtualAuthenticator', NO_PRESENCE, sessionId)
        await this.#connection.send(
          'Page.setInterceptFileChooserDialog',
          { enabled: true },
          sessionId,
        )
      }
      await this.#connection.send('Runtime.runIfWaitingForDebugger', {}, sessionId)
    } catch {
      this.#options.end({ kind: 'unwatchable' })
      return
    }
    // Gone again while its watch went up: nothing of it is kept.
    if (!this.#watched.has(sessionId)) {
      return
    }
    this.#ready.set(targetInfo.targetId, sessionId)
    this.#wakeWaiters()
  }

  /** A target gone (a worker ended, a frame removed): its session forgotten. */
  #unwatch(sessionId: string): void {
    this.#watched.delete(sessionId)
    this.#probes.delete(sessionId)
    for (const [targetId, watchedSession] of this.#ready) {
      if (watchedSession === sessionId) {
        this.#ready.delete(targetId)
      }
    }
  }

  /** Every paused request: on to loopback, an approved host or a bound probe URL; failed otherwise. */
  #gate(event: CdpEvent): void {
    const paused = pausedSchema.safeParse(event.params)
    if (!paused.success) {
      return
    }
    const { requestId, request, frameId } = paused.data
    const binding = this.#binding
    const isProbe =
      binding !== undefined && frameId === binding.frameId && binding.urls.has(request.url)
    if (isProbe || isAllowedRequest(request.url, this.#allowed)) {
      void this.#connection
        .send('Fetch.continueRequest', { requestId }, event.sessionId)
        .catch(ignore)
      return
    }
    void this.#connection
      .send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, event.sessionId)
      .catch(ignore)
  }

  /** A response or redirect from beyond: the proxy's own refusal, or a leak. */
  #isLeak(remote: z.infer<typeof remoteSchema>): boolean {
    if (!this.#isBeyondAllowed(remote.url)) {
      return false
    }
    this.#blockedRequests.add(remote.url)
    return (
      remote.remoteIPAddress !== BROWSER_PROXY_HOST || remote.remotePort !== this.#options.proxyPort
    )
  }

  /** Any watched target's traffic: the failed requests, and a way out that ends the check. */
  #onNetworkEvent(event: CdpEvent, sessionId: string): void {
    switch (event.method) {
      case 'Network.requestWillBeSent': {
        const sent = requestSchema.safeParse(event.params)
        if (!sent.success) {
          break
        }
        this.#requests.add(sessionId, sent.data.requestId, sent.data.request.url)
        if (
          !isAllowedRequest(sent.data.request.url, this.#allowed) &&
          isNetworkUrl(sent.data.request.url)
        ) {
          this.#blockedRequests.add(sent.data.request.url)
        }
        const redirect = sent.data.redirectResponse
        if (redirect !== undefined && this.#isLeak(redirect)) {
          this.#options.end({ kind: 'leaked' })
        }
        break
      }
      case 'Network.responseReceived': {
        this.#onResponse(event.params)
        break
      }
      case 'Network.loadingFinished': {
        const finished = requestIdSchema.safeParse(event.params)
        if (finished.success) {
          this.#requests.take(sessionId, finished.data.requestId)
        }
        break
      }
      case 'Network.loadingFailed': {
        this.#onLoadingFailed(event.params, sessionId)
        break
      }
      case 'Network.webSocketCreated':
      case 'Network.webTransportCreated': {
        // Tried, not reached: listed as blocked, and watched for an answer.
        const socket = socketSchema.safeParse(event.params)
        const id = socket.data?.requestId ?? socket.data?.transportId
        const url = socket.data?.url
        if (id !== undefined && url !== undefined && this.#isBeyondAllowed(url)) {
          this.#blockedRequests.add(url)
          this.#beyondSockets.add(id)
        }
        break
      }
      case 'Network.webSocketHandshakeResponseReceived':
      case 'Network.webTransportConnectionEstablished': {
        const socket = socketSchema.safeParse(event.params)
        const id = socket.data?.requestId ?? socket.data?.transportId
        if (id !== undefined && this.#beyondSockets.has(id)) {
          this.#options.end({ kind: 'leaked' })
        }
        break
      }
      default: {
        break
      }
    }
  }

  /** The page's own events: its loads, and its console. */
  #onPageEvent(event: CdpEvent): void {
    switch (event.method) {
      case 'Page.loadEventFired': {
        this.#loads += 1
        this.#wakeWaiters()
        break
      }
      case 'Runtime.consoleAPICalled': {
        const called = consoleSchema.safeParse(event.params)
        if (called.success && CONSOLE_ERROR_TYPES.has(called.data.type)) {
          this.#consoleErrors.add(
            called.data.args.map((argument) => consoleArgText(argument)).join(' '),
          )
        }
        break
      }
      case 'Runtime.exceptionThrown': {
        const thrown = exceptionSchema.safeParse(event.params)
        if (thrown.success) {
          const { text, exception } = thrown.data.exceptionDetails
          this.#consoleErrors.add(exception?.description ?? text)
        }
        break
      }
      default: {
        break
      }
    }
  }

  #onResponse(params: unknown): void {
    const received = responseSchema.safeParse(params)
    if (!received.success) {
      return
    }
    const { response } = received.data
    // A service worker's own requests pass the gate like any other; what it
    // answers from itself never left the browser.
    if (response.fromServiceWorker !== true && this.#isLeak(response)) {
      this.#options.end({ kind: 'leaked' })
      return
    }
    if (response.status >= BROWSER_FAILED_STATUS) {
      this.#failedRequests.add(`${response.url} (HTTP ${String(response.status)})`)
    }
  }

  #onLoadingFailed(params: unknown, sessionId: string): void {
    const failed = loadingFailedSchema.safeParse(params)
    if (!failed.success) {
      return
    }
    const url = this.#requests.take(sessionId, failed.data.requestId)
    if (failed.data.blockedReason === BLOCKED_BY_CHECK || failed.data.canceled === true) {
      return
    }
    if (url !== undefined && isNetworkUrl(url)) {
      this.#failedRequests.add(`${url} (${failed.data.errorText})`)
    }
  }

  /** A network URL to a host the check may not reach. */
  #isBeyondAllowed(url: string): boolean {
    return isNetworkUrl(url) && !isAllowedRequest(url, this.#allowed)
  }

  #wakeWaiters(): void {
    // A waiter that finishes takes itself out of the set; iteration allows it.
    for (const wake of this.#waiters) {
      wake()
    }
  }

  /** Until the page's next load event, at most `ms`. */
  #waitForLoad(ms: number): Promise<void> {
    const seen = this.#loads
    return this.waitUntil(() => this.#loads > seen, ms)
  }

  /** Nothing more is asked of a browser whose check has ended. */
  #ensureOpen(): void {
    const closed = this.#connection.closedBy
    if (closed !== undefined) {
      throw closed
    }
  }

  /** The page opened and loaded, or why it was not; undefined once it is there. */
  async #open(sessionId: string): Promise<BrowserCheckResult | undefined> {
    for (const domain of ['Page', 'Runtime']) {
      await this.call(`${domain}.enable`, nothing, {}, sessionId)
    }
    const loaded = this.#waitForLoad(this.#options.timings.loadMs)
    const navigated = await this.call(
      'Page.navigate',
      navigatedSchema,
      { url: this.#options.request.url },
      sessionId,
    )
    const { errorText } = navigated
    if (errorText !== undefined) {
      return {
        ok: false,
        failure:
          errorText === NAVIGATION_BLOCKED ? { kind: 'pageBlocked' } : pageFailure(errorText),
      }
    }
    // A page still loading at the bound is read as it stands.
    await loaded
    return undefined
  }

  /** The click and type steps, in order; the one whose element is missing ends them. */
  async #step(sessionId: string): Promise<BrowserCheckResult | undefined> {
    for (const action of this.#options.request.actions) {
      // Stopped, out of time or leaking: no further step reaches the page.
      this.#ensureOpen()
      const settled = this.#waitForLoad(this.#options.timings.settleMs)
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

  async #screenshot(sessionId: string): Promise<BrowserScreenshot> {
    const shot = await this.call(
      'Page.captureScreenshot',
      screenshotSchema,
      { format: 'png' },
      sessionId,
    )
    const png = Buffer.from(shot.data, 'base64')
    // A PNG: its signature, then IHDR's width and height. Its size is the
    // CDP frame's bound here, and the image limit's where it is sent.
    if (
      png.length < PNG_HEAD_BYTES ||
      !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      throw new CdpError('the screenshot is not a PNG')
    }
    return {
      png: new Uint8Array(png),
      width: png.readUInt32BE(PNG_WIDTH_AT),
      height: png.readUInt32BE(PNG_HEIGHT_AT),
    }
  }

  /** Until `isDone()` holds, at most `ms`; at once when the connection ends. */
  public waitUntil(isDone: () => boolean, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        if (isDone() || this.#connection.closedBy !== undefined) {
          finish()
        }
      }
      const timer = setTimeout(() => {
        finish()
      }, ms)
      const finish = (): void => {
        clearTimeout(timer)
        this.#waiters.delete(wake)
        resolve()
      }
      this.#waiters.add(wake)
      wake()
    })
  }

  /** Wakes the waiters to look again (the proxy recorded something). */
  public poke(): void {
    this.#wakeWaiters()
  }

  public async call<T>(
    method: string,
    schema: z.ZodMiniType<T>,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<T> {
    const parsed = schema.safeParse(await this.#connection.send(method, params, sessionId))
    if (!parsed.success) {
      throw new CdpError(`${method}: unexpected shape`)
    }
    return parsed.data
  }

  /** The gate and the watch on the browser, before any page exists; downloads denied. */
  public async setup(): Promise<void> {
    await this.call('Fetch.enable', nothing, EVERY_REQUEST)
    await this.call('Target.setAutoAttach', nothing, AUTO_ATTACH)
    await this.call('Browser.setDownloadBehavior', nothing, { behavior: 'deny' })
  }

  /**
   * A new blank target (in the private context when one is given), once its
   * watch is up: its target id and session. A probe target's traffic is
   * never reported or judged as the page's.
   */
  public async openTarget(
    browserContextId: string | undefined,
    isProbe: boolean,
  ): Promise<{ readonly targetId: string; readonly sessionId: string }> {
    const { targetId } = await this.call('Target.createTarget', targetSchema, {
      url: 'about:blank',
      ...(browserContextId !== undefined && { browserContextId }),
    })
    await this.waitUntil(() => this.#ready.has(targetId), this.#options.timings.loadMs)
    const sessionId = this.#ready.get(targetId)
    if (sessionId === undefined) {
      throw this.#connection.closedBy ?? new CdpError('not attached in time')
    }
    if (isProbe) {
      this.#probes.add(sessionId)
    }
    return { targetId, sessionId }
  }

  /** The main frame of a target's page: what a probe exception is bound to. */
  public async mainFrame(sessionId: string): Promise<string> {
    const { frameTree } = await this.call('Page.getFrameTree', frameTreeSchema, {}, sessionId)
    return frameTree.frame.id
  }

  /** The current phase's exceptions; undefined revokes them. */
  public bind(binding: ProbeBinding | undefined): void {
    this.#binding = binding
  }

  /**
   * Navigates a probe target to its probe page and runs its script; the
   * script's JSON, or undefined when the probe page did not load (its route
   * is not the one constructed: the phase reads it as no report).
   */
  public async probe(sessionId: string, url: string, script: string): Promise<unknown> {
    // Its script runs in the probe page once that page has loaded.
    await this.call('Page.enable', nothing, {}, sessionId)
    const loaded = this.waitUntil(
      () => this.#probeLoads.has(sessionId),
      this.#options.timings.loadMs,
    )
    const navigated = await this.call('Page.navigate', navigatedSchema, { url }, sessionId)
    await loaded
    if (navigated.errorText !== undefined || !this.#probeLoads.has(sessionId)) {
      return undefined
    }
    const evaluated = await this.call(
      'Runtime.evaluate',
      evaluatedSchema,
      { expression: script, awaitPromise: true, returnByValue: true },
      sessionId,
    )
    return evaluated.result.value
  }

  /** The model's page in the private context, start to screenshot. Rejects when the browser fails it. */
  public async runPage(browserContextId: string): Promise<BrowserCheckResult> {
    const { targetId, sessionId } = await this.openTarget(browserContextId, false)
    this.#pageSession = sessionId
    const stopped = (await this.#open(sessionId)) ?? (await this.#step(sessionId))
    if (stopped !== undefined) {
      return stopped
    }
    this.#ensureOpen()
    const { targetInfo } = await this.call('Target.getTargetInfo', targetInfoSchema, { targetId })
    const screenshot = this.#options.request.includeScreenshot
      ? await this.#screenshot(sessionId)
      : undefined
    return {
      ok: true,
      report: {
        finalUrl: targetInfo.url,
        consoleErrors: this.#consoleErrors.value,
        failedRequests: this.#failedRequests.value,
        blockedRequests: this.#blockedRequests.value,
        screenshot,
      },
    }
  }
}

/** A page's error text as the closed failure keeps it: a `net::ERR_…` code, or nothing. */
export function pageFailure(errorText: string): BrowserFailure {
  return {
    kind: 'pageFailed',
    netError: BROWSER_NET_ERROR.test(errorText) ? errorText : undefined,
  }
}
