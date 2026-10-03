// One browser check (M81 A1, PLAN.md D49; design spec v4 §§4.1, 6): the
// pinned Chrome-for-Testing headless shell, verified by the runtime bundle,
// started over `--remote-debugging-pipe` in a fresh profile under the
// extension's storage, confined by the check's own proxy, its confinement
// tested before and after the model's page, and the browser, the proxy, the
// fixtures and the profile gone again whatever happened.
//
// Two lifetimes, never one deadline across both (spec §4.1):
//
// 1. The preparation (15 minutes): the runtime bundle checks, asks, downloads
//    and verifies through `options.prepareRuntime`, joined to the caller's
//    stop and to the host's admission (trust, mode, network posture, the
//    runtime setting, the frozen scope). No browser, profile or proxy exists
//    yet.
// 2. Once a verified runtime is ready and admission is read again, the check
//    (60 seconds): its folder, the proxy (ready before the spawn), the probe
//    fixture, the verified executable's identity read again, the spawn with
//    the fixed command line and a projected environment; then the browser's
//    version, its command line and its first target held to the pin's
//    contract; the gate and the watch; the default-context canaries; the
//    private context with the same proxy, its cookie tripwire and its
//    canaries; the model's page; the audit's canaries and the network
//    service's id; admission read again before anything is returned, even
//    after teardown.
//
// The first end wins (the deadline, a stop, the window, admission lost, a
// leak, the pipe): the CDP connection closes at that moment, rejecting every
// call still waiting, and the teardown (the browser closed or killed with
// everything it started, the proxy, the fixtures, the folder) runs once,
// bounded at 10 seconds. Pure: every process, folder, socket and clock is
// injected (browserProcess.ts on the host).

import * as z from 'zod/mini'
import {
  BROWSER_CANARY_INITIAL_MS,
  BROWSER_CANARY_NONCE_BYTES,
  BROWSER_CANARY_PHASE_MS,
  BROWSER_CANARY_SETTLE_MS,
  BROWSER_CHECK_ACTION_SETTLE_MS,
  BROWSER_CHECK_CLOSE_GRACE_MS,
  BROWSER_CHECK_LOAD_TIMEOUT_MS,
  BROWSER_CHECK_TEARDOWN_MS,
  BROWSER_CHECK_TIMEOUT_MS,
  BROWSER_NETWORK_SERVICE_TYPE,
  BROWSER_PRODUCT_PREFIX,
  BROWSER_PROXY_BYPASS,
  BROWSER_PROXY_MAX_OBSERVATIONS,
  BROWSER_RUNTIME_CLEANUP_MS,
  BROWSER_RUNTIME_PREPARATION_MS,
} from '../../shared/browserCheckConstants'
import {
  browserEnvironment,
  browserLaunchArgs,
  type CheckFolders,
  commandLineVerdict,
} from './browserLaunch'
import {
  type CanaryPhase,
  phasePlan,
  phaseVerdict,
  type ProbeFixture,
  type ProbeReport,
} from './canaries'
import { CdpConnection, CdpError, type PipeReader, type PipeWriter } from './cdpPipe'
import type { CheckProxy, FrozenScope, ProxyObservation } from './checkProxy'
import { PageCheck } from './pageCheck'
import type { RuntimePreparation, RuntimePrepareRequest, VerifiedRuntime } from './runtimeTypes'
import { type BoundedLifetime, createLifetime, LifetimeEndedError } from './workLifetime'

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
   * The hosts beyond loopback the user explicitly allowed for this check:
   * the setting, and the one a card or the modal widened. Never the
   * model's. Implicit loopback is derived separately (plain HTTP only).
   */
  readonly allowedHosts: readonly string[]
  /** What the user approved: the URL and its scope (`browserScopeKey`). */
  readonly approvalKey: string
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
  /** Requests beyond the approved hosts the check failed or the proxy refused. */
  readonly blockedRequests: BrowserEntries
  /** A PNG, read and measured, when the request asked for one. */
  readonly screenshot: BrowserScreenshot | undefined
}

export interface BrowserScreenshot {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
}

