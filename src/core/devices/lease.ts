// Durable jobs: leases, checkpoints and epochs, with no duplicate side
// effects (M110r Y3, PLAN.md D90.25, on D80.7: a timer alone never
// releases ownership). Each dispatched attempt holds a lease with an
// epoch; both sides measure it on monotonic clocks. The node stops
// itself at its lease's end; the orchestrator re-dispatches only after
// the lease plus the guard, from the last acknowledged checkpoint, under
// a new epoch, and only when everything since is fenced. Every effect
// leaving the sandbox passes an epoch gate. Durations ride the grant,
// chosen by the orchestrator that issues it: no product default stops
// work (D121). Pure.

import * as z from 'zod/mini'

const digestSchema = z.string().check(z.regex(/^[0-9a-f]{64}$/))

/** The orchestrator's grant for one dispatched attempt. */
export const leaseGrantSchema = z.strictObject({
  leaseId: z.string().check(z.minLength(1)),
  taskId: z.string().check(z.minLength(1)),
  attemptId: z.string().check(z.minLength(1)),
  epoch: z.number().check(z.int(), z.gte(0)),
  /** How long the attempt may run unrenewed, monotonic milliseconds. */
  leaseMs: z.number().check(z.int(), z.gte(1)),
  /** The quiet margin at the lease's end, monotonic milliseconds. */
  guardMs: z.number().check(z.int(), z.gte(0)),
  /** Monotonic grant time on the measurer's own clock. */
  grantedAtMono: z.number().check(z.gte(0)),
})
export type LeaseGrant = z.infer<typeof leaseGrantSchema>

/** The node's own side of a lease: run, stop at the next boundary, or stopped. */
export type NodeLeaseState = 'held' | 'fencing' | 'expired'

/**
The node's lease state at `nowMono` on its own monotonic clock: held
until the lease less the guard has passed, fencing (pause at the next
controlled boundary, start no new step) through the guard, expired after.
*/
export function nodeLeaseState(grant: LeaseGrant, nowMono: number): NodeLeaseState {
  const fenceAt = grant.grantedAtMono + Math.max(0, grant.leaseMs - grant.guardMs)
  if (nowMono < fenceAt) return 'held'
  return nowMono < grant.grantedAtMono + grant.leaseMs ? 'fencing' : 'expired'
}

/**
Whether the orchestrator may start a new attempt for `taskId` at
`nowMono` on its own monotonic clock: only once the old lease plus the
guard has expired there.
*/
export function canRedispatch(grant: LeaseGrant, nowMono: number): boolean {
  return nowMono >= grant.grantedAtMono + grant.leaseMs + grant.guardMs
}

/** What a checkpoint commit carries; both sides journal the acknowledgement. */
export const checkpointSchema = z.strictObject({
  taskId: z.string().check(z.minLength(1)),
  attemptId: z.string().check(z.minLength(1)),
  epoch: z.number().check(z.int(), z.gte(0)),
  step: z.number().check(z.int(), z.gte(0)),
  digest: digestSchema,
})
export type Checkpoint = z.infer<typeof checkpointSchema>

/** The orchestrator's acknowledgement of a checkpoint. */
export const checkpointAckSchema = z.strictObject({
  taskId: z.string().check(z.minLength(1)),
  attemptId: z.string().check(z.minLength(1)),
  epoch: z.number().check(z.int(), z.gte(0)),
  step: z.number().check(z.int(), z.gte(0)),
  digest: digestSchema,
})
export type CheckpointAck = z.infer<typeof checkpointAckSchema>

/**
Whether `ack` acknowledges `checkpoint`: same task, attempt, epoch, step
and digest. Anything else is not this checkpoint's acknowledgement.
*/
export function isAckFor(checkpoint: Checkpoint, ack: CheckpointAck): boolean {
  return (
    ack.taskId === checkpoint.taskId &&
    ack.attemptId === checkpoint.attemptId &&
    ack.epoch === checkpoint.epoch &&
    ack.step === checkpoint.step &&
    ack.digest === checkpoint.digest
  )
}

/** What an epoch gate answers: the epoch is current, or it is old and refused. */
export type EpochVerdict = 'current' | 'stale'

/**
The gate every effect leaving the sandbox passes: an old epoch is
refused; the current epoch (or a newer one, which intake learns first)
passes. Pure, so every gate (merge, push, broker, relay, paid admission,
result intake) runs the same check.
*/
export function checkEpoch(currentEpoch: number, presentedEpoch: number): EpochVerdict {
  return presentedEpoch < currentEpoch ? 'stale' : 'current'
}

/**
Split node candidates into those the current epoch admits and those it
refuses. The orchestrator runs this before merge-queue admission (and
every other gate): stale attempts never enter, and their queued results
stay a quarantined branch for the person to read, never landed.
*/
export function splitByEpoch<T extends { readonly id: string; readonly epoch: number }>(
  candidates: readonly T[],
  currentEpoch: number,
): { readonly current: readonly T[]; readonly stale: readonly T[] } {
  const current: T[] = []
  const stale: T[] = []
  for (const candidate of candidates) {
    if (checkEpoch(currentEpoch, candidate.epoch) === 'stale') stale.push(candidate)
    else current.push(candidate)
  }
  return { current, stale }
}

/** What the re-dispatch decision answers. */
export type RedispatchVerdict = 'ready' | 'wait' | 'uncertain-needs-person'

/**
Whether the orchestrator starts a new attempt now: `ready` only when the
old lease plus guard expired on its clock and everything the old attempt
could have done since the last acknowledged checkpoint is fenced;
`wait` while the lease still guards; `uncertain-needs-person` when the
old attempt is uncertain (D80.7: direct sandbox egress past git and the
registries, or an unprovable shutdown) — no automatic re-dispatch, the
row says why and the person decides.
*/
export function redispatchVerdict(options: {
  readonly leaseExpired: boolean
  readonly fencedSinceCheckpoint: boolean
  readonly uncertain: boolean
}): RedispatchVerdict {
  if (options.uncertain) return 'uncertain-needs-person'
  return !options.leaseExpired || !options.fencedSinceCheckpoint ? 'wait' : 'ready'
}
