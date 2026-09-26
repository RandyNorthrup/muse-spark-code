import { describe, expect, it } from 'vitest'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  canSend,
  agentsOf,
  backgroundTasksOf,
  editsAfter,
  forkCutBefore,
  hasPendingRequest,
  initialUiState,
  isRunningTask,
  uiReducer,
  type UiAction,
  type UiState,
  userShellCommandOf,
  visibleEditorContext,
  referenceLabel,
  workflowsOf,
} from '../../src/webview/state/uiState'
import { toSnapshot, wireItemSchema } from '../../src/core/backends/musecode/sessionRecords'
import { testSettings } from './helpers/fakes'
import {
  QUESTION_CLARIFIED,
  SHELL_CALL_BACKGROUNDED,
  SHELL_CALL_STARTED,
  SHELL_CALL_STOPPED,
  USER_SHELL_COMPLETED,
  USER_SHELL_FAILED,
  USER_SHELL_STARTED,
} from './helpers/m46Capture'
import {
  WORKFLOW_CHILD_DONE,
  WORKFLOW_CHILD_ENDED,
  WORKFLOW_CHILD_ID,
  WORKFLOW_COMPLETED,
  WORKFLOW_ITEM_ID,
  WORKFLOW_MESSAGE,
  WORKFLOW_RUN_ID,
  WORKFLOW_RUNNING,
  WORKFLOW_SCHEDULED,
  WORKFLOW_STARTED,
  WORKFLOW_TOOL_ITEM,
  WORKFLOW_TURN_ID,
  WORKFLOW_USAGE,
} from './helpers/workflowFixtures'

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

