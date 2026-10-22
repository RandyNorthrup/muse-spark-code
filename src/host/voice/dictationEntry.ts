// Dictation's shipped CommonJS bundle (M9, M35, PLAN.md D6): the window's
// dictation and Muse Voice setups with the helper probes, required at their
// existing construction points, so finding the helper (whether the
// microphone is offered at all) keeps its timing while its bytes leave
// dist/extension.js. The drivers stay where they were: dist/voice.js, loaded
// on the first recording, and Linux's offline driver with its helper/model
// acquisition in dist/voiceLinux.js, loaded on the first Linux recording.
// The setups read the installed display table, installed here before they
// are made. Only types come from the bundle's side elsewhere: a value
// imported from there would carry the setups back into dist/extension.js,
// which the bundle-split gate refuses.

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export {
  createDictationSetup,
  type DictationHostCaps,
  type DictationHostNames,
  createMuseVoiceSetup,
  type MuseVoiceSetupDeps,
} from '../vscode/voice/dictationHost'
export { voiceLinuxLoader, voiceLoader, type VoiceLoaderDeps } from './voiceBundle'

/**
Installs the caller's display table in this bundle before the setups are
made, as the other split bundles do per use.
*/
export function installDictationText(table: UiText, locale: string): void {
  setUiText(table, locale)
}
