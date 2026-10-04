// Code intelligence's answers as the activation bundle sees them (M67,
// PLAN.md D6): dist/codeIntel.js, built from codeIntelEntry.ts and required
// on the first `ide` code intelligence call. Only types come from the
// queries' side here: a value imported from there would carry them back
// into dist/extension.js, which the bundle-split gate refuses.
//
// There is no fallback without it: a call that cannot load it is answered
// with `MODEL_TEXT.codeIntelUnavailable` as an error result (the log has the
// cause), and the next call tries again.

import { MODEL_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as CodeIntelEntry from './codeIntelEntry'

/** The bundle's one export. */
export interface CodeIntelBundle {
  readonly callCodeIntel: typeof CodeIntelEntry.callCodeIntel
}

/** Whether a required module exports the call. */
export function isCodeIntelBundle(value: unknown): value is CodeIntelBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'callCodeIntel' in value &&
    typeof value.callCodeIntel === 'function'
  )
}

export interface CodeIntelLoaderDeps {
  /** dist/codeIntel.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first call and kept from then on. */
export function codeIntelLoader(deps: CodeIntelLoaderDeps): () => CodeIntelBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isCodeIntelBundle,
    label: 'code intelligence bundle',
    unavailable: () => MODEL_TEXT.codeIntelUnavailable,
  })
}
