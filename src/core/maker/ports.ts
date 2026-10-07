// M103 I: the one portable host seam. UI answers enter only through confirm.
import { performance } from 'node:perf_hooks'
import {
  makerApprovalAnswerSchema,
  makerApprovalRequestSchema,
  makerTargetSchema,
  type ApprovalRequest,
  type MakerMachineSummary,
  type MakerNotice,
  type MakerPreview,
  type MakerTarget,
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
export interface MakerHost<Request extends ApprovalRequest = ApprovalRequest> {
  confirm(request: Request): Promise<unknown>
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
  answer(raw: unknown): ApprovedTargetBinding | undefined {
    if (this.didAnswer) return undefined
    this.didAnswer = true
    const answer = makerApprovalAnswerSchema.safeParse(raw)
    if (
      !answer.success ||
      !this.isCurrent() ||
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
