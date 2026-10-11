// Meta reads at most 50 images in one request, and a PDF's page images (its
// first 50 pages) count toward them; past that the request is a 400
// (image-understanding, file-handling; read 2026-09-25). The Model API
// backend replays the whole conversation with every request (D1), so the
// images and PDFs of every earlier message ride along each time, and enough
// of them would fail every later request, the compaction's included. Each
// request therefore keeps its newest images and PDFs within the budget and
// names each older one in a line instead (M54, PLAN.md D47). The caller
// commits this fitted view to durable replay only after a successful model
// response; transcript attachment metadata remains for History.
//
// A PDF weighs its page images, at most 50. One whose pages could not be
// counted weighs the full 50, so the budget errs toward leaving a PDF out,
// never toward a request Meta refuses.

import { Buffer } from 'node:buffer'
import {
  MAX_ENCODED_MEDIA_CHARS,
  MODEL_API_MEDIA_PER_REQUEST,
  MODEL_API_MODEL_TEXT,
  MODEL_API_PDF_PAGE_IMAGES,
  UI_TEXT,
} from '../../../shared/constants'
import type { MediaInfo } from '../../../shared/media'
import { fill } from '../../../shared/l10n/text'
import { pdfPageCount } from '../../pdf'
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'
import type {
  FunctionOutputPart,
  InputContentPart,
  InputFilePart,
  InputItem,
  InputMessageItem,
} from './schemas'

// `data:application/pdf;base64,<data>`: the payload follows the first comma.
const DATA_URL_SEPARATOR = ','

function isUserMessage(item: InputItem): item is InputMessageItem {
  return item.type === 'message' && item.role === 'user'
}

/** What a PDF weighs from its own bytes: its page images, the full budget when uncounted. */
function pdfWeight(part: InputFilePart): number {
  const payload = part.file_data.slice(part.file_data.indexOf(DATA_URL_SEPARATOR) + 1)
  const pages = pdfPageCount(Buffer.from(payload, 'base64'))
  return Math.min(pages ?? MODEL_API_PDF_PAGE_IMAGES, MODEL_API_PDF_PAGE_IMAGES)
}

type OmissionReason = 'support' | 'mime' | 'limit' | 'budget'

function leftOut(part: InputContentPart, reason: OmissionReason) {
  const reasons = {
    support: MODEL_API_MODEL_TEXT.mediaSupportRefused,
    mime: MODEL_API_MODEL_TEXT.mediaMimeRefused,
    limit: MODEL_API_MODEL_TEXT.mediaLimitExceeded,
  }
  let text: string
  if (reason === 'budget') {
    text =
      part.type === 'input_file'
        ? fill(MODEL_API_MODEL_TEXT.pdfLeftOut, { name: part.filename })
        : MODEL_API_MODEL_TEXT.imageLeftOut
  } else {
    text = fill(MODEL_API_MODEL_TEXT.mediaLeftOut, { reason: reasons[reason] })
  }
  return { type: 'input_text' as const, text }
}

export class MediaBudget {
  /** Each PDF part's weight, learned once (from the attachment, or its bytes). */
  private readonly weights = new WeakMap<InputContentPart, number>()
  private readonly mediaChars = new WeakMap<InputContentPart, number>()
  private readonly mediaOmissions = new WeakMap<InputContentPart, string>()
  private wasOmitted = false

  public constructor(private readonly maxEncodedMediaChars: number = MAX_ENCODED_MEDIA_CHARS) {}

  private encodedChars(part: InputContentPart): number {
    const known = this.mediaChars.get(part)
    if (known !== undefined) return known
    switch (part.type) {
      case 'input_image': {
        return part.image_url.length
      }
      case 'input_file': {
        return part.file_data.length
      }
      default: {
        return 0
      }
    }
  }

  private weightOf(part: InputContentPart): number {
    const known = this.weights.get(part)
    if (known !== undefined) return known
    if (part.type === 'input_image') {
      return 1
    }
    if (part.type !== 'input_file') {
      return 0
    }
    const weight = pdfWeight(part)
    this.weights.set(part, weight)
    return weight
  }

  /** Whether the most recent fit replaced older media with an explanation. */
  public get omitted(): boolean {
    return this.wasOmitted
  }

  /** The PDF's page count as the attachment read it, so its bytes need not be read again. */
  public note(part: InputFilePart, pageCount: number | undefined): void {
    this.weights.set(
      part,
      Math.min(pageCount ?? MODEL_API_PDF_PAGE_IMAGES, MODEL_API_PDF_PAGE_IMAGES),
    )
  }

  /** Uploaded media has zero inline characters; video consumes one media slot (U3). */
  public noteMedia(
    part: InputContentPart,
    info: MediaInfo,
    encodedChars?: number,
    omission?: string,
  ): void {
    let weight = info.kind === 'text' ? 0 : 1
    if (info.kind === 'document')
      weight = Math.min(info.pageCount ?? MODEL_API_PDF_PAGE_IMAGES, MODEL_API_PDF_PAGE_IMAGES)
    this.weights.set(part, weight)
    if (encodedChars !== undefined) this.mediaChars.set(part, encodedChars)
    if (omission !== undefined) this.mediaOmissions.set(part, omission)
  }

