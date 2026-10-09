// M105 lane W: the media attachment bundle's entry. The activation and
// conversation bundles keep only the port types and the lazy loader; the
// sniffers, limits, modality gate and attachment port load on first use.
import { createMediaAttachments as createAttachments, type MediaAttachDeps } from './mediaAttach'
import type { MediaModelCapabilities } from '../../core/media/modalityGate'
import { metaMediaCapabilities } from '../../core/media/metaMediaCapabilities'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
export { createMediaInspector } from '../../core/media/inspectEntry'

/**
 * Lane V seam 1: video, audio and Files from the captured record, the same
 * one the session's media service gates and prices with; image and document
 * support stay the host's established projection. A model with no captures
 * stays unknown, which the gate refuses with its reason.
 */
export function withCapturedMedia(model: MediaModelCapabilities): MediaModelCapabilities {
  const captured = metaMediaCapabilities(model.modelId)
  return {
    ...model,
    provider: captured.provider,
    modalities: {
      ...model.modalities,
      video: captured.modalities.video,
      audio: captured.modalities.audio,
    },
    files: captured.files,
  }
}

export function createMediaAttachments(deps: MediaAttachDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return createAttachments({
    ...deps,
    capabilities: (modelId) => withCapturedMedia(deps.capabilities(modelId)),
  })
}
export type { MediaAttachmentPort, MediaAttachDeps, PreparedMediaAttachment } from './mediaAttach'
