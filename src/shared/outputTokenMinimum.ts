// The one refusal for an output cap below a provider's minimum (MINOUT).
// A leaf of its own: team settings validate with it in the browser, and
// importing it from providerRouting.ts carried that module's provider-file
// English (UI_TEXT.providerText, 4 KB) into the browser's surface English,
// over its 25 KiB budget.
import { plural, UI_TEXT } from './l10n/text'

/** One refusal message shared by configuration and request dispatch. */
export function outputTokenMinimumMessage(minimum: number): string {
  return plural(UI_TEXT.outputCapBelowMinimum, minimum)
}
