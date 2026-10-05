// What's New's shipped bundle (M99, PLAN.md D6, D79): esbuild builds this
// file into dist/whatsNew.js, which the window requires on the first page or
// notice (after an update, or from the command), so the page's renderer, its
// content schema and its tab stay out of the bundle VS Code loads at
// activation. It receives the installed display table, since the page is
// said in it.

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { createWhatsNewPagesFor, type WhatsNewPages, type WhatsNewPagesDeps } from './whatsNewPanel'

/** The window's What's New tab. */
export function createWhatsNewPages(
  deps: WhatsNewPagesDeps,
  table: UiText,
  locale: string,
): WhatsNewPages {
  setUiText(table, locale)
  return createWhatsNewPagesFor(deps)
}
