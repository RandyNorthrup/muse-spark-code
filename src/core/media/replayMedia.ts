// Durable metadata and per-request projections. Bytes/approved sources stay
// transient; a model switch never overwrites the original upload reference.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { MEDIA_FILE_ID_MIN_BYTES, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import {
  storedMediaPartSchema,
  type StoredMediaPart,
  type UploadedMediaRef,
} from '../../shared/media'
import { type MediaCostEstimator, reserveMediaRequest } from './mediaCost'
import { requestParts, type BudgetMediaPart } from '../backends/modelapi/sessionBudget'
import type { CreateResponseBody } from '../backends/modelapi/schemas'
import type { MediaFileInfo } from './limits'
import type { TurnPart } from '../agent/agentBackend'
import type { UploadSource } from '../backends/modelapi/files'
import type { InputContentPart, InputItem } from '../backends/modelapi/schemas'
import type { StoredReplayItem } from '../backends/modelapi/sessionStore'
import type { ResponsesMediaCodec } from '../backends/modelapi/codecs/responses'
import type { MediaBudget } from '../backends/modelapi/mediaBudget'
import type { UploadLedger } from './uploadLedger'
import { modalityGate, type MediaModelCapabilities, type MediaGateResult } from './modalityGate'

export { storedMediaPartSchema, type StoredMediaPart } from '../../shared/media'

export interface ReplayMediaDeps {
  readonly estimator?: MediaCostEstimator

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
  readonly budgetParts: ReplayMedia['budgetParts']
  readonly reserveRequest: ReplayMedia['reserveRequest']

  readonly beginRequest: ReplayMedia['beginRequest']
  readonly pending: ReplayMedia['pending']
  readonly assertPendingFits: ReplayMedia['assertPendingFits']
  readonly adopt: ReplayMedia['adopt']
  readonly upload: ReplayMedia['upload']
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
  private readonly restored = new WeakSet<InputContentPart>()
  private readonly inline = new WeakMap<InputContentPart, InputContentPart>()
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

  private route(
    media: StoredMediaPart,
    model: MediaModelCapabilities,
    part: InputContentPart,
  ): 'inline' | 'upload' {
    return model.files === 'yes' &&
      (media.file !== undefined ||
        (media.files?.length ?? 0) > 0 ||
        media.info.kind === 'video' ||
        media.info.kind === 'audio' ||
        media.info.sizeBytes > MEDIA_FILE_ID_MIN_BYTES ||
        media.delivered === true ||
        ((media.info.kind === 'image' || media.info.kind === 'document') &&
          part.type === 'input_text'))
      ? 'upload'
      : 'inline'
  }

  /** Detached metadata follows the actual projection, including replayed file IDs. */
  public budgetParts(body: CreateResponseBody): readonly (string | BudgetMediaPart)[] {
    const parts: (string | BudgetMediaPart)[] = [...requestParts({ ...body, input: [] })]
    for (const item of body.input) {
      if (item.type !== 'message') {
        parts.push(JSON.stringify(item))
        continue
      }
      const content = item.content.filter((part) => !this.parts.has(part))
      parts.push(JSON.stringify({ ...item, content }))
      for (const part of item.content) {
        const media = this.parts.get(part)
        if (media === undefined) continue
        const estimate = this.deps.estimator?.estimate(
          this.model(body.model).provider,
          body.model,
          media,
          true,
        )
        if (estimate === undefined)
          throw new Error(fill(UI_TEXT.media.cappedRateUnknown, { model: body.model }))
        parts.push({
          mediaIdentity: JSON.stringify(media),
          upperBoundInputTokens: estimate.upperBoundInputTokens,
        })
      }
    }
    return parts
  }

  public async reserveRequest(
    body: CreateResponseBody,
    request: Omit<Parameters<typeof reserveMediaRequest>[0], 'items' | 'estimator'>,
  ) {
    const items = this.managed(body.input).flatMap((part) => {
      const media = this.parts.get(part)
      return media === undefined ? [] : [media]
    })
    if (items.length === 0) return
    const estimator = this.deps.estimator
    if (estimator === undefined)
      throw new Error(fill(UI_TEXT.media.cappedRateUnknown, { model: body.model }))
    return await reserveMediaRequest({ ...request, items, estimator })
  }

  public pending(input: readonly InputItem[]): InputContentPart[] {
    return this.managed(input).filter((part) => this.parts.get(part)?.delivered !== true)
  }

  public assertPendingFits(
    content: readonly InputContentPart[],
    budget: MediaBudget,
    queued?: { readonly chars: number; readonly slots: number },
  ): void {
    try {
      budget.assertMessageFits(content, queued)
    } catch (error) {
      const names = new Set(
        content.flatMap((part) => {
          const media = this.parts.get(part)
          return media === undefined ? [] : [media.name]
        }),
      )
      throw new Error(
        [
          error instanceof Error ? error.message : UI_TEXT.mediaTotalTooLarge,
          ...Array.from(names, (name) => fill(UI_TEXT.removeAttachmentNamed, { name })),
        ].join('\n'),
        { cause: error },
      )
    }
  }

  public beginRequest(): void {
    this.replacements.clear()
  }

