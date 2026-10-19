// The shipped German table installed through the real loader (PLAN.md D33),
// for tests of what the user reads in another language; English goes back
// after each (M76 review).

import { readFileSync } from 'node:fs'
import { loadUiTable, type UiTable } from '../../../src/host/l10n'
import type { Logger } from '../../../src/host/logger'
import { EN } from '../../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../../src/shared/l10n/text'

/** Loads the German table for suites that read through it; pair with restoreEnglish. */
export function loadGermanTable(log: Logger): Promise<UiTable> {
  return loadUiTable({
    language: 'de',
    readExtensionFile: () =>
      Promise.resolve(readFileSync(new URL('../../../l10n/ui.de.json', import.meta.url), 'utf8')),
    log,
  })
}

/** Installs `l10n/ui.de.json` as activation would; returns the locale it installed. */
export async function installGerman(log: Logger): Promise<string> {
  const loaded = await loadGermanTable(log)
  return loaded.locale
}

/** English again, for the tests that follow. */
export function restoreEnglish(): void {
  setUiText(EN, BASE_LOCALE)
}
