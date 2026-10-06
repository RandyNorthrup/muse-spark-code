import { useLayoutEffect, useRef, useState } from 'react'
import type { Account } from '../../../../shared/accounts'
import { modelsAccountsSliceSchema, type ModelsAccountsSlice } from '../../../../shared/modelsPanel'
import { accountsReplySchema, type AccountsRequest } from '../../../../shared/hostApi/accounts'
import { ACCOUNT_MAX_PER_PROVIDER, UI_TEXT } from '../../../../shared/constants'
import { fill, formatNumber } from '../../../../shared/l10n/text'
import { AccountEditor } from './AccountEditor'
import { ThresholdEditor } from './ThresholdEditor'
import { PolicyDetails } from './PolicyDetails'

export interface AccountsSectionPort {
  request(message: AccountsRequest): Promise<unknown>
  accept(slice: ModelsAccountsSlice): void
  openLink(url: string): void
}

/** Loaded by M95's Models & Agents surface; shared unchanged by editor bridges. */
export function AccountsSection({
  value,
  port,
}: {
  readonly value: unknown
  readonly port: AccountsSectionPort
}) {
  const [editor, setEditor] = useState<string | null>(null)
  const [removalId, setRemovalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setPending] = useState(false)
  const pending = useRef(false)
  const currentProvider = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const current = modelsAccountsSliceSchema.safeParse(value)
    currentProvider.current = current.success ? current.data.provider : undefined
    return () => {
      currentProvider.current = undefined
    }
  }, [value])
  const parsed = modelsAccountsSliceSchema.safeParse(value)
  if (!parsed.success) return <p role="alert">{UI_TEXT.accounts.invalidAccount}</p>
  const slice = parsed.data
  const policy = slice.policy
  const choiceLabels = {
    confirm: UI_TEXT.accounts.confirm,
    ownCapsOnly: UI_TEXT.accounts.ownCapsOnly,
    cancel: UI_TEXT.accounts.cancel,
  }
  const isMuseUnavailable = policy?.product === 'muse-code'
  const isUnavailable =
    policy === null ||
    policy.pooling === 'notOffered' ||
    !policy.isCredentialHeld ||
    isMuseUnavailable
  const execute = async (request: AccountsRequest) => {
    if (pending.current) return
    pending.current = true
    setPending(true)
    setError(null)
    try {
      const reply: unknown = await port.request(request)
      if (currentProvider.current !== slice.provider) return
      const next = modelsAccountsSliceSchema.safeParse(reply)
      if (!next.success || next.data.provider !== slice.provider) {
        const problem = accountsReplySchema.safeParse(reply)
        setError(
          problem.success &&
            problem.data.type === 'accounts/error' &&
            problem.data.code === 'invalidAccount'
            ? UI_TEXT.accounts.invalidAccount
            : UI_TEXT.actionFailed,
        )
        return
      }
      port.accept(next.data)
      setEditor(null)
      setRemovalId(null)
    } catch {
      setError(UI_TEXT.actionFailed)
    } finally {
      pending.current = false
      setPending(false)
    }
  }
  const send = (request: AccountsRequest) => {
    void execute(request)
  }
  const save = (account: Account, isNew: boolean) => {
    send({ type: isNew ? 'accounts/add' : 'accounts/update', provider: slice.provider, account })
  }
  const ordered = slice.accounts.toSorted((a, b) => a.order - b.order)
  const move = (index: number, offset: -1 | 1) => {
    const ids = ordered.map((row) => row.id)
    const other = index + offset
    const id = ids[index]
    const adjacent = ids[other]
    if (id === undefined || adjacent === undefined) return
    ids[index] = adjacent
    ids[other] = id
    send({ type: 'accounts/order', provider: slice.provider, accounts: ids })
  }
  return (
    <section key={slice.provider} className="accounts-section" aria-label={UI_TEXT.accounts.title}>
      <h2>
        {UI_TEXT.accounts.title} · {slice.providerLabel}
      </h2>
      <p>{UI_TEXT.accounts.credentialHelp}</p>
      <p>
        {UI_TEXT.accounts.swap}: {slice.isSwapOn ? UI_TEXT.toggleOn : UI_TEXT.toggleOff}.{' '}
        {UI_TEXT.accounts.swapDescription}
      </p>
      <p>
        {UI_TEXT.accounts.parallel}: {slice.isParallelOn ? UI_TEXT.toggleOn : UI_TEXT.toggleOff}.{' '}
        {UI_TEXT.accounts.parallelDescription}
      </p>
      {policy === null ? (
        <p role="status">{UI_TEXT.accounts.notOffered}</p>
      ) : (
        <>
          <h3>{UI_TEXT.accounts.policy}</h3>
          <PolicyDetails
            policy={policy}
            onOpenLink={(url) => {
              port.openLink(url)
            }}
          />
        </>
      )}
      {policy?.product === 'muse-code' ? (
        <p role="status">{UI_TEXT.accounts.museCodeUnavailable}</p>
      ) : null}
      {policy === null || slice.confirmation === null ? null : (
        <>
          <p>{choiceLabels[slice.confirmation]}</p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              send({ type: 'accounts/revoke', provider: slice.provider, product: policy.product })
            }}
          >
            {UI_TEXT.accounts.revoke}
          </button>
        </>
      )}
      <ol className="account-list">
        {ordered.map((account, index) => (
          <li key={account.id}>
            <h3>
              {account.label} ({account.id})
            </h3>
            <p>
              {UI_TEXT.accounts.order}: {formatNumber(index + 1)}
              {account.id === slice.currentAccount ? ` · ${UI_TEXT.accounts.current}` : ''}
            </p>
            {account.limitGroup === undefined ? null : (
              <>
                <p>
                  {UI_TEXT.accounts.limitGroup}: {account.limitGroup}
                </p>
                <p>{fill(UI_TEXT.accounts.sharedGroup, { account: account.label })}</p>
              </>
            )}
            <div className="account-actions">
              <button
                type="button"
                disabled={isPending || isUnavailable || account.id === slice.currentAccount}
                onClick={() => {
                  send({ type: 'accounts/use', provider: slice.provider, account: account.id })
                }}
              >
                {UI_TEXT.accounts.use}
              </button>
              <button
                type="button"
                disabled={isPending || isMuseUnavailable}
                onClick={() => {
                  setEditor(account.id)
                }}
              >
                {UI_TEXT.queuedEdit}
              </button>
              <button
                type="button"
                disabled={isPending || isMuseUnavailable || index === 0}
                onClick={() => {
                  move(index, -1)
                }}
              >
                {UI_TEXT.accounts.earlier}
              </button>
              <button
                type="button"
                disabled={isPending || isMuseUnavailable || index === ordered.length - 1}
                onClick={() => {
                  move(index, 1)
                }}
              >
                {UI_TEXT.accounts.later}
              </button>
              <button
                type="button"
                disabled={isPending || isMuseUnavailable}
                onClick={() => {
                  setRemovalId(account.id)
                }}
              >
                {UI_TEXT.accounts.remove}
              </button>
            </div>
            {removalId === account.id ? (
              <div>
                <p>{fill(UI_TEXT.accounts.removeConfirm, { account: account.label })}</p>
                <button
                  type="button"
                  disabled={isPending || isMuseUnavailable}
                  onClick={() => {
                    send({ type: 'accounts/remove', provider: slice.provider, account: account.id })
                  }}
                >
                  {UI_TEXT.accounts.confirm}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setRemovalId(null)
                  }}
                >
                  {UI_TEXT.accounts.cancel}
                </button>
              </div>
            ) : null}
            {editor === account.id ? (
              <>
                <AccountEditor
                  account={account}
                  isNew={false}
                  isPending={isPending || isMuseUnavailable}
                  onSave={(row) => {
                    save(row, false)
                  }}
                  onCancel={() => {
                    setEditor(null)
                  }}
                />
                <ThresholdEditor
                  value={account.thresholds}
                  capabilities={slice}
                  isPending={isPending || isMuseUnavailable}
                  onSave={(thresholds) => {
                    send({
                      type: 'accounts/thresholds',
                      provider: slice.provider,
                      account: account.id,
                      thresholds,
                    })
                  }}
                />
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {editor === '' ? (
        <AccountEditor
          account={{ id: '', label: '', order: (ordered.at(-1)?.order ?? -1) + 1, thresholds: {} }}
          isNew
          isPending={isPending || isMuseUnavailable}
          onSave={(row) => {
            save(row, true)
          }}
          onCancel={() => {
            setEditor(null)
          }}
        />
      ) : (
        <button
          type="button"
          disabled={isPending || isUnavailable || ordered.length >= ACCOUNT_MAX_PER_PROVIDER}
          onClick={() => {
            setEditor('')
          }}
        >
          {UI_TEXT.accounts.add}
        </button>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  )
}
