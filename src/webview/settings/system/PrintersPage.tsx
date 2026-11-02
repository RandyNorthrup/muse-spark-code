// Muse Desktop (M111, D91.16) lane ST1: Printers. CUPS through sysd
// (driverless IPP; no cups-browsed, D73): the default button, removal
// and adding by address, each asking first.

import { useState, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { Printer, PrinterStatus, PrintersState } from '../../../shared/desktop/sysd'
import { fill } from '../../../shared/l10n/text'
import type { PageBinding } from './binding'
import { PendingChangeDialog } from './dialog'
import { SettingsEmpty, SettingsSection } from './rows'
import { usePendingChange } from './usePendingChange'

export type PrintersChange =
  | { readonly kind: 'default'; readonly id: string }
  | { readonly kind: 'add'; readonly uri: string }
  | { readonly kind: 'remove'; readonly id: string }

function statusName(status: PrinterStatus): string {
  const text = UI_TEXT.settingsSystem
  switch (status) {
    case 'idle': {
      return text.printersIdle
    }
    case 'printing': {
      return text.printersPrinting
    }
    case 'offline': {
      return text.printersOffline
    }
    case 'error': {
      return text.printersError
    }
  }
}

function PrinterRow({
  printer,
  onApply,
}: {
  readonly printer: Printer
  readonly onApply: (change: PrintersChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  return (
    <div className="muse-settings-device">
      <div className="muse-settings-device-head">
        <span className="muse-settings-device-name">{printer.name}</span>
        {printer.isDefault ? (
          <span className="muse-settings-badge">{text.defaultBadge}</span>
        ) : null}
        <span className="muse-settings-device-sub">{statusName(printer.status)}</span>
      </div>
      <div className="muse-settings-device-actions">
        {printer.isDefault ? null : (
          <button
            type="button"
            className="muse-settings-button muse-settings-button-secondary"
            onClick={() => {
              pending.request(
                { kind: 'default', id: printer.id },
                fill(text.printersConfirmDefault, { name: printer.name }),
              )
            }}
          >
            {text.useAsDefault}
          </button>
        )}
        <button
          type="button"
          className="muse-settings-button muse-settings-button-secondary"
          onClick={() => {
            pending.request(
              { kind: 'remove', id: printer.id },
              fill(text.printersConfirmRemove, { name: printer.name }),
            )
          }}
        >
          {text.printersRemove}
        </button>
      </div>
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export function PrintersPage({
  data,
  onApply,
}: {
  readonly data: PrintersState
  readonly onApply: (change: PrintersChange) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  const pending = usePendingChange(onApply)
  const [uri, setUri] = useState('')
  return (
    <div className="muse-settings-page">
      <SettingsSection title={text.printersList}>
        {data.printers.length === 0 ? (
          <SettingsEmpty text={text.printersNoPrinters} />
        ) : (
          data.printers.map((printer) => (
            <PrinterRow key={printer.id} printer={printer} onApply={onApply} />
          ))
        )}
        <div className="muse-settings-device">
          <label className="muse-settings-dialog-field">
            {text.printersUri}
            <input
              className="muse-settings-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={uri}
              onChange={(event) => {
                setUri(event.target.value)
              }}
            />
          </label>
          <div className="muse-settings-device-actions">
            <button
              type="button"
              className="muse-settings-button muse-settings-button-primary"
              disabled={uri.trim() === ''}
              onClick={() => {
                const trimmed = uri.trim()
                if (trimmed === '') {
                  return
                }
                pending.request(
                  { kind: 'add', uri: trimmed },
                  fill(text.printersConfirmAdd, { uri: trimmed }),
                )
              }}
            >
              {text.printersAdd}
            </button>
          </div>
        </div>
      </SettingsSection>
      <PendingChangeDialog title={text.confirmTitle} handle={pending} />
    </div>
  )
}

export const printersPageBinding: PageBinding<PrintersState, PrintersChange> = {
  load: (client) => client.sysd.request('printers.get', {}),
  apply: async (client, change) => {
    if (change.kind === 'default') {
      await client.sysd.request('printers.setDefault', { id: change.id })
    } else if (change.kind === 'add') {
      await client.sysd.request('printers.add', { uri: change.uri })
    } else {
      await client.sysd.request('printers.remove', { id: change.id })
    }
    return await client.sysd.request('printers.get', {})
  },
  render: (data, onApply) => <PrintersPage data={data} onApply={onApply} />,
}
