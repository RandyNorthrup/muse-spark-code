// The pack index verifier's loader (M110t TP2): dist/packsVerify.js on
// the first pack fetch, with an honest failure when the chunk is gone.
import { lazyBundleLoader } from '../../../host/lazyBundle'
import type { CoreLogger } from '../../../core/logging'
import { UI_TEXT } from '../../../shared/constants'
import type { verifyPackIndexBundle } from './verifyEntry'

/**
The lazy chunk's shape.
@unwired M110 the ACP pack fetch wires the loader
*/
export interface PacksVerifyBundle {
  readonly verifyPackIndexBundle: typeof verifyPackIndexBundle
}

/**
Same-build factory signatures are trusted after checking the exports (PLAN §8).
@unwired M110 the ACP pack fetch wires the loader
*/
export function isPacksVerifyBundle(value: unknown): value is PacksVerifyBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'verifyPackIndexBundle' in value &&
    typeof value.verifyPackIndexBundle === 'function'
  )
}

/**
Build the loader the pack fetch calls before its first verify.
@unwired M110 the ACP pack fetch wires the loader
*/
export function packsVerifyLoader(deps: {
  readonly bundlePath: string
  readonly log: CoreLogger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): () => PacksVerifyBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isPacksVerifyBundle,
    label: 'Pack verification',
    unavailable: () => UI_TEXT.packsVerifyUnavailable,
  })
}
