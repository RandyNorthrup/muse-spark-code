import path from 'node:path'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type * as VoiceEntry from './voiceEntry'
import { UI_TEXT, uiLocale } from '../../shared/l10n/text'

// Same-build packaged factory; property validation cannot check a TS call signature.
function isEntry(value: unknown): value is typeof VoiceEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'openVoiceCompanion' in value &&
    typeof value.openVoiceCompanion === 'function'
  )
}

export function voiceCompanionLoader(deps: Parameters<typeof VoiceEntry.openVoiceCompanion>[0]) {
  const load = lazyBundleLoader({
    bundlePath: path.join(deps.packageRoot, 'dist', 'voiceCompanion.js'),
    log: deps.log,
    isBundle: isEntry,
    label: 'voice companion',
    unavailable: () => UI_TEXT.companionVoiceFailed,
  })
  return async (context: VoiceEntry.VoiceCompanionContext) =>
    await load().openVoiceCompanion(deps, context, UI_TEXT, uiLocale())
}
