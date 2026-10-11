import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  vaultRequesterSchema,
  vaultTaintSchema,
  vaultUseSchema,
  vaultItemMetadataSchema,
  type VaultRequester,
  type VaultUse,
  type VaultTaint,
} from '../../shared/vault'
import {
  vaultAuthorizationResultSchema,
  type VaultBrokerPort,
  type VaultApprovalResult,
} from '../../shared/vaultProtocol'
import { vaultUseDigest } from '../../core/vault/useDigest'

export interface ExecVaultContext {
  readonly cwd: string
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly source: 'headless'
  readonly unattended: true
  /** Every refusal stops exec; this is independent of ordinary tool-denial policy. */
  readonly onDenied: (message: string) => void
}
export interface ExecVaultSession {
  close(): Promise<void>
}
export interface ExecVaultPort {
  open(context: ExecVaultContext): Promise<ExecVaultSession>
}

/** B/X inject the authenticated headless registration and bind this authorizer to engine uses. */
export class HeadlessVaultSession implements ExecVaultSession {
  private closed = false
  private readonly requester: VaultRequester
  constructor(
    requester: VaultRequester,
    private readonly broker: VaultBrokerPort,
    private readonly context: ExecVaultContext,
    private readonly endRequester: () => Promise<void>,
  ) {
    this.requester = vaultRequesterSchema.parse(structuredClone(requester))
    if (
      this.requester.source !== 'headless' ||
      !this.requester.unattended ||
      this.requester.role.kind !== 'headless' ||
      this.requester.conversationId !== context.sessionId ||
      this.requester.workspaceId === null
    )
      throw new Error(UI_TEXT.vault.noAccess)
  }
  private isCurrent(): boolean {
    return !this.closed && !this.context.signal.aborted
  }
  private deny(
    handle: string,
    use: VaultUse,
    reason: Extract<VaultApprovalResult, { kind: 'denied' }>['reason'],
  ): VaultApprovalResult {
    let detail = UI_TEXT.vault.noAccess
    switch (reason) {
      case 'presence': {
        detail = UI_TEXT.vault.presenceTierWarning
        break
      }
      case 'locked': {
        detail = UI_TEXT.vault.locked
        break
      }
      case 'expired': {
        detail = UI_TEXT.vault.approvalExpired
        break
      }
      case 'digest': {
        detail = UI_TEXT.vault.useChanged
        break
      }
      default: {
        break
      }
    }
    this.context.onDenied(
      reason === 'unattended'
        ? fill(UI_TEXT.vault.noUnattended, { item: handle, use: JSON.stringify(use) })
        : `${handle}: ${detail} (${reason})`,
    )
    return { kind: 'denied', reason }
  }
  async request(
    handle: string,
    rawUse: VaultUse,
    rawTaint: VaultTaint,
  ): Promise<VaultApprovalResult> {
    try {
      const use = vaultUseSchema.parse(structuredClone(rawUse))
      const taint = vaultTaintSchema.parse(structuredClone(rawTaint))
      const item = vaultItemMetadataSchema.shape.handle.parse(handle)
      if (!this.isCurrent()) return this.deny(item, use, 'peer')
      if (taint.tainted) return this.deny(item, use, 'tainted')
      const digest = vaultUseDigest(use)
      const result = vaultAuthorizationResultSchema.parse(
        await this.broker.request(this.requester, handle, use, taint),
      )
      if (!this.isCurrent()) return this.deny(item, use, 'peer')
      if (result.kind === 'denied') return this.deny(item, use, result.reason)
      if (result.kind !== 'ticket' || result.authority.kind !== 'grant')
        return this.deny(item, use, 'policy')
      if (result.ticket.requesterId !== this.requester.id || result.ticket.digest !== digest)
        return this.deny(item, use, 'digest')
      return this.broker.clock.now() >= result.ticket.expiresAt
        ? this.deny(item, use, 'expired')
        : result
    } catch {
      this.context.onDenied(UI_TEXT.vault.noAccess)
      return { kind: 'denied', reason: 'unattended' }
    }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.endRequester()
  }
}
