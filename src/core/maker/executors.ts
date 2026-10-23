// D83.3/D83.5/D83.6/D83.7 (RLF-DEVICES): the concrete printer, CNC
// and microcontroller executors. Each sends only through a verified
// exact-payload approval, asked from inside the executor: the person
// saw the exact bytes before anything moves. Policy refuses without
// asking; the gesture is verified; then target, digest and fresh state
// are rechecked against the actual payload before the send. A refused
// payload sends nothing. Stop sends the machine's own fixed sequence
// without approval (D83.5). The CNC executor offers no send at all:
// status, settings read, alarms and stop only (D83.7, Q-M103b).
import type { MakerAnalysis, MakerOperation, MakerTarget } from '../../shared/maker'
import { classifyMakerPayload, type MakerRefusalReason } from './classify'
import {
  analyzeMakerPayload,
  checkMakerLimits,
  type MakerEnvelopeLimits,
  type MakerMotionSummary,
} from './analysis'
import {
  makerPayloadDigest,
  requestMakerApproval,
  type MakerApprovalAsker,
  type MakerApprovals,
  type MakerVerifiedApproval,
} from './approval'

export interface MakerPosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface MakerMachineState {
  /**
  Opaque change-detect over the full state. It must change on every
  mutation and must cover everything analysis and limits consume
  (position, homed, soft limits, job state): the executor treats a
  match as proof nothing policy-relevant changed since the prompt.
  */
  readonly fingerprint: string
  readonly open: boolean
  /** Machines only; absent where the connection cannot report them. */
  readonly position?: MakerPosition
  readonly homed?: boolean
  readonly softLimits?: boolean
  /** Microcontroller only: the board behind the port. */
  readonly board?: { readonly chip: string }
  /** Microcontroller only: the flash capacity in bytes. */
  readonly flashCapacityBytes?: number
}

export interface MakerReceipt {
  readonly seq: number
  readonly kind: 'open' | 'close' | 'send' | 'stop'
  readonly digest: string
  readonly byteLength: number
  readonly response: string
  readonly stateBefore: string
  readonly stateAfter: string
}

export interface MakerConnectionResponse {
  readonly response: string
  readonly receipt: MakerReceipt
}

/**
The machine seam the executors drive. This lane binds simulator
connections only; real serial and HTTP transports arrive with M103's
machine lanes, after the lead's qualification. Every connection
journals what it received: simulator receipts never qualify hardware.
*/
export interface MakerMachineConnection {
  readonly target: MakerTarget
  readState(): MakerMachineState
  readLimits(): MakerEnvelopeLimits
  receipts(): readonly MakerReceipt[]
  open(): Promise<MakerConnectionResponse>
  close(): Promise<MakerConnectionResponse>
  send(payload: Uint8Array): Promise<MakerConnectionResponse>
  stop(): Promise<MakerConnectionResponse & { readonly warning?: MakerStopWarning }>
}

/** Stop-sequence warnings the surface maps to its own sentence. */
export type MakerStopWarning = 'startupMotion'

export type MakerLogClass = MakerOperation | 'observe' | 'stop'

/**
D83.11's record shape: time, machine, class, the payload redacted to
its SHA-256 and length, the approval, the machine's answer and the
outcome. Executors return it with every result; persisting it to the
host's device log rides M103's log lane.
*/
export interface MakerLogRecord {
  readonly atMs: number
  readonly machine: string
  readonly class: MakerLogClass
  readonly payloadSha256: string
  readonly payloadByteLength: number
  readonly approvalId?: string
  readonly outcome: 'sent' | 'refused'
  readonly reason?: MakerRefusalReason
  readonly detail?: string
  readonly response?: string
}

export type MakerExecuteResult =
  | { readonly ok: true; readonly response: string; readonly log: MakerLogRecord }
  | {
      readonly ok: false
      readonly reason: MakerRefusalReason
      readonly detail?: string
      readonly log: MakerLogRecord
    }

export interface MakerStopResult {
  readonly response: string
  readonly warning?: MakerStopWarning
  readonly log: MakerLogRecord
}

export interface MakerExecutorDeps {
  readonly approvals: MakerApprovals
  readonly now?: () => number
}

/** The digest every connect approval binds: opens carry no bytes. */
export const MAKER_EMPTY_PAYLOAD_DIGEST = makerPayloadDigest(new Uint8Array(0))

export interface MakerSendOptions {
  readonly userLimits?: MakerEnvelopeLimits
  /** The calling session's own deadline for the gesture (D121). */
  readonly expiresAt?: number
}

function isSameTarget(left: MakerTarget, right: MakerTarget): boolean {
  return (
    left.kind === right.kind &&
    left.endpoint === right.endpoint &&
    left.simulated === right.simulated
  )
}

