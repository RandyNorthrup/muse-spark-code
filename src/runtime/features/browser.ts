import type { BrowserCheckHost } from '../../core/browser/browserTool'
import type { BrowserCheckResult, BrowserChecker } from '../../core/browser/browserRun'
import { BrowserChecks, type BrowserChecksDeps } from '../../host/browser/browserChecks'

export interface RuntimeBrowserDeps extends BrowserChecksDeps {
  readonly assertCurrent: () => void
  /** Live trust, network policy, held-worktree ceiling and selected tool support. */
  readonly isAllowed: () => boolean
  readonly canReadScreenshots: () => boolean
  readonly extraHosts: () => readonly string[]
  readonly beforeWorkspaceProcessStart: (signal: AbortSignal) => Promise<void>
}
function unavailable(): BrowserCheckResult {
  return { ok: false, failure: { kind: 'notOffered' } }
}

/** Uses only the existing verified pinned browser bundles, with native download consent. */
export function createRuntimeBrowser(deps: RuntimeBrowserDeps) {
  const checks = new BrowserChecks(deps)
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  const isOffered = () => {
    if (ending.signal.aborted || !deps.isAllowed() || !checks.isOffered()) return false
    try {
      deps.assertCurrent()
      return true
    } catch {
      return false
    }
  }
  const check: BrowserChecker = async (request, admission) => {
    if (!isOffered()) return unavailable()
    const signal = AbortSignal.any([request.signal, ending.signal])
    const guard = () => (isOffered() ? admission() : 'notOffered')
    const work = (async (): Promise<BrowserCheckResult> => {
      signal.throwIfAborted()
      if (guard() !== 'ok') return unavailable()
      await deps.beforeWorkspaceProcessStart(signal)
      signal.throwIfAborted()
      if (guard() !== 'ok') return unavailable()
      const shouldIncludeScreenshot = request.includeScreenshot && deps.canReadScreenshots()
      const result = await checks.check(
        { ...request, includeScreenshot: shouldIncludeScreenshot, signal },
        guard,
      )
      signal.throwIfAborted()
      if (guard() !== 'ok') return unavailable()
      return result.ok && (!shouldIncludeScreenshot || !deps.canReadScreenshots())
        ? { ...result, report: { ...result.report, screenshot: undefined } }
        : result
    })()
    pending.add(work)
    try {
      return await work
    } finally {
      pending.delete(work)
    }
  }
  const host: BrowserCheckHost = { check, isOffered, extraHosts: deps.extraHosts }
  return {
    host,
    dispose: (): Promise<void> => {
      ending.abort()
      checks.dispose()
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
