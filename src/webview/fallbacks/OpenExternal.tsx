import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { Dialog } from './Dialog'

/** A browser gesture opens a detached window; blocked navigation is a visible failure. */
export function OpenExternal({
  uri,
  onOpened,
  onCancel,
}: {
  readonly uri: string
  readonly onOpened: () => void
  readonly onCancel: () => void
}) {
  const [hasError, setError] = useState(false)
  return (
    <Dialog title={uri} onCancel={onCancel}>
      {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
      <button
        type="button"
        onClick={() => {
          let opened: Window | null = null
          try {
            opened = window.open('about:blank', '_blank')
            if (opened === null) {
              setError(true)
              return
            }
            opened.opener = null
            opened.location.href = uri
            onOpened()
          } catch (error: unknown) {
            // A blocked popup throws a DOMException; anything else keeps its kind.
            if (!(error instanceof DOMException)) throw error
            try {
              opened?.close()
            } finally {
              setError(true)
            }
          }
        }}
      >
        {UI_TEXT.planOpen}
      </button>
    </Dialog>
  )
}