/** A one-stage shell approval on tool row c1. */
const SHELL_APPROVAL = {
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
      host({
        type: 'authState',
        status: 'signedOut',
        detail: 'not logged in',
        backend: 'modelApi',
        methods: ['apiKey'],
      }),
      host({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 }),
    ])
    expect(state.auth).toEqual({
      status: 'signedOut',
      detail: 'not logged in',
      backend: 'modelApi',
      methods: ['apiKey'],
    })
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
      { kind: 'user', seq: 1, id: 'l1', text: 'hello', status: 'pending', attachments: [] },
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
    // A rejection is the composer banner now (M14), not a transcript notice.
    expect(rejected.transcript).toEqual([])
    expect(rejected.banner).toContain('Unsupported file type: x.pdf.')
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
      // A kind Muse Code may add later (workflow was one until M47).
      agent({
        type: 'itemStarted',
        item: { itemId: 's', kind: 'sideChat', status: 'inProgress', fallbackText: 'Explorer' },
      }),
      agent({
        type: 'itemCompleted',
        item: { itemId: 's', kind: 'sideChat', status: 'completed' },
      }),
      agent({
        type: 'itemCompleted',
        item: { itemId: 'c', kind: 'compaction', status: 'completed' },
      }),
    ])
    expect(state.transcript).toEqual([
      { kind: 'item', id: 's', itemKind: 'sideChat', status: 'completed', text: 'Explorer' },
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
    const requested = SHELL_APPROVAL
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

describe('uiReducer: account & usage and announcements (M8)', () => {
  const subscription = {
    observedAtMs: NOW,
    tier: 'muse-pro',
    window: { usedPercent: 12, resetsAtMs: NOW + 1, windowDurationMins: 300 },
    weekly: { usedPercent: 3, resetsAtMs: NOW + 2 },
  }

  it('keeps the last usage report, with or without a window, across a clear', () => {
    const withWindow = reduceAll([
      host(init),
      host({ type: 'usageReport', backend: 'museCode', subscription }),
    ])
    expect(withWindow.usageReport).toEqual({
      backend: 'museCode',
      subscription,
      account: undefined,
      insights: undefined,
    })
    const cleared = reduceAll(
      [host({ type: 'usageReport', backend: 'modelApi' }), { type: 'conversationCleared' }],
      withWindow,
    )
    expect(cleared.usageReport).toEqual({
      backend: 'modelApi',
      subscription: undefined,
      account: undefined,
      insights: undefined,
    })
  })

  it('announces turn ends, approvals, questions, failures, resumes and warnings, counting each', () => {
    const base = reduceAll([host(init), signedIn])
    const completed = reduceAll(
      [agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' })],
      base,
    )
    expect(completed.announcement).toEqual({ text: 'Muse finished responding', sequence: 1 })
    const twice = reduceAll(
      [agent({ type: 'turnCompleted', turnId: 't2', terminal: 'completed' })],
      completed,
    )
    expect(twice.announcement).toEqual({ text: 'Muse finished responding', sequence: 2 })
    expect(
      reduceAll([agent({ type: 'turnCompleted', turnId: 't3', terminal: 'cancelled' })], base)
        .announcement?.text,
    ).toBe('The turn was stopped')
    expect(
      reduceAll([agent({ type: 'turnCompleted', turnId: 't3', terminal: 'failed' })], base)
        .announcement?.text,
    ).toBe('The turn failed')
    expect(
      reduceAll([agent({ type: 'turnCompleted', turnId: 't3', terminal: 'retracted' })], base)
        .announcement,
    ).toBeUndefined()
    expect(
      reduceAll(
        [
          agent({
            type: 'approvalRequested',
            approvalId: 'a1',
            itemId: 'i1',
            toolName: 'bash',
            requirementId: { approvalId: 'a1', sourceIndex: 0 },
            subject: { kind: 'command', command: 'ls' },
            rawArgs: '{}',
            availableChoices: [],
            isProtectedWrite: false,
            isJudgeEscalated: false,
          }),
        ],
        base,
      ).announcement?.text,
    ).toBe('Approval needed for Bash')
    expect(
      reduceAll(
        [agent({ type: 'questionRequested', userInputId: 'q', itemId: 'i2', questions: [] })],
        base,
      ).announcement?.text,
    ).toBe('Muse asked a question')
    expect(
      reduceAll([host({ type: 'sendFailed', localId: 'l', reason: 'offline' })], base).announcement
        ?.text,
    ).toBe('offline')
    expect(
      reduceAll([host({ type: 'historyLoaded', sessionId: 's', items: [], todos: [] })], base)
        .announcement?.text,
    ).toBe('Conversation resumed')
    expect(
      reduceAll([host({ type: 'notice', level: 'warning', text: 'careful' })], base).announcement
        ?.text,
    ).toBe('careful')
    expect(
      reduceAll([host({ type: 'notice', level: 'info', text: 'fyi' })], base).announcement,
    ).toBeUndefined()
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
      seq: 2,
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
      seq: 1,
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

  it('tracks a subagent through its lifecycle and a backgrounded tool call (M14)', () => {
    const spawned = {
      itemId: 'sa1',
      kind: 'subagent',
      status: 'inProgress',
      turnId: 't1',
      role: 'explorer',
      objective: 'Map the workspace',
      subagentId: 'sub-1',
      childSessionId: 'child-1',
      depth: 1,
      controlStatus: 'running',
    }
    const usage = { inputTokens: 1000, outputTokens: 200, cachedTokens: 0, reasoningTokens: 0 }
    const call = {
      itemId: 'c1',
      kind: 'toolCall',
      status: 'inProgress',
      tool: 'powershell',
      args: '{}',
    }
    const state = reduceAll([
      host({ type: 'agentEvent', event: { type: 'itemStarted', item: spawned } }),
      host({ type: 'agentEvent', event: { type: 'itemUpdated', item: { ...spawned, usage } } }),
      host({ type: 'agentEvent', event: { type: 'itemStarted', item: call } }),
      host({
        type: 'agentEvent',
        event: {
          type: 'itemUpdated',
          item: { ...call, background: true, backgroundInitiator: 'user' },
        },
      }),
    ])
    expect(agentsOf(state)).toEqual([
      {
        kind: 'subagent',
        id: 'sa1',
        seq: 1,
        role: 'explorer',
        objective: 'Map the workspace',
        status: 'inProgress',
        controlStatus: 'running',
        subagentId: 'sub-1',
        childSessionId: 'child-1',
        depth: 1,
        durationMs: undefined,
        usage,
        resultSummary: undefined,
      },
    ])
    expect(backgroundTasksOf(state).map((task) => [task.id, task.backgroundInitiator])).toEqual([
      ['c1', 'user'],
    ])
    const done = reduceAll(
      [
        host({
          type: 'agentEvent',
          event: {
            type: 'itemCompleted',
            item: {
              ...spawned,
              status: 'completed',
              controlStatus: 'closed',
              durationMs: 1500,
              result: { summary: 'Mapped 12 files' },
            },
          },
        }),
        host({
          type: 'childTranscript',
          sessionId: 'child-1',
          name: 'Explorer',
          items: [
            { itemId: 'u', kind: 'userMessage', status: 'completed', text: 'Map the workspace' },
            { itemId: 'a', kind: 'agentMessage', status: 'completed', text: 'Mapped 12 files' },
          ],
        }),
      ],
      state,
    )
    expect(agentsOf(done)[0]).toMatchObject({
      status: 'completed',
      controlStatus: 'closed',
      durationMs: 1500,
      usage,
      resultSummary: 'Mapped 12 files',
    })
    expect(done.childTranscripts['child-1']?.name).toBe('Explorer')
    expect(done.childTranscripts['child-1']?.entries.map((entry) => entry.kind)).toEqual([
      'user',
      'assistant',
    ])
    const cleared = reduceAll([{ type: 'conversationCleared' }], done)
    expect(cleared.childTranscripts).toEqual({})
  })

  it('turns a rejected upload into the composer banner until dismissed (M14)', () => {
    const rejected = reduceAll([
      host({ type: 'attachmentRejected', name: 'audio.node', reason: 'not an image' }),
    ])
    expect(rejected.banner).toBe(
      'Unsupported file type: audio.node. Supported as uploads: images (PNG, JPEG, GIF, WebP). Other files go in as @ mentions inside the workspace, or by absolute path in the prompt for files outside it.',
    )
    expect(rejected.announcement?.text).toBe('audio.node: not an image')
    expect(rejected.transcript).toEqual([])
    expect(reduceAll([{ type: 'bannerDismissed' }], rejected).banner).toBeUndefined()
  })

  it('lists the completed edits after a message newest first for a rewind (M13)', () => {
    const edit = (itemId: string, status: string, patch: string) =>
      host({
        type: 'agentEvent',
        event: {
          type: 'itemCompleted',
          item: {
            itemId,
            kind: 'toolCall',
            status,
            tool: 'edit_file',
            args: '{}',
            patchRef: { id: patch, byteLen: 10 },
          },
        },
      })
    const state = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'one', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
      edit('e1', 'completed', 'p1'),
      edit('e2', 'completed', 'p2'),
      host({
        type: 'agentEvent',
        event: {
          type: 'itemCompleted',
          item: {
            itemId: 'r1',
            kind: 'toolCall',
            status: 'completed',
            tool: 'read_file',
            args: '{}',
          },
        },
      }),
      { type: 'submitted', localId: 'l2', text: 'two', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l2', turnId: 't2' }),
      edit('e3', 'failed', 'p3'),
    ])
    expect(editsAfter(state, 'l1')).toEqual([
      { itemId: 'e2', outputRef: 'p2' },
      { itemId: 'e1', outputRef: 'p1' },
    ])
    expect(editsAfter(state, 'l2')).toEqual([])
    expect(editsAfter(state, 'ghost')).toEqual([])
  })

  // M20: a subagent's edits live in its own transcript (M18), and before this
  // the rewind never saw them; edits from the conversation and its agents
  // now unwind in the reverse of the order they completed, wherever they
  // live, and only those completed after the message.
  it("rewinds a subagent's edits with the conversation's, newest completion first (M20)", () => {
    const edit = (itemId: string, turnId: string, patch: string) =>
      host({
        type: 'agentEvent',
        event: {
          type: 'itemCompleted',
          item: {
            itemId,
            kind: 'toolCall',
            status: 'completed',
            turnId,
            tool: 'edit_file',
            args: '{}',
            patchRef: { id: patch, byteLen: 10 },
          },
        },
      })
    const state = reduceAll([
      {
        type: 'submitted',
        localId: 'l0',
        text: 'before',
        attachments: [],
        contextLabel: undefined,
      },
      host({ type: 'turnAccepted', localId: 'l0', turnId: 't0' }),
      edit('e0', 't0', 'p0'),
      {
        type: 'submitted',
        localId: 'l1',
        text: 'delegate',
        attachments: [],
        contextLabel: undefined,
      },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
      edit('e1', 't1', 'p1'),
      host({
        type: 'agentEvent',
        event: {
          type: 'itemStarted',
          item: {
            itemId: 'sa1',
            kind: 'subagent',
            status: 'inProgress',
            turnId: 't1',
            role: 'alpha',
            objective: 'edit notes',
            subagentId: 'subagent-1',
            childSessionId: 'child-1',
          },
        },
      }),
      edit('c1', 'child-1', 'pc1'),
      edit('e2', 't1', 'p2'),
      edit('c2', 'child-1', 'pc2'),
    ])
    // The child's rows stayed out of the conversation…
    expect(state.transcript.map((entry) => entry.id)).toEqual(['l0', 'e0', 'l1', 'e1', 'sa1', 'e2'])
    expect(state.childTranscripts['child-1']?.entries.map((entry) => entry.id)).toEqual([
      'c1',
      'c2',
    ])
    // …and the rewind still unwinds them, interleaved by completion order.
    expect(editsAfter(state, 'l1')).toEqual([
      { itemId: 'c2', outputRef: 'pc2' },
      { itemId: 'e2', outputRef: 'p2' },
      { itemId: 'c1', outputRef: 'pc1' },
      { itemId: 'e1', outputRef: 'p1' },
    ])
    // The edit before the message is not in it; the earlier message sees all five.
    expect(editsAfter(state, 'l0').map((edit) => edit.itemId)).toEqual([
      'c2',
      'e2',
      'c1',
      'e1',
      'e0',
    ])
  })

  it('keeps the completion number a row took when a later snapshot of it arrives (M20)', () => {
    const snapshot = (status: string) =>
      host({
        type: 'agentEvent',
        event: {
          type: 'itemCompleted',
          item: {
            itemId: 'e1',
            kind: 'toolCall',
            status,
            tool: 'edit_file',
            args: '{}',
            patchRef: { id: 'p1', byteLen: 10 },
          },
        },
      })
    const first = reduceAll([
      { type: 'submitted', localId: 'l1', text: 'go', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
      snapshot('inProgress'),
    ])
    expect(first.transcript[1]).toMatchObject({ kind: 'tool', completedSeq: undefined })
    const done = reduceAll([snapshot('completed')], first)
    const stamped = done.transcript[1]
    expect(stamped).toMatchObject({ kind: 'tool', completedSeq: done.sequence })
    const again = reduceAll([snapshot('completed')], done)
    expect(again.transcript[1]).toMatchObject({ kind: 'tool', completedSeq: done.sequence })
    expect(again.sequence).toBe(done.sequence + 1)
  })

  it('cuts a replayed transcript before the chosen message', () => {
    const state = reduceAll([host(historyLoaded)])
    expect(forkCutBefore(state.transcript, 'u2')).toEqual({ type: 'afterTurn', lastTurnId: 't1' })
    expect(forkCutBefore(state.transcript, 'u1')).toEqual({ type: 'fresh' })
    expect(forkCutBefore(state.transcript, 'm1')).toBeUndefined()
  })
})

describe('uiReducer: voice dictation (M9)', () => {
  it('starts idle, follows the host, and announces listening and its end', () => {
    expect(initialUiState.dictation).toEqual({
      status: 'idle',
      reason: undefined,
      engine: 'system',
    })
    const starting = reduceAll([host({ type: 'dictationState', status: 'starting' })])
    expect(starting.dictation).toEqual({ status: 'starting', reason: undefined, engine: 'system' })
    expect(starting.announcement).toBeUndefined()
    const listening = uiReducer(starting, host({ type: 'dictationState', status: 'listening' }))
    expect(listening.announcement).toEqual({ text: 'Listening', sequence: 1 })
    const again = uiReducer(listening, host({ type: 'dictationState', status: 'listening' }))
    expect(again.announcement?.sequence).toBe(1)
    const stopped = uiReducer(again, host({ type: 'dictationState', status: 'idle' }))
    expect(stopped.announcement).toEqual({ text: 'Stopped listening', sequence: 2 })
    const cancelled = uiReducer(starting, host({ type: 'dictationState', status: 'idle' }))
    expect(cancelled.announcement).toBeUndefined()
  })

  it('keeps the reason for an unavailable microphone', () => {
    const state = reduceAll([
      host({ type: 'dictationState', status: 'unavailable', reason: 'No recogniser on Linux.' }),
    ])
    expect(state.dictation).toEqual({
      status: 'unavailable',
      reason: 'No recogniser on Linux.',
      engine: 'system',
    })
  })
})

describe('chat references (M17)', () => {
  it('holds the composer reference, labels the sent message with it, and clears it', () => {
    const reference = {
      intent: 'reply' as const,
      role: 'assistant',
      entryId: 'a1',
      text: 'Use   pnpm because it is fast and saves disk space on every install.',
    }
    let state = uiReducer(initialUiState, { type: 'referenceSet', reference })
    expect(state.reference).toEqual(reference)
    expect(referenceLabel(reference)).toBe(
      'Replying to: Use pnpm because it is fast and saves disk space on every in…',
    )
    state = uiReducer(state, {
      type: 'submitted',
      localId: 'l1',
      text: 'why?',
      attachments: [],
      contextLabel: undefined,
      reference,
    })
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'user',
      referenceLabel: 'Replying to: Use pnpm because it is fast and saves disk space on every in…',
    })
    state = uiReducer(state, {
      type: 'referenceSet',
      reference: { ...reference, intent: 'comment' },
    })
    expect(referenceLabel({ ...reference, intent: 'comment', text: 'short' })).toBe(
      'Commenting on: short',
    )
    state = uiReducer(state, { type: 'referenceCleared' })
    expect(state.reference).toBeUndefined()
    state = uiReducer(uiReducer(state, { type: 'referenceSet', reference }), {
      type: 'conversationCleared',
    })
    expect(state.reference).toBeUndefined()
  })
})

describe('subagent child output routing (M18)', () => {
  const at = 1000
  const run = (state: typeof initialUiState, event: AgentEvent) =>
    uiReducer(state, { type: 'hostMessage', message: { type: 'agentEvent', event }, at })

  it("keeps a child's items and deltas in the agent's transcript, not the conversation", () => {
    let state = run(initialUiState, {
      type: 'itemStarted',
      item: {
        itemId: 'sa1',
        kind: 'subagent',
        status: 'inProgress',
        turnId: 'parent-turn',
        role: 'alpha',
        objective: 'say ALPHA',
        subagentId: 'subagent-1',
        childSessionId: 'child-1',
      },
    })
    state = run(state, {
      type: 'itemStarted',
      item: {
        itemId: 'cm1',
        kind: 'agentMessage',
        status: 'inProgress',
        turnId: 'child-1',
        text: '',
      },
    })
    state = run(state, { type: 'textDelta', itemId: 'cm1', field: 'text', delta: 'ALP' })
    state = run(state, { type: 'textDelta', itemId: 'cm1', field: 'text', delta: 'HA' })
    // The deltas reach the child's entry, not the conversation, while it streams.
    expect(state.childTranscripts['child-1']?.entries[0]).toMatchObject({
      text: 'ALPHA',
      isStreaming: true,
    })
    expect(state.transcript).toHaveLength(1)
    state = run(state, {
      type: 'itemCompleted',
      item: {
        itemId: 'cm1',
        kind: 'agentMessage',
        status: 'completed',
        turnId: 'child-1',
        text: 'ALPHA',
      },
    })
    state = run(state, {
      type: 'itemCompleted',
      item: {
        itemId: 'pm1',
        kind: 'agentMessage',
        status: 'completed',
        turnId: 'parent-turn',
        text: 'DONE',
      },
    })
    expect(state.transcript.map((entry) => entry.kind)).toEqual(['subagent', 'assistant'])
    expect(state.childTranscripts['child-1']).toEqual({
      name: 'say ALPHA',
      entries: [{ kind: 'assistant', id: 'cm1', text: 'ALPHA', isStreaming: false }],
    })
    state = run(state, {
      type: 'itemCompleted',
      item: {
        itemId: 'sa1',
        kind: 'subagent',
        status: 'completed',
        turnId: 'parent-turn',
        subagentId: 'subagent-1',
        childSessionId: 'child-1',
        controlStatus: 'resultReady',
        result: { summary: 'ALPHA', text: 'ALPHA, as asked.' },
      },
    })
    expect(state.transcript[0]).toMatchObject({ kind: 'subagent', resultText: 'ALPHA, as asked.' })
  })
})

// --- M25 (PLAN.md D28): webview and UI state ---

function sent(localId: string): UiAction {
  return { type: 'submitted', localId, text: localId, attachments: [], contextLabel: undefined }
}

function acceptedAs(localId: string, turnId: string): UiAction {
  return host({ type: 'turnAccepted', localId, turnId })
}

function editItem(itemId: string, patch: string, turnId?: string) {
  return {
    itemId,
    kind: 'toolCall',
    status: 'completed',
    tool: 'edit_file',
    args: '{}',
    patchRef: { id: patch, byteLen: 10 },
    ...(turnId !== undefined && { turnId }),
  }
}

const agentRow = {
  itemId: 'sa1',
  kind: 'subagent',
  status: 'inProgress',
  turnId: 't1',
  objective: 'edit notes',
  subagentId: 'sub-1',
  childSessionId: 'child-1',
}

function childRead(items: readonly ItemSnapshot[]): UiAction {
  return host({ type: 'childTranscript', sessionId: 'child-1', items: [...items] })
}

function runningTool(itemId: string, extra: Partial<ItemSnapshot> = {}): UiAction {
  return agent({
    type: 'itemStarted',
    item: { itemId, kind: 'toolCall', status: 'inProgress', tool: 'powershell', ...extra },
  })
}

function toolEnded(status: string): UiAction {
  return agent({
    type: 'itemCompleted',
    item: { itemId: 'sh1', kind: 'toolCall', status, tool: 'powershell' },
  })
}

function outputChunk(offsetBytes: number, content: string): UiAction {
  return host({
    type: 'outputPage',
    itemId: 'i',
    outputRef: 'o',
    offsetBytes,
    byteLen: content.length,
    content,
    eof: false,
  })
}

function entryOf(state: UiState, id: string) {
  return state.transcript.find((entry) => entry.id === id)
}

describe("an agent's transcript read from its session (M25)", () => {
  // The M20 regression: the read gave every row a fresh arrival number, so a
  // rewind to any later message unwound the agent's edits too.
  it('places the rows after the agent that made them, not after every message', () => {
    const state = reduceAll([
      sent('l1'),
      acceptedAs('l1', 't1'),
      agent({ type: 'itemStarted', item: agentRow }),
      agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' }),
      sent('l2'),
      acceptedAs('l2', 't2'),
      agent({ type: 'itemCompleted', item: editItem('e2', 'p2', 't2') }),
      host({
        type: 'childTranscript',
        sessionId: 'child-1',
        items: [
          { itemId: 'cu', kind: 'userMessage', status: 'completed', text: 'edit notes' },
          editItem('c1', 'pc1'),
          editItem('c2', 'pc2'),
        ],
      }),
    ])
    expect(editsAfter(state, 'l2')).toEqual([{ itemId: 'e2', outputRef: 'p2' }])
    expect(editsAfter(state, 'l1').map((edit) => edit.itemId)).toEqual(['e2', 'c2', 'c1'])
    // The read rows are indexed, so a delta for one of them lands in the agent's transcript.
    const typed = uiReducer(
      state,
      agent({ type: 'textDelta', itemId: 'c1', field: 'output', delta: 'more' }),
    )
    expect(typed.childTranscripts['child-1']?.entries[1]).toMatchObject({ output: 'more' })
  })

  it('keeps the rows it already had live, with their numbers, and adds the rest', () => {
    const live = reduceAll([
      sent('l1'),
      acceptedAs('l1', 't1'),
      agent({ type: 'itemStarted', item: agentRow }),
      agent({ type: 'itemCompleted', item: editItem('c1', 'pc1', 'child-1') }),
    ])
    const liveSeq = live.childTranscripts['child-1']?.entries[0]
    const state = reduceAll(
      [
        sent('l2'),
        host({
          type: 'childTranscript',
          sessionId: 'child-1',
          name: 'Notes agent',
          items: [editItem('c1', 'pc1'), editItem('c3', 'pc3')],
        }),
      ],
      live,
    )
    const entries = state.childTranscripts['child-1']?.entries ?? []
    expect(entries.map((entry) => entry.id)).toEqual(['c1', 'c3'])
    expect(entries[0]).toBe(liveSeq)
    expect(state.childTranscripts['child-1']?.name).toBe('Notes agent')
    expect(editsAfter(state, 'l2')).toEqual([])
    expect(editsAfter(state, 'l1').map((edit) => edit.itemId)).toEqual(['c3', 'c1'])
  })

  it('keeps a second read of the same session below the next message', () => {
    const state = reduceAll([
      sent('l1'),
      acceptedAs('l1', 't1'),
      agent({ type: 'itemStarted', item: agentRow }),
      childRead([editItem('c1', 'pc1')]),
      sent('l2'),
      childRead([editItem('c1', 'pc1'), editItem('c4', 'pc4')]),
    ])
    expect(editsAfter(state, 'l2')).toEqual([])
    expect(editsAfter(state, 'l1').map((edit) => edit.itemId)).toEqual(['c4', 'c1'])
  })

  it('leaves the rows out of any rewind when no agent row names the session', () => {
    const state = reduceAll([
      sent('l1'),
      host({ type: 'childTranscript', sessionId: 'ghost', items: [editItem('g1', 'pg1')] }),
    ])
    expect(state.childTranscripts['ghost']?.entries[0]).toMatchObject({ completedSeq: undefined })
    expect(editsAfter(state, 'l1')).toEqual([])
  })
})

describe('the end of a turn settles what it left running (M25)', () => {
  const approval = {
    type: 'approvalRequested' as const,
    approvalId: 'a1',
    itemId: 'sh1',
    toolName: 'powershell',
    rawArgs: '{}',
    requirementId: { approvalId: 'a1', sourceIndex: 0 },
    subject: { kind: 'shell', command: 'ls' },
    availableChoices: [],
    isJudgeEscalated: false,
    isProtectedWrite: false,
  }

  it('stops the reply and the thought, interrupts the tools and drops the cards', () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      host(
        {
          type: 'agentEvent',
          event: {
            type: 'itemStarted',
            item: { itemId: 'r1', kind: 'reasoning', status: 'inProgress' },
          },
        },
        1000,
      ),
      agent({
        type: 'itemStarted',
        item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress', text: 'Look' },
      }),
      runningTool('sh1'),
      agent(approval),
      runningTool('q1', { tool: 'request_user_input' }),
      agent({ type: 'questionRequested', userInputId: 'u1', itemId: 'q1', questions: [] }),
      runningTool('bg1', { background: true }),
      host(
        {
          type: 'agentEvent',
          event: { type: 'turnCompleted', turnId: 't1', terminal: 'cancelled' },
        },
        4000,
      ),
    ])
    expect(state.activeTurnId).toBeUndefined()
    expect(entryOf(state, 'm1')).toMatchObject({ isStreaming: false, text: 'Look' })
    expect(entryOf(state, 'r1')).toMatchObject({ isStreaming: false, durationMs: 3000 })
    expect(entryOf(state, 'sh1')).toMatchObject({ status: 'interrupted', approval: undefined })
    expect(entryOf(state, 'q1')).toMatchObject({ status: 'interrupted', question: undefined })
    // A backgrounded tool runs on past its turn (M14).
    expect(entryOf(state, 'bg1')).toMatchObject({ status: 'inProgress', isBackground: true })
    expect(hasPendingRequest(state)).toBe(false)
    expect(state.announcement?.text).toBe('The turn was stopped')
    // The host's own final word on a row still wins.
    const late = uiReducer(
      state,
      agent({
        type: 'itemCompleted',
        item: { itemId: 'sh1', kind: 'toolCall', status: 'failed', tool: 'powershell' },
      }),
    )
    expect(entryOf(late, 'sh1')).toMatchObject({ status: 'failed' })
  })

  it('reads a failed turn out with its reason', () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'turnCompleted', turnId: 't1', terminal: 'failed', reason: 'CLI exited' }),
    ])
    expect(state.announcement?.text).toBe('The turn failed: CLI exited')
    expect(state.transcript).toEqual([{ kind: 'error', id: 'error:t1', text: 'CLI exited' }])
  })

  it("settles a subagent's own turn in its transcript and leaves the conversation running", () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'itemStarted', item: agentRow }),
      agent({ type: 'turnStarted', turnId: 'child-1' }),
      agent({
        type: 'itemStarted',
        item: { itemId: 'cm', kind: 'agentMessage', status: 'inProgress', turnId: 'child-1' },
      }),
      agent({ type: 'turnCompleted', turnId: 'child-1', terminal: 'completed' }),
    ])
    expect(state.activeTurnId).toBe('t1')
    expect(state.childTranscripts['child-1']?.entries[0]).toMatchObject({ isStreaming: false })
    expect(state.announcement).toBeUndefined()
    // An agent whose transcript holds nothing yet has nothing to settle.
    const empty = reduceAll([
      agent({
        type: 'itemStarted',
        item: { ...agentRow, itemId: 'sa2', childSessionId: 'child-2' },
      }),
    ])
    expect(
      uiReducer(empty, agent({ type: 'turnCompleted', turnId: 'child-2', terminal: 'completed' })),
    ).toBe(empty)
  })

  it('starts nothing when the acceptance of a turn arrives after its end', () => {
    const state = reduceAll([
      sent('l1'),
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' }),
      acceptedAs('l1', 't1'),
    ])
    expect(state.activeTurnId).toBeUndefined()
    expect(entryOf(state, 'l1')).toMatchObject({ status: 'sent', turnId: 't1' })
    expect(uiReducer(state, acceptedAs('l1', 't2')).activeTurnId).toBe('t2')
  })

  it('reads a tool failure out once, as the row shows it', () => {
    const state = reduceAll([runningTool('sh1'), toolEnded('failed')])
    expect(state.announcement).toEqual({ text: 'PowerShell: Failed', sequence: 1 })
    expect(uiReducer(state, toolEnded('failed')).announcement?.sequence).toBe(1)
    expect(uiReducer(state, toolEnded('rejected')).announcement?.text).toBe('PowerShell: Rejected')
  })
})

