import { lazy, Suspense } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type { ReportActionEditorProps } from './ReportActionEditor'

const Editor = lazy(async () => {
  const module = await import('./ReportActionEditor')
  return { default: module.ReportActionEditor }
})

export function DeferredReportActionEditor(props: ReportActionEditorProps) {
  return (
    <Suspense fallback={<p role="status">{UI_TEXT.loadingOutput}</p>}>
      <Editor {...props} />
    </Suspense>
  )
}
