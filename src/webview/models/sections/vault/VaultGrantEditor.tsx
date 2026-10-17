import { useState } from 'react'
import { UI_TEXT } from '../../../../shared/constants'
import {
  type VaultItemMetadata,
  vaultGrantSchema,
  vaultBindingSchema,
  type VaultGrant,
} from '../../../../shared/vault'
import { VaultDetails } from './vaultPresentation'

export interface VaultGrantEditorProps {
  readonly items: readonly VaultItemMetadata[]
  readonly onSave: (grant: VaultGrant) => void
  readonly onClose: () => void
  readonly now: () => number
  readonly newId: () => string
}
const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
const integerOrNull = (value: FormDataEntryValue | null) =>
  value === '' || value === null ? null : Number(value)

/** All scope fields are explicit. Targets start from an item's existing validated binding. */
export function VaultGrantEditor({ items, onSave, onClose, now, newId }: VaultGrantEditorProps) {
  const [itemId, setItemId] = useState(items[0]?.id ?? '')
  const [error, setError] = useState(false)
  const item = items.find((entry) => entry.id === itemId)
  const [bindingIndex, setBindingIndex] = useState(0)
  function submit(form: HTMLFormElement): void {
    const data = new FormData(form)
    const field = (key: string): string => {
      const value = data.get(key)
      return typeof value === 'string' ? value : ''
    }
    const roles =
      data.get('roles') === 'any'
        ? 'any'
        : lines(field('roles')).map((line) => {
            const [kind, ...name] = line.split(':')
            return name.length === 0 ? { kind } : { kind, name: name.join(':') }
          })
    const target = vaultBindingSchema.safeParse(item?.bindings[bindingIndex])
    const parsed = vaultGrantSchema.safeParse({
      id: newId(),
      itemId,
      roles,
      workspaces: data.get('workspaces') === 'any' ? 'any' : lines(field('workspaces')),
      target: target.success ? target.data : undefined,
      maxUses: integerOrNull(data.get('maxUses')),
      uses: 0,
      expiresAt: data.get('expiresAt') === '' ? null : new Date(field('expiresAt')).getTime(),
      window:
        data.get('days') === ''
          ? null
          : {
              days: lines(field('days')).map(Number),
              startHour: Number(data.get('startHour')),
              endHour: Number(data.get('endHour')),
            },
      unattendedAllowed: data.get('unattendedAllowed') === 'on',
      sessionId: field('sessionId') === '' ? null : field('sessionId'),
      taskId: field('taskId') === '' ? null : field('taskId'),
      ceiling:
        data.get('ceiling') === 'none' || data.get('ceiling') === 'ask'
          ? data.get('ceiling')
          : lines(field('ceiling')),
      createdAt: now(),
      createdBy: 'vaultPanel',
    })
    if (!parsed.success) {
      setError(true)
      return
    }
    setError(false)
    onSave(parsed.data)
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit(event.currentTarget)
      }}
    >
      <h3>{UI_TEXT.vault.grant}</h3>
      <p>{UI_TEXT.vault.grantHelp}</p>
      <label>
        {UI_TEXT.vault.item}
        <select
          value={itemId}
          onChange={(event) => {
            setItemId(event.target.value)
            setBindingIndex(0)
          }}
        >
          {items.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} ({entry.handle})
            </option>
          ))}
        </select>
      </label>
      <label>
        {UI_TEXT.vault.target}
        <select
          value={bindingIndex}
          onChange={(event) => {
            setBindingIndex(Number(event.target.value))
          }}
        >
          {item?.bindings.map((binding, index) => (
            <option key={JSON.stringify(binding)} value={index}>
              {binding.kind}
            </option>
          ))}
        </select>
      </label>
      {item?.bindings[bindingIndex] !== undefined && (
        <VaultDetails value={item.bindings[bindingIndex]} />
      )}
      <label>
        {UI_TEXT.vault.roles} (any / orchestrator / subagent / headless / role:name / hook:name /
        mcp:name)
        <textarea name="roles" required defaultValue="orchestrator" />
      </label>
      <label>
        {UI_TEXT.vault.workspaces} (any)
        <textarea name="workspaces" required />
      </label>
      <label>
        {UI_TEXT.vault.useCount}
        <input
          name="maxUses"
          type="number"
          min={1}
          step={1}
          placeholder={UI_TEXT.vault.unlimited}
        />
      </label>
      <label>
        {UI_TEXT.vault.expires}
        <input name="expiresAt" type="datetime-local" />
      </label>
      <fieldset>
        <legend>
          {UI_TEXT.vault.timeWindow} ({UI_TEXT.vault.localTime})
        </legend>
        <label>
          {UI_TEXT.vault.days} (0–6)
          <textarea name="days" />
        </label>
        <label>
          {UI_TEXT.vault.hours} (startHour)
          <input name="startHour" type="number" min={0} step={1} defaultValue={0} />
        </label>
        <label>
          {UI_TEXT.vault.hours} (endHour)
          <input name="endHour" type="number" min={1} step={1} />
        </label>
      </fieldset>
      <label>
        <input name="unattendedAllowed" type="checkbox" disabled={item?.requirePresence} />
        {UI_TEXT.vault.unattended}
      </label>
      <label>
        {UI_TEXT.vault.sessionScope}
        <input name="sessionId" />
      </label>
      <label>
        {UI_TEXT.vault.taskScope}
        <input name="taskId" />
      </label>
      <label>
        {UI_TEXT.vault.ceiling} (none / ask / secret://)
        <textarea name="ceiling" defaultValue="ask" required />
      </label>
      {error && <p role="alert">{UI_TEXT.vault.invalidFields}</p>}
      <div className="vault-actions">
        <button type="submit">{UI_TEXT.vault.grant}</button>
        <button type="button" onClick={onClose}>
          {UI_TEXT.goalEditCancel}
        </button>
      </div>
    </form>
  )
}
