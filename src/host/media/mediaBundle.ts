// M105 lane W: activation carries this loader, never the attachment path.
// dist/media.js (mediaAttach with the portable sniffers, limits and modality
// gate) loads on first attach; the bundle carries its own budget.
import type { Logger } from '../logger'
import { lazyBundleLoader } from '../lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import type { createMediaAttachments } from './mediaEntry'

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
