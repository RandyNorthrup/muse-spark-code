import type * as ReportsBundle from './reportsEntry'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'

type Bundle = typeof ReportsBundle
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createRuntimeReports' in value &&
    typeof value.createRuntimeReports === 'function'
  )
}

export function reportsLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'reporting bundle',
    unavailable: () => UI_TEXT.reportUi.generationFailed,
  })
}
