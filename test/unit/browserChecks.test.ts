// The window's browser checks (M81 A1, PLAN.md D49): the check's bundle and
// the runtime's bundle each loaded on first use and trusted only as this
// build's own, the host's consent injected (never the runner's), the
// runtime setting obeyed, admission watched by events and read while a
// check runs, the Download command on the same runtime entry, and every
// check under way ended when the window closes.
import { describe, expect, it, vi } from 'vitest'
import type {
  BrowserCheckRequest,
  BrowserCheckResult,
  BrowserHostOptions,
  CheckAdmission,
} from '../../src/core/browser/browserRun'
import type { RuntimePreparation, RuntimePrepareRequest } from '../../src/core/browser/runtimeTypes'
import {
  BrowserChecks,
  isBrowserCheckBundle,
  isBrowserRuntimeBundle,
} from '../../src/host/browser/browserChecks'
import type { BrowserRuntimeMode } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

const CHECK = '/ext/dist/browserCheck.js'
const RUNTIME = '/ext/dist/browserRuntime.js'

function request(signal = new AbortController().signal): BrowserCheckRequest {
  return {
    url: 'http://localhost/',
    actions: [],
    allowedHosts: [],
    approvalKey: 'key',
    includeScreenshot: true,
    signal,
  }
}

interface Harness {
  readonly checks: BrowserChecks
  readonly loads: string[]
  readonly options: BrowserHostOptions[]
  readonly prepared: RuntimePrepareRequest[]
  readonly askConsent: ReturnType<typeof vi.fn>
  readonly change: () => void
  mode: BrowserRuntimeMode
}

/**
 * A check bundle whose run prepares the runtime through the adapter, then
 * waits for its signal or its admission to end; a runtime bundle that
 * records what it was asked and asks the consent it was given.
 */
const DECLINED: RuntimePreparation = { ok: false, reason: 'runtimeDeclined' }
const NO_BUNDLES: { check?: unknown; runtime?: unknown } = {}

function noUnsubscribe(): void {
  // The fake admission source has nothing to stop.
}

function harness(
  bundles: { check?: unknown; runtime?: unknown } = NO_BUNDLES,
  preparation: RuntimePreparation = DECLINED,
): Harness {
  const loads: string[] = []
  const options: BrowserHostOptions[] = []
  const prepared: RuntimePrepareRequest[] = []
  const listeners = new Set<() => void>()
  const askConsent = vi.fn(() => Promise.resolve<'download' | 'decline'>('decline'))
  const state = { mode: 'ask' as BrowserRuntimeMode }
  const check = {
    runBrowserCheck: async (
      checked: BrowserCheckRequest,
      host: BrowserHostOptions,
    ): Promise<BrowserCheckResult> => {
      options.push(host)
      const lifetime = {
        signal: checked.signal,
        deadlineAt: 0,
        step: async <T>(run: (signal: AbortSignal) => Promise<T>) => await run(checked.signal),
        onEnd: () => undefined,
        end: () => undefined,
      }
      await host.prepareRuntime({
        storageDir: host.storageDir,
        lifetime,
        admissionStillValid: host.admissionStillValid,
      })
      return await new Promise((resolve) => {
        const done = (): void => {
          resolve({
            ok: false,
            failure: { kind: checked.signal.aborted ? 'cancelled' : 'notOffered' },
          })
        }
        if (checked.signal.aborted || host.admissionSignal.aborted) {
          done()
          return
        }
        checked.signal.addEventListener('abort', done)
        host.admissionSignal.addEventListener('abort', done)
      })
    },
  }
  const runtime = {
    prepareRuntime: async (asked: RuntimePrepareRequest): Promise<RuntimePreparation> => {
      prepared.push(asked)
      await asked.consent('154.0.8037.92', 120_000_000, asked.lifetime.signal)
      return preparation
    },
  }
  const checks = new BrowserChecks({
    checkBundlePath: CHECK,
    runtimeBundlePath: RUNTIME,
    storageDir: '/global-storage',
    log: new FakeLogOutputChannel(),
    runtimeMode: () => state.mode,
    askConsent,
    onAdmissionChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    loadBundle: (file) => {
      loads.push(file)
      if (file === CHECK) {
        return 'check' in bundles ? bundles.check : check
      }
      return 'runtime' in bundles ? bundles.runtime : runtime
    },
  })
  return {
    checks,
    loads,
    options,
    prepared,
    askConsent,
    change: () => {
      for (const listener of listeners) {
        listener()
      }
    },
    get mode() {
      return state.mode
    },
    set mode(value) {
      state.mode = value
    },
  }
}

const admitted: CheckAdmission = () => 'ok'

/** A check started on `t`, once its runtime preparation was asked for. */
async function preparing(
  t: Harness,
): Promise<{ readonly stop: AbortController; readonly running: Promise<unknown> }> {
  const stop = new AbortController()
  const running = t.checks.check(request(stop.signal), admitted)
  await vi.waitFor(() => {
    expect(t.prepared).toHaveLength(1)
  })
  return { stop, running }
}

