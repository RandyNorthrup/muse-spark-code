import { EN, setVaultEnglish } from './en'
import { tableProblems } from './check'
import { UI_TEXT, uiLocale } from './text'

const english = EN.vault

/** Install the lazy English group before any vault render; validate installed-language data
 * that startup deferred, falling back to canonical English for a damaged group. */
export function installVaultEnglish(): void {
  setVaultEnglish(english)
  if (
    tableProblems(
      { vault: english },
      { vault: UI_TEXT.vault },
      { locale: uiLocale(), isStrict: false },
    ).length > 0
  )
    Object.defineProperty(UI_TEXT, 'vault', {
      value: english,
      writable: true,
      configurable: true,
      enumerable: true,
    })
}
