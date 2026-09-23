// A centred modal over the transcript with the chat dimmed behind it, as
// Claude Code's Account & Usage and Agent map dialogs are (PLAN.md D17).
// Escape, the close button and a click on the backdrop dismiss it; the close
// button takes focus on open so keyboard users are inside the dialog.

import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { CloseIcon } from './icons'

export interface ModalProps {
  readonly title: string
  /** The id the dialog is labelled by; unique per modal kind. */
  readonly titleId: string
  readonly isWide?: boolean
  readonly onClose: () => void
  readonly children: ReactNode
}

export function Modal({ title, titleId, isWide = false, onClose, children }: ModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeButton.current?.focus()
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={onBackdrop}>
      <div
        className={isWide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            title={UI_TEXT.usageClose}
            aria-label={UI_TEXT.usageClose}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
