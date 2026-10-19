// Images, PDFs and picked UTF-8 text (M54, PLAN.md D47), waiting to go out with the next
// message. The host owns the bytes (the webview only shows chips) so a
// pasted screenshot never round-trips through postMessage twice, and the
// turn's parts are built here. PDF and image types are checked by bytes;
// text needs a picker-approved extension plus strict UTF-8 decoding.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import {
  BASE64_INPUT_BLOCK_BYTES,
  BASE64_OUTPUT_BLOCK_CHARS,
  MODEL_API_CONTEXT_BYTES_PER_TOKEN,
  MODEL_API_TEXT_BUDGET_TOKENS,
  MODEL_API_PDF_PAGE_IMAGES,
  MSP_ATTACHMENT_FRAME_BUDGET_BYTES,
  PDF_EXTENSION,
  PDF_MEDIA_TYPE,
  TEXT_ATTACHMENT_EXTENSIONS,
  TEXT_ATTACHMENT_MEDIA_TYPE,
  UI_TEXT,
} from '../shared/constants'
import type { AttachmentSummary } from '../shared/protocol'
import { fill } from '../shared/l10n/text'
import { readImageInfo } from './imageDimensions'
import { isPdf, pdfPageCount } from './pdf'
import type { TurnPart } from './agent/agentBackend'
import type { ModelCapabilityRecord } from './providers/capabilityRecord'
import { textFileInput } from './textAttachment'
import type { MediaFileInfo, MediaLimitResult } from './media/limits'

/** Installed by the lazy media bundle; M2/E1/E2 bind the selected-model gate and wire. */
export interface AttachmentMediaPort {
  readonly sniff: (bytes: Uint8Array) => MediaFileInfo | undefined
  readonly check: (info: MediaFileInfo) => MediaLimitResult
  readonly part: (summary: AttachmentSummary, info: MediaFileInfo) => TurnPart
  /** The chip is discarded before sending: its registration goes (RVMEDIAV 7). */
  readonly release?: () => void
}

export type AddAttachmentResult =
  | { readonly ok: true; readonly attachment: AttachmentSummary }
  | { readonly ok: false; readonly reason: string }

interface StoredBytesAttachment {
  readonly summary: AttachmentSummary
  readonly bytes: Uint8Array
  readonly text?: string
  readonly mspPartBytes?: number
  readonly modelApiTextBytes?: number
}

type StoredAttachment =
  | StoredBytesAttachment
  | {
      readonly summary: AttachmentSummary
      readonly part: () => TurnPart
      readonly discard?: () => void
    }

const FIRST_PRINTABLE_CODE_POINT = 0x20

/** Whether text holds a control character other than a tab or a line break: not a text file. */
export function hasBinaryControlCharacters(content: string): boolean {
  for (const character of content) {
    if ('\t\n\r'.includes(character)) {
      continue
    }
    const codePoint = character.codePointAt(0) ?? FIRST_PRINTABLE_CODE_POINT
    if (codePoint < FIRST_PRINTABLE_CODE_POINT) {
      return true
    }
  }
  return false
}

/**
 * The images a message's attachments stand for in a provider's per-request
 * budget (M54): one per image, and a PDF's page images, at most its first
 * 50 (Meta's documented budget). A PDF whose pages could not be counted
 * weighs the full 50, so a record count errs toward protecting the request,
 * never toward sending one the provider refuses. The weight only matters
 * where a record states a count; without one nothing is enforced locally.
 */
function imageWeight(summary: AttachmentSummary): number {
  if (summary.mediaType === TEXT_ATTACHMENT_MEDIA_TYPE) {
    return 0
  }
  return summary.mediaType === PDF_MEDIA_TYPE
    ? Math.min(summary.pageCount ?? MODEL_API_PDF_PAGE_IMAGES, MODEL_API_PDF_PAGE_IMAGES)
    : 1
}

/**
 * D121: bytes past the record's own limit are refused, in the record's
 * words; without a record limit nothing is enforced locally, so both adders
 * share this one gate instead of mirroring it. The provider's own refusal
 * reaches the person in words at send.
 */
