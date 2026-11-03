import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { GOAL_STATUS } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'
import { conversationPanel, modelApiRig } from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

const FAILED_AT = Date.UTC(2026, 10, 1, 12, 0, 30)

function limitedState(): UiState {
  return {
    ...initialUiState,
    sessionId: 'session-1',
    auth: { ...initialUiState.auth, status: 'signedIn', backend: 'museCode' },
    goal: { objective: 'Ship it', status: GOAL_STATUS.usageLimited, percentComplete: 40 },
  }
}

function failedTurn(
  state: UiState,
  event: Extract<AgentEvent, { type: 'turnCompleted' }>,
): UiState {
  const message: HostToWebviewMessage = { type: 'agentEvent', event }
  return uiReducer(state, { type: 'hostMessage', message, at: FAILED_AT })
}

function plainFailure(): Extract<AgentEvent, { type: 'turnCompleted' }> {
  return { type: 'turnCompleted', turnId: 't1', terminal: 'failed', retryable: false }
}

function usageAnswer(
  state: UiState,
  turnId: string,
  usage: { usedPercent: number; resetsAtMs: number } | undefined,
): UiState {
  const message: HostToWebviewMessage = {
    type: 'resumeUsage',
    turnId,
    ...(usage !== undefined && {
      usage: {
        observedAtMs: FAILED_AT + 1000,
        tier: 'pro',
        window: {
          usedPercent: usage.usedPercent,
          resetsAtMs: usage.resetsAtMs,
          windowDurationMins: 300,
        },
        weekly: { usedPercent: 10, resetsAtMs: FAILED_AT + 604_800_000 },
      },
    }),
  }
  return uiReducer(state, { type: 'hostMessage', message, at: FAILED_AT + 2000 })
}

function errorEntry(state: UiState) {
  const entry = state.transcript.find((item) => item.id === 'error:t1')
  if (entry?.kind !== 'error') throw new Error('no error entry in the transcript')
  return entry
}

// M88 lane C (PLAN.md D67, item 16): a failed Muse Code turn at a
// usage-limited goal, with no typed offer, reads the usage for a
// report-based offer. Any other failure stays ordinary, even at 100%.

describe('usage resume trigger', () => {
  it('pends a failed turn with no typed offer at a limited goal', () => {
    const state = failedTurn(limitedState(), plainFailure())
    expect(state.usageResume).toEqual({ t1: 'pending' })
    expect(errorEntry(state).resume).toBeUndefined()
  })

  it('stays ordinary without the signal', () => {
    const activeGoal: UiState = {
      ...limitedState(),
      goal: { objective: 'Ship it', status: GOAL_STATUS.active, percentComplete: 40 },
    }
    expect(failedTurn(activeGoal, plainFailure()).usageResume).toEqual({})
    const modelApi: UiState = {
      ...limitedState(),
      auth: { ...limitedState().auth, backend: 'modelApi' },
    }
    expect(failedTurn(modelApi, plainFailure()).usageResume).toEqual({})
    const succeeded = failedTurn(limitedState(), {
      type: 'turnCompleted',
      turnId: 't1',
      terminal: 'completed',
    })
    expect(succeeded.usageResume).toEqual({})
  })

  it('leaves a typed offer alone', () => {
    const state = failedTurn(limitedState(), {
      type: 'turnCompleted',
      turnId: 't1',
      terminal: 'failed',
      quota: { limitKind: 'tierLimit', resetsAtMs: Date.UTC(2026, 10, 1, 19, 42, 18) },
    })
    expect(errorEntry(state).resume?.kind).toBe('quota')
    expect(state.usageResume).toEqual({})
  })

  it('pends the latest failure when the goal flips after it', () => {
    const activeGoal: UiState = {
      ...limitedState(),
      goal: { objective: 'Ship it', status: GOAL_STATUS.active, percentComplete: 40 },
    }
    const failed = failedTurn(activeGoal, plainFailure())
    expect(failed.usageResume).toEqual({})
    const flipped = uiReducer(failed, {
      type: 'hostMessage',
      message: {
        type: 'agentEvent',
        event: {
          type: 'goalChanged',
          goal: { objective: 'Ship it', status: GOAL_STATUS.usageLimited, percentComplete: 40 },
        },
      },
      at: FAILED_AT + 1000,
    })
    expect(flipped.usageResume).toEqual({ t1: 'pending' })
  })

  it('ignores a flip with no offer-less failure behind it', () => {
    const failed = failedTurn(limitedState(), plainFailure())
    const requested = uiReducer(failed, { type: 'usageResumeSent', turnId: 't1' })
    const answered = usageAnswer(requested, 't1', {
      usedPercent: 100,
      resetsAtMs: Date.UTC(2026, 10, 1, 13, 0),
    })
    expect(errorEntry(answered).resume?.kind).toBe('usage')
    // A reaffirmed flip does not reopen the answered turn.
    const flipped = uiReducer(answered, {
      type: 'hostMessage',
      message: {
        type: 'agentEvent',
        event: {
          type: 'goalChanged',
          goal: { objective: 'Ship it', status: GOAL_STATUS.usageLimited, percentComplete: 41 },
        },
      },
      at: FAILED_AT + 3000,
    })
    expect(flipped.usageResume).toEqual({})
  })
})

