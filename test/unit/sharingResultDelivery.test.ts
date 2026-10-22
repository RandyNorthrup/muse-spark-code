// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { WebviewErrorSource } from '../../src/shared/constants'
import { createUiStore, listenToHost } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'

// RLWINFIX item 1: the host answers a sharing action with `value: undefined`
// for a failure (promptEntry's handle) and for actions with no result (the
// prompt panel's remove/insert/invalidate, save/use/share). VS Code's host to
// renderer transport serialises as JSON, which drops the key, so the webview
// receives a `sharingResult` with no `value` at all. Before the fix the
// webview dropped it (`Dropped malformed host message: ... at value`, seen in
// the owner's 0.19.0 log on 2026-10-22): the sharing call hung and a failure's
// notice never showed. After it the result is delivered, and a message that is
// still malformed names what was dropped.

function listen() {
  const store = createUiStore(initialUiState)
  const reports: { source: WebviewErrorSource; error: unknown }[] = []
  const stop = listenToHost(
    store,
    window,
    () => 0,
    (source, error) => {
      reports.push({ source, error })
    },
  )
  return { store, reports, stop }
}

/** What the webview receives: the sender's object after the JSON transport. */
function transported(payload: unknown): unknown {
  // structuredClone keeps an undefined-valued key, so it cannot model the
  // JSON transport that drops it; the dropped key is the defect under test.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(payload))
}

function post(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }))
}

describe('sharing results without a value', () => {
  it('delivers a failure and shows its notice', () => {
    const { store, reports, stop } = listen()
    try {
      post(
        transported({
          type: 'sharingResult',
          id: 'share-1',
          value: undefined,
          error: 'The prompt store is damaged.',
        }),
      )
      expect(reports).toEqual([])
      expect(store.getState().announcement?.text).toBe('The prompt store is damaged.')
    } finally {
      stop()
    }
  })

  it('delivers a valueless success without a report', () => {
    const { store, reports, stop } = listen()
    try {
      post(transported({ type: 'sharingResult', id: 'share-2', value: undefined }))
      expect(reports).toEqual([])
      expect(store.getState().announcement).toBeUndefined()
    } finally {
      stop()
    }
  })

  it('still delivers a defined value', () => {
    const { reports, stop } = listen()
    try {
      post(
        transported({
          type: 'sharingResult',
          id: 'share-3',
          value: { prompts: [], hasWorkspace: false },
        }),
      )
      expect(reports).toEqual([])
    } finally {
      stop()
    }
  })

  it('names the dropped message when one is still malformed', () => {
    const { reports, stop } = listen()
    try {
      post({ type: 'sharingResult' })
      expect(reports).toHaveLength(1)
      expect(String(reports[0]?.error)).toContain('sharingResult')
    } finally {
      stop()
    }
  })
})
