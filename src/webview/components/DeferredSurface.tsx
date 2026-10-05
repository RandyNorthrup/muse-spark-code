// Account & usage stays inert until its optional chunk loads. Closing
// unmounts the pending dialog; a late load cannot reopen it.
import { type ReactNode, Suspense } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { Modal } from './Modal'

export function DeferredSurface({
  children,
  onClose,
}: {
  readonly children: ReactNode
  readonly onClose: () => void
}) {
  return (
    <Suspense
      fallback={
        <Modal title={UI_TEXT.loadingOutput} titleId="deferred-title" onClose={onClose}>
          <p role="status" data-deferred-loading>
            {UI_TEXT.loadingOutput}
          </p>
        </Modal>
      }
    >
      {children}
    </Suspense>
  )
}
