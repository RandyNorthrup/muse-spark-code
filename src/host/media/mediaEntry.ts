// M105 lane W: the media attachment bundle's entry. The activation and
// conversation bundles keep only the port types and the lazy loader; the
// sniffers, limits, modality gate and attachment port load on first use.
export { createMediaAttachments } from './mediaAttach'
export type { MediaAttachmentPort, MediaAttachDeps, PreparedMediaAttachment } from './mediaAttach'
