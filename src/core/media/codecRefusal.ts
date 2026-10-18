// The one refusal path for uncaptured media at the codec stage (M105 lane
// V). A leaf module — the type, its guard and one sentence constructor — so
// the codecs, the subscription bundle (direct import) and the Models panel
// (through the provider seam, never inlined: the panel is over its cap with
// even this copy) share the refusal without pulling the codec bundle: the
// split gate keeps `src/core/backends/modelapi/codecs/*` in
// dist/providers.js. Sentences are read from the installed table at use
// time, never at module load. Matched by name so a second copy of this
// module cannot mask it.
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export class ChatCodecError extends Error {
  override readonly name = 'ChatCodecError'
}

/**
 * RVCM1054D P2: the Copilot client's refusal constructor across the seam.
 * The panel bundle calls this (re-exported by the providers entry) instead
 * of formatting the sentences itself, so the fill calls and key paths live
 * in dist/providers.js and the panel keeps only the call. Compact
 * parameters on purpose: the call sites live in a bundle at its size cap,
 * so every saved character there counts.
 */
export function refuse(model: { readonly id: string }, isVideo = false): ChatCodecError {
  const id = model.id
  return new ChatCodecError(
    isVideo
      ? fill(UI_TEXT.media.videoUnknown, { model: id })
      : fill(UI_TEXT.media.formatUnsupported, { model: id, format: 'image' }),
  )
}

/**
 * The one decision point for "is this a codec refusal" (M105 lane V R3,
 * RVCM1054B P2): every production client and wrapper between a codec and
 * the user calls this instead of keeping its own list, so a codec refusal
 * always reaches the user as its own sentence. Matched by name so a second
 * copy of this module cannot mask it; narrows to Error so callers read
 * `.message` with no cast.
 */
export function isChatCodecError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'ChatCodecError'
}
