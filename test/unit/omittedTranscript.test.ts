// B10: an oversize transcript is omitted, but the person's unsent text is
// not forgotten with it. The draft and pending send ride along outside the
// snapshot and come back on restore. Real snapshot functions, data in.
import { describe, expect, it } from 'vitest'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { initialUiState } from '../../src/webview/state/uiState'

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

  it('brings the unsent text back on restore', () => {
    const saved = webviewStateOf(oversized(), true, 100)
    const restored = restoredUiState(structuredClone(saved))
    expect(restored.pendingRestore).toEqual({ sessionId: 's1', isTranscriptOmitted: true })
    expect(restored.draft).toBe('unsent composer text')
    expect(restored.pendingSendDraft).toMatchObject({
      localId: 'l1',
      text: 'pending send text',
      revision: 3,
    })
  })

  it('still saves the transcript when it fits', () => {
    const saved = webviewStateOf({ ...oversized(), transcript: [] }, true, 100_000)
    expect(saved).toHaveProperty('snapshot')
    expect(saved).not.toHaveProperty('omittedSessionId')
  })
})
