// Images, PDFs and picked UTF-8 text (M54, PLAN.md D47), waiting to go out with the next
// message. The host owns the bytes (the webview only shows chips) so a
// pasted screenshot never round-trips through postMessage twice, and the
// turn's parts are built here. PDF and image types are checked by bytes;
// text needs a picker-approved extension plus strict UTF-8 decoding.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import {
  BASE64_DATA_URL_OVERHEAD_CHARS,
  BASE64_INPUT_BLOCK_BYTES,
  BASE64_OUTPUT_BLOCK_CHARS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  MAX_ENCODED_MEDIA_CHARS,
  MAX_IMAGE_BYTES,
  MAX_MODEL_API_TEXT_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
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
import { readImageInfo } from './imageDimensions'
import { isPdf, pdfPageCount } from './pdf'
import type { TurnPart } from './agent/agentBackend'
import { textFileInput } from './textAttachment'

export type AddAttachmentResult =
  | { readonly ok: true; readonly attachment: AttachmentSummary }
  | { readonly ok: false; readonly reason: string }

interface StoredAttachment {
  readonly summary: AttachmentSummary
  readonly bytes: Uint8Array
  readonly text?: string
  readonly mspPartBytes?: number
  readonly modelApiTextBytes?: number
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

export class AttachmentStore {
  private readonly entries = new Map<string, StoredAttachment>()

  public constructor(
    private readonly newId: () => string,
    private readonly maxEncodedMediaChars: number = MAX_ENCODED_MEDIA_CHARS,
  ) {}

  /** Encoded data URL characters held for this message's images and PDFs. */
  private mediaChars(): number {
    return Array.from(this.entries.values(), (entry) =>
      entry.summary.mediaType === TEXT_ATTACHMENT_MEDIA_TYPE
        ? 0
        : this.encodedChars(entry.bytes, entry.summary.mediaType),
    ).reduce((total, length) => total + length, 0)
  }

  private encodedChars(bytes: Uint8Array, mediaType: string): number {
    const base64Length =
      BASE64_OUTPUT_BLOCK_CHARS * Math.ceil(bytes.byteLength / BASE64_INPUT_BLOCK_BYTES)
    return BASE64_DATA_URL_OVERHEAD_CHARS + mediaType.length + base64Length
  }

  /** Serialized MSP attachment parts, before prompt/context and command envelope. */
  private mspAttachmentBytes(): number {
    return Array.from(this.entries.values(), (entry) => entry.mspPartBytes ?? 0).reduce(
      (total, length) => total + length,
      0,
    )
  }

  /** Conservative text-only share of the Model API context window. */
  private modelApiTextBytes(): number {
    return Array.from(this.entries.values(), (entry) => entry.modelApiTextBytes ?? 0).reduce(
      (total, length) => total + length,
      0,
    )
  }

  private fitsMediaBytes(bytes: Uint8Array, mediaType: string): boolean {
    return this.mediaChars() + this.encodedChars(bytes, mediaType) <= this.maxEncodedMediaChars
  }

  private weight(): number {
    return Array.from(this.entries.values(), (entry) => imageWeight(entry.summary)).reduce(
      (total, weight) => total + weight,
      0,
    )
  }

  private addDocument(name: string, bytes: Uint8Array): AddAttachmentResult {
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      return { ok: false, reason: UI_TEXT.documentTooLarge }
    }
    const pageCount = pdfPageCount(bytes)
    const summary: AttachmentSummary = {
      id: this.newId(),
      name,
      mediaType: PDF_MEDIA_TYPE,
      sizeBytes: bytes.byteLength,
      ...(pageCount !== undefined && { pageCount }),
    }
    // A message Meta would refuse whole (more than 50 images) is refused here, with the reason.
    if (this.weight() + imageWeight(summary) > MODEL_API_MEDIA_PER_REQUEST) {
      return { ok: false, reason: UI_TEXT.documentsOverBudget }
    }
    if (!this.fitsMediaBytes(bytes, PDF_MEDIA_TYPE)) {
      return { ok: false, reason: UI_TEXT.mediaTotalTooLarge }
    }
    this.entries.set(summary.id, { summary, bytes })
    return { ok: true, attachment: summary }
  }

  private addImage(
    name: string,
    bytes: Uint8Array,
    shouldCheckMspBudget: boolean,
  ): AddAttachmentResult {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, reason: UI_TEXT.attachmentTooLarge }
    }
    const info = readImageInfo(bytes)
    if (info === undefined) {
      return { ok: false, reason: UI_TEXT.attachmentUnsupported }
    }
    if (this.weight() + 1 > MODEL_API_MEDIA_PER_REQUEST) {
      return { ok: false, reason: UI_TEXT.documentsOverBudget }
    }
    if (!this.fitsMediaBytes(bytes, info.mediaType)) {
      return { ok: false, reason: UI_TEXT.mediaTotalTooLarge }
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
    if (bytes.byteLength > MAX_TEXT_ATTACHMENT_BYTES) {
      return { ok: false, reason: UI_TEXT.textFileTooLarge }
    }
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return { ok: false, reason: UI_TEXT.textFileInvalid }
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
      this.modelApiTextBytes() + modelApiTextBytes > MAX_MODEL_API_TEXT_ATTACHMENT_BYTES
    ) {
      return { ok: false, reason: UI_TEXT.textFilesOverModelApiBudget }
    }
    this.entries.set(summary.id, { summary, bytes, text: content, mspPartBytes, modelApiTextBytes })
    return { ok: true, attachment: summary }
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
  ): AddAttachmentResult {
    if (this.entries.size >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return { ok: false, reason: UI_TEXT.attachmentLimit }
    }
    if (isPdf(bytes)) {
      return canAcceptDocuments
        ? this.addDocument(name, bytes)
        : { ok: false, reason: UI_TEXT.pdfNeedsModelApi }
    }
    if (name.toLowerCase().endsWith(PDF_EXTENSION)) {
      return { ok: false, reason: UI_TEXT.invalidPdf }
    }
    return canAcceptText && TEXT_ATTACHMENT_EXTENSIONS.has(path.extname(name).toLowerCase())
      ? this.addText(name, bytes, !canAcceptDocuments)
      : this.addImage(name, bytes, !canAcceptDocuments)
  }

  public remove(id: string): boolean {
    return this.entries.delete(id)
  }

  public clear(): void {
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
