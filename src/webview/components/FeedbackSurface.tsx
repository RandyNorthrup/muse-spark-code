import { useEffect, useState } from 'react'
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
      if (opener?.isConnected === true) opener.focus()
    }
  }, [bridge, opener])
  return <LazyFeedbackDialog sessionId={sessionId} port={bridge.port} onClose={onClose} />
}
