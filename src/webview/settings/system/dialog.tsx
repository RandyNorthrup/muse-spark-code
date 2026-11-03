// Muse Desktop (M111, D91.16) lane ST1: the settings dialog shell and the
// confirmation dialog. Escape cancels through the settings.dialog surface;
// the first focusable control takes focus when the dialog opens.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { webviewKey } from '../../../shared/keybindings'
import type { PendingChangeHandle } from './usePendingChange'

export function SettingsDialog({
  title,
  children,
  onCancel,
  labelledBy,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly onCancel: () => void
  readonly labelledBy?: string
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('button, input, select, [tabindex]')
    first?.focus()
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (webviewKey('settings.dialog', event) !== 'close') {
      return
    }

    event.stopPropagation()
    onCancel()
  }
  return (
    <div className="muse-settings-scrim" onClick={onCancel}>
      <div
        className="muse-settings-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={labelledBy === undefined ? title : undefined}
        aria-labelledby={labelledBy}
        aria-describedby="muse-settings-dialog-body"
        ref={dialogRef}
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

export function ConfirmChangeDialog({
  title,
  description,
  onConfirm,
  onCancel,
}: {
  readonly title: string
  readonly description: string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): ReactNode {
  return (
    <SettingsDialog title={title} onCancel={onCancel}>
      <h2 className="muse-settings-dialog-title">{title}</h2>
      <p id="muse-settings-dialog-body" className="muse-settings-dialog-body">
        {description}
      </p>
      <div className="muse-settings-dialog-actions">
        <button
          type="button"
          className="muse-settings-button muse-settings-button-secondary"
          onClick={onCancel}
        >
          {UI_TEXT.desktop.cancel}
        </button>
        <button
          type="button"
          className="muse-settings-button muse-settings-button-primary"
          onClick={onConfirm}
        >
          {UI_TEXT.settingsSystem.confirmApply}
        </button>
      </div>
    </SettingsDialog>
  )
}

export function PendingChangeDialog<Change>({
  title,
  handle,
}: {
  readonly title: string
  readonly handle: PendingChangeHandle<Change>
}): ReactNode {
  if (handle.pending === null) {
    return null
  }
  return (
    <ConfirmChangeDialog
      title={title}
      description={handle.pending.description}
      onConfirm={handle.confirm}
      onCancel={handle.cancel}
    />
  )
}
