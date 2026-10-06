// The report can open in the app or over its crash screen; both share one lazy entry.
import { type ComponentProps, lazy, useEffect, useState } from 'react'
import type { ReportDialogHost as Host } from './ReportDialog'
import { DeferredSurface } from './DeferredSurface'

const ReportDialogHost = lazy(async () => {
  const module = await import('./ReportDialog')
  return { default: module.ReportDialogHost }
})

export function DeferredReportDialog(props: ComponentProps<typeof Host>) {
  // The loading modal takes focus before the real host mounts. Capture the
  // original opener here so closing either stage returns to that control.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    },
    [opener],
  )
  return (
    <DeferredSurface onClose={props.onClose}>
      <ReportDialogHost {...props} />
    </DeferredSurface>
  )
}
