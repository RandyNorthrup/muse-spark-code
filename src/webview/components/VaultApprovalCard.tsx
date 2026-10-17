import { useState } from 'react'
import { type VaultApprovalAnswer, type VaultApprovalRequest } from '../../shared/vault'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  isSessionAllowed,
  vaultUseLabel,
  vaultUseTarget,
  VaultDetails,
} from '../models/sections/vault/vaultPresentation'
import '../models/sections/vault/vault.css'

export interface VaultApprovalCardProps {
  readonly request: VaultApprovalRequest
  readonly onAnswer: (answer: VaultApprovalAnswer) => void
  readonly onManage: () => void
}

/** Separate from ordinary tool approvals, session rules, Bypass and paid consent. */
export function VaultApprovalCard({ request, onAnswer, onManage }: VaultApprovalCardProps) {
  // No expiry of our own (owner 2026-10-16): the card waits until the
  // person allows or denies it.
  const [answered, setAnswered] = useState(false)
  function answer(decision: VaultApprovalAnswer['decision']): void {
    if (answered) return
    setAnswered(true)
    onAnswer({ requestId: request.id, digest: request.digest, decision })
  }
  const isProcessUse = !['ssh', 'sshSign', 'disclosure'].includes(request.use.kind)
  return (
    <article className="vault-card" aria-labelledby={`vault-approval-${request.id}`}>
      <h3 id={`vault-approval-${request.id}`}>
        {fill(UI_TEXT.vault.approval, {
          requester: request.requester.role.kind,
          use: vaultUseLabel(request.use.kind),
          item: request.item.label,
          target: vaultUseTarget(request.use),
        })}
      </h3>
      <VaultDetails value={request.use} />
      <details>
        <summary>{UI_TEXT.vault.requester}</summary>
        <VaultDetails value={request.requester} />
      </details>
      <p>
        SHA-256: <code>{request.digest}</code>
      </p>
      {isProcessUse && <p>{UI_TEXT.vault.processWarning}</p>}
      {request.requester.deviceId !== null && <p>{UI_TEXT.vault.remoteWarning}</p>}
      {request.use.kind === 'disclosure' && <p>{UI_TEXT.vault.disclosureWarning}</p>}
      {request.use.kind === 'ssh' && request.use.hostKeyFingerprint === null && (
        <p>{UI_TEXT.vault.noDestination}</p>
      )}
      {request.item.requirePresence && <p>{UI_TEXT.vault.presenceWarning}</p>}
      {request.taint.tainted && (
        <p>
          {fill(UI_TEXT.vault.taintWarning, {
            content: request.taint.reasons
              .map((reason) => `${reason.source}: ${reason.label}`)
              .join('; '),
          })}
        </p>
      )}
      <p>{UI_TEXT.vault.paidWarning}</p>
      <div className="vault-actions">
        <button
          type="button"
          disabled={answered}
          onClick={() => {
            answer('allowOnce')
          }}
        >
          {UI_TEXT.allowOnce}
        </button>
        {isSessionAllowed(request) && (
          <button
            type="button"
            disabled={answered}
            onClick={() => {
              answer('allowSession')
            }}
          >
            {UI_TEXT.vault.allowSession}
          </button>
        )}
        <button
          type="button"
          disabled={answered}
          onClick={() => {
            answer('deny')
          }}
        >
          {UI_TEXT.paidDeny}
        </button>
        <button type="button" onClick={onManage}>
          {UI_TEXT.vault.manage}
        </button>
      </div>
    </article>
  )
}