describe('the browser check’s bundles (M81 A1)', () => {
  it('loads the check bundle on the first check, and the runtime bundle only when the runtime is prepared', async () => {
    const t = harness()
    expect(t.loads).toEqual([])
    const stop = new AbortController()
    const running = t.checks.check(request(stop.signal), admitted)
    await vi.waitFor(() => {
      expect(t.loads).toEqual([CHECK, RUNTIME])
    })
    stop.abort()
    await expect(running).resolves.toEqual({ ok: false, failure: { kind: 'cancelled' } })
    // Once each.
    const again = new AbortController()
    const second = t.checks.check(request(again.signal), admitted)
    again.abort()
    await second
    expect(t.loads).toEqual([CHECK, RUNTIME])
  })

  it('gives the runner the host options of spec §5, and the runtime the host’s own consent', async () => {
    const t = harness()
    const { stop, running } = await preparing(t)
    expect(t.options[0]?.storageDir).toBe('/global-storage')
    expect(t.prepared[0]?.storageDir).toBe('/global-storage')
    expect(t.askConsent).toHaveBeenCalledWith('154.0.8037.92', 120_000_000, expect.any(AbortSignal))
    stop.abort()
    await running
  })

  it('answers Download itself when the user chose to download without asking', async () => {
    const t = harness()
    t.mode = 'download'
    const { stop, running } = await preparing(t)
    expect(t.askConsent).not.toHaveBeenCalled()
    await expect(t.prepared[0]?.consent('v', 1, new AbortController().signal)).resolves.toBe(
      'download',
    )
    stop.abort()
    await running
  })

  it('offers nothing, and loads nothing, while the runtime setting is off', async () => {
    const t = harness()
    t.mode = 'off'
    expect(t.checks.isOffered()).toBe(false)
    await expect(t.checks.check(request(), admitted)).resolves.toEqual({
      ok: false,
      failure: { kind: 'notOffered' },
    })
    await expect(t.checks.prepareOnly(new AbortController().signal, admitted)).resolves.toEqual({
      ok: false,
      reason: 'notOffered',
    })
    expect(t.loads).toEqual([])
  })

  it('ends a check under way when its admission goes, read every 250 ms and at each change, with its reason', async () => {
    const t = harness()
    let verdict: ReturnType<CheckAdmission> = 'ok'
    const running = t.checks.check(request(), () => verdict)
    await vi.waitFor(() => {
      expect(t.options).toHaveLength(1)
    })
    verdict = 'scopeChanged'
    t.change()
    await expect(running).resolves.toEqual({ ok: false, failure: { kind: 'notOffered' } })
    expect(t.options[0]?.admissionSignal.reason).toBe('scopeChanged')
    expect(t.options[0]?.admissionStillValid()).toBe(false)

    // The setting turned off mid-check: the poll ends it without an event.
    const polled = harness()
    const second = polled.checks.check(request(), admitted)
    await vi.waitFor(() => {
      expect(polled.options).toHaveLength(1)
    })
    polled.mode = 'off'
    await expect(second).resolves.toEqual({ ok: false, failure: { kind: 'notOffered' } })
    expect(polled.options[0]?.admissionSignal.reason).toBe('notOffered')
  })

  it('refuses a missing or malformed bundle this time, and reads a repaired one again later', async () => {
    let attempt = 0
    const loads: string[] = []
    const checks = new BrowserChecks({
      checkBundlePath: CHECK,
      runtimeBundlePath: RUNTIME,
      storageDir: '/s',
      log: new FakeLogOutputChannel(),
      runtimeMode: () => 'ask',
      askConsent: () => Promise.resolve('decline'),
      onAdmissionChange: () => noUnsubscribe,
      loadBundle: (file) => {
        loads.push(file)
        attempt += 1
        if (attempt === 1) {
          throw new Error('ENOENT')
        }
        return { runBrowserCheck: 'nope' }
      },
    })
    await expect(checks.check(request(), admitted)).resolves.toEqual({
      ok: false,
      failure: { kind: 'launch' },
    })
    await expect(checks.check(request(), admitted)).resolves.toEqual({
      ok: false,
      failure: { kind: 'launch' },
    })
    expect(loads).toEqual([CHECK, CHECK])

    const noRuntime = harness({ runtime: { prepareRuntime: 'nope' } })
    noRuntime.mode = 'download'
    await expect(
      noRuntime.checks.prepareOnly(new AbortController().signal, admitted),
    ).resolves.toEqual({
      ok: false,
      reason: 'runtimeMissing',
    })
  })

  it('checks each bundle’s one function, not its types (PLAN.md §8)', () => {
    expect(isBrowserCheckBundle({ runBrowserCheck: () => undefined })).toBe(true)
    expect(isBrowserCheckBundle({ runBrowserCheck: 1 })).toBe(false)
    expect(isBrowserCheckBundle(null)).toBe(false)
    expect(isBrowserRuntimeBundle({ prepareRuntime: () => undefined })).toBe(true)
    expect(isBrowserRuntimeBundle({})).toBe(false)
  })

  it('prepares the runtime alone for the Download command, on the same entry and its own lifetime', async () => {
    const ready: RuntimePreparation = {
      ok: true,
      runtime: {
        version: '154.0.8037.92',
        platform: 'linux64',
        executable: '/s/browser-runtime/x',
        manifestDigest: 'm',
        executableDigest: 'e',
        executableBytes: 1,
        executableMtimeMs: 1,
        publishedAtMs: 1,
      },
    }
    const t = harness({}, ready)
    await expect(t.checks.prepareOnly(new AbortController().signal, admitted)).resolves.toEqual(
      ready,
    )
    expect(t.loads).toEqual([RUNTIME])
    expect(t.prepared[0]?.lifetime.signal.aborted).toBe(true)
  })

  it('ends every check under way when the window closes, and refuses any asked later', async () => {
    const t = harness()
    const running = t.checks.check(request(), admitted)
    await vi.waitFor(() => {
      expect(t.options).toHaveLength(1)
    })
    t.checks.dispose()
    await expect(running).resolves.toEqual({ ok: false, failure: { kind: 'cancelled' } })
    await expect(t.checks.check(request(), admitted)).resolves.toEqual({
      ok: false,
      failure: { kind: 'cancelled' },
    })
  })
})
