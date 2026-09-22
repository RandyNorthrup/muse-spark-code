import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  canSend,
  forkCutBefore,
  hasPendingRequest,
  initialUiState,
  uiReducer,
  type UiAction,
  type UiState,
  visibleEditorContext,
} from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

const init: HostToWebviewMessage = {
  type: 'init',
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

const NOW = 1_000_000

function host(message: HostToWebviewMessage, at = NOW): UiAction {
  return { type: 'hostMessage', message, at }
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
      { type: 'submitted', localId: 'l1', text: 'hello', attachments: [], contextLabel: undefined },
    ])
    expect(state.draft).toBe('')
    expect(state.transcript).toEqual([
      { kind: 'user', id: 'l1', text: 'hello', status: 'pending', attachments: [] },
    ])
  })

  it('marks the echo sent and the turn active on turnAccepted', () => {
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'hello', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
    ])
    expect(state.transcript[0]).toMatchObject({ status: 'sent' })
    expect(state.activeTurnId).toBe('t1')
  })

  it('marks the echo failed with the reason on sendFailed', () => {
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'hello', attachments: [], contextLabel: undefined },
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
      {
        type: 'submitted',
        localId: 'l1',
        text: 'see image',
        attachments: [attachment],
        contextLabel: undefined,
      },
    ])
    expect(state.attachments).toEqual([])
    expect(state.transcript[0]).toMatchObject({ attachments: [attachment] })
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
      agent({
        type: 'itemStarted',
        item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress' },
      }),
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
      agent({
        type: 'itemStarted',
        item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress', turnId: 't1', text: '' },
      }),
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
          item: { itemId: 'm1', kind: 'agentMessage', status: 'completed', text: 'hello!' },
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

  it('hides host-internal items and renders unknown kinds generically', () => {
    const state = reduceAll([
      agent({
        type: 'itemStarted',
        item: { itemId: 'u', kind: 'userMessage', status: 'completed' },
      }),
      agent({
        type: 'itemStarted',
        item: { itemId: 'r', kind: 'reminderChild', status: 'inProgress' },
      }),
      agent({
        type: 'itemStarted',
        item: { itemId: 's', kind: 'subagent', status: 'inProgress', fallbackText: 'Explorer' },
      }),
      agent({
        type: 'itemCompleted',
        item: { itemId: 's', kind: 'subagent', status: 'completed' },
      }),
      agent({
        type: 'itemCompleted',
        item: { itemId: 'c', kind: 'compaction', status: 'completed' },
      }),
    ])
    expect(state.transcript).toEqual([
      { kind: 'item', id: 's', itemKind: 'subagent', status: 'completed', text: 'Explorer' },
      { kind: 'item', id: 'c', itemKind: 'compaction', status: 'completed', text: undefined },
    ])
  })

  it('folds tool calls: args, streamed output, updates with patch refs, failures', () => {
    const started = agent({
      type: 'itemStarted',
      item: {
        itemId: 'c1',
        kind: 'toolCall',
        status: 'inProgress',
        tool: 'edit_file',
        args: '{"path":"a"}',
      },
    })
    const state = reduceAll([
      started,
      agent({ type: 'textDelta', itemId: 'c1', field: 'output', delta: 'edi' }),
      agent({ type: 'textDelta', itemId: 'c1', field: 'output', delta: 'ted' }),
      agent({
        type: 'itemUpdated',
        item: {
          itemId: 'c1',
          kind: 'toolCall',
          status: 'inProgress',
          patchSummary: { files: 1, added: 2, removed: 1 },
          patchRef: { id: 'p', byteLen: 9 },
        },
      }),
    ])
    expect(state.transcript[0]).toMatchObject({
      kind: 'tool',
      tool: 'edit_file',
      args: '{"path":"a"}',
      output: 'edited',
      status: 'inProgress',
      patchSummary: { files: 1, added: 2, removed: 1 },
      patchRef: { id: 'p', byteLen: 9 },
    })
    const failed = uiReducer(
      state,
      agent({
        type: 'itemCompleted',
        item: {
          itemId: 'c1',
          kind: 'toolCall',
          status: 'failed',
          visibleOutput: 'tool failed',
          failureReason: 'path escapes workspace',
          outputRef: { id: 'o', byteLen: 3 },
        },
      }),
    )
    expect(failed.transcript[0]).toMatchObject({
      status: 'failed',
      output: 'tool failed',
      failureReason: 'path escapes workspace',
      outputRef: { id: 'o', byteLen: 3 },
    })
    // A completion for an item never started still creates the row.
    const late = reduceAll([
      agent({
        type: 'itemCompleted',
        item: { itemId: 'x', kind: 'toolCall', status: 'completed', tool: 'read_file' },
      }),
    ])
    expect(late.transcript[0]).toMatchObject({
      kind: 'tool',
      tool: 'read_file',
      status: 'completed',
    })
    // Deltas for fields the entry does not stream are ignored.
    expect(
      uiReducer(late, agent({ type: 'textDelta', itemId: 'x', field: 'text', delta: '?' })),
    ).toEqual(late)
  })

  it('folds reasoning summary parts and measures the duration from the clock', () => {
    const state = reduceAll([
      host(
        {
          type: 'agentEvent',
          event: {
            type: 'itemStarted',
            item: { itemId: 'r', kind: 'reasoning', status: 'inProgress' },
          },
        },
        1000,
      ),
      agent({ type: 'textDelta', itemId: 'r', field: 'summary.0', delta: 'first' }),
      agent({ type: 'textDelta', itemId: 'r', field: 'summary.2', delta: 'third' }),
    ])
    expect(state.transcript[0]).toMatchObject({
      kind: 'reasoning',
      parts: ['first', '', 'third'],
      isStreaming: true,
      startedAt: 1000,
      durationMs: undefined,
    })
    const done = uiReducer(
      state,
      host(
        {
          type: 'agentEvent',
          event: {
            type: 'itemCompleted',
            item: {
              itemId: 'r',
              kind: 'reasoning',
              status: 'completed',
              summary: ['first', 'second', 'third'],
            },
          },
        },
        15_200,
      ),
    )
    expect(done.transcript[0]).toMatchObject({
      parts: ['first', 'second', 'third'],
      isStreaming: false,
      durationMs: 14_200,
    })
    const raw = reduceAll([
      agent({
        type: 'itemCompleted',
        item: { itemId: 'r2', kind: 'reasoning', status: 'completed', text: 'raw text' },
      }),
    ])
    expect(raw.transcript[0]).toMatchObject({ kind: 'reasoning', parts: ['raw text'] })
  })

  it('attaches approvals to their tool row, follows stage updates, records the outcome', () => {
    const requested = {
      type: 'approvalRequested' as const,
      approvalId: 'a1',
      itemId: 'c1',
      toolName: 'powershell',
      rawArgs: '{"command":"ls"}',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
      subject: { kind: 'shell', command: 'ls' },
      availableChoices: [
        { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
      ],
      isJudgeEscalated: false,
      isProtectedWrite: false,
    }
    // Request before the item: a placeholder row is created from the request.
    const early = reduceAll([agent(requested)])
    expect(early.transcript[0]).toMatchObject({
      kind: 'tool',
      id: 'c1',
      tool: 'powershell',
      args: '{"command":"ls"}',
      approval: { approvalId: 'a1', requirementId: { sourceIndex: 0 } },
    })
    expect(hasPendingRequest(early)).toBe(true)
    // The user decides stage 0: the stage is locked until the host moves on,
    // and a repeated update for the same stage (seen live) keeps the lock.
    const decided = uiReducer(early, {
      type: 'approvalDecided',
      approvalId: 'a1',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    expect(decided.transcript[0]).toMatchObject({ approval: { decidedSourceIndex: 0 } })
    const repeated = uiReducer(
      decided,
      agent({
        type: 'approvalUpdated',
        approvalId: 'a1',
        requirementId: { approvalId: 'a1', sourceIndex: 0 },
        subject: { kind: 'shell', command: 'ls' },
        availableChoices: requested.availableChoices,
      }),
    )
    expect(repeated.transcript[0]).toMatchObject({
      approval: { requirementId: { sourceIndex: 0 }, decidedSourceIndex: 0 },
    })
    const updated = uiReducer(
      repeated,
      agent({
        type: 'approvalUpdated',
        approvalId: 'a1',
        requirementId: { approvalId: 'a1', sourceIndex: 1 },
        subject: { kind: 'shell', command: 'ls; pwd' },
        availableChoices: [
          { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
        ],
      }),
    )
    expect(updated.transcript[0]).toMatchObject({
      approval: {
        requirementId: { sourceIndex: 1 },
        subject: { command: 'ls; pwd' },
        availableChoices: [{ choiceId: 'abort' }],
        decidedSourceIndex: 0,
      },
    })
    // A decision for an approval nobody holds changes nothing.
    expect(
      uiReducer(updated, {
        type: 'approvalDecided',
        approvalId: 'zz',
        requirementId: { approvalId: 'zz', sourceIndex: 0 },
      }),
    ).toEqual(updated)
    const resolved = uiReducer(
      updated,
      agent({
        type: 'approvalResolved',
        approvalId: 'a1',
        itemId: 'c1',
        decision: 'approved',
        resolvedBy: 'user',
      }),
    )
    expect(resolved.transcript[0]).toMatchObject({
      approval: undefined,
      approvalOutcome: { decision: 'approved', resolvedBy: 'user' },
    })
    expect(hasPendingRequest(resolved)).toBe(false)
    // An update for an approval nobody holds changes nothing.
    expect(
      uiReducer(
        resolved,
        agent({
          type: 'approvalUpdated',
          approvalId: 'zz',
          requirementId: { approvalId: 'zz', sourceIndex: 0 },
          subject: { kind: 'shell' },
          availableChoices: [],
        }),
      ),
    ).toEqual(resolved)
  })

  it('attaches questions to their tool row and records the answers', () => {
    const question = {
      id: 'colour',
      header: 'Colour',
      question: 'Which?',
      selection: { mode: 'single' },
      options: [{ label: 'Red' }],
    }
    const state = reduceAll([
      agent({
        type: 'itemStarted',
        item: { itemId: 'q', kind: 'toolCall', status: 'inProgress', tool: 'request_user_input' },
      }),
      agent({ type: 'questionRequested', userInputId: 'u1', itemId: 'q', questions: [question] }),
    ])
    expect(state.transcript[0]).toMatchObject({
      question: { userInputId: 'u1', questions: [question] },
    })
    const early = reduceAll([
      agent({ type: 'questionRequested', userInputId: 'u2', itemId: 'q2', questions: [question] }),
    ])
    expect(early.transcript[0]).toMatchObject({
      kind: 'tool',
      id: 'q2',
      tool: 'request_user_input',
    })
    const settled = uiReducer(
      state,
      agent({
        type: 'questionSettled',
        userInputId: 'u1',
        outcome: 'answered',
        answers: [{ questionId: 'colour', selectedLabel: 'Red' }],
      }),
    )
    expect(settled.transcript[0]).toMatchObject({
      question: undefined,
      questionOutcome: {
        outcome: 'answered',
        answers: [{ questionId: 'colour', selectedLabel: 'Red' }],
      },
    })
  })

  it('keeps todos, the session name, retry notices and output pages', () => {
    const state = reduceAll([
      agent({ type: 'todoChanged', items: [{ text: 'a', status: 'pending' }] }),
      agent({ type: 'sessionNamed', name: 'Muse setup' }),
      agent({
        type: 'turnRetry',
        turnId: 't',
        attempt: 1,
        maxAttempts: 3,
        retryDelayMs: 5000,
        reason: 'rate limited',
      }),
      host({
        type: 'outputPage',
        itemId: 'i',
        outputRef: 'o',
        offsetBytes: 0,
        byteLen: 3,
        content: 'abc',
        eof: false,
      }),
      host({
        type: 'outputPage',
        itemId: 'i',
        outputRef: 'o',
        offsetBytes: 3,
        byteLen: 2,
        content: 'de',
        eof: true,
      }),
    ])
    expect(state.todos).toEqual([{ text: 'a', status: 'pending' }])
    expect(state.title).toBe('Muse setup')
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'notice',
      level: 'warning',
      text: 'Attempt 1/3 failed (rate limited); retrying in 5 s.',
    })
    expect(state.outputPages['i:o']).toEqual({ content: 'abcde', isEof: true, nextOffset: 5 })
    const cleared = uiReducer(state, { type: 'conversationCleared' })
    expect(cleared.todos).toEqual([])
    expect(cleared.title).toBeUndefined()
    expect(cleared.outputPages).toEqual({})
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

describe('uiReducer: editor context (M5)', () => {
  const context = { relativePath: 'src/a.ts', startLine: 1, endLine: 1, isEmpty: true }

  it('shows the host-reported editor while the setting is on', () => {
    const state = reduceAll([host(init), host({ type: 'editorContext', context })])
    expect(visibleEditorContext(state)).toEqual(context)
    const off = uiReducer(
      state,
      host({ type: 'settingsChanged', settings: { ...testSettings, attachOpenFile: false } }),
    )
    expect(visibleEditorContext(off)).toBeUndefined()
    expect(
      visibleEditorContext(uiReducer(state, host({ type: 'editorContext', context: undefined }))),
    ).toBeUndefined()
  })

  it('remembers a dismissal for that file only', () => {
    const shown = reduceAll([host(init), host({ type: 'editorContext', context })])
    const dismissed = uiReducer(shown, { type: 'editorContextDismissed' })
    expect(visibleEditorContext(dismissed)).toBeUndefined()
    // A selection change in the same file keeps it hidden.
    const moved = uiReducer(
      dismissed,
      host({
        type: 'editorContext',
        context: { ...context, startLine: 4, endLine: 6, isEmpty: false },
      }),
    )
    expect(visibleEditorContext(moved)).toBeUndefined()
    // Another file brings the chip back, and the dismissal is forgotten: the
    // first file shows again when it becomes active later.
    const other = uiReducer(
      moved,
      host({ type: 'editorContext', context: { ...context, relativePath: 'src/b.ts' } }),
    )
    expect(visibleEditorContext(other)).toMatchObject({ relativePath: 'src/b.ts' })
    const back = uiReducer(other, host({ type: 'editorContext', context }))
    expect(visibleEditorContext(back)).toEqual(context)
  })

  it('records the chip label on the submitted user card', () => {
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'hi', attachments: [], contextLabel: 'a.ts' },
    ])
    expect(state.transcript[0]).toMatchObject({ kind: 'user', contextLabel: 'a.ts' })
  })
})

describe('uiReducer: session history (M6)', () => {
  const userItem = {
    itemId: 'u1',
    kind: 'userMessage',
    status: 'completed',
    turnId: 't1',
    text: 'what does this do?',
    attachments: [{ type: 'image', mediaType: 'image/png', width: 2, height: 3 }],
  }
  const historyLoaded: HostToWebviewMessage = {
    type: 'historyLoaded',
    sessionId: 'old',
    name: 'Old session',
    todos: [{ text: 'finish', status: 'pending' }],
    items: [
      userItem,
      { itemId: 'r1', kind: 'reminderChild', status: 'completed' },
      { itemId: 'th', kind: 'reasoning', status: 'completed', summary: ['why'] },
      {
        itemId: 'c1',
        kind: 'toolCall',
        status: 'completed',
        tool: 'read_file',
        args: '{"path":"a.ts"}',
        visibleOutput: 'ok',
      },
      { itemId: 'm1', kind: 'agentMessage', status: 'completed', text: 'It reads a file.' },
      { itemId: 'u2', kind: 'userMessage', status: 'completed', turnId: 't2', text: 'thanks' },
    ],
  }

  it('records the session id with the session info and clears it with the conversation', () => {
    const state = reduceAll([
      host({ type: 'sessionInfo', modelId: 'm', contextLimit: 1, sessionId: 's1' }),
    ])
    expect(state.sessionId).toBe('s1')
    expect(uiReducer(state, { type: 'conversationCleared' }).sessionId).toBeUndefined()
  })

  it('keeps the session list and archived ids the host posts', () => {
    const row = {
      sessionId: 's1',
      title: 'T',
      isNamed: false,
      createdAt: 'c',
      updatedAt: 'u',
      status: 'idle',
      turnCount: 1,
      isFork: false,
    }
    const state = reduceAll([host({ type: 'sessionList', sessions: [row], archivedIds: ['x'] })])
    expect(state.sessions).toEqual([row])
    expect(state.archivedIds).toEqual(['x'])
  })

  it('rebuilds the transcript from stored items: user cards, hidden children, final rows', () => {
    const state = reduceAll([
      agent({
        type: 'itemStarted',
        item: { itemId: 'live', kind: 'agentMessage', status: 'inProgress', text: 'x' },
      }),
      agent({ type: 'turnStarted', turnId: 'live-turn' }),
      host(historyLoaded),
    ])
    expect(state.sessionId).toBe('old')
    expect(state.title).toBe('Old session')
    expect(state.todos).toEqual([{ text: 'finish', status: 'pending' }])
    expect(state.activeTurnId).toBeUndefined()
    expect(state.transcript.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'user:u1',
      'reasoning:th',
      'tool:c1',
      'assistant:m1',
      'user:u2',
    ])
    expect(state.transcript[0]).toEqual({
      kind: 'user',
      id: 'u1',
      text: 'what does this do?',
      status: 'sent',
      attachments: [{ id: 'u1:0', name: 'image/png', width: 2, height: 3 }],
      turnId: 't1',
    })
    expect(state.transcript[1]).toMatchObject({ parts: ['why'], isStreaming: false })
    expect(state.transcript[2]).toMatchObject({ tool: 'read_file', output: 'ok' })
    expect(state.transcript[3]).toEqual({
      kind: 'assistant',
      id: 'm1',
      text: 'It reads a file.',
      isStreaming: false,
    })
  })

  it('tolerates a user item without text, turn or attachments', () => {
    const state = reduceAll([
      host({
        type: 'historyLoaded',
        sessionId: 's',
        todos: [],
        items: [{ itemId: 'u', kind: 'userMessage', status: 'completed' }],
      }),
    ])
    expect(state.transcript[0]).toEqual({
      kind: 'user',
      id: 'u',
      text: '',
      status: 'sent',
      attachments: [],
    })
    expect(state.title).toBeUndefined()
  })

  it('keeps the turn id on a sent card so a fork can cut before it', () => {
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'one', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
      { type: 'submitted', localId: 'l2', text: 'two', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l2', turnId: 't2' }),
      { type: 'submitted', localId: 'l3', text: 'three', attachments: [], contextLabel: undefined },
    ])
    expect(state.transcript[0]).toMatchObject({ turnId: 't1' })
    expect(forkCutBefore(state.transcript, 'l1')).toEqual({ type: 'fresh' })
    expect(forkCutBefore(state.transcript, 'l2')).toEqual({ type: 'afterTurn', lastTurnId: 't1' })
    // A pending card (no turn yet) is not a fork point; a missing id neither.
    expect(forkCutBefore(state.transcript, 'l3')).toBeUndefined()
    expect(forkCutBefore(state.transcript, 'ghost')).toBeUndefined()
  })

  it('cuts a replayed transcript before the chosen message', () => {
    const state = reduceAll([host(historyLoaded)])
    expect(forkCutBefore(state.transcript, 'u2')).toEqual({ type: 'afterTurn', lastTurnId: 't1' })
    expect(forkCutBefore(state.transcript, 'u1')).toEqual({ type: 'fresh' })
    expect(forkCutBefore(state.transcript, 'm1')).toBeUndefined()
  })
})
