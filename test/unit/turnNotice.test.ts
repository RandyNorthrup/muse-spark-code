import { beforeEach, describe, expect, it } from 'vitest'
import { type AgentEvent, agentEventSchema } from '../../src/shared/agentEvents'
import {
  BACKGROUND_NOTICE_KEYS_MAX,
  BACKGROUND_TURN_NOTIFICATION_MIN_MS,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  type AttentionNotice,
  attentionNotice,
  BackgroundNotifier,
  notifyOpenQuestions,
} from '../../src/host/conversation/turnNotifications'
import type { Logger } from '../../src/host/logger'

// M82: background-turn notices through the real modules. Events are parsed
// by the real wire schema, so a shape the backend cannot send fails here
// instead of reaching the notifier.
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

function ignore(): void {
  // The harness asserts on `shown` instead of the reveal callback.
}

interface Harness {
  notifier: BackgroundNotifier
  shown: string[]
  revealed: string[]
}

function makeHarness(overrides?: {
  isEnabled?: () => boolean
  isWindowFocused?: () => boolean
}): Harness {
  const shown: string[] = []
  const revealed: string[] = []
  const log: Logger = { trace: ignore, info: ignore, warn: ignore, error: ignore }
  const notifier = new BackgroundNotifier({
    isEnabled: overrides?.isEnabled ?? (() => true),
    isWindowFocused: overrides?.isWindowFocused ?? (() => false),
    show: (message: string) => {
      shown.push(message)
      return Promise.resolve(true)
    },
    log,
  })
  return { notifier, shown, revealed }
}

function notice(key: string): AttentionNotice {
  return { key, message: `notice ${key}` }
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
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

describe('BackgroundNotifier', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('raises each key once and reveals the conversation on request', async () => {
    const { notifier, shown, revealed } = makeHarness()
    notifier.notify(notice('s1:turn:t1'), () => void revealed.push('s1'))
    notifier.notify(notice('s1:turn:t1'), () => void revealed.push('s1'))
    await flush()
    expect(shown).toEqual(['notice s1:turn:t1'])
    expect(revealed).toEqual(['s1'])
  })

  it('stays quiet while the window is focused or the setting is off', async () => {
    const focused = makeHarness({ isWindowFocused: () => true })
    focused.notifier.notify(notice('s1:turn:t1'), ignore)
    const off = makeHarness({ isEnabled: () => false })
    off.notifier.notify(notice('s1:turn:t1'), ignore)
    await flush()
    expect([...focused.shown, ...off.shown]).toEqual([])
  })

  it('logs a show failure instead of throwing', async () => {
    const errors: string[] = []
    const notifier = new BackgroundNotifier({
      isEnabled: () => true,
      isWindowFocused: () => false,
      show: () => Promise.reject(new Error('gone')),
      log: {
        trace: ignore,
        info: ignore,
        warn: ignore,
        error: (message: string) => void errors.push(message),
      },
    })
    notifier.notify(notice('s1:turn:t1'), ignore)
    await flush()
    expect(errors.length).toBe(1)
  })

  it('forgets the oldest key past its bounded memory', async () => {
    const { notifier, shown } = makeHarness()
    for (let index = 0; index <= BACKGROUND_NOTICE_KEYS_MAX; index += 1) {
      notifier.notify(notice(`s1:turn:t${String(index)}`), ignore)
    }
    notifier.notify(notice('s1:turn:t0'), ignore)
    await flush()
    expect(shown.filter((message) => message === 'notice s1:turn:t0').length).toBe(2)
  })
})
