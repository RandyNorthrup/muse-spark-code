// The implementation/data ship together, loaded only on a reference action.
import { UI_TEXT } from '../shared/constants'
import type { WebviewToHostMessage } from '../shared/protocol'
import type { ReferenceRequest } from '../shared/reference/referenceEntry'
import type * as ReferenceBundle from '../shared/reference/referenceEntry'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from './lazyBundle'

type Bundle = typeof ReferenceBundle
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createReference' in value &&
    typeof value.createReference === 'function'
  )
}
export function referenceLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'reference bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

export function isReferenceRequest(message: WebviewToHostMessage): message is ReferenceRequest {
  return ['readReference', 'openReferenceSetting', 'runReferenceCommand'].includes(message.type)
}
