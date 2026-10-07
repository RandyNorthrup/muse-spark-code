// M103-G's frozen subset of lane I: no editor imports or model-visible grants.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { MACHINE_APPROVAL_TTL_MS, UI_TEXT } from '../../shared/constants'
import type { ActionClass } from './guard/actionClass'

/** A host-observed identity; an unknown USB identity must be shown as unknown. */
export interface TargetIdentity {
  readonly address: string
  readonly vidPid?: string
  readonly usbSerial?: string
  /** Local device-node generation, not a claimed USB serial or a wire field. */
  readonly connectionId?: string
}

export interface ApprovalRequest {
  readonly id: string
  readonly digest: string
  readonly target: TargetIdentity
  readonly targets: readonly TargetIdentity[]
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
    const parsed = answerSchema.safeParse(answer)
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
