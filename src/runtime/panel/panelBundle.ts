// M104 lane B: the only runtime-panel code in dist/acp.js, the lazy loader of
// dist/runtimePanel.js, required on `panel` alone (PLAN.md D6), and the loader
// dist/runtimePanel.js uses for the conversations of a connection.
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './panelEntry'
import type * as SessionEntry from './sessionEntry'
import type * as PanelMediaBundle from '../panelMediaEntry'
import type * as PanelSchedulesBundle from '../panelSchedulesEntry'

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

interface PanelMedia {
  readonly createPanelMedia: typeof PanelMediaBundle.createPanelMedia
  readonly routeAttachmentMethod: typeof PanelMediaBundle.routeAttachmentMethod
}

/** Same-build signature, trusted after checking the exported functions (PLAN §8). */
function isPanelMediaBundle(value: unknown): value is PanelMedia {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPanelMedia' in value &&
    typeof value.createPanelMedia === 'function' &&
    'routeAttachmentMethod' in value &&
    typeof value.routeAttachmentMethod === 'function'
  )
}

/** The panel's attachments route and port, loaded on the first attachments call (M105 delivery d). */
export function panelMediaLoader(bundlePath: string, log: Logger): () => PanelMedia {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPanelMediaBundle,
    label: 'runtime panel media',
    unavailable: () => UI_TEXT.hostService.unavailable,
  })
}

interface PanelSchedules {
  readonly loadPanelSchedulesBinding: typeof PanelSchedulesBundle.loadPanelSchedulesBinding
  readonly createPanelScheduleHold: typeof PanelSchedulesBundle.createPanelScheduleHold
}

/** Same-build signature, trusted after checking the exported functions (PLAN §8). */
function isPanelSchedulesBundle(value: unknown): value is PanelSchedules {
  return (
    typeof value === 'object' &&
    value !== null &&
    'loadPanelSchedulesBinding' in value &&
    typeof value.loadPanelSchedulesBinding === 'function' &&
    'createPanelScheduleHold' in value &&
    typeof value.createPanelScheduleHold === 'function'
  )
}

/** The panel's schedules binding, loaded on the first native schedule hold (C-M115-9). */
export function panelSchedulesLoader(bundlePath: string, log: Logger): () => PanelSchedules {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPanelSchedulesBundle,
    label: 'runtime panel schedules',
    unavailable: () => UI_TEXT.hostService.unavailable,
  })
}
