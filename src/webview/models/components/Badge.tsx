// One Models-table badge (M95 acceptance 17): Recommended, Cheapest
// capable, Largest context, New, Deprecated or Beta, each shown by its
// rule. Text only, so the four themes and every language carry it.

import { UI_TEXT } from '../../../shared/constants'

export type BadgeKind =
  'recommended' | 'cheapestCapable' | 'largestContext' | 'isNew' | 'deprecated' | 'beta'

const BADGE_TEXT: Record<BadgeKind, () => string> = {
  recommended: () => UI_TEXT.modelBadges.recommended,
  cheapestCapable: () => UI_TEXT.modelBadges.cheapestCapable,
  largestContext: () => UI_TEXT.modelBadges.largestContext,
  isNew: () => UI_TEXT.modelBadges.newBadge,
  deprecated: () => UI_TEXT.modelBadges.deprecated,
  beta: () => UI_TEXT.modelBadges.beta,
}

export function Badge({ kind }: { readonly kind: BadgeKind }) {
  return <span className={`models-badge models-badge-${kind}`}>{BADGE_TEXT[kind]()}</span>
}
