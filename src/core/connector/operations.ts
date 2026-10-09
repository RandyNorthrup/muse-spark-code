// M124 (D106): the connection's own operations. A run or write answers with
// an awaitingApproval receipt; the request id is an idempotency key scoped to
// the tool, so a retry with the same bytes returns the same receipt and
// changed bytes refuse. Records are bounded; a terminal record is evicted
// before a live one, and a full table refuses rather than forgetting work.
import { randomBytes } from 'node:crypto'
import { CONNECTOR_LIMITS } from '../../shared/constants'
import type { ConnectorOperationState, ConnectorReason } from '../../shared/connector'

export interface OperationRecord {
  readonly id: string
  readonly tool: string
  readonly workspaceId: string | undefined
  readonly requestKey: string
  readonly payloadDigest: string
  readonly createdAt: number
  state: ConnectorOperationState
  updatedAt: number
  intentId?: string
  /** Set the moment the dispatched effect starts; Stop can no longer prevent it. */
  isEffectStarted?: boolean
  reason?: ConnectorReason
  /** The scrubbed projection of the finished effect, never raw output. */
  result?: unknown
  lastPolledAt?: number
}

const TERMINAL: ReadonlySet<ConnectorOperationState> = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
])

export function isTerminal(state: ConnectorOperationState): boolean {
  return TERMINAL.has(state)
}

export type Claim =
  | { readonly kind: 'new'; readonly record: OperationRecord }
  | { readonly kind: 'same'; readonly record: OperationRecord }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'full' }

export type StopOutcome = 'stopped' | 'alreadyStopped' | 'stopRequested' | 'unknown'

export class OperationRegistry {
  private readonly records = new Map<string, OperationRecord>()
  private readonly byRequest = new Map<string, string>()

  public constructor(
    private readonly now: () => number,
    private readonly max: number = CONNECTOR_LIMITS.operationsKept,
  ) {}

  private evictOne(): boolean {
    let victim: OperationRecord | undefined
    for (const record of this.records.values())
      if (isTerminal(record.state)) {
        victim = record
        break
      }
    if (victim === undefined) return false
    this.records.delete(victim.id)
    this.byRequest.delete(victim.requestKey)
    return true
  }

  public claim(
    tool: string,
    requestId: string,
    workspaceId: string | undefined,
    payloadDigest: string,
  ): Claim {
    const requestKey = `${tool}\u{0}${requestId}`
    const existingId = this.byRequest.get(requestKey)
    const existing = existingId === undefined ? undefined : this.records.get(existingId)
    if (existing !== undefined)
      return existing.payloadDigest === payloadDigest
        ? { kind: 'same', record: existing }
        : { kind: 'conflict' }
    if (this.records.size >= this.max && !this.evictOne()) return { kind: 'full' }
    const at = this.now()
    const record: OperationRecord = {
      id: randomBytes(CONNECTOR_LIMITS.idBytes).toString('hex'),
      tool,
      workspaceId,
      requestKey,
      payloadDigest,
      createdAt: at,
      updatedAt: at,
      state: 'awaitingApproval',
    }
    this.records.set(record.id, record)
    this.byRequest.set(requestKey, record.id)
    return { kind: 'new', record }
  }

  public get(id: string): OperationRecord | undefined {
    return this.records.get(id)
  }

  public byIntent(intentId: string): OperationRecord | undefined {
    for (const record of this.records.values()) if (record.intentId === intentId) return record
    return undefined
  }

  /** A transition happens only from the expected states; a settled record never reopens. */
  public move(
    id: string,
    from: readonly ConnectorOperationState[],
    to: ConnectorOperationState,
    detail: { readonly reason?: ConnectorReason; readonly result?: unknown } = {},
  ): boolean {
    const record = this.records.get(id)
    if (record === undefined || !from.includes(record.state)) return false
    record.state = to
    record.updatedAt = this.now()
    if (detail.reason !== undefined) record.reason = detail.reason
    if (detail.result !== undefined) record.result = detail.result
    return true
  }

  /**
   * Stop never waits: pending work, and dispatched work whose effect has not
   * started, is cancelled; an effect already under way is reported truthfully.
   */
  public stop(id: string): StopOutcome {
    const record = this.records.get(id)
    if (record === undefined) return 'unknown'
    if (isTerminal(record.state)) return 'alreadyStopped'
    // A local write that has started cannot be interrupted midway; its receipt arrives.
    if (record.isEffectStarted === true) return 'stopRequested'
    this.move(id, ['awaitingApproval', 'running'], 'cancelled')
    return 'stopped'
  }
}
