// The controls stay unavailable until their chunk loads. Closing while it
// loads unmounts the boundary, so a late import cannot reopen the surface.
import { type ReactNode, Suspense, useEffect, useRef } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { Modal } from './Modal'

export function DeferredSurface({
  children,
  onClose,
  isModal = true,
}: {
  readonly children: ReactNode
  readonly onClose: () => void
  readonly isModal?: boolean
}) {
  return (
    <Suspense fallback={<LoadingSurface onClose={onClose} isModal={isModal} />}>
      {children}
    </Suspense>
  )
}

function LoadingSurface({
  onClose,
  isModal,
}: {
  readonly onClose: () => void
  readonly isModal: boolean
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!isModal) close.current?.focus()
  }, [isModal])
  const status = (
    <p role="status" data-deferred-loading>
      {UI_TEXT.loadingOutput}
    </p>
  )
  if (isModal) {
    return (
      <Modal title={UI_TEXT.loadingOutput} titleId="deferred-title" onClose={onClose}>
        {status}
      </Modal>
    )
  }
  return (
    <div
      className="palette history"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      {status}
      <button ref={close} type="button" className="button-secondary" onClick={onClose}>
        {UI_TEXT.usageClose}
      </button>
    </div>
  )
}