describe("a subagent's items before the row that names its session (M25)", () => {
  it('move to its transcript, deltas included, once the row arrives', () => {
    const state = reduceAll([
      sent('l1'),
      acceptedAs('l1', 't1'),
      agent({
        type: 'itemStarted',
        item: { itemId: 'cm1', kind: 'agentMessage', status: 'inProgress', turnId: 'child-1' },
      }),
      agent({ type: 'textDelta', itemId: 'cm1', field: 'text', delta: 'ALPHA' }),
      agent({ type: 'itemStarted', item: agentRow }),
      agent({ type: 'textDelta', itemId: 'cm1', field: 'text', delta: '!' }),
    ])
    expect(state.transcript.map((entry) => entry.id)).toEqual(['l1', 'sa1'])
    expect(state.childTranscripts['child-1']).toEqual({
      name: 'edit notes',
      entries: [{ kind: 'assistant', id: 'cm1', text: 'ALPHA!', isStreaming: true }],
    })
  })

  it("stay in the conversation when their turn turns out to be the conversation's", () => {
    const state = reduceAll([
      agent({
        type: 'itemStarted',
        item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress', turnId: 'resumed' },
      }),
      agent({ type: 'turnStarted', turnId: 'resumed' }),
      agent({ type: 'itemStarted', item: { ...agentRow, childSessionId: 'resumed-child' } }),
    ])
    expect(state.transcript.map((entry) => entry.id)).toEqual(['m1', 'sa1'])
    expect(state.strayItems).toEqual({})
  })
})

