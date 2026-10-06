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
import { admitResource, resourceWindowsJob } from '../../core/resources/admission'
import type { ResourceLease } from '../../core/resources/launch'

/** One check on the verified runtime (design spec v4 §5's frozen signature). */
export async function runBrowserCheck(
  request: BrowserCheckRequest,
  options: BrowserHostOptions,
): Promise<BrowserCheckResult> {
  const resource = await admitResource(
    'browserCheck',
    AbortSignal.any([request.signal, options.admissionSignal]),
  )
  if (!options.admissionStillValid()) {
    resource?.complete(true)
    return { ok: false, failure: { kind: 'cancelled' } }
  }
  let wasSpawned = false
  const processResource: ResourceLease | undefined =
    resource === undefined
      ? undefined
      : {
          register: (launch) => {
            wasSpawned = true
            resource.register(launch)
          },
          complete: (isTreeGone) => {
            resource.complete(isTreeGone)
          },
          background: () => {
            resource.background()
          },
        }
  try {
    const windowsJob =
      resource === undefined || process.platform !== 'win32'
        ? undefined
        : await resourceWindowsJob()
    if (!options.admissionStillValid()) return { ok: false, failure: { kind: 'cancelled' } }
    if (resource !== undefined && windowsJob === undefined && process.platform === 'win32')
      return { ok: false, failure: { kind: 'browserFailed' } }
    return await runCheck(
      hostBrowserRunDeps({
        platform: process.platform,
        env: process.env,
        warn: options.warn,
        resource: processResource,
        windowsJob,
      }),
      request,
      options,
    )
  } finally {
    resource?.complete(!wasSpawned)
  }
}
