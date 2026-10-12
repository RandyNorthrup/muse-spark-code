// Durable metadata and per-request projections. Bytes/approved sources stay
// transient; a model switch never overwrites the original upload reference.
//
// One admission path (M105 W redesign): every media input a request carries
// is priced here, through one function, at the calibrated estimator's seeded
// upper bound. Two kinds of record exist and never mix:
// - upload records (`parts`): host-issued attachments and adopted tool
//   uploads, whose sources reopen and whose file ids replay;
// - inline records (`inlineVisuals`): images and PDFs carried as data URLs
//   (attached, read by a tool, or restored with the session). They are
//   identified from the bytes on the wire, priced on every request that
//   carries them, and never registered for upload, so pricing one can never
//   make a later turn reopen a source that does not exist (the RVMEDIAW P1).
// "Unknown rate → refused" applies only while the session is capped
// (D85.6); uncapped sessions price at the seeded bound where one exists and
// otherwise keep the established byte count.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { MEDIA_FILE_ID_MIN_BYTES, MEDIA_NAME_MAX_CHARS, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatUnit } from '../../shared/l10n/text'
import { readImageInfo } from '../imageDimensions'
import { pdfPageCount } from '../pdf'
import {
  storedMediaPartSchema,
  type MediaInfo,
  type StoredMediaPart,
  type UploadedMediaRef,
} from '../../shared/media'
import { type MediaCostEstimator, type MediaCostItem, reserveMediaRequest } from './mediaCost'
import { requestParts, type BudgetMediaPart } from '../backends/modelapi/sessionBudget'
import type { CreateResponseBody } from '../backends/modelapi/schemas'
import type { TurnPart } from '../agent/agentBackend'
import type { UploadSource } from '../backends/modelapi/files'
import type { InputContentPart, InputItem } from '../backends/modelapi/schemas'
import type { StoredReplayItem } from '../backends/modelapi/sessionStore'
import type { ResponsesMediaCodec } from '../backends/modelapi/codecs/responses'
import type { MediaBudget } from '../backends/modelapi/mediaBudget'
import { pinOwnerForRequest, type UploadLedger } from './uploadLedger'
import { modalityGate, type MediaModelCapabilities, type MediaGateResult } from './modalityGate'

export { storedMediaPartSchema, type StoredMediaPart } from '../../shared/media'

export interface ReplayMediaDeps {
  readonly estimator?: MediaCostEstimator

