// Muse Desktop (M111, D91.16) lane ST1: Power and sleep. Batteries, the
// power mode, the idle timers and the lid and power-button actions, from
// UPower, power-profiles-daemon and logind through sysd. The mode and the
// two selects ask at once; the timers share an Apply. A zero timer means
// never; every other value the person sets is honoured as set.

import { useState, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../../shared/constants'
import {
  lidCloseActionSchema,
  powerButtonActionSchema,
  type Battery,
  type BatteryState,
  type LidCloseAction,
  type PowerButtonAction,
  type PowerProfile,
  type PowerState,
} from '../../../shared/desktop/sysd'
import { fill, formatList, formatPercent, formatUnit, plural } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { parseDraftInt } from './numbers'
import { PendingChangeDialog } from './dialog'
import { SettingRow, SettingsEmpty, SettingsSection } from './rows'
import { usePendingChange } from './usePendingChange'

export type PowerChange =
  | { readonly kind: 'profile'; readonly profile: PowerProfile }
  | { readonly kind: 'timeouts'; readonly displayOffMinutes: number; readonly sleepMinutes: number }
  | {
      readonly kind: 'actions'
      readonly onLidClose: LidCloseAction
      readonly onPowerButton: PowerButtonAction
    }

const MINUTES_PER_HOUR = 60

function batteryStateName(state: BatteryState): string {
  const text = UI_TEXT.settingsSystem
  switch (state) {
    case 'charging': {
      return text.powerBatteryCharging
    }
    case 'discharging': {
      return text.powerBatteryDischarging
    }
    case 'full': {
      return text.powerBatteryFull
    }
    case 'empty': {
      return text.powerBatteryEmpty
    }
    case 'unknown': {
      return text.powerBatteryUnknown
    }
  }
}

function timeLeft(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) {
    return formatUnit(minutes, 'minute')
  }
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  const rest = minutes % MINUTES_PER_HOUR
  return rest === 0
    ? formatUnit(hours, 'hour')
    : formatList([formatUnit(hours, 'hour'), formatUnit(rest, 'minute')])
}

function timeoutName(minutes: number): string {
  const text = UI_TEXT.settingsSystem
  return minutes === 0
    ? text.powerTimeoutNever
    : plural(text.powerTimeoutMinutes, minutes, { count: minutes })
}

function BatteryRow({ battery }: { readonly battery: Battery }): ReactNode {
  const text = UI_TEXT.settingsSystem
  return (
    <SettingRow
      label={formatPercent(battery.percent)}
      hint={batteryStateName(battery.state)}
      control={
        battery.minutesLeft === undefined ? null : (
          <span className="muse-settings-device-sub">
            {text.powerTimeLeft}: {timeLeft(battery.minutesLeft)}
          </span>
        )
      }
    />
  )
}

function profileName(profile: PowerProfile): string {
  const text = UI_TEXT.settingsSystem
  switch (profile) {
    case 'power-saver': {
      return text.powerProfileSaver
    }
    case 'balanced': {
      return text.powerProfileBalanced
    }
    case 'performance': {
      return text.powerProfilePerformance
    }
  }
}

