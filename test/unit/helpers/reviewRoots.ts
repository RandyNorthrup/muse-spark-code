import { PlanModeHold } from '../../../src/core/review/planModeHold'
import { reviewTurnText } from '../../../src/core/review/reviewPrompt'
import type { ReviewTurnFeatures } from '../../../src/host/review/reviewBundle'

/**
 * The review's parts as the bundle builds them (dist/review.js), over the
 * real modules: the collector a test chooses, and the marker it expects.
 */
export function reviewParts(
  collect: ReviewTurnFeatures['collect'],
  newMarker: ReviewTurnFeatures['newMarker'] = () => 'marker',
): ReviewTurnFeatures {
  return {
    collect,
    turnText: reviewTurnText,
    newMarker,
    createHold: (deps) => new PlanModeHold(deps),
  }
}
