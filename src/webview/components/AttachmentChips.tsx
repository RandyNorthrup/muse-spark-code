// The image, PDF and text chips above the composer for files waiting to be sent.

import { TEXT_ATTACHMENT_MEDIA_TYPE, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import type { AttachmentSummary } from '../../shared/protocol'
import { CloseIcon, FileIcon, ImageIcon } from './icons'

export interface AttachmentChipsProps {
  readonly attachments: readonly AttachmentSummary[]
  readonly onRemove: (id: string) => void
}

function sizeLabel(attachment: AttachmentSummary): string {
  if (attachment.width !== undefined && attachment.height !== undefined) {
    return `${formatNumber(attachment.width)}×${formatNumber(attachment.height)}`
  }
  return attachment.mediaType === TEXT_ATTACHMENT_MEDIA_TYPE
    ? UI_TEXT.textFileLabel
    : UI_TEXT.pdfLabel
}

export function AttachmentChips({ attachments, onRemove }: AttachmentChipsProps) {
  if (attachments.length === 0) {
    return null
  }
  return (
    <ul className="chips" aria-label={UI_TEXT.attachmentsLabel}>
      {attachments.map((attachment) => (
        <li key={attachment.id} className="chip">
          {attachment.width === undefined ? <FileIcon /> : <ImageIcon />}
          <span className="chip-name">{attachment.name}</span>
          <span className="chip-size">{sizeLabel(attachment)}</span>
          <button
            type="button"
            className="chip-remove chat-control"
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
