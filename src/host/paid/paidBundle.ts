// The paid features' bundle (dist/paid.js, PLAN.md D6): the paid gate, use
// consent, usage and quote authority. Activation keeps only the loader;
// the bundle is required the first time a paid path needs it.
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type { createPaid } from './paidEntry'

export interface PaidBundle {
  readonly createPaid: typeof createPaid
}
export function isPaidBundle(value: unknown): value is PaidBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPaid' in value &&
    typeof value.createPaid === 'function'
  )
}
export function paidBundleLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: (file: string) => unknown
}): () => PaidBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isPaidBundle,
    label: 'paid features',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
