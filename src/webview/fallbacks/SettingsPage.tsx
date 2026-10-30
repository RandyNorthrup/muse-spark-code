import { useId, useState } from 'react'
import type { HostServices, MhpParams } from '../../shared/hostApi/methods'
import { UI_TEXT } from '../../shared/l10n/text'
import { isCarrierFailure } from '../bridges/failure'

type SettingValue = string | number | boolean
export interface SettingEntry {
  readonly key: string
  readonly title: string
  readonly description: string
  readonly value: string | number | boolean
}

function SettingControl({
  entry,
  value,
  onChange,
}: {
  readonly entry: SettingEntry
  readonly value: SettingValue
  readonly onChange: (value: SettingValue) => void
}) {
  const id = useId()
  let inputType = 'text'
  if (typeof entry.value === 'boolean') inputType = 'checkbox'
  else if (typeof entry.value === 'number') inputType = 'number'
  return (
    <div className="fallback-setting">
      <label htmlFor={id}>{entry.title}</label>
      <input
        id={id}
        aria-describedby={`${id}-detail`}
        type={inputType}
        checked={typeof value === 'boolean' && value}
        value={
          typeof value === 'boolean' || (typeof value === 'number' && !Number.isFinite(value))
            ? ''
            : String(value)
        }
        onChange={(event) => {
          let changed: SettingValue = event.target.value
          if (typeof entry.value === 'boolean') changed = event.target.checked
          else if (typeof entry.value === 'number') changed = event.target.valueAsNumber
          onChange(changed)
        }}
      />
      <p id={`${id}-detail`}>{entry.description}</p>
    </div>
  )
}

/** Credentials have no SettingEntry: settings/update's host owns all gates. */
export function SettingsPage({
  entries,
  scope,
  services,
}: {
  readonly entries: readonly SettingEntry[]
  readonly scope: MhpParams<'settings/update'>['scope']
  readonly services: HostServices
}) {
  const [edits, setEdits] = useState<ReadonlyMap<string, SettingValue>>(new Map())
  const [isSaving, setSaving] = useState(false)
  const [saved, setSaved] = useState<ReadonlyMap<string, SettingValue>>(new Map())
  const [hasError, setError] = useState(false)
  async function save(): Promise<void> {
    setSaving(true)
    setError(false)
    try {
      for (const [key, value] of edits) {
        await services.request('settings/update', { key, value, scope })
        setSaved((previous) => new Map(previous).set(key, value))
        setEdits((previous) => {
          const next = new Map(previous)
          next.delete(key)
          return next
        })
      }
    } catch (error: unknown) {
      if (!isCarrierFailure(error)) throw error
      setError(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <main className="fallback-page">
      <h1>{UI_TEXT.fallbackSettings}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={isSaving}>
          <legend>{UI_TEXT.fallbackSettings}</legend>
          {entries.map((entry) => (
            <SettingControl
              key={entry.key}
              entry={entry}
              value={edits.get(entry.key) ?? saved.get(entry.key) ?? entry.value}
              onChange={(value) => {
                setEdits((previous) => new Map(previous).set(entry.key, value))
              }}
            />
          ))}
        </fieldset>
        {hasError && <p role="alert">{UI_TEXT.fallbackActionFailed}</p>}
        <button
          type="submit"
          disabled={
            isSaving ||
            edits.size === 0 ||
            [...edits].some(([, value]) => typeof value === 'number' && !Number.isFinite(value))
          }
        >
          {UI_TEXT.goalEditSave}
        </button>
      </form>
    </main>
  )
}