function refuseOverLimit(
  recordBytes: number | undefined,
  byteLength: number,
): AddAttachmentResult | undefined {
  return recordBytes !== undefined && byteLength > recordBytes
    ? { ok: false, reason: UI_TEXT.modelAttachmentOverLimit }
    : undefined
}

export class AttachmentStore {
  private readonly entries = new Map<string, StoredAttachment>()

  public constructor(
    private readonly newId: () => string,
    private media?: AttachmentMediaPort,
  ) {}

  /** Serialized MSP attachment parts, before prompt/context and command envelope. */
  private mspAttachmentBytes(): number {
    return Array.from(this.entries.values(), (entry) =>
      'bytes' in entry ? (entry.mspPartBytes ?? 0) : 0,
    ).reduce((total, length) => total + length, 0)
  }

  /** Conservative text-only share of the Model API context window, in UTF-8 bytes. */
  private modelApiTextBytes(): number {
    return Array.from(this.entries.values(), (entry) =>
      'bytes' in entry ? (entry.modelApiTextBytes ?? 0) : 0,
    ).reduce((total, length) => total + length, 0)
  }

  /**
   * The held Model API text in tokens, estimated high: the admission unit
   * the provider's window is counted in.
   */
  private modelApiTextTokens(): number {
    return Math.ceil(this.modelApiTextBytes() / MODEL_API_CONTEXT_BYTES_PER_TOKEN)
  }

  private weight(): number {
    return Array.from(this.entries.values(), (entry) => imageWeight(entry.summary)).reduce(
      (total, weight) => total + weight,
      0,
    )
  }

  private addDocument(
    name: string,
    bytes: Uint8Array,
    record?: ModelCapabilityRecord,
  ): AddAttachmentResult {
    const policy = record?.modalities.pdf
    if (policy !== undefined && policy.state !== 'yes')
      return { ok: false, reason: UI_TEXT.modelAttachmentUnsupported }
    // D121: the record decides, and only the record. Without one the
    // document attaches at any size and the provider answers for it at send.
    const documentLimit = refuseOverLimit(
      policy?.state === 'yes' ? policy.value.maxBytes : undefined,
      bytes.byteLength,
    )
    if (documentLimit !== undefined) {
      return documentLimit
    }
    const pageCount = pdfPageCount(bytes)
    if (
      policy?.state === 'yes' &&
      policy.value.maxPages !== undefined &&
      (pageCount === undefined || pageCount > policy.value.maxPages)
    )
      return {
        ok: false,
        reason: UI_TEXT.modelAttachmentOverLimit,
      }
    const summary: AttachmentSummary = {
      id: this.newId(),
      name,
      mediaType: PDF_MEDIA_TYPE,
      sizeBytes: bytes.byteLength,
      ...(pageCount !== undefined && { pageCount }),
    }
    // A set past the record's own per-request count is refused here, with
    // the reason; without a record count the send path answers for it.
    if (
      policy?.state === 'yes' &&
      policy.value.maxCount !== undefined &&
      this.weight() + imageWeight(summary) > policy.value.maxCount
    ) {
      return {
        ok: false,
        reason: UI_TEXT.modelAttachmentOverLimit,
      }
    }
    this.entries.set(summary.id, { summary, bytes })
    return { ok: true, attachment: summary }
  }

