// Activation imports only this loader and type-only surface/engine contracts.
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../lazyBundle'
import type * as ReportingPanelBundle from './reportPanelEntry'

type Bundle = typeof ReportingPanelBundle
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createReportPanel' in value &&
    typeof value.createReportPanel === 'function' &&
    'createReportingWindow' in value &&
    typeof value.createReportingWindow === 'function'
  )
}
export function reportPanelLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'reporting panel',
    unavailable: () => UI_TEXT.reportUi.generationFailed,
  })
}

export const SHOW_REPORT_COMMAND = 'museSpark.showReport'
