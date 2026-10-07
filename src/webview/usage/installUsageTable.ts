import { UI_TEXT, setUiText } from '../../shared/l10n/text'
import { setUsageText, isUsageText, type UsageTable } from '../../shared/l10n/usageTable'

/** Validate the locale before changing either table or the shared Intl state. */
export function installUsageTable({
  locale,
  table,
}: UsageTable): 'invalidLocale' | 'invalidTable' | undefined {
  try {
    Intl.getCanonicalLocales(locale)
  } catch {
    return 'invalidLocale'
  }
  if (!isUsageText(table, locale)) return 'invalidTable'
  setUiText(UI_TEXT, locale)
  setUsageText(table)
  document.documentElement.lang = locale
  return undefined
}