  private addImage(
    name: string,
    bytes: Uint8Array,
    shouldCheckMspBudget: boolean,
    record?: ModelCapabilityRecord,
  ): AddAttachmentResult {
    const policy = record?.modalities.image
    if (policy !== undefined && policy.state !== 'yes')
      return { ok: false, reason: UI_TEXT.modelAttachmentUnsupported }
    // D121: the record decides, and only the record. Without one the image
    // attaches at any size and the provider answers for it at send.
    const imageLimit = refuseOverLimit(
      policy?.state === 'yes' ? policy.value.maxBytes : undefined,
      bytes.byteLength,
    )
    if (imageLimit !== undefined) {
      return imageLimit
    }
    const info = readImageInfo(bytes)
    if (info === undefined) {
      return { ok: false, reason: UI_TEXT.attachmentUnsupported }
    }
    if (policy?.state === 'yes' && !policy.value.mimes.includes(info.mediaType))
      return { ok: false, reason: UI_TEXT.modelAttachmentUnsupported }
    if (
      policy?.state === 'yes' &&
      policy.value.maxCount !== undefined &&
      this.weight() + 1 > policy.value.maxCount
    ) {
      return {
        ok: false,
        reason: UI_TEXT.modelAttachmentOverLimit,
      }
    }
    const summary: AttachmentSummary = {
      id: this.newId(),
      name,
      mediaType: info.mediaType,
      width: info.width,
      height: info.height,
      sizeBytes: bytes.byteLength,
    }
    const base64Length =
      BASE64_OUTPUT_BLOCK_CHARS * Math.ceil(bytes.byteLength / BASE64_INPUT_BLOCK_BYTES)
    const mspPartBytes =
      Buffer.byteLength(
        JSON.stringify({
          type: 'image',
          base64Data: '',
          mediaType: info.mediaType,
          width: info.width,
          height: info.height,
        }),
      ) + base64Length
    if (
      shouldCheckMspBudget &&
      this.mspAttachmentBytes() + mspPartBytes > MSP_ATTACHMENT_FRAME_BUDGET_BYTES
    ) {
      return { ok: false, reason: UI_TEXT.commandTooLarge }
    }
    this.entries.set(summary.id, { summary, bytes, mspPartBytes })
    return { ok: true, attachment: summary }
  }

  private addText(
    name: string,
    bytes: Uint8Array,
    shouldCheckMspBudget: boolean,
  ): AddAttachmentResult {
    // D121: no per-file text size of ours. On the Muse Code backend the
    // frame budget below still bounds the transport, and Muse Code answers
    // for its own ceiling; on the Model API backend a text file (a plan
    // brief included) is admitted by the selected model's capability: its
    // estimated tokens against the window-minus-reserve budget below.
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (error: unknown) {
      // Only undecodable bytes are invalid text: anything else keeps its kind past the decode.
      if (error instanceof TypeError) {
        return { ok: false, reason: UI_TEXT.textFileInvalid }
      }
      throw error
    }
    if (hasBinaryControlCharacters(content)) {
      return { ok: false, reason: UI_TEXT.textFileInvalid }
    }
    const summary: AttachmentSummary = {
      id: this.newId(),
      name,
      mediaType: TEXT_ATTACHMENT_MEDIA_TYPE,
      sizeBytes: bytes.byteLength,
    }
    const modelText = textFileInput({
      type: 'textFile',
      name,
      mediaType: TEXT_ATTACHMENT_MEDIA_TYPE,
      sizeBytes: bytes.byteLength,
      text: content,
    })
    const modelApiTextBytes = Buffer.byteLength(modelText)
    const mspPartBytes = Buffer.byteLength(
      JSON.stringify({
        type: 'text',
        text: modelText,
      }),
    )
    if (
      shouldCheckMspBudget &&
      this.mspAttachmentBytes() + mspPartBytes > MSP_ATTACHMENT_FRAME_BUDGET_BYTES
    ) {
      return { ok: false, reason: UI_TEXT.textFilesOverBudget }
    }
    if (
      !shouldCheckMspBudget &&
      this.modelApiTextTokens() + Math.ceil(modelApiTextBytes / MODEL_API_CONTEXT_BYTES_PER_TOKEN) >
        MODEL_API_TEXT_BUDGET_TOKENS
    ) {
      return { ok: false, reason: UI_TEXT.textFilesOverModelApiBudget }
    }
    this.entries.set(summary.id, { summary, bytes, text: content, mspPartBytes, modelApiTextBytes })
    return { ok: true, attachment: summary }
  }

  /** The first media action installs its lazy bundle without losing existing attachments. */
  public installMediaPort(media: AttachmentMediaPort): void {
    this.media = media
  }