  /** Fresh media must fit whole; only older replay can be elided. */
  public assertMessageFits(
    content: readonly InputContentPart[],
    queued?: { readonly chars: number; readonly slots: number },
  ): void {
    const usage = this.usage(content)
    if (usage.slots + (queued?.slots ?? 0) > MODEL_API_MEDIA_PER_REQUEST)
      throw new Error(UI_TEXT.documentsOverBudget)
    if (usage.chars + (queued?.chars ?? 0) > this.maxEncodedMediaChars)
      throw new Error(UI_TEXT.mediaTotalTooLarge)
  }

  public usage(content: readonly InputContentPart[]): {
    readonly chars: number
    readonly slots: number
  } {
    return {
      chars: content.reduce((total, part) => total + this.encodedChars(part), 0),
      slots: content.reduce((total, part) => total + this.weightOf(part), 0),
    }
  }

  /**
   * The input with its images and PDFs, newest first, kept while they fit
   * the budget and named in a line past it. The same array when all fit.
   * A changed item keeps retained content-part identities so the caller can
   * tell which pending tool-read media actually reached that request.
   */
  public fit(
    input: readonly InputItem[],
    record?: ModelCapabilityRecord,
    required: readonly InputContentPart[] = [],
  ): readonly InputItem[] {
    this.assertMessageFits(required)
    const reserved = this.usage(required)
    const protectedParts = new Set(required)
    let left = MODEL_API_MEDIA_PER_REQUEST - reserved.slots
    let imageCount = 0
    let encodedLeft = this.maxEncodedMediaChars - reserved.chars
    const refusal = (part: InputContentPart): OmissionReason | undefined => {
      if (protectedParts.has(part)) return undefined
      const weight = this.weightOf(part)
      if (weight === 0) {
        return undefined
      }
      const encodedChars = this.encodedChars(part)
      if (record !== undefined && record.identity.provider !== 'meta') {
        const isImage = part.type === 'input_image'
        const policy = isImage ? record.modalities.image : record.modalities.pdf
        if (policy.state !== 'yes') return 'support'
        let dataUrl = ''
        if (part.type === 'input_image') dataUrl = part.image_url
        else if (part.type === 'input_file') dataUrl = part.file_data
        const comma = dataUrl.indexOf(DATA_URL_SEPARATOR)
        const bytes = comma === -1 ? undefined : Buffer.from(dataUrl.slice(comma + 1), 'base64')
        if (
          policy.value.maxBytes !== undefined &&
          (bytes === undefined || bytes.byteLength > policy.value.maxBytes)
        )
          return 'limit'
        if (isImage) {
          const image = record.modalities.image
          if (
            image.state !== 'yes' ||
            image.value.mimes.every((mime) => !dataUrl.startsWith(`data:${mime};base64,`))
          )
            return 'mime'
          if (image.value.maxCount !== undefined && imageCount + 1 > image.value.maxCount)
            return 'budget'
        } else {
          const pdf = record.modalities.pdf
          const pages = bytes === undefined ? undefined : pdfPageCount(bytes)
          if (
            pdf.state !== 'yes' ||
            (pdf.value.maxPages !== undefined &&
              (pages === undefined || pages > pdf.value.maxPages))
          )
            return 'limit'
        }
        if (encodedChars > encodedLeft) return 'budget'
        if (isImage) imageCount++
        encodedLeft -= encodedChars
        return undefined
      }
      if (weight > left || encodedChars > encodedLeft) {
        return 'budget'
      }
      left -= weight
      encodedLeft -= encodedChars
      return undefined
    }
    const reversedInput = input.toReversed()
    const fitted = reversedInput.map((item) => {
      if (item.type === 'function_call_output' && typeof item.output !== 'string') {
        const reversedOutput = item.output.toReversed()
        const output = reversedOutput.map((part): FunctionOutputPart => {
          const reason = refusal(part)
          return reason === undefined ? part : leftOut(part, reason)
        })
        const isItemChanged = output.some((part, index) => part !== reversedOutput[index])
        return isItemChanged ? { ...item, output: output.toReversed() } : item
      }
      if (!isUserMessage(item)) {
        return item
      }
      const reversedContent = item.content.toReversed()
      const content = reversedContent.map((part) => {
        const reason = refusal(part)
        const omission = this.mediaOmissions.get(part)
        if (reason === undefined) return part
        return omission === undefined
          ? leftOut(part, reason)
          : { type: 'input_text' as const, text: omission }
      })
      const isItemChanged = content.some((part, index) => part !== reversedContent[index])
      return isItemChanged ? { ...item, content: content.toReversed() } : item
    })
    const isChanged = fitted.some((item, index) => item !== reversedInput[index])
    this.wasOmitted = isChanged
    return isChanged ? fitted.toReversed() : input
  }
}
