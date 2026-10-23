// M125 lane C (D107): the stuck chip's Steer asks the composer for the
// keyboard through the real reducer and the real landing rule: a fresh
// request lands while the surface holds it, and never otherwise.
import { describe, expect, it } from 'vitest'
import { initialUiState, landFocusRequest, uiReducer } from '../../src/webview/state/uiState'

const NOW = 1_000_000

describe('stuck chip steer', () => {
  it('focuses the composer through a fresh, owned request', () => {
    const state = uiReducer(initialUiState, { type: 'steerRequested' })
    expect(state.focusRequests).toBe(initialUiState.focusRequests + 1)
    // The composer's landing rule takes the keyboard from here: owned
    // and fresh lands, unowned or stale does not.
    expect(landFocusRequest(state.focusRequests, 0, true, NOW, NOW)).toBe(state.focusRequests)
    expect(landFocusRequest(state.focusRequests, 0, false, NOW, NOW)).toBe(0)
  })

  it('spends the chip’s buttons once pressed', () => {
    const state = uiReducer(initialUiState, { type: 'noticeActionRequested', entryId: 'n/a' })
    expect(state.focusRequests).toBe(initialUiState.focusRequests)
  })
})
