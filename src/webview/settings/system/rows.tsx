// Muse Desktop (M111, D91.16) lane ST1: the system pages' shared rows.
// Sections group a page; rows pair a label (and its hint) with one
// control; the switch is a labelled button with the on/off word beside it.

import type { ReactNode } from 'react'
import { UI_TEXT } from '../../../shared/constants'

export function SettingsSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <section className="muse-settings-section" aria-label={title}>
      <h2 className="muse-settings-section-title">{title}</h2>
      {children}
    </section>
  )
}

export function SettingRow({
  label,
  hint,
  control,
}: {
  readonly label: string
  readonly hint?: string | undefined
  readonly control: ReactNode
}): ReactNode {
  return (
    <div className="muse-settings-row">
      <div className="muse-settings-row-label">
        <span className="muse-settings-row-name">{label}</span>
        {hint === undefined ? null : <span className="muse-settings-row-hint">{hint}</span>}
      </div>
      <div className="muse-settings-row-control">{control}</div>
    </div>
  )
}

export function SettingsSwitch({
  label,
  checked,
  onFlip,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onFlip: (isOn: boolean) => void
}): ReactNode {
  const text = UI_TEXT.settingsSystem
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="muse-settings-switch"
      data-on={checked}
      onClick={() => {
        onFlip(!checked)
      }}
    >
      <span className="muse-settings-switch-track" aria-hidden="true">
        <span className="muse-settings-switch-thumb" aria-hidden="true" />
      </span>
      <span className="muse-settings-switch-word">{checked ? text.on : text.off}</span>
    </button>
  )
}

export function SettingsEmpty({ text }: { readonly text: string }): ReactNode {
  return <p className="muse-settings-empty">{text}</p>
}