// --- The closed failure contract (M81 A1, design spec v4 §5 and the lead's
// ruling on RVM81v4). Every way a check ends without a report is one of
// these discriminants; none carries free text, a path, a parser or OS
// message, a CDP error or a header. The only fields are bounded untrusted
// data: a page's network error code (`net::ERR_…` only) and the selector a
// step named. Each backend words a failure itself (browserTool.ts).

/** Why no verified runtime was ready for the check (spec §4). */
export type PreparationFailure =
  /** Not installed, and it could not be downloaded now. */
  | 'runtimeMissing'
  /** This OS and architecture have no pinned runtime. */
  | 'runtimeUnsupported'
  /** The pin is 45 days old or more: an extension update is needed. */
  | 'runtimeOutdated'
  /** An archive, executable, receipt or published folder failed verification. */
  | 'runtimeIntegrity'
  /** The OS refused to run it (application control, signing, quarantine). */
  | 'runtimeBlocked'
  /** The user chose Not now, or the consent prompt lapsed. */
  | 'runtimeDeclined'
  /** Preparation passed its 15-minute bound. */
  | 'preparationTimedOut'
  /** The approved hosts changed while the check was prepared. */
  | 'scopeChanged'
  /** The check stopped being offered (trust, mode, network posture, the runtime setting). */
  | 'notOffered'

/** Why the check could not trust its own confinement (spec §§3, 6): nothing of the page is returned. */
export type ConfinementFailure =
  /** The verified runtime did not start, or its pipe failed during setup. */
  | 'launch'
  /** The browser's version, command line or startup targets are not the pin's exact contract. */
  | 'unrecognized'
  /** No fresh private profile or browser context (the cookie tripwire included). */
  | 'profile'
  /** A routing canary did not reach the owned proxy as expected (route not confirmed). */
  | 'routeUnconfirmed'
  /** The browser's resolver rule is not the exact one (resolver rule not confirmed). */
  | 'resolverUnconfirmed'
  /** A sign-in challenge reached the browser, or an Authorization header reached a fixture. */
  | 'signIn'
  /** WebRTC left the proxy, or its canary could not be confirmed. */
  | 'webrtc'
  /** WebTransport was not refused, or a datagram left. */
  | 'transport'
  /** A canary could not be calibrated on this machine (a missing fixture or address). */
  | 'unverifiable'
  /** A target, frame or worker could not be watched, or there were too many. */
  | 'unwatchable'
  /** The audit after the page failed (audit exception): the page's data is discarded. */
  | 'auditFailed'
  /** The browser's network service restarted during the check: the page's data is discarded. */
  | 'restartObserved'

/** How a page run ended without a report. */
export type PageEnd =
  /** The page's own navigation was blocked: it went beyond the approved hosts. */
  | 'pageBlocked'
  /** The 60-second check lifetime ended. */
  | 'timedOut'
  /** A request, redirect or socket reached beyond the approved hosts: nothing is returned. */
  | 'leaked'
  /** Stopped by its caller, the session or the window. */
  | 'cancelled'
  /** The browser stopped answering or went away during the page run. */
  | 'browserFailed'

export type BrowserFailure =
  | { readonly kind: PreparationFailure | ConfinementFailure | PageEnd }
  /** The page did not load; `netError` matches BROWSER_NET_ERROR (`net::ERR_…`) or is absent. */
  | { readonly kind: 'pageFailed'; readonly netError: string | undefined }
  /** A step's selector matched nothing: the model's own selector, bounded. */
  | { readonly kind: 'noElement'; readonly selector: string }

export type BrowserCheckResult =
  | { readonly ok: true; readonly report: BrowserCheckReport }
  | { readonly ok: false; readonly failure: BrowserFailure }

/**
 * Whether a caller's check is still allowed, read around every await: the
 * workspace's trust, the mode, the network posture and the frozen scope.
 */
export type CheckAdmission = () => 'ok' | 'notOffered' | 'scopeChanged'

/** What runs a check: the host's browser bundle, loaded on the first call. */
export type BrowserChecker = (
  request: BrowserCheckRequest,
  admission: CheckAdmission,
) => Promise<BrowserCheckResult>

