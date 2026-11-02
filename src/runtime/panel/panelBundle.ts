// M104 lane B: the only runtime-panel code in dist/acp.js, the lazy loader of
// dist/runtimePanel.js, required on `panel` alone (PLAN.md D6), and the loader
// dist/runtimePanel.js uses for the conversations of a connection.
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as CompanionEntry from './companionEntry'
import type * as Entry from './panelEntry'
import type * as SessionEntry from './sessionEntry'

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

interface PanelSessionBundle {
  readonly createPanelSession: typeof SessionEntry.createPanelSession
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isPanelSessionBundle(value: unknown): value is PanelSessionBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPanelSession' in value &&
    typeof value.createPanelSession === 'function'
  )
}

/** The conversations of a connection, loaded by dist/runtimePanel.js once a handshake is done. */
export function panelSessionLoader(bundlePath: string, log: Logger): () => PanelSessionBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPanelSessionBundle,
    label: 'runtime panel session',
    unavailable: () => UI_TEXT.hostService.unavailable,
  })
}

interface PanelCompanionBundle {
  readonly runPanelCompanion: typeof CompanionEntry.runPanelCompanion
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isPanelCompanionBundle(value: unknown): value is PanelCompanionBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runPanelCompanion' in value &&
    typeof value.runPanelCompanion === 'function'
  )
}

/** The loopback browser companion, loaded by `panel --companion` alone. */
export function panelCompanionLoader(bundlePath: string, log: Logger): () => PanelCompanionBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPanelCompanionBundle,
    label: 'runtime panel companion',
    unavailable: () => UI_TEXT.hostService.unavailable,
  })
}
