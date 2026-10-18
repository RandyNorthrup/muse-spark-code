// M105 lane W: the media attachment bundle's entry. The activation and
// conversation bundles keep only the port types and the lazy loader; the
// sniffers, limits, modality gate and attachment port load on first use.
import { createMediaAttachments as createAttachments, type MediaAttachDeps } from './mediaAttach'
import { withCapturedMedia } from '../../core/media/capturedMedia'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
export { createMediaInspector } from '../../core/media/inspectEntry'

/** Lane V seam 1: the captured record decides video, audio and Files. */
export function createMediaAttachments(deps: MediaAttachDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return createAttachments({
    ...deps,
    capabilities: (modelId) => withCapturedMedia(deps.capabilities(modelId)),
  })
}
export type { MediaAttachmentPort, MediaAttachDeps, PreparedMediaAttachment } from './mediaAttach'
