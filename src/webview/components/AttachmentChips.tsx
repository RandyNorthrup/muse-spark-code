// The attachment chips above the composer; media cost stays in a lazy region.

import { lazy, Suspense } from 'react'
import { TEXT_ATTACHMENT_MEDIA_TYPE, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import type { AttachmentSummary } from '../../shared/protocol'
import { CloseIcon, FileIcon, ImageIcon } from './icons'

const AttachmentMediaCost = lazy(async () => {
  const module = await import('./AttachmentMediaCost')
  return { default: module.AttachmentMediaCost }
})

export interface AttachmentChipsProps {
  readonly attachments: readonly AttachmentSummary[]
  readonly onRemove: (id: string) => void
  /** Selected-model capability/tier from the host; no vendor inference in the chip. */
  readonly isContributor?: boolean
}

function sizeLabel(attachment: AttachmentSummary): string {
  if (attachment.width !== undefined && attachment.height !== undefined) {
    return `${formatNumber(attachment.width)}×${formatNumber(attachment.height)}`
  }
  return attachment.mediaType === TEXT_ATTACHMENT_MEDIA_TYPE
    ? UI_TEXT.textFileLabel
    : UI_TEXT.pdfLabel
}

export function AttachmentChips({
  attachments,
  onRemove,
  isContributor = false,
}: AttachmentChipsProps) {
  if (attachments.length === 0) {
    return null
  }
  return (
    <ul className="chips" aria-label={UI_TEXT.attachmentsLabel}>
      {attachments.map((attachment) => (
        <li key={attachment.id} className="chip">
          {attachment.width === undefined ? <FileIcon /> : <ImageIcon />}
          <span className="chip-name">{attachment.name}</span>
          {attachment.media === undefined ? (
            <span className="chip-size">{sizeLabel(attachment)}</span>
          ) : (
            <Suspense fallback={null}>
              <AttachmentMediaCost media={attachment.media} isContributor={isContributor} />
            </Suspense>
          )}
          <button
            type="button"
            className="chip-remove"
            title={UI_TEXT.removeAttachment}
            aria-label={fill(UI_TEXT.removeAttachmentNamed, { name: attachment.name })}
            onClick={() => {
              onRemove(attachment.id)
            }}
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ul>
  )
}
