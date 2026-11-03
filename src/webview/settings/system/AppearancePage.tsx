// Muse Desktop (M111, D91.16) lane ST1: Appearance. The theme override in
// the person's desktop.json (D91.19); the companion's settings section
// lands in this page with lane PE. Choosing a theme asks first, like
// every system change.

import type { ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { APPEARANCE_OVERRIDES, type AppearanceOverride } from '../../../shared/desktop/settings'
import { fill } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { PendingChangeDialog } from './dialog'
import { SettingsSection } from './rows'
import { usePendingChange } from './usePendingChange'

export type AppearanceChange = AppearanceOverride

export function AppearancePage({
  data,
  onApply,
}: {
  readonly data: AppearanceOverride
  readonly onApply: (change: AppearanceChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const names: Record<AppearanceOverride, string> = {
    system: text.appearanceThemeSystem,
    light: text.appearanceThemeLight,
    dark: text.appearanceThemeDark,
    'hc-light': text.appearanceThemeHcLight,
    'hc-dark': text.appearanceThemeHcDark,
  }
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.appearanceTheme}>
        <div
          className="muse-settings-radio-list"
          role="radiogroup"
          aria-label={text.appearanceTheme}
        >
          {APPEARANCE_OVERRIDES.map((value) => (
            <label key={value} className="muse-settings-radio">
              <input
                type="radio"
                name="muse-settings-theme"
                value={value}
                checked={data === value}
                onChange={() => {
                  pending.request(value, fill(text.appearanceConfirm, { theme: names[value] }))
                }}
              />
              {names[value]}
            </label>
          ))}
        </div>
        <p className="muse-settings-note">{text.appearanceThemeNote}</p>
      </SettingsSection>
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export const appearancePageBinding: PageBinding<AppearanceOverride, AppearanceChange> = {
  load: (client) => client.getAppearance(),
  apply: async (client, change) => {
    await client.setAppearance(change)
    return await client.getAppearance()
  },
  render: (data, onApply) => <AppearancePage data={data} onApply={onApply} />,
}
