import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { createUsagePanel } from './usagePanelEntry'

interface UsagePanelBundle {
  readonly createUsagePanel: typeof createUsagePanel
}
function isUsagePanelBundle(value: unknown): value is UsagePanelBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createUsagePanel' in value &&
    typeof value.createUsagePanel === 'function'
  )
}
export function usagePanelLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: (file: string) => unknown
}): () => UsagePanelBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isUsagePanelBundle,
    label: 'usage panel',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
