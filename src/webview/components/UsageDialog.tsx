// App's deferred modal owns loading, failure, retry and dismissal.
import { deferred } from './DeferredSurface'
import type { UsageDialogProps } from './UsageDialogContent'
export type { UsageDialogProps } from './UsageDialogContent'

export const UsageDialog = deferred<UsageDialogProps>(async () => {
  const module = await import('./UsageDialogContent')
  return { default: module.UsageDialogContent }
}, true)

export const UsageSurface = deferred(async () => {
  const module = await import('./UsageDialogContent')
  return { default: module.UsageSurface }
}, true)
