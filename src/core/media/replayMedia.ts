// Durable metadata and per-request projections. Bytes/approved sources stay
// transient; a model switch never overwrites the original upload reference.
import * as z from 'zod/mini'
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_NAME_MAX_CHARS,
  MEDIA_SHA256_PATTERN,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import { mediaInfoSchema, uploadedMediaRefSchema, type UploadedMediaRef } from '../../shared/media'
import type { TurnPart } from '../agent/agentBackend'
import type { UploadSource } from '../backends/modelapi/files'
import type { InputContentPart, InputItem } from '../backends/modelapi/schemas'
import type { StoredReplayItem } from '../backends/modelapi/sessionStore'
import type { ResponsesMediaCodec } from '../backends/modelapi/codecs/responses'
import type { MediaBudget } from '../backends/modelapi/mediaBudget'
import type { UploadLedger } from './uploadLedger'
import { modalityGate, type MediaModelCapabilities, type MediaGateResult } from './modalityGate'

export const storedMediaPartSchema = z
  .strictObject({
    name: z.string().check(z.minLength(1), z.maxLength(MEDIA_NAME_MAX_CHARS)),
    info: mediaInfoSchema,
    sha256: z.string().check(z.regex(MEDIA_SHA256_PATTERN)),
    fps: z.optional(z.number().check(z.gt(0))),
    isScreenRecording: z.optional(z.boolean()),
    file: z.optional(uploadedMediaRefSchema),
    files: z.optional(z.array(uploadedMediaRefSchema)),
    delivered: z.optional(z.literal(true)),
  })
  .check(
    z.refine((part) => {
      const files = [...(part.files ?? []), ...(part.file === undefined ? [] : [part.file])]
      return (
        new Set((part.files ?? []).map((file) => file.provider)).size ===
          (part.files?.length ?? 0) &&
        files.every(
          (file) =>
            file.sha256 === part.sha256 &&
            file.bytes === part.info.sizeBytes &&
            file.mime === part.info.mediaType,
        )
      )
    }),
  )
export type StoredMediaPart = z.infer<typeof storedMediaPartSchema>
export const storedReplayMediaSchema = z.strictObject({
  index: z.int().check(z.gte(0)),
  media: storedMediaPartSchema,
})

export interface ReplayMediaDeps {
  readonly capabilities: (modelId: string) => MediaModelCapabilities
  readonly codec: ResponsesMediaCodec
  readonly ledger: (provider: string) => Pick<UploadLedger, 'ensure'>
  /** M101 C1 chooses complete recent turns; this lane preserves their canonical media. */
  readonly compactionTail: (entries: readonly StoredReplayItem[]) => readonly string[]
  /** E1/E2 resolve host-issued tokens or approved legacy attachments, never guessed paths. */
  readonly attachment: (part: TurnPart) => StoredMediaPart | undefined
  /** Each open repeats confinement and approval checks. No source path is stored. */
  readonly source: (
    media: StoredMediaPart,
    signal: AbortSignal,
  ) => Promise<UploadSource | undefined>
  /** C/A bind budget, Contributor and soundtrack choices before any upload/dispatch. */
  readonly authorize: (
    media: StoredMediaPart,
    model: MediaModelCapabilities,
    gate: MediaGateResult,
    signal: AbortSignal,
  ) => Promise<void>
}

function duration(media: StoredMediaPart): string {
  return 'durationSeconds' in media.info && media.info.durationSeconds !== null
    ? formatUnit(media.info.durationSeconds, 'second')
    : UI_TEXT.media.durationUnknown
}

function metadataPart(media: StoredMediaPart): Extract<InputContentPart, { type: 'input_text' }> {
  return {
    type: 'input_text',
    text: fill(UI_TEXT.media.replayMetadata, {
      name: media.name,
      duration: duration(media),
      size: formatBytes(media.info.sizeBytes),
    }),
  }
}

