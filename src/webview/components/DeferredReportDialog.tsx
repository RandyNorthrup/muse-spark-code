// The report can open in the app or over its crash screen; both share one lazy entry.
import { useEffect, useState } from 'react'
import type { ReportDialogState } from '../state/uiState'
import type { WebviewToHostMessage } from '../../shared/protocol'
import { deferred } from './DeferredSurface'

const ReportDialogHost = deferred(async () => {
  const module = await import('./ReportDialog')
  return { default: module.ReportDialogHostOrLoading }
}, true)

export function DeferredReportDialog(props: {
  readonly report: ReportDialogState | undefined
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly onClose: () => void
}): React.JSX.Element {
  // The loading modal takes focus before the real host mounts. Capture the
  // original opener here so closing either stage returns to that control.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    },
    [opener],
  )
  return <ReportDialogHost {...props} />
}
