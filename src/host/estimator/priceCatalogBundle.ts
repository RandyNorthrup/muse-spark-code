// The estimator's price port as the activation bundle sees it (M117
// C-M117-4R2, PLAN.md D6): dist/estimatePrices.js, built from
// priceCatalogEntry.ts and required the first time an estimate looks up
// prices. Only types come from the entry here: a value imported from there
// would carry the report network stack back into dist/extension.js, which the
// bundle-split gate (scripts/check-bundle-split.mjs) refuses.
//
// A missing or corrupt bundle refuses with its own safe diagnostic: a
// packaging/load failure must never look like a catalog without prices.
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { fixedMessageLog, lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { ExtensionSettings } from '../settings'
import type { ReportNetworkPolicy } from '../../core/reporting/sources/cache'
import { SANDBOX_NETWORK_DENIED } from '../../shared/constants'
import type * as PriceCatalogEntry from './priceCatalogEntry'

type CreatePort = typeof PriceCatalogEntry.createEstimatePricePort

/** Whether a required module is the price catalog bundle (PLAN.md §8). */
export function isPriceCatalogBundle(value: unknown): value is {
  readonly createEstimatePricePort: CreatePort
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createEstimatePricePort' in value &&
    typeof value.createEstimatePricePort === 'function'
  )
}

export interface PriceCatalogLoaderDeps {
  /** dist/estimatePrices.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** Loads on first use, keeps a valid bundle and retries failed loads. */
export function lazyPriceCatalog(deps: PriceCatalogLoaderDeps): {
  createEstimatePricePort: CreatePort
} {
  const load = lazyBundleLoader({
    ...deps,
    log: fixedMessageLog({
      log: deps.log,
      loadFailed: 'The price catalog bundle could not be loaded',
      wrongShape: 'The price catalog bundle could not be loaded',
    }),
    isBundle: isPriceCatalogBundle,
    label: 'price catalog',
    unavailable: () => fill(UI_TEXT.estimateFailed, { detail: 'price-catalog-bundle-unavailable' }),
  })
  return { createEstimatePricePort: (portDeps) => load().createEstimatePricePort(portDeps) }
}

/** The same live policy serves snapshot/report evidence and price sockets. */
export function estimatorNetworkPolicy(deps: {
  readonly settings: () => Pick<ExtensionSettings, 'reports.network' | 'sandboxNetwork'>
  readonly isTrusted: () => boolean
  readonly isSignedIn: () => boolean
}): ReportNetworkPolicy {
  const policy: ReportNetworkPolicy = {
    surface: 'editor',
    get mode() {
      const settings = deps.settings()
      return deps.isTrusted() &&
        settings.sandboxNetwork !== SANDBOX_NETWORK_DENIED &&
        (settings['reports.network'] !== 'whenSignedIn' || deps.isSignedIn())
        ? settings['reports.network']
        : 'off'
    },
    get githubSignedIn() {
      return deps.isSignedIn()
    },
    allowEgress: () => Promise.resolve(policy.mode !== 'off'),
  }
  return policy
}
