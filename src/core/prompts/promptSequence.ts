// M88, lane A: a prompt sequence run's pure state machine. Start, step
// sent, turn settled, stop, and end on any terminal other than completed
// (PLAN.md D67). It decides; the runner reads the conversation's idleness
// and sends. Nothing here touches the host, the clock or the wire.
import type { SequenceEndReason, SequenceScope } from '../../shared/sequences'

/** A run in flight: the sequence, the conversation, and the next step. */
export interface SequenceRunState {
  readonly runId: string
  readonly sequenceId: string
  readonly scope: SequenceScope
  readonly name: string
  readonly steps: readonly string[]
  readonly sessionId: string
  /** Steps sent so far; the next step's index. */
  readonly index: number
  /** Turn ids already settled under this run: a duplicate end is dropped. */
  readonly settledTurnIds: readonly string[]
}

export type SequenceRunEffect =
  /** Send this step now; the send's own outcome comes back next. */
  | { readonly kind: 'sendStep'; readonly index: number; readonly text: string }
  /** The run is over; silent ends post state but no notice. */
  | {
      readonly kind: 'end'
      readonly reason: SequenceEndReason | 'done'
      readonly isSilent: boolean
    }
  /** Nothing to do: the run waits for the next end. */
  | { readonly kind: 'wait' }

/** A transition's outcome: the run's next state and what the runner does now. */
interface SequenceStep {
  readonly state: SequenceRunState
  readonly effect: SequenceRunEffect
}

/** Start a run: the first step goes at once. */
export function startSequenceRun(input: {
  readonly runId: string
  readonly sequenceId: string
  readonly scope: SequenceScope
  readonly name: string
  readonly steps: readonly string[]
  readonly sessionId: string
}): SequenceStep {
  const state: SequenceRunState = { ...input, index: 0, settledTurnIds: [] }
  const first = input.steps[0]
  const effect: SequenceRunEffect =
    first === undefined
      ? { kind: 'end', reason: 'failed', isSilent: true }
      : { kind: 'sendStep', index: 0, text: first }
  return { state, effect }
}

/** The step went out: the run waits for its turn's end. */
export function sequenceStepSent(state: SequenceRunState): SequenceRunState {
  return { ...state, index: state.index + 1 }
}

/**
A turn's end under a run. A duplicate end changes nothing; any terminal
but `completed` ends the run; a completed turn while the conversation is
idle sends the next step, or finishes the run past the last one. While
another turn runs, the run waits for the next end and goes on after it.
*/
export function sequenceTurnSettled(
  state: SequenceRunState,
  turnId: string,
  terminal: string,
  isIdle: boolean,
): SequenceStep {
  if (state.settledTurnIds.includes(turnId)) {
    return { state, effect: { kind: 'wait' } }
  }
  const settled: SequenceRunState = {
    ...state,
    settledTurnIds: [...state.settledTurnIds, turnId],
  }
  switch (true) {
    case terminal === 'cancelled': {
      return { state: settled, effect: { kind: 'end', reason: 'cancelled', isSilent: false } }
    }
    case terminal !== 'completed': {
      return { state: settled, effect: { kind: 'end', reason: 'failed', isSilent: false } }
    }
    case !isIdle: {
      return { state: settled, effect: { kind: 'wait' } }
    }
    default: {
      const next = settled.steps[settled.index]
      const effect: SequenceRunEffect =
        next === undefined
          ? { kind: 'end', reason: 'done', isSilent: false }
          : { kind: 'sendStep', index: settled.index, text: next }
      return { state: settled, effect }
    }
  }
}

/**
The step would not go; the runner re-read the conversation first. While
another turn runs, the run waits for its end; idle, the send's own
refusal already said why, so the run ends without another notice; with
the session gone, the session switch's end speaks instead.
*/
export function sequenceSendRefused(
  state: SequenceRunState,
  recheck: 'ok' | 'busy' | 'notLoaded',
): SequenceStep {
  switch (recheck) {
    case 'busy': {
      return { state, effect: { kind: 'wait' } }
    }
    case 'notLoaded': {
      return { state, effect: { kind: 'end', reason: 'switched', isSilent: true } }
    }
    default: {
      return { state, effect: { kind: 'end', reason: 'failed', isSilent: true } }
    }
  }
}

/** Stop ends the run after the steps sent; the running turn is the person's to stop. */
export function sequenceStop(state: SequenceRunState): {
  readonly state: SequenceRunState
  readonly effect: SequenceRunEffect
} {
  return { state, effect: { kind: 'end', reason: 'stopped', isSilent: false } }
}

/** The conversation changed under the run: no more steps go to it. */
export function sequenceSessionSwitched(state: SequenceRunState): {
  readonly state: SequenceRunState
  readonly effect: SequenceRunEffect
} {
  return { state, effect: { kind: 'end', reason: 'switched', isSilent: false } }
}