/** Structural host seam: W can bind a lazy adapter without inheriting this implementation. */
export interface MediaReplayPort {
  readonly beginRequest: ReplayMedia['beginRequest']
  readonly content: ReplayMedia['content']
  readonly restore: ReplayMedia['restore']
  readonly prepare: ReplayMedia['prepare']
  readonly project: ReplayMedia['project']
  readonly retain: ReplayMedia['retain']
  readonly delivered: ReplayMedia['delivered']
  readonly isUploaded: ReplayMedia['isUploaded']
  readonly transcriptMetadata: ReplayMedia['transcriptMetadata']
  readonly snapshot: ReplayMedia['snapshot']
  readonly references: ReplayMedia['references']
  readonly summaryInput: ReplayMedia['summaryInput']
  readonly tail: ReplayMedia['tail']
  readonly recover: ReplayMedia['recover']
}

export class ReplayMedia {
  private readonly parts = new WeakMap<InputContentPart, StoredMediaPart>()
  private readonly replacements = new Set<string>()
  public constructor(
    private readonly sessionId: string,
    private readonly deps: ReplayMediaDeps,
  ) {}

  private model(modelId: string): MediaModelCapabilities {
    const model = this.deps.capabilities(modelId)
    if (model.modelId !== modelId) throw new Error('Media capability model mismatch')
    return model
  }

  private managed(input: readonly InputItem[]): InputContentPart[] {
    return input.flatMap((item) =>
      item.type === 'message' && item.role === 'user'
        ? item.content.filter((part) => this.parts.has(part))
        : [],
    )
  }

  private fileFor(
    media: StoredMediaPart,
    model: MediaModelCapabilities,
  ): UploadedMediaRef | undefined {
    if (model.files !== 'yes') return undefined
    return media.file?.provider === model.provider
      ? media.file
      : media.files?.find((file) => file.provider === model.provider)
  }

  public beginRequest(): void {
    this.replacements.clear()
  }

  public content(
    part: TurnPart,
    inline: InputContentPart,
    modelId: string,
    budget: MediaBudget,
  ): InputContentPart {
    const raw = this.deps.attachment(part)
    if (raw === undefined) return inline
    const media = storedMediaPartSchema.parse(raw)
    const model = this.model(modelId)
    const gate = modalityGate(media.info, model, media.fps)
    if (!gate.ok) throw new Error(gate.reason)
    const content =
      media.file !== undefined ||
      (media.files?.length ?? 0) > 0 ||
      media.info.kind === 'video' ||
      media.info.kind === 'audio' ||
      (model.files === 'yes' && media.info.sizeBytes > MEDIA_FILE_ID_MIN_BYTES)
        ? metadataPart(media)
        : inline
    this.parts.set(content, media)
    budget.noteMedia(
      content,
      media.info,
      content === inline ? undefined : 0,
      metadataPart(media).text,
    )
    return content
  }

  public restore(entries: readonly StoredReplayItem[]): void {
    for (const entry of entries) {
      if (entry.item.type !== 'message') continue
      const mediaParts = entry.media ?? []
      for (const { index, media } of mediaParts) {
        const part = entry.item.content[index]
        if (part === undefined) throw new Error('Invalid media replay index')
        this.parts.set(part, storedMediaPartSchema.parse(media))
      }
    }
  }

