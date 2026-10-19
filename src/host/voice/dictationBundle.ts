// Dictation's setups as the activation bundle sees them (M9, M35, PLAN.md
// D6): dist/dictation.js, built from dictationEntry.ts and required at the
// setups' existing construction points. Only types come from the bundle's
// side here: a value imported from there would carry the setups back into
// dist/extension.js, which the bundle-split gate refuses.
//
// There is no fallback without it: a setup that cannot load leaves its
// microphone unavailable (`dictationNotLoaded`, the log has the cause), as
// a helper that cannot be found does.

import type { UiText } from '../../shared/l10n/en'
import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as DictationEntry from './dictationEntry'

/** The bundle's setups and driver loaders, loaded together. */
export interface DictationBundle {
  readonly installDictationText: (table: UiText, locale: string) => void
  readonly createDictationSetup: typeof DictationEntry.createDictationSetup
  readonly createMuseVoiceSetup: typeof DictationEntry.createMuseVoiceSetup
  readonly voiceLoader: typeof DictationEntry.voiceLoader
  readonly voiceLinuxLoader: typeof DictationEntry.voiceLinuxLoader
}

/** Whether a required module exports every dictation entry point. */
export function isDictationBundle(value: unknown): value is DictationBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'installDictationText' in value &&
    typeof value.installDictationText === 'function' &&
    'createDictationSetup' in value &&
    typeof value.createDictationSetup === 'function' &&
    'createMuseVoiceSetup' in value &&
    typeof value.createMuseVoiceSetup === 'function' &&
    'voiceLoader' in value &&
    typeof value.voiceLoader === 'function' &&
    'voiceLinuxLoader' in value &&
    typeof value.voiceLinuxLoader === 'function'
  )
}

export interface DictationLoaderDeps {
  /** dist/dictation.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required at the setups' construction points and kept from then on. */
export function dictationLoader(deps: DictationLoaderDeps): () => DictationBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isDictationBundle,
    label: 'dictation bundle',
    unavailable: () => UI_TEXT.dictationNotLoaded,
  })
}
