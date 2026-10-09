// M124 (D106, design §4): one-use approvals that only our own approval page
// can settle. An intent binds the principal, grant generation, workspace,
// tool, exact payload, target generation, price and expiry into one digest.
// Nothing an MCP client sends reaches `decide`: the registry has no path to
// it, and tool arguments, elicitation answers and annotations are ignored.
import { createHash, randomBytes } from 'node:crypto'
import { CONNECTOR_LIMITS } from '../../shared/constants'
import type { ConnectorIntentView } from '../../shared/connector'

export interface ApprovalBinding {
  readonly principal: string
  readonly grantGeneration: number
  readonly workspaceId: string | undefined
  readonly tool: string
  readonly toolClass: 'write' | 'run'
  /** The exact, validated input; serialized canonically into the digest. */
  readonly payload: unknown
  readonly targetGeneration: number
  readonly priceMicrousd: number
}

type IntentState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | 'cancelled'

interface Intent {
  readonly id: string
  readonly digest: string
  readonly binding: ApprovalBinding
  readonly expiresAt: number
  readonly view: Omit<ConnectorIntentView, 'intentId' | 'digest' | 'expiresAt'>
  state: IntentState
}

/** Sorted keys, so the same payload always has the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function bindingDigest(binding: ApprovalBinding, expiresAt: number): string {
  return createHash('sha256')
    .update(canonicalJson({ ...binding, expiresAt }))
    .digest('hex')
}

export type DecisionOutcome = 'approved' | 'denied' | 'refused'

export class ApprovalLedger {
  private readonly intents = new Map<string, Intent>()

  public constructor(
    private readonly now: () => number,
    private readonly onSettled: (
      intentId: string,
      outcome: 'approved' | 'denied' | 'expired',
    ) => void,
    private readonly leaseMs: number = CONNECTOR_LIMITS.approvalLeaseMs,
    private readonly maxPending: number = CONNECTOR_LIMITS.pendingApprovals,
  ) {}

  /** A new pending intent, or undefined when the connection's pending cap is reached. */
  public open(
    binding: ApprovalBinding,
    view: Omit<ConnectorIntentView, 'intentId' | 'digest' | 'expiresAt'>,
  ): string | undefined {
    this.expireDue()
    let pending = 0
    for (const intent of this.intents.values()) if (intent.state === 'pending') pending += 1
    if (pending >= this.maxPending) return undefined
    const id = randomBytes(CONNECTOR_LIMITS.idBytes).toString('hex')
    const expiresAt = this.now() + this.leaseMs
    this.intents.set(id, {
      id,
      digest: bindingDigest(binding, expiresAt),
      binding,
      expiresAt,
      view,
      state: 'pending',
    })
    return id
  }

  /**
   * Our approval page's authenticated click. The digest must be the one the
   * page was shown; a changed, expired or already settled intent refuses.
   */
  public decide(intentId: string, digest: string, isApproved: boolean): DecisionOutcome {
    this.expireDue()
    const intent = this.intents.get(intentId)
    if (intent?.state !== 'pending' || intent.digest !== digest) return 'refused'
    intent.state = isApproved ? 'approved' : 'denied'
    this.onSettled(intentId, intent.state)
    return intent.state
  }

  /**
   * Compare-and-swap at dispatch: only an approved, unexpired intent whose
   * binding still matches exactly is consumed, once.
   */
  public consume(intentId: string, current: ApprovalBinding): boolean {
    const intent = this.intents.get(intentId)
    if (intent?.state !== 'approved') return false
    if (this.now() > intent.expiresAt) {
      intent.state = 'expired'
      return false
    }
    if (bindingDigest(current, intent.expiresAt) !== intent.digest) {
      intent.state = 'cancelled'
      return false
    }
    intent.state = 'consumed'
    return true
  }

  public cancel(intentId: string): boolean {
    const intent = this.intents.get(intentId)
    if (intent?.state !== 'pending' && intent?.state !== 'approved') return false
    intent.state = 'cancelled'
    return true
  }

  /** Disconnect, revocation and the kill switch cancel every unsettled intent. */
  public cancelAll(): readonly string[] {
    const cancelled: string[] = []
    for (const intent of this.intents.values())
      if (intent.state === 'pending' || intent.state === 'approved') {
        intent.state = 'cancelled'
        cancelled.push(intent.id)
      }
    return cancelled
  }

  public expireDue(): void {
    const now = this.now()
    for (const intent of this.intents.values())
      if (intent.state === 'pending' && now > intent.expiresAt) {
        intent.state = 'expired'
        this.onSettled(intent.id, 'expired')
      }
  }

  /** What the approval page shows: pending intents only. */
  public pending(): ConnectorIntentView[] {
    this.expireDue()
    const views: ConnectorIntentView[] = []
    for (const intent of this.intents.values())
      if (intent.state === 'pending')
        views.push({
          ...intent.view,
          intentId: intent.id,
          digest: intent.digest,
          expiresAt: intent.expiresAt,
        })
    return views
  }

  public stateOf(intentId: string): IntentState | undefined {
    return this.intents.get(intentId)?.state
  }
}
