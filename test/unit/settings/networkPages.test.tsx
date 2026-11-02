// Muse Desktop (M111, D91.16) lane ST1: Network, Bluetooth and Cellular
// prove their confirmation gate. Joining a network, answering a pairing
// and every switch carry the exact change only after the person confirms.

/** @vitest-environment jsdom */
/** @vitest-environment-options {"pretendToBeVisual": true} */
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  confirmSettingsDialog,
  renderSettingsPage,
  trackSettingsRenders,
} from '../helpers/settingsPages'
import { UI_TEXT } from '../../../src/shared/constants'
import type { BluetoothState, CellularState, NetworkState } from '../../../src/shared/desktop/sysd'
import { fill } from '../../../src/shared/l10n/text'
import {
  BluetoothPage,
  type BluetoothChange,
} from '../../../src/webview/settings/system/BluetoothPage'
import {
  CellularPage,
  type CellularChange,
} from '../../../src/webview/settings/system/CellularPage'
import { NetworkPage, type NetworkChange } from '../../../src/webview/settings/system/NetworkPage'

trackSettingsRenders()

function cancelDialog(): void {
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: UI_TEXT.desktop.cancel,
    }),
  )
}

function dialogConnect(): void {
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: UI_TEXT.desktop.connect,
    }),
  )
}

const NETWORK: NetworkState = {
  wifiEnabled: true,
  wired: { connected: false },
  wifi: [
    { ssid: 'home', signalPercent: 80, secured: true, connected: true, autoconnect: true },
    { ssid: 'cafe', signalPercent: 40, secured: false, connected: false, autoconnect: false },
  ],
  vpn: [{ id: 'vpn-1', name: 'Office', state: 'disconnected' }],
}

function renderNetwork(applied: NetworkChange[]): void {
  renderSettingsPage(
    <NetworkPage
      data={NETWORK}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
}

describe('Network page', () => {
  it('asks before turning Wi-Fi off', () => {
    const applied: NetworkChange[] = []
    renderNetwork(applied)
    fireEvent.click(screen.getByRole('switch', { name: UI_TEXT.settingsSystem.networkWifi }))
    expect(applied).toEqual([])
    expect(screen.getByText(UI_TEXT.settingsSystem.networkConfirmWifiOff)).toBeDefined()
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'wifiEnabled', enabled: false }])
  })

  it('joins an open network through its own dialog', () => {
    const applied: NetworkChange[] = []
    renderNetwork(applied)
    const connects = screen.getAllByRole('button', { name: UI_TEXT.desktop.connect })
    fireEvent.click(connects[0]!)
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.networkConnectTo, { ssid: 'cafe' })),
    ).toBeDefined()
    dialogConnect()
    expect(applied).toEqual([{ kind: 'connect', ssid: 'cafe', autoconnect: false }])
  })

  it('carries the Wi-Fi password only on Connect', () => {
    const offline: NetworkState = {
      ...NETWORK,
      wifi: [
        {
          ssid: 'locked',
          signalPercent: 60,
          secured: true,
          connected: false,
          autoconnect: true,
        },
      ],
    }
    const applied: NetworkChange[] = []
    renderSettingsPage(
      <NetworkPage
        data={offline}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    const connects = screen.getAllByRole('button', { name: UI_TEXT.desktop.connect })
    fireEvent.click(connects[0]!)
    fireEvent.change(screen.getByLabelText(UI_TEXT.desktop.wifiPassword), {
      target: { value: 's3cret' },
    })
    cancelDialog()
    expect(applied).toEqual([])
    fireEvent.click(connects[0]!)
    fireEvent.change(screen.getByLabelText(UI_TEXT.desktop.wifiPassword), {
      target: { value: 's3cret' },
    })
    dialogConnect()
    expect(applied).toEqual([
      { kind: 'connect', ssid: 'locked', password: 's3cret', autoconnect: true },
    ])
  })

  it('asks before forgetting the connected network', () => {
    const applied: NetworkChange[] = []
    renderNetwork(applied)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.networkForget }))
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'forget', ssid: 'home' }])
  })

  it('asks before connecting the VPN', () => {
    const applied: NetworkChange[] = []
    renderNetwork(applied)
    const buttons = screen.getAllByRole('button', { name: UI_TEXT.desktop.connect })
    fireEvent.click(buttons.at(-1)!)
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.networkConfirmVpnOn, { name: 'Office' })),
    ).toBeDefined()
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'vpn', id: 'vpn-1', connected: true }])
  })
})

const BLUETOOTH: BluetoothState = {
  enabled: true,
  devices: [
    {
      id: 'dev-1',
      name: 'Headphones',
      kind: 'audio',
      paired: true,
      connected: true,
      batteryPercent: 60,
    },
    { id: 'dev-2', name: 'Keyboard', kind: 'input', paired: false, connected: false },
  ],
}

function renderBluetooth(applied: BluetoothChange[], passkey: string | null): string[] {
  const started: string[] = []
  renderSettingsPage(
    <BluetoothPage
      data={BLUETOOTH}
      startPairing={(id) => {
        started.push(id)
        return Promise.resolve(passkey)
      }}
      onApply={(change) => {
        applied.push(change)
      }}
    />,
  )
  return started
}

describe('Bluetooth page', () => {
  it('shows the passkey for the person to check before pairing', async () => {
    const applied: BluetoothChange[] = []
    const started = renderBluetooth(applied, '482916')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.bluetoothPair }))
    expect(await screen.findByText('482916')).toBeDefined()
    expect(started).toEqual(['dev-2'])
    expect(
      screen.getByText(fill(UI_TEXT.settingsSystem.bluetoothPasskeyNote, { name: 'Keyboard' })),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.confirmApply }))
    expect(applied).toEqual([{ kind: 'answerPair', id: 'dev-2', accept: true }])
  })

  it('answers a dismissed pairing as declined', async () => {
    const applied: BluetoothChange[] = []
    renderBluetooth(applied, '482916')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.bluetoothPair }))
    expect(await screen.findByText('482916')).toBeDefined()
    cancelDialog()
    expect(applied).toEqual([{ kind: 'answerPair', id: 'dev-2', accept: false }])
  })

  it('asks before removing a device', () => {
    const applied: BluetoothChange[] = []
    renderBluetooth(applied, null)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.bluetoothRemove }))
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'remove', id: 'dev-1' }])
  })
})

const CELLULAR: CellularState = {
  present: true,
  enabled: true,
  connected: false,
  operator: 'Example Mobile',
  technology: '5G',
  signalPercent: 75,
}

describe('Cellular page', () => {
  it('asks before disconnecting mobile data', () => {
    const applied: CellularChange[] = []
    renderSettingsPage(
      <CellularPage
        data={{ ...CELLULAR, connected: true }}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.settingsSystem.networkDisconnect }))
    confirmSettingsDialog()
    expect(applied).toEqual([{ kind: 'connected', connected: false }])
  })

  it('says so when the machine has no modem', () => {
    const applied: CellularChange[] = []
    renderSettingsPage(
      <CellularPage
        data={{ present: false, enabled: false, connected: false }}
        onApply={(change) => {
          applied.push(change)
        }}
      />,
    )
    expect(screen.getByText(UI_TEXT.settingsSystem.cellularNoModem)).toBeDefined()
    expect(applied).toEqual([])
  })
})
