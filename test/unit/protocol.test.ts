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
    ['compact', { type: 'compact' }],
    ['listSkills', { type: 'listSkills' }],
    ['searchMentions', { type: 'searchMentions', requestId: 3, query: 'app' }],
    ['pickFile', { type: 'pickFile' }],
    ['pickMentionFile', { type: 'pickMentionFile' }],
    [
      'attachImageData',
      { type: 'attachImageData', name: 'a.png', mediaType: 'image/png', base64: 'AAAA' },
    ],
    ['removeAttachment', { type: 'removeAttachment', id: 'att-1' }],
    ['droppedUris', { type: 'droppedUris', uris: ['file:///a.ts'] }],
    ['hostAction', { type: 'hostAction', action: 'openSettings' }],
    [
      'goalCommand set',
      { type: 'goalCommand', requestId: 'g1', verb: 'set', objective: 'Ship it' },
    ],
    ['goalCommand pause', { type: 'goalCommand', requestId: 'g2', verb: 'pause' }],
    ['workflowCancel', { type: 'workflowCancel', sourceSessionId: 's1', workflowRunId: 'run-1' }],
    [
      'workflowChildControl',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: 'run-1',
        childId: 'c1',
        attempt: 2,
        action: 'retry',
      },
    ],
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
    ['unknown goal verb', { type: 'goalCommand', verb: 'complete' }],
    ['goal command without request id', { type: 'goalCommand', verb: 'pause' }],
    ['goal command with numeric request id', { type: 'goalCommand', requestId: 1, verb: 'pause' }],
    // MSP's `workflow/childControl` takes these two actions and no other (M47).
    [
      'a workflow action MSP does not take',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: 'r',
        childId: 'c',
        attempt: 1,
        action: 'pause',
      },
    ],
    ['a workflow cancel without its run', { type: 'workflowCancel' }],
    [
      'a workflow cancel with an empty run',
      { type: 'workflowCancel', sourceSessionId: 's1', workflowRunId: '' },
    ],
    [
      'a workflow cancel without its source session',
      { type: 'workflowCancel', workflowRunId: 'r' },
    ],
    [
      'a workflow child control without its source session',
      {
        type: 'workflowChildControl',
        workflowRunId: 'r',
        childId: 'c',
        attempt: 1,
        action: 'retry',
      },
    ],
    [
      'a workflow child control with an empty run',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: '',
        childId: 'c',
        attempt: 1,
        action: 'retry',
      },
    ],
    [
      'a workflow child control with an empty child',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: 'r',
        childId: '',
        attempt: 1,
        action: 'retry',
      },
    ],
    [
      'a workflow child control with a zero attempt',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: 'r',
        childId: 'c',
        attempt: 0,
        action: 'retry',
      },
    ],
    [
      'a workflow child control with a fractional attempt',
      {
        type: 'workflowChildControl',
        sourceSessionId: 's1',
        workflowRunId: 'r',
        childId: 'c',
        attempt: 1.5,
        action: 'retry',
      },
    ],
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

  it.each([
    ['init', init],
    ['settingsChanged', { type: 'settingsChanged', settings: testSettings }],
    ['focusInput', { type: 'focusInput' }],
    ['insertText', { type: 'insertText', text: '@a.ts ' }],
    ['authState', { type: 'authState', status: 'signedIn' }],
    ['sessionInfo', { type: 'sessionInfo', modelId: 'm', contextLimit: 10 }],
    ['turnAccepted', { type: 'turnAccepted', localId: 'l', turnId: 't' }],
    ['sendFailed', { type: 'sendFailed', localId: 'l', reason: 'no' }],
    ['goalCommandResult', { type: 'goalCommandResult', requestId: 'g1', accepted: false }],
    ['agentEvent', { type: 'agentEvent', event: { type: 'turnStarted', turnId: 't' } }],
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
    ['attachmentsCleared', { type: 'attachmentsCleared' }],
    ['notice', { type: 'notice', level: 'warning', text: 'careful' }],
  ])('accepts %s', (_label, message) => {
    expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
  })

  it.each([
    ['init with an invalid setting', { ...init, settings: { ...testSettings, focusView: 1 } }],
    ['init missing settings', { type: 'init', emptyStateHint: 'h' }],
    ['unknown auth status', { type: 'authState', status: 'maybe' }],
    ['agentEvent with an unknown event', { type: 'agentEvent', event: { type: 'nope' } }],
    ['composerState with a bad effort', { type: 'composerState', effort: 'ultra' }],
    ['notice with an unknown level', { type: 'notice', level: 'panic', text: 'x' }],
    ['goal result without acceptance', { type: 'goalCommandResult', requestId: 'g1' }],
    [
      'goal result with numeric request id',
      { type: 'goalCommandResult', requestId: 1, accepted: true },
    ],
    ['unknown type', { type: 'explode' }],
  ])('rejects %s', (_label, input) => {
    expect(parseHostToWebviewMessage(input).ok).toBe(false)
  })
})
