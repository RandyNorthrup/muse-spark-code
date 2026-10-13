// Panel-focus ownership: a recorded focus request lands only while the chat
// surface already holds the keyboard. Through the real reducer and the real
// drop rule, with messages passed in as data: no mocks, no fake timers.

import { describe, expect, it } from 'vitest'
import type { HostToWebviewMessage, SettingsSnapshot } from '../../src/shared/protocol'
import {
  initialUiState,
  shouldLandFocusRequest,
  uiReducer,
  type UiAction,
  type UiState,
} from '../../src/webview/state/uiState'

const NOW = 1_000_000

const settings: SettingsSnapshot = {
  preferredLocation: 'panel',
  initialPermissionMode: 'manual',
  autosave: true,
  attachOpenFile: false,
  useCtrlEnterToSend: false,
  hideOnboarding: true,
  focusView: false,
  respectGitIgnore: true,
  confidentialWorkspace: false,
  allowDangerouslySkipPermissions: false,
  archiveInactiveSessions: 0,
  modelApiReplyUsage: false,
  schedules: false,
  museCodeAutoReviewer: false,
  'estimator.optimize': 'cost',
}

const init: HostToWebviewMessage = {
  type: 'init',
  emptyStateHint: 'hint',
  composerPlaceholder: 'placeholder',
  settings,
}

function host(message: HostToWebviewMessage, at = NOW): UiAction {
  return { type: 'hostMessage', message, at }
}

function reduceAll(actions: readonly UiAction[], start: UiState = initialUiState): UiState {
  let state = start
  for (const action of actions) {
    state = uiReducer(state, action)
  }
  return state
}

describe('panel-focus ownership', () => {
  it('lands a request only while the surface holds the keyboard', () => {
    expect(shouldLandFocusRequest(true)).toBe(true)
    expect(shouldLandFocusRequest(false)).toBe(false)
  })

  it('records the load-time request without landing it anywhere', () => {
    const state = reduceAll([host(init)])
    expect(state.phase).toBe('ready')
    // Recorded, so opening the panel yourself still offers the caret; the
    // composer's effect drops it unless the surface holds the keyboard.
    expect(state.focusRequests).toBe(1)
  })

  it('records each host focus ask, so an owned one still lands', () => {
    const state = reduceAll([host(init), host({ type: 'focusInput' })])
    expect(state.focusRequests).toBe(2)
  })

  it('records a mention insert as a request, dropped like any other when unowned', () => {
    const state = reduceAll([host(init), host({ type: 'insertText', text: '@file ' })])
    expect(state.focusRequests).toBe(2)
    expect(state.pendingInsert).toBe('@file ')
  })
})
