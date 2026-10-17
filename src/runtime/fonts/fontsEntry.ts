// Runtime-only lazy entry. No VSIX/editor dependency and no automatic installation.
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { runFontInstall } from './nodeInstall'

export { applyFontPreferences, fontAppearanceSettings } from './preferences'

export async function installFonts(
  input: Parameters<typeof runFontInstall>[0],
  table: UiText,
  locale: string,
): Promise<string> {
  setUiText(table, locale)
  return await runFontInstall(input)
}
