// Muse Desktop (M111, D91.16) lane ST1: Language and region. The UI
// language and the formats region from locale1 through sysd, with the
// names the OS reports. One Apply carries both; they take effect at the
// next sign-in.

import { useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { LocaleState } from '../../../shared/desktop/sysd'
import type { PageBinding } from './binding'
import { PendingChangeDialog } from './dialog'
import { SettingRow, SettingsSection } from './rows'
import { usePendingChange } from './usePendingChange'

export interface LocaleChange {
  readonly kind: 'set'
  readonly language: string
  readonly region: string
}

export function LocalePage({
  data,
  onApply,
}: {
  readonly data: LocaleState
  readonly onApply: (change: LocaleChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const [language, setLanguage] = useState(data.language)
  const [region, setRegion] = useState(data.region)
  const isLanguageKnown = data.languages.some((entry) => entry.code === language)
  const isRegionKnown = data.regions.some((entry) => entry.code === region)
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.navLocale}>
        <SettingRow
          label={text.localeLanguage}
          control={
            <select
              className="muse-settings-select"
              aria-label={text.localeLanguage}
              value={isLanguageKnown ? language : ''}
              onChange={(event) => {
                setLanguage(event.target.value)
              }}
            >
              {isLanguageKnown ? null : <option value="">{data.language}</option>}
              {data.languages.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          label={text.localeRegion}
          control={
            <select
              className="muse-settings-select"
              aria-label={text.localeRegion}
              value={isRegionKnown ? region : ''}
              onChange={(event) => {
                setRegion(event.target.value)
              }}
            >
              {isRegionKnown ? null : <option value="">{data.region}</option>}
              {data.regions.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          }
        />
        <p className="muse-settings-note">{text.localeNote}</p>
        <div className="muse-settings-device-actions">
          <button
            type="button"
            className="muse-settings-button muse-settings-button-primary"
            disabled={language === '' || region === ''}
            onClick={() => {
              if (language === '' || region === '') {
                return
              }
              pending.request({ kind: 'set', language, region }, text.localeConfirm)
            }}
          >
            {text.apply}
          </button>
        </div>
      </SettingsSection>
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export const localePageBinding: PageBinding<LocaleState, LocaleChange> = {
  load: (client) => client.sysd.request('locale.get', {}),
  apply: async (client, change) => {
    await client.sysd.request('locale.set', { language: change.language, region: change.region })
    return await client.sysd.request('locale.get', {})
  },
  render: (data, onApply) => <LocalePage data={data} onApply={onApply} />,
}
