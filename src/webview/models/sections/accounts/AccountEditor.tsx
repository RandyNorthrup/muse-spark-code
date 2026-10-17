import { type SubmitEvent, useId, useState } from 'react'
import { accountSchema, type Account } from '../../../../shared/accounts'
import { ACCOUNT_LABEL_MAX_LENGTH, UI_TEXT } from '../../../../shared/constants'

export function AccountEditor({
  account,
  isNew,
  isPending,
  onSave,
  onCancel,
}: {
  readonly account: Account
  readonly isNew: boolean
  readonly isPending: boolean
  readonly onSave: (account: Account) => void
  readonly onCancel: () => void
}) {
  const id = useId()
  const [hasError, setError] = useState(false)
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const field = (name: string) => {
      const value = data.get(name)
      return typeof value === 'string' ? value.trim() : ''
    }
    const group = field('group')
    const parsed = accountSchema.safeParse({
      ...account,
      id: isNew ? field('id') : account.id,
      label: field('label'),
      limitGroup: group === '' ? undefined : group,
    })
    if (!parsed.success) {
      setError(true)
      return
    }
    setError(false)
    onSave(parsed.data)
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={isPending}>
        <legend>{isNew ? UI_TEXT.accounts.add : UI_TEXT.queuedEdit}</legend>
        <label htmlFor={`${id}-id`}>{UI_TEXT.accounts.id}</label>
        <input id={`${id}-id`} name="id" required disabled={!isNew} defaultValue={account.id} />
        <label htmlFor={`${id}-label`}>{UI_TEXT.accounts.label}</label>
        <input
          id={`${id}-label`}
          name="label"
          required
          maxLength={ACCOUNT_LABEL_MAX_LENGTH}
          defaultValue={account.label}
        />
        <label htmlFor={`${id}-group`}>{UI_TEXT.accounts.limitGroup}</label>
        <input id={`${id}-group`} name="group" defaultValue={account.limitGroup ?? ''} />
        <button type="submit">{UI_TEXT.goalEditSave}</button>
        <button type="button" onClick={onCancel}>
          {UI_TEXT.accounts.cancel}
        </button>
      </fieldset>
      {hasError ? <p role="alert">{UI_TEXT.accounts.invalidAccount}</p> : null}
    </form>
  )
}
