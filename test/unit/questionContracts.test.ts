import { describe, expect, it } from 'vitest'
import { agentEventSchema } from '../../src/shared/agentEvents'
import {
  ATTENTION_DOCK_MAX_VIEWPORT_FRACTION,
  CLARIFICATION_MAX_CHARS,
  LATE_ANSWER_QUESTION_MAX_CHARS,
  OPEN_QUESTIONS_MAX,
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_MAX_SECONDS,
  QUESTION_DEFER_MIN_SECONDS,
  QUESTION_ID_MAX_CHARS,
  QUESTION_MODEL_TEXT,
  QUESTION_OUTCOME_DEFERRED,
  QUESTION_REMINDERS_MAX,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import {
  attentionDockStateSchema,
  openQuestionSchema,
  openQuestionStoreSchema,
  openQuestionsSnapshotSchema,
  QUESTION_STATES,
  questionReplySchema,
  type AttentionDockState,
  type OpenQuestionAnswer,
  type OpenQuestionsSnapshot,
  type QuestionReply,
} from '../../src/shared/questions'
import { questionFixture } from './helpers/questions/fixtures'

const snapshot: OpenQuestionsSnapshot = { sessionId: 'session-1', questions: [questionFixture()] }

// These tests certify contracts only. Q, U and A exercise their behaviour
// against the fakes; no backend, paid request or editor process is started.
describe('M112 question boundary contracts', () => {
  it('keeps each lifecycle state and rejects a fabricated state', () => {
    for (const state of QUESTION_STATES) {
      expect(openQuestionSchema.parse(questionFixture({ state })).state).toBe(state)
    }
    expect(openQuestionSchema.safeParse({ ...questionFixture(), state: 'approved' }).success).toBe(
      false,
    )
  })

  it('requires a deferred timestamp for open and later-settled questions', () => {
    for (const state of ['open', 'answeredLater', 'answeredOnReask', 'dismissed', 'expired']) {
      expect(
        openQuestionSchema.safeParse({ ...questionFixture(), state, deferredAt: undefined })
          .success,
      ).toBe(false)
    }
    expect(
      openQuestionSchema.safeParse(questionFixture({ state: 'waiting', deferredAt: undefined }))
        .success,
    ).toBe(true)
  })

  it('rejects backwards time, noninteger counters and more than two reminders', () => {
    for (const invalid of [
      { askedAt: -1 },
      { askedAt: 0.5 },
      { deferredAt: 0 },
      { deadlineAt: 0 },
      { reminders: -1 },
      { reminders: 0.5 },
      { reminders: QUESTION_REMINDERS_MAX + 1 },
    ]) {
      expect(openQuestionSchema.safeParse({ ...questionFixture(), ...invalid }).success).toBe(false)
    }
  })

  it('rejects empty identity, oversized handles and duplicate question ids', () => {
    for (const field of ['userInputId', 'sessionId', 'itemId', 'turnId', 'key']) {
      expect(openQuestionSchema.safeParse({ ...questionFixture(), [field]: '' }).success).toBe(
        false,
      )
    }
    expect(
      openQuestionSchema.safeParse(
        questionFixture({ userInputId: 'q'.repeat(QUESTION_ID_MAX_CHARS + 1) }),
      ).success,
    ).toBe(false)
    const entry = questionFixture()
    expect(openQuestionSchema.safeParse({ ...entry, questions: [] }).success).toBe(false)
    expect(
      openQuestionSchema.safeParse({
        ...entry,
        questions: [...entry.questions, ...entry.questions],
      }).success,
    ).toBe(false)
  })

  it('rejects extra stored fields and unrecognised backends', () => {
    expect(
      openQuestionSchema.safeParse({ ...questionFixture(), secret: 'CANARY_DO_NOT_KEEP' }).success,
    ).toBe(false)
    expect(
      openQuestionSchema.safeParse({ ...questionFixture(), backend: 'invented' }).success,
    ).toBe(false)
  })

  it('validates per-session identity and unique card ids in a snapshot', () => {
    expect(openQuestionsSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    for (const questions of [
      [questionFixture({ sessionId: 'other-session' })],
      [questionFixture(), questionFixture()],
    ]) {
      expect(openQuestionsSnapshotSchema.safeParse({ ...snapshot, questions }).success).toBe(false)
    }
  })

  it('admits twenty open cards and an expired oldest update, rejecting twenty-one open', () => {
    const questions = Array.from({ length: OPEN_QUESTIONS_MAX + 1 }, (_, index) =>
      questionFixture({ userInputId: `q-${String(index)}` }),
    )
    expect(openQuestionsSnapshotSchema.safeParse({ ...snapshot, questions }).success).toBe(false)
    questions[0] = questionFixture({ userInputId: 'q-0', state: 'expired' })
    expect(openQuestionsSnapshotSchema.safeParse({ ...snapshot, questions }).success).toBe(true)
  })

  it('validates versioned storage without accepting unknown versions or fields', () => {
    expect(openQuestionStoreSchema.parse({ version: 1, snapshot })).toEqual({
      version: 1,
      snapshot,
    })
    expect(openQuestionStoreSchema.safeParse({ version: 2, snapshot }).success).toBe(false)
    expect(
      openQuestionStoreSchema.safeParse({ version: 1, snapshot, text: 'CANARY_DO_NOT_KEEP' })
        .success,
    ).toBe(false)
  })

  it('preserves deferred, user clarification and future outcomes on agent events', () => {
    for (const outcome of [QUESTION_OUTCOME_DEFERRED, 'clarified', 'future-state']) {
      const event = { type: 'questionSettled', userInputId: 'q-1', outcome, answers: [] }
      expect(agentEventSchema.parse(event)).toEqual(event)
    }
    const deferred: QuestionReply = { kind: 'deferred', userInputId: 'q-1' }
    expect(questionReplySchema.parse(deferred)).toEqual({
      kind: 'deferred',
      userInputId: 'q-1',
    })
    expect(questionReplySchema.parse({ kind: 'clarified', text: 'I prefer green.' })).toEqual({
      kind: 'clarified',
      text: 'I prefer green.',
    })
    expect(questionReplySchema.safeParse({ kind: 'deferred' }).success).toBe(false)
    expect(questionReplySchema.safeParse({ kind: 'cancelled', userInputId: 'q-1' }).success).toBe(
      false,
    )
  })

  it('accepts snapshots and an empty snapshot across the host boundary', () => {
    for (const questions of [snapshot.questions, []]) {
      const message = { type: 'openQuestions', snapshot: { ...snapshot, questions } }
      expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
    }
    expect(
      parseHostToWebviewMessage({
        type: 'openQuestions',
        snapshot: { ...snapshot, questions: [questionFixture({ sessionId: 'other' })] },
      }).ok,
    ).toBe(false)
    expect(
      parseHostToWebviewMessage({ type: 'openQuestions', snapshot, approvalId: 'a-1' }).ok,
    ).toBe(false)
  })

  it('accepts late answers, explanations, dismissals and navigation', () => {
    const identity = { sessionId: 'session-1', userInputId: 'q-1' }
    const explanation: OpenQuestionAnswer = { explanation: 'I prefer green.' }
    for (const message of [
      {
        type: 'answerOpenQuestion',
        ...identity,
        reply: { answers: [{ questionId: 'colour', selectedLabel: 'Blue' }] },
      },
      { type: 'answerOpenQuestion', ...identity, reply: explanation },
      { type: 'dismissOpenQuestion', ...identity },
      { type: 'jumpToOpenQuestion', sessionId: identity.sessionId, direction: 'next' },
      { type: 'jumpToOpenQuestion', sessionId: identity.sessionId, direction: 'previous' },
    ]) {
      expect(parseWebviewToHostMessage(message)).toEqual({ ok: true, message })
    }
    const jump = { type: 'jumpToOpenQuestion', sessionId: identity.sessionId, direction: 'next' }
    expect(parseHostToWebviewMessage(jump)).toEqual({ ok: true, message: jump })
  })

  it('refuses malformed or approval-bearing question commands', () => {
    const answer = { type: 'answerOpenQuestion', sessionId: 'session-1', userInputId: 'q-1' }
    for (const invalid of [
      { ...answer, reply: { answers: [] } },
      { ...answer, reply: { explanation: '' } },
      { ...answer, reply: { answers: [{ questionId: 'colour' }], explanation: 'both' } },
      { ...answer, reply: { answers: [{ questionId: 1 }] } },
      { ...answer, reply: { explanation: 'green' }, approvalId: 'a-1' },
      { ...answer, sessionId: '', reply: { explanation: 'green' } },
      { type: 'dismissOpenQuestion', sessionId: 'session-1' },
      {
        type: 'dismissOpenQuestion',
        sessionId: 'session-1',
        userInputId: 'q-1',
        choiceId: 'allow',
      },
      { type: 'jumpToOpenQuestion', sessionId: 'session-1', direction: 'sideways' },
      { type: 'jumpToOpenQuestion', sessionId: 'session-1', direction: 'next', mode: 'bypass' },
    ]) {
      expect(parseWebviewToHostMessage(invalid).ok).toBe(false)
    }
  })

  it('keeps the dock identities distinct and expands only a card it contains', () => {
    const dock: AttentionDockState = {
      approvalIds: ['approval-1'],
      waitingQuestionIds: ['q-1'],
      elicitationIds: ['form-1'],
      openQuestionIds: ['q-2'],
      fullCard: { kind: 'question', userInputId: 'q-1' },
    }
    expect(attentionDockStateSchema.parse(dock)).toEqual(dock)
    expect(attentionDockStateSchema.safeParse({ ...dock, openQuestionIds: ['q-1'] }).success).toBe(
      false,
    )
    expect(
      attentionDockStateSchema.safeParse({
        ...dock,
        fullCard: { kind: 'question', userInputId: 'missing' },
      }).success,
    ).toBe(false)
    for (const invalid of [
      { approvalIds: ['approval-1', 'approval-1'] },
      { elicitationIds: ['form-1', 'form-1'] },
      {
        openQuestionIds: Array.from(
          { length: OPEN_QUESTIONS_MAX + 1 },
          (_, index) => `q-${String(index + 2)}`,
        ),
      },
      { fullCard: { kind: 'elicitation', elicitationId: 'missing' } },
    ]) {
      expect(attentionDockStateSchema.safeParse({ ...dock, ...invalid }).success).toBe(false)
    }
    expect(
      attentionDockStateSchema.safeParse({
        ...dock,
        fullCard: { kind: 'elicitation', elicitationId: 'form-1' },
      }).success,
    ).toBe(true)
    expect(
      attentionDockStateSchema.safeParse({
        ...dock,
        fullCard: { kind: 'approval', approvalId: 'approval-1' },
      }).success,
    ).toBe(false)
  })
})

describe('M112 policy constants and model text', () => {
  it('pins the owner-approved timing, count and size limits', () => {
    expect([
      QUESTION_DEFER_DEFAULT_SECONDS,
      QUESTION_DEFER_MIN_SECONDS,
      QUESTION_DEFER_MAX_SECONDS,
    ]).toEqual([60, 10, 3600])
    expect([
      QUESTION_REMINDERS_MAX,
      OPEN_QUESTIONS_MAX,
      LATE_ANSWER_QUESTION_MAX_CHARS,
      ATTENTION_DOCK_MAX_VIEWPORT_FRACTION,
    ]).toEqual([2, 20, 2000, 0.5])
  })

  it('fills both deferral notes within the captured MSP clarification limit', () => {
    const id = 'q'.repeat(QUESTION_ID_MAX_CHARS)
    for (const template of [
      QUESTION_MODEL_TEXT.deferred,
      QUESTION_MODEL_TEXT.deferredClarification,
    ]) {
      const text = fill(template, { id })
      expect(text.length).toBeLessThanOrEqual(CLARIFICATION_MAX_CHARS)
      expect(text).toContain(`question ${id}`)
      expect(text).toContain('Continue with work that does not depend on the answer.')
      expect(text).toContain('Do not guess the answer and do not ask again.')
      expect(text).toContain(`Answer to your earlier question ${id}`)
    }
    expect(
      fill(QUESTION_MODEL_TEXT.lateAnswer, {
        id: 'q-1',
        question: 'Which colour?',
        answer: 'Answers:\n[{"questionId":"colour","selectedLabel":"Blue"}]',
      }),
    ).toBe(
      'Answer to your earlier question q-1\nQuestion:\nWhich colour?\nAnswers:\n[{"questionId":"colour","selectedLabel":"Blue"}]',
    )
    expect(fill(QUESTION_MODEL_TEXT.dismissed, { id: 'q-1' })).toContain(
      'dismissed question q-1 without answering',
    )
  })
})
