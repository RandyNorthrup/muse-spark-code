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

  it('allows sending when signed in with a draft or an attachment, even mid-turn', () => {
    const base = reduceAll([host(init), signedIn, { type: 'draftChanged', draft: '  hi ' }])
    expect(canSend(base)).toBe(true)
    const blank = uiReducer(base, { type: 'draftChanged', draft: ' '.repeat(3) })
    expect(canSend(blank)).toBe(false)
    expect(canSend(uiReducer(blank, host({ type: 'attachmentAdded', attachment })))).toBe(true)
    expect(canSend(uiReducer(base, agent({ type: 'turnStarted', turnId: 't1' })))).toBe(true)
    expect(canSend(uiReducer(base, host({ type: 'authState', status: 'signedOut' })))).toBe(false)
  })

  it('clears attachments with the draft on submit', () => {
    const state = reduceAll([
      host({ type: 'attachmentAdded', attachment }),
      { type: 'submitted', localId: 'l1', text: 'see image' },
    ])
    expect(state.attachments).toEqual([])
  })
})

const attachment = {
  id: 'att-1',
  name: 'shot.png',
  mediaType: 'image/png',
  width: 686,
  height: 695,
  sizeBytes: 24,
}

describe('uiReducer: composer state', () => {
  it('seeds the permission mode from settings and then follows the host', () => {
    const state = reduceAll([
      host({ ...init, settings: { ...testSettings, initialPermissionMode: 'plan' } }),
    ])
    expect(state.permissionMode).toBe('plan')
    expect(state.effort).toBe('high')
    expect(state.isThinkingEnabled).toBe(true)
    const updated = uiReducer(
      state,
      host({
        type: 'composerState',
        effort: 'max',
        isThinkingEnabled: false,
        permissionMode: 'bypassPermissions',
      }),
    )
    expect(updated).toMatchObject({
      effort: 'max',
      isThinkingEnabled: false,
      permissionMode: 'bypassPermissions',
    })
  })

  it('stores model and skill lists, and looks context limits up on model changes', () => {
    const state = reduceAll([
      host({
        type: 'modelList',
        models: [
          { modelId: 'a', displayLabel: 'A', contextLimit: 100, isDefault: true },
          { modelId: 'b', displayLabel: 'B', isDefault: false },
        ],
      }),
      host({ type: 'skillList', skills: [{ selector: 's', displayName: 'S', description: '' }] }),
      host({ type: 'sessionInfo', modelId: 'a', contextLimit: 100 }),
      agent({ type: 'modelChanged', modelId: 'b' }),
    ])
    expect(state.models).toHaveLength(2)
    expect(state.skills).toHaveLength(1)
    expect(state.model).toEqual({ modelId: 'b', contextLimit: 100 })
    expect(uiReducer(state, agent({ type: 'modelChanged', modelId: 'a' })).model).toEqual({
      modelId: 'a',
      contextLimit: 100,
    })
  })

  it('tracks attachments: add (idempotent), remove, reject, clear', () => {
    const added = reduceAll([
      host({ type: 'attachmentAdded', attachment }),
      host({ type: 'attachmentAdded', attachment }),
    ])
    expect(added.attachments).toEqual([attachment])
    expect(uiReducer(added, { type: 'attachmentRemoved', id: 'att-1' }).attachments).toEqual([])
    const rejected = uiReducer(
      added,
      host({ type: 'attachmentRejected', name: 'x.pdf', reason: 'Only images' }),
    )
    expect(rejected.transcript).toEqual([
      { kind: 'notice', id: 'notice:1', level: 'warning', text: 'x.pdf: Only images' },
    ])
    expect(uiReducer(added, host({ type: 'attachmentsCleared' })).attachments).toEqual([])
  })

  it('keeps the latest mention results and queues inserts and focus requests', () => {
    const state = reduceAll([
      host({ type: 'mentionResults', requestId: 1, items: [{ path: 'a.ts', isFolder: false }] }),
      host({ type: 'mentionResults', requestId: 2, items: [] }),
      { type: 'insertRequested', text: '/fix-bug ' },
      { type: 'focusRequested' },
    ])
    expect(state.mentionResults).toEqual({ requestId: 2, items: [] })
    expect(state.pendingInsert).toBe('/fix-bug ')
    expect(state.focusRequests).toBe(2)
  })

  it('appends notices and clears the conversation locally', () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'itemStarted', itemId: 'm1', kind: 'agentMessage' }),
      host({ type: 'notice', level: 'error', text: 'Compaction failed' }),
      host({ type: 'attachmentAdded', attachment }),
    ])
    expect(state.transcript.at(-1)).toEqual({
      kind: 'notice',
      id: 'notice:1',
      level: 'error',
      text: 'Compaction failed',
    })
    const cleared = uiReducer(state, { type: 'conversationCleared' })
    expect(cleared.transcript).toEqual([])
    expect(cleared.attachments).toEqual([])
    expect(cleared.activeTurnId).toBeUndefined()
  })

  it('leaves the state alone for host-confirmed events', () => {
    const state = reduceAll([host(init)])
    expect(uiReducer(state, agent({ type: 'effortChanged', effort: 'low' }))).toBe(state)
    expect(uiReducer(state, agent({ type: 'approvalModeChanged', mode: 'allowAll' }))).toBe(state)
    expect(uiReducer(state, agent({ type: 'skillsChanged' }))).toBe(state)
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
