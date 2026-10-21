// M105 lane V, seam 5: the CLI/ACP runtime's media port, for ACP serve and
// exec alike. It loads with dist/productionMedia.js on the first media
// prompt, never with the agent. `/attach`, `exec --attach`, resource links
// and embedded blobs reach `AcpMedia` (confinement, protected and private
// names, the sniff, the captured record's gate); this binds what it admits:
// - video and audio register with the runtime's attached-media registry,
//   the same one its Model API sessions resolve, so they upload or are
//   transcribed exactly as in VS Code;
// - images and PDFs become their established inline parts, priced on the
//   one admission path.
// Contributor-tier models are the agent's `--allow-contributor-models`
// opt-in; audio is admitted only where the agent transcribes it (its Muse
// Voice flag).
import { Buffer } from 'node:buffer'
import type { TurnPart } from '../core/agent/agentBackend'
import type { AttachedMedia } from '../core/media/attachedMedia'
import { withCapturedMedia } from '../core/media/capturedMedia'
import { projectMediaCapabilities } from '../host/media/mediaProviders'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { AcpMedia, type AcpMediaContext, type AcpMediaDeps, type AcpMediaInput } from './media'

export interface RuntimeMediaPortDeps {
  readonly platform: NodeJS.Platform
  readonly io: AcpMediaDeps['io']
  readonly attached: Pick<AttachedMedia, 'register' | 'releaseOwner'>
  readonly newToken: () => string
  readonly transcribesSound: NonNullable<AcpMediaDeps['transcribesSound']>
}

/** An admitted image or PDF as the turn's established inline part. */
async function inlinePart(input: AcpMediaInput, signal: AbortSignal): Promise<TurnPart> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of input.source.open(signal)) {
    size += chunk.byteLength
    // Never more than the sniffed file: a grown source is not the one admitted.
    if (size > input.info.sizeBytes) throw new Error(UI_TEXT.attachmentUnreadable)
    chunks.push(chunk)
  }
  const base64Data = Buffer.concat(chunks).toString('base64')
  const { info } = input
  if (info.kind === 'image' && info.width !== undefined && info.height !== undefined)
    return {
      type: 'image',
      base64Data,
      mediaType: info.mediaType,
      width: info.width,
      height: info.height,
    }
  if (info.kind === 'document')
    return {
      type: 'file',
      base64Data,
      mediaType: info.mediaType,
      name: input.name,
      sizeBytes: info.sizeBytes,
      pageCount: info.pageCount,
    }
  throw new Error(fill(UI_TEXT.media.attachmentUnknownType, { type: info.mediaType }))
}

/** One session's media port over the runtime's registry and confined reads. */
export function runtimeMediaPort(context: AcpMediaContext, deps: RuntimeMediaPortDeps) {
  // This port's registrations, embedded bytes included, are its own: the
  // session's release lets go of every one no running turn holds.
  const owner = deps.newToken()
  return new AcpMedia({
    ...context,
    platform: deps.platform,
    io: deps.io,
    model: () => withCapturedMedia(projectMediaCapabilities(context.modelId())),
    // The user named the file; AcpMedia already confined it and refused
    // protected and private names.
    assertReadable: () => Promise.resolve(),
    transcribesSound: deps.transcribesSound,
    release: () => {
      deps.attached.releaseOwner(owner)
    },
    prepare: async (input, signal) => {
      const { info } = input
      // A registered source reads the admitted bytes only; no path is kept.
      return info.kind !== 'video' && info.kind !== 'audio'
        ? await inlinePart(input, signal)
        : deps.attached.register(
            deps.newToken(),
            { name: input.name, info, sha256: input.sha256 },
            { read: (active) => input.source.open(active) },
            owner,
          )
    },
  })
}
