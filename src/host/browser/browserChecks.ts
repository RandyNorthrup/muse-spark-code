// The window's browser checks (M81 A1, PLAN.md D49; design spec v4 §§4.1,
// 6.3, 9.1), in the activation bundle. Two bundles of their own, each
// loaded on first use as the checkpoint store's is (PLAN.md D6), each
// trusted only as this build's own (PLAN.md §8): dist/browserCheck.js runs
// a check; dist/browserRuntime.js prepares and verifies the pinned runtime,
// for a check and for the Download command alike (one installer).
//
// Consent is the host's (lead ruling v4-M1): the runtime adapter injects
// the native question, or answers Download itself when the user set
// `museSpark.browserCheckRuntime` to `download`; `off` offers no check.
// Admission is joined here: the caller's own predicate (trust, mode,
// network posture, the frozen scope), the runtime setting and the window,
// watched by events and read every 250 ms, so its loss aborts a check or a
// preparation under way, not merely its result. Every check under way ends
// when the window closes.

import type {
  BrowserChecker,
  BrowserCheckRequest,
  BrowserCheckResult,
  BrowserHostOptions,
  CheckAdmission,
} from '../../core/browser/browserRun'
import type {
  BrowserRuntimeBundle,
  RuntimeConsent,
  RuntimePreparation,
  RuntimePrepareRequest,
} from '../../core/browser/runtimeTypes'
import { createLifetime } from '../../core/browser/workLifetime'
import {
  BROWSER_RUNTIME_CLEANUP_MS,
  BROWSER_RUNTIME_PREPARATION_MS,
  type BrowserRuntimeMode,
} from '../../shared/constants'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'

interface BrowserCheckBundle {
  readonly runBrowserCheck: (
    request: BrowserCheckRequest,
    options: BrowserHostOptions,
  ) => Promise<BrowserCheckResult>
}

/** Its signature is trusted only for our same-build packaged module (PLAN.md §8). */
export function isBrowserCheckBundle(value: unknown): value is BrowserCheckBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runBrowserCheck' in value &&
    typeof value.runBrowserCheck === 'function'
  )
}

/** Its signature is trusted only for our same-build packaged module (PLAN.md §8). */
export function isBrowserRuntimeBundle(value: unknown): value is BrowserRuntimeBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'prepareRuntime' in value &&
    typeof value.prepareRuntime === 'function'
  )
}

export interface BrowserChecksDeps {
  readonly checkBundlePath: string
  readonly runtimeBundlePath: string
  /** The extension's global storage folder. */
  readonly storageDir: string
  readonly log: Logger
  /** `museSpark.browserCheckRuntime`, read at each use. */
  readonly runtimeMode: () => BrowserRuntimeMode
  /** The native question before a download (runtimeConsent.ts). */
  readonly askConsent: RuntimeConsent
  /** Told when trust, a setting or a mode may have changed; returns its unsubscribe. */
  readonly onAdmissionChange: (listener: () => void) => () => void
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

// How often admission is read while a check or a preparation runs.
const ADMISSION_POLL_MS = 250

const answerDownload: RuntimeConsent = () => Promise.resolve('download' as const)

export class BrowserChecks {
  private readonly bundles = new Map<string, unknown>()
  private readonly closing = new AbortController()

  /** One check, ended by its caller, by admission or by the window closing; never throws. */
  public readonly check: BrowserChecker = async (request, admission) => {
    if (this.closing.signal.aborted || request.signal.aborted) {
      return { ok: false, failure: { kind: 'cancelled' } }
    }
    if (!this.isOffered()) {
      return { ok: false, failure: { kind: 'notOffered' } }
    }
    const bundle = this.load(this.deps.checkBundlePath, isBrowserCheckBundle)
    if (bundle === undefined) {
      return { ok: false, failure: { kind: 'launch' } }
    }
    const watch = this.watchAdmission(admission)
    try {
      return await bundle.runBrowserCheck(
        { ...request, signal: AbortSignal.any([request.signal, this.closing.signal]) },
        {
          storageDir: this.deps.storageDir,
          prepareRuntime: async (prepare) => await this.prepare(prepare),
          admissionSignal: watch.signal,
          admissionStillValid: watch.isValid,
          warn: (fact) => {
            this.deps.log.warn(fact)
          },
        },
      )
    } finally {
      watch.stop()
    }
  }

