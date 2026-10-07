// M95 loads this with models.js and injects its nodes into App's slots.
// A single-account chat never loads the accounts UI.
import { useId } from 'react'
import { modelsAccountsSliceSchema } from '../../shared/modelsPanel'
import { UI_TEXT } from '../../shared/constants'
import type { AccountsRequest } from '../../shared/hostApi/accounts'

export function AccountChip({
  value,
  isPending,
  onUse,
}: {
  readonly value: unknown
  readonly isPending: boolean
  readonly onUse: (request: Extract<AccountsRequest, { type: 'accounts/use' }>) => void
}) {
  const id = useId()
  const parsed = modelsAccountsSliceSchema.safeParse(value)
  if (!parsed.success) return <span role="alert">{UI_TEXT.accounts.invalidAccount}</span>
  const slice = parsed.data
  if (slice.accounts.length <= 1) return null
  const current = slice.accounts.find((row) => row.id === slice.currentAccount)
  return (
    <div className="account-chip">
      <label htmlFor={id}>
        {UI_TEXT.accounts.current}: {slice.providerLabel} ·{' '}
        {current?.label ?? UI_TEXT.accounts.none}
      </label>
      <select
        id={id}
        className="account-picker"
        value={slice.currentAccount ?? ''}
        disabled={
          isPending ||
          slice.policy === null ||
          !slice.policy.isCredentialHeld ||
          slice.policy.pooling === 'notOffered' ||
          slice.policy.product === 'muse-code'
        }
        onChange={(event) => {
          onUse({ type: 'accounts/use', provider: slice.provider, account: event.target.value })
        }}
      >
        {slice.currentAccount === null ? (
          <option value="" disabled>
            {UI_TEXT.accounts.none}
          </option>
        ) : null}
        {slice.accounts
          .toSorted((a, b) => a.order - b.order)
          .map((row) => (
            <option key={row.id} value={row.id}>
              {slice.providerLabel} · {row.label}
            </option>
          ))}
      </select>
    </div>
  )
}
