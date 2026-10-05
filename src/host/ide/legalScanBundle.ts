// The legal scanner as the activation bundle sees it (M97, PLAN.md D76,
// D6): dist/legalScan.js, the shared production scanner entry,
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
import { isLegalScanBundle, type LegalScanBundle } from '../../shared/legalScanEntry'
export { isLegalScanBundle } from '../../shared/legalScanEntry'

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
