// M105 lane W: activation carries this loader, never the attachment path.
// dist/media.js (mediaAttach with the portable sniffers, limits and modality
// gate) loads on first attach; the bundle carries its own budget.
import type { Logger } from '../logger'
import { lazyBundleLoader } from '../lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import type { createMediaAttachments } from './mediaEntry'
import type { createAttachedMedia, windowMediaAttachDeps } from './mediaHostEntry'

interface MediaBundle {
  readonly createMediaAttachments: typeof createMediaAttachments
}

// Same shipped source/build; only this export's function signature is trusted (PLAN §8).
function isMediaBundle(value: unknown): value is MediaBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createMediaAttachments' in value &&
    typeof value.createMediaAttachments === 'function'
  )
}

export function mediaBundleLoader(
  bundlePath: string,
  log: Logger,
  loadBundle?: (file: string) => unknown,
): () => MediaBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    ...(loadBundle !== undefined && { loadBundle }),
    isBundle: isMediaBundle,
    label: 'media attachments',
    unavailable: () => UI_TEXT.attachmentUnreadable,
  })
}

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
