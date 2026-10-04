import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AttentionNotice,
  attentionNotice,
  BackgroundNotifier,
  type BackgroundNotifierDeps,
} from '../../src/host/conversation/turnNotifications'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  BACKGROUND_NOTICE_KEYS_MAX,
  BACKGROUND_TURN_NOTIFICATION_MIN_MS,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'

const SESSION = 's1'

function turnCompleted(
  overrides: Partial<Extract<AgentEvent, { type: 'turnCompleted' }>> = {},
): Extract<AgentEvent, { type: 'turnCompleted' }> {
  return { type: 'turnCompleted', turnId: 't1', terminal: 'completed', ...overrides }
}

function approvalRequested(
  overrides: Partial<Extract<AgentEvent, { type: 'approvalRequested' }>> = {},
): Extract<AgentEvent, { type: 'approvalRequested' }> {
  return {
    type: 'approvalRequested',
    approvalId: 'a',
    itemId: 'i',
    toolName: 'powershell',
    rawArgs: '{}',
    requirementId: { approvalId: 'a', sourceIndex: 0 },
    subject: { kind: 'tool' },
    availableChoices: [],
    isJudgeEscalated: false,
    isProtectedWrite: false,
    ...overrides,
  }
}

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('attentionNotice', () => {
  it('names a long turn as it ended: completed, failed, or another word', () => {
    const long = BACKGROUND_TURN_NOTIFICATION_MIN_MS
    expect(attentionNotice(SESSION, turnCompleted({ durationMs: long }))).toEqual({
      key: 's1:turn:t1',
      message: EN.notifyTurnDone,
    })
    expect(
      attentionNotice(SESSION, turnCompleted({ terminal: 'failed', durationMs: long }))?.message,
    ).toBe(EN.notifyTurnFailed)
    // A terminal the wire adds later is told as ended, with no meaning guessed (D36).
    expect(
      attentionNotice(SESSION, turnCompleted({ terminal: 'interrupted', durationMs: long }))
        ?.message,
    ).toBe(EN.notifyTurnEnded)
  })

  it('names a turn whose length was not reported: it may have been long', () => {
    expect(attentionNotice(SESSION, turnCompleted())?.message).toBe(EN.notifyTurnDone)
  })

  it('stays quiet for a short turn and for one the user stopped', () => {
    expect(
      attentionNotice(
        SESSION,
        turnCompleted({ durationMs: BACKGROUND_TURN_NOTIFICATION_MIN_MS - 1 }),
      ),
    ).toBeUndefined()
    expect(
      attentionNotice(SESSION, turnCompleted({ terminal: 'cancelled', durationMs: 600_000 })),
    ).toBeUndefined()
  })

  it('names a turn waiting on an approval or a question, keyed by what waits', () => {
    expect(attentionNotice(SESSION, approvalRequested())).toEqual({
      key: 's1:approval:a',
      message: EN.notifyApprovalWaiting,
    })
    expect(
      attentionNotice(SESSION, {
        type: 'questionRequested',
        userInputId: 'q',
        itemId: 'i',
        questions: [],
      }),
    ).toEqual({ key: 's1:question:q', message: EN.notifyQuestionWaiting })
  })

  it('stays quiet for a pending card or question shown again to a later surface', () => {
    expect(attentionNotice(SESSION, approvalRequested({ isReplayed: true }))).toBeUndefined()
    expect(
      attentionNotice(SESSION, {
        type: 'questionRequested',
        userInputId: 'q',
        itemId: 'i',
        questions: [],
        isReplayed: true,
      }),
    ).toBeUndefined()
  })

  it('stays quiet for anything else', () => {
    expect(attentionNotice(SESSION, { type: 'turnStarted', turnId: 't1' })).toBeUndefined()
  })
})

function notifier(options: { enabled?: boolean; focused?: boolean; reveal?: boolean } = {}) {
  const state = { enabled: options.enabled ?? true, focused: options.focused ?? false }
  const log = new FakeLogOutputChannel()
  const show = vi.fn<BackgroundNotifierDeps['show']>(() => Promise.resolve(options.reveal ?? false))
  const deps: BackgroundNotifierDeps = {
    isEnabled: () => state.enabled,
    isWindowFocused: () => state.focused,
    show,
    log,
  }
  return { notifier: new BackgroundNotifier(deps), show, state, log }
}

const NOTICE: AttentionNotice = { key: 's1:turn:t1', message: EN.notifyTurnDone }

describe('BackgroundNotifier', () => {
  it('shows a notice while the window is unfocused, and reveals on request', async () => {
    const t = notifier({ reveal: true })
    const reveal = vi.fn()
    t.notifier.notify(NOTICE, reveal)
    expect(t.show).toHaveBeenCalledWith(EN.notifyTurnDone)
    await vi.waitFor(() => {
      expect(reveal).toHaveBeenCalledTimes(1)
    })
  })

  it('leaves the conversation where it is when the notice is dismissed', async () => {
    const t = notifier({ reveal: false })
    const reveal = vi.fn()
    t.notifier.notify(NOTICE, reveal)
    await Promise.resolve()
    await Promise.resolve()
    expect(t.show).toHaveBeenCalledTimes(1)
    expect(reveal).not.toHaveBeenCalled()
  })

  it('never shows anything while the window is focused', () => {
    const t = notifier({ focused: true })
    t.notifier.notify(NOTICE, vi.fn())
    expect(t.show).not.toHaveBeenCalled()
  })

  it('shows nothing while the setting is off', () => {
    const t = notifier({ enabled: false })
    t.notifier.notify(NOTICE, vi.fn())
    expect(t.show).not.toHaveBeenCalled()
  })

  it('raises a notice two surfaces on one session receive only once', () => {
    const t = notifier()
    t.notifier.notify(NOTICE, vi.fn())
    t.notifier.notify(NOTICE, vi.fn())
    t.notifier.notify({ key: 's1:turn:t2', message: EN.notifyTurnDone }, vi.fn())
    expect(t.show).toHaveBeenCalledTimes(2)
  })

  it('does not raise later what arrived while the window was focused', () => {
    const t = notifier({ focused: true })
    t.notifier.notify(NOTICE, vi.fn())
    t.state.focused = false
    t.notifier.notify(NOTICE, vi.fn())
    expect(t.show).not.toHaveBeenCalled()
  })

  it('remembers a bounded number of notices, forgetting the oldest first', () => {
    const t = notifier({ focused: true })
    for (let index = 0; index <= BACKGROUND_NOTICE_KEYS_MAX; index += 1) {
      t.notifier.notify({ key: `s1:turn:${String(index)}`, message: EN.notifyTurnDone }, vi.fn())
    }
    t.state.focused = false
    // The first key fell out; the last is still remembered.
    t.notifier.notify({ key: 's1:turn:0', message: EN.notifyTurnDone }, vi.fn())
    t.notifier.notify(
      { key: `s1:turn:${String(BACKGROUND_NOTICE_KEYS_MAX)}`, message: EN.notifyTurnDone },
      vi.fn(),
    )
    expect(t.show).toHaveBeenCalledTimes(1)
  })

  it('logs a notice that could not be shown', async () => {
    const t = notifier()
    t.show.mockImplementationOnce(() => Promise.reject(new Error('no window')))
    t.notifier.notify(NOTICE, vi.fn())
    await vi.waitFor(() => {
      expect(logLines(t.log).some((line) => line.includes('The background notice failed'))).toBe(
        true,
      )
    })
  })
})
