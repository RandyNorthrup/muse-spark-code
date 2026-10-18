import { beforeEach, describe, expect, it } from 'vitest'
import { type AgentEvent, agentEventSchema } from '../../src/shared/agentEvents'
import {
  BACKGROUND_NOTICE_KEYS_MAX,
  BACKGROUND_TURN_NOTIFICATION_MIN_MS,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  NoticeMemory,
  attentionNotice,
  notifyOpenQuestions,
} from '../../src/host/conversation/turnNotifications'

// M82: background-turn notices through the real modules. Events are parsed
// by the real wire schema, so a shape the backend cannot send fails here
// instead of reaching the notifier. This file proves only port-free policy
// (`attentionNotice`, `notifyOpenQuestions`, `NoticeMemory`): the
// notifier's editor-host ports (setting, focus, VS Code's notification)
// are proven in the real Extension Development Host by
// test/integration/backgroundNotice.test.ts, never by scripted closures.
function turnEvent(terminal: string, durationMs?: number): AgentEvent {
  return agentEventSchema.parse({
    type: 'turnCompleted',
    turnId: 'turn-1',
    terminal,
    ...(durationMs !== undefined && { durationMs }),
  })
}

function approvalEvent(isReplayed?: boolean): AgentEvent {
  return agentEventSchema.parse({
    type: 'approvalRequested',
    approvalId: 'approval-1',
    itemId: 'item-1',
    toolName: 'run_command',
    rawArgs: '{}',
    requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    subject: { kind: 'shell', command: 'ls' },
    availableChoices: [],
    isJudgeEscalated: false,
    isProtectedWrite: false,
    ...(isReplayed !== undefined && { isReplayed }),
  })
}

function questionEvent(isReplayed?: boolean): AgentEvent {
  return agentEventSchema.parse({
    type: 'questionRequested',
    userInputId: 'question-1',
    itemId: 'item-1',
    questions: [],
    ...(isReplayed !== undefined && { isReplayed }),
  })
}

describe('attentionNotice', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('names a long completed turn once by session and turn', () => {
    const first = attentionNotice('s1', turnEvent('completed', BACKGROUND_TURN_NOTIFICATION_MIN_MS))
    const otherSession = attentionNotice(
      's2',
      turnEvent('completed', BACKGROUND_TURN_NOTIFICATION_MIN_MS),
    )
    expect(first).toEqual({ key: 's1:turn:turn-1', message: EN.notifyTurnDone })
    expect(otherSession?.key).not.toBe(first?.key)
  })

  it('stays quiet for a short turn, a cancelled turn, and other events', () => {
    expect(
      attentionNotice('s1', turnEvent('completed', BACKGROUND_TURN_NOTIFICATION_MIN_MS - 1)),
    ).toBeUndefined()
    expect(attentionNotice('s1', turnEvent('cancelled'))).toBeUndefined()
    expect(attentionNotice('s1', agentEventSchema.parse({ type: 'skillsChanged' }))).toBeUndefined()
  })

  it('treats an unreported length as possibly long and names the terminal', () => {
    expect(attentionNotice('s1', turnEvent('completed'))?.message).toBe(EN.notifyTurnDone)
    expect(attentionNotice('s1', turnEvent('failed'))?.message).toBe(EN.notifyTurnFailed)
    // D36: a word the wire adds later passes through as "ended".
    expect(attentionNotice('s1', turnEvent('stalled'))?.message).toBe(EN.notifyTurnEnded)
  })

  it('names an approval and a question, but not a replayed card', () => {
    expect(attentionNotice('s1', approvalEvent())).toEqual({
      key: 's1:approval:approval-1',
      message: EN.notifyApprovalWaiting,
    })
    expect(attentionNotice('s1', questionEvent())).toEqual({
      key: 's1:question:question-1',
      message: EN.notifyQuestionWaiting,
    })
    expect(attentionNotice('s1', approvalEvent(true))).toBeUndefined()
    expect(attentionNotice('s1', questionEvent(true))).toBeUndefined()
  })

  it('keys the open-questions reminder by session and turn', () => {
    expect(notifyOpenQuestions('s1', 'turn-1')).toEqual({
      key: 's1:openQuestions:turn-1',
      message: EN.notifyOpenQuestions,
    })
  })
})

describe('NoticeMemory', () => {
  it('takes each key once', () => {
    const memory = new NoticeMemory()
    expect(memory.take('s1:turn:t1')).toBe(true)
    expect(memory.take('s1:turn:t1')).toBe(false)
    expect(memory.take('s1:turn:t2')).toBe(true)
  })

  it('forgets the oldest key past its bounded memory', () => {
    const memory = new NoticeMemory()
    for (let index = 0; index <= BACKGROUND_NOTICE_KEYS_MAX; index += 1) {
      expect(memory.take(`s1:turn:t${String(index)}`)).toBe(true)
    }
    // The first key fell out when the bound was passed; a recent one holds.
    expect(memory.take('s1:turn:t0')).toBe(true)
    expect(memory.take(`s1:turn:t${String(BACKGROUND_NOTICE_KEYS_MAX)}`)).toBe(false)
  })
})
