import { describe, expect, it } from 'vitest'
import { initialUiState, uiReducer, canSend } from '../../src/webview/state/uiState'
import { parseWebviewToHostMessage, parseHostToWebviewMessage } from '../../src/shared/protocol'

describe('local report command admission', () => {
  it('allows signed-out reports without a model echo and clears only the acknowledged draft', () => {
    const state = { ...initialUiState, draft: '/report project' }
    expect(canSend(state)).toBe(true)
    const pending = uiReducer(state, { type: 'reportSubmitted', requestId: 'report-1' })
    expect(canSend(pending)).toBe(false)
    expect(pending.transcript).toEqual(state.transcript)
    const message = { type: 'reportCommandResult' as const, requestId: 'report-1', accepted: true }
    const edited = uiReducer(pending, { type: 'draftChanged', draft: 'my newer draft' })
    expect(uiReducer(edited, { type: 'hostMessage', message, at: 0 }).draft).toBe('my newer draft')
    expect(uiReducer(pending, { type: 'hostMessage', message, at: 0 }).draft).toBe('')
    expect(
      uiReducer(pending, { type: 'hostMessage', message: { ...message, accepted: false }, at: 0 })
        .draft,
    ).toBe(state.draft)
  })
  it('validates both command and acknowledgement without accepting model fields', () => {
    expect(
      parseWebviewToHostMessage({ type: 'runReport', requestId: 'r', argumentsText: 'usage' }).ok,
    ).toBe(true)
    expect(
      parseWebviewToHostMessage({
        type: 'runReport',
        requestId: 'r',
        argumentsText: 'usage',
        apiKey: 'not-a-key',
      }).ok,
    ).toBe(false)
    expect(
      parseHostToWebviewMessage({ type: 'reportCommandResult', requestId: 'r', accepted: 'true' })
        .ok,
    ).toBe(false)
  })
})