  public async prepare(
    input: readonly InputItem[],
    modelId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.managed(input).length === 0) return
    const model = this.model(modelId)
    for (const part of this.managed(input)) {
      signal.throwIfAborted()
      const media = this.parts.get(part)
      if (media === undefined) continue
      const previousFile = this.fileFor(media, model)
      const gate = modalityGate(media.info, model, media.fps)
      if (!gate.ok) continue
      if (model.files !== 'yes' && (media.file !== undefined || (media.files?.length ?? 0) > 0))
        continue
      await this.deps.authorize(media, model, gate, signal)
      signal.throwIfAborted()
      if (
        model.files !== 'yes' ||
        !(
          previousFile !== undefined ||
          media.info.kind === 'video' ||
          media.info.sizeBytes > MEDIA_FILE_ID_MIN_BYTES ||
          media.delivered === true ||
          ((media.info.kind === 'image' || media.info.kind === 'document') &&
            part.type === 'input_text')
        )
      )
        continue
      const approved = await this.deps.source(media, signal)
      signal.throwIfAborted()
      if (approved === undefined && previousFile === undefined)
        throw new Error(fill(UI_TEXT.media.uploadExpired, { name: media.name }))
      const available: UploadSource = approved ?? {
        name: media.name,
        mime: media.info.mediaType,
        bytes: media.info.sizeBytes,
        open: () => {
          throw new Error(fill(UI_TEXT.media.uploadExpired, { name: media.name }))
        },
      }
      const source: UploadSource = {
        ...available,
        open: (readSignal) => {
          if (this.replacements.has(`${model.provider}:${media.sha256}`))
            throw new Error(fill(UI_TEXT.media.uploadExpired, { name: media.name }))
          return available.open(readSignal)
        },
      }
      if (
        source.name !== media.name ||
        source.mime !== media.info.mediaType ||
        source.bytes !== media.info.sizeBytes
      )
        throw new Error(fill(UI_TEXT.media.sourceChanged, { name: media.name }))
      const file = await this.deps
        .ledger(model.provider)
        .ensure(this.sessionId, media.sha256, source, signal)
      if (file.provider !== model.provider) throw new Error('Media upload provider mismatch')
      if (previousFile !== undefined && previousFile.fileId !== file.fileId)
        this.replacements.add(`${model.provider}:${media.sha256}`)
      const files = [
        ...(media.files ?? []),
        ...(media.file === undefined ? [] : [media.file]),
      ].filter((value) => value.provider !== model.provider)
      const byProvider = new Map(files.map((value) => [value.provider, value]))
      byProvider.set(file.provider, file)
      const retainedFiles: UploadedMediaRef[] = []
      byProvider.forEach((value) => {
        retainedFiles.push(value)
      })
      this.parts.set(part, storedMediaPartSchema.parse({ ...media, file, files: retainedFiles }))
    }
  }

  public project(
    input: readonly InputItem[],
    modelId: string,
    budget: MediaBudget,
  ): readonly InputItem[] {
    if (this.managed(input).length === 0) return input
    const model = this.model(modelId)
    return input.map((item) => {
      if (item.type !== 'message' || item.role !== 'user') return item
      const hasFreshMedia = item.content.some((part) => {
        const media = this.parts.get(part)
        return media !== undefined && media.delivered !== true
      })
      const content = item.content.map((part): InputContentPart => {
        const media = this.parts.get(part)
        if (media === undefined) return part
        const gate = modalityGate(media.info, model, media.fps)
        if (!gate.ok)
          return {
            type: 'input_text',
            text: this.deps.codec.omittedText(media, model, 'modality'),
          }
        if (model.files !== 'yes' && (media.file !== undefined || (media.files?.length ?? 0) > 0))
          return { type: 'input_text', text: this.deps.codec.omittedText(media, model, 'files') }
        const file = this.fileFor(media, model)
        const encodedMedia =
          file === undefined
            ? this.deps.codec.encodeInline(media, part, model)
            : {
                part: this.deps.codec.encodeUploaded({ ...media, file }, model),
                encodedChars: 0,
              }
        if (!Number.isSafeInteger(encodedMedia.encodedChars) || encodedMedia.encodedChars < 0)
          throw new Error('Invalid encoded media size')
        const encoded = encodedMedia.part
        this.parts.set(encoded, media)
        budget.noteMedia(
          encoded,
          media.info,
          encodedMedia.encodedChars,
          this.deps.codec.metadataText(media),
        )
        return encoded
      })
      if (hasFreshMedia) budget.assertMessageFits(content)
      return { ...item, content }
    })
  }

  /** Preserve canonical media when fitted/model-switched request views are committed. */
  public retain(original: InputItem, fitted: InputItem): InputItem {
    if (original.type !== 'message' || fitted.type !== 'message') return fitted
    return {
      ...fitted,
      content: fitted.content.map((part, index) => {
        const canonical = original.content[index]
        return canonical !== undefined && this.parts.has(canonical) ? canonical : part
      }),
    }
  }

  public delivered(input: readonly InputItem[]): void {
    for (const part of this.managed(input)) {
      const media = this.parts.get(part)
      if (media !== undefined) media.delivered = true
    }
  }

  public isUploaded(part: InputContentPart): boolean {
    return this.parts.get(part)?.file !== undefined
  }

  public transcriptMetadata(parts: readonly TurnPart[]): readonly string[] {
    return parts.flatMap((part) => {
      const media = this.deps.attachment(part)
      return media === undefined ? [] : [metadataPart(storedMediaPartSchema.parse(media)).text]
    })
  }

  public snapshot(entries: readonly StoredReplayItem[]): StoredReplayItem[] {
    return entries.map((entry) => {
      if (entry.item.type !== 'message') return entry
      const media = entry.item.content.flatMap((part, index) => {
        const stored = this.parts.get(part)
        return stored === undefined ? [] : [{ index, media: { ...stored } }]
      })
      if (media.length === 0) return entry
      return {
        ...entry,
        media,
        item: {
          ...entry.item,
          content: entry.item.content.map((part) => {
            const stored = this.parts.get(part)
            return stored === undefined ? part : metadataPart(stored)
          }),
        },
      }
    })
  }

  public references(entries: readonly StoredReplayItem[]): UploadedMediaRef[] {
    const files = this.snapshot(entries).flatMap((entry) =>
      (entry.media ?? []).flatMap(({ media }) => [
        ...(media.files ?? []),
        ...(media.file === undefined ? [] : [media.file]),
      ]),
    )
    const unique: UploadedMediaRef[] = []
    new Map(files.map((file) => [`${file.provider}:${file.sha256}`, file])).forEach((file) => {
      unique.push(file)
    })
    return unique
  }

  /** Compaction names media rather than re-sending the original transient inline parts. */
  public summaryInput(input: readonly InputItem[]): readonly InputItem[] {
    return input.map((item) =>
      item.type === 'message'
        ? {
            ...item,
            content: item.content.map((part): InputContentPart => {
              const media = this.parts.get(part)
              return media === undefined
                ? part
                : { type: 'input_text', text: this.deps.codec.metadataText(media) }
            }),
          }
        : item,
    )
  }

  public tail(entries: readonly StoredReplayItem[]): readonly StoredReplayItem[] {
    if (this.managed(entries.map((entry) => entry.item)).length === 0) return []
    const tail = this.deps.compactionTail(this.snapshot(entries))
    if (tail.some((id) => entries.every((entry) => entry.turnId !== id)))
      throw new Error('Invalid media compaction tail')
    const kept = new Set(tail)
    return entries.filter((entry) => kept.has(entry.turnId))
  }

  /** At most one recovery is admitted by the caller for each model call. */
  public async recover(
    error: unknown,
    input: readonly InputItem[],
    modelId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const before = this.managed(input).flatMap((part) => {
      const media = this.parts.get(part)
      const file = media === undefined ? undefined : this.fileFor(media, this.model(modelId))
      return file === undefined ? [] : [file.fileId]
    })
    if (before.length === 0 || !this.deps.codec.isMissingFile(error, before)) return false
    await this.prepare(input, modelId, signal)
    return this.managed(input).some((part) => {
      const media = this.parts.get(part)
      const file = media === undefined ? undefined : this.fileFor(media, this.model(modelId))
      return file !== undefined && !before.includes(file.fileId)
    })
  }
}
