// Muse Desktop (M111, D91.16) lane ST1: Cellular. The modem's status
// from ModemManager through sysd; the mobile-data switch and the
// connect button each ask first. Machines without a modem say so.

import type { ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { CellularState } from '../../../shared/desktop/sysd'
import { formatPercent } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { ConfirmChangeDialog } from './dialog'
import { SettingRow, SettingsEmpty, SettingsSection, SettingsSwitch } from './rows'
import { usePendingChange } from './usePendingChange'

export type CellularChange =
  | { readonly kind: 'enabled'; readonly enabled: boolean }
  | { readonly kind: 'connected'; readonly connected: boolean }

export function CellularPage({
  data,
  onApply,
}: {
  readonly data: CellularState
  readonly onApply: (change: CellularChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  if (!data.present) {
    return (
      <div className="muse-settings-page">
        <SettingsSection title={text.cellularStatus}>
          <SettingsEmpty text={text.cellularNoModem} />
        </SettingsSection>
      </div>
    )
  }
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.cellularStatus}>
        <SettingRow
          label={text.cellularMobileData}
          control={
            <SettingsSwitch
              label={text.cellularMobileData}
              checked={data.enabled}
              onFlip={(isOn) => {
                pending.request(
                  { kind: 'enabled', enabled: isOn },
                  isOn ? text.cellularConfirmOn : text.cellularConfirmOff,
                )
              }}
            />
          }
        />
        {data.enabled ? (
          <>
            <SettingRow
              label={text.cellularStatus}
              control={
                data.connected ? (
                  <span className="muse-settings-badge">{text.networkConnected}</span>
                ) : (
                  <span className="muse-settings-device-sub">{text.disconnected}</span>
                )
              }
            />
            {data.operator === undefined ? null : (
              <SettingRow
                label={text.cellularOperator}
                control={<span className="muse-settings-device-sub">{data.operator}</span>}
              />
            )}
            {data.technology === undefined ? null : (
              <SettingRow
                label={text.cellularTechnology}
                control={<span className="muse-settings-device-sub">{data.technology}</span>}
              />
            )}
            {data.signalPercent === undefined ? null : (
              <SettingRow
                label={text.cellularSignal}
                control={
                  <span className="muse-settings-device-sub">
                    {formatPercent(data.signalPercent)}
                  </span>
                }
              />
            )}
            <div className="muse-settings-device-actions">
              <button
                type="button"
                className="muse-settings-button muse-settings-button-secondary"
                onClick={() => {
                  const isNext = !data.connected
                  pending.request(
                    { kind: 'connected', connected: isNext },
                    isNext ? text.cellularConfirmConnect : text.cellularConfirmDisconnect,
                  )
                }}
              >
                {data.connected ? text.networkDisconnect : UI_TEXT.desktop.connect}
              </button>
            </div>
          </>
        ) : null}
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

export const cellularPageBinding: PageBinding<CellularState, CellularChange> = {
  load: (client) => client.sysd.request('cellular.get', {}),
  apply: async (client, change) => {
    if (change.kind === 'enabled') {
      await client.sysd.request('cellular.setEnabled', { enabled: change.enabled })
    } else {
      await client.sysd.request('cellular.setConnected', { connected: change.connected })
    }
    return await client.sysd.request('cellular.get', {})
  },
  render: (data, onApply) => <CellularPage data={data} onApply={onApply} />,
}
