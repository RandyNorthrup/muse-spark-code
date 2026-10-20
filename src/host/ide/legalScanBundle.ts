import type { explainLegal } from '../../core/paid/legalExplanation'
import type { UiText } from '../../shared/l10n/en'
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

import { uiLocale } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import {
  isLegalFixBundle,
  isLegalScanBundle,
  type LegalFixBundle,
  type LegalScanBundle,
} from '../../shared/legalScanEntry'
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
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isLegalScanBundle,
    label: 'legal scanner',
    unavailable: () => UI_TEXT.legalScanUnavailable,
  })
  return () => {
    const bundle = load()
    bundle.setLanguage?.(UI_TEXT, uiLocale())
    return bundle
  }
}

export interface LegalFixLoaderDeps {
  /** dist/legalFix.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The header-fix planner, required on the first fix request and kept from then on. */
export function legalFixLoader(deps: LegalFixLoaderDeps): () => LegalFixBundle {
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isLegalFixBundle,
    label: 'legal fix',
    unavailable: () => UI_TEXT.legalFixRefusedUnavailable,
  })
  return () => load()
}

interface LegalExplanationBundle {
  readonly explainLegal: typeof explainLegal
  readonly setLegalExplanationLanguage: (table: UiText, locale: string) => void
}
function isExplanationBundle(value: unknown): value is LegalExplanationBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'explainLegal' in value &&
    typeof value.explainLegal === 'function' &&
    'setLegalExplanationLanguage' in value &&
    typeof value.setLegalExplanationLanguage === 'function'
  )
}
export function legalExplanationLoader(deps: LegalScanLoaderDeps): typeof explainLegal {
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isExplanationBundle,
    label: 'paid legal explanation',
    unavailable: () => UI_TEXT.legalExplainUnavailable,
  })
  return async (result, ports, signal) => {
    const bundle = load()
    bundle.setLegalExplanationLanguage(UI_TEXT, uiLocale())
    return await bundle.explainLegal(result, ports, signal)
  }
}