  readonly capabilities: (modelId: string) => MediaModelCapabilities
  readonly codec: ResponsesMediaCodec
  readonly ledger: (
    provider: string,
  ) => Pick<UploadLedger, 'ensure' | 'ensureAndPin' | 'pinFiles' | 'unpinFiles'>
  /** M101 C1 chooses complete recent turns; this lane preserves their canonical media. */
  readonly compactionTail: (entries: readonly StoredReplayItem[]) => readonly string[]
  /** E1/E2 resolve host-issued tokens or approved legacy attachments, never guessed paths.
   * Images and PDFs carried inline need no resolver: their identity is read
   * from the bytes on the wire. Absent until lane V binds attach tokens. */
  readonly attachment?: (part: TurnPart) => StoredMediaPart | undefined
  /** Whether this session spends under a cap now (M82 session cap, a D95.3
   * scheduled run). Only then does an unknown rate refuse. Absent means
   * capped, the fail-safe reading. */
  readonly isCapped?: () => boolean
  /** Whether the session is disposed: then nothing is read or uploaded (RVMEDIAV3 2). */
  readonly isClosed?: () => boolean
  /** Each open repeats confinement and approval checks. No source path is stored.
   * `token` is the attach token the record resolved through, when it did. */
  readonly source: (
    media: StoredMediaPart,
    signal: AbortSignal,
    token?: string,
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

/** The data URL of an inline image or PDF part, as the request builder writes it. */
const DATA_URL_PREFIX = /^data:([^;,]+);base64,/u
/** Inline images carry no file name; the record names them generically. */
const INLINE_IMAGE_NAME = 'image'
const INLINE_PDF_NAME = 'document.pdf'

/**
 * An inline visual's calibrated identity, read from the bytes on the wire:
 * kind, media type, size, dimensions or page count, and digest. Undefined
 * for anything that is not a decodable inline image or PDF.
 */
function inlineVisualIdentity(part: InputContentPart): StoredMediaPart | undefined {
  let url: string
  let name: string
  if (part.type === 'input_image' && 'image_url' in part) {
    url = part.image_url
    name = INLINE_IMAGE_NAME
  } else if (part.type === 'input_file' && 'file_data' in part) {
    url = part.file_data
    // The name only labels the record; a name the schema cannot hold never
    // leaves the bytes unpriced.
    name = part.filename.length > 0 ? part.filename.slice(0, MEDIA_NAME_MAX_CHARS) : INLINE_PDF_NAME
  } else {
    return undefined
  }
  const prefix = DATA_URL_PREFIX.exec(url)
  if (prefix === null) return undefined
  const bytes = Buffer.from(url.slice(prefix[0].length), 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let candidate: unknown
  if (part.type === 'input_image') {
    const image = readImageInfo(bytes)
    if (image === undefined) return undefined
    candidate = {
      name,
      sha256,
      info: {
        kind: 'image',
        mediaType: image.mediaType,
        sizeBytes: bytes.length,
        width: image.width,
        height: image.height,
      },
    }
  } else {
    if (prefix[1] !== 'application/pdf') return undefined
    const pageCount = pdfPageCount(bytes)
    candidate = {
      name,
      sha256,
      info: {
        kind: 'document',
        mediaType: 'application/pdf',
        sizeBytes: bytes.length,
        ...(pageCount !== undefined && { pageCount }),
      },
    }
  }
  const parsed = storedMediaPartSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

/** What the session tells its one media service, read per request. */
export interface MediaReplaySession {
  readonly isCapped: () => boolean
  readonly isClosed: () => boolean
}

/** Structural host seam: W can bind a lazy adapter without inheriting this implementation. */
export interface MediaReplayPort {
  readonly budgetParts: ReplayMedia['budgetParts']
  readonly reserveRequest: ReplayMedia['reserveRequest']

  readonly beginRequest: ReplayMedia['beginRequest']
  readonly endRequest: ReplayMedia['endRequest']
  readonly pending: ReplayMedia['pending']
  readonly assertPendingFits: ReplayMedia['assertPendingFits']
  readonly adopt: ReplayMedia['adopt']
  readonly upload: ReplayMedia['upload']
  readonly content: ReplayMedia['content']
  readonly restore: ReplayMedia['restore']
  readonly prepare: ReplayMedia['prepare']
  readonly admitInline: ReplayMedia['admitInline']
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

/** Bracket owners are unique per process: the boot id plus this counter. */
const bracketIds = { sequence: 0 }

export class ReplayMedia {
  private readonly parts = new WeakMap<InputContentPart, StoredMediaPart>()
  private readonly restored = new WeakSet<InputContentPart>()
  /** The attach token each content resolved through: its source, and no other, uploads (RVMEDIAV2). */
  private readonly tokens = new WeakMap<InputContentPart, string>()
  private readonly inline = new WeakMap<InputContentPart, InputContentPart>()
  private readonly replacements = new Set<string>()
  /** RULE 1: the turn bracket's durable pins per provider, drained at its end. */
  private readonly bracketPins = new Map<string, Set<string>>()
  private bracketOpen = false
  /**
   * COUNTED REFERENCES WITH AN OWNER (round 4, P2-2): this bracket's pins
   * carry one owner, so another request's end never releases what this
   * request still carries. The count lives in the ledger, not here.
   */
  private bracketOwner: string | undefined
  /** Inline records: each part's identity read once from its wire bytes
   * (null: not a decodable visual). Never consulted for upload or replay. */
  private readonly inlineVisuals = new WeakMap<InputContentPart, StoredMediaPart | null>()

  public constructor(
    private readonly sessionId: string,
    private readonly deps: ReplayMediaDeps,
  ) {}

  private model(modelId: string): MediaModelCapabilities {
    const model = this.deps.capabilities(modelId)
    if (model.modelId !== modelId) throw new Error('Media capability model mismatch')
    return model
  }

  private isCapped(): boolean {
    return this.deps.isCapped?.() ?? true
  }

  /**
   * The inline record for a user-message image or PDF the selected model's
   * captured record prices. A model with no captured record for the kind
   * keeps the established inline path (D85.1: unknown support never becomes
   * a rate, and the request builder's own limits still apply).
   */
  private inlineVisual(
    part: InputContentPart,
    model: () => MediaModelCapabilities,
  ): StoredMediaPart | undefined {
    if (this.parts.has(part)) return undefined
    let media = this.inlineVisuals.get(part)
    if (media === undefined) {
      media = inlineVisualIdentity(part) ?? null
      this.inlineVisuals.set(part, media)
    }
    if (media === null) return undefined
    // Only a decodable visual consults the selected model's record: a
    // no-media request stays byte-identical and never looks one up.
    const kind = media.info.kind === 'image' ? 'image' : 'document'
    return model().modalities[kind].support === 'yes' ? media : undefined
  }

  /** The request model's record, looked up once and only when media needs it. */
  private lazyModel(modelId: string): () => MediaModelCapabilities {
    let model: MediaModelCapabilities | undefined
    return () => (model ??= this.model(modelId))
  }

  /**
   * The one pricing function every input goes through: the estimator's
   * seeded upper bound; a named refusal when the session is capped and the
   * rate or duration is unknown; undefined when uncapped and unknown, which
   * keeps the established byte count.
   */
  private price(
    media: MediaCostItem,
    model: MediaModelCapabilities,
  ): { readonly upperBoundInputTokens: number } | undefined {
    const isCapped = this.isCapped()
    const estimator = this.deps.estimator
    if (estimator === undefined) {
      if (isCapped) throw new Error(fill(UI_TEXT.media.cappedRateUnknown, { model: model.modelId }))
      return undefined
    }
    return estimator.estimate(model.provider, model.modelId, media, isCapped)
  }

  /** Every media item a request body carries: upload records and inline visuals,
   * including the images an MCP tool returned inside its function output. */
  private requestMedia(body: CreateResponseBody): MediaCostItem[] {
    const model = this.lazyModel(body.model)
    // Inline bytes are counted by the provider as sent; the bound reserves,
    // but the bill never becomes a calibration point.
    const inline = (part: InputContentPart): MediaCostItem[] => {
      const visual = this.inlineVisual(part, model)
      return visual === undefined ? [] : [{ ...visual, inlinePriced: true }]
    }
    return body.input.flatMap((item): MediaCostItem[] => {
      if (item.type === 'function_call_output')
        return typeof item.output === 'string' ? [] : item.output.flatMap((part) => inline(part))
      return item.type === 'message' && item.role === 'user'
        ? item.content.flatMap((part): MediaCostItem[] => {
            const upload = this.parts.get(part)
            return upload === undefined ? inline(part) : [upload]
          })
        : []
    })
  }

  /** The parts that keep their own bytes in the count; each priced one becomes its bound. */
  private priceContent<T extends InputContentPart>(
    content: readonly T[],
    isUser: boolean,
    model: () => MediaModelCapabilities,
    priced: BudgetMediaPart[],
  ): T[] {
    return content.filter((part) => {
      const media = this.parts.get(part) ?? (isUser ? this.inlineVisual(part, model) : undefined)
      if (media === undefined) return true
      const estimate = this.price(media, model())
      // Uncapped with no rate: the part's own bytes stay in the count.
      if (estimate === undefined) return true
      priced.push({
        mediaIdentity: JSON.stringify(media),
        upperBoundInputTokens: estimate.upperBoundInputTokens,
      })
      return false
    })
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

  /** This bracket's pin owner, minted once so every pin shares it. */
  private bracketOwnerForPin(): string {
    if (this.bracketOwner === undefined) {
      bracketIds.sequence += 1
      this.bracketOwner = pinOwnerForRequest(`${this.sessionId}:${String(bracketIds.sequence)}`)
    }
    return this.bracketOwner
  }

  /** Remember a file the single-scope upload pinned, so the bracket's end drains it. */
  private rememberBracket(provider: string, fileId: string): void {
    const pinned = this.bracketPins.get(provider) ?? new Set<string>()
    pinned.add(fileId)
    this.bracketPins.set(provider, pinned)
  }

  /** Pin durably under this bracket's owner and remember for its end. */
  private async pinBracket(provider: string, fileIds: readonly string[]): Promise<void> {
    if (fileIds.length === 0) return
    await this.deps.ledger(provider).pinFiles(fileIds, this.bracketOwnerForPin())
    const pinned = this.bracketPins.get(provider) ?? new Set<string>()
    for (const fileId of fileIds) pinned.add(fileId)
    this.bracketPins.set(provider, pinned)
  }

  /** Detached metadata follows the actual projection, including replayed file IDs. */
  public budgetParts(body: CreateResponseBody): readonly (string | BudgetMediaPart)[] {
    const parts: (string | BudgetMediaPart)[] = [...requestParts({ ...body, input: [] })]
    const model = this.lazyModel(body.model)
    for (const item of body.input) {
      const priced: BudgetMediaPart[] = []
      if (item.type === 'function_call_output' && typeof item.output !== 'string') {
        // An MCP tool's image (M50) is priced like every other image on a
        // model whose record prices images; elsewhere its bytes stay counted.
        const output = this.priceContent(item.output, true, model, priced)
        parts.push(JSON.stringify({ ...item, output }), ...priced)
        continue
      }
      if (item.type !== 'message') {
        parts.push(JSON.stringify(item))
        continue
      }
      const content = this.priceContent(item.content, item.role === 'user', model, priced)
      parts.push(JSON.stringify({ ...item, content }), ...priced)
    }
    return parts
  }

  /**
   * Admission for an inline image or PDF (attached, or read by a tool before
   * it tells the model the file follows): the same pricing every request
   * repeats, so a capped session refuses an unmeasurable visual with the
   * honest reason before anything queues. Nothing is recorded for upload.
   */
  public admitInline(inline: InputContentPart, modelId: string): void {
    const model = this.lazyModel(modelId)
    const media = this.inlineVisual(inline, model)
    if (media !== undefined) this.price(media, model())
  }

  public async reserveRequest(
    body: CreateResponseBody,
    request: Omit<Parameters<typeof reserveMediaRequest>[0], 'items' | 'estimator'>,
  ) {
    const items = this.requestMedia(body)
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

  /**
   * Open the request bracket (RULE 1): every file this request carries is
   * pinned durably, so a stale window's save cannot delete one while the
   * turn's requests are in flight. Later rounds only top the bracket up;
   * the turn's end drains it.
   */
  public async beginRequest(input: readonly InputItem[]): Promise<void> {
    this.replacements.clear()
    this.bracketOpen = true
    this.bracketOwnerForPin()
    const byProvider = new Map<string, Set<string>>()
    for (const part of this.managed(input)) {
      const media = this.parts.get(part)
      if (media === undefined) continue
      for (const file of [
        ...(media.file === undefined ? [] : [media.file]),
        ...(media.files ?? []),
      ]) {
        const ids = byProvider.get(file.provider) ?? new Set<string>()
        ids.add(file.fileId)
        byProvider.set(file.provider, ids)
      }
    }
    for (const [provider, ids] of byProvider) {
      try {
        await this.pinBracket(provider, [...ids])
      } catch (error: unknown) {
        // Only the request's own provider can be pinned: a replay holding a
        // ref from a provider this host never bound (round 4, P3-6) skips
        // that provider instead of failing the turn. Anything else throws.
        if (!(error instanceof Error) || error.message !== 'Media upload provider mismatch')
          throw error
      }
    }
  }

  /**
   * Close the request bracket, however the turn settled: every pin this
   * turn took is released. Safe with no bracket open. An unpin that fails
   * is kept for the next end and never throws: this close runs in the
   * turn's finally and must not replace the turn's real error (P2-1).
   */
  public async endRequest(): Promise<void> {
    this.bracketOpen = false
    const owner = this.bracketOwner
    this.bracketOwner = undefined
    if (this.bracketPins.size === 0) return
    const pinned = [...this.bracketPins]
    this.bracketPins.clear()
    for (const [provider, ids] of pinned) {
      try {
        await this.deps.ledger(provider).unpinFiles([...ids], owner)
      } catch {
        const kept = this.bracketPins.get(provider) ?? new Set<string>()
        for (const fileId of ids) kept.add(fileId)
        this.bracketPins.set(provider, kept)
        if (owner !== undefined) this.bracketOwner = owner
      }
    }
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
  // The ledger takes any captured media kind: the runtime schema admits
  // images and documents too, and the modality gate decides per model.
  public async upload(
    file: {
      readonly name: string
      readonly info: MediaInfo
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
    // UPLOAD AND PIN HAPPEN IN ONE LOCK SCOPE (round 4, P2-3): no stale
    // save can land between them. Outside any bracket the upload waits for
    // the next beginRequest instead, so a file no turn ever carries is
    // never pinned.
    if (!this.bracketOpen)
      return await this.deps
        .ledger(model.provider)
        .ensure(this.sessionId, media.sha256, file.source, signal)
    const uploaded = await this.deps
      .ledger(model.provider)
      .ensureAndPin(this.sessionId, media.sha256, file.source, signal, this.bracketOwnerForPin())
    this.rememberBracket(model.provider, uploaded.fileId)
    return uploaded
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
    const raw = this.deps.attachment?.(part)
    // An attached video or audio part whose token the registry no longer
    // holds (a new conversation, a forged or stale part) is refused.
    if (raw === undefined && part.type === 'media')
      throw new Error(fill(UI_TEXT.media.sourceChanged, { name: part.name }))
    if (raw === undefined) {
      // An inline image or PDF: priced through the one admission path, kept
      // as an inline record, never registered for upload.
      this.admitInline(inline, modelId)
      return inline
    }
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
    if (part.type === 'media') this.tokens.set(content, part.token)
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
    // A disposed session reads and uploads nothing, whatever still runs (RVMEDIAV3 2).
    const assertOpen = () => {
      signal.throwIfAborted()
      if (this.deps.isClosed?.() === true) throw new Error(UI_TEXT.turnStoppedByRestart)
    }
    for (const part of this.managed(input)) {
      assertOpen()
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
      const approved = await this.deps.source(media, signal, this.tokens.get(part))
      // The last wait before a read or an upload: nothing awaits between here and either.
      assertOpen()
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
      // UPLOAD AND PIN HAPPEN IN ONE LOCK SCOPE (round 4, P2-3): no stale
      // save can land between the re-upload and its pin.
      const file = await this.deps
        .ledger(model.provider)
        .ensureAndPin(this.sessionId, media.sha256, source, signal, this.bracketOwnerForPin())
      this.rememberBracket(model.provider, file.fileId)
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
      const media = this.deps.attachment?.(part)
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
