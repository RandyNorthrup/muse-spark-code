// An oversize transcript is omitted, but the person's unsent text is not
// forgotten with it. The draft and pending send ride along on the
// omission and come back on restore, and the omission stands across
// another reload before the host confirms. Real snapshot functions, data
// in, through JSON as VS Code's copy drops undefined keys.
import { describe, expect, it } from 'vitest'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { UI_TEXT } from '../../src/shared/constants'

function throughJson<T>(value: T): T {
  return structuredClone(value)
}

function oversized() {
  return {
    ...initialUiState,
    sessionId: 's1',
    draft: 'unsent composer text',
    pendingSendDraft: { localId: 'l1', text: 'pending send text', revision: 3 },
    transcript: [
      {
        kind: 'notice' as const,
        id: 'n1',
        level: 'info' as const,
        text: 'x'.repeat(500),
      },
    ],
  }
}

describe('oversize webview state', () => {
  it('omits the transcript but keeps the unsent text', () => {
    const saved = webviewStateOf(oversized(), true, 100)
    expect(saved).not.toHaveProperty('snapshot')
    expect(saved).toMatchObject({ omittedSessionId: 's1' })
    expect(saved).toMatchObject({ draft: 'unsent composer text' })
    expect(saved).toMatchObject({
      pendingSendDraft: { localId: 'l1', text: 'pending send text', revision: 3 },
    })
  })

  it('brings the unsent text back on restore and marks the omission', () => {
    const saved = webviewStateOf(oversized(), true, 100)
    const restored = restoredUiState(throughJson(saved))
    expect(restored.pendingRestore).toEqual({ sessionId: 's1', isTranscriptOmitted: true })
    expect(restored.draft).toBe('unsent composer text')
    expect(restored.pendingSendDraft).toMatchObject({
      localId: 'l1',
      text: 'pending send text',
      revision: 3,
    })
  })

  it('recovers a refused pending send after an omitted transcript reload', () => {
    const submitted = uiReducer(
      { ...oversized(), draft: '  keep this send  ', draftRevision: 2 },
      {
        type: 'submitted',
        localId: 'l2',
        text: 'keep this send',
        attachments: [],
        contextLabel: undefined,
      },
    )
    const restored = restoredUiState(throughJson(webviewStateOf(submitted, true, 100)))
    const refused = uiReducer(restored, {
      type: 'hostMessage',
      at: 0,
      message: {
        type: 'sendFailed',
        localId: 'l2',
        reason: UI_TEXT.handoffBusy,
        attachmentsKept: true,
      },
    })
    expect(refused.draft).toBe('  keep this send  ')
    expect(refused.pendingSendDraft).toBeUndefined()
  })

  it('keeps omitted history and typing across another reload before the host confirms', () => {
    const first = restoredUiState(throughJson(webviewStateOf(oversized(), true, 100)))
    const second = restoredUiState(throughJson(webviewStateOf(first, true)))
    expect(second.pendingRestore).toEqual({ sessionId: 's1', isTranscriptOmitted: true })
    expect(second.draft).toBe('unsent composer text')
    expect(second.pendingSendDraft).toEqual(first.pendingSendDraft)
  })

  it('still saves the transcript when it fits', () => {
    const saved = webviewStateOf({ ...oversized(), transcript: [] }, true, 100_000)
    expect(saved).toHaveProperty('snapshot')
    expect(saved).not.toHaveProperty('omittedSessionId')
  })
})
