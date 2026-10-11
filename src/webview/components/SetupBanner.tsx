// The post-wizard confirmation (M95, PLAN.md D74): "You're set up with
// `<provider>` · `<model>`" with Manage providers, once, dismissible. The
// wizard (lane K) saved the provider and set the composer's model; the host
// announced it with `setupComplete`, which uiState keeps until dismissed.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { CloseIcon } from './icons'

export interface SetupBannerProps {
  readonly provider: string
  readonly model: string
  readonly onManageProviders: () => void
  readonly onDismiss: () => void
}

export function SetupBanner({ provider, model, onManageProviders, onDismiss }: SetupBannerProps) {
  return (
    <div className="composer-banner" role="status">
      <span>{fill(UI_TEXT.setupComplete, { provider, model })}</span>
      <button type="button" className="button-secondary" onClick={onManageProviders}>
        {UI_TEXT.manageProviders}
      </button>
      <button
        type="button"
        className="icon-button"
        title={UI_TEXT.bannerDismiss}
        aria-label={UI_TEXT.bannerDismiss}
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
