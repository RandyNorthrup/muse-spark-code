// The Auto reviewer on Muse Code's shipped bundle (M90, PLAN.md D6, D69):
// esbuild builds this file into dist/museCodeReviewer.js, which the window
// requires on the first review, so neither the side session, nor what
// follows a review, nor M78's reviewer core is in the bundle VS Code loads at
// activation. It receives the installed display table, since the cards and
// notices it leaves are said in it.

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { MuseCodeReviewer, type MuseCodeReviewerDeps } from './museCodeReviewer'
import { MuseCodeHookModels, type MuseCodeHookModelDeps } from './museCodeHookModels'

/** One hidden hook session per window, in the existing Muse Code helper bundle. */
export function createMuseCodeHookModels(
  deps: MuseCodeHookModelDeps,
  table: UiText,
  locale: string,
): MuseCodeHookModels {
  setUiText(table, locale)
  return new MuseCodeHookModels(deps)
}

/** The window's reviewer: one side session and one queue for every conversation. */
export function createMuseCodeReviewer(
  deps: MuseCodeReviewerDeps,
  table: UiText,
  locale: string,
): MuseCodeReviewer {
  setUiText(table, locale)
  return new MuseCodeReviewer(deps)
}
