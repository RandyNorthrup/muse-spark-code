// Panel-focus ownership: a recorded focus request lands only while the chat
// surface already holds the keyboard, and an unowned check does not spend
// it. Through the real reducer and the real landing rule, with messages
// passed in as data: no mocks, no fake timers.

import { describe, expect, it } from 'vitest'
import type { HostToWebviewMessage, SettingsSnapshot } from '../../src/shared/protocol'
import {
  initialUiState,
  landFocusRequest,
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
    // No request yet, and a request already landed: nothing to land.
    expect(landFocusRequest(0, 0, true)).toBe(0)
    expect(landFocusRequest(2, 2, true)).toBe(2)
    // An owned request lands and is spent.
    expect(landFocusRequest(1, 0, true)).toBe(1)
  })

  it('keeps an unowned request pending until the surface itself gains focus', () => {
    // Reveal asked, focus not arrived yet: not landed, and not spent either,
    // so the surface's own focus event can still land it.
    const afterUnownedCheck = landFocusRequest(1, 0, false)
    expect(afterUnownedCheck).toBe(0)
    expect(landFocusRequest(1, afterUnownedCheck, true)).toBe(1)
    // A load finishing behind a file: unowned checks never spend it.
    expect(landFocusRequest(3, 1, false)).toBe(1)
  })

  it('records the load-time request without landing it anywhere', () => {
    const state = reduceAll([host(init)])
    expect(state.phase).toBe('ready')
    // Recorded, so opening the panel yourself still offers the caret; the
    // composer's effect lands it only while the surface holds the keyboard.
    expect(state.focusRequests).toBe(1)
  })

  it('records each host focus ask, so an owned one still lands', () => {
    const state = reduceAll([host(init), host({ type: 'focusInput' })])
    expect(state.focusRequests).toBe(2)
  })

  it('records a mention insert as a request, pending like any other while unowned', () => {
    const state = reduceAll([host(init), host({ type: 'insertText', text: '@file ' })])
    expect(state.focusRequests).toBe(2)
    expect(state.pendingInsert).toBe('@file ')
  })
})
