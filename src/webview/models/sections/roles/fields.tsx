import { useId, useState } from 'react'
import { usePropDraft } from './propDraft'
import { UI_TEXT } from '../../../../shared/constants'
import type { TeamModelSettings } from '../../../../shared/team'
import type { TeamSettingControl } from '../../../../shared/teamPanel'

export function NumberField({
  label,
  value,
  min = 0,
  max,
  step = 'any',
  onChange,
  onClear,
}: {
  readonly label: string
  readonly value: number | undefined
  readonly min?: number
  readonly max?: number | undefined
  readonly step?: number | 'any'
  readonly onChange: (value: number) => void
  readonly onClear?: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState({ value, text: value === undefined ? '' : String(value) })
  const [isFocused, setFocused] = useState(false)
  if (!isFocused && draft.value !== value)
    setDraft({ value, text: value === undefined ? '' : String(value) })
  return (
    <label className="team-editor-field" htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        required={value !== undefined}
        placeholder={value === undefined ? UI_TEXT.teamDefaultEntry : undefined}
        value={draft.text}
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
        }}
        onChange={(event) => {
          const next = event.target.value
          setDraft({ value, text: next })
          if (next === '') onClear?.()
          else if (Number.isFinite(Number(next))) onChange(Number(next))
        }}
      />
    </label>
  )
}
function SettingControl({
  control,
  current,
  onChange,
}: {
  readonly control: TeamSettingControl
  readonly current: boolean | string | number | undefined
  readonly onChange: (value: boolean | string | number | undefined) => void
}) {
  if (control.kind === 'boolean') {
    return (
      <label>
        <input
          type="checkbox"
          checked={current === true}
          onChange={(event) => {
            onChange(event.target.checked)
          }}
        />
        {control.label}
      </label>
    )
  }
  if (control.kind === 'choice') {
    return (
      <label>
        {control.label}
        <select
          value={typeof current === 'string' ? current : ''}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        >
          <option value="" disabled>
            {UI_TEXT.teamDefaultEntry}
          </option>
          {control.choices?.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <NumberField
      label={control.label}
      value={typeof current === 'number' ? current : undefined}
      min={control.min ?? 0}
      max={control.max}
      step={['thinkingBudget', 'outputCap', 'windowCap'].includes(control.key) ? 1 : 'any'}
      onChange={onChange}
      onClear={() => {
        onChange(undefined)
      }}
    />
  )
}
export function ModelSettings({
  controls,
  value,
  onChange,
}: {
  readonly controls: readonly TeamSettingControl[]
  readonly value: TeamModelSettings | undefined
  readonly onChange: (settings: TeamModelSettings) => void
}) {
  // Rapid consecutive edits build on the latest local draft, never on the
  // host props, which may predate an edit the host has not echoed yet.
  const [settings, updateSettings] = usePropDraft(value)
  if (controls.length === 0) return null
  return (
    <fieldset className="team-editor-card">
      <legend>{UI_TEXT.teamEditor.settings}</legend>
      {controls.map((control) => {
        const current = settings?.[control.key]
        const change = (next: boolean | string | number | undefined) => {
          const draft = updateSettings((previous) => {
            const merged = { ...previous }
            if (next === undefined) Reflect.deleteProperty(merged, control.key)
            else Object.assign(merged, { [control.key]: next })
            return merged
          })
          onChange(draft ?? {})
        }
        return (
          <div key={control.key} className="team-editor-field">
            {<SettingControl control={control} current={current} onChange={change} />}
            <p className="models-hint">{control.note}</p>
            {current === undefined ? <p>{UI_TEXT.teamDefaultEntry}</p> : null}
            <button
              type="button"
              className="models-button"
              aria-label={`${UI_TEXT.teamResetToDefault} (${control.key})`}
              disabled={current === undefined}
              onClick={() => {
                change(undefined)
              }}
            >
              {UI_TEXT.teamResetToDefault}
            </button>
          </div>
        )
      })}
    </fieldset>
  )
}

export function TextField({
  label,
  value,
  maxLength,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly maxLength?: number
  readonly onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState({ value, text: value })
  const [isFocused, setFocused] = useState(false)
  if (!isFocused && draft.value !== value) setDraft({ value, text: value })
  return (
    <label className="team-editor-field">
      {label}
      <textarea
        value={draft.text}
        maxLength={maxLength}
        onFocus={() => {
          setFocused(true)
        }}
        onBlur={() => {
          setFocused(false)
        }}
        onChange={(event) => {
          const text = event.target.value
          setDraft({ value, text })
          onChange(text)
        }}
      />
    </label>
  )
}
