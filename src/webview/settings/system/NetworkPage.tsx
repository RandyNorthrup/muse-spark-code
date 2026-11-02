// Muse Desktop (M111, D91.16) lane ST1: Network. Wi-Fi, wired and VPN
// through NetworkManager and sysd. The Wi-Fi switch, disconnect, forget
// and VPN buttons each ask first; joining a network is its own dialog
// whose Connect button is the confirmation. Passwords are never logged
// and travel only to sysd's secret agent.

import { useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { NetworkState, WifiNetwork } from '../../../shared/desktop/sysd'
import { fill, formatPercent } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { PendingChangeDialog, SettingsDialog } from './dialog'
import { SettingRow, SettingsEmpty, SettingsSection, SettingsSwitch } from './rows'
import { usePendingChange } from './usePendingChange'

export type NetworkChange =
  | { readonly kind: 'wifiEnabled'; readonly enabled: boolean }
  | {
      readonly kind: 'connect'
      readonly ssid: string
      readonly password?: string
      readonly autoconnect: boolean
    }
  | { readonly kind: 'disconnect' }
  | { readonly kind: 'forget'; readonly ssid: string }
  | { readonly kind: 'vpn'; readonly id: string; readonly connected: boolean }

function ConnectDialog({
  network,
  onApply,
  onCancel,
}: {
  readonly network: WifiNetwork
  readonly onApply: (change: NetworkChange) => void
  readonly onCancel: () => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const desktop = UI_TEXT.desktop
  const [password, setPassword] = useState('')
  const [autoconnect, setAutoconnect] = useState(network.autoconnect)
  const title = fill(text.networkConnectTo, { ssid: network.ssid })
  return (
    <SettingsDialog title={title} onCancel={onCancel}>
      <h2 className="muse-settings-dialog-title">{title}</h2>
      {network.secured ? (
        <label className="muse-settings-dialog-field">
          {desktop.wifiPassword}
          <input
            className="muse-settings-input"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
          />
        </label>
      ) : null}
      <label className="muse-settings-check">
        <input
          type="checkbox"
          checked={autoconnect}
          onChange={(event) => {
            setAutoconnect(event.target.checked)
          }}
        />
        {desktop.connectAutomatically}
      </label>
      <div className="muse-settings-dialog-actions">
        <button
          type="button"
          className="muse-settings-button muse-settings-button-secondary"
          onClick={onCancel}
        >
          {desktop.cancel}
        </button>
        <button
          type="button"
          className="muse-settings-button muse-settings-button-primary"
          onClick={() => {
            onApply({
              kind: 'connect',
              ssid: network.ssid,
              ...(password !== '' && { password }),
              autoconnect,
            })
          }}
        >
          {desktop.connect}
        </button>
      </div>
    </SettingsDialog>
  )
}

function NetworkRow({
  network,
  onApply,
}: {
  readonly network: WifiNetwork
  readonly onApply: (change: NetworkChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const desktop = UI_TEXT.desktop
  const pending = usePendingChange(onApply)
  const [joining, setJoining] = useState(false)
  return (
    <div className="muse-settings-device">
      <div className="muse-settings-device-head">
        <span className="muse-settings-device-name">{network.ssid}</span>
        {network.connected ? (
          <span className="muse-settings-badge">{text.networkConnected}</span>
        ) : null}
        {network.secured ? (
          <span className="muse-settings-device-sub">{text.networkSecured}</span>
        ) : null}
        <span className="muse-settings-device-sub">{formatPercent(network.signalPercent)}</span>
      </div>
      <div className="muse-settings-device-actions">
        {network.connected ? (
          <>
            <button
              type="button"
              className="muse-settings-button muse-settings-button-secondary"
              onClick={() => {
                pending.request(
                  { kind: 'disconnect' },
                  fill(text.networkConfirmDisconnect, { ssid: network.ssid }),
                )
              }}
            >
              {text.networkDisconnect}
            </button>
            <button
              type="button"
              className="muse-settings-button muse-settings-button-secondary"
              onClick={() => {
                pending.request(
                  { kind: 'forget', ssid: network.ssid },
                  fill(text.networkConfirmForget, { ssid: network.ssid }),
                )
              }}
            >
              {text.networkForget}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="muse-settings-button muse-settings-button-secondary"
            onClick={() => {
              setJoining(true)
            }}
          >
            {desktop.connect}
          </button>
        )}
      </div>
      {joining ? (
        <ConnectDialog
          network={network}
          onApply={(change) => {
            setJoining(false)
            onApply(change)
          }}
          onCancel={() => {
            setJoining(false)
          }}
        />
      ) : null}
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export function NetworkPage({
  data,
  onApply,
}: {
  readonly data: NetworkState
  readonly onApply: (change: NetworkChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const desktop = UI_TEXT.desktop
  const pending = usePendingChange(onApply)
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.networkWifi}>
        <SettingRow
          label={text.networkWifi}
          control={
            <SettingsSwitch
              label={text.networkWifi}
              checked={data.wifiEnabled}
              onFlip={(isOn) => {
                pending.request(
                  { kind: 'wifiEnabled', enabled: isOn },
                  isOn ? text.networkConfirmWifiOn : text.networkConfirmWifiOff,
                )
              }}
            />
          }
        />
        {data.wifiEnabled ? (
          data.wifi.length === 0 ? (
            <SettingsEmpty text={text.networkNoNetworks} />
          ) : (
            data.wifi.map((network) => (
              <NetworkRow key={network.ssid} network={network} onApply={onApply} />
            ))
          )
        ) : null}
      </SettingsSection>
      <SettingsSection title={text.networkWired}>
        {data.wired.connected ? (
          <SettingRow
            label={data.wired.name ?? text.networkWired}
            control={<span className="muse-settings-badge">{text.networkConnected}</span>}
          />
        ) : (
          <SettingsEmpty text={text.disconnected} />
        )}
      </SettingsSection>
      <SettingsSection title={text.networkVpn}>
        {data.vpn.length === 0 ? (
          <SettingsEmpty text={text.networkNoVpn} />
        ) : (
          data.vpn.map((vpn) => (
            <div className="muse-settings-device" key={vpn.id}>
              <div className="muse-settings-device-head">
                <span className="muse-settings-device-name">{vpn.name}</span>
                {vpn.state === 'connected' ? (
                  <span className="muse-settings-badge">{text.networkConnected}</span>
                ) : null}
              </div>
              <div className="muse-settings-device-actions">
                <button
                  type="button"
                  className="muse-settings-button muse-settings-button-secondary"
                  onClick={() => {
                    const isNext = vpn.state !== 'connected'
                    pending.request(
                      { kind: 'vpn', id: vpn.id, connected: isNext },
                      fill(isNext ? text.networkConfirmVpnOn : text.networkConfirmVpnOff, {
                        name: vpn.name,
                      }),
                    )
                  }}
                >
                  {vpn.state === 'connected' ? text.networkDisconnect : desktop.connect}
                </button>
              </div>
            </div>
          ))
        )}
      </SettingsSection>
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export const networkPageBinding: PageBinding<NetworkState, NetworkChange> = {
  load: (client) => client.sysd.request('network.get', {}),
  apply: async (client, change) => {
    switch (change.kind) {
      case 'wifiEnabled': {
        await client.sysd.request('network.setWifiEnabled', { enabled: change.enabled })
        break
      }
      case 'connect': {
        await client.sysd.request('network.connectWifi', {
          ssid: change.ssid,
          password: change.password,
          autoconnect: change.autoconnect,
        })
        break
      }
      case 'disconnect': {
        await client.sysd.request('network.disconnectWifi', {})
        break
      }
      case 'forget': {
        await client.sysd.request('network.forgetWifi', { ssid: change.ssid })
        break
      }
      case 'vpn': {
        await client.sysd.request('network.setVpn', { id: change.id, connected: change.connected })
        break
      }
    }
    return await client.sysd.request('network.get', {})
  },
  render: (data, onApply) => <NetworkPage data={data} onApply={onApply} />,
}
