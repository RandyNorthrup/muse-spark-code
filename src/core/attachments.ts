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
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  MODEL_API_CONTEXT_BYTES_PER_TOKEN,
  MODEL_API_TEXT_BUDGET_TOKENS,
  MODEL_API_MEDIA_PER_REQUEST,
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
 * The images a message's attachments stand for in Meta's per-request budget
 * (M54): one per image, and a PDF's page images, at most its first 50. A
 * PDF whose pages could not be counted weighs the full 50, so the host
 * never accepts a set that would force a newly attached file out of view.
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
 * The record's byte limit when it names one, else Meta's published number
 * while no record reached attach, else none (the platform refuses the rest).
 */
function recordByteLimit(
  recordBytes: number | undefined,
  isMeta: boolean,
  metaBytes: number,
): number | undefined {
  return recordBytes ?? (isMeta ? metaBytes : undefined)
}

/**
 * Bytes past the record's limit are refused; undefined when they fit, so
 * both adders share one gate instead of mirroring it.
 */
function refuseOverLimit(
  recordBytes: number | undefined,
  isMeta: boolean,
  metaBytes: number,
  byteLength: number,
  metaReason: string,
): AddAttachmentResult | undefined {
  const maxBytes = recordByteLimit(recordBytes, isMeta, metaBytes)
  if (maxBytes !== undefined && byteLength > maxBytes) {
    return { ok: false, reason: isMeta ? metaReason : UI_TEXT.modelAttachmentOverLimit }
  }
  return undefined
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
    const isMeta = record === undefined || record.identity.provider === 'meta'
    // The record decides: Meta's own policy (its published inline limits),
    // another provider's, or Meta's numbers while no record reached attach.
    const documentLimit = refuseOverLimit(
      policy?.state === 'yes' ? policy.value.maxBytes : undefined,
      isMeta,
      MAX_DOCUMENT_BYTES,
      bytes.byteLength,
      UI_TEXT.documentTooLarge,
    )
    if (documentLimit !== undefined) {
      return documentLimit
    }
    const pageCount = pdfPageCount(bytes)
    if (
      !isMeta &&
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
    // A message Meta would refuse whole (more than 50 images) is refused here, with the reason.
    if (isMeta && this.weight() + imageWeight(summary) > MODEL_API_MEDIA_PER_REQUEST) {
      return {
        ok: false,
        reason: UI_TEXT.documentsOverBudget,
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
    const isMeta = record === undefined || record.identity.provider === 'meta'
    const imageLimit = refuseOverLimit(
      policy?.state === 'yes' ? policy.value.maxBytes : undefined,
      isMeta,
      MAX_IMAGE_BYTES,
      bytes.byteLength,
      UI_TEXT.attachmentTooLarge,
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
    let imageCount = 0
    for (const entry of this.entries.values()) {
      if (entry.summary.mediaType.startsWith('image/')) imageCount++
    }
    if (
      isMeta
        ? this.weight() + 1 > MODEL_API_MEDIA_PER_REQUEST
        : policy?.state === 'yes' &&
          policy.value.maxCount !== undefined &&
          imageCount + 1 > policy.value.maxCount
    ) {
      return {
        ok: false,
        reason: isMeta ? UI_TEXT.documentsOverBudget : UI_TEXT.modelAttachmentOverLimit,
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
    // Muse Code's 1 MiB file ceiling is its own transport bound. On the
    // Model API backend a text file (a plan brief included) is admitted by
    // the selected model's capability instead: its estimated tokens against
    // the window-minus-reserve budget below.
    if (shouldCheckMspBudget && bytes.byteLength > MAX_TEXT_ATTACHMENT_BYTES) {
      return { ok: false, reason: UI_TEXT.textFileTooLarge }
    }
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
   */
  public add(
    name: string,
    bytes: Uint8Array,
    canAcceptDocuments = false,
    canAcceptText = false,
    capabilityRecord?: ModelCapabilityRecord,
  ): AddAttachmentResult {
    if (this.entries.size >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return { ok: false, reason: UI_TEXT.attachmentLimit }
    }
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
    if (this.entries.size >= MAX_ATTACHMENTS_PER_MESSAGE)
      return { ok: false, reason: UI_TEXT.attachmentLimit }
    const media = this.media
    if (media === undefined) return { ok: false, reason: UI_TEXT.media.museCodeRefusal }
    const admission = media.check(info)
    if (!admission.ok) return { ok: false, reason: admission.reason }
    if (this.weight() + 1 > MODEL_API_MEDIA_PER_REQUEST)
      return { ok: false, reason: UI_TEXT.documentsOverBudget }
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
