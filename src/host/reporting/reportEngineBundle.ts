import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../lazyBundle'
import type { ReportPanelEngine } from './reportPanel'
import type { ReportingContext as importContext } from '../../runtime/reporting/engine'

/** W binds this factory in the lazy engine using K/S/H's real implementations and R's renderers. */
export interface ReportingEngineContext extends importContext {
  readonly workspaceKey: string
}

interface EngineBundle {
  readonly createReportingEngine: (context: ReportingEngineContext) => ReportPanelEngine
}
function isEngineBundle(value: unknown): value is EngineBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createReportingEngine' in value &&
    typeof value.createReportingEngine === 'function'
  )
}
export function reportEngineLoader(
  deps: Pick<LazyBundleLoaderOptions<EngineBundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => EngineBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isEngineBundle,
    label: 'reporting engine',
    unavailable: () => UI_TEXT.reportUi.generationFailed,
  })
}
