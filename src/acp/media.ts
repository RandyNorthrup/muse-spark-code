// Portable ACP entry points. Runtime binds approved sources to M2's replay;
// no provider wire or recorder is guessed here (PLAN.md D85.9).
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { TurnPart } from '../core/agent/agentBackend'
import { AttachmentStore } from '../core/attachments'
import type { ToolIo } from '../core/backends/modelapi/tools'
import type { UploadSource } from '../core/backends/modelapi/files'
import { checkMediaLimits, sniffMediaBytes } from '../core/media/limits'
import { modalityGate, type MediaModelCapabilities } from '../core/media/modalityGate'
import { confineWorkspacePath } from '../core/workspacePath'
import { isProtectedPath } from '../core/protectedPaths'
import { isPrivateFileName } from '../shared/privateFiles'
import {
  BYTES_PER_MIB,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MEDIA_NAME_MAX_CHARS,
  UI_TEXT,
  type AcpBackendKind,
} from '../shared/constants'
import { fill } from '../shared/l10n/text'
import { mediaInfoSchema, type MediaInfo } from '../shared/media'
import { decodeAcpBlob, resourceName, type PromptMediaPort } from './translate'

export interface AcpMediaInput {
  readonly name: string
  readonly info: MediaInfo
  readonly sha256: string
  readonly source: UploadSource
  readonly isScreenRecording?: true
}

export interface AcpAttachment {
  readonly part: TurnPart
  readonly name: string
  readonly info: MediaInfo
  /** A recording's owner-only temporary file is deleted after delivery or discard. */
  readonly dispose?: () => Promise<void>
}

export interface AcpMediaPort extends PromptMediaPort {
  readonly attach: (given: string, signal: AbortSignal, mime?: string) => Promise<AcpAttachment>
  readonly record: (signal: AbortSignal) => Promise<AcpAttachment | undefined>
}

export interface AcpMediaContext {
  readonly cwd: string
  readonly sessionId: string
  readonly backend: AcpBackendKind
  readonly modelId: () => string
  readonly interactive: boolean
  /** Exec's existing input receipt: metadata only, never the carrier or private source. */
  readonly onAttachment?: (metadata: Pick<AcpAttachment, 'name' | 'info'>) => void
}
export type AcpMediaFactory = (context: AcpMediaContext) => Promise<AcpMediaPort>

export interface AcpMediaDeps extends AcpMediaContext {
  readonly platform: NodeJS.Platform
  readonly io: Pick<ToolIo, 'realPath' | 'readBytes' | 'readMedia'>
  readonly model: () => MediaModelCapabilities
  /** Session policy/approval checked on both textual and canonical names before opening bytes. */
  readonly assertReadable: (
    file: {
      readonly relative: string
      readonly canonical: string
      readonly checkedAbsolute: string
    },
    signal: AbortSignal,
  ) => Promise<void>
  /** Bind metadata carrier + private source to M2; admission includes C/A's consent and budgets. */
  readonly prepare: (input: AcpMediaInput, signal: AbortSignal) => Promise<TurnPart>
  /** Native driver + user options + Stop + preview. Returns only after the user chooses Attach. */
  readonly recordAndPreview?: (
    signal: AbortSignal,
  ) => Promise<(AcpMediaInput & { readonly dispose: () => Promise<void> }) | undefined>
}

function unknown(type: string): Error {
  return new Error(fill(UI_TEXT.media.attachmentUnknownType, { type }))
}

function bytesInput(name: string, info: MediaInfo, bytes: Uint8Array): AcpMediaInput {
  const chunk = Promise.resolve(bytes)
  return {
    name,
    info,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: {
      name,
      mime: info.mediaType,
      bytes: bytes.length,
      open: async function* (active) {
        active.throwIfAborted()
        yield await chunk
      },
    },
  }
}

/** No bytes or provider IDs appear in ACP acknowledgements. */
export class AcpMedia implements AcpMediaPort {
  public constructor(private readonly deps: AcpMediaDeps) {}

  private async accepted(input: AcpMediaInput, signal: AbortSignal): Promise<AcpAttachment> {
    signal.throwIfAborted()
    const info = mediaInfoSchema.parse(input.info)
    if (input.name === '' || input.name.length > MEDIA_NAME_MAX_CHARS) throw unknown(info.mediaType)
    if (this.deps.backend !== 'modelApi') throw new Error(UI_TEXT.media.museCodeRefusal)
    const model = this.deps.model()
    if (model.modelId !== this.deps.modelId()) throw new Error(UI_TEXT.execUnknownModel)
    const gate = modalityGate(info, model)
    if (!gate.ok) throw new Error(gate.reason)
    if (info.kind === 'video' || info.kind === 'audio') {
      const limits = checkMediaLimits(info, {
        acceptedMediaTypes: model.modalities[info.kind].formats,
        modelName: model.modelName,
      })
      if (!limits.ok) throw new Error(limits.reason)
    }
    const part = await this.deps.prepare(input, signal)
    signal.throwIfAborted()
    this.deps.onAttachment?.({ name: input.name, info })
    return { part, name: input.name, info }
  }

