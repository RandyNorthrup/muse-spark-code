// The runtime media bundle's entry (M105 lane V seam 5): dist/runtimeMedia.js.
// ACP serve and exec load it on the first prompt that carries media; the
// agent's engine keeps only a lazy holder for the attached-media registry,
// which every Model API session of the runtime resolves through.
import { AttachedMedia } from '../core/media/attachedMedia'

export { forwardExecFile } from './exec/filesTransport'
export { runtimeMediaPort } from '../acp/mediaPort'
export { setUiText } from '../shared/l10n/text'

/** The runtime's one registry, made with its first media prompt. */
export function createAttachedMedia(): AttachedMedia {
  return new AttachedMedia()
}
