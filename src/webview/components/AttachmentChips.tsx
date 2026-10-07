// The attachment chips above the composer; media cost stays in a lazy region.

import { lazy, Suspense, type ReactNode } from 'react'
import { TEXT_ATTACHMENT_MEDIA_TYPE, UI_TEXT } from '../../shared/constants'
import { fill, formatBytes, formatNumber, formatUnit } from '../../shared/l10n/text'
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
  /** M105-A: E1/C inject the lazy sound surface after W admits its budget. */
  readonly renderAudio?: (attachment: AttachmentSummary) => ReactNode
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

export function AttachmentChips({
  attachments,
  onRemove,
  isContributor = false,
  renderAudio,
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
          {renderAudio?.(attachment)}
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
