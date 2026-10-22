// Idempotency keys on every step (M110r Y3, PLAN.md D90.25). Each step (a
// tool call, a check run, a checkpoint, a result upload, a merge
// admission, a brokered use, a relayed request) carries a key: pair,
// task, attempt, epoch, step number and the digest of its input. Whoever
// performs a step keeps a table of keys and outcomes; a repeat gets the
// recorded outcome and is never performed twice. Entries drop when their
// checkpoint is acknowledged, so the table holds only the unacknowledged
// tail. Pure.

import { createHash } from 'node:crypto'
import { canonicalJson } from '../../shared/canonicalJson'

/** What identifies one performed step. */
export interface StepIdentity {
  readonly pair: string
  readonly task: string
  readonly attempt: string
  readonly epoch: number
  readonly step: number
}

/** The hex digest of a step's input, through the canonical form. */
export function inputDigest(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input, 'step input'), 'utf8').digest('hex')
}

/** The step's key: pair, task, attempt, epoch, step number, input digest. */
export function stepKey(identity: StepIdentity, input: unknown): string {
  return [
    identity.pair,
    identity.task,
    identity.attempt,
    String(identity.epoch),
    String(identity.step),
    inputDigest(input),
  ].join('/')
}

/**
The recorded outcome of a performed step: whoever repeats the step gets
this back instead of performing it again.
*/
export interface StepOutcome {
  readonly key: string
  readonly task: string
  readonly step: number
  readonly outcome: string
}

/**
A performer's table of keys and outcomes. `pruneAcknowledged` drops a
task's entries at and below its last acknowledged checkpoint step.
*/
export class OutcomeTable {
  private readonly outcomes = new Map<string, StepOutcome>()

  /** Record a performed step's outcome; a repeat keeps the first record. */
  record(outcome: StepOutcome): void {
    if (!this.outcomes.has(outcome.key)) this.outcomes.set(outcome.key, outcome)
  }

  /** The recorded outcome for `key`, or undefined when never performed. */
  lookup(key: string): StepOutcome | undefined {
    return this.outcomes.get(key)
  }

  /** Drop `task`'s entries at and below its acknowledged checkpoint step. */
  pruneAcknowledged(task: string, throughStep: number): void {
    for (const [key, outcome] of this.outcomes) {
      if (outcome.task === task && outcome.step <= throughStep) this.outcomes.delete(key)
    }
  }

  size(): number {
    return this.outcomes.size
  }
}
