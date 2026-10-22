import { useEffect, useState } from 'react'
import { webviewErrorReport } from '../errorReport'
import { feedbackBridge } from '../feedbackBridge'
import type { WebviewToHostMessage } from '../../shared/protocol'
import { deferred } from './DeferredSurface'

// The lifecycle chunk and the form have separate lazy owners. The existing
// startup, deferred and action-dialog caps count every byte unchanged.
const LazyFeedbackDialog = deferred(async () => {
  const module = await import('./FeedbackDialog')
  return { default: module.FeedbackDialog }
}, true)

/** The bridge and refusal strings load only when the dialog is opened. */
export function FeedbackSurface({
  sessionId,
  opener,
  postMessage,
  onClose,
}: {
  readonly sessionId: string
  readonly opener: HTMLElement | null
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly onClose: () => void
}) {
  const [bridge] = useState(() => feedbackBridge(postMessage))
  useEffect(() => {
    bridge.open()
    return () => {
      bridge.close()
      // The dialog returns focus to the control that opened it, or to the
      // composer when that control is gone — a removed row menu, a session
      // change — so focus never rests on the page behind (RVCM1063D cause 2).
      if (opener?.isConnected === true) {
        opener.focus()
        return
      }
      document.querySelector<HTMLTextAreaElement>('.composer-area .composer-input')?.focus()
    }
  }, [bridge, opener])
  return (
    <LazyFeedbackDialog
      sessionId={sessionId}
      port={bridge.port}
      reportError={(source, error) => {
        postMessage(webviewErrorReport(source, error))
      }}
      onClose={onClose}
    />
  )
}
