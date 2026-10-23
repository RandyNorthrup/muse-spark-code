import { describe, expect, it } from 'vitest'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'

const start: UiState = { ...initialUiState, sessionId: 'session-1' }

function failedTurn(overrides: { reason?: string; errorKind?: string; retryable?: boolean }) {
  const message: HostToWebviewMessage = {
    type: 'agentEvent',
    event: { type: 'turnCompleted', turnId: 't1', terminal: 'failed', ...overrides },
  }
  return uiReducer(start, { type: 'hostMessage', message, at: 1000 })
}

function errorEntry(state: UiState) {
  const entry = state.transcript.find((item) => item.kind === 'error')
  if (entry?.kind !== 'error') throw new Error('no error entry in the transcript')
  return entry
}

/** A failed turn's user card on screen, accepted as `t1`, then failed retryably. */
function failedConversation() {
  let state = uiReducer(start, {
    type: 'submitted',
    localId: 'local-1',
    text: 'Shard the cache',
    attachments: [],
    contextLabel: undefined,
  })
  const accepted: HostToWebviewMessage = {
    type: 'turnAccepted',
    localId: 'local-1',
    turnId: 't1',
  }
  state = uiReducer(state, { type: 'hostMessage', message: accepted, at: 1001 })
  const failed: HostToWebviewMessage = {
    type: 'agentEvent',
    event: { type: 'turnCompleted', turnId: 't1', terminal: 'failed', retryable: true },
  }
  return uiReducer(state, { type: 'hostMessage', message: failed, at: 1002 })
}

describe('turn retry in the panel', () => {
  it('marks a retryable failed turn resubmittable', () => {
    const entry = errorEntry(failedTurn({ reason: 'broke', retryable: true }))
    expect(entry.retryTurnId).toBe('t1')
  })

  it('offers no retry when the backend judged against it, or never judged', () => {
    expect(errorEntry(failedTurn({ retryable: false })).retryTurnId).toBeUndefined()
    expect(errorEntry(failedTurn({})).retryTurnId).toBeUndefined()
  })

  it('resends the failed card under a fresh id and leaves the composer alone', () => {
    const before = failedConversation()
    const retrying: UiState = {
      ...before,
      draft: 'a newer thought',
      attachments: [{ id: 'chip-1', name: 'sketch.png', mediaType: 'image/png', sizeBytes: 12 }],
    }
    const state = uiReducer(retrying, {
      type: 'retried',
      localId: 'local-2',
      text: 'Shard the cache',
      attachments: [],
      contextLabel: undefined,
      referenceLabel: undefined,
      at: 2000,
    })
    const card = state.transcript.find((item) => item.id === 'local-2')
    expect(card).toMatchObject({ kind: 'user', text: 'Shard the cache', status: 'pending' })
    // The composer's newer draft and chips stay exactly as left.
    expect(state.draft).toBe('a newer thought')
    expect(state.attachments).toHaveLength(1)
    // The host holds no bytes for the resend, so nothing is tracked unsent.
    expect(state.unsentAttachments['local-2']).toBeUndefined()
    expect(state.pendingSendDrafts['local-2']).toMatchObject({
      localId: 'local-2',
      text: 'Shard the cache',
    })
  })

  it("copies the failed card's chips, context and reply-to onto the resend", () => {
    const state = uiReducer(start, {
      type: 'retried',
      localId: 'local-2',
      text: 'Shard the cache',
      attachments: [{ id: 'dead-1', name: 'graph.png', mediaType: 'image/png' }],
      contextLabel: 'src/cache.ts',
      referenceLabel: 'Replying to output',
      at: 2000,
    })
    const card = state.transcript.find((item) => item.id === 'local-2')
    expect(card).toMatchObject({
      kind: 'user',
      attachments: [{ id: 'dead-1', name: 'graph.png', mediaType: 'image/png' }],
      contextLabel: 'src/cache.ts',
      referenceLabel: 'Replying to output',
    })
    expect(state.unsentAttachments['local-2']).toBeUndefined()
  })
})
