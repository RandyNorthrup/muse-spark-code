// M104 lane H: the only supervision code in dist/acp.js, the lazy loader of
// dist/supervise.js, required on `supervise`, `stop` and the language
// server's `muse.stop` alone (PLAN.md D6).
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './superviseEntry'

interface SuperviseBundle {
  readonly runSupervise: typeof Entry.runSupervise
  readonly runStop: typeof Entry.runStop
  readonly stopWorkspace: typeof Entry.stopWorkspace
}

/** Same-build signatures, trusted after checking the exported functions (PLAN §8). */
function isSuperviseBundle(value: unknown): value is SuperviseBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runSupervise' in value &&
    typeof value.runSupervise === 'function' &&
    'runStop' in value &&
    typeof value.runStop === 'function' &&
    'stopWorkspace' in value &&
    typeof value.stopWorkspace === 'function'
  )
}

export function superviseLoader(bundlePath: string, log: Logger): () => SuperviseBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isSuperviseBundle,
    label: 'supervision',
    unavailable: () => UI_TEXT.supervision.unavailable,
  })
}
