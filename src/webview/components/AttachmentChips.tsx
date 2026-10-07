// The image, PDF and text chips above the composer for files waiting to be sent.

import { TEXT_ATTACHMENT_MEDIA_TYPE, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatNumber, formatUnit } from '../../shared/l10n/text'
import type { AttachmentSummary } from '../../shared/protocol'
import { CloseIcon, FileIcon, ImageIcon } from './icons'

export interface AttachmentChipsProps {
  readonly attachments: readonly AttachmentSummary[]
  readonly onRemove: (id: string) => void
}

function sizeLabel(attachment: AttachmentSummary): string {
  const info = attachment.media?.info
  if (info !== undefined && 'durationSeconds' in info) {
    const duration =
      info.durationSeconds === null
        ? UI_TEXT.media.durationUnknown
        : formatUnit(info.durationSeconds, 'second')
    const size = `${duration} · ${formatBytes(info.sizeBytes)}`
    if (info.kind !== 'video') return size
    let sound = UI_TEXT.media.soundUnknown
    if (info.hasSoundtrack !== null)
      sound = info.hasSoundtrack ? UI_TEXT.media.sound : UI_TEXT.media.noSound
    return `${size} · ${sound}`
  }
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
