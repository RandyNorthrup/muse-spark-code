import { describe, expect, it } from 'vitest'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'

const sessionId = 's1'

// Shapes below follow the live capture of 2026-09-21/22 (docs/certification/m4.md).
const choices = [
  { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  {
    choiceId: 'abort',
    label: 'Reject',
    decision: 'abort',
    scope: 'once',
    acceptsFeedback: true,
  },
]
const stages = [
  {
    requirementId: { approvalId: 'a1', sourceIndex: 0 },
    position: 1,
    totalStages: 2,
    argv: ['Set-Content', '-Path', 'x'],
    argvComplete: true,
    resolution: { kind: 'unresolved' },
  },
]
const subject = { kind: 'shell', command: 'Set-Content -Path x; Get-Content x', stages }
const colourQuestion = {
  id: 'colour',
  header: 'Colour',
  question: 'Which colour?',
  selection: { mode: 'single' },
  options: [{ label: 'Red' }, { label: 'Blue', description: 'cool' }],
}
const mappedSubject = {
  kind: 'shell',
  command: 'Set-Content -Path x; Get-Content x',
  stages: [
    {
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
      position: 1,
      totalStages: 2,
      argv: ['Set-Content', '-Path', 'x'],
    },
  ],
}

describe('mapNotification', () => {
  it.each([
    [
      'turn/started',
      { sessionId, turnId: 't1', viewCursor: 'v' },
      { type: 'turnStarted', turnId: 't1' },
    ],
    [
      'item/started',
      {
        sessionId,
        item: { itemId: 'i1', kind: 'agentMessage', status: 'inProgress', turnId: 't1', text: '' },
      },
      {
        type: 'itemStarted',
        item: { itemId: 'i1', kind: 'agentMessage', status: 'inProgress', turnId: 't1', text: '' },
      },
    ],
    [
      'item/started',
      {
        sessionId,
        item: {
          itemId: 'c1',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'edit_file',
          callId: 'call_1',
          args: '{"path":"notes.md"}',
          revision: 1,
        },
      },
      {
        type: 'itemStarted',
        item: {
          itemId: 'c1',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'edit_file',
          args: '{"path":"notes.md"}',
        },
      },
    ],
    [
      'item/delta',
      { sessionId, itemId: 'i1', delta: 'hel', field: 'text', viewCursor: 'v' },
      { type: 'textDelta', itemId: 'i1', field: 'text', delta: 'hel' },
    ],
    [
      'item/delta',
      { sessionId, itemId: 'i1', delta: 'lo', viewCursor: 'v' },
      { type: 'textDelta', itemId: 'i1', field: 'text', delta: 'lo' },
    ],
    [
      'item/updated',
      {
        sessionId,
        item: {
          itemId: 'c1',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'edit_file',
          args: '{}',
          patchSummary: { files: 1, added: 2, removed: 1 },
          patchRef: { id: 'tool_patch-1', kind: 'tool_patch', byteLen: 318, uri: 'u' },
        },
      },
      {
        type: 'itemUpdated',
        item: {
          itemId: 'c1',
          kind: 'toolCall',
          status: 'inProgress',
          tool: 'edit_file',
          args: '{}',
          patchSummary: { files: 1, added: 2, removed: 1 },
          patchRef: { id: 'tool_patch-1', byteLen: 318 },
        },
      },
    ],
    [
      'item/completed',
      {
        sessionId,
        item: {
          itemId: 'c2',
          kind: 'toolCall',
          status: 'failed',
          tool: 'powershell',
          args: '{"command":"ls"}',
          failureReason: 'environment failure',
          visibleOutput: 'tool failed: environment failure',
          outputRef: { id: 'out-1', kind: 'tool_output', byteLen: 40, uri: 'u' },
        },
      },
      {
        type: 'itemCompleted',
        item: {
          itemId: 'c2',
          kind: 'toolCall',
          status: 'failed',
          tool: 'powershell',
          args: '{"command":"ls"}',
          visibleOutput: 'tool failed: environment failure',
          failureReason: 'environment failure',
          outputRef: { id: 'out-1', byteLen: 40 },
        },
      },
    ],
    [
      'item/completed',
      {
        sessionId,
        item: { itemId: 'sh', kind: 'userShell', status: 'completed', turnId: null },
      },
      { type: 'itemCompleted', item: { itemId: 'sh', kind: 'userShell', status: 'completed' } },
    ],
    [
      'item/completed',
      {
        sessionId,
        item: {
          itemId: 'r1',
          kind: 'reasoning',
          status: 'completed',
          summary: ['first', 'second'],
        },
      },
      {
        type: 'itemCompleted',
        item: {
          itemId: 'r1',
          kind: 'reasoning',
          status: 'completed',
          summary: ['first', 'second'],
        },
      },
    ],
    [
      'turn/completed',
      { sessionId, turnId: 't1', terminal: 'completed', durationMs: 42 },
      { type: 'turnCompleted', turnId: 't1', terminal: 'completed', durationMs: 42 },
    ],
    [
      'turn/completed',
      {
        sessionId,
        turnId: 't1',
        terminal: 'failed',
        reason: 'not logged in',
        error: { kind: 'authRequired', message: 'not logged in', retryable: false },
      },
      {
        type: 'turnCompleted',
        turnId: 't1',
        terminal: 'failed',
        reason: 'not logged in',
        errorKind: 'authRequired',
      },
    ],
    [
      'turn/retryScheduled',
      {
        sessionId,
        turnId: 't1',
        attempt: 1,
        maxAttempts: 3,
        nextAttempt: 2,
        retryDelayMs: 5000,
        reason: 'rate limited',
      },
      {
        type: 'turnRetry',
        turnId: 't1',
        attempt: 1,
        maxAttempts: 3,
        retryDelayMs: 5000,
        reason: 'rate limited',
      },
    ],
    [
      'session/tokenUsage',
      {
        sessionId,
        modelId: 'muse-spark-1.3',
        usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, reasoningTokens: 1 },
      },
      {
        type: 'tokenUsage',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        reasoningTokens: 1,
        modelId: 'muse-spark-1.3',
      },
    ],
    [
      'session/tokenUsage',
      {
        sessionId,
        modelId: null,
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 },
      },
      { type: 'tokenUsage', inputTokens: 1, outputTokens: 1, cachedTokens: 0, reasoningTokens: 0 },
    ],
    [
      'session/contextUsage',
      { sessionId, usedTokens: 100, windowTokens: 1000, pressure: 'normal' },
      { type: 'contextUsage', usedTokens: 100, windowTokens: 1000, pressure: 'normal' },
    ],
    [
      'session/modelChanged',
      { sessionId, modelId: 'muse-spark-1.3', source: 'client' },
      { type: 'modelChanged', modelId: 'muse-spark-1.3' },
    ],
    [
      'session/statusChanged',
      { sessionId, status: 'running', attention: ['approvalPending'], viewCursor: 'v' },
      { type: 'sessionStatus', status: 'running' },
    ],
    [
      'session/nameChanged',
      { sessionId, name: 'Muse extension setup', viewCursor: 'v' },
      { type: 'sessionNamed', name: 'Muse extension setup' },
    ],
    [
      'session/reasoningEffortChanged',
      { sessionId, reasoningEffort: 'xhigh', source: 'user', viewCursor: 'v' },
      { type: 'effortChanged', effort: 'xhigh' },
    ],
    [
      'session/approvalModeChanged',
      { sessionId, mode: 'allowAll', source: 'approvalReconfigure', viewCursor: 'v' },
      { type: 'approvalModeChanged', mode: 'allowAll' },
    ],
    [
      'session/todoListChanged',
      {
        sessionId,
        revision: 2,
        sourceTool: 'todo',
        items: [
          { text: 'Write tests', status: 'inProgress', activeForm: 'Writing tests' },
          { text: 'Ship', status: 'pending' },
        ],
      },
      {
        type: 'todoChanged',
        items: [
          { text: 'Write tests', status: 'inProgress', activeForm: 'Writing tests' },
          { text: 'Ship', status: 'pending' },
        ],
      },
    ],
    ['skill/changed', { sessionId }, { type: 'skillsChanged' }],
    [
      'approval/requested',
      {
        sessionId,
        approvalId: 'a1',
        turnId: 't1',
        taskId: 'a1',
        itemId: 'c3',
        toolCallId: 'call_3',
        toolName: 'powershell',
        rawArgs: '{"command":"Set-Content -Path x"}',
        subject,
        currentRequirementId: { approvalId: 'a1', sourceIndex: 0 },
        availableChoices: choices,
        protectedWrite: false,
        judgeEscalated: true,
      },
      {
        type: 'approvalRequested',
        approvalId: 'a1',
        itemId: 'c3',
        toolName: 'powershell',
        rawArgs: '{"command":"Set-Content -Path x"}',
        requirementId: { approvalId: 'a1', sourceIndex: 0 },
        subject: mappedSubject,
        availableChoices: choices,
        isJudgeEscalated: true,
        isProtectedWrite: false,
      },
    ],
    [
      'approval/updated',
      {
        sessionId,
        approvalId: 'a1',
        currentRequirementId: { approvalId: 'a1', sourceIndex: 1 },
        subject,
        availableChoices: choices,
        change: { kind: 'stageResolved' },
      },
      {
        type: 'approvalUpdated',
        approvalId: 'a1',
        requirementId: { approvalId: 'a1', sourceIndex: 1 },
        subject: mappedSubject,
        availableChoices: choices,
      },
    ],
    [
      'approval/resolved',
      {
        sessionId,
        approvalId: 'a1',
        itemId: 'c3',
        decision: 'approved',
        resolvedBy: 'user',
        policyResult: 'allow',
        stageEvidence: [],
      },
      {
        type: 'approvalResolved',
        approvalId: 'a1',
        itemId: 'c3',
        decision: 'approved',
        resolvedBy: 'user',
      },
    ],
    [
      'userInput/requested',
      {
        sessionId,
        userInputId: 'q1',
        turnId: 't1',
        itemId: 'c4',
        toolCallId: 'call_4',
        toolName: 'request_user_input',
        questions: [colourQuestion],
      },
      {
        type: 'questionRequested',
        userInputId: 'q1',
        itemId: 'c4',
        questions: [colourQuestion],
      },
    ],
    [
      'userInput/settled',
      {
        sessionId,
        userInputId: 'q1',
        outcome: 'answered',
        answers: [{ questionId: 'colour', selectedLabel: 'Red' }],
        clarification: null,
        reason: null,
        decidedByCommandId: 'c',
      },
      {
        type: 'questionSettled',
        userInputId: 'q1',
        outcome: 'answered',
        answers: [{ questionId: 'colour', selectedLabel: 'Red' }],
      },
    ],
  ])('maps %s', (method, params, event) => {
    expect(mapNotification({ method, params })).toEqual({ sessionId, event })
  })

  it('ignores methods the UI does not consume', () => {
    expect(mapNotification({ method: 'view/gap', params: { sessionId } })).toBeUndefined()
    expect(mapNotification({ method: 'initialized' })).toBeUndefined()
  })

  it('ignores malformed params instead of throwing', () => {
    expect(
      mapNotification({ method: 'item/delta', params: { sessionId, itemId: 'i1' } }),
    ).toBeUndefined()
    expect(mapNotification({ method: 'turn/started', params: { turnId: 't1' } })).toBeUndefined()
    expect(
      mapNotification({ method: 'approval/requested', params: { sessionId, approvalId: 'a' } }),
    ).toBeUndefined()
  })
})
