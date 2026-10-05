// The legal scanner as the activation bundle sees it (M97, PLAN.md D76,
// D6): dist/legalScan.js, lane S's scanner built from its entry by lane R,
// required on the first legal scan. Only types come from the tool's side
// here: a value imported from the entry would carry the scanner back into
// dist/extension.js, which the bundle-split gate refuses. The bundle's shape
// is checked structurally (signatures taken on trust, PLAN.md §8), as the
// bundled-skills installer's is.
//
// There is no fallback without it: a scan that cannot load it is refused
// with `legalScanUnavailable` (the log has the cause), and the next scan
// tries again.

import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as LegalScanEntry from './legalScanEntry'

/**
 * The scanner bundle's exports: lane 0's contract in and out, and the
 * Plan-mode hold a live Muse Code conversation takes for a scan (M70's
 * hold, D76). Both are required: a bundle without the hold would scan a
 * live conversation unheld.
 */
export interface LegalScanBundle {
  readonly runLegalScan: typeof LegalScanEntry.runLegalScan
  readonly createHold: typeof LegalScanEntry.createHold
}

/** Whether a required module exports the scan and the hold. */
export function isLegalScanBundle(value: unknown): value is LegalScanBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runLegalScan' in value &&
    typeof value.runLegalScan === 'function' &&
    'createHold' in value &&
    typeof value.createHold === 'function'
  )
}

export interface LegalScanLoaderDeps {
  /** dist/legalScan.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The scanner, required on the first scan and kept from then on. */
export function legalScanLoader(deps: LegalScanLoaderDeps): () => LegalScanBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isLegalScanBundle,
    label: 'legal scanner',
    unavailable: () => UI_TEXT.legalScanUnavailable,
  })
}
