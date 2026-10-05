// The browser check's own bundle (M81 A1, PLAN.md D6, D49),
// dist/browserCheck.js beside dist/extension.js: the pipe, the run, the
// proxy, the canaries and the browser's processes, required by the
// activation bundle on the first check (browserChecks.ts), never at
// activation. The runtime's acquisition is not here: it is
// dist/browserRuntime.js, reached only through `options.prepareRuntime`.
// It carries no text the user reads: what a check found or why it failed
// goes back as data, and each backend words it.

import {
  type BrowserCheckRequest,
  type BrowserCheckResult,
  type BrowserHostOptions,
  runBrowserCheck as runCheck,
} from '../../core/browser/browserRun'
import { hostBrowserRunDeps } from './browserProcess'

/** One check on the verified runtime (design spec v4 §5's frozen signature). */
export async function runBrowserCheck(
  request: BrowserCheckRequest,
  options: BrowserHostOptions,
): Promise<BrowserCheckResult> {
  return await runCheck(
    hostBrowserRunDeps({ platform: process.platform, env: process.env, warn: options.warn }),
    request,
    options,
  )
}
