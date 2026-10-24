// M104 lane B: the only runtime-panel code in dist/acp.js, the lazy loader of
// dist/runtimePanel.js, required on `panel` alone (PLAN.md D6).
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './panelEntry'

interface PanelBundle {
  readonly runPanel: typeof Entry.runPanel
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isPanelBundle(value: unknown): value is PanelBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runPanel' in value &&
    typeof value.runPanel === 'function'
  )
}

export function panelLoader(bundlePath: string, log: Logger): () => PanelBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPanelBundle,
    label: 'runtime panel',
    unavailable: () => UI_TEXT.hostService.unavailable,
  })
}
