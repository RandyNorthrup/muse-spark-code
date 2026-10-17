// The browser check's runtime acquisition (M81 A1, PLAN.md D6, D49; design
// spec v4 §9.1), dist/browserRuntime.js beside dist/extension.js: the pin
// manifest, the downloader, the bounded ZIP reader, hashing, staging,
// publication and verification. The activation bundle requires it lazily
// (browserChecks.ts) when a check or the Download command needs a runtime
// prepared or verified; the check bundle never imports it. The pin is
// built in: what this release verifies against is what it shipped.

import type { RuntimePreparation, RuntimePrepareRequest } from '../../core/browser/runtimeTypes'
import manifest from './runtime/browserRuntime.json'
import { prepareRuntime as prepare } from './runtime/runtimeStore'

/** The runtime for this machine, verified against the pin, or the closed reason there is none. */
export async function prepareRuntime(request: RuntimePrepareRequest): Promise<RuntimePreparation> {
  return await prepare(request, {
    platform: process.platform,
    arch: process.arch,
    now: () => Date.now(),
    // VS Code's fetch at each call: its proxy, certificates and settings.
    fetch: async (url, init) => await globalThis.fetch(url, init),
    manifest,
  })
}
