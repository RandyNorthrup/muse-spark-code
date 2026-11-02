// Muse Desktop (M111, D91.16) lane ST1: Storage. Volumes from udisks2
// through sysd with their real sizes; ejecting a removable volume asks
// first. Media mounts nosuid,nodev,noexec and never auto-runs (D73).

import type { ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { StorageState, StorageVolume } from '../../../shared/desktop/sysd'
import { fill, formatBytes } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { ConfirmChangeDialog } from './dialog'
import { SettingsEmpty, SettingsSection } from './rows'
import { usePendingChange } from './usePendingChange'

export interface StorageChange {
  readonly kind: 'eject'
  readonly id: string
}

function VolumeRow({
  volume,
  onApply,
}: {
  readonly volume: StorageVolume
  readonly onApply: (change: StorageChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  return (
    <div className="muse-settings-device">
      <div className="muse-settings-device-head">
        <span className="muse-settings-device-name">{volume.name}</span>
        {volume.removable ? (
          <span className="muse-settings-badge">{text.storageRemovable}</span>
        ) : null}
      </div>
      <span className="muse-settings-device-sub">
        {fill(text.storageUsedOf, {
          used: formatBytes(volume.usedBytes),
          total: formatBytes(volume.sizeBytes),
        })}
      </span>
      <progress
        className="muse-settings-meter"
        value={volume.usedBytes}
        max={Math.max(volume.sizeBytes, 1)}
        aria-label={volume.name}
      />
      {volume.ejectable ? (
        <div className="muse-settings-device-actions">
          <button
            type="button"
            className="muse-settings-button muse-settings-button-secondary"
            onClick={() => {
              pending.request(
                { kind: 'eject', id: volume.id },
                fill(text.storageConfirmEject, { name: volume.name }),
              )
            }}
          >
            {text.storageEject}
          </button>
        </div>
      ) : null}
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

export function StoragePage({
  data,
  onApply,
}: {
  readonly data: StorageState
  readonly onApply: (change: StorageChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.storageVolumes}>
        {data.volumes.length === 0 ? (
          <SettingsEmpty text={text.storageNoVolumes} />
        ) : (
          data.volumes.map((volume) => (
            <VolumeRow key={volume.id} volume={volume} onApply={onApply} />
          ))
        )}
      </SettingsSection>
    </div>
  )
}

export const storagePageBinding: PageBinding<StorageState, StorageChange> = {
  load: (client) => client.sysd.request('storage.get', {}),
  apply: async (client, change) => {
    await client.sysd.request('storage.eject', { id: change.id })
    return await client.sysd.request('storage.get', {})
  },
  render: (data, onApply) => <StoragePage data={data} onApply={onApply} />,
}
