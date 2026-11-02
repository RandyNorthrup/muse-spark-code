// Muse Desktop (M111, D91.16) lane ST1: Sound. Outputs and inputs from
// PipeWire through sysd: volume drafts behind Apply, a mute switch and a
// default button that each ask first.

import { useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { AudioDevice, AudioDirection, SoundState } from '../../../shared/desktop/sysd'
import { fill, formatList, formatPercent } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { ConfirmChangeDialog } from './dialog'
import { SettingRow, SettingsEmpty, SettingsSection, SettingsSwitch } from './rows'
import { usePendingChange } from './usePendingChange'

export type SoundChange =
  | {
      readonly kind: 'volume'
      readonly id: string
      readonly direction: AudioDirection
      readonly volumePercent: number
    }
  | {
      readonly kind: 'muted'
      readonly id: string
      readonly direction: AudioDirection
      readonly muted: boolean
    }
  | { readonly kind: 'default'; readonly id: string; readonly direction: AudioDirection }

function DeviceCard({
  device,
  direction,
  onApply,
}: {
  readonly device: AudioDevice
  readonly direction: AudioDirection
  readonly onApply: (change: SoundChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const [volume, setVolume] = useState(device.volumePercent)
  const directionName = direction === 'output' ? text.soundOutputs : text.soundInputs
  return (
    <div className="muse-settings-device">
      <div className="muse-settings-device-head">
        <span className="muse-settings-device-name">{device.name}</span>
        {device.isDefault ? <span className="muse-settings-badge">{text.defaultBadge}</span> : null}
      </div>
      <SettingRow
        label={text.soundVolume}
        hint={formatPercent(volume)}
        control={
          <input
            className="muse-settings-slider"
            type="range"
            aria-label={formatList([device.name, text.soundVolume])}
            min={0}
            max={100}
            value={volume}
            onChange={(event) => {
              setVolume(Number(event.target.value))
            }}
          />
        }
      />
      <SettingRow
        label={text.soundMute}
        control={
          <SettingsSwitch
            label={formatList([device.name, text.soundMute])}
            checked={device.muted}
            onFlip={(isOn) => {
              pending.request(
                { kind: 'muted', id: device.id, direction, muted: isOn },
                fill(isOn ? text.soundConfirmMute : text.soundConfirmUnmute, {
                  name: device.name,
                }),
              )
            }}
          />
        }
      />
      <div className="muse-settings-device-actions">
        {device.isDefault ? null : (
          <button
            type="button"
            className="muse-settings-button muse-settings-button-secondary"
            onClick={() => {
              pending.request(
                { kind: 'default', id: device.id, direction },
                fill(text.soundConfirmDefault, { name: device.name, direction: directionName }),
              )
            }}
          >
            {text.useAsDefault}
          </button>
        )}
        <button
          type="button"
          className="muse-settings-button muse-settings-button-primary"
          onClick={() => {
            pending.request(
              { kind: 'volume', id: device.id, direction, volumePercent: volume },
              fill(text.soundConfirmVolume, {
                name: device.name,
                volume: formatPercent(volume),
              }),
            )
          }}
        >
          {text.apply}
        </button>
      </div>
      {pending.pending === null ? null : (
        <ConfirmChangeDialog
          title={text.confirmTitle}
          description={pending.pending.description}
          onConfirm={pending.confirm}
          onCancel={pending.cancel}
        />
      )}
    </div>
  )
}

function DeviceList({
  devices,
  direction,
  onApply,
}: {
  readonly devices: readonly AudioDevice[]
  readonly direction: AudioDirection
  readonly onApply: (change: SoundChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  if (devices.length === 0) {
    return <SettingsEmpty text={text.soundNoDevices} />
  }
  return (
    <>
      {devices.map((device) => (
        <DeviceCard key={device.id} device={device} direction={direction} onApply={onApply} />
      ))}
    </>
  )
}

export function SoundPage({
  data,
  onApply,
}: {
  readonly data: SoundState
  readonly onApply: (change: SoundChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.soundOutputs}>
        <DeviceList devices={data.outputs} direction="output" onApply={onApply} />
      </SettingsSection>
      <SettingsSection title={text.soundInputs}>
        <DeviceList devices={data.inputs} direction="input" onApply={onApply} />
      </SettingsSection>
    </div>
  )
}

export const soundPageBinding: PageBinding<SoundState, SoundChange> = {
  load: (client) => client.sysd.request('sound.get', {}),
  apply: async (client, change) => {
    if (change.kind === 'volume') {
      await client.sysd.request('sound.setVolume', {
        id: change.id,
        direction: change.direction,
        volumePercent: change.volumePercent,
      })
    } else if (change.kind === 'muted') {
      await client.sysd.request('sound.setMuted', {
        id: change.id,
        direction: change.direction,
        muted: change.muted,
      })
    } else {
      await client.sysd.request('sound.setDefault', {
        id: change.id,
        direction: change.direction,
      })
    }
    return await client.sysd.request('sound.get', {})
  },
  render: (data, onApply) => <SoundPage data={data} onApply={onApply} />,
}
