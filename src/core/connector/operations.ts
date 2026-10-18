// M124 (D106, design §3a): the one state machine every connector call walks.
//
//   received → admitted → (awaitingApproval → approved →) dispatching → settled
//                 ↘ refused / cancelled / failed (terminal; see TRANSITIONS)
//
// Each call is one Operation. Its single authority (the registry's
// `stopCause`: the call's cancellation and deadline, disconnect, the kill
// switch and the grant, its scopes, workspace and confidential policy) is
// checked by one synchronous gate right before every effect starts (a lease,
// an intent, an owner port, the write) and again before a result is
// delivered; no await sits between a passed gate and the effect it guards.
// Every transition writes one audit receipt, so every call ends in exactly
// one terminal receipt. A write's operation is also kept in a bounded table
// so the client can poll and Stop it; a retry with the same bytes finds it.
import { CONNECTOR_LIMITS } from '../../shared/constants'
import type {
  ConnectorCallState,
  ConnectorCancelCause,
  ConnectorOperationState,
  ConnectorReason,
} from '../../shared/connector'
import type { ConnectorToolSpec } from '../../shared/connectorTools'
import type { Refusal } from './policy'

/** Every edge a call may take; any other move is refused and changes nothing. */
export const TRANSITIONS: Readonly<Record<ConnectorCallState, readonly ConnectorCallState[]>> = {
  received: ['admitted', 'refused', 'cancelled'],
  admitted: ['awaitingApproval', 'dispatching', 'refused', 'cancelled', 'failed'],
  awaitingApproval: ['approved', 'refused', 'cancelled', 'failed'],
  approved: ['dispatching', 'cancelled', 'failed'],
  // A started write is never cancelled: it settles or fails. A read's
  // result can still be refused or withheld at delivery.
  dispatching: ['settled', 'refused', 'cancelled', 'failed'],
  settled: [],
  refused: [],
  cancelled: [],
  failed: [],
}

const LIVE: ReadonlySet<ConnectorCallState> = new Set([
  'received',
  'admitted',
  'awaitingApproval',
  'approved',
  'dispatching',
])

/** What `muse_operation_get` shows for each state. */
const PUBLIC: Readonly<Record<ConnectorCallState, ConnectorOperationState>> = {
  received: 'awaitingApproval',
  admitted: 'awaitingApproval',
  awaitingApproval: 'awaitingApproval',
  approved: 'running',
  dispatching: 'running',
  settled: 'completed',
  refused: 'failed',
  cancelled: 'cancelled',
  failed: 'failed',
}

export type StopOutcome = 'stopped' | 'alreadyStopped' | 'stopRequested' | 'unknown'

/** The scope an operation was admitted to: its workspace, or the user library. */
export interface OperationScope {
  readonly workspaceId?: string | undefined
  readonly userLibrary?: boolean
}

export interface OperationEnv {
  readonly now: () => number
  /** The single authority: why this operation must stop now, if it must. */
  readonly stopCause: (operation: Operation) => ConnectorCancelCause | undefined
  /** One receipt for one transition; false when it is not durable. */
  readonly journal: (
    operation: Operation,
    from: ConnectorCallState,
    to: ConnectorCallState,
    isRequired: boolean,
  ) => Promise<boolean>
  /** A cancellation's words for the client. */
  readonly refusalOf: (cause: ConnectorCancelCause) => Refusal
}

/**
 * Transitions whose receipt must be durable before they happen (written
 * ahead; a failed append means the transition and its effect never happen).
 * Refusals, cancellations and failures are best effort, and so is Stop.
 */
const RECEIPTED: ReadonlySet<ConnectorCallState> = new Set([
  'admitted',
  'awaitingApproval',
  'approved',
  'dispatching',
  'settled',
])

export class Operation {
  private readonly holds: { readonly states: readonly ConnectorCallState[]; run: () => void }[] = []
  private readonly onAbort = () => {
    this.check()
  }
  /** Aborted at the terminal move. Not `Promise.withResolvers`: Node 20 lacks it (PLAN.md M62). */
  private readonly ending = new AbortController()
  public state: ConnectorCallState = 'received'
  public updatedAt: number
  public reason?: ConnectorReason
  public message?: string
  public cause?: ConnectorCancelCause
  /** Set at admission: the grant generation and scope this call was admitted under. */
  public grantGeneration?: number
  public scope?: OperationScope
  /** A write's own: its idempotency key, payload digest and intent. */
  public requestKey?: string
  public payloadDigest?: string
  public intentId?: string
  /** The scrubbed projection of a finished write, never raw output. */
  public result?: unknown
  public lastPolledAt?: number
  /** The call's cancellation and deadline, until its reply is delivered. */
  public signal: AbortSignal | undefined
  /** Its result was decided at the delivery gate: only its receipt is awaited now. */
  public isCommitted = false
  /** Resolves with the operation once it is terminal. */
  public readonly ended = new Promise<Operation>((resolve) => {
    this.ending.signal.addEventListener(
      'abort',
      () => {
        resolve(this)
      },
      { once: true },
    )
  })

  public constructor(
    public readonly id: string,
    public readonly tool: ConnectorToolSpec | undefined,
    private readonly env: OperationEnv,
  ) {
    this.updatedAt = env.now()
  }

  /** A terminal move with its reason; a terminal operation keeps the one it has. */
  private end(to: ConnectorCallState, refusal: Refusal, cause?: ConnectorCancelCause): boolean {
    if (!TRANSITIONS[this.state].includes(to)) return false
    this.reason = refusal.reason
    this.message = refusal.message
    if (cause !== undefined) this.cause = cause
    return this.move(to)
  }

