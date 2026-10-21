// Before first attach, forward through the host's lazy registry holder.
// No registry, hash, source-reader or schema implementation loads here.
import { UI_TEXT } from '../../shared/constants'
import type { AttachedMedia, AttachedMediaPort, MediaClaim } from './attachedMedia'

/** Nothing registered yet: a turn has nothing to hold. */
function nothingHeld(): void {
  // No registry, so no state to move.
}
const NO_CLAIM: MediaClaim = { start: nothingHeld, release: nothingHeld }

/**
A host's registry before its first attach (RVMEDIAV 8): the registry loads
with its own bundle, and until then nothing is attached and nothing
resolves. VS Code and the CLI/ACP runtime both hold their registry so.
*/
export function lazyAttachedMedia(current: () => AttachedMedia | undefined): AttachedMediaPort {
  return {
    resolve: (part) => current()?.resolve(part),
    source: (token, media) => current()?.source(token, media),
    audio: (part) => current()?.audio(part),
    read: (token, signal) => {
      const registry = current()
      if (registry === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
      return registry.read(token, signal)
    },
    claim: (parts) => current()?.claim(parts) ?? NO_CLAIM,
  }
}