abstract class MakerExecutorBase {
  protected readonly approvals: MakerApprovals
  protected readonly now: () => number
  public constructor(deps: MakerExecutorDeps) {
    this.approvals = deps.approvals
    this.now = deps.now ?? Date.now
  }

  protected refusal(
    connection: MakerMachineConnection,
    payload: Uint8Array,
    operation: MakerLogClass,
    reason: MakerRefusalReason,
    approvalId: string | undefined,
    detail?: string,
  ): MakerExecuteResult {
    return {
      ok: false,
      reason,
      ...(detail !== undefined && { detail }),
      log: {
        atMs: this.now(),
        machine: connection.target.name,
        class: operation,
        payloadSha256: makerPayloadDigest(payload),
        payloadByteLength: payload.byteLength,
        ...(approvalId !== undefined && { approvalId }),
        outcome: 'refused',
        reason,
        ...(detail !== undefined && { detail }),
      },
    }
  }

  protected sent(
    connection: MakerMachineConnection,
    payload: Uint8Array,
    operation: MakerLogClass,
    approvalId: string | undefined,
    response: string,
  ): MakerExecuteResult {
    return {
      ok: true,
      response,
      log: {
        atMs: this.now(),
        machine: connection.target.name,
        class: operation,
        payloadSha256: makerPayloadDigest(payload),
        payloadByteLength: payload.byteLength,
        ...(approvalId !== undefined && { approvalId }),
        outcome: 'sent',
        response,
      },
    }
  }

  /** Opens carry no bytes; the approval binds the empty digest (D83.3). */
  public async connect(
    connection: MakerMachineConnection,
    asker: MakerApprovalAsker,
    options: MakerSendOptions,
    signal: AbortSignal,
  ): Promise<MakerExecuteResult> {
    const payload = new Uint8Array(0)
    const verdict = await requestMakerApproval(
      this.approvals,
      asker,
      {
        target: connection.target,
        operation: 'connect',
        payload,
        warning: 'portReset',
        stateAtMint: connection.readState().fingerprint,
        ...(options.expiresAt !== undefined && { expiresAt: options.expiresAt }),
      },
      signal,
    )
    return verdict.ok
      ? await this.connectApproved(connection, verdict.approval)
      : this.refusal(connection, payload, 'connect', verdict.reason, undefined)
  }

  public async connectApproved(
    connection: MakerMachineConnection,
    approval: MakerVerifiedApproval,
  ): Promise<MakerExecuteResult> {
    const payload = new Uint8Array(0)
    if (approval.operation !== 'connect' || approval.digest !== MAKER_EMPTY_PAYLOAD_DIGEST)
      return this.refusal(connection, payload, 'connect', 'approval-rejected', approval.requestId)
    if (!isSameTarget(approval.target, connection.target))
      return this.refusal(connection, payload, 'connect', 'target-mismatch', approval.requestId)
    if (connection.readState().fingerprint !== approval.stateAtMint)
      return this.refusal(connection, payload, 'connect', 'state-changed', approval.requestId)
    const { response } = await connection.open()
    return this.sent(connection, payload, 'connect', approval.requestId, response)
  }

  /** Observe needs no approval: status reads go straight through. */
  protected async queryConnection(
    connection: MakerMachineConnection,
    text: string,
  ): Promise<MakerExecuteResult> {
    const payload = new TextEncoder().encode(text)
    const payloadClass = classifyMakerPayload(connection.target.kind, text)
    const firstRefused = payloadClass.refused[0]
    if (firstRefused !== undefined)
      return this.refusal(
        connection,
        payload,
        'observe',
        firstRefused.reason ?? 'refused-command',
        undefined,
        firstRefused.command,
      )
    if (payloadClass.class !== 'observe')
      return this.refusal(connection, payload, 'observe', 'approval-rejected', undefined)
    const { response } = await connection.send(payload)
    return this.sent(connection, payload, 'observe', undefined, response)
  }

  /** The machine's own fixed stop sequence, never approved, never asked (D83.5). */
  public async stop(connection: MakerMachineConnection): Promise<MakerStopResult> {
    const { response, warning, receipt } = await connection.stop()
    return {
      response,
      ...(warning !== undefined && { warning }),
      log: {
        atMs: this.now(),
        machine: connection.target.name,
        class: 'stop',
        payloadSha256: receipt.digest,
        payloadByteLength: receipt.byteLength,
        outcome: 'sent',
        response,
      },
    }
  }
}

type PrinterPolicy =
  | { readonly ok: true; readonly analysis: MakerAnalysis; readonly motion: MakerMotionSummary }
  | { readonly ok: false; readonly result: MakerExecuteResult }

