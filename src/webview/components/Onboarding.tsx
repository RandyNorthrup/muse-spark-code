// The getting-started tips under the empty state (M8), as the Claude Code
// panel shows its onboarding checklist: the default keybindings and the
// composer's tricks, with "Hide these tips" writing museSpark.hideOnboarding
// so they stay hidden across windows.

import { ONBOARDING_TIPS, UI_TEXT } from '../../shared/constants'

export interface OnboardingProps {
  readonly onHide: () => void
}

export function Onboarding({ onHide }: OnboardingProps) {
  return (
    <section className="onboarding" aria-label={UI_TEXT.onboardingTitle}>
      <h2 className="onboarding-title">{UI_TEXT.onboardingTitle}</h2>
      <ul className="onboarding-list">
        {ONBOARDING_TIPS.map((tip) => (
          <li key={tip.shortcut}>
            <kbd>{tip.shortcut}</kbd> <span>{tip.text}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="usage-link" onClick={onHide}>
        {UI_TEXT.onboardingHide}
      </button>
    </section>
  )
}
