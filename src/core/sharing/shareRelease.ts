import { exportFileName } from '../export/transcriptMarkdown'
import { UI_TEXT } from '../../shared/constants'
import * as z from 'zod/mini'
import {
  admitShareRelease,
  shareRequestSchema,
  scrubShareText,
  type SharePrivacyPort,
} from '../../shared/share'
import {
  buildChatShare,
  renderChatShare,
  type ChatShareRequest,
  type ChatShareSource,
  type ChatShareDocument,
} from './chatShare'

export interface ChatSharePreview {
  readonly previewId: string
  readonly request: ChatShareRequest
  readonly fileName: string
  /** Exact sink bytes, also displayed in the preview. */
  readonly content: string
}

const previewSchema = z.strictObject({
  previewId: z.string().check(z.minLength(1)),
  request: shareRequestSchema,
  fileName: z.string(),
  content: z.string(),
})

/** Use at the host bridge boundary before the shared dialog displays a preview. */
export function parseChatSharePreview(input: unknown): ChatSharePreview {
  const preview = previewSchema.parse(input)
  if (preview.request.target !== 'chat') throw new Error(UI_TEXT.shareRangeInvalid)
  return { ...preview, request: preview.request }
}

export interface ChatShareReleasePort {
  readonly privacy: SharePrivacyPort
  readonly isConfidentialWorkspace: () => boolean | undefined
  readonly newPreviewId: () => string
  /**
   * Prepare a destination (e.g. the save picker), without writing or opening.
   * Return the sink to invoke immediately after the final policy check.
   * A sink with further asynchronous side effects calls `admit` again immediately
   * before each write/open; a browser adapter uses this after creating its file.
   */
  readonly prepare: (
    preview: ChatSharePreview,
  ) => Promise<((admit: () => void) => Promise<void>) | undefined>
}

/** Host-owned, one-use confirmation. Never trusts preview bytes from a view. */
export class ChatShareRelease {
  private preview:
    { readonly data: ChatSharePreview; readonly document: ChatShareDocument } | undefined
  private generation = 0

  public constructor(private readonly port: ChatShareReleasePort) {}

  /** Call on option/range edits, replacement sessions and closing the dialog. */
  public invalidate(): void {
    this.preview = undefined
    this.generation += 1
  }

  /** A closed/replaced dialog cannot resurrect its token when a history read finishes late. */
  public async prepareFromHistory(
    read: () => Promise<ChatShareSource>,
    input: unknown,
  ): Promise<ChatSharePreview> {
    this.invalidate()
    const generation = this.generation
    const request = shareRequestSchema.parse(input)
    admitShareRelease(
      { step: 'confirmed', previewId: this.port.newPreviewId(), request },
      this.port.isConfidentialWorkspace,
    )
    const source = await read()
    if (generation !== this.generation) throw new Error(UI_TEXT.sharePreviewExpired)
    return this.preparePreview(source, request)
  }

  public preparePreview(source: ChatShareSource, input: unknown): ChatSharePreview {
    this.invalidate()
    const request = shareRequestSchema.parse(input)
    if (request.target !== 'chat') throw new Error(UI_TEXT.shareRangeInvalid)
    const previewId = this.port.newPreviewId()
    admitShareRelease({ step: 'confirmed', previewId, request }, this.port.isConfidentialWorkspace)
    const doc = buildChatShare(source, request, this.port.privacy)
    const content = renderChatShare(doc, request.format)
    const preview = {
      previewId,
      request,
      fileName: exportFileName(doc.title, new Date(doc.createdAt), request.format),
      content,
    }
    // Own the request too: a caller mutating the returned object cannot change
    // what the eventual sink receives or what the confirmation must match.
    this.preview = { data: structuredClone(preview), document: doc }
    return preview
  }

  public async confirm(input: unknown): Promise<'shared' | 'dismissed'> {
    const release = admitShareRelease(input, this.port.isConfidentialWorkspace)
    const stored = this.preview
    if (stored === undefined) throw new Error(UI_TEXT.sharePreviewExpired)
    const preview = stored.data
    if (
      release.previewId !== preview.previewId ||
      JSON.stringify(release.request) !== JSON.stringify(preview.request)
    ) {
      throw new Error(UI_TEXT.sharePreviewExpired)
    }
    const generation = this.generation
    const document = stored.document
    // Consume before the async picker so a double click cannot dispatch twice.
    this.preview = undefined
    const sink = await this.port.prepare(structuredClone(preview))
    if (sink === undefined) return 'dismissed'
    const admit = () => {
      if (generation !== this.generation) throw new Error(UI_TEXT.sharePreviewExpired)
      const current = JSON.stringify(document, (_key, value: unknown) =>
        typeof value === 'string' ? scrubShareText(value, this.port.privacy) : value,
      )
      if (current !== JSON.stringify(document)) throw new Error(UI_TEXT.sharePreviewExpired)
      admitShareRelease(release, this.port.isConfidentialWorkspace)
    }
    admit()
    await sink(admit)
    return 'shared'
  }
}
