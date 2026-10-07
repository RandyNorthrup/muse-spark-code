import { deferred } from './DeferredSurface'
import type { UsageDialogProps } from './UsageDialogContent'
export type { UsageDialogProps } from './UsageDialogContent'

export const UsageDialog = deferred<UsageDialogProps>(async () => {
  const module = await import('./UsageDialogContent')
  return { default: module.UsageDialogContent }
}, true)
