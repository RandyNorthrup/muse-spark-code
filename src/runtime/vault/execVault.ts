import type { VaultUse, VaultTaint, VaultItemMetadata } from '../../shared/vault'
import type { VaultBrokerPort, VaultApprovalResult } from '../../shared/vaultProtocol'

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
  authorize(
    handle: string,
    use: VaultUse,
    taint: VaultTaint,
    signal: AbortSignal,
  ): Promise<VaultApprovalResult>
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
