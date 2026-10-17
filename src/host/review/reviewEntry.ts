// The review's bundle (M70, PLAN.md D6): esbuild builds this file into
// dist/review.js, which `lazyReview` requires the first time a review starts,
// so git's material (the collector, its filter and root checks, the diff
// readers), the review turn's text and the Plan-mode hold, together about a
// fifth of the activation bundle's budget, stay out of the bundle VS Code
// loads at activation. Like the Model API bundle it carries its own copy of
// every module it shares with dist/extension.js, the display language's table
// among them, so the factory installs the activation bundle's table before it
// builds anything.

import { PlanModeHold } from '../../core/review/planModeHold'
import { reviewTurnText } from '../../core/review/reviewPrompt'
import { setUiText } from '../../shared/l10n/text'
import { EditReview } from '../editor/editReview'
import type { ReviewBundleDeps, ReviewFeatures } from './reviewBundle'
import { createReviewCollector, reviewMarker } from './reviewCollector'

/** The review's parts over the activation bundle's git runner and picker. */
export function createReviewFeatures(deps: ReviewBundleDeps): ReviewFeatures {
  setUiText(deps.uiText, deps.uiLocale)
  return {
    collect: createReviewCollector(deps.collector),
    turnText: reviewTurnText,
    newMarker: reviewMarker,
    createHold: (holdDeps) => new PlanModeHold(holdDeps),
    editReview: new EditReview(deps.editReview),
  }
}
