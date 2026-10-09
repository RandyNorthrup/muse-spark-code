import type { BrowserCheckResult } from '../../../src/core/browser/browserRun'

/** Internal browser report fixture; it is never a captured provider response. */
export function browserReport(shouldIncludeScreenshot = false): BrowserCheckResult {
  return {
    ok: true,
    report: {
      finalUrl: 'http://localhost/',
      consoleErrors: { shown: [], more: 0 },
      failedRequests: { shown: [], more: 0 },
      blockedRequests: { shown: [], more: 0 },
      screenshot: shouldIncludeScreenshot
        ? { png: new Uint8Array([1]), width: 1, height: 1 }
        : undefined,
    },
  }
}
