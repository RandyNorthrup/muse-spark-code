import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  canSend,
  initialUiState,
  uiReducer,
  type UiAction,
  type UiState,
} from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

const init: HostToWebviewMessage = {
  type: 'init',
  extensionVersion: '1.0.0',
  emptyStateHint: 'hint',
  composerPlaceholder: 'placeholder',
  settings: testSettings,
}

function reduceAll(actions: readonly UiAction[], start: UiState = initialUiState): UiState {
  let state = start
  for (const action of actions) {
    state = uiReducer(state, action)
  }
  return state
}

function host(message: HostToWebviewMessage): UiAction {
  return { type: 'hostMessage', message }
}

function agent(event: AgentEvent): UiAction {
  return host({ type: 'agentEvent', event })
}

const signedIn = host({ type: 'authState', status: 'signedIn' })

describe('uiReducer: shell', () => {
  it('becomes ready on init and requests composer focus once', () => {
    const state = reduceAll([host(init)])
    expect(state.phase).toBe('ready')
    expect(state.settings).toEqual(testSettings)
    expect(state.focusRequests).toBe(1)
  })

  it('replaces settings, counts focus requests, queues inserts', () => {
    const state = reduceAll([
      host(init),
      host({ type: 'settingsChanged', settings: { ...testSettings, focusView: true } }),
      host({ type: 'focusInput' }),
      host({ type: 'insertText', text: '@a ' }),
      host({ type: 'insertText', text: '@b ' }),
    ])
    expect(state.settings?.focusView).toBe(true)
    expect(state.focusRequests).toBe(4)
    expect(state.pendingInsert).toBe('@a @b ')
    expect(uiReducer(state, { type: 'insertApplied' }).pendingInsert).toBeUndefined()
  })

  it('tracks auth and session info', () => {
    const state = reduceAll([
      host({ type: 'authState', status: 'signedOut', detail: 'not logged in' }),
      host({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 }),
    ])
    expect(state.auth).toEqual({ status: 'signedOut', detail: 'not logged in' })
    expect(state.model).toEqual({ modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
  })
})

describe('uiReducer: sending', () => {
  it('echoes the user message as pending and clears the draft', () => {
    const state = reduceAll([
      { type: 'draftChanged', draft: 'hello' },
      { type: 'submitted', localId: 'l1', text: 'hello' },
    ])
    expect(state.draft).toBe('')
    expect(state.transcript).toEqual([{ kind: 'user', id: 'l1', text: 'hello', status: 'pending' }])
  })

  it('marks the echo sent and the turn active on turnAccepted', () => {
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'hello' },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
    ])
    expect(state.transcript[0]).toMatchObject({ status: 'sent' })
    expect(state.activeTurnId).toBe('t1')
  })

  it('marks the echo failed with the reason on sendFailed', () => {
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'hello' },
      host({ type: 'sendFailed', localId: 'l1', reason: 'Sign in first' }),
    ])
    expect(state.transcript[0]).toMatchObject({ status: 'failed', reason: 'Sign in first' })
    expect(state.activeTurnId).toBeUndefined()
  })

  it('only allows sending when signed in, idle, and the draft is not blank', () => {
    const base = reduceAll([host(init), signedIn, { type: 'draftChanged', draft: '  hi ' }])
    expect(canSend(base)).toBe(true)
    expect(canSend(uiReducer(base, { type: 'draftChanged', draft: ' '.repeat(3) }))).toBe(false)
    expect(canSend(uiReducer(base, agent({ type: 'turnStarted', turnId: 't1' })))).toBe(false)
    expect(canSend(uiReducer(base, host({ type: 'authState', status: 'signedOut' })))).toBe(false)
  })
})

describe('uiReducer: agent events', () => {
  it('streams an assistant message and finalises it', () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'itemStarted', itemId: 'm1', kind: 'agentMessage', turnId: 't1' }),
      agent({ type: 'textDelta', itemId: 'm1', field: 'text', delta: 'hel' }),
      agent({ type: 'textDelta', itemId: 'm1', field: 'text', delta: 'lo' }),
    ])
    expect(state.activeTurnId).toBe('t1')
    expect(state.transcript).toEqual([
      { kind: 'assistant', id: 'm1', text: 'hello', isStreaming: true },
    ])
    const done = reduceAll(
      [
        agent({
          type: 'itemCompleted',
          itemId: 'm1',
          kind: 'agentMessage',
          status: 'completed',
          text: 'hello!',
        }),
        agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' }),
      ],
      state,
    )
    expect(done.transcript).toEqual([
      { kind: 'assistant', id: 'm1', text: 'hello!', isStreaming: false },
    ])
    expect(done.activeTurnId).toBeUndefined()
  })

  it('hides host-internal items and shows other items as activity', () => {
    const state = reduceAll([
      agent({ type: 'itemStarted', itemId: 'u', kind: 'userMessage' }),
      agent({ type: 'itemStarted', itemId: 'r', kind: 'reminderChild' }),
      agent({ type: 'itemStarted', itemId: 'tool', kind: 'toolCall' }),
      agent({ type: 'itemCompleted', itemId: 'tool', kind: 'toolCall', status: 'completed' }),
    ])
    expect(state.transcript).toEqual([
      { kind: 'activity', id: 'tool', itemKind: 'toolCall', status: 'completed' },
    ])
  })

  it('adds an error entry when a turn fails and clears the active turn', () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        reason: 'not logged in',
        errorKind: 'authRequired',
      }),
    ])
    expect(state.activeTurnId).toBeUndefined()
    expect(state.transcript).toEqual([{ kind: 'error', id: 'error:t1', text: 'not logged in' }])
  })

  it('records usage, context and model changes', () => {
    const state = reduceAll([
      host({ type: 'sessionInfo', modelId: 'a', contextLimit: 10 }),
      agent({
        type: 'tokenUsage',
        inputTokens: 5,
        outputTokens: 2,
        cachedTokens: 1,
        reasoningTokens: 0,
      }),
      agent({ type: 'contextUsage', usedTokens: 7, windowTokens: 10, pressure: 'normal' }),
      agent({ type: 'modelChanged', modelId: 'b' }),
      agent({ type: 'sessionStatus', status: 'idle' }),
    ])
    expect(state.usage).toEqual({ inputTokens: 5, outputTokens: 2, cachedTokens: 1 })
    expect(state.context).toEqual({ usedTokens: 7, windowTokens: 10, pressure: 'normal' })
    expect(state.model).toEqual({ modelId: 'b', contextLimit: 10 })
  })
})
