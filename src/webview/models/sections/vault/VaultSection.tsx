import { useState } from 'react'
import { type vaultClientMessageSchema } from '../../../../shared/hostApi/vaultMessages'
import { type VaultPanelState } from '../../../../shared/modelsPanel'
import { UI_TEXT } from '../../../../shared/constants'
import { plural, formatDateTime, formatNumber } from '../../../../shared/l10n/text'
import { type VaultStatus } from '../../../../shared/vaultProtocol'
import { VaultDetails, vaultUseLabel } from './vaultPresentation'
import { VaultGrantEditor } from './VaultGrantEditor'
import './vault.css'

export type VaultPanelPost = (message: ReturnType<typeof vaultClientMessageSchema.parse>) => void
const nowDefault = () => Date.now()
const newIdDefault = () => crypto.randomUUID().replaceAll('-', '')
export interface VaultSectionProps {
  readonly state: VaultPanelState
  readonly post: VaultPanelPost
  readonly now?: () => number
  readonly newId?: () => string
}

export function tierWarning(status: VaultStatus): string {
  if (status.reason === 'brokerBlocked' || status.state === 'firstPartyOnly')
    return UI_TEXT.vault.brokerBlocked
  if (status.reason === 'rollback') return UI_TEXT.vault.rollback
  if (status.reason === 'basicText') return UI_TEXT.vault.basicText
  if (status.reason === 'auditInvalid') return UI_TEXT.vault.auditInvalid
  if (status.reason === 'slotUnavailable') return UI_TEXT.vault.slotUnavailable
  // A null tier means no slot has been observed (a locked vault), not OS-store protection.
  if (status.tier === null) return UI_TEXT.vault.unknownTierWarning
  if (status.tier === 'passphrase') return UI_TEXT.vault.passphraseWarning
  if (status.tier === 'recovery') return UI_TEXT.vault.recoveryWarning
  if (status.tier === 'presence') return UI_TEXT.vault.presenceTierWarning
  return status.tier === 'hardware' ? UI_TEXT.vault.hardwareWarning : UI_TEXT.vault.osStoreWarning
}

