// Muse Desktop (M111, D91.16) lane ST1: Date and time. Automatic time,
// the time zone and the manual date and time, from timedate1 through
// sysd. The switch and the zone ask at once; the manual form's Apply
// names the moment it sets.

import { useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { DateTimeState } from '../../../shared/desktop/sysd'
import { fill, formatDateTime } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { PendingChangeDialog } from './dialog'
import { SettingRow, SettingsSection, SettingsSwitch } from './rows'
import { usePendingChange } from './usePendingChange'

export type DateTimeChange =
  | { readonly kind: 'automatic'; readonly automatic: boolean }
  | { readonly kind: 'timezone'; readonly timezone: string }
  | { readonly kind: 'manual'; readonly unixMs: number }

function toUnixMs(date: string, time: string): number | undefined {
  if (date === '' || time === '') {
    return undefined
  }
  const parsed = Date.parse(`${date}T${time}`)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function DateTimePage({
  data,
  onApply,
}: {
  readonly data: DateTimeState
  readonly onApply: (change: DateTimeChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const manualMs = toUnixMs(date, time)
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.datetimeAutomatic}>
        <SettingRow
          label={text.datetimeAutomatic}
          control={
            <SettingsSwitch
              label={text.datetimeAutomatic}
              checked={data.automatic}
              onFlip={(isOn) => {
                pending.request(
                  { kind: 'automatic', automatic: isOn },
                  isOn ? text.datetimeConfirmAutoOn : text.datetimeConfirmAutoOff,
                )
              }}
            />
          }
        />
        <SettingRow
          label={text.datetimeCurrent}
          control={
            <span className="muse-settings-device-sub">{formatDateTime(data.nowUnixMs)}</span>
          }
        />
      </SettingsSection>
      <SettingsSection title={text.datetimeTimezone}>
        <select
          className="muse-settings-select"
          aria-label={text.datetimeTimezone}
          value={data.zoneNames.includes(data.timezone) ? data.timezone : ''}
          onChange={(event) => {
            const timezone = event.target.value
            if (timezone !== '') {
              pending.request(
                { kind: 'timezone', timezone },
                fill(text.datetimeConfirmTimezone, { zone: timezone }),
              )
            }
          }}
        >
          {data.zoneNames.includes(data.timezone) ? null : (
            <option value="">{data.timezone}</option>
          )}
          {data.zoneNames.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </SettingsSection>
      {data.automatic ? null : (
        <SettingsSection title={text.datetimeSetManually}>
          <SettingRow
            label={text.datetimeDate}
            control={
              <input
                className="muse-settings-input"
                type="date"
                aria-label={text.datetimeDate}
                value={date}
                onChange={(event) => {
                  setDate(event.target.value)
                }}
              />
            }
          />
          <SettingRow
            label={text.datetimeTime}
            control={
              <input
                className="muse-settings-input"
                type="time"
                aria-label={text.datetimeTime}
                value={time}
                onChange={(event) => {
                  setTime(event.target.value)
                }}
              />
            }
          />
          <div className="muse-settings-device-actions">
            <button
              type="button"
              className="muse-settings-button muse-settings-button-primary"
              disabled={manualMs === undefined}
              onClick={() => {
                if (manualMs === undefined) {
                  return
                }
                pending.request(
                  { kind: 'manual', unixMs: manualMs },
                  fill(text.datetimeConfirmManual, { when: formatDateTime(manualMs) }),
                )
              }}
            >
              {text.apply}
            </button>
          </div>
        </SettingsSection>
      )}
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export const dateTimePageBinding: PageBinding<DateTimeState, DateTimeChange> = {
  load: (client) => client.sysd.request('datetime.get', {}),
  apply: async (client, change) => {
    if (change.kind === 'automatic') {
      await client.sysd.request('datetime.setAutomatic', { automatic: change.automatic })
    } else if (change.kind === 'timezone') {
      await client.sysd.request('datetime.setTimezone', { timezone: change.timezone })
    } else {
      await client.sysd.request('datetime.setManual', { unixMs: change.unixMs })
    }
    return await client.sysd.request('datetime.get', {})
  },
  render: (data, onApply) => <DateTimePage data={data} onApply={onApply} />,
}
