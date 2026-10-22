// The node's local result queue (M110r Y3, PLAN.md D90.25). While
// unreachable, the node keeps working where it is safe and queues its
// results and checkpoints until each is acknowledged; after reconnecting
// it re-sends them with their keys. Intake runs the epoch gate: results
// from an old epoch are kept as a quarantined branch for the person to
// read, never landed. Serializable, so the node's store persists it. Pure.

import * as z from 'zod/mini'
import { checkEpoch } from './lease'

/** One queued checkpoint or result, with the key it re-sends under. */
export const queuedResultSchema = z.strictObject({
  id: z.string().check(z.minLength(1)),
  taskId: z.string().check(z.minLength(1)),
  attemptId: z.string().check(z.minLength(1)),
  epoch: z.number().check(z.int(), z.gte(0)),
  kind: z.enum(['checkpoint', 'result']),
  stepKey: z.string().check(z.minLength(1)),
  body: z.unknown(),
  enqueuedAtWall: z.number().check(z.gte(0)),
})
export type QueuedResult = z.infer<typeof queuedResultSchema>

const queuedResultListSchema = z.strictObject({ queued: z.array(queuedResultSchema) })

/** What result intake answers for one queued item. */
export type IntakeVerdict =
  | { readonly status: 'accepted' }
  | { readonly status: 'quarantined'; readonly reason: 'stale-epoch' }

/**
Run intake on one queued item against the task's current epoch: current
epochs land; old epochs are quarantined for the person to read, never
landed.
*/
export function intakeResult(currentEpoch: number, item: QueuedResult): IntakeVerdict {
  return checkEpoch(currentEpoch, item.epoch) === 'stale'
    ? { status: 'quarantined', reason: 'stale-epoch' }
    : { status: 'accepted' }
}

/**
The node's outbox: FIFO, acknowledgement by id, re-send of whatever is
still queued. Order is arrival order; resends keep it.
*/
export class ResultQueue {
  private readonly queued: QueuedResult[] = []

  /** Queue a checkpoint or result for acknowledged delivery. */
  enqueue(item: QueuedResult): void {
    this.queued.push(queuedResultSchema.parse(item))
  }

  /** Acknowledge a delivered item by id; unknown ids change nothing. */
  acknowledge(id: string): void {
    const index = this.queued.findIndex((item) => item.id === id)
    if (index !== -1) this.queued.splice(index, 1)
  }

  /** Everything still unacknowledged, in arrival order, for re-send. */
  pending(): readonly QueuedResult[] {
    return [...this.queued]
  }

  pendingCount(): number {
    return this.queued.length
  }

  /** Serialize for the node's store; validated on load. */
  dump(): string {
    return JSON.stringify({ queued: this.queued })
  }

  /** Load a dumped queue; a corrupt dump throws and the queue is unchanged. */
  load(dumped: string): void {
    const parsed = queuedResultListSchema.parse(JSON.parse(dumped) as unknown)
    this.queued.length = 0
    this.queued.push(...parsed.queued)
  }
}
