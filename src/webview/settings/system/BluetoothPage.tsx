// Muse Desktop (M111, D91.16) lane ST1: Bluetooth. Pairing is two steps
// through BlueZ and sysd: Pair asks sysd to start and shows its passkey
// for the person to check (threat model D55); confirming or closing the
// passkey dialog answers the pairing. Nothing pairs unseen.

import { useCallback, useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { SettingsSystemClient } from '../../../shared/desktop/settings'
import type {
  BluetoothDevice,
  BluetoothDeviceKind,
  BluetoothState,
} from '../../../shared/desktop/sysd'
import { fill, formatPercent } from '../../../shared/l10n/text'
import { ConfirmChangeDialog, SettingsDialog } from './dialog'
import { PageFrame, runPageApply } from './frame'
import { SettingRow, SettingsEmpty, SettingsSection, SettingsSwitch } from './rows'
import { usePendingChange } from './usePendingChange'

export type BluetoothChange =
  | { readonly kind: 'enabled'; readonly enabled: boolean }
  | { readonly kind: 'answerPair'; readonly id: string; readonly accept: boolean }
  | { readonly kind: 'connected'; readonly id: string; readonly connected: boolean }
  | { readonly kind: 'remove'; readonly id: string }

function kindName(kind: BluetoothDeviceKind): string {
  const text = UI_TEXT.settingsSystem
  switch (kind) {
    case 'audio': {
      return text.bluetoothKindAudio
    }
    case 'input': {
      return text.bluetoothKindInput
    }
    case 'phone': {
      return text.bluetoothKindPhone
    }
    case 'computer': {
      return text.bluetoothKindComputer
    }
    case 'other': {
      return text.bluetoothKindOther
    }
  }
}

function DeviceRow({
  device,
  startPairing,
  onApply,
}: {
  readonly device: BluetoothDevice
  readonly startPairing: (id: string) => Promise<string | null>
  readonly onApply: (change: BluetoothChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const desktop = UI_TEXT.desktop
  const pending = usePendingChange(onApply)
  const [passkey, setPasskey] = useState<string | null>(null)
  const pair = async (): Promise<void> => {
    const started = await startPairing(device.id)
    if (started !== null) {
      setPasskey(started)
    }
  }
  return (
    <div className="muse-settings-device">
      <div className="muse-settings-device-head">
        <span className="muse-settings-device-name">{device.name}</span>
        <span className="muse-settings-device-sub">{kindName(device.kind)}</span>
        {device.connected ? (
          <span className="muse-settings-badge">{text.networkConnected}</span>
        ) : null}
        {device.batteryPercent === undefined ? null : (
          <span className="muse-settings-device-sub">{formatPercent(device.batteryPercent)}</span>
        )}
      </div>
      <div className="muse-settings-device-actions">
        {device.paired ? (
          <>
            <button
              type="button"
              className="muse-settings-button muse-settings-button-secondary"
              onClick={() => {
                const isNext = !device.connected
                pending.request(
                  { kind: 'connected', id: device.id, connected: isNext },
                  fill(isNext ? text.bluetoothConfirmConnect : text.bluetoothConfirmDisconnect, {
                    name: device.name,
                  }),
                )
              }}
            >
              {device.connected ? text.bluetoothDisconnect : desktop.connect}
            </button>
            <button
              type="button"
              className="muse-settings-button muse-settings-button-secondary"
              onClick={() => {
                pending.request(
                  { kind: 'remove', id: device.id },
                  fill(text.bluetoothConfirmRemove, { name: device.name }),
                )
              }}
            >
              {text.bluetoothRemove}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="muse-settings-button muse-settings-button-secondary"
            onClick={() => {
              void pair()
            }}
          >
            {text.bluetoothPair}
          </button>
        )}
      </div>
      {passkey === null ? null : (
        <SettingsDialog
          title={desktop.bluetoothPairing}
          onCancel={() => {
            setPasskey(null)
            onApply({ kind: 'answerPair', id: device.id, accept: false })
          }}
        >
          <h2 className="muse-settings-dialog-title">{desktop.bluetoothPairing}</h2>
          <p className="muse-settings-dialog-passkey">{passkey}</p>
          <p id="muse-settings-dialog-body" className="muse-settings-dialog-body">
            {fill(text.bluetoothPasskeyNote, { name: device.name })}
          </p>
          <div className="muse-settings-dialog-actions">
            <button
              type="button"
              className="muse-settings-button muse-settings-button-secondary"
              onClick={() => {
                setPasskey(null)
                onApply({ kind: 'answerPair', id: device.id, accept: false })
              }}
            >
              {desktop.cancel}
            </button>
            <button
              type="button"
              className="muse-settings-button muse-settings-button-primary"
              onClick={() => {
                setPasskey(null)
                onApply({ kind: 'answerPair', id: device.id, accept: true })
              }}
            >
              {text.confirmApply}
            </button>
          </div>
        </SettingsDialog>
      )}
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

export function BluetoothPage({
  data,
  startPairing,
  onApply,
}: {
  readonly data: BluetoothState
  readonly startPairing: (id: string) => Promise<string | null>
  readonly onApply: (change: BluetoothChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.bluetoothDevices}>
        <SettingRow
          label={text.navBluetooth}
          control={
            <SettingsSwitch
              label={text.navBluetooth}
              checked={data.enabled}
              onFlip={(isOn) => {
                pending.request(
                  { kind: 'enabled', enabled: isOn },
                  isOn ? text.bluetoothConfirmOn : text.bluetoothConfirmOff,
                )
              }}
            />
          }
        />
        {!data.enabled || data.devices.length === 0 ? (
          <SettingsEmpty text={text.bluetoothNoDevices} />
        ) : (
          data.devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              startPairing={startPairing}
              onApply={onApply}
            />
          ))
        )}
      </SettingsSection>
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

export async function applyBluetoothChange(
  client: SettingsSystemClient,
  change: BluetoothChange,
): Promise<BluetoothState> {
  switch (change.kind) {
    case 'enabled': {
      await client.sysd.request('bluetooth.setEnabled', { enabled: change.enabled })
      break
    }
    case 'answerPair': {
      await client.sysd.request('bluetooth.confirmPair', { id: change.id, accept: change.accept })
      break
    }
    case 'connected': {
      await client.sysd.request('bluetooth.setConnected', {
        id: change.id,
        connected: change.connected,
      })
      break
    }
    case 'remove': {
      await client.sysd.request('bluetooth.remove', { id: change.id })
      break
    }
  }
  return await client.sysd.request('bluetooth.get', {})
}

export function BluetoothPageLoader({
  client,
}: {
  readonly client: SettingsSystemClient
}): ReactNode {
  const load = useCallback(() => client.sysd.request('bluetooth.get', {}), [client])
  return (
    <PageFrame load={load}>
      {(data, report) => (
        <BluetoothPage
          data={data}
          startPairing={async (id) => {
            try {
              const started = await client.sysd.request('bluetooth.startPair', { id })
              return started.passkey
            } catch (error) {
              report.onError(error)
              return null
            }
          }}
          onApply={(change) => {
            void runPageApply(report, () => applyBluetoothChange(client, change))
          }}
        />
      )}
    </PageFrame>
  )
}
