// M103-G's frozen subset of lane I: no editor imports or model-visible grants.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { MACHINE_APPROVAL_TTL_MS } from '../../shared/constants'
import type { ActionClass } from './guard/actionClass'

/** A host-observed identity; an unknown USB identity must be shown as unknown. */
export interface TargetIdentity {
  readonly address: string
  readonly vidPid?: string
  readonly usbSerial?: string
}

export interface ApprovalRequest {
  readonly id: string
  readonly digest: string
  readonly target: TargetIdentity
  readonly expiresAt: number
  readonly action: ActionClass
  readonly payload: string
}

const answerSchema = z.object({
  id: z.string(),
  digest: z.string(),
  decision: z.enum(['sendOnce', 'reject']),
})

/** One engine-minted request, settled only by the injected host UI. */
export class HardwareApproval {
  private isSettled = false
  public readonly request: ApprovalRequest

  public constructor(
    id: string,
    payload: string,
    target: TargetIdentity,
    action: ActionClass,
    now: number,
  ) {
    this.request = Object.freeze({
      id,
      digest: createHash('sha256').update(payload).digest('hex'),
      target: Object.freeze({ ...target }),
      expiresAt: now + MACHINE_APPROVAL_TTL_MS,
      action,
      payload,
    })
  }

  /** Wrong, late, replayed or changed-target answers cannot widen this request. */
  public accept(answer: unknown, target: TargetIdentity, now: number): boolean {
    if (this.isSettled) return false
    this.isSettled = true
    const parsed = answerSchema.safeParse(answer)
    return (
      parsed.success &&
      parsed.data.id === this.request.id &&
      parsed.data.digest === this.request.digest &&
      parsed.data.decision === 'sendOnce' &&
      now < this.request.expiresAt &&
      target.address === this.request.target.address &&
      target.vidPid === this.request.target.vidPid &&
      target.usbSerial === this.request.target.usbSerial
    )
  }
}
