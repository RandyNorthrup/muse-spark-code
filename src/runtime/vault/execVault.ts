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
import { VaultTaintSession, combineVaultTaint } from '../../core/vault/taint'
import type { VaultItemMetadata } from '../../shared/vault'

/**
The wire headless port's D216 additions. Both are transport facts, not
broker policy: over the socket the session reports provenance and
delegates tickets on its incarnation-bound connection; in-process the
broker takes the taint as the request argument directly, so only the
wire port implements them.
*/
export interface HeadlessBrokerPort extends VaultBrokerPort {
  readonly reportProvenance?: ((taint: VaultTaint) => Promise<boolean>) | undefined
  readonly delegate?:
    | ((
        ticketId: string,
        feeder: { processId: number; startedAt: number },
        envelopeDigest: string,
      ) => Promise<boolean>)
    | undefined
}

/** What the headless exec host port drives: tickets, the item list, delegations. */
export interface HeadlessVaultBroker {
  authorize(handle: string, use: VaultUse, signal: AbortSignal): Promise<VaultApprovalResult>
  list(): Promise<readonly VaultItemMetadata[]>
  delegate(
    ticketId: string,
    feeder: { processId: number; startedAt: number },
    envelopeDigest: string,
  ): Promise<void>
}

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
  /**
  D216: the exec host port's view of this registration. Implemented by
  the runtime's headless session; the evidence-counting session keeps
  the same shape.
  */
  execBroker(): HeadlessVaultBroker
  close(): Promise<void>
}
export interface ExecVaultPort {
  /** The client data folder the feeder discovers the broker under. */
  readonly dataDir: string
  open(context: ExecVaultContext): Promise<ExecVaultSession>
}

/** The authenticated headless registration, bound to engine uses through the runtime vault loader. */
export class HeadlessVaultSession implements ExecVaultSession {
  private closed = false
  private readonly requester: VaultRequester
  // D216 lane T: one provenance session per agent session, reported to
  // the broker with each proposal. The workspace is the operator's own
  // chosen folder for this run, so it starts trusted; observations only
  // ever add taint from there.
  private readonly taints = new VaultTaintSession('modelApi')
  constructor(
    requester: VaultRequester,
    private readonly broker: HeadlessBrokerPort,
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
    this.taints.beginRequest([], true)
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
      case 'ceiling': {
        detail = UI_TEXT.vault.ceilingNone
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
      // D216: the session's provenance rides with each proposal; the
      // broker evaluates the reported taint, and a report can only add.
      const combined = combineVaultTaint([this.taints.current(), taint])
      if (combined.tainted) return this.deny(item, use, 'tainted')
      if (this.broker.reportProvenance) {
        const wasReported = await this.broker.reportProvenance(combined)
        if (!wasReported || !this.isCurrent()) return this.deny(item, use, 'peer')
      }
      const digest = vaultUseDigest(use)
      const result = vaultAuthorizationResultSchema.parse(
        await this.broker.request(this.requester, handle, use, combined),
      )
      if (!this.isCurrent()) return this.deny(item, use, 'peer')
      if (result.kind === 'denied') return this.deny(item, use, result.reason)
      if (result.kind !== 'ticket' || result.authority.kind !== 'grant')
        return this.deny(item, use, 'policy')
      if (result.ticket.requesterId !== this.requester.id || result.ticket.digest !== digest)
        return this.deny(item, use, 'digest')
      return result.ticket.expiresAt !== null && this.broker.clock.now() >= result.ticket.expiresAt
        ? this.deny(item, use, 'expired')
        : result
    } catch {
      this.context.onDenied(UI_TEXT.vault.noAccess)
      return { kind: 'denied', reason: 'unattended' }
    }
  }
  /** D216: the exec host port's view of this registration. */
  execBroker(): HeadlessVaultBroker {
    return {
      authorize: async (handle, use, signal) => {
        signal.throwIfAborted()
        return await this.request(handle, use, { tainted: false, reasons: [] })
      },
      list: async () => {
        if (!this.isCurrent()) throw new Error(UI_TEXT.vault.noAccess)
        return await this.broker.list(this.requester)
      },
      delegate: async (ticketId, feeder, envelopeDigest) => {
        if (!this.isCurrent() || !this.broker.delegate) throw new Error(UI_TEXT.vault.noAccess)
        const wasDelegated = await this.broker.delegate(ticketId, feeder, envelopeDigest)
        if (!wasDelegated || !this.isCurrent()) throw new Error(UI_TEXT.vault.noAccess)
      },
    }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.endRequester()
  }
}