describe('clears, restores and refusals (M25)', () => {
  it("spends the echo of the panel's own clear, and clears for a keybinding", () => {
    const state = reduceAll([sent('l1'), { type: 'conversationCleared' }, sent('l2')])
    const echoed = uiReducer(state, host({ type: 'conversationCleared' }))
    expect(echoed.transcript.map((entry) => entry.id)).toEqual(['l2'])
    expect(echoed.pendingClearEchoes).toBe(0)
    const keybinding = uiReducer(echoed, host({ type: 'conversationCleared' }))
    expect(keybinding.transcript).toEqual([])
  })

  it('keeps a restored session id until a session is live or the user clears', () => {
    const restored: UiState = { ...initialUiState, restoredSessionId: 'old' }
    const warm = uiReducer(restored, host({ type: 'sessionInfo', modelId: 'm' }))
    expect(warm.restoredSessionId).toBe('old')
    expect(
      uiReducer(warm, host({ type: 'sessionInfo', modelId: 'm', sessionId: 's' }))
        .restoredSessionId,
    ).toBeUndefined()
    expect(
      uiReducer(warm, host({ type: 'historyLoaded', sessionId: 'old', items: [], todos: [] }))
        .restoredSessionId,
    ).toBeUndefined()
    expect(uiReducer(warm, { type: 'conversationCleared' }).restoredSessionId).toBeUndefined()
  })

  it('keeps a restored conversation only when the host holds its session live', () => {
    const restored: UiState = {
      ...initialUiState,
      draft: 'half typed',
      restoredSessionId: 'old',
      pendingRestore: { sessionId: 's1', isTranscriptOmitted: false },
      transcript: [
        { kind: 'assistant', id: 'm1', text: 'Working', isStreaming: true },
        {
          kind: 'tool',
          id: 'sh1',
          tool: 'powershell',
          args: '{}',
          status: 'inProgress',
          output: '',
          isBackground: false,
          approval: {
            approvalId: 'a1',
            requirementId: { approvalId: 'a1', sourceIndex: 0 },
            subject: { kind: 'shell' },
            rawArgs: '{}',
            availableChoices: [],
            isProtectedWrite: false,
            isJudgeEscalated: false,
          },
        },
      ],
    }
    const running = uiReducer(
      restored,
      host({ type: 'surfaceState', sessionId: 's1', activeTurnId: 't1' }),
    )
    expect(running.pendingRestore).toBeUndefined()
    expect(running.activeTurnId).toBe('t1')
    expect(running.transcript).toBe(restored.transcript)
    expect(hasPendingRequest(running)).toBe(true)
    const ended = uiReducer(restored, host({ type: 'surfaceState', sessionId: 's1' }))
    expect(entryOf(ended, 'm1')).toMatchObject({ isStreaming: false })
    expect(hasPendingRequest(ended)).toBe(false)
    const other = uiReducer(restored, host({ type: 'surfaceState', sessionId: 's2' }))
    expect(other.transcript).toEqual([])
    expect(other.draft).toBe('half typed')
    expect(other.restoredSessionId).toBe('old')
    const omitted = uiReducer(
      { ...initialUiState, pendingRestore: { sessionId: 's1', isTranscriptOmitted: true } },
      host({ type: 'surfaceState', sessionId: 's1' }),
    )
    expect(omitted.transcript).toMatchObject([
      { kind: 'notice', level: 'info', text: UI_TEXT.snapshotTooLong },
    ])
    // Without a restore the host's running turn is simply taken.
    expect(
      uiReducer(initialUiState, host({ type: 'surfaceState', sessionId: 's1', activeTurnId: 't9' }))
        .activeTurnId,
    ).toBe('t9')
  })

  it('brings the chips of a refused message back when the host still holds them', () => {
    const sent: readonly UiAction[] = [
      host({ type: 'attachmentAdded', attachment }),
      {
        type: 'submitted',
        localId: 'l1',
        text: 'see',
        attachments: [attachment],
        contextLabel: undefined,
      },
      host({ type: 'attachmentAdded', attachment: { ...attachment, id: 'att-2' } }),
    ]
    const refused = reduceAll([
      ...sent,
      host({ type: 'sendFailed', localId: 'l1', reason: 'Sign in first', attachmentsKept: true }),
    ])
    expect(refused.attachments.map((chip) => chip.id)).toEqual(['att-1', 'att-2'])
    expect(refused.unsentAttachments).toEqual({})
    expect(refused.attachmentsToRelease).toEqual([])
    // Without the host's word the images may be gone already: no chip names
    // one, and the host is asked to drop whatever it still holds.
    const unsure = reduceAll([
      ...sent,
      host({ type: 'sendFailed', localId: 'l1', reason: 'CLI exited' }),
    ])
    expect(unsure.attachments.map((chip) => chip.id)).toEqual(['att-2'])
    expect(unsure.attachmentsToRelease).toEqual(['att-1'])
    expect(entryOf(unsure, 'l1')).toMatchObject({ status: 'failed', attachments: [attachment] })
    const released = uiReducer(unsure, { type: 'attachmentsReleased', ids: ['att-1'] })
    expect(released.attachmentsToRelease).toEqual([])
    const accepted = reduceAll(
      [
        {
          type: 'submitted',
          localId: 'l2',
          text: 'again',
          attachments: [attachment],
          contextLabel: undefined,
        },
        acceptedAs('l2', 't2'),
        host({ type: 'sendFailed', localId: 'l2', reason: 'late' }),
      ],
      refused,
    )
    expect(accepted.attachments).toEqual([])
  })

  it('locks a question card once answered or cancelled', () => {
    const asked = reduceAll([
      agent({ type: 'questionRequested', userInputId: 'u1', itemId: 'q1', questions: [] }),
      { type: 'questionSubmitted', userInputId: 'u1' },
    ])
    expect(entryOf(asked, 'q1')).toMatchObject({ question: { isSubmitted: true } })
    expect(uiReducer(asked, { type: 'questionSubmitted', userInputId: 'other' })).toEqual(asked)
    // A warning leaves it locked; the error the host posts for a refused
    // answer or cancel opens it again for another try.
    const warned = uiReducer(asked, host({ type: 'notice', level: 'warning', text: 'careful' }))
    expect(entryOf(warned, 'q1')).toMatchObject({ question: { isSubmitted: true } })
    const refused = uiReducer(
      asked,
      host({ type: 'notice', level: 'error', text: 'The answer was not accepted: gone' }),
    )
    expect(entryOf(refused, 'q1')).toMatchObject({ question: { isSubmitted: false } })
    const idle = reduceAll([host({ type: 'notice', level: 'error', text: 'x' })])
    expect(idle.transcript).toHaveLength(1)
  })

  it('says why an image was refused for its size, and raises local notices', () => {
    const large = reduceAll([
      host({ type: 'attachmentRejected', name: 'big.png', reason: UI_TEXT.attachmentTooLarge }),
    ])
    expect(large.banner).toBe(`big.png: ${UI_TEXT.attachmentTooLarge}`)
    const refused = reduceAll([
      { type: 'attachmentRefused', name: 'many.png', reason: UI_TEXT.attachmentLimit },
    ])
    expect(refused.banner).toBe(`many.png: ${UI_TEXT.attachmentLimit}`)
    expect(refused.announcement?.text).toBe(`many.png: ${UI_TEXT.attachmentLimit}`)
    const noticed = reduceAll([{ type: 'noticeRaised', level: 'warning', text: 'careful' }])
    expect(noticed.transcript).toMatchObject([{ kind: 'notice', level: 'warning' }])
    expect(noticed.announcement?.text).toBe('careful')
  })

  it('chains output pages by offset and drops a page that does not follow', () => {
    const state = reduceAll([
      outputChunk(0, 'abc'),
      outputChunk(3, 'de'),
      outputChunk(3, 'de'),
      outputChunk(9, 'zz'),
    ])
    expect(state.outputPages['i:o']).toEqual({ content: 'abcde', isEof: false, nextOffset: 5 })
  })
})

