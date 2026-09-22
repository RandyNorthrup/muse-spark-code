import { describe, expect, it } from 'vitest'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import { testSettings } from './helpers/fakes'

describe('parseWebviewToHostMessage', () => {
  it.each([
    ['ready', { type: 'ready' }],
    ['inputFocusChanged', { type: 'inputFocusChanged', focused: true }],
    ['openNewTab', { type: 'openNewTab' }],
    ['sendMessage', { type: 'sendMessage', localId: 'l1', text: 'hi' }],
    ['cancelTurn', { type: 'cancelTurn' }],
    ['signIn', { type: 'signIn', method: 'browser' }],
    ['signOut', { type: 'signOut' }],
    ['retryBackend', { type: 'retryBackend' }],
    ['openExternal', { type: 'openExternal', url: 'https://dev.meta.ai/' }],
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
    ['sendMessage without localId', { type: 'sendMessage', text: 'hi' }],
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
    extensionVersion: '1.0.0',
    emptyStateHint: 'hint',
    composerPlaceholder: 'placeholder',
    settings: testSettings,
  }

  it.each([
    ['init', init],
    ['settingsChanged', { type: 'settingsChanged', settings: testSettings }],
    ['focusInput', { type: 'focusInput' }],
    ['insertText', { type: 'insertText', text: '@a.ts ' }],
    ['authState', { type: 'authState', status: 'signedOut', detail: 'not logged in' }],
    ['sessionInfo', { type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 }],
    ['turnAccepted', { type: 'turnAccepted', localId: 'l1', turnId: 't1' }],
    ['sendFailed', { type: 'sendFailed', localId: 'l1', reason: 'nope' }],
    [
      'agentEvent',
      { type: 'agentEvent', event: { type: 'textDelta', itemId: 'i', field: 'text', delta: 'x' } },
    ],
  ])('accepts %s', (_label, message) => {
    expect(parseHostToWebviewMessage(message)).toEqual({ ok: true, message })
  })

  it('rejects an init message with a missing field', () => {
    const { composerPlaceholder: _dropped, ...incomplete } = init
    expect(parseHostToWebviewMessage(incomplete).ok).toBe(false)
  })

  it('rejects an init message with a wrong field type', () => {
    expect(parseHostToWebviewMessage({ ...init, extensionVersion: 1 }).ok).toBe(false)
  })

  it('rejects settings with an unknown permission mode', () => {
    expect(
      parseHostToWebviewMessage({
        type: 'settingsChanged',
        settings: { ...testSettings, initialPermissionMode: 'yolo' },
      }).ok,
    ).toBe(false)
  })

  it('rejects an unknown auth status and a malformed agent event', () => {
    expect(parseHostToWebviewMessage({ type: 'authState', status: 'maybe' }).ok).toBe(false)
    expect(
      parseHostToWebviewMessage({ type: 'agentEvent', event: { type: 'textDelta', itemId: 'i' } })
        .ok,
    ).toBe(false)
  })
})
