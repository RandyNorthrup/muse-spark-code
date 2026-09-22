import { PRODUCT_NAME } from '../../shared/constants'
import { MetaLogo } from './icons'
import { Onboarding } from './Onboarding'

export interface EmptyStateProps {
  readonly hint: string
  /** The getting-started tips (M8); off once museSpark.hideOnboarding is set. */
  readonly isOnboardingShown: boolean
  readonly onHideOnboarding: () => void
}

export function EmptyState({ hint, isOnboardingShown, onHideOnboarding }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="brand">
        <MetaLogo />
        <span>{PRODUCT_NAME}</span>
      </div>
      <p className="hint">{hint}</p>
      {isOnboardingShown && <Onboarding onHide={onHideOnboarding} />}
    </div>
  )
}
