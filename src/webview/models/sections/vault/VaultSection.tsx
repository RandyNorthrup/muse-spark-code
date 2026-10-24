import { useEffect, useRef, useState } from 'react'
import { type vaultClientMessageSchema } from '../../../../shared/hostApi/vaultMessages'
import { type VaultPanelState } from '../../../../shared/modelsPanel'
import { UI_TEXT } from '../../../../shared/constants'
import { plural, formatDateTime, formatNumber } from '../../../../shared/l10n/text'
import type { VaultStatus } from '../../../../shared/vaultStatus'
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

/**
The card names the vault's real state first: a vault that is not created,
still pending setup, or lost never asks for an unlock and never claims a
protection its slots cannot give (RVCM1091D P2). Only a locked vault names
an unlock; only an observed slot names a protection.
*/
export function tierWarning(status: VaultStatus): string {
  if (status.state === 'uncreated') return UI_TEXT.vault.setupNeeded
  if (status.state === 'setupPending') return UI_TEXT.vault.setupPending
  // RVCM1091E P2: an unreachable broker is not a lost vault — Reset is
  // never the advice when the files may be fine. RVCM1091F: every reason
  // the host can synthesize has its own true sentence here, so a transient
  // failure never borrows the repair message (only `brokerBlocked` shows it).
  if (status.state === 'unavailable' || status.reason === 'vaultLost') {
    switch (status.reason) {
      case 'switchedOff': {
        return UI_TEXT.vault.switchedOff
      }
      case 'brokerBlocked': {
        return UI_TEXT.vault.brokerBlocked
      }
      case 'busy': {
        return UI_TEXT.vault.busy
      }
      case 'timeout':
      case 'watchLost':
      case 'unreachable': {
        return UI_TEXT.vault.operationFailed
      }
      case 'storeUnavailable': {
        return UI_TEXT.vault.storeUnavailable
      }
      case 'rollback': {
        return UI_TEXT.vault.rollback
      }
      case 'slotUnavailable': {
        return UI_TEXT.vault.slotUnavailable
      }
      case 'basicText': {
        return UI_TEXT.vault.basicText
      }
      case 'auditInvalid': {
        return UI_TEXT.vault.auditInvalid
      }
      case 'vaultLost':
      case 'locked':
      case null: {
        return UI_TEXT.vault.vaultLost
      }
    }
  }
  if (status.reason === 'brokerBlocked' || status.state === 'firstPartyOnly')
    return UI_TEXT.vault.brokerBlocked
  if (status.reason === 'rollback') return UI_TEXT.vault.rollback
  if (status.reason === 'basicText') return UI_TEXT.vault.basicText
  if (status.reason === 'auditInvalid') return UI_TEXT.vault.auditInvalid
  if (status.reason === 'slotUnavailable') return UI_TEXT.vault.slotUnavailable
  // A null tier means no slot has been observed, not OS-store protection.
  // Only a locked vault can ask for the unlock that would reveal it.
  if (status.tier === null)
    return status.state === 'locked' ? UI_TEXT.vault.unknownTierWarning : UI_TEXT.vault.tierUnknown
  if (status.tier === 'passphrase') return UI_TEXT.vault.passphraseWarning
  if (status.tier === 'recovery') return UI_TEXT.vault.recoveryWarning
  if (status.tier === 'presence') return UI_TEXT.vault.presenceTierWarning
  return status.tier === 'hardware' ? UI_TEXT.vault.hardwareWarning : UI_TEXT.vault.osStoreWarning
}

/**
Every vault state has its own true heading, from the core's typed states:
a new state that is not added here fails the build instead of falling
through to 'Locked' (RVCM1091D P2).
*/
export function vaultStateHeading(status: VaultStatus): string {
  switch (status.state) {
    case 'unlocked': {
      return UI_TEXT.vault.unlocked
    }
    case 'locked': {
      return UI_TEXT.vault.locked
    }
    case 'uncreated': {
      return UI_TEXT.vault.stateUncreated
    }
    case 'setupPending': {
      return UI_TEXT.vault.stateSetupPending
    }
    case 'unavailable': {
      return UI_TEXT.vault.stateUnavailable
    }
    case 'firstPartyOnly': {
      return UI_TEXT.vault.firstParty
    }
  }
}

