// App's deferred modal owns loading, failure, retry and dismissal.
import { deferred } from './DeferredSurface'
import type { UsageDialogProps } from './UsageDialogContent'

/** @unwired unassigned read only by tests deleted 2026-10-17 (no fakes) */
export const UsageDialog = deferred<UsageDialogProps>(async () => {
  const module = await import('./UsageDialogContent')
  return { default: module.UsageDialogContent }
}, true)

export const UsageSurface = deferred(async () => {
  const module = await import('./UsageDialogContent')
  return { default: module.UsageSurface }
}, true)