/**
The printer executor: short approved G-code (D83.7), each send through
its own approval, against the machine's and the person's limits.
*/
export class PrinterExecutor extends MakerExecutorBase {
  private policyGate(
    connection: MakerMachineConnection,
    payload: Uint8Array,
    userLimits: MakerEnvelopeLimits | undefined,
    approvalId: string | undefined,
  ): PrinterPolicy {
    if (payload.byteLength === 0)
      return {
        ok: false,
        result: this.refusal(connection, payload, 'actuate', 'empty-payload', approvalId),
      }
    const text = Buffer.from(payload).toString('utf8')
    const payloadClass = classifyMakerPayload(connection.target.kind, text)
    const firstRefused = payloadClass.refused[0]
    if (firstRefused !== undefined)
      return {
        ok: false,
        result: this.refusal(
          connection,
          payload,
          'actuate',
          firstRefused.reason ?? 'refused-command',
          approvalId,
          firstRefused.command,
        ),
      }
    // Reads travel the query path without approval; the send path is for
    // actuations, so an approval cannot authorize this call.
    if (payloadClass.class === 'observe')
      return {
        ok: false,
        result: this.refusal(connection, payload, 'actuate', 'approval-rejected', approvalId),
      }
    const state = connection.readState()
    if (state.position === undefined)
      return {
        ok: false,
        result: this.refusal(connection, payload, 'actuate', 'unbounded-motion', approvalId),
      }
    const analysed = analyzeMakerPayload('printer', payload, state.position)
    if (!analysed.ok)
      return {
        ok: false,
        result: this.refusal(
          connection,
          payload,
          'actuate',
          'unbounded-motion',
          approvalId,
          analysed.command,
        ),
      }
    const limits = checkMakerLimits({
      analysis: analysed.analysis,
      motion: analysed.motion,
      machine: connection.readLimits(),
      ...(userLimits !== undefined && { user: userLimits }),
      homed: state.homed ?? false,
      softLimits: state.softLimits ?? false,
    })
    if (!limits.ok)
      return {
        ok: false,
        result: this.refusal(
          connection,
          payload,
          'actuate',
          limits.reason,
          approvalId,
          limits.detail,
        ),
      }
    return { ok: true, analysis: analysed.analysis, motion: analysed.motion }
  }

  public async send(
    connection: MakerMachineConnection,
    asker: MakerApprovalAsker,
    payload: Uint8Array,
    options: MakerSendOptions,
    signal: AbortSignal,
  ): Promise<MakerExecuteResult> {
    if (connection.target.kind !== 'printer')
      return this.refusal(connection, payload, 'actuate', 'target-mismatch', undefined)
    const policy = this.policyGate(connection, payload, options.userLimits, undefined)
    if (!policy.ok) return policy.result
    const verdict = await requestMakerApproval(
      this.approvals,
      asker,
      {
        target: connection.target,
        operation: 'actuate',
        payload,
        analysis: policy.analysis,
        stateAtMint: connection.readState().fingerprint,
        ...(options.expiresAt !== undefined && { expiresAt: options.expiresAt }),
      },
      signal,
    )
    return verdict.ok
      ? await this.sendApproved(connection, verdict.approval, payload, options.userLimits)
      : this.refusal(connection, payload, 'actuate', verdict.reason, undefined)
  }

  public async sendApproved(
    connection: MakerMachineConnection,
    approval: MakerVerifiedApproval,
    payload: Uint8Array,
    userLimits?: MakerEnvelopeLimits,
  ): Promise<MakerExecuteResult> {
    if (connection.target.kind !== 'printer')
      return this.refusal(connection, payload, 'actuate', 'target-mismatch', approval.requestId)
    // The person must have seen the analysis with the bytes (D83.3).
    if (approval.operation !== 'actuate' || approval.analysis === undefined)
      return this.refusal(connection, payload, 'actuate', 'approval-rejected', approval.requestId)
    const policy = this.policyGate(connection, payload, userLimits, approval.requestId)
    if (!policy.ok) return policy.result
    if (!isSameTarget(approval.target, connection.target))
      return this.refusal(connection, payload, 'actuate', 'target-mismatch', approval.requestId)
    if (makerPayloadDigest(payload) !== approval.digest)
      return this.refusal(connection, payload, 'actuate', 'approval-rejected', approval.requestId)
    if (connection.readState().fingerprint !== approval.stateAtMint)
      return this.refusal(connection, payload, 'actuate', 'state-changed', approval.requestId)
    const { response } = await connection.send(payload)
    return this.sent(connection, payload, 'actuate', approval.requestId, response)
  }

