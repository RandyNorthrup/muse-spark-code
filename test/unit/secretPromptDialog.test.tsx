// @vitest-environment jsdom
// The panel's side of the secret-prompt hold (M92e, PLAN.md D71): the host
// holds a prompt with a detected secret and sends nothing, the dialog offers
// Send anyway or Edit over the restored draft, and Send anyway resends with
// the acceptance while the card shows the redacted text.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

const TEXT = 'please deploy this for me'
const REDACTED = 'please deploy this for me, redacted'
const HOLD: Extract<HostToWebviewMessage, { type: 'secretPromptDetected' }> = {
  type: 'secretPromptDetected',
  localId: 'local-1',
  redactedText: REDACTED,
}

function renderPanel() {
  const store = createUiStore({
    ...initialUiState,
    phase: 'ready',
    sessionId: 's1',
    auth: { ...initialUiState.auth, status: 'signedIn', backend: 'modelApi' },
    settings: testSettings,
  })
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  render(<App store={store} postMessage={postMessage} newLocalId={() => 'local-1'} />)
  return {
    postMessage,
    deliver: (message: HostToWebviewMessage) => {
      act(() => {
        store.dispatch({ type: 'hostMessage', message, at: 0 })
      })
    },
  }
}

function submit(text: string) {
  fireEvent.change(screen.getByLabelText('Message Muse'), { target: { value: text } })
  fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
}

function composerText() {
  return screen.getByLabelText<HTMLTextAreaElement>('Message Muse').value
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the secret-prompt hold (M92e)', () => {
  it('holds the send, shows the dialog over the restored draft, and sends on anyway with the acceptance', async () => {
    const { postMessage, deliver } = renderPanel()
    submit(TEXT)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sendMessage', localId: 'local-1', text: TEXT }),
    )
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ secretAccepted: true }))
    deliver(HOLD)
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.secretPromptTitle })
    expect(dialog).toHaveTextContent(UI_TEXT.secretPromptDetail)
    expect(dialog).toHaveTextContent(REDACTED)
    // The draft is back for editing; the optimistic card is gone.
    expect(composerText()).toBe(TEXT)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.secretPromptSendAnyway }))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'sendMessage', text: TEXT, secretAccepted: true }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('edits with the draft kept and nothing resent', () => {
    const { postMessage, deliver } = renderPanel()
    submit(TEXT)
    deliver(HOLD)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.secretPromptEdit }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(composerText()).toBe(TEXT)
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === 'sendMessage'),
    ).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByLabelText('Message Muse'))
  })
})