function requestedTurn(): UiState {
  const failed = failedTurn(limitedState(), plainFailure())
  return uiReducer(failed, { type: 'usageResumeSent', turnId: 't1' })
}

describe('usage resume answer', () => {
  it('marks the request sent exactly once', () => {
    const failed = failedTurn(limitedState(), plainFailure())
    const sent = uiReducer(failed, { type: 'usageResumeSent', turnId: 't1' })
    expect(sent.usageResume).toEqual({ t1: 'requested' })
    expect(uiReducer(sent, { type: 'usageResumeSent', turnId: 't1' })).toBe(sent)
    expect(uiReducer(sent, { type: 'usageResumeSent', turnId: 't9' })).toBe(sent)
  })

  it('offers a full window at its reset minute', () => {
    const answered = usageAnswer(requestedTurn(), 't1', {
      usedPercent: 100,
      resetsAtMs: Date.UTC(2026, 10, 1, 12, 42, 18),
    })
    expect(errorEntry(answered).resume).toEqual({
      kind: 'usage',
      turnId: 't1',
      defaultAtMs: Date.UTC(2026, 10, 1, 12, 43),
    })
    expect(answered.usageResume).toEqual({})
  })

  it('says when a far lift resets instead of a timer', () => {
    const resetsAtMs = FAILED_AT + 7 * 24 * 60 * 60 * 1000
    const answered = usageAnswer(requestedTurn(), 't1', {
      usedPercent: 142,
      resetsAtMs,
    })
    expect(errorEntry(answered).resume).toEqual({
      kind: 'usage',
      turnId: 't1',
      liftsAtMs: resetsAtMs,
    })
  })

  it('leaves the row ordinary below a full window', () => {
    const answered = usageAnswer(requestedTurn(), 't1', {
      usedPercent: 99,
      resetsAtMs: Date.UTC(2026, 10, 1, 13, 0),
    })
    expect(errorEntry(answered).resume).toBeUndefined()
    expect(answered.usageResume).toEqual({})
    const unread = usageAnswer(requestedTurn(), 't1', undefined)
    expect(errorEntry(unread).resume).toBeUndefined()
    expect(unread.usageResume).toEqual({})
  })

  it('leaves the row ordinary on an unusable reset', () => {
    const answered = usageAnswer(requestedTurn(), 't1', {
      usedPercent: 100,
      resetsAtMs: -1,
    })
    expect(errorEntry(answered).resume).toBeUndefined()
    expect(answered.usageResume).toEqual({})
  })

  it('ignores an answer nobody waits for', () => {
    const failed = failedTurn(limitedState(), plainFailure())
    expect(usageAnswer(failed, 't9', { usedPercent: 100, resetsAtMs: FAILED_AT + 1000 })).toBe(
      failed,
    )
  })
})

describe('usage resume host gate', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'resume-usage-gate-'))
  })

  afterEach(async () => {
    await removeFolder(directory)
  })

  it('answers without usage off Muse Code, ending the wait', async () => {
    const panel = conversationPanel({ rig: modelApiRig(directory), directory })
    await panel.controller.handle({ type: 'usageForResume', turnId: 't1' })
    const answers = panel.posted.filter((message) => message.type === 'resumeUsage')
    expect(answers).toHaveLength(1)
    const [answer] = answers
    expect(answer).toEqual({ type: 'resumeUsage', turnId: 't1' })
  })
})