  public async attach(given: string, signal: AbortSignal, mime?: string): Promise<AcpAttachment> {
    signal.throwIfAborted()
    const confined = await confineWorkspacePath(
      this.deps.cwd,
      given,
      this.deps.platform,
      this.deps.io,
    )
    if (!confined.ok) throw new Error(UI_TEXT.textFilePrivate)
    if (
      [confined.relative, confined.canonical].some(
        (name) => isProtectedPath(name) || isPrivateFileName(name),
      )
    )
      throw new Error(UI_TEXT.textFilePrivate)
    await this.deps.assertReadable(confined, signal)
    signal.throwIfAborted()
    const name = path.posix.basename(confined.relative.replaceAll('\\', '/'))
    let isPdfFile = name.toLowerCase().endsWith('.pdf')
    if (this.deps.io.readMedia !== undefined) {
      const file = await this.deps.io.readMedia(
        confined.checkedAbsolute,
        MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB,
        confined.checkedAbsolute,
        signal,
      )
      signal.throwIfAborted()
      if (file === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
      if (!('kind' in file)) {
        if (mime != null && mime !== file.info.mediaType) throw unknown(mime)
        return await this.accepted({ ...file, name, source: { ...file.source, name } }, signal)
      }
      isPdfFile = file.isPdf === true
    } else if (
      /\.(?:mp4|mov|mp3|wav|webm|mkv|m4a)$/iu.test(name) ||
      /^(?:audio|video)\//u.test(mime ?? '')
    ) {
      throw new Error(UI_TEXT.media.uploadStorageUnknown)
    }
    const bytes = await this.deps.io.readBytes(
      confined.checkedAbsolute,
      isPdfFile ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES,
      confined.checkedAbsolute,
    )
    signal.throwIfAborted()
    if (bytes === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
    const store = new AttachmentStore(() => 'attachment')
    const added = store.add(name, bytes, this.deps.backend === 'modelApi', true)
    if (!added.ok)
      throw new Error(
        added.reason === UI_TEXT.attachmentUnsupported
          ? fill(UI_TEXT.media.attachmentUnknownType, { type: mime ?? 'file' })
          : added.reason,
      )
    const [part] = store.partsFor([added.attachment.id])
    if (part === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
    let info: MediaInfo
    if (part.type === 'image')
      info = mediaInfoSchema.parse({
        kind: 'image',
        mediaType: part.mediaType,
        sizeBytes: bytes.length,
        width: part.width,
        height: part.height,
      })
    else
      info =
        part.type === 'file'
          ? {
              kind: 'document',
              mediaType: 'application/pdf',
              sizeBytes: bytes.length,
              ...(part.pageCount !== undefined && { pageCount: part.pageCount }),
            }
          : { kind: 'text', mediaType: 'text/plain', sizeBytes: bytes.length }
    if (mime != null && mime !== info.mediaType) throw unknown(mime)
    // Named text has no Files route; Muse Code keeps its legacy image/text parts.
    if (this.deps.backend === 'museCode' || info.kind === 'text') {
      this.deps.onAttachment?.({ name, info })
      return { part, name, info }
    }
    return await this.accepted(bytesInput(name, info, bytes), signal)
  }

  public async block(block: ContentBlock, signal: AbortSignal): Promise<TurnPart | string> {
    try {
      if (block.type === 'resource_link') {
        let given: string
        try {
          given = fileURLToPath(block.uri, { windows: this.deps.platform === 'win32' })
        } catch {
          throw new Error(UI_TEXT.textFilePrivate)
        }
        const attached = await this.attach(given, signal, block.mimeType ?? undefined)
        return attached.part
      }
      const resource =
        block.type === 'resource' && 'blob' in block.resource ? block.resource : undefined
      const data = block.type === 'audio' ? block.data : resource?.blob
      if (data === undefined) throw unknown(block.type)
      const mime = block.type === 'audio' ? block.mimeType : resource?.mimeType
      const maximum = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
      const bytes = decodeAcpBlob(data, maximum, mime ?? 'blob', UI_TEXT.execFileTooLarge)
      if (typeof bytes === 'string') throw new Error(bytes)
      const info = sniffMediaBytes(bytes)
      if (info === undefined || (mime != null && mime !== info.mediaType))
        throw unknown(mime ?? 'blob')
      if (block.type === 'audio' && info.kind !== 'audio') throw unknown(mime ?? 'audio')
      const name =
        block.type === 'resource'
          ? resourceName(block.resource.uri)
          : `audio.${info.mediaType === 'audio/wav' ? 'wav' : 'mp3'}`
      const attachment = await this.accepted(bytesInput(name, info, bytes), signal)
      return attachment.part
    } catch (error: unknown) {
      if (signal.aborted) throw error
      return error instanceof Error ? error.message : UI_TEXT.attachmentUnreadable
    }
  }

  public async record(signal: AbortSignal): Promise<AcpAttachment | undefined> {
    if (!this.deps.interactive) throw new Error(UI_TEXT.media.recordingUserOnly)
    if (this.deps.recordAndPreview === undefined)
      throw new Error(
        fill(UI_TEXT.media.recordingUnavailable, { reason: UI_TEXT.media.converterUnavailable }),
      )
    const preview = await this.deps.recordAndPreview(signal)
    if (preview === undefined) return undefined
    try {
      if (preview.info.kind !== 'video') throw unknown(preview.info.mediaType)
      const attachment = await this.accepted({ ...preview, isScreenRecording: true }, signal)
      return { ...attachment, dispose: preview.dispose }
    } catch (error: unknown) {
      await preview.dispose()
      throw error
    }
  }
}
