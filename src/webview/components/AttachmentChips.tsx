// The `name W×H` chips above the composer for images waiting to be sent.

import { UI_TEXT } from '../../shared/constants'
import type { AttachmentSummary } from '../../shared/protocol'
import { CloseIcon, ImageIcon } from './icons'

export interface AttachmentChipsProps {
  readonly attachments: readonly AttachmentSummary[]
  readonly onRemove: (id: string) => void
}

export function AttachmentChips({ attachments, onRemove }: AttachmentChipsProps) {
  if (attachments.length === 0) {
    return null
  }
  return (
    <ul className="chips" aria-label={UI_TEXT.attachmentsLabel}>
      {attachments.map((attachment) => (
        <li key={attachment.id} className="chip">
          <ImageIcon />
          <span className="chip-name">{attachment.name}</span>
          <span className="chip-size">
            {attachment.width}×{attachment.height}
          </span>
          <button
            type="button"
            className="chip-remove"
            title={UI_TEXT.removeAttachment}
            aria-label={`${UI_TEXT.removeAttachment} ${attachment.name}`}
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
