// Panel-focus ownership (the review's F3): a recorded focus request lands
// only while the chat surface already holds the keyboard and only within
// the delivery window after it was asked; afterwards it is gone, so a
// stale request never yanks the caret on a much later click. Through the
// real reducer and the real landing rule, with messages passed in as data:
// no mocks, no fake timers.

import { describe, expect, it } from 'vitest'
import { FOCUS_REQUEST_WINDOW_MS } from '../../src/shared/constants'
import type { HostToWebviewMessage, SettingsSnapshot } from '../../src/shared/protocol'
import {
  initialUiState,
  isHostOwnedFocusInput,
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
  it('lands a fresh request only while the surface holds the keyboard', () => {
    // No request yet, and a request already landed: nothing to land.
    expect(landFocusRequest(0, 0, true, NOW, NOW)).toBe(0)
    expect(landFocusRequest(2, 2, true, NOW, NOW)).toBe(2)
    // An owned, fresh request lands and is spent.
    expect(landFocusRequest(1, 0, true, NOW, NOW)).toBe(1)
    // Fresh but unowned (a load finishing behind a file): not landed.
    expect(landFocusRequest(1, 0, false, NOW, NOW)).toBe(0)
  })

  it('lands a fresh request on the surface’s own focus, while the delivery still arrives', () => {
    // Reveal asked, focus not arrived yet: not landed, and not spent either,
    // so the surface's own focus event — the reveal's focus arriving within
    // the window — can still land it.
    const afterUnownedCheck = landFocusRequest(1, 0, false, NOW, NOW)
    expect(afterUnownedCheck).toBe(0)
    expect(landFocusRequest(1, afterUnownedCheck, true, NOW, NOW)).toBe(1)
  })

  it('drops a stale request even when the surface gains focus much later', () => {
    // The person's steps: the panel loads behind a file; an hour later the
    // person clicks the panel's transcript to select text. The request from
    // an hour ago must not throw the caret into the composer.
    const hourLater = NOW + 3_600_000
    expect(hourLater - NOW).toBeGreaterThan(FOCUS_REQUEST_WINDOW_MS)
    expect(landFocusRequest(1, 0, true, hourLater, NOW)).toBe(0)
    // And it stays gone: nothing accrued for a later check to land.
    expect(landFocusRequest(1, 0, true, hourLater + 1000, NOW)).toBe(0)
  })

  it('records the load-time request without landing it anywhere', () => {
    const state = reduceAll([host(init)])
    expect(state.phase).toBe('ready')
    // Recorded, so opening the panel yourself still offers the caret; the
    // composer's effect lands it only while the surface holds the keyboard.
    expect(state.focusRequests).toBe(1)
  })

  it('records a tokened host focus ask, so an owned one still lands', () => {
    const state = reduceAll([
      host(init),
      host({ type: 'focusInput', token: 'host-1', issuedAt: NOW }, NOW),
    ])
    expect(state.focusRequests).toBe(2)
  })

  it('ignores a focus ask without the host’s token', () => {
    expect(isHostOwnedFocusInput({ type: 'focusInput' }, NOW)).toBe(false)
    const state = reduceAll([host(init), host({ type: 'focusInput' })])
    expect(state.focusRequests).toBe(1)
  })

  it('ignores a tokened ask delivered after the window', () => {
    const staleAt = NOW + FOCUS_REQUEST_WINDOW_MS + 1
    expect(
      isHostOwnedFocusInput({ type: 'focusInput', token: 'host-1', issuedAt: NOW }, staleAt),
    ).toBe(false)
    const state = reduceAll([
      host(init),
      host({ type: 'focusInput', token: 'host-1', issuedAt: NOW }, staleAt),
    ])
    expect(state.focusRequests).toBe(1)
  })

  it('records a mention insert as a request, pending like any other while unowned', () => {
    const state = reduceAll([host(init), host({ type: 'insertText', text: '@file ' })])
    expect(state.focusRequests).toBe(2)
    expect(state.pendingInsert).toBe('@file ')
  })
})
