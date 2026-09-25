// The getting-started tips under the empty state (M8), as the Claude Code
// panel shows its onboarding checklist: the default keybindings and the
// composer's tricks, with "Hide these tips" writing museSpark.hideOnboarding
// so they stay hidden across windows.

import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'

// The tips in the order shown; each id names a shortcut and what it does in
// the table (the text is read when the tips render, in the display language).
const TIP_IDS = [
  'focus',
  'palette',
  'cycleMode',
  'mentionSelection',
  'mentionFile',
  'newTab',
  'dictation',
] as const satisfies readonly (keyof UiText['onboardingTips'])[]

export interface OnboardingProps {
  readonly onHide: () => void
}

export function Onboarding({ onHide }: OnboardingProps) {
  return (
    <section className="onboarding" aria-label={UI_TEXT.onboardingTitle}>
      <h2 className="onboarding-title">{UI_TEXT.onboardingTitle}</h2>
      <ul className="onboarding-list">
        {TIP_IDS.map((id) => (
          <li key={id}>
            <kbd>{UI_TEXT.onboardingShortcuts[id]}</kbd> <span>{UI_TEXT.onboardingTips[id]}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="usage-link" onClick={onHide}>
        {UI_TEXT.onboardingHide}
      </button>
    </section>
  )
}
