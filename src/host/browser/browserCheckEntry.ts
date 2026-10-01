// The browser check's own bundle (M81, PLAN.md D6, D49), dist/browserCheck.js
// beside dist/extension.js: the pipe, the run and the browser's processes,
// required by the activation bundle on the first check (browserChecks.ts),
// never at activation. It carries no text the user reads: what a check
// found or why it failed goes back as data, and each backend words it.

import {
  type BrowserCheckRequest,
  type BrowserCheckResult,
  runBrowserCheck as runCheck,
} from '../../core/browser/browserRun'
import { hostBrowserRunDeps } from './browserProcess'

/** One check with the system browser; `warn` reaches the extension's log. */
export async function runBrowserCheck(
  request: BrowserCheckRequest,
  warn: (message: string) => void,
): Promise<BrowserCheckResult> {
  return await runCheck(
    hostBrowserRunDeps({ platform: process.platform, env: process.env, warn }),
    request,
  )
}