  /**
   * Admit an already-uploaded file (read_file's mediaFile) as managed replay
   * media: the same metadata text and budget note content() registers, minus
   * the token resolution. prepare() authorizes, rechecks the source and
   * reuses the file id through the shared ledger before project() encodes
   * the file reference. Throws the gate reason when the model cannot take it.
   */
  /**
   * Reserve a tool-read file on the session upload ledger (M105 E2 review):
   * the gate and the C/A authorization run before any upload, and the
   * ledger dedups by digest. The returned reference is what adopt() later
   * replays as a file-id without re-uploading.
   */
  public async upload(
    file: {
      readonly name: string
      readonly info: MediaFileInfo
      readonly sha256: string
      readonly source: UploadSource
    },
    modelId: string,
    signal: AbortSignal,
  ): Promise<UploadedMediaRef> {
    const media = storedMediaPartSchema.parse({
      name: file.name,
      info: file.info,
      sha256: file.sha256,
    })
    const model = this.model(modelId)
    const gate = modalityGate(media.info, model, undefined, 'upload')
    if (!gate.ok) throw new Error(gate.reason)
    await this.deps.authorize(media, model, gate, signal)
    return await this.deps
      .ledger(model.provider)
      .ensure(this.sessionId, media.sha256, file.source, signal)
  }

  public adopt(
    media: StoredMediaPart,
    modelId: string,
    budget: MediaBudget,
  ): Extract<InputContentPart, { type: 'input_text' }> {
    const parsed = storedMediaPartSchema.parse(media)
    const model = this.model(modelId)
    const content = metadataPart(parsed)
    const gate = modalityGate(parsed.info, model, parsed.fps, this.route(parsed, model, content))
    if (!gate.ok) throw new Error(gate.reason)
    this.parts.set(content, parsed)
    budget.noteMedia(content, parsed.info, 0, content.text)
    return content
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
    const route = this.route(media, model, inline)
    const gate = modalityGate(media.info, model, media.fps, route)
    if (!gate.ok) throw new Error(gate.reason)
    const content =
      route === 'upload' ||
      media.file !== undefined ||
      (media.files?.length ?? 0) > 0 ||
      media.info.kind === 'video' ||
      media.info.kind === 'audio'
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
        if (part.type === 'input_text') this.restored.add(part)
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
      const route = this.route(media, model, part)
      const gate = modalityGate(media.info, model, media.fps, route)
      if (!gate.ok) continue
      if (model.files !== 'yes' && (media.file !== undefined || (media.files?.length ?? 0) > 0))
        continue
      this.inline.delete(part)
      await this.deps.authorize(media, model, gate, signal)
      signal.throwIfAborted()
      if (route === 'inline' && !this.restored.has(part)) continue
      const approved = await this.deps.source(media, signal)
      signal.throwIfAborted()
      if (approved === undefined && route === 'inline') continue
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
      if (route === 'inline') {
        if (media.info.kind !== 'image' && media.info.kind !== 'document') continue
        const chunks: Uint8Array[] = []
        const hash = createHash('sha256')
        let size = 0
        for await (const chunk of source.open(signal)) {
          signal.throwIfAborted()
          size += chunk.byteLength
          if (size > media.info.sizeBytes)
            throw new Error(fill(UI_TEXT.media.sourceChanged, { name: media.name }))
          chunks.push(chunk)
          hash.update(chunk)
        }
        signal.throwIfAborted()
        if (size !== media.info.sizeBytes || hash.digest('hex') !== media.sha256)
          throw new Error(fill(UI_TEXT.media.sourceChanged, { name: media.name }))
        const data = `data:${media.info.mediaType};base64,${Buffer.concat(chunks).toString('base64')}`
        this.inline.set(
          part,
          media.info.kind === 'image'
            ? { type: 'input_image', image_url: data, detail: 'auto' }
            : { type: 'input_file', filename: media.name, file_data: data },
        )
        continue
      }
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
    const projected = input.map((item) => {
      if (item.type !== 'message' || item.role !== 'user') return item
      const hasFreshMedia = item.content.some((part) => {
        const media = this.parts.get(part)
        return media !== undefined && media.delivered !== true
      })
      const content = item.content.map((part): InputContentPart => {
        const media = this.parts.get(part)
        if (media === undefined) return part
        const gate = modalityGate(media.info, model, media.fps, this.route(media, model, part))
        if (!gate.ok)
          return {
            type: 'input_text',
            text: this.deps.codec.omittedText(media, model, 'modality'),
          }
        const file = this.fileFor(media, model)
        if (file === undefined && (media.file !== undefined || (media.files?.length ?? 0) > 0))
          return { type: 'input_text', text: this.deps.codec.omittedText(media, model, 'files') }
        if (file === undefined) {
          const inlineGate = modalityGate(media.info, model, media.fps, 'inline')
          if (!inlineGate.ok)
            return {
              type: 'input_text',
              text: this.deps.codec.omittedText(media, model, 'modality'),
            }
        }
        const inline = this.inline.get(part) ?? part
        if (file === undefined && inline === part && this.restored.has(part))
          return { type: 'input_text', text: this.deps.codec.omittedText(media, model, 'source') }
        const encodedMedia =
          file === undefined
            ? this.deps.codec.encodeInline(media, inline, model)
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
      if (hasFreshMedia) this.assertPendingFits(content, budget)
      return { ...item, content }
    })
    this.assertPendingFits(this.pending(projected), budget)
    return projected
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