  public get isLive(): boolean {
    return LIVE.has(this.state)
  }

  /** The call's signal: an abort cancels the operation at once, even one already aborted. */
  public attach(signal: AbortSignal): void {
    this.signal = signal
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.check()
  }

  /** The reply is delivered: the call's cancellation no longer reaches a kept operation. */
  public detach(): void {
    this.signal?.removeEventListener('abort', this.onAbort)
    this.signal = undefined
  }

  /** Runs `release` as soon as the operation is in none of `states`; now, if it already is not. */
  public holdWhile(states: readonly ConnectorCallState[], release: () => void): void {
    if (states.includes(this.state)) this.holds.push({ states, run: release })
    else release()
  }

  /**
   * The final gate, synchronous: true only while the operation is in one of
   * `expected` and its authority stands. A stopped authority cancels it here.
   */
  public gate(expected: readonly ConnectorCallState[]): boolean {
    this.check()
    return expected.includes(this.state)
  }

  /** Applies the authority now: a live operation it stops is cancelled. */
  public check(): void {
    if (!this.isLive) return
    const cause = this.env.stopCause(this)
    if (cause !== undefined) this.cancel(cause)
  }

  /**
   * The receipt for a coming transition, durable before its effect may
   * start. Only an edge of the table from the state the operation is in is
   * journaled; any other answers false and writes nothing.
   */
  public async writeAhead(to: ConnectorCallState): Promise<boolean> {
    return (
      TRANSITIONS[this.state].includes(to) && (await this.env.journal(this, this.state, to, true))
    )
  }

  /**
   * One transition from the table. A receipted transition happens only
   * written ahead (Stop's excepted); a terminal refusal's receipt is best
   * effort.
   */
  public move(to: ConnectorCallState, isWrittenAhead = false): boolean {
    const from = this.state
    if (!TRANSITIONS[from].includes(to)) return false
    const isStop = this.tool?.toolClass === 'stop'
    if (!isWrittenAhead && !isStop && RECEIPTED.has(to)) return false
    this.state = to
    this.updatedAt = this.env.now()
    if (!isWrittenAhead) void this.env.journal(this, from, to, false)
    for (const hold of this.holds.splice(0))
      if (hold.states.includes(to)) this.holds.push(hold)
      else hold.run()
    if (!this.isLive) this.ending.abort()
    return true
  }

  public refuse(refusal: Refusal): Refusal {
    this.end('refused', refusal)
    return this.final()
  }

  public fail(refusal: Refusal): Refusal {
    this.end('failed', refusal)
    return this.final()
  }

  /**
   * False for a terminal operation and for a committed one: a write whose
   * effect has started, or a result decided at its delivery gate.
   */
  public cancel(cause: ConnectorCancelCause): boolean {
    const isStartedWrite = this.state === 'dispatching' && this.tool?.toolClass === 'write'
    return (
      !isStartedWrite &&
      !this.isCommitted &&
      this.end('cancelled', this.env.refusalOf(cause), cause)
    )
  }

  /** Stop's effect on this operation; it never waits. */
  public stop(): StopOutcome {
    if (!this.isLive) return 'alreadyStopped'
    return this.cancel('stop') ? 'stopped' : 'stopRequested'
  }

  /** A terminal operation's refusal (its reason and words). */
  public final(): Refusal {
    return { reason: this.reason ?? 'unavailable', message: this.message ?? '' }
  }

  /** What `muse_operation_get` returns. */
  public view() {
    return {
      operationId: this.id,
      tool: this.tool?.name ?? '',
      state: this.cause === 'expired' ? 'expired' : PUBLIC[this.state],
      ...(this.reason !== undefined && this.cause !== 'stop' && { reason: this.reason }),
      ...(this.result !== undefined && { result: this.result }),
      updatedAt: new Date(this.updatedAt).toISOString(),
    }
  }
}

export type Claim =
  | { readonly kind: 'new' }
  | { readonly kind: 'same'; readonly operation: Operation }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'full' }

/**
 * The connection's write operations, bounded: a terminal one is evicted
 * before a live one, and a full table refuses rather than forgetting work.
 * The request id is an idempotency key scoped to the tool: the same bytes
 * find the same operation, changed bytes refuse.
 */
export class OperationTable {
  private readonly operations = new Map<string, Operation>()

  public constructor(private readonly max: number = CONNECTOR_LIMITS.operationsKept) {}

  public claim(operation: Operation, requestKey: string, payloadDigest: string): Claim {
    for (const existing of this.operations.values())
      if (existing.requestKey === requestKey)
        return existing.payloadDigest === payloadDigest
          ? { kind: 'same', operation: existing }
          : { kind: 'conflict' }
    if (this.operations.size >= this.max) {
      let victim: Operation | undefined
      for (const candidate of this.operations.values())
        if (!candidate.isLive) {
          victim = candidate
          break
        }
      if (victim === undefined) return { kind: 'full' }
      this.operations.delete(victim.id)
    }
    operation.requestKey = requestKey
    operation.payloadDigest = payloadDigest
    this.operations.set(operation.id, operation)
    return { kind: 'new' }
  }

  public get(id: string): Operation | undefined {
    return this.operations.get(id)
  }

  public byIntent(intentId: string): Operation | undefined {
    for (const operation of this.operations.values())
      if (operation.intentId === intentId) return operation
    return undefined
  }
}
