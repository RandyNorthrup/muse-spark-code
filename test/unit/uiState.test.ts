import { describe, expect, it } from 'vitest'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

const init = {
  type: 'init',
  extensionVersion: '1.0.0',
  emptyStateHint: 'hint',
  composerPlaceholder: 'placeholder',
  settings: testSettings,
} as const

function ready(): UiState {
  return uiReducer(initialUiState, { type: 'hostMessage', message: init })
}

describe('uiReducer', () => {
  it('becomes ready on init and requests composer focus once', () => {
    const state = ready()
    expect(state.phase).toBe('ready')
    expect(state.extensionVersion).toBe('1.0.0')
    expect(state.settings).toEqual(testSettings)
    expect(state.focusRequests).toBe(1)
  })

  it('replaces settings on settingsChanged', () => {
    const state = uiReducer(ready(), {
      type: 'hostMessage',
      message: { type: 'settingsChanged', settings: { ...testSettings, focusView: true } },
    })
    expect(state.settings?.focusView).toBe(true)
  })

  it('counts focus requests', () => {
    const state = uiReducer(ready(), { type: 'hostMessage', message: { type: 'focusInput' } })
    expect(state.focusRequests).toBe(2)
  })

  it('queues inserted text, concatenating repeated inserts, and requests focus', () => {
    const once = uiReducer(ready(), {
      type: 'hostMessage',
      message: { type: 'insertText', text: '@a.ts ' },
    })
    const twice = uiReducer(once, {
      type: 'hostMessage',
      message: { type: 'insertText', text: '@b.ts ' },
    })
    expect(twice.pendingInsert).toBe('@a.ts @b.ts ')
    expect(twice.focusRequests).toBe(3)
  })

  it('tracks the draft and clears the pending insert once applied', () => {
    const drafted = uiReducer(ready(), { type: 'draftChanged', draft: 'hello' })
    expect(drafted.draft).toBe('hello')
    const queued = uiReducer(drafted, {
      type: 'hostMessage',
      message: { type: 'insertText', text: ' @x' },
    })
    const applied = uiReducer(queued, { type: 'insertApplied' })
    expect(applied.pendingInsert).toBeUndefined()
    expect(applied.draft).toBe('hello')
  })
})
