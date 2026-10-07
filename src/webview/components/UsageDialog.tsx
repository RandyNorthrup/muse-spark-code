// App's deferred modal owns loading, failure, retry and dismissal.
import { createElement, lazy } from 'react'
import type { UsageDialogProps } from './UsageDialogContent'
export type { UsageDialogProps } from './UsageDialogContent'
const Content = lazy(() => import('./UsageDialogContent'))
export function UsageDialog(props: UsageDialogProps) {
  return createElement(Content, props)
}