  public constructor(private readonly deps: BrowserChecksDeps) {}

  /** The runtime adapter: the lazy runtime bundle, with the host's own consent. */
  private async prepare(
    request: Omit<RuntimePrepareRequest, 'consent'>,
  ): Promise<RuntimePreparation> {
    const runtime = this.load(this.deps.runtimeBundlePath, isBrowserRuntimeBundle)
    if (runtime === undefined) {
      return { ok: false, reason: 'runtimeMissing' }
    }
    const consent = this.deps.runtimeMode() === 'download' ? answerDownload : this.deps.askConsent
    return await runtime.prepareRuntime({ ...request, consent })
  }

  /**
   * Admission as a signal: ended, with its reason, as soon as the caller's
   * predicate, the runtime setting or the window says no.
   */
  private watchAdmission(admission: CheckAdmission): {
    readonly signal: AbortSignal
    readonly isValid: () => boolean
    readonly stop: () => void
  } {
    const controller = new AbortController()
    const isValid = (): boolean => {
      if (controller.signal.aborted) {
        return false
      }
      const verdict = this.isOffered() && !this.closing.signal.aborted ? admission() : 'notOffered'
      if (verdict !== 'ok') {
        controller.abort(verdict)
        return false
      }
      return true
    }
    const timer = setInterval(isValid, ADMISSION_POLL_MS)
    const unsubscribe = this.deps.onAdmissionChange(() => {
      isValid()
    })
    return {
      signal: controller.signal,
      isValid,
      stop: () => {
        clearInterval(timer)
        unsubscribe()
      },
    }
  }

  /** Missing or malformed: refused this time; a later use reads a repaired file again. */
  private load<T>(file: string, isBundle: (value: unknown) => value is T): T | undefined {
    const known = this.bundles.get(file)
    if (known !== undefined && isBundle(known)) {
      return known
    }
    const { loadBundle = requireFile } = this.deps
    let loaded: unknown
    try {
      loaded = loadBundle(file)
    } catch {
      this.deps.log.error('Browser check: a bundle of the browser check could not be loaded')
      return undefined
    }
    if (!isBundle(loaded)) {
      this.deps.log.error(
        'Browser check: a bundle of the browser check does not export its function',
      )
      if (this.deps.loadBundle === undefined) {
        forgetFile(file)
      }
      return undefined
    }
    this.bundles.set(file, loaded)
    return loaded
  }

  /** Whether the user has the browser check on at all (`off` offers none). */
  public isOffered(): boolean {
    return this.deps.runtimeMode() !== 'off'
  }

  /**
   * The Download command: the same runtime entry and preparation lifetime
   * as a check, without any page. Never throws.
   */
  public async prepareOnly(
    signal: AbortSignal,
    admission: CheckAdmission,
  ): Promise<RuntimePreparation> {
    if (!this.isOffered()) {
      return { ok: false, reason: 'notOffered' }
    }
    const watch = this.watchAdmission(admission)
    const lifetime = createLifetime(
      BROWSER_RUNTIME_PREPARATION_MS,
      [signal, this.closing.signal, watch.signal],
      BROWSER_RUNTIME_CLEANUP_MS,
    )
    try {
      return await this.prepare({
        storageDir: this.deps.storageDir,
        lifetime,
        admissionStillValid: watch.isValid,
      })
    } finally {
      lifetime.end()
      await lifetime.cleaned
      watch.stop()
    }
  }

  /** The window is closing: every check and preparation under way ends, its browser killed. */
  public dispose(): void {
    this.closing.abort()
  }
}
