import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { transcriptEntrySchema } from '../../src/webview/state/transcriptEntries'
import {
  hasPendingRequest,
  initialUiState,
  questionsInOrder,
  uiReducer,
  type UiState,
} from '../../src/webview/state/uiState'
import { questionFixture } from './helpers/questions/fixtures'

const start: UiState = { ...initialUiState, sessionId: 'session-1' }
function host(message: HostToWebviewMessage, state = start, at = 1000) {
  return uiReducer(state, { type: 'hostMessage', message, at })
}
function snapshot(questions = [questionFixture()], state = start, at = 1000) {
  return host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions } }, state, at)
}
function requested(state = start) {
  const record = questionFixture()
  return host(
    {
      type: 'agentEvent',
      event: {
        type: 'questionRequested',
        itemId: record.itemId,
        userInputId: record.userInputId,
        questions: record.questions,
      },
    },
    state,
  )
}

describe('M112 surface question state', () => {
  it('retires an absent open transcript card from the authoritative set and every action', () => {
    const open = snapshot([questionFixture()], requested())
    const retired = snapshot([], open)
    expect(retired.openQuestionCounts['session-1']).toBe(0)
    expect(questionsInOrder(retired).filter((question) => question.state === 'open')).toEqual([])
    expect(retired.transcript[0]).toMatchObject({ question: { isNoLongerOpen: true } })
    expect(transcriptEntrySchema.safeParse(retired.transcript[0]).success).toBe(true)
    expect(uiReducer(retired, { type: 'questionJump', direction: 'next' })).toBe(retired)
    expect(uiReducer(retired, { type: 'questionSubmitted', userInputId: 'q-1' })).toBe(retired)
    const deferred = host(
      {
        type: 'agentEvent',
        event: {
          type: 'questionSettled',
          userInputId: 'q-1',
          outcome: 'deferred',
          answers: [],
        },
      },
      retired,
    )
    expect(deferred.transcript[0]).toMatchObject({ question: { isNoLongerOpen: true } })
    const terminal = host(
      {
        type: 'agentEvent',
        event: {
          type: 'questionSettled',
          userInputId: 'q-1',
          outcome: 'answeredLater',
          answers: [],
        },
      },
      retired,
    )
    expect(terminal.transcript[0]).toMatchObject({
      question: {
        state: 'answeredLater',
        isNoLongerOpen: false,
      },
    })
  })

  it('preserves retired question cards and outcomes through same-session history refresh only', () => {
    const settled = host(
      {
        type: 'agentEvent',
        event: {
          type: 'questionSettled',
          userInputId: 'q-1',
          outcome: 'answeredLater',
          answers: [],
        },
      },
      requested(),
    )
    const retired = snapshot([], snapshot([questionFixture({ state: 'answeredLater' })], settled))
    const history = (sessionId: string) =>
      host(
        {
          type: 'historyLoaded',
          sessionId,
          todos: [],
          items: [
            { itemId: 'item-1', kind: 'toolCall', status: 'completed', tool: 'request_user_input' },
          ],
        },
        retired,
      )
    expect(history('session-1').transcript[0]).toMatchObject({
      question: { state: 'answeredLater', questions: questionFixture().questions },
      questionOutcome: { outcome: 'answeredLater' },
    })
    expect(history('other').transcript[0]).toMatchObject({
      question: undefined,
      questionOutcome: undefined,
    })
  })

  it('keeps missing-history cards in the dock and ignores a stale session snapshot or jump', () => {
    const state = snapshot()
    expect(questionsInOrder(state)).toHaveLength(1)
    expect(state.transcript).toEqual([])
    expect(
      host({ type: 'openQuestions', snapshot: { sessionId: 'other', questions: [] } }, state),
    ).toBe(state)
    expect(host({ type: 'jumpToOpenQuestion', sessionId: 'other', direction: 'next' }, state)).toBe(
      state,
    )
  })

  it('updates the row and count together, retains the card after terminal publication retires', () => {
    const state = snapshot([questionFixture()], requested())
    expect(state.transcript[0]).toMatchObject({ question: { state: 'open', userInputId: 'q-1' } })
    expect(state.openQuestionCounts['session-1']).toBe(1)
    expect(hasPendingRequest(state)).toBe(false)
    const answered = snapshot([questionFixture({ state: 'answeredLater' })], state)
    expect(answered.announcement?.text).toBe(UI_TEXT.announceLateAnswerSent)
    expect(answered.openQuestionCounts['session-1']).toBe(0)
    const retired = snapshot([], answered)
    expect(retired.transcript[0]).toMatchObject({ question: { state: 'answeredLater' } })
    expect(transcriptEntrySchema.safeParse(retired.transcript[0]).success).toBe(true)
  })

  it('locks rowless cards and repeated snapshots until a settlement', () => {
    const state = snapshot()
    const locked = uiReducer(state, { type: 'questionSubmitted', userInputId: 'q-1' })
    expect(questionsInOrder(snapshot([questionFixture()], locked))[0]?.isSubmitted).toBe(true)
    expect(
      questionsInOrder(snapshot([questionFixture({ state: 'answeredLater' })], locked))[0]
        ?.isSubmitted,
    ).toBe(false)
  })

  it('announces the arrival countdown once, then deferral, reminder and a late answer once each', () => {
    const waiting = questionFixture({ state: 'waiting', deferredAt: undefined })
    const arrived = snapshot([waiting], requested())
    expect(arrived.announcement?.text).toContain('60')
    expect(snapshot([waiting], arrived, 2000).announcement).toBe(arrived.announcement)
    const deferred = snapshot([questionFixture()], arrived, 61_000)
    expect(deferred.announcement?.text).toBe(UI_TEXT.announceQuestionDeferred)
    const reminded = snapshot([questionFixture({ reminders: 1 })], deferred)
    expect(reminded.announcement?.text).toBe('You still have an open question: Colour')
    expect(reminded.questionNavigation?.userInputId).toBe('q-1')
    expect(snapshot([questionFixture({ reminders: 1 })], reminded).announcement).toBe(
      reminded.announcement,
    )
  })

  it('cycles next and previous in transcript order, then arrival order for rowless records', () => {
    const second = questionFixture({ userInputId: 'q-2', itemId: 'item-2', askedAt: 0 })
    let state = snapshot([second, questionFixture()], requested())
    state = host({ type: 'jumpToOpenQuestion', sessionId: 'session-1', direction: 'next' }, state)
    expect(state.questionNavigation).toEqual({ userInputId: 'q-1', sequence: 1 })
    state = uiReducer(state, { type: 'questionJump', direction: 'previous' })
    expect(state.questionNavigation?.userInputId).toBe('q-2')
    state = uiReducer(state, { type: 'questionJump', direction: 'next' })
    expect(state.questionNavigation?.userInputId).toBe('q-1')
    expect(uiReducer(start, { type: 'questionJump', direction: 'next' })).toBe(start)
  })

  it('never treats deferral as explanation and retains unknown settlement words', () => {
    const state = requested()
    const settled = (outcome: string) =>
      host(
        {
          type: 'agentEvent',
          event: { type: 'questionSettled', userInputId: 'q-1', outcome, answers: [] },
        },
        state,
      )
    expect(settled('deferred').transcript[0]).toMatchObject({ question: { state: 'open' } })
    expect(settled('clarified').transcript[0]).toMatchObject({
      question: { state: 'clarified' },
      questionOutcome: { outcome: 'clarified' },
    })
    expect(settled('future-word').transcript[0]).toMatchObject({
      questionOutcome: { outcome: 'future-word' },
    })
  })

  it('clears session-local cards, navigation and submission locks at a session boundary', () => {
    const open = snapshot()
    const state = uiReducer(open, { type: 'questionJump', direction: 'next' })
    const changed = host({ type: 'sessionInfo', sessionId: 'other', modelId: 'test' }, state)
    expect(changed.openQuestions).toEqual([])
    expect(changed.submittedQuestions).toEqual([])
    expect(changed.questionNavigation).toBeUndefined()
    expect(changed.openQuestionCounts['session-1']).toBe(1)
    const cleared = host({ type: 'conversationCleared', accountBoundary: true }, state)
    expect(cleared.openQuestionCounts).toEqual({})
  })

  it('retains open and settled row cards when a turn ends without treating them as blocking', () => {
    const open = snapshot([questionFixture()], requested())
    const ended = host(
      {
        type: 'agentEvent',
        event: { type: 'turnCompleted', turnId: 'turn-1', terminal: 'failed' },
      },
      open,
    )
    expect(ended.transcript[0]).toMatchObject({ question: { state: 'open' } })
    expect(hasPendingRequest(ended)).toBe(false)
  })
})
