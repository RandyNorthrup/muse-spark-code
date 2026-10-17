// M105 lane W: the media attachment bundle's entry. The activation and
// conversation bundles keep only the port types and the lazy loader; the
// sniffers, limits, modality gate and attachment port load on first use.
import { createMediaAttachments as createAttachments, type MediaAttachDeps } from './mediaAttach'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
export { createMediaInspector } from '../../core/media/inspectEntry'
export function createMediaAttachments(deps: MediaAttachDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return createAttachments(deps)
}
export type { MediaAttachmentPort, MediaAttachDeps, PreparedMediaAttachment } from './mediaAttach'
