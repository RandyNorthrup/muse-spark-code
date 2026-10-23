// RLF-DEVICES: the maker executors as dist/devices.js sees them
// (PLAN.md D6): dist/maker.js, built from makerEntry.ts and required on
// the first maker execution. Only types come from the entry side here:
// a value imported from there would carry the executors back into
// dist/devices.js, which the bundle-split gate refuses.
//
// There is no fallback without it: an execution that cannot load it
// fails with MAKER_MODEL_TEXT.makerBundleUnavailable (the log has the
// cause), and the next execution tries again.
import { MAKER_MODEL_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as MakerEntry from './makerEntry'

/** The bundle's one export. */
export interface MakerBundle {
  readonly createMakerService: typeof MakerEntry.createMakerService
}

/** Whether a required module exports the factory. */
export function isMakerBundle(value: unknown): value is MakerBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createMakerService' in value &&
    typeof value.createMakerService === 'function'
  )
}

export interface MakerLoaderDeps {
  /** dist/maker.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first execution and kept from then on. */
export function makerLoader(deps: MakerLoaderDeps): () => MakerBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isMakerBundle,
    label: 'maker bundle',
    unavailable: () => MAKER_MODEL_TEXT.makerBundleUnavailable,
  })
}
