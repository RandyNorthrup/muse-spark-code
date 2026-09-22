import { describe, expect, it } from 'vitest'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import { testSettings } from './helpers/fakes'

describe('parseWebviewToHostMessage', () => {
  it.each([
    ['ready', { type: 'ready' }],
    ['inputFocusChanged', { type: 'inputFocusChanged', focused: true }],
    ['openNewTab', { type: 'openNewTab' }],
  ])('accepts %s', (_label, message) => {
    expect(parseWebviewToHostMessage(message)).toEqual({ ok: true, message })
  })

  it.each([
    ['unknown type', { type: 'launch-missiles' }],
    ['missing type', {}],
    ['non-object', 'ready'],
    ['null', null],
    ['wrong field type', { type: 'inputFocusChanged', focused: 'yes' }],
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
})