/**
 * The host's side of one check (spec §5, lead ruling v4-M1): consent is
 * host-owned, so the runtime adapter takes the request without it and asks
 * the user itself.
 */
export interface BrowserHostOptions {
  readonly storageDir: string
  readonly prepareRuntime: (
    request: Omit<RuntimePrepareRequest, 'consent'>,
  ) => Promise<RuntimePreparation>
  /** Ends when the offer goes (trust, mode, posture, the setting, the scope); its reason says which. */
  readonly admissionSignal: AbortSignal
  readonly admissionStillValid: () => boolean
  /** A fixed, closed-set fact for the log: never a value, a path or a raw error. */
  readonly warn: (fact: string) => void
}

/** A started browser: the two pipe ends, its exit, and a kill for it and all it started. */
export interface BrowserProcess {
  readonly writer: PipeWriter
  readonly reader: PipeReader
  /** Resolves once the browser has exited (or never started). */
  readonly exited: Promise<void>
  /**
   * The spawn's own error code once known: EPERM or EACCES when the OS
   * refused to run the executable; undefined once the browser started. The
   * OS reports those asynchronously, so this is read after the spawn
   * returns rather than thrown.
   */
  readonly spawnError: Promise<string | undefined>
  /** Ends the browser and everything it started, at once. */
  kill(): Promise<void>
}

export interface BrowserTimings {
  readonly preparationMs: number
  readonly checkMs: number
  readonly loadMs: number
  readonly settleMs: number
  readonly closeGraceMs: number
  readonly phaseMs: number
  readonly initialCanaryMs: number
}

/** A check's folder: the profile, its temporary folder and home, under `root`. */
export interface CheckFolder extends CheckFolders {
  readonly root: string
}

export interface BrowserRunDeps {
  readonly platform: NodeJS.Platform
  /** This process's environment; the browser gets a projection of it. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** A fresh folder under `<storage>/bc/`; never the user's profile. */
  readonly createFolder: (storageDir: string) => Promise<CheckFolder>
  readonly removeFolder: (folder: CheckFolder) => Promise<void>
  /** The executable's length and modification time now; undefined when it is gone. */
  readonly statExecutable: (
    executable: string,
  ) => Promise<{ readonly bytes: number; readonly mtimeMs: number } | undefined>
  readonly startProxy: (scope: FrozenScope) => Promise<CheckProxy>
  readonly startFixture: () => Promise<ProbeFixture>
  /**
   * Throws an error with code EPERM or EACCES when the OS refuses to run it
   * at once, and reports the same codes through the process's `spawnError`
   * when the refusal arrives after the spawn returned.
   */
  readonly spawn: (
    executable: string,
    args: readonly string[],
    env: Readonly<Record<string, string>>,
  ) => BrowserProcess
  readonly randomHex: (bytes: number) => string
  /** The constants' bounds unless a test shortens them. */
  readonly timings?: Partial<BrowserTimings>
}

const DEFAULT_TIMINGS: BrowserTimings = {
  preparationMs: BROWSER_RUNTIME_PREPARATION_MS,
  checkMs: BROWSER_CHECK_TIMEOUT_MS,
  loadMs: BROWSER_CHECK_LOAD_TIMEOUT_MS,
  settleMs: BROWSER_CHECK_ACTION_SETTLE_MS,
  closeGraceMs: BROWSER_CHECK_CLOSE_GRACE_MS,
  phaseMs: BROWSER_CANARY_PHASE_MS,
  initialCanaryMs: BROWSER_CANARY_INITIAL_MS,
}

const versionSchema = z.object({ product: z.string() })
const commandLineSchema = z.object({ arguments: z.array(z.string()) })
const targetsSchema = z.object({
  targetInfos: z.array(z.object({ type: z.string(), url: z.string() })),
})
const processesSchema = z.object({
  processInfo: z.array(z.object({ type: z.string(), id: z.number() })),
})
const contextSchema = z.object({ browserContextId: z.string() })
const cookiesSchema = z.object({ cookies: z.array(z.unknown()) })
const probeReportSchema = z.object({
  sockets: z.object({
    c2: z.optional(z.string()),
    c2s: z.optional(z.string()),
    c5w: z.optional(z.string()),
  }),
  wt: z.string(),
  candidates: z.array(z.string()),
  ice: z.string(),
})
const nothing = z.object({})

