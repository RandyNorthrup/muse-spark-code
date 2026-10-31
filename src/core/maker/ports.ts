// M103 I: the one portable host seam. UI answers enter only through confirm.
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { MAKER_PROTOCOL_VERSION, MACHINE_APPROVAL_TTL_MS, UI_TEXT } from '../../shared/constants'
import type { ActionClass } from './guard/actionClass'
import {
  makerApprovalAnswerSchema,
  makerApprovalRequestSchema,
  makerTargetSchema,
  makerSurfaceMessageSchema,
  type ApprovalRequest,
  type MakerMachineSummary,
  type MakerNotice,
  type MakerPreview,
  type MakerTarget,
  type MakerHostMessage,
} from '../../shared/makerProtocol'
import type { SerialIdentity } from './serial/identity'
import type { SerialProcess } from './serial/process'

export type {
  ApprovalRequest,
  SerialApprovalRequest,
  MachineApprovalRequest,
} from '../../shared/makerProtocol'

export interface MakerSecrets {
  get(name: string): Promise<string | undefined>
  store(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}
export interface MakerStorage {
  /** Canonical host-owned directory outside the repository. */
  readonly directory: string
  get(key: string): Promise<unknown>
  update(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}
export interface MakerSerialSettings {
  readonly operation: 'read' | 'write'
  readonly identity: SerialIdentity
  readonly baud: number
  readonly durationMs: number
  readonly dtr: boolean
  readonly rts: boolean
  readonly payloadHex: string
}
/** Prepare after all adapter awaits; invoke the returned guard synchronously at spawn. */
export type MakerStartGuard = () => Promise<() => void>
export interface MakerSerialProvider {
  /** Existing displayed text only; never an implicit device open. */
  context(signal: AbortSignal): Promise<{ readonly text: string; readonly connected: boolean }>
  open(
    input: MakerSerialSettings,
    maxBytes: number,
    signal: AbortSignal,
    start: MakerStartGuard,
  ): Promise<SerialProcess>
  /** A release settles only after the port and its runtime lease are closed. */
  release(): Promise<void>
}
/** Approval-panel makerReady replays current admission/preview and pending requests via reopen.
Browser state never supplies payloads or review readiness after document reload.
*/
export interface MakerHost<Request extends ApprovalRequest = ApprovalRequest> {
  /** Only completed approval review may call review; a preview receipt is not authority. */
  confirm(request: Request, didReview: (raw: unknown) => boolean): Promise<unknown>
  notify(notice: MakerNotice): void | Promise<void>
  /** Install/remove independent Stop controls; each invokes the engine's ungated stop path. */
  stopControls(machines: readonly MakerMachineSummary[]): void | Promise<void>
  openPreview(preview: MakerPreview): Promise<void>
  readonly storage: { readonly workspace: MakerStorage; readonly machine: MakerStorage }
  readonly secrets: MakerSecrets
  isTrusted(): boolean
  hardwareEnabled(): boolean
  /** Eligible interactive top-level action; false in Plan and every unattended/worker context. */
  isInteractive(): boolean
  readonly serialProvider?: MakerSerialProvider
}

/** Kept inside the engine/adapter, never serialized to a model or surface. */
export interface ApprovedTargetBinding {
  readonly requestId: string
  readonly digest: string
  readonly target: MakerTarget
  readonly expiresAt: number
}

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}
export function isSameMakerTarget(left: MakerTarget, right: MakerTarget): boolean {
  if (left.kind === 'serial' && right.kind === 'serial')
    return (
      left.port === right.port &&
      left.vid === right.vid &&
      left.pid === right.pid &&
      left.serialNumber === right.serialNumber &&
      left.stablePath === right.stablePath
    )
  return left.kind === 'machine' && right.kind === 'machine'
    ? left.registrationId === right.registrationId &&
        left.id === right.id &&
        left.name === right.name &&
        left.endpoint === right.endpoint &&
        left.identity === right.identity
    : left.kind === 'workspace' && right.kind === 'workspace' && left.workspace === right.workspace
}

/** One local approval lifetime; answers cannot widen, extend or replay it. */
export class MakerApproval<Request extends ApprovalRequest = ApprovalRequest> {
  private readonly started = performance.now()
  private readonly lifetime: number
  private readonly wasAdmitted: boolean
  private didAnswer = false
  private didConsume = false
  private didStart = false
  private binding: ApprovedTargetBinding | undefined
  private reviewedDigest: string | undefined
  readonly request: Request

