import { describe, expect, it } from 'vitest'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import { testSettings } from './helpers/fakes'

describe('parseWebviewToHostMessage', () => {
  it.each([
    ['ready', { type: 'ready' }],
    ['inputFocusChanged', { type: 'inputFocusChanged', focused: true }],
    ['sendMessage', { type: 'sendMessage', localId: 'l1', text: 'hi', attachmentIds: ['a'] }],
    ['cancelTurn', { type: 'cancelTurn' }],
    ['signIn', { type: 'signIn', method: 'browser' }],
    ['signOut', { type: 'signOut' }],
    ['retryBackend', { type: 'retryBackend' }],
    ['openExternal', { type: 'openExternal', url: 'https://dev.meta.ai/' }],
    ['setModel', { type: 'setModel', modelId: 'muse-spark-1.3' }],
    ['setEffort', { type: 'setEffort', effort: 'xhigh' }],
    ['setThinking', { type: 'setThinking', enabled: false }],
    ['setPermissionMode', { type: 'setPermissionMode', mode: 'plan' }],
    ['clearConversation', { type: 'clearConversation' }],
    ['clearConversation epoch', { type: 'clearConversation', attachmentEpoch: 2 }],
    ['compact', { type: 'compact' }],
    ['listSkills', { type: 'listSkills' }],
    ['searchMentions', { type: 'searchMentions', requestId: 3, query: 'app' }],
    ['pickFile', { type: 'pickFile' }],
    ['pickMentionFile', { type: 'pickMentionFile' }],
    [
      'attachImageData',
      { type: 'attachImageData', name: 'a.png', mediaType: 'image/png', base64: 'AAAA' },
    ],
    [
      'PDF attachment data',
      { type: 'attachImageData', name: 'report.pdf', mediaType: 'application/pdf', base64: 'AAAA' },
    ],
    [
      'browser attachment request',
      {
        type: 'attachImageData',
        name: 'report.pdf',
        mediaType: 'application/pdf',
        base64: 'AAAA',
        requestId: 'upload-1',
        attachmentEpoch: 2,
      },
    ],
    ['removeAttachment', { type: 'removeAttachment', id: 'att-1' }],
    ['droppedUris', { type: 'droppedUris', uris: ['file:///a.ts'] }],
    ['hostAction', { type: 'hostAction', action: 'openSettings' }],
    [
      'goalCommand set',
      { type: 'goalCommand', requestId: 'g1', verb: 'set', objective: 'Ship it' },
    ],
    ['goalCommand pause', { type: 'goalCommand', requestId: 'g2', verb: 'pause' }],
    [
      'subagent readResult',
      { type: 'subagentControl', subagentId: 'child-1', action: 'readResult' },
    ],
    ['subagent reopen', { type: 'subagentControl', subagentId: 'child-1', action: 'reopen' }],
    [
      'rewindConversation',
      {
        type: 'rewindConversation',
        sourceSessionId: 's1',
        itemId: 'u2',
        turnId: 't2',
        lastTurnId: 't1',
        text: 'again',
        imageCount: 0,
      },
    ],
    ['openSideChat', { type: 'openSideChat', sourceSessionId: 's1' }],
    ['savePlan', { type: 'savePlan', sourceSessionId: 's1', itemId: 'r1' }],
    ['implementPlan', { type: 'implementPlan', sourceSessionId: 's1', itemId: 'r1' }],
    ['showPlans', { type: 'showPlans' }],
  ])('accepts %s', (_label, message) => {
    expect(parseWebviewToHostMessage(message)).toEqual({ ok: true, message })
  })

  it.each([
    ['unknown type', { type: 'launch-missiles' }],
    ['missing type', {}],
    ['non-object', 'ready'],
    ['null', null],
    ['wrong field type', { type: 'inputFocusChanged', focused: 'yes' }],
    ['unknown sign-in method', { type: 'signIn', method: 'telepathy' }],
    ['sendMessage without localId', { type: 'sendMessage', text: 'hi', attachmentIds: [] }],
    ['sendMessage without attachmentIds', { type: 'sendMessage', localId: 'l', text: 'hi' }],
    ['effort outside the UI tiers', { type: 'setEffort', effort: 'ultra' }],
    ['unknown permission mode', { type: 'setPermissionMode', mode: 'yolo' }],
    ['unknown host action', { type: 'hostAction', action: 'formatDisk' }],
    ['unknown goal verb', { type: 'goalCommand', requestId: 'g3', verb: 'complete' }],
    ['goal command without request id', { type: 'goalCommand', verb: 'pause' }],
    ['goal command with numeric request id', { type: 'goalCommand', requestId: 1, verb: 'pause' }],
    [
      'workflow cancel remains deferred',
      { type: 'workflowCancel', sourceSessionId: 's1', workflowRunId: 'run-1' },
    ],
    [
      'workflow child control remains deferred',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: 'run-1',
        childId: 'c1',
        attempt: 1,
        action: 'skip',
      },
    ],
    ['rewind without a turn', { type: 'rewindConversation', text: 'again', imageCount: 0 }],
    [
      'rewind without a selected card',
      {
        type: 'rewindConversation',
        sourceSessionId: 's1',
        turnId: 't1',
        text: 'again',
        imageCount: 0,
      },
    ],
    [
      'rewind with invalid image count',
      {
        type: 'rewindConversation',
        sourceSessionId: 's1',
        turnId: 't1',
        text: 'again',
        imageCount: 'one',
      },
    ],
    [
      'rewind without source session',
      { type: 'rewindConversation', turnId: 't1', text: 'again', imageCount: 0 },
    ],
    ['side chat without source session', { type: 'openSideChat' }],
    ['side chat with empty source session', { type: 'openSideChat', sourceSessionId: '' }],
    ['plan save without its reply', { type: 'savePlan', sourceSessionId: 's1' }],
    ['plan save with an empty reply id', { type: 'savePlan', sourceSessionId: 's1', itemId: '' }],
    ['implement without its session', { type: 'implementPlan', itemId: 'r1' }],
  ])('rejects %s', (_label, input) => {
    const result = parseWebviewToHostMessage(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})

describe('parseHostToWebviewMessage', () => {
  const init = {
    type: 'init',
    emptyStateHint: 'hint',
    composerPlaceholder: 'placeholder',
    settings: testSettings,
  }

  it('requires the scheduled count in a paid subagent usage update', () => {
    const state = {
      features: ['subagents'],
      tally: {
        webSearches: 0,
        images: 0,
        voiceSeconds: 0,
        subagentRequests: 2,
        subagentUnknownRequests: 1,
        subagentTokens: 1_100_000,
        subagentCostUsd: 1.455,
      },
      isKeyStored: true,
      alwaysAllowed: [],
    }
    const rejected = parseHostToWebviewMessage({ type: 'paidState', state })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.error).toContain('scheduledRuns')
    }
    const complete = {
      type: 'paidState',
      state: { ...state, tally: { ...state.tally, scheduledRuns: 0 } },
    }
    expect(parseHostToWebviewMessage(complete)).toEqual({ ok: true, message: complete })
  })

  it.each([
    ['init', init],
    ['side chat init', { ...init, sideChat: true }],
    ['settingsChanged', { type: 'settingsChanged', settings: testSettings }],
    ['focusInput', { type: 'focusInput' }],
    ['surfaceState epoch', { type: 'surfaceState', attachmentEpoch: 3 }],
    ['old surfaceState', { type: 'surfaceState' }],
    ['insertText', { type: 'insertText', text: '@a.ts ' }],
    ['restoreDraft', { type: 'restoreDraft', text: 'again' }],
    ['authState', { type: 'authState', status: 'signedIn' }],
    ['sessionInfo', { type: 'sessionInfo', modelId: 'm', contextLimit: 10 }],
    ['turnAccepted', { type: 'turnAccepted', localId: 'l', turnId: 't' }],
    [
      'turnAccepted with replay identity',
      { type: 'turnAccepted', localId: 'l', turnId: 't', userMessageId: 'backend-u' },
    ],
    ['sendFailed', { type: 'sendFailed', localId: 'l', reason: 'no' }],
    ['goalCommandResult', { type: 'goalCommandResult', requestId: 'g1', accepted: false }],
    ['agentEvent', { type: 'agentEvent', event: { type: 'turnStarted', turnId: 't' } }],
    [
      'promoted steer event',
      {
        type: 'agentEvent',
        event: { type: 'userMessageTurnChanged', userMessageId: 'u1', turnId: 't2' },
      },
    ],
    [
      'modelList',
      {
        type: 'modelList',
        models: [{ modelId: 'm', displayLabel: 'M', contextLimit: 1, isDefault: true }],
      },
    ],
    [
      'skillList',
      {
        type: 'skillList',
        skills: [{ selector: 's', displayName: 'S', description: 'd', argumentHint: 'h' }],
      },
    ],
    [
      'composerState',
      { type: 'composerState', effort: 'high', isThinkingEnabled: true, permissionMode: 'auto' },
    ],
    [
      'mentionResults',
      { type: 'mentionResults', requestId: 1, items: [{ path: 'a.ts', isFolder: false }] },
    ],
    [
      'attachmentAdded',
      {
        type: 'attachmentAdded',
        attachment: {
          id: 'a',
          name: 'a.png',
          mediaType: 'image/png',
          width: 1,
          height: 2,
          sizeBytes: 3,
        },
      },
    ],
    ['attachmentRejected', { type: 'attachmentRejected', name: 'a.pdf', reason: 'no' }],
    [
      'attachmentRejected request',
      { type: 'attachmentRejected', name: 'a.pdf', reason: 'no', requestId: 'upload-1' },
    ],
    ['attachmentsCleared', { type: 'attachmentsCleared' }],
    ['notice', { type: 'notice', level: 'warning', text: 'careful' }],
    [
      'briefSubmitted',
      {
        type: 'briefSubmitted',
        localId: 'plan-brief-1',
        text: 'Implement the plan in .agents/plans/x.md.',
        attachments: [
          { id: 'a1', name: '.agents/plans/x.md', mediaType: 'text/plain', sizeBytes: 3 },
        ],
      },
    ],
  ])('accepts %s', (_label, message) => {
    expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
  })

  it.each([
    ['init with an invalid setting', { ...init, settings: { ...testSettings, focusView: 1 } }],
    ['init missing settings', { type: 'init', emptyStateHint: 'h' }],
    ['unknown auth status', { type: 'authState', status: 'maybe' }],
    ['agentEvent with an unknown event', { type: 'agentEvent', event: { type: 'nope' } }],
    [
      'promoted steer event without its user id',
      { type: 'agentEvent', event: { type: 'userMessageTurnChanged', turnId: 't2' } },
    ],
    ['composerState with a bad effort', { type: 'composerState', effort: 'ultra' }],
    ['notice with an unknown level', { type: 'notice', level: 'panic', text: 'x' }],
    ['goal result without acceptance', { type: 'goalCommandResult', requestId: 'g1' }],
    [
      'turnAccepted with invalid replay identity',
      { type: 'turnAccepted', localId: 'l', turnId: 't', userMessageId: 2 },
    ],
    [
      'goal result with numeric request id',
      { type: 'goalCommandResult', requestId: 1, accepted: true },
    ],
    ['unknown type', { type: 'explode' }],
    [
      'briefSubmitted without its local id',
      { type: 'briefSubmitted', localId: '', text: 'x', attachments: [] },
    ],
  ])('rejects %s', (_label, input) => {
    expect(parseHostToWebviewMessage(input).ok).toBe(false)
  })
})