/**
A transient failure (not a rollback, not a broker that cannot start)
offers the person's own Retry once the bounded auto-retries are spent.
*/
function isRetryableReason(reason: VaultStatus['reason']): boolean {
  switch (reason) {
    case 'busy':
    case 'timeout':
    case 'watchLost':
    case 'unreachable': {
      return true
    }
    default: {
      return false
    }
  }
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
  const sectionRef = useRef<HTMLElement>(null)
  const focusInside = useRef(false)
  const lastFocused = useRef<Element | null>(null)
  // Track whether keyboard focus lives inside the section, so a focused
  // control that unmounts (Retry after success, a removed item, a revoked
  // grant, Reset) hands focus back instead of dropping it (RVCM1091G P3).
  useEffect(() => {
    const node = sectionRef.current
    if (node === null) return
    const entered = (event: FocusEvent): void => {
      focusInside.current = true
      lastFocused.current = event.target instanceof Element ? event.target : null
    }
    const left = (event: FocusEvent): void => {
      // A null target means the focused control unmounted (focus is still
      // ours to restore) or focus fell to nowhere while the control lives
      // (the person clicked a non-focusable spot: decided below, never
      // pulled back in). Otherwise it left only when it moved outside.
      if (!(event.relatedTarget instanceof Node) || node.contains(event.relatedTarget)) return
      focusInside.current = false
      lastFocused.current = null
    }
    node.addEventListener('focusin', entered)
    node.addEventListener('focusout', left)
    return () => {
      node.removeEventListener('focusin', entered)
      node.removeEventListener('focusout', left)
    }
  }, [])
  useEffect(() => {
    const node = sectionRef.current
    if (node === null || !focusInside.current || document.activeElement !== document.body) return
    // Restore only when the focused control is truly gone (unmounted). When
    // it is still in the page, focus fell to nowhere by the person's own
    // doing — pulling it back into the vault section would steal it from
    // elsewhere (RVAPP-CM1091D5 P3-3).
    const focused = lastFocused.current
    if (focused !== null && document.contains(focused)) {
      focusInside.current = false
      return
    }
    // The focused control is gone: prefer the first control that can act,
    // else the heading, so keyboard users are never stranded on the body.
    const fallback =
      node.querySelector<HTMLElement>(':scope .vault-actions button:not([disabled])') ??
      node.querySelector<HTMLElement>(':scope h2')
    fallback?.focus()
  })
  const isUnlocked = state.status.state === 'unlocked'
  // Set Up Vault (lead decision 8): the host shows the one-time code natively.
  const isUncreated = state.status.state === 'uncreated'
  const isSetupPending = state.status.state === 'setupPending'
  const isLost = state.status.reason === 'vaultLost'
  // The broker cannot act while unavailable or first-party-only: an Unlock
  // there would only be refused, so the toggle stays disabled and Reset
  // (when lost) is the only action offered.
  const canToggleLock = state.status.state === 'locked' || state.status.state === 'unlocked'
  // RVCM1091F: after a transient failure spent its bounded auto-retries, the
  // section offers the person's own Retry (a rollback names its backup
  // instead, and a broker that cannot start names its repair).
  const canRetry = state.status.state === 'unavailable' && isRetryableReason(state.status.reason)
  const audit = state.audit.filter(
    (row) =>
      (itemFilter === '' || row.handle === itemFilter) &&
      (requesterFilter === '' || row.requester.id === requesterFilter) &&
      (kindFilter === '' || row.kind === kindFilter) &&
      (outcomeFilter === '' || row.outcome === outcomeFilter),
  )
  // Migrated credentials (journal rows and copied keys) are hidden
  // first-party rows: the key-store migration owns them, so the section
  // lists neither them nor their count, and offers no Edit or Remove for
  // them. The grant picker below reads the same list.
  const visibleItems = state.items.filter((item) => !item.hidden && !item.firstParty)
  return (
    <section
      className="vault-section"
      aria-label={UI_TEXT.vault.title}
      aria-busy={state.retrying === true}
      ref={sectionRef}
    >
      <h2 tabIndex={-1}>
        {UI_TEXT.vault.title} — {vaultStateHeading(state.status)}
      </h2>
      {/* The retry announcement lives in the page before its text changes,
          so the change itself is spoken (RVAPP-CM1091D5 P3-4). */}
      <p role="status">{state.retrying === true ? UI_TEXT.vault.retrying : ''}</p>
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
      {/* The tier card above already names the lost, uncreated and pending
          states with their own sentences; here only the Reset action remains. */}
      {isLost && (
        <div className="vault-actions">
          <button
            type="button"
            onClick={() => {
              post({ type: 'vaultReset' })
            }}
          >
            {UI_TEXT.vault.resetVault}
          </button>
        </div>
      )}
      <div className="vault-actions">
        {isUncreated || isSetupPending ? (
          <button
            type="button"
            disabled={isSetupPending}
            onClick={() => {
              post({ type: 'vaultSetup' })
            }}
          >
            {UI_TEXT.vault.setUp}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canToggleLock}
            onClick={() => {
              post({ type: isUnlocked ? 'vaultLock' : 'vaultUnlock' })
            }}
          >
            {isUnlocked ? UI_TEXT.vault.lock : UI_TEXT.vault.unlock}
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={() => {
              post({ type: 'vaultRetry' })
            }}
          >
            {UI_TEXT.vault.retry}
          </button>
        )}
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
      <p>{plural(UI_TEXT.vault.itemsCount, visibleItems.length)}</p>
      {visibleItems.length === 0 && <p>{UI_TEXT.vault.empty}</p>}
      {visibleItems.map((item) => (
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
      {/* D217: retired migration slots, each with its own Undo. The key
          beside the label is technical detail, spliced like item handles. */}
      {(state.retired ?? []).length > 0 && (
        <>
          <h3>{UI_TEXT.vault.retiredEntries}</h3>
          {(state.retired ?? []).map((entry) => (
            <details key={entry.key}>
              <summary>
                {entry.label} ({entry.key})
              </summary>
              <div className="vault-actions">
                <button
                  type="button"
                  disabled={!isUnlocked}
                  onClick={() => {
                    post({ type: 'vaultUndoRetired', key: entry.key })
                  }}
                >
                  {UI_TEXT.undoAction}
                </button>
              </div>
            </details>
          ))}
        </>
      )}
      {editingGrant && isUnlocked && (
        <VaultGrantEditor
          items={visibleItems}
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
      {/* Kept or orphaned receipts finish here with their two real actions:
          finish the delete, or keep the file (RVAPP-CM1091D5 P2-2). The path
          and names are technical detail, spliced beside the translated
          heading and prompt. */}
      {(state.pendingReceipts ?? []).length > 0 && (
        <div className="vault-actions">
          <h3>{UI_TEXT.vault.pendingImports}</h3>
          <p>{UI_TEXT.vault.importKeepOrDelete}</p>
          {(state.pendingReceipts ?? []).map((entry) => (
            <p key={entry.receipt}>
              {entry.path}: {entry.items.map((item) => `${item.name} (${item.kind})`).join(', ')}{' '}
              <button
                type="button"
                disabled={!isUnlocked}
                onClick={() => {
                  post({ type: 'vaultKeepReceipt', receipt: entry.receipt })
                }}
              >
                {UI_TEXT.vault.keepFile}
              </button>{' '}
              <button
                type="button"
                disabled={!isUnlocked}
                onClick={() => {
                  post({ type: 'vaultDeleteReceipt', receipt: entry.receipt })
                }}
              >
                {UI_TEXT.vault.deleteFile}
              </button>
            </p>
          ))}
        </div>
      )}
      <p>{UI_TEXT.vault.paidWarning}</p>
      <p>
        {UI_TEXT.vault.status}: {formatNumber(visibleItems.length)}
      </p>
    </section>
  )
}
