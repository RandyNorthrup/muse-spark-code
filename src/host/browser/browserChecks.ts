// The window's browser checks (M81, PLAN.md D49), in the activation bundle:
// the browser's own bundle, dist/browserCheck.js, loaded on the first check
// as the checkpoint store's is (PLAN.md D6), and every check under way ended
// when the window closes. Both backends run their checks through here: the
// Model API's `browser_check` and Muse Code's `mcp__ide__browserCheck`.

import type {
  BrowserChecker,
  BrowserCheckRequest,
  BrowserCheckResult,
} from '../../core/browser/browserRun'
import { forgetFile, requireFile } from '../lazyBundle'
import type { Logger } from '../logger'

interface BrowserCheckBundle {
  readonly runBrowserCheck: (
    request: BrowserCheckRequest,
    warn: (message: string) => void,
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

export interface BrowserChecksDeps {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

export class BrowserChecks {
  private bundle: BrowserCheckBundle | undefined
  private readonly closing = new AbortController()

  /** One check, ended by its caller or by the window closing; never throws. */
  public readonly check: BrowserChecker = async (request) => {
    if (this.closing.signal.aborted) {
      return { ok: false, failure: { kind: 'cancelled' } }
    }
    const bundle = this.load()
    if (bundle === undefined) {
      return { ok: false, failure: { kind: 'launch' } }
    }
    const signal = AbortSignal.any([request.signal, this.closing.signal])
    return await bundle.runBrowserCheck({ ...request, signal }, (message) => {
      this.deps.log.warn(message)
    })
  }

  public constructor(private readonly deps: BrowserChecksDeps) {}

  /** Missing or malformed: refused this time; a later check reads a repaired file again. */
  private load(): BrowserCheckBundle | undefined {
    if (this.bundle !== undefined) {
      return this.bundle
    }
    const { bundlePath, loadBundle = requireFile } = this.deps
    let loaded: unknown
    try {
      loaded = loadBundle(bundlePath)
    } catch {
      this.deps.log.error(`The browser check ${bundlePath} could not be loaded`)
      return undefined
    }
    if (!isBrowserCheckBundle(loaded)) {
      this.deps.log.error(`${bundlePath} does not export the browser check`)
      if (this.deps.loadBundle === undefined) {
        forgetFile(bundlePath)
      }
      return undefined
    }
    this.bundle = loaded
    return loaded
  }

  /** The window is closing: every check under way ends, its browser killed. */
  public dispose(): void {
    this.closing.abort()
  }
}