  /**
   * An image, or a PDF when `acceptsDocuments` (the Model API backend); the
   * caller refuses a PDF on Muse Code with its own reason first (M54).
   * D121: no count of ours — any number of attachments is held; the
   * transports' frame validity and the send path answer for the rest.
   */
  public add(
    name: string,
    bytes: Uint8Array,
    canAcceptDocuments = false,
    canAcceptText = false,
    capabilityRecord?: ModelCapabilityRecord,
  ): AddAttachmentResult {
    const mediaInfo = this.media?.sniff(bytes)
    if (mediaInfo !== undefined) return this.addMedia(name, mediaInfo)
    if (isPdf(bytes)) {
      return canAcceptDocuments
        ? this.addDocument(name, bytes, capabilityRecord)
        : { ok: false, reason: UI_TEXT.pdfNeedsModelApi }
    }
    if (name.toLowerCase().endsWith(PDF_EXTENSION)) {
      return { ok: false, reason: UI_TEXT.invalidPdf }
    }
    if (
      canAcceptText &&
      TEXT_ATTACHMENT_EXTENSIONS.has(path.extname(name.replaceAll('\\', '/')).toLowerCase())
    )
      return this.addText(name, bytes, !canAcceptDocuments)
    const image = this.addImage(name, bytes, !canAcceptDocuments, capabilityRecord)
    return !image.ok && image.reason === UI_TEXT.attachmentUnsupported && this.media !== undefined
      ? { ok: false, reason: fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }) }
      : image
  }

  /** Host sniffed a confined file. Keep metadata and the injected wire binding, never bytes. */
  public addMedia(
    name: string,
    info: MediaFileInfo,
    isScreenRecording = false,
  ): AddAttachmentResult {
    const media = this.media
    if (media === undefined) return { ok: false, reason: UI_TEXT.media.museCodeRefusal }
    // D121: no count of ours. The media bundle's own check (the selected
    // model's record) still admits, and the send path packs the request
    // against the provider's per-request budget with its words.
    const admission = media.check(info)
    if (!admission.ok) return { ok: false, reason: admission.reason }
    const summary: AttachmentSummary = {
      id: this.newId(),
      name,
      mediaType: info.mediaType,
      sizeBytes: info.sizeBytes,
      // The recording classification rides with the chip: cost and the
      // upload lifecycle read it (M105 E1 recording binding).
      media: { info, ...(isScreenRecording && { isScreenRecording: true as const }) },
    }
    this.entries.set(summary.id, {
      summary,
      part: () => media.part(summary, info),
      ...(media.release !== undefined && { discard: media.release }),
    })
    return { ok: true, attachment: summary }
  }

  public remove(id: string): boolean {
    const entry = this.entries.get(id)
    if (entry !== undefined && 'discard' in entry) entry.discard()
    return this.entries.delete(id)
  }

  public clear(): void {
    for (const entry of this.entries.values()) if ('discard' in entry) entry.discard()
    this.entries.clear()
  }

  public get size(): number {
    return this.entries.size
  }

  public list(): readonly AttachmentSummary[] {
    return Array.from(this.entries.values(), (entry) => entry.summary)
  }

  /**
   * Image and document parts for the given ids (unknown ids are skipped).
   * They stay until `release`: a message the host refused keeps them for
   * another try.
   */
  public partsFor(ids: readonly string[]): readonly TurnPart[] {
    const parts: TurnPart[] = []
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry === undefined) {
        continue
      }
      const { summary } = entry
      if ('part' in entry) {
        parts.push(entry.part())
        continue
      }
      if (entry.text !== undefined) {
        parts.push({
          type: 'textFile',
          name: summary.name,
          mediaType: summary.mediaType,
          sizeBytes: summary.sizeBytes,
          text: entry.text,
        })
        continue
      }
      const base64Data = Buffer.from(entry.bytes).toString('base64')
      parts.push(
        summary.width === undefined || summary.height === undefined
          ? {
              type: 'file',
              base64Data,
              mediaType: summary.mediaType,
              name: summary.name,
              sizeBytes: summary.sizeBytes,
              pageCount: summary.pageCount,
            }
          : {
              type: 'image',
              base64Data,
              mediaType: summary.mediaType,
              width: summary.width,
              height: summary.height,
            },
      )
    }
    return parts
  }

  /** The message carrying these attachments was accepted: they are gone from the composer. */
  public release(ids: readonly string[]): void {
    for (const id of ids) {
      this.entries.delete(id)
    }
  }
}
