// The Muse Code backend's bundle as the activation bundle sees it (PR206,
// PLAN.md D6): `dist/museCode.js`, built from `museCodeEntry.ts` and loaded
// by `MuseCodeBackendManager` the first time that backend starts. Only types
// come from the backend's side here: a value imported from there would carry
// the host, its notification mapping and the SDK back into
// dist/extension.js, which the bundle-split gate refuses.

import type * as MuseCodeEntry from './museCodeEntry'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'

/** The bundle's exports: the host class and the two SDK spawn paths. */
export interface MuseCodeBundle {
  readonly installMuseCodeUiText: typeof MuseCodeEntry.installMuseCodeUiText
  readonly MuseCodeHost: typeof MuseCodeEntry.MuseCodeHost
  readonly spawnAccountMspConnection: typeof MuseCodeEntry.spawnAccountMspConnection
  readonly spawnMspConnection: typeof MuseCodeEntry.spawnMspConnection
}

/** Whether a required module exports the backend's host and spawn paths. */
export function isMuseCodeBundle(value: unknown): value is MuseCodeBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'installMuseCodeUiText' in value &&
    typeof value.installMuseCodeUiText === 'function' &&
    'MuseCodeHost' in value &&
    typeof value.MuseCodeHost === 'function' &&
    'spawnAccountMspConnection' in value &&
    typeof value.spawnAccountMspConnection === 'function' &&
    'spawnMspConnection' in value &&
    typeof value.spawnMspConnection === 'function'
  )
}

export interface MuseCodeBundleLoaderDeps {
  /** dist/museCode.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/**
 * The backend's bundle, required the first time it is asked for and kept
 * from then on; a missing or corrupt bundle throws `museCodeBundleUnavailable`
 * and is tried again on the next call. The installed display table goes in on
 * every load, since the bundle carries its own copy of the English fallback.
 */
export function museCodeBundleLoader(deps: MuseCodeBundleLoaderDeps): () => MuseCodeBundle {
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isMuseCodeBundle,
    label: 'Muse Code backend bundle',
    unavailable: () => UI_TEXT.museCodeBundleUnavailable,
  })
  return () => {
    const bundle = load()
    bundle.installMuseCodeUiText(UI_TEXT, uiLocale())
    return bundle
  }
}