/** M95 mounts this lazy section; M104/companion render exactly the same value-free controls. */
export function VaultSection({
  state,
  post,
  now = nowDefault,
  newId = newIdDefault,
}: VaultSectionProps) {
  const [editingGrant, setEditingGrant] = useState(false)
  const [itemFilter, setItemFilter] = useState('')
  const [requesterFilter, setRequesterFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const isUnlocked = state.status.state === 'unlocked'
  const audit = state.audit.filter(
    (row) =>
      (itemFilter === '' || row.handle === itemFilter) &&
      (requesterFilter === '' || row.requester.id === requesterFilter) &&
      (kindFilter === '' || row.kind === kindFilter) &&
      (outcomeFilter === '' || row.outcome === outcomeFilter),
  )
  return (
    <section className="vault-section" aria-label={UI_TEXT.vault.title}>
      <h2>
        {UI_TEXT.vault.title} — {isUnlocked ? UI_TEXT.vault.unlocked : UI_TEXT.vault.locked}
      </h2>
      <div className="vault-tier" role="status">
        <p>{tierWarning(state.status)}</p>
        <VaultDetails
          value={{
            tier: state.status.tier,
            provider: state.status.provider,
            silentUnlock: state.status.silentUnlock,
          }}
        />
      </div>
      {(state.notices ?? []).map((notice) => (
        <p key={notice} role="status">
          {UI_TEXT.vault[notice]}
        </p>
      ))}
      <div className="vault-actions">
        <button
          type="button"
          onClick={() => {
            post({ type: isUnlocked ? 'vaultLock' : 'vaultUnlock' })
          }}
        >
          {isUnlocked ? UI_TEXT.vault.lock : UI_TEXT.vault.unlock}
        </button>
        <button
          type="button"
          disabled={!isUnlocked}
          onClick={() => {
            post({ type: 'vaultAdd' })
          }}
        >
          {UI_TEXT.vault.add}
        </button>
        <button
          type="button"
          disabled={!isUnlocked}
          onClick={() => {
            setEditingGrant(!editingGrant)
          }}
        >
          {UI_TEXT.vault.grant}
        </button>
      </div>
      <p>{UI_TEXT.vault.labelWarning}</p>
      <p>{UI_TEXT.vault.passwordEntry}</p>
      <p>{UI_TEXT.vault.presenceAdvice}</p>
      <p>{plural(UI_TEXT.vault.itemsCount, state.items.length)}</p>
      {state.items.length === 0 && <p>{UI_TEXT.vault.empty}</p>}
      {state.items.map((item) => (
        <details key={item.id}>
          <summary>
            {item.label} ({item.handle})
          </summary>
          <VaultDetails value={item} />
          <p>
            {UI_TEXT.vault.lastUsed}:{' '}
            {item.dates.lastUsedAt === null
              ? UI_TEXT.vault.never
              : formatDateTime(item.dates.lastUsedAt)}
          </p>
          <div className="vault-actions">
            <button
              type="button"
              disabled={!isUnlocked}
              onClick={() => {
                post({ type: 'vaultEdit', itemId: item.id })
              }}
            >
              {UI_TEXT.vault.edit}
            </button>
            <button
              type="button"
              disabled={!isUnlocked}
              onClick={() => {
                post({ type: 'vaultRemove', itemId: item.id })
              }}
            >
              {UI_TEXT.vault.remove}
            </button>
            {item.kind === 'sshKey' && item.publicKey !== null && (
              <button
                type="button"
                disabled={!isUnlocked}
                onClick={() => {
                  post({ type: 'vaultPublicKey', itemId: item.id })
                }}
              >
                {UI_TEXT.vault.publicKey}
              </button>
            )}
          </div>
        </details>
      ))}
      {editingGrant && isUnlocked && (
        <VaultGrantEditor
          items={state.items.filter((item) => !item.hidden && !item.firstParty)}
          now={now}
          newId={newId}
          onClose={() => {
            setEditingGrant(false)
          }}
          onSave={(grant) => {
            post({ type: 'vaultGrant', grant })
            setEditingGrant(false)
          }}
        />
      )}
      <h3>{plural(UI_TEXT.vault.grantsCount, state.grants.length)}</h3>
      {state.grants.map((grant) => (
        <details key={grant.id}>
          <summary>
            {state.items.find((item) => item.id === grant.itemId)?.label ?? grant.itemId} (
            {grant.id})
          </summary>
          <VaultDetails value={grant} />
          <button
            type="button"
            disabled={!isUnlocked}
            onClick={() => {
              post({ type: 'vaultRevoke', grantId: grant.id })
            }}
          >
            {UI_TEXT.vault.revoke}
          </button>
        </details>
      ))}
      <h3>{UI_TEXT.vault.audit}</h3>
      {[
        {
          label: UI_TEXT.vault.item,
          values: state.audit.map((row) => row.handle),
          value: itemFilter,
          set: setItemFilter,
        },
        {
          label: UI_TEXT.vault.requester,
          values: state.audit.map((row) => row.requester.id),
          value: requesterFilter,
          set: setRequesterFilter,
        },
        {
          label: UI_TEXT.vault.kind,
          values: state.audit.map((row) => row.kind),
          value: kindFilter,
          set: setKindFilter,
        },
        {
          label: UI_TEXT.vault.outcome,
          values: state.audit.map((row) => row.outcome),
          value: outcomeFilter,
          set: setOutcomeFilter,
        },
      ].map((filter) => (
        <label key={filter.label}>
          {filter.label}
          <select
            value={filter.value}
            onChange={(event) => {
              filter.set(event.target.value)
            }}
          >
            <option value="">{UI_TEXT.vault.any}</option>
            {[...new Set(filter.values)].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ))}
      {audit.map((row) => (
        <details key={row.id}>
          <summary>
            {formatDateTime(row.time)} — {row.handle} — {vaultUseLabel(row.kind)} — {row.outcome}
          </summary>
          <VaultDetails value={row} />
        </details>
      ))}
      <p>{UI_TEXT.vault.ambientWarning}</p>
      {state.ambientFiles.map((file) => (
        <p key={file.path}>
          {file.path} ({file.kind}){' '}
          <button
            type="button"
            disabled={!isUnlocked}
            onClick={() => {
              post({ type: 'vaultImport', path: file.path })
            }}
          >
            {UI_TEXT.vault.importFile}
          </button>
        </p>
      ))}
      <p>{UI_TEXT.vault.paidWarning}</p>
      <p>
        {UI_TEXT.vault.status}: {formatNumber(state.status.itemCount)}
      </p>
    </section>
  )
}
