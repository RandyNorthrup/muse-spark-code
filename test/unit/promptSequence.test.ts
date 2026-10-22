// M88 lane A: the run's pure state machine. The rig runs no turn, so the
// advance — a completed turn while idle sends the next step — is proven
// here, transition by transition; the panel tests prove the start, the
// send attempt and the refusals around it.
import { describe, expect, it } from 'vitest'
import {
  sequenceSendRefused,
  sequenceSessionSwitched,
  sequenceStepSent,
  sequenceStop,
  sequenceTurnSettled,
  startSequenceRun,
  type SequenceRunState,
} from '../../src/core/prompts/promptSequence'

const STEPS = ['First', 'Second', 'Third']

function started(): SequenceRunState {
  const { state, effect } = startSequenceRun({
    runId: 'run-1',
    sequenceId: 'seq-1',
    scope: 'user',
    name: 'Morning review',
    steps: STEPS,
    sessionId: 's1',
  })
  expect(effect).toEqual({ kind: 'sendStep', index: 0, text: 'First' })
  return state
}

describe('sequence run machine', () => {
  it('starts by sending the first step', () => {
    const state = started()
    expect(state.index).toBe(0)
  })

  it('ends instead of starting a sequence with no steps', () => {
    const { effect } = startSequenceRun({
      runId: 'run-1',
      sequenceId: 'seq-1',
      scope: 'user',
      name: 'Empty',
      steps: [],
      sessionId: 's1',
    })
    expect(effect).toEqual({ kind: 'end', reason: 'failed', isSilent: true })
  })

  it('sends each later step only after a completed turn while idle', () => {
    let state = sequenceStepSent(started())
    // A completed turn while another runs: the run waits and goes on after it.
    let next = sequenceTurnSettled(state, 'turn-1', 'completed', false)
    expect(next.effect).toEqual({ kind: 'wait' })
    next = sequenceTurnSettled(next.state, 'turn-2', 'completed', true)
    expect(next.effect).toEqual({ kind: 'sendStep', index: 1, text: 'Second' })
    state = sequenceStepSent(next.state)
    next = sequenceTurnSettled(state, 'turn-3', 'completed', true)
    expect(next.effect).toEqual({ kind: 'sendStep', index: 2, text: 'Third' })
    state = sequenceStepSent(next.state)
    next = sequenceTurnSettled(state, 'turn-4', 'completed', true)
    expect(next.effect).toEqual({ kind: 'end', reason: 'done', isSilent: false })
  })

  it('ends the run on a failed or cancelled turn, saying so', () => {
    const state = sequenceStepSent(started())
    expect(sequenceTurnSettled(state, 'turn-1', 'failed', true).effect).toEqual({
      kind: 'end',
      reason: 'failed',
      isSilent: false,
    })
    expect(sequenceTurnSettled(state, 'turn-1', 'cancelled', true).effect).toEqual({
      kind: 'end',
      reason: 'cancelled',
      isSilent: false,
    })
    // A terminal the wire adds later ends the run too, never advances it.
    expect(sequenceTurnSettled(state, 'turn-1', 'expired', true).effect).toEqual({
      kind: 'end',
      reason: 'failed',
      isSilent: false,
    })
  })

  it('drops a duplicate end for a turn it already settled', () => {
    let state = sequenceStepSent(started())
    const first = sequenceTurnSettled(state, 'turn-1', 'completed', true)
    state = sequenceStepSent(first.state)
    // The track and the local end both report turn-1: the second changes nothing.
    const duplicate = sequenceTurnSettled(state, 'turn-1', 'completed', true)
    expect(duplicate.effect).toEqual({ kind: 'wait' })
    expect(duplicate.state.index).toBe(state.index)
  })

  it('waits when the step would not go but a turn runs, and ends silent otherwise', () => {
    const state = started()
    expect(sequenceSendRefused(state, 'busy').effect).toEqual({ kind: 'wait' })
    // Idle: the send's own refusal already said why.
    expect(sequenceSendRefused(state, 'ok').effect).toEqual({
      kind: 'end',
      reason: 'failed',
      isSilent: true,
    })
    // Gone: the session switch's end speaks instead.
    expect(sequenceSendRefused(state, 'notLoaded').effect).toEqual({
      kind: 'end',
      reason: 'switched',
      isSilent: true,
    })
  })

  it('ends on Stop and on a session switch', () => {
    const state = sequenceStepSent(started())
    expect(sequenceStop(state).effect).toEqual({
      kind: 'end',
      reason: 'stopped',
      isSilent: false,
    })
    expect(sequenceSessionSwitched(state).effect).toEqual({
      kind: 'end',
      reason: 'switched',
      isSilent: false,
    })
  })
})
