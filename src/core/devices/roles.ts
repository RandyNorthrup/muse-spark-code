// The worker's intake (M110a R1, PLAN.md D90.2): what an orchestrator sends
// arrives as M96 tasks through M100's lanes E, S and G; this is the port
// R1 needs and the admission the node runs before any task state is
// touched. The frame (pair, task, attempt, epoch) is this file's
// contract; the body's payload is M100-E's and stays opaque here. Only
// pairs the node's pairing store names are served — unknown callers are
// refused before anything else (a revoked node that comes back is told
// only "not paired", D90.9) — and Y3's epoch gate refuses stale epochs
// at intake, so a result that lands after a re-dispatch never starts.
// The runtime dispatcher and the durable pair store land with M100's
// lanes E, S, G and P; until then the ephemeral directory below serves
// tests and local use only.

import * as z from 'zod/mini'
import { checkEpoch } from './lease'

/** The frame around every task an orchestrator sends; the body is M100-E's. */
export const workerTaskFrameSchema = z.strictObject({
  pairId: z.string().check(z.minLength(1)),
  taskId: z.string().check(z.minLength(1)),
  attemptId: z.string().check(z.minLength(1)),
  epoch: z.number().check(z.int(), z.gte(0)),
  body: z.unknown(),
})
export type WorkerTaskFrame = z.infer<typeof workerTaskFrameSchema>

/** An admitted task: the runtime's dispatcher feeds the ticket onward. */
export interface WorkerTicket {
  readonly pairId: string
  readonly taskId: string
  readonly attemptId: string
  readonly epoch: number
}

/** The pairing store's cached pair set, as intake reads it. */
export interface PairDirectory {
  isPaired(pairId: string): boolean
}

/** The pair set with removal, as unpair writes it. Durable on return. */
export interface PairStore extends PairDirectory {
  delete(pairId: string): boolean
}

/** What intake answers: the ticket, or why the frame is refused. */
export type IntakeVerdict =
  | { readonly admitted: true; readonly ticket: WorkerTicket }
  | {
      readonly admitted: false
      readonly reason: 'bad-frame' | 'unknown-pair' | 'stale-epoch'
      /** Technical detail; bad frames carry none (never echo remote bytes). */
      readonly detail?: string
    }

/**
Admit one frame: it must parse, name a paired pair, and carry a current
epoch. Anything else is refused before any task state is touched.
*/
export function admitTask(
  raw: unknown,
  directory: PairDirectory,
  currentEpoch: number,
): IntakeVerdict {
  const parsed = workerTaskFrameSchema.safeParse(raw)
  if (!parsed.success) return { admitted: false, reason: 'bad-frame' }
  const frame = parsed.data
  if (!directory.isPaired(frame.pairId))
    return { admitted: false, reason: 'unknown-pair', detail: frame.pairId }
  if (checkEpoch(currentEpoch, frame.epoch) === 'stale')
    return {
      admitted: false,
      reason: 'stale-epoch',
      detail: `${frame.taskId} epoch ${String(frame.epoch)}, current ${String(currentEpoch)}`,
    }
  return {
    admitted: true,
    ticket: {
      pairId: frame.pairId,
      taskId: frame.taskId,
      attemptId: frame.attemptId,
      epoch: frame.epoch,
    },
  }
}

/**
A non-durable pair set: tests and local use. The durable pair records
are X2's (M110d); nothing here persists.
*/
export class EphemeralPairDirectory implements PairStore {
  private readonly pairs = new Set<string>()

  add(pairId: string): void {
    this.pairs.add(pairId)
  }

  delete(pairId: string): boolean {
    return this.pairs.delete(pairId)
  }

  isPaired(pairId: string): boolean {
    return this.pairs.has(pairId)
  }
}
