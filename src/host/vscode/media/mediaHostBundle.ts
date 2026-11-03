// The window's media registry bundle (RVMEDIAV 8): dist/mediaHost.js loads
// with the first attach. Loader only; the registry rides the bundle.
import type { Logger } from '../../logger'
import { lazyBundleLoader } from '../../lazyBundle'
import { UI_TEXT } from '../../../shared/constants'
import type { createAttachedMedia, windowMediaAttachDeps } from './mediaHostEntry'

interface MediaHostBundle {
  readonly createAttachedMedia: typeof createAttachedMedia
  readonly windowMediaAttachDeps: typeof windowMediaAttachDeps
}

// Same shipped source/build; only these exports' function signatures are trusted (PLAN §8).
function isMediaHostBundle(value: unknown): value is MediaHostBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createAttachedMedia' in value &&
    typeof value.createAttachedMedia === 'function' &&
    'windowMediaAttachDeps' in value &&
    typeof value.windowMediaAttachDeps === 'function'
  )
}

/** RVMEDIAV 8: dist/mediaHost.js, the registry and attach binding, on first attach. */
export function mediaHostBundleLoader(bundlePath: string, log: Logger): () => MediaHostBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isMediaHostBundle,
    label: 'media registry',
    unavailable: () => UI_TEXT.attachmentUnreadable,
  })
}
