// Muse Desktop (M111, D91.16) lane ST1: Displays. Each connected output
// gets a card: an enable switch and a main-display button that each ask
// first, plus mode, scale and brightness drafts behind one Apply.

import { useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type {
  DisplayMode,
  DisplayOutput,
  DisplaysSetOutput,
  DisplaysState,
} from '../../../shared/desktop/sysd'
import { fill, formatList, formatNumber, formatPercent } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { parseDraftInt } from './numbers'
import { PendingChangeDialog } from './dialog'
import { SettingRow, SettingsEmpty, SettingsSection, SettingsSwitch } from './rows'
import { usePendingChange } from './usePendingChange'

export type DisplaysChange =
  | { readonly kind: 'enabled'; readonly id: string; readonly enabled: boolean }
  | { readonly kind: 'primary'; readonly id: string }
  | {
      readonly kind: 'output'
      readonly value: DisplaysSetOutput
      readonly brightnessPercent?: number
    }

const MILLIHZ_PER_HZ = 1000

function modeLabel(mode: DisplayMode): string {
  const text = UI_TEXT.settingsSystem
  return formatList([
    fill(text.displaysResolutionValue, { width: mode.widthPx, height: mode.heightPx }),
    fill(text.displaysRefreshHz, { rate: formatNumber(mode.refreshMilliHz / MILLIHZ_PER_HZ) }),
  ])
}

function modeKey(mode: DisplayMode): string {
  return [mode.widthPx, mode.heightPx, mode.refreshMilliHz].join('x')
}

function OutputCard({
  output,
  onApply,
}: {
  readonly output: DisplayOutput
  readonly onApply: (change: DisplaysChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const confirmDescription = fill(text.displaysConfirm, { name: output.name })
  const current: DisplayMode = {
    widthPx: output.widthPx,
    heightPx: output.heightPx,
    refreshMilliHz: output.refreshMilliHz,
  }
  const isCurrentListed = output.modes.some((mode) => modeKey(mode) === modeKey(current))
  const [modeDraft, setModeDraft] = useState(modeKey(current))
  const [scale, setScale] = useState(String(output.scalePercent))
  const [brightness, setBrightness] = useState(output.brightnessPercent ?? 100)
  const scalePercent = parseDraftInt(scale)
  const mode = output.modes.find((entry) => modeKey(entry) === modeDraft)
  const isDraftsValid =
    !output.enabled || (mode !== undefined && scalePercent !== undefined && scalePercent > 0)

  return (
    <div className="muse-settings-device">
      <div className="muse-settings-device-head">
        <span className="muse-settings-device-name">{output.name}</span>
        {output.primary ? (
          <span className="muse-settings-badge">{text.displaysPrimary}</span>
        ) : null}
      </div>
      <SettingRow
        label={text.displaysEnabled}
        control={
          <SettingsSwitch
            label={text.displaysEnabled}
            checked={output.enabled}
            onFlip={(isOn) => {
              pending.request({ kind: 'enabled', id: output.id, enabled: isOn }, confirmDescription)
            }}
          />
        }
      />
      {output.enabled ? (
        <>
          <SettingRow
            label={text.displaysResolution}
            control={
              <select
                className="muse-settings-select"
                aria-label={text.displaysResolution}
                value={modeDraft}
                onChange={(event) => {
                  setModeDraft(event.target.value)
                }}
              >
                {isCurrentListed ? null : (
                  <option value={modeKey(current)}>{modeLabel(current)}</option>
                )}
                {output.modes.map((entry, index) => (
                  <option key={[modeKey(entry), index].join('-')} value={modeKey(entry)}>
                    {modeLabel(entry)}
                  </option>
                ))}
              </select>
            }
          />
          <SettingRow
            label={text.displaysRefresh}
            hint={fill(text.displaysRefreshHz, {
              rate: formatNumber(output.refreshMilliHz / MILLIHZ_PER_HZ),
            })}
            control={null}
          />
          <SettingRow
            label={text.displaysScale}
            hint={formatPercent(output.scalePercent)}
            control={
              <input
                className="muse-settings-input"
                type="number"
                aria-label={text.displaysScale}
                value={scale}
                min={1}
                onChange={(event) => {
                  setScale(event.target.value)
                }}
              />
            }
          />
          {output.brightnessPercent === undefined ? null : (
            <SettingRow
              label={text.displaysBrightness}
              hint={formatPercent(brightness)}
              control={
                <input
                  className="muse-settings-slider"
                  type="range"
                  aria-label={text.displaysBrightness}
                  min={0}
                  max={100}
                  value={brightness}
                  onChange={(event) => {
                    setBrightness(Number(event.target.value))
                  }}
                />
              }
            />
          )}
          <div className="muse-settings-device-actions">
            {output.primary ? null : (
              <button
                type="button"
                className="muse-settings-button muse-settings-button-secondary"
                onClick={() => {
                  pending.request({ kind: 'primary', id: output.id }, confirmDescription)
                }}
              >
                {text.displaysPrimary}
              </button>
            )}
            <button
              type="button"
              className="muse-settings-button muse-settings-button-primary"
              disabled={!isDraftsValid}
              onClick={() => {
                if (mode === undefined || scalePercent === undefined || scalePercent <= 0) {
                  return
                }
                pending.request(
                  {
                    kind: 'output',
                    value: {
                      id: output.id,
                      widthPx: mode.widthPx,
                      heightPx: mode.heightPx,
                      refreshMilliHz: mode.refreshMilliHz,
                      scalePercent,
                    },
                    ...(output.brightnessPercent !== undefined && {
                      brightnessPercent: brightness,
                    }),
                  },
                  confirmDescription,
                )
              }}
            >
              {text.apply}
            </button>
          </div>
        </>
      ) : null}
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export function DisplaysPage({
  data,
  onApply,
}: {
  readonly data: DisplaysState
  readonly onApply: (change: DisplaysChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const outputs = data.outputs.filter((output) => output.connected)
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.displaysOutputs}>
        {outputs.length === 0 ? (
          <SettingsEmpty text={text.displaysNoOutputs} />
        ) : (
          outputs.map((output) => <OutputCard key={output.id} output={output} onApply={onApply} />)
        )}
      </SettingsSection>
    </div>
  )
}

export const displaysPageBinding: PageBinding<DisplaysState, DisplaysChange> = {
  load: (client) => client.sysd.request('displays.get', {}),
  apply: async (client, change) => {
    if (change.kind === 'enabled') {
      await client.sysd.request('displays.setOutput', {
        id: change.id,
        enabled: change.enabled,
      })
    } else if (change.kind === 'primary') {
      await client.sysd.request('displays.setOutput', { id: change.id, primary: true })
    } else {
      await client.sysd.request('displays.setOutput', change.value)
      if (change.brightnessPercent !== undefined) {
        await client.sysd.request('displays.setBrightness', {
          id: change.value.id,
          brightnessPercent: change.brightnessPercent,
        })
      }
    }
    return await client.sysd.request('displays.get', {})
  },
  render: (data, onApply) => <DisplaysPage data={data} onApply={onApply} />,
}