export function PowerPage({
  data,
  onApply,
}: {
  readonly data: PowerState
  readonly onApply: (change: PowerChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const [displayOff, setDisplayOff] = useState(String(data.displayOffMinutes))
  const [sleep, setSleep] = useState(String(data.sleepMinutes))
  const displayOffMinutes = parseDraftInt(displayOff)
  const sleepMinutes = parseDraftInt(sleep)
  const isTimersValid =
    displayOffMinutes !== undefined &&
    displayOffMinutes >= 0 &&
    sleepMinutes !== undefined &&
    sleepMinutes >= 0
  const lidName: Record<LidCloseAction, string> = {
    sleep: text.powerActionSleep,
    lock: text.powerLidLock,
    nothing: text.powerLidNothing,
  }
  const buttonName: Record<PowerButtonAction, string> = {
    prompt: text.powerButtonPrompt,
    sleep: text.powerActionSleep,
    shutdown: text.powerButtonShutdown,
  }
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.powerBattery}>
        {data.batteries.length === 0 ? (
          <SettingsEmpty text={text.powerNoBattery} />
        ) : (
          data.batteries.map((battery, index) => <BatteryRow key={index} battery={battery} />)
        )}
      </SettingsSection>
      <SettingsSection title={text.powerProfile}>
        <div className="muse-settings-radio-list" role="radiogroup" aria-label={text.powerProfile}>
          {(['power-saver', 'balanced', 'performance'] as const).map((profile) => (
            <label key={profile} className="muse-settings-radio">
              <input
                type="radio"
                name="muse-settings-power-profile"
                value={profile}
                checked={data.profile === profile}
                onChange={() => {
                  pending.request(
                    { kind: 'profile', profile },
                    fill(text.powerConfirmProfile, { profile: profileName(profile) }),
                  )
                }}
              />
              {profileName(profile)}
            </label>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title={text.powerTimersTitle}>
        <SettingRow
          label={text.powerDisplayOff}
          hint={
            displayOffMinutes === undefined
              ? undefined
              : timeoutName(Math.max(displayOffMinutes, 0))
          }
          control={
            <input
              className="muse-settings-input"
              type="number"
              aria-label={text.powerDisplayOff}
              value={displayOff}
              min={0}
              onChange={(event) => {
                setDisplayOff(event.target.value)
              }}
            />
          }
        />
        <SettingRow
          label={text.powerSleep}
          hint={sleepMinutes === undefined ? undefined : timeoutName(Math.max(sleepMinutes, 0))}
          control={
            <input
              className="muse-settings-input"
              type="number"
              aria-label={text.powerSleep}
              value={sleep}
              min={0}
              onChange={(event) => {
                setSleep(event.target.value)
              }}
            />
          }
        />
        <div className="muse-settings-device-actions">
          <button
            type="button"
            className="muse-settings-button muse-settings-button-primary"
            disabled={!isTimersValid}
            onClick={() => {
              if (!isTimersValid) {
                return
              }
              pending.request(
                { kind: 'timeouts', displayOffMinutes, sleepMinutes },
                text.powerConfirmTimeouts,
              )
            }}
          >
            {text.apply}
          </button>
        </div>
      </SettingsSection>
      <SettingsSection title={text.powerLidTitle}>
        <SettingRow
          label={text.powerLid}
          control={
            <select
              className="muse-settings-select"
              aria-label={text.powerLid}
              value={data.onLidClose}
              onChange={(event) => {
                const onLidClose = z.parse(lidCloseActionSchema, event.target.value)
                pending.request(
                  { kind: 'actions', onLidClose, onPowerButton: data.onPowerButton },
                  text.powerConfirmActions,
                )
              }}
            >
              {(['sleep', 'lock', 'nothing'] as const).map((action) => (
                <option key={action} value={action}>
                  {lidName[action]}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          label={text.powerButton}
          control={
            <select
              className="muse-settings-select"
              aria-label={text.powerButton}
              value={data.onPowerButton}
              onChange={(event) => {
                const onPowerButton = z.parse(powerButtonActionSchema, event.target.value)
                pending.request(
                  { kind: 'actions', onLidClose: data.onLidClose, onPowerButton },
                  text.powerConfirmActions,
                )
              }}
            >
              {(['prompt', 'sleep', 'shutdown'] as const).map((action) => (
                <option key={action} value={action}>
                  {buttonName[action]}
                </option>
              ))}
            </select>
          }
        />
      </SettingsSection>
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export const powerPageBinding: PageBinding<PowerState, PowerChange> = {
  load: (client) => client.sysd.request('power.get', {}),
  apply: async (client, change) => {
    if (change.kind === 'profile') {
      await client.sysd.request('power.setProfile', { profile: change.profile })
    } else if (change.kind === 'timeouts') {
      await client.sysd.request('power.setTimeouts', {
        displayOffMinutes: change.displayOffMinutes,
        sleepMinutes: change.sleepMinutes,
      })
    } else {
      await client.sysd.request('power.setActions', {
        onLidClose: change.onLidClose,
        onPowerButton: change.onPowerButton,
      })
    }
    return await client.sysd.request('power.get', {})
  },
  render: (data, onApply) => <PowerPage data={data} onApply={onApply} />,
}
