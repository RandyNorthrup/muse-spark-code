// The estimator's price port bundle entry (M117 C-M117-4R2, PLAN.md D6):
// dist/estimatePrices.js, required the first time an estimate looks up
// prices. It reads no `vscode`, so a stray import fails this build.
import { estimateCatalogAdapters } from '../../core/estimator/priceCatalogs'
import type { EstimatePricePort } from '../../core/estimator/prices'
import type { ReportNetworkPolicy } from '../../core/reporting/sources/cache'
import { createPriceCatalogPort } from './priceCatalogSource'

export interface EstimatePricePortDeps {
  readonly storageRoot: string
  readonly workspaceRoot: string
  readonly policy: ReportNetworkPolicy
}

/** The editor's price port: pinned adapters over the report reader and cache. */
export function createEstimatePricePort(deps: EstimatePricePortDeps): EstimatePricePort {
  return createPriceCatalogPort({ ...deps, adapters: estimateCatalogAdapters() })
}