describe('uiReducer: prompts the host moved on (D26)', () => {
  const approval = SHELL_APPROVAL
  const question = {
    type: 'questionRequested' as const,
    userInputId: 'u1',
    itemId: 'c2',
    questions: [],
  }
  const other = {
    type: 'itemStarted' as const,
    item: { itemId: 'c3', kind: 'toolCall', status: 'inProgress', tool: 'read_file' },
  }

  it('opens a card again after a decision the host did not take', () => {
    const decided = uiReducer(reduceAll([agent(approval)]), {
      type: 'approvalDecided',
      approvalId: 'a1',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    const reopened = uiReducer(decided, host({ type: 'approvalReopened', approvalId: 'a1' }))
    expect(reopened.transcript[0]).toMatchObject({ approval: { approvalId: 'a1' } })
    expect(reopened.transcript[0]).not.toMatchObject({ approval: { decidedSourceIndex: 0 } })
  })

  it('drops the card of a prompt the host no longer holds, leaving other rows as they were', () => {
    const state = reduceAll([agent(approval), agent(question), agent(other)])
    const withoutApproval = uiReducer(state, host({ type: 'promptDropped', approvalId: 'a1' }))
    expect(withoutApproval.transcript[0]).toMatchObject({ kind: 'tool', id: 'c1' })
    expect(withoutApproval.transcript[0]).not.toHaveProperty('approval', expect.anything())
    expect(withoutApproval.transcript[1]).toBe(state.transcript[1])
    expect(withoutApproval.transcript[2]).toBe(state.transcript[2])
    const withoutQuestion = uiReducer(
      withoutApproval,
      host({ type: 'promptDropped', userInputId: 'u1' }),
    )
    expect(withoutQuestion.transcript[1]).not.toHaveProperty('question', expect.anything())
    expect(hasPendingRequest(withoutQuestion)).toBe(false)
  })

  it('follows whether the host offers rename and fork', () => {
    const refused = uiReducer(
      initialUiState,
      host({ type: 'sessionInfo', modelId: 'm', sessionId: 's1', canEditSessions: false }),
    )
    expect(refused.canEditSessions).toBe(false)
    const offered = uiReducer(refused, host({ type: 'sessionInfo', modelId: 'm', sessionId: 's1' }))
    expect(offered.canEditSessions).toBe(true)
  })

  it('leaves the controller’s own events alone', () => {
    const state = reduceAll([agent(approval)])
    expect(uiReducer(state, agent({ type: 'viewGap' }))).toBe(state)
    expect(uiReducer(state, agent({ type: 'backendNotice', level: 'info', text: 'x' }))).toBe(state)
  })

  it('marks a withdrawn queued message without ending the running turn', () => {
    const running = reduceAll([
      host(init),
      { type: 'submitted', localId: 'l1', text: 'first', attachments: [], contextLabel: undefined },
      host({ type: 'turnAccepted', localId: 'l1', turnId: 't1' }),
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent(other),
      {
        type: 'submitted',
        localId: 'l2',
        text: 'queued',
        attachments: [],
        contextLabel: undefined,
      },
      host({ type: 'turnAccepted', localId: 'l2', turnId: 't2' }),
    ])
    const withdrawn = uiReducer(
      running,
      agent({ type: 'turnWithdrawn', turnId: 't2', reason: 'Not sent: withdrawn' }),
    )
    expect(withdrawn.transcript.find((entry) => entry.id === 'l2')).toMatchObject({
      status: 'failed',
      reason: 'Not sent: withdrawn',
    })
    expect(withdrawn.transcript.find((entry) => entry.id === 'l1')).toMatchObject({
      status: 'sent',
    })
    // The running tool row stays running.
    expect(withdrawn.transcript.find((entry) => entry.id === 'c3')).toMatchObject({
      status: 'inProgress',
    })
  })

  it('keeps the running turn and the usage when the same session is read again', () => {
    const before = reduceAll([
      host(init),
      host({ type: 'sessionInfo', modelId: 'm', sessionId: 's1' }),
      agent({ type: 'tokenUsage', inputTokens: 10, outputTokens: 2 }),
    ])
    const reloaded = uiReducer(
      before,
      host({ type: 'historyLoaded', sessionId: 's1', items: [], todos: [], activeTurnId: 't9' }),
    )
    expect(reloaded.activeTurnId).toBe('t9')
    expect(reloaded.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
    const other = uiReducer(
      before,
      host({ type: 'historyLoaded', sessionId: 's2', items: [], todos: [] }),
    )
    expect(other.activeTurnId).toBeUndefined()
    expect(other.usage).toBeUndefined()
  })
})

describe('uiReducer: paid features (M33, PLAN.md D30)', () => {
  it('keeps the host’s paid state', () => {
    const paid = {
      features: ['voice' as const],
      tally: { webSearches: 1, images: 0, voiceSeconds: 3 },
      isKeyStored: false,
    }
    expect(reduceAll([host({ type: 'paidState', state: paid })]).paid).toEqual(paid)
  })

  it('keeps a row’s paid mark and a reply’s sources through their updates', () => {
    const state = reduceAll([
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({
        type: 'itemStarted',
        item: {
          itemId: 'ws',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'web_search',
          paid: 'webSearch',
        },
      }),
      agent({
        type: 'itemCompleted',
        item: { itemId: 'ws', kind: 'toolCall', status: 'completed', args: '{"query":"q"}' },
      }),
      agent({
        type: 'itemCompleted',
        item: { itemId: 'm', kind: 'agentMessage', status: 'completed', text: 'A' },
      }),
      agent({
        type: 'itemUpdated',
        item: {
          itemId: 'm',
          kind: 'agentMessage',
          status: 'completed',
          text: 'A',
          citations: [{ url: 'https://a.example', title: 'A' }],
        },
      }),
    ])
    expect(state.transcript).toEqual([
      expect.objectContaining({ id: 'ws', paid: 'webSearch', status: 'completed' }),
      expect.objectContaining({ id: 'm', citations: [{ url: 'https://a.example', title: 'A' }] }),
    ])
  })

  it('says which engine the microphone uses', () => {
    const state = reduceAll([
      host({ type: 'dictationState', status: 'listening', engine: 'museVoice' }),
    ])
    expect(state.dictation.engine).toBe('museVoice')
  })
})

// --- M43 (PLAN.md D36): Muse Code's own tools ---

describe('Muse Code tool rows in the state (M43)', () => {
  const movedBehind = JSON.stringify({
    execution_state: 'background_running',
    work_id: 'work.v1.managed_bash.sha256.d48e',
    output: '',
  })

  it('keeps a shell call Muse Code moved to the background running past its turn', () => {
    const state = reduceAll([
      signedIn,
      runningTool('bg', { visibleOutput: movedBehind }),
      agent({
        type: 'itemUpdated',
        item: { itemId: 'plain', kind: 'toolCall', status: 'inProgress', tool: 'powershell' },
      }),
      runningTool('plain'),
      agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' }),
    ])
    expect(entryOf(state, 'bg')).toMatchObject({ status: 'inProgress', isBackground: true })
    expect(entryOf(state, 'plain')).toMatchObject({ status: 'interrupted', isBackground: false })
    expect(backgroundTasksOf(state).map((task) => task.id)).toEqual(['bg'])
  })

  it('takes JSON a command printed for output, not for a background run (the review of PR #29)', () => {
    const state = reduceAll([
      signedIn,
      runningTool('json', { visibleOutput: '{"execution_state":"background_running"}' }),
      agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' }),
    ])
    expect(entryOf(state, 'json')).toMatchObject({ status: 'interrupted', isBackground: false })
  })

  it('marks a row backgrounded when an update says so, and keeps the mark once it ends', () => {
    const state = reduceAll([
      signedIn,
      runningTool('bg'),
      agent({
        type: 'itemUpdated',
        item: {
          itemId: 'bg',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'powershell',
          visibleOutput: movedBehind,
        },
      }),
      agent({
        type: 'itemCompleted',
        item: {
          itemId: 'bg',
          kind: 'toolCall',
          status: 'completed',
          tool: 'powershell',
          visibleOutput: 'done',
        },
      }),
    ])
    expect(entryOf(state, 'bg')).toMatchObject({ status: 'completed', isBackground: true })
  })

  it('keeps the image paths a tool reported the model saw', () => {
    const state = reduceAll([
      signedIn,
      runningTool('shot', {
        tool: 'mcp__ide__screenshot',
        modelVisibleContent: [
          { type: 'image', path: 'shot.png', mediaType: 'image/png' },
          { type: 'audio', path: 'clip.wav', mediaType: 'audio/wav' },
          // Shapes that differ are passed over, not fatal (the review of PR #29).
          42,
          { type: 'image', uri: 'elsewhere.png' },
        ],
      }),
    ])
    expect(entryOf(state, 'shot')).toMatchObject({ images: ['shot.png'] })
  })

  it('holds the pictures the host loaded or refused, per row and path, and drops them on resume', () => {
    const loaded = reduceAll([
      host({ type: 'toolImage', itemId: 'r', path: 'a.png', dataUri: 'data:image/png;base64,AA' }),
      host({ type: 'toolImage', itemId: 'r', path: 'b.png', error: 'too large' }),
      host({ type: 'toolImage', itemId: 'r', path: 'c.png' }),
    ])
    expect(loaded.toolImages).toEqual({
      'r\na.png': { kind: 'loaded', dataUri: 'data:image/png;base64,AA' },
      'r\nb.png': { kind: 'failed', reason: 'too large' },
      'r\nc.png': { kind: 'failed', reason: 'The image could not be shown' },
    })
    const resumed = uiReducer(
      loaded,
      host({ type: 'historyLoaded', sessionId: 's2', items: [], todos: [] }),
    )
    expect(resumed.toolImages).toEqual({})
  })
})

describe('uiReducer: the session goal (M45)', () => {
  const goal = { objective: 'Ship it', status: 'active', percentComplete: 0 }
  const withGoal = reduceAll([
    host({ type: 'sessionInfo', modelId: 'm', sessionId: 's1' }),
    agent({ type: 'goalChanged', goal }),
  ])
  /** The goal after a history load of session s1 (or the message's) over `withGoal`. */
  const loaded = (message: Partial<Extract<HostToWebviewMessage, { type: 'historyLoaded' }>>) =>
    uiReducer(
      withGoal,
      host({ type: 'historyLoaded', sessionId: 's1', items: [], todos: [], ...message }),
    ).goal

  it('holds the goal and reads a change of status out, not a move of progress', () => {
    expect(withGoal.goal).toEqual(goal)
    expect(withGoal.announcement?.text).toBe('Goal: Active')
    const progressed = uiReducer(
      withGoal,
      agent({ type: 'goalChanged', goal: { ...goal, percentComplete: 40, currentWork: 'Tests' } }),
    )
    expect(progressed.goal).toMatchObject({ percentComplete: 40, currentWork: 'Tests' })
    expect(progressed.announcement).toBe(withGoal.announcement)
    const paused = uiReducer(
      progressed,
      agent({ type: 'goalChanged', goal: { ...goal, status: 'paused' } }),
    )
    expect(paused.announcement?.text).toBe('Goal: Paused')
    // A status Muse Code adds later is read as it came.
    const odd = uiReducer(
      paused,
      agent({ type: 'goalChanged', goal: { ...goal, status: 'superseded' } }),
    )
    expect(odd.announcement?.text).toBe('Goal: superseded')
    const cleared = uiReducer(odd, agent({ type: 'goalChanged', goal: null }))
    expect(cleared.goal).toBeUndefined()
    expect(cleared.announcement?.text).toBe(UI_TEXT.goalClearedNotice)
    // Nothing to clear says nothing.
    expect(uiReducer(cleared, agent({ type: 'goalChanged', goal: null })).announcement).toBe(
      cleared.announcement,
    )
  })

  it("takes a history's goal, keeps the same session's when the history cannot say", () => {
    const other = { ...goal, objective: 'Other' }
    expect(loaded({ goal: other })).toEqual(other)
    expect(loaded({ goal: null })).toBeUndefined()
    expect(loaded({})).toEqual(goal)
    expect(loaded({ sessionId: 's2' })).toBeUndefined()
  })

  it('reconciles an open goal editor with a recovered history goal', () => {
    const editing = uiReducer(withGoal, { type: 'goalEditStarted', objective: goal.objective })
    const staleDraft = uiReducer(editing, { type: 'goalEditChanged', draft: 'Stale draft' })
    const history: Extract<HostToWebviewMessage, { type: 'historyLoaded' }> = {
      type: 'historyLoaded',
      sessionId: 's1',
      items: [],
      todos: [],
    }
    const changed = uiReducer(
      staleDraft,
      host({ ...history, goal: { ...goal, objective: 'Recovered objective' } }),
    )
    expect(changed.goalEdit).toMatchObject({ draft: 'Recovered objective', pending: undefined })
    const cleared = uiReducer(staleDraft, host({ ...history, goal: null }))
    expect(cleared.goalEdit).toBeUndefined()

    const pending = uiReducer(editing, {
      type: 'goalEditSubmitted',
      requestId: 'edit-1',
      objective: 'Own edit',
    })
    const newerDraft = uiReducer(pending, { type: 'goalEditChanged', draft: 'Newer typing' })
    const ownEdit = uiReducer(
      newerDraft,
      host({ ...history, goal: { ...goal, objective: 'Own edit' } }),
    )
    expect(ownEdit.goalEdit?.draft).toBe('Newer typing')
  })

  it('clears an old pending goal command when History switches sessions', () => {
    const pending = uiReducer(withGoal, { type: 'goalSubmitted', requestId: 'old-goal' })
    expect(pending.pendingGoalCommand).toBeDefined()
    const switched = uiReducer(
      pending,
      host({ type: 'historyLoaded', sessionId: 's2', items: [], todos: [] }),
    )
    expect(switched.pendingGoalCommand).toBeUndefined()
  })

  it('drops the goal with the conversation', () => {
    expect(uiReducer(withGoal, { type: 'conversationCleared' }).goal).toBeUndefined()
    expect(uiReducer(withGoal, host({ type: 'conversationCleared' })).goal).toBeUndefined()
  })
})

// --- M46: background work, the user's `!` commands, explanations ---

/** A captured wire item as the backend hands it to the panel (turnId null dropped). */
function snapshotOf(frame: { readonly item: Record<string, unknown> }): ItemSnapshot {
  return toSnapshot(wireItemSchema.parse(frame.item))
}

describe('uiReducer: the user’s own shell commands (M46)', () => {
  it('shows a `!` command as its own row, from start to end, outside any turn', () => {
    const started = reduceAll([
      host(init),
      agent({ type: 'itemStarted', item: snapshotOf(USER_SHELL_STARTED) }),
    ])
    expect(started.transcript).toEqual([
      {
        kind: 'userShell',
        id: USER_SHELL_STARTED.item.itemId,
        command: "Write-Output 'hello-m46'",
        status: 'inProgress',
        output: '',
        exitCode: undefined,
        exitSignal: undefined,
        durationMs: undefined,
        outputRef: undefined,
        failureReason: undefined,
        taskRequest: undefined,
      },
    ])
    const done = reduceAll(
      [
        agent({
          type: 'textDelta',
          itemId: USER_SHELL_STARTED.item.itemId,
          field: 'output',
          delta: 'hel',
        }),
        agent({ type: 'itemCompleted', item: snapshotOf(USER_SHELL_COMPLETED) }),
      ],
      started,
    )
    expect(done.transcript[0]).toMatchObject({
      kind: 'userShell',
      status: 'completed',
      output: 'hello-m46\r\n',
      exitCode: 0,
      durationMs: 563,
    })
  })

  it('leaves a running `!` command alone when a turn ends, and reads its failure out', () => {
    const state = reduceAll([
      host(init),
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'itemStarted', item: snapshotOf(USER_SHELL_STARTED) }),
      agent({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' }),
    ])
    expect(state.transcript[0]).toMatchObject({ kind: 'userShell', status: 'inProgress' })
    const failed = reduceAll(
      [agent({ type: 'itemCompleted', item: snapshotOf(USER_SHELL_FAILED) })],
      state,
    )
    expect(failed.announcement?.text).toBe(`${UI_TEXT.userShellLabel}: ${UI_TEXT.toolFailed}`)
  })

  it('rebuilds `!` rows from a session’s history', () => {
    const state = reduceAll([
      host(init),
      host({
        type: 'historyLoaded',
        sessionId: 's1',
        items: [snapshotOf(USER_SHELL_COMPLETED), snapshotOf(USER_SHELL_FAILED)],
        todos: [],
      }),
    ])
    expect(state.transcript.map((entry) => [entry.kind, entry.id])).toEqual([
      ['userShell', USER_SHELL_COMPLETED.item.itemId],
      ['userShell', USER_SHELL_FAILED.item.itemId],
    ])
  })

  it('brings a refused command back to an empty prompt, never over a new draft', () => {
    const refused = host({
      type: 'userShellRefused',
      command: 'ls',
      reason: UI_TEXT.userShellRestricted,
    })
    const empty = reduceAll([host(init), refused])
    expect(empty.draft).toBe('!ls')
    expect(empty.transcript.at(-1)).toMatchObject({
      kind: 'notice',
      level: 'warning',
      text: UI_TEXT.userShellRestricted,
    })
    expect(empty.announcement?.text).toBe(UI_TEXT.userShellRestricted)
    const typed = reduceAll([host(init), { type: 'draftChanged', draft: 'new' }, refused])
    expect(typed.draft).toBe('new')
  })

  it('sends `!command` as a command, and never a bare `!`', () => {
    const ready = reduceAll([host(init), signedIn])
    expect(userShellCommandOf(' !git status ')).toBe('git status')
    expect(userShellCommandOf('what is !important')).toBeUndefined()
    expect(canSend({ ...ready, draft: '!' })).toBe(false)
    expect(canSend({ ...ready, draft: '! ' })).toBe(false)
    expect(canSend({ ...ready, draft: '!ls' })).toBe(true)
  })
})

describe('uiReducer: background tasks and their buttons (M46)', () => {
  it('marks the call Muse Code moved, keeps it past its turn, and reads a stop as stopped', () => {
    const moved = reduceAll([
      host(init),
      agent({ type: 'turnStarted', turnId: SHELL_CALL_STARTED.item.turnId }),
      agent({ type: 'itemStarted', item: snapshotOf(SHELL_CALL_STARTED) }),
      { type: 'taskRequested', itemId: SHELL_CALL_STARTED.item.itemId, request: 'background' },
    ])
    expect(moved.transcript[0]).toMatchObject({ taskRequest: 'background' })
    const background = reduceAll(
      [
        agent({ type: 'itemUpdated', item: snapshotOf(SHELL_CALL_BACKGROUNDED) }),
        agent({
          type: 'turnCompleted',
          turnId: SHELL_CALL_STARTED.item.turnId,
          terminal: 'completed',
        }),
      ],
      moved,
    )
    const [row] = backgroundTasksOf(background)
    expect(row).toMatchObject({ status: 'inProgress', isBackground: true, taskRequest: undefined })
    expect(row !== undefined && isRunningTask(row)).toBe(true)
    const stopped = reduceAll(
      [agent({ type: 'itemCompleted', item: snapshotOf(SHELL_CALL_STOPPED) })],
      background,
    )
    const [ended] = backgroundTasksOf(stopped)
    expect(ended).toMatchObject({ status: 'cancelled' })
    expect(ended === undefined || isRunningTask(ended)).toBe(false)
    expect(stopped.announcement?.text).toBe(`PowerShell: ${UI_TEXT.toolStopped}`)
  })

  it('frees a button the host refused, and one the turn’s end overtook', () => {
    const asked = reduceAll([
      host(init),
      agent({ type: 'turnStarted', turnId: 't1' }),
      agent({ type: 'itemStarted', item: { ...snapshotOf(SHELL_CALL_STARTED), turnId: 't1' } }),
      { type: 'taskRequested', itemId: SHELL_CALL_STARTED.item.itemId, request: 'background' },
    ])
    const refused = reduceAll(
      [host({ type: 'taskRefused', itemId: SHELL_CALL_STARTED.item.itemId })],
      asked,
    )
    expect(refused.transcript[0]).toMatchObject({ taskRequest: undefined })
    const cutOff = reduceAll(
      [agent({ type: 'turnCompleted', turnId: 't1', terminal: 'cancelled' })],
      asked,
    )
    expect(cutOff.transcript[0]).toMatchObject({ status: 'interrupted', taskRequest: undefined })
  })

  it('keeps an explanation given instead of an answer (M46)', () => {
    const state = reduceAll([
      host(init),
      agent({
        type: 'questionRequested',
        userInputId: QUESTION_CLARIFIED.userInputId,
        itemId: 'q-row',
        questions: [],
      }),
      agent({
        type: 'questionSettled',
        userInputId: QUESTION_CLARIFIED.userInputId,
        outcome: 'clarified',
        answers: [],
        clarification: 'I prefer green.',
      }),
    ])
    expect(state.transcript[0]).toMatchObject({
      question: undefined,
      questionOutcome: { outcome: 'clarified', answers: [], clarification: 'I prefer green.' },
    })
  })
})

/** A workflow item re-sent whole, as `item/updated` or, at its end, `item/completed` (M47). */
function run(item: ItemSnapshot, type: 'itemUpdated' | 'itemCompleted' = 'itemUpdated'): UiAction {
  return agent({ type, item })
}

describe('workflow runs in the state (M47)', () => {
  it('builds the card from the captured frames, keeping what Muse Code drops as the agent moves on', () => {
    const early = reduceAll([
      signedIn,
      agent({ type: 'turnStarted', turnId: WORKFLOW_TURN_ID }),
      agent({ type: 'itemCompleted', item: WORKFLOW_TOOL_ITEM }),
      agent({ type: 'itemStarted', item: WORKFLOW_STARTED }),
      // The launching turn ended while the run went on (live 2026-09-25).
      agent({ type: 'turnCompleted', turnId: WORKFLOW_TURN_ID, terminal: 'completed' }),
      run(WORKFLOW_SCHEDULED),
      run(WORKFLOW_RUNNING),
    ])
    expect(entryOf(early, WORKFLOW_ITEM_ID)).toMatchObject({
      kind: 'workflow',
      status: 'inProgress',
      children: [{ childId: WORKFLOW_CHILD_ID, attempt: 1, status: 'started', label: 'ping' }],
    })
    const state = reduceAll(
      [
        run(WORKFLOW_USAGE),
        // A later turn runs and ends while the run's updates keep naming its own.
        agent({ type: 'turnStarted', turnId: 'next' }),
        agent({ type: 'turnCompleted', turnId: 'next', terminal: 'completed' }),
        run(WORKFLOW_CHILD_DONE),
        run(WORKFLOW_CHILD_ENDED),
        run(WORKFLOW_COMPLETED, 'itemCompleted'),
      ],
      early,
    )
    expect(entryOf(state, WORKFLOW_ITEM_ID)).toEqual({
      kind: 'workflow',
      id: WORKFLOW_ITEM_ID,
      status: 'completed',
      workflowRunId: WORKFLOW_RUN_ID,
      entryId: 'generated.model-chosen',
      scriptId: 'generated.workflow.generated.model-chosen',
      triggerSource: 'guidanceAuto',
      fallbackText: 'Workflow: model-chosen generated workflow',
      children: [
        {
          childId: WORKFLOW_CHILD_ID,
          attempt: 1,
          status: 'terminal',
          label: 'ping',
          phase: undefined,
          terminal: 'completed',
          durationMs: 2183,
          usage: { inputTokens: 9995, outputTokens: 135, cachedTokens: 5105, reasoningTokens: 70 },
        },
      ],
      message: WORKFLOW_MESSAGE,
    })
    expect(workflowsOf(state).map((workflow) => workflow.id)).toEqual([WORKFLOW_ITEM_ID])
    expect(state.strayItems).toEqual({})
    // The run keeps its place after the tool row that launched it.
    expect(state.transcript.map((entry) => entry.kind)).toEqual(['tool', 'workflow'])
  })

  it('reads each agent on its own: a shape that differs costs that agent or that field', () => {
    const state = reduceAll([
      signedIn,
      run({
        itemId: 'w',
        kind: 'workflow',
        status: 'inProgress',
        children: [
          { childId: 'a', attempt: 1, status: 'started', label: 7, usage: { inputTokens: 'x' } },
          { attempt: 1, status: 'started' },
          'not an agent',
          { childId: 'b', attempt: 1, status: 'waiting', phase: 'review', durationMs: '1s' },
        ],
      }),
    ])
    expect(entryOf(state, 'w')).toMatchObject({
      children: [
        { childId: 'a', status: 'started', label: undefined, usage: undefined },
        { childId: 'b', status: 'waiting', phase: 'review', durationMs: undefined },
      ],
    })
  })

  it('keeps an agent’s label and phase across a new attempt, and nothing else of the old one', () => {
    const agentOf = (children: readonly unknown[], status = 'inProgress') =>
      run({ itemId: 'w', kind: 'workflow', status, children: [...children] })
    const state = reduceAll([
      signedIn,
      agentOf([{ childId: 'a', attempt: 1, status: 'scheduled', label: 'lint', phase: 'check' }]),
      agentOf([
        {
          childId: 'a',
          attempt: 1,
          status: 'terminal',
          terminal: 'failed',
          durationMs: 900,
          usage: { inputTokens: 1, outputTokens: 2, cachedTokens: 0, reasoningTokens: 0 },
        },
      ]),
      agentOf([
        { childId: 'a', attempt: 2, status: 'started' },
        { childId: 'c', attempt: 1, status: 'scheduled' },
      ]),
      // An update without a list leaves the agents as they were.
      run({ itemId: 'w', kind: 'workflow', status: 'inProgress' }),
    ])
    expect(entryOf(state, 'w')).toMatchObject({
      children: [
        {
          childId: 'a',
          attempt: 2,
          status: 'started',
          label: 'lint',
          phase: 'check',
          terminal: undefined,
          durationMs: undefined,
          usage: undefined,
        },
        { childId: 'c', attempt: 1, status: 'scheduled' },
      ],
    })
  })

  it('brings a stored run back from history as its card', () => {
    const state = reduceAll([
      signedIn,
      host({
        type: 'historyLoaded',
        sessionId: 's1',
        items: [WORKFLOW_TOOL_ITEM, WORKFLOW_COMPLETED],
        todos: [],
      }),
    ])
    expect(state.transcript.map((entry) => entry.kind)).toEqual(['tool', 'workflow'])
    expect(entryOf(state, WORKFLOW_ITEM_ID)).toMatchObject({
      status: 'completed',
      children: [{ childId: WORKFLOW_CHILD_ID, terminal: 'completed' }],
      message: WORKFLOW_MESSAGE,
    })
  })
})