  constructor(
    request: Request,
    private readonly isAdmitted: () => boolean,
    private readonly now: () => number = Date.now,
  ) {
    makerApprovalRequestSchema.parse(request)
    this.request = structuredClone(request)
    freeze(this.request)
    this.lifetime = this.request.expiresAt - this.now()
    this.wasAdmitted = this.isAdmitted()
  }
  private isCurrent(): boolean {
    return (
      this.wasAdmitted &&
      this.isAdmitted() &&
      this.now() < this.request.expiresAt &&
      performance.now() - this.started < this.lifetime
    )
  }
  private payloadDigest(): string {
    const payload =
      this.request.kind === 'serial' ? this.request.payload.value : this.request.payload
    const bytes =
      this.request.kind === 'serial' && this.request.payload.encoding === 'hex'
        ? Buffer.from(payload, 'hex')
        : Buffer.from(payload, 'utf8')
    return createHash('sha256').update(bytes).digest('hex')
  }
  /** Host replay revokes the old document's review and keeps the exact frozen request. */
  reopen(raw: unknown): Extract<MakerHostMessage, { type: 'makerApproval' }> | undefined {
    const message = makerSurfaceMessageSchema.safeParse(raw)
    if (!message.success || message.data.type !== 'makerReady') return undefined
    this.reviewedDigest = undefined
    return this.didAnswer || !this.isCurrent() || this.request.digest !== this.payloadDigest()
      ? undefined
      : { v: MAKER_PROTOCOL_VERSION, type: 'makerApproval', request: this.request }
  }
  /** Host-owned state: native/read-only first paint cannot advance this review. */
  review(raw: unknown): boolean {
    this.reviewedDigest = undefined
    const message = makerSurfaceMessageSchema.safeParse(raw)
    if (
      !message.success ||
      message.data.type !== 'makerPayloadReviewed' ||
      message.data.id !== this.request.id ||
      !message.data.isComplete ||
      this.didAnswer ||
      !this.isCurrent() ||
      message.data.digest !== this.request.digest ||
      message.data.digest !== this.payloadDigest()
    )
      return false
    this.reviewedDigest = message.data.digest
    return true
  }
  answer(raw: unknown): ApprovedTargetBinding | undefined {
    if (this.didAnswer) return undefined
    this.didAnswer = true
    const answer = makerApprovalAnswerSchema.safeParse(raw)
    if (
      !answer.success ||
      !this.isCurrent() ||
      this.reviewedDigest !== this.payloadDigest() ||
      answer.data.decision !== 'allow_once' ||
      answer.data.id !== this.request.id ||
      answer.data.digest !== this.request.digest ||
      !isSameMakerTarget(answer.data.target, this.request.target)
    )
      return undefined
    this.binding = Object.freeze({
      requestId: this.request.id,
      digest: this.request.digest,
      target: this.request.target,
      expiresAt: this.request.expiresAt,
    })
    return this.binding
  }
  /** Adapter calls at the final spawn/write, after re-reading the live identity. */
  consume(binding: ApprovedTargetBinding, liveTarget: unknown): boolean {
    if (this.didConsume) return false
    this.didConsume = true
    const live = makerTargetSchema.safeParse(liveTarget)
    this.didStart =
      this.binding === binding &&
      this.isCurrent() &&
      this.reviewedDigest === this.payloadDigest() &&
      live.success &&
      isSameMakerTarget(live.data, binding.target)
    return this.didStart
  }
  start(liveTarget: unknown): boolean {
    return this.binding !== undefined && this.consume(this.binding, liveTarget)
  }
  get hasStarted(): boolean {
    return this.didStart
  }
}

/** M103-G's always-on guard approval, beside the protocol approval above. */
export interface TargetIdentity {
  readonly address: string
  readonly vidPid?: string
  readonly usbSerial?: string
  /** Local device-node generation, not a claimed USB serial or a wire field. */
  readonly connectionId?: string
}

export interface HardwareApprovalRequest {
  readonly id: string
  readonly digest: string
  readonly target: TargetIdentity
  readonly targets: readonly TargetIdentity[]
  readonly expiresAt: number
  readonly action: ActionClass
  readonly payload: string
}

const hardwareAnswerSchema = z.object({
  id: z.string(),
  digest: z.string(),
  decision: z.enum(['sendOnce', 'reject']),
})

/** One engine-minted request, settled only by the injected host UI. */
export class HardwareApproval {
  private isSettled = false
  public readonly request: HardwareApprovalRequest

  public constructor(
    id: string,
    payload: string,
    target: TargetIdentity | readonly TargetIdentity[],
    action: ActionClass,
    now: number,
    parsedCommand?: string,
  ) {
    const targets = ('address' in target ? [target] : target).map((identity) =>
      Object.freeze({ ...identity }),
    )
    const first = targets[0]
    if (first === undefined) throw new Error(UI_TEXT.hardwareRefused)
    this.request = Object.freeze({
      id,
      digest: createHash('sha256')
        .update(parsedCommand === undefined ? payload : JSON.stringify({ payload, parsedCommand }))
        .digest('hex'),
      target: first,
      targets: Object.freeze(targets),
      expiresAt: now + MACHINE_APPROVAL_TTL_MS,
      action,
      payload,
    })
  }

  /** Wrong, late, replayed or changed-target answers cannot widen this request. */
  public accept(
    answer: unknown,
    target: TargetIdentity | readonly TargetIdentity[],
    now: number,
  ): boolean {
    if (this.isSettled) return false
    this.isSettled = true
    const parsed = hardwareAnswerSchema.safeParse(answer)
    const targets = 'address' in target ? [target] : target
    return (
      parsed.success &&
      parsed.data.id === this.request.id &&
      parsed.data.digest === this.request.digest &&
      parsed.data.decision === 'sendOnce' &&
      now < this.request.expiresAt &&
      targets.length === this.request.targets.length &&
      targets.every(
        (identity, index) =>
          identity.address === this.request.targets[index]?.address &&
          identity.vidPid === this.request.targets[index].vidPid &&
          identity.usbSerial === this.request.targets[index].usbSerial &&
          identity.connectionId === this.request.targets[index].connectionId,
      )
    )
  }
}