  public async query(
    connection: MakerMachineConnection,
    text: string,
  ): Promise<MakerExecuteResult> {
    return await this.queryConnection(connection, text)
  }
}

/**
The CNC executor: status, settings read, alarms and stop only. No
send exists on this class: model-proposed motion and firing are not
offered in this delivery (D83.7, Q-M103b).
*/
export class CncExecutor extends MakerExecutorBase {
  public async query(
    connection: MakerMachineConnection,
    text: string,
  ): Promise<MakerExecuteResult> {
    return connection.target.kind === 'cnc'
      ? await this.queryConnection(connection, text)
      : this.refusal(
          connection,
          new TextEncoder().encode(text),
          'observe',
          'target-mismatch',
          undefined,
        )
  }
}

export interface MakerFlashIdentity {
  readonly vidPid?: string
  readonly chip?: string
}

export interface MakerProgramOptions extends MakerSendOptions {
  /** The project's target board (D83.10); a known mismatch refuses. */
  readonly expected?: MakerFlashIdentity
}

/**
The microcontroller executor: approved opens and firmware programs,
with the flash-identity check (D83.10). Composed flashing commands
stay with M103's serial lane; this path sends finished firmware bytes,
which are data to flash, never scanned as commands.
*/
export class McuExecutor extends MakerExecutorBase {
  private policyGate(
    connection: MakerMachineConnection,
    payload: Uint8Array,
    expected: MakerFlashIdentity | undefined,
    approvalId: string | undefined,
  ): MakerExecuteResult | undefined {
    if (payload.byteLength === 0)
      return this.refusal(connection, payload, 'program', 'empty-payload', approvalId)
    // D83.10: flash the board that is meant. A known mismatch between
    // the port's identity and the project's target refuses with the
    // reason; an unreported identity fails closed the same way.
    if (expected?.vidPid !== undefined && connection.target.vidPid !== expected.vidPid)
      return this.refusal(connection, payload, 'program', 'identity-mismatch', approvalId)
    const state = connection.readState()
    if (expected?.chip !== undefined && state.board?.chip !== expected.chip)
      return this.refusal(connection, payload, 'program', 'identity-mismatch', approvalId)
    const capacity = state.flashCapacityBytes
    const detail =
      capacity === undefined
        ? 'unknown flash capacity'
        : `image: ${String(payload.byteLength)} > flash ${String(capacity)}`
    return capacity === undefined || payload.byteLength > capacity
      ? this.refusal(connection, payload, 'program', 'outside-limits', approvalId, detail)
      : undefined
  }

  public async program(
    connection: MakerMachineConnection,
    asker: MakerApprovalAsker,
    payload: Uint8Array,
    options: MakerProgramOptions,
    signal: AbortSignal,
  ): Promise<MakerExecuteResult> {
    if (connection.target.kind !== 'mcu')
      return this.refusal(connection, payload, 'program', 'target-mismatch', undefined)
    const early = this.policyGate(connection, payload, options.expected, undefined)
    if (early !== undefined) return early
    const verdict = await requestMakerApproval(
      this.approvals,
      asker,
      {
        target: connection.target,
        operation: 'program',
        payload,
        stateAtMint: connection.readState().fingerprint,
        ...(options.expiresAt !== undefined && { expiresAt: options.expiresAt }),
      },
      signal,
    )
    return verdict.ok
      ? await this.programApproved(connection, verdict.approval, payload, options.expected)
      : this.refusal(connection, payload, 'program', verdict.reason, undefined)
  }

  public async programApproved(
    connection: MakerMachineConnection,
    approval: MakerVerifiedApproval,
    payload: Uint8Array,
    expected?: MakerFlashIdentity,
  ): Promise<MakerExecuteResult> {
    if (connection.target.kind !== 'mcu')
      return this.refusal(connection, payload, 'program', 'target-mismatch', approval.requestId)
    if (approval.operation !== 'program')
      return this.refusal(connection, payload, 'program', 'approval-rejected', approval.requestId)
    const early = this.policyGate(connection, payload, expected, approval.requestId)
    if (early !== undefined) return early
    if (!isSameTarget(approval.target, connection.target))
      return this.refusal(connection, payload, 'program', 'target-mismatch', approval.requestId)
    if (makerPayloadDigest(payload) !== approval.digest)
      return this.refusal(connection, payload, 'program', 'approval-rejected', approval.requestId)
    if (connection.readState().fingerprint !== approval.stateAtMint)
      return this.refusal(connection, payload, 'program', 'state-changed', approval.requestId)
    const { response } = await connection.send(payload)
    return this.sent(connection, payload, 'program', approval.requestId, response)
  }
}