// A phase whose probe never reported: the audit's own failure, else the route's.
const MISSING_REPORT = {
  default: 'routeUnconfirmed',
  page: 'routeUnconfirmed',
  audit: 'auditFailed',
} as const

/** A failure that ends the check where it is found. */
class CheckFailure extends Error {
  public constructor(public readonly failure: BrowserFailure) {
    super(failure.kind)
  }
}

function fail(kind: PreparationFailure | ConfinementFailure | PageEnd): never {
  throw new CheckFailure({ kind })
}

/** `work`'s value, or the check ends with `kind` when it rejects; the lifetime's end passes as it is. */
async function orFail<T>(
  work: Promise<T>,
  kind: PreparationFailure | ConfinementFailure | PageEnd,
): Promise<T> {
  try {
    return await work
  } catch (error: unknown) {
    if (error instanceof LifetimeEndedError) {
      throw error
    }
    return fail(kind)
  }
}

function ignore(): void {
  // A call whose answer no longer matters: the check has ended.
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

/** Why admission ended, from the host's signal: a changed scope, or the offer gone. */
function admissionFailure(options: BrowserHostOptions): BrowserFailure {
  return { kind: options.admissionSignal.reason === 'scopeChanged' ? 'scopeChanged' : 'notOffered' }
}

/** Why the check may not go on now: stopped, or admission gone; undefined while it may. */
function refusalNow(
  request: BrowserCheckRequest,
  options: BrowserHostOptions,
): BrowserFailure | undefined {
  if (request.signal.aborted) {
    return { kind: 'cancelled' }
  }
  return options.admissionSignal.aborted || !options.admissionStillValid()
    ? admissionFailure(options)
    : undefined
}

/** The failure for a lifetime that ended before its work did. */
function endedFailure(
  lifetime: BoundedLifetime,
  request: BrowserCheckRequest,
  options: BrowserHostOptions,
  onDeadline: 'timedOut' | 'preparationTimedOut',
): BrowserFailure {
  if (request.signal.aborted) {
    return { kind: 'cancelled' }
  }
  if (options.admissionSignal.aborted) {
    return admissionFailure(options)
  }
  return { kind: lifetime.endedBy === 'deadline' ? onDeadline : 'cancelled' }
}

/** The verified runtime, or why none is ready: the preparation's own lifetime. */
async function prepare(
  request: BrowserCheckRequest,
  options: BrowserHostOptions,
  timings: BrowserTimings,
): Promise<VerifiedRuntime | BrowserFailure> {
  const lifetime = createLifetime(
    timings.preparationMs,
    [request.signal, options.admissionSignal],
    BROWSER_RUNTIME_CLEANUP_MS,
  )
  try {
    const prepared = await lifetime.step(
      async () =>
        await options.prepareRuntime({
          storageDir: options.storageDir,
          lifetime,
          admissionStillValid: options.admissionStillValid,
        }),
    )
    if (prepared.ok) {
      return prepared.runtime
    }
    // Admission's own reason (a changed scope, the offer gone) comes first.
    return options.admissionSignal.aborted ? admissionFailure(options) : { kind: prepared.reason }
  } catch {
    return endedFailure(lifetime, request, options, 'preparationTimedOut')
  } finally {
    lifetime.end()
    await lifetime.cleaned
  }
}

/** The network service's process id, as the browser reports it; undefined when absent. */
async function networkServiceId(page: PageCheck): Promise<number | undefined> {
  const { processInfo } = await page.call('SystemInfo.getProcessInfo', processesSchema)
  return processInfo.find((entry) => entry.type === BROWSER_NETWORK_SERVICE_TYPE)?.id
}

interface CheckContext {
  readonly page: PageCheck
  readonly fixture: ProbeFixture
  /** Where the proxy's records go from now on: a phase's own list, or nowhere. */
  readonly collect: (into: ProxyObservation[] | undefined) => void
  readonly request: BrowserCheckRequest
  readonly deps: BrowserRunDeps
  readonly timings: BrowserTimings
}

/**
 * One canary phase on its own probe target (in the private context when
 * one is given): fresh nonces and fixture ports, exceptions bound to that
 * frame and revoked when it ends, then the verdict on its own records only.
 * Throws the confinement failure it finds.
 */
async function runPhase(
  context: CheckContext,
  phase: CanaryPhase,
  browserContextId: string | undefined,
  ms: number,
): Promise<void> {
  const { page, fixture, request, deps } = context
  const target = await orFail(
    fixture.open(deps.randomHex(BROWSER_CANARY_NONCE_BYTES)),
    'unverifiable',
  )
  const plan = phasePlan(phase, target, request.allowedHosts)
  const observations: ProxyObservation[] = []
  context.collect(observations)
  let isOver = false
  let report: ProbeReport | undefined
  const run = async (): Promise<void> => {
    const { sessionId } = await page.openTarget(browserContextId, true)
    const frameId = await page.mainFrame(sessionId)
    // A phase past its bound binds nothing: its exceptions stay revoked.
    if (isOver) {
      throw new CdpError('phase over')
    }
    page.bind({ frameId, urls: plan.exceptions })
    const raw = await page.probe(sessionId, plan.pageUrl, plan.script)
    // No probe page, no report: the phase's own failure below.
    if (raw === undefined) {
      return
    }
    const parsed = probeReportSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw)
    if (!parsed.success) {
      throw new CdpError('probe report: unexpected shape')
    }
    report = parsed.data
    // Let the proxy's last records land.
    await page.waitUntil(
      () => phaseVerdict(plan, observations, fixture, parsed.data) === undefined,
      BROWSER_CANARY_SETTLE_MS,
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([run(), late])
    // A probe page that never answered within the bound is a route not confirmed.
    const verdict =
      report === undefined
        ? MISSING_REPORT[phase]
        : phaseVerdict(plan, observations, fixture, report)
    if (verdict !== undefined) {
      fail(verdict)
    }
  } finally {
    isOver = true
    clearTimeout(timer)
    page.bind(undefined)
    context.collect(undefined)
  }
}

/** Starts the browser on the verified runtime: its identity read again first. */
async function launch(
  runtime: VerifiedRuntime,
  folder: CheckFolder,
  proxy: CheckProxy,
  deps: BrowserRunDeps,
  lifetime: BoundedLifetime,
): Promise<{ readonly browser: BrowserProcess; readonly args: readonly string[] }> {
  // The file that runs is the file that was verified.
  const identity = await lifetime.step(async () => await deps.statExecutable(runtime.executable))
  if (
    identity?.bytes !== runtime.executableBytes ||
    identity.mtimeMs !== runtime.executableMtimeMs
  ) {
    fail('runtimeIntegrity')
  }
  const args = browserLaunchArgs(proxy.endpoint, folder.profile)
  const env = browserEnvironment(deps.platform, deps.env, folder)
  let browser: BrowserProcess
  try {
    browser = deps.spawn(runtime.executable, args, env)
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
    return fail(code === 'EPERM' || code === 'EACCES' ? 'runtimeBlocked' : 'launch')
  }
  // A refusal that arrives after the spawn returned carries the same codes
  // as a thrown one.
  const code = await browser.spawnError
  return code === 'EPERM' || code === 'EACCES' ? fail('runtimeBlocked') : { browser, args }
}

/** The pin's contract: the exact product, the command line as launched, one blank page, the network service. */
async function holdToContract(
  page: PageCheck,
  runtime: VerifiedRuntime,
  args: readonly string[],
  options: BrowserHostOptions,
): Promise<number> {
  const { product } = await page.call('Browser.getVersion', versionSchema)
  if (product !== `${BROWSER_PRODUCT_PREFIX}${runtime.version}`) {
    fail('unrecognized')
  }
  const commandLine = await page.call('Browser.getBrowserCommandLine', commandLineSchema)
  const verdict = commandLineVerdict(commandLine.arguments, args)
  if (verdict.kind === 'resolver') {
    fail('resolverUnconfirmed')
  } else if (verdict.kind === 'unrecognized') {
    fail('unrecognized')
  }
  options.warn(
    `Browser check: command line held, ${String(verdict.unknownSwitches)} other switches`,
  )
  const { targetInfos } = await page.call('Target.getTargets', targetsSchema)
  const [first] = targetInfos
  const serviceId = await networkServiceId(page)
  if (
    serviceId === undefined ||
    targetInfos.length !== 1 ||
    first?.type !== 'page' ||
    first.url !== 'about:blank'
  ) {
    fail('unrecognized')
  }
  return serviceId
}

/** What `check` is told by its caller: how to end the whole check, and how it ends. */
interface CheckHooks {
  readonly connected: (connection: CdpConnection) => void
  readonly endWith: (failure: BrowserFailure) => void
  /** Whether the check came to its own end, so the browser may close itself. */
  readonly isGraceful: () => boolean
}

/**
 * The check inside its 60-second lifetime, after the runtime is ready.
 * Throws a CheckFailure, or rejects when the browser fails it.
 */
async function check(
  runtime: VerifiedRuntime,
  context: Pick<CheckContext, 'request' | 'deps' | 'timings'> & {
    readonly options: BrowserHostOptions
  },
  lifetime: BoundedLifetime,
  hooks: CheckHooks,
): Promise<BrowserCheckResult> {
  const { request, deps, timings, options } = context
  const folder = await orFail(
    lifetime.step(async () => await deps.createFolder(options.storageDir)),
    'profile',
  )
  lifetime.onEnd(async () => {
    await deps.removeFolder(folder)
  })
  const scope: FrozenScope = {
    url: request.url,
    explicitHosts: request.allowedHosts,
    approvalKey: request.approvalKey,
  }
  const proxy = await orFail(
    lifetime.step(async () => await deps.startProxy(scope)),
    'launch',
  )
  lifetime.onEnd(async () => {
    await proxy.close()
  })
  const fixture = await orFail(
    lifetime.step(async () => await deps.startFixture()),
    'unverifiable',
  )
  lifetime.onEnd(async () => {
    await fixture.close()
  })
  const { browser, args } = await launch(runtime, folder, proxy, deps, lifetime)
  const connection = new CdpConnection(browser.writer, browser.reader)
  hooks.connected(connection)
  lifetime.onEnd(async () => {
    if (hooks.isGraceful()) {
      void connection.send('Browser.close').catch(ignore)
      if (await hasExitedWithin(browser.exited, timings.closeGraceMs)) {
        return
      }
    }
    connection.close(new CdpError('the browser check has ended'))
    await browser.kill()
    await hasExitedWithin(browser.exited, timings.closeGraceMs)
  })
  const page = new PageCheck(connection, {
    request,
    timings,
    proxyPort: Number(new URL(proxy.endpoint).port),
    end: hooks.endWith,
  })
  // A phase reads only what arrived while it ran (and only what names it).
  let records: ProxyObservation[] | undefined
  proxy.observe((observation) => {
    if (records !== undefined && records.length < BROWSER_PROXY_MAX_OBSERVATIONS) {
      records.push(observation)
    }
    page.poke()
  })
  const serviceId = await holdToContract(page, runtime, args, options)
  await page.setup()
  const collect = (into: ProxyObservation[] | undefined): void => {
    records = into
  }
  const canary: CheckContext = { page, fixture, collect, request, deps, timings }
  const initialEnd = performance.now() + timings.initialCanaryMs
  const remaining = (): number => Math.min(timings.phaseMs, initialEnd - performance.now())
  await runPhase(canary, 'default', undefined, remaining())
  const { browserContextId } = await orFail(
    page.call('Target.createBrowserContext', contextSchema, {
      proxyServer: proxy.endpoint,
      proxyBypassList: BROWSER_PROXY_BYPASS,
      disposeOnDetach: true,
    }),
    'profile',
  )
  const { cookies } = await page.call('Storage.getCookies', cookiesSchema, { browserContextId })
  if (cookies.length > 0) {
    fail('profile')
  }
  await page.call('Browser.setDownloadBehavior', nothing, { behavior: 'deny', browserContextId })
  await runPhase(canary, 'page', browserContextId, remaining())
  const result = await page.runPage(browserContextId)
  if (!result.ok) {
    return result
  }
  await runPhase(canary, 'audit', browserContextId, timings.phaseMs)
  if ((await networkServiceId(page)) !== serviceId) {
    fail('restartObserved')
  }
  return result
}

// Ends after which the browser may close itself: the check came to its own
// end with the browser answering. Any other end kills it at once.
const GRACEFUL_ENDS: ReadonlySet<BrowserFailure['kind']> = new Set([
  'pageFailed',
  'pageBlocked',
  'noElement',
])

/** One check, from preparing the runtime to removing its folder. Never throws. */
export async function runBrowserCheck(
  deps: BrowserRunDeps,
  request: BrowserCheckRequest,
  options: BrowserHostOptions,
): Promise<BrowserCheckResult> {
  const before = refusalNow(request, options)
  if (before !== undefined) {
    return { ok: false, failure: before }
  }
  const timings = { ...DEFAULT_TIMINGS, ...deps.timings }
  const prepared = await prepare(request, options, timings)
  if (!('executable' in prepared)) {
    return { ok: false, failure: prepared }
  }
  // Ready: everything is read again before the check's own time starts.
  const ready = refusalNow(request, options)
  if (ready !== undefined) {
    return { ok: false, failure: ready }
  }
  const lifetime = createLifetime(
    timings.checkMs,
    [request.signal, options.admissionSignal],
    BROWSER_CHECK_TEARDOWN_MS,
  )
  let failure: BrowserFailure | undefined
  let isGraceful = false
  let connection: CdpConnection | undefined
  const endWith = (found: BrowserFailure): void => {
    if (lifetime.endedBy !== undefined) {
      return
    }

    failure = found
    lifetime.end()
  }
  // The first end closes the connection at once (unless the check came to
  // its own end): every waiting call is rejected and nothing more is sent.
  lifetime.signal.addEventListener('abort', () => {
    if (!isGraceful) {
      connection?.close(new CdpError('the browser check has ended'))
    }
  })
  const ended = new Promise<BrowserCheckResult>((resolve) => {
    lifetime.signal.addEventListener('abort', () => {
      resolve({
        ok: false,
        failure: failure ?? endedFailure(lifetime, request, options, 'timedOut'),
      })
    })
  })
  const checked = (async (): Promise<BrowserCheckResult> => {
    try {
      return await check(prepared, { request, deps, timings, options }, lifetime, {
        connected: (open) => {
          connection = open
          open.onClose(() => {
            endWith({ kind: 'browserFailed' })
          })
        },
        endWith,
        isGraceful: () => isGraceful,
      })
    } catch (error: unknown) {
      // Once the check has ended (a stop, admission, the deadline, a found
      // end), whatever that end rejected reports the end's own kind.
      if (lifetime.endedBy !== undefined) {
        return {
          ok: false,
          failure: failure ?? endedFailure(lifetime, request, options, 'timedOut'),
        }
      }
      return {
        ok: false,
        failure: error instanceof CheckFailure ? error.failure : { kind: 'browserFailed' },
      }
    }
  })()
  let result = await Promise.race([checked, ended])
  // Nothing from the page is returned once it was stopped or admission has gone.
  const after = result.ok ? refusalNow(request, options) : undefined
  if (after !== undefined) {
    result = { ok: false, failure: after }
  }
  isGraceful =
    lifetime.endedBy === undefined && (result.ok || GRACEFUL_ENDS.has(result.failure.kind))
  lifetime.end()
  await lifetime.cleaned
  // A stop or lost admission during teardown still refuses the page: the end
  // above detached the joined signals, so this is read again.
  const late = result.ok ? refusalNow(request, options) : undefined
  if (late !== undefined) {
    result = { ok: false, failure: late }
  }
  return result
}
