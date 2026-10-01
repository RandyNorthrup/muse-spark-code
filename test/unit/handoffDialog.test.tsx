// @vitest-environment jsdom
// The panel's side of `/handoff` (M74): the command posts a request, the
// host's brief opens a dialog before anything starts, and Start sends the
// edited brief back while Cancel drops it.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

const REQUEST_ID = 'handoff:local-1:1'
const BRIEF = '## Goal\nShip it.\n\n## Todo list\n- [ ] Ship it'

function deliver(data: HostToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function renderPanel() {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  render(<App postMessage={postMessage} newLocalId={() => 'local-1'} />)
  // A signed-in Model API panel with an open conversation.
  const boot: readonly HostToWebviewMessage[] = [
    {
      type: 'init',
      emptyStateHint: 'hint',
      composerPlaceholder: 'placeholder',
      settings: testSettings,
    },
    { type: 'authState', status: 'signedIn', backend: 'modelApi' },
    { type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' },
  ]
  for (const message of boot) {
    deliver(message)
  }
  return postMessage
}

function submit(text: string) {
  fireEvent.change(screen.getByLabelText('Message Muse'), { target: { value: text } })
  fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
}

/**
 * Submit text the slash menu would otherwise complete: a bare `/handoff`
 * takes one Enter to complete and a second to send.
 */
function submitCommand(text: string) {
  submit(text)
  fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
}

function dialogText() {
  return screen.getByLabelText<HTMLTextAreaElement>(UI_TEXT.handoffDialogBody)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/handoff (M74)', () => {
  it('posts the command with its goal and clears the draft, sending nothing', () => {
    const postMessage = renderPanel()
    submit('/handoff Ship it Friday')
    expect(postMessage).toHaveBeenCalledWith({
      type: 'requestHandoff',
      requestId: REQUEST_ID,
      goal: 'Ship it Friday',
    })
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message Muse').value).toBe('')
  })

  it('posts the command without a goal', () => {
    const postMessage = renderPanel()
    submitCommand('/handoff')
    expect(postMessage).toHaveBeenCalledWith({ type: 'requestHandoff', requestId: REQUEST_ID })
  })

  it('shows the brief before anything starts; Start sends the edited brief back', () => {
    const postMessage = renderPanel()
    submit('/handoff Ship it')
    expect(screen.queryByRole('dialog')).toBeNull()
    deliver({ type: 'handoffReady', requestId: REQUEST_ID, brief: BRIEF, goal: 'Ship it' })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(UI_TEXT.handoffDialogBody)
    expect(dialog).toHaveTextContent(fill(UI_TEXT.handoffRequestCardWithGoal, { goal: 'Ship it' }))
    expect(dialogText().value).toBe(BRIEF)
    // Nothing started: no new conversation, no message sent.
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'clearConversation' }),
    )
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
    fireEvent.change(dialogText(), { target: { value: `${BRIEF}\n\n## Notes\nEdited.` } })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.handoffConfirm }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'confirmHandoff',
      requestId: REQUEST_ID,
      brief: `${BRIEF}\n\n## Notes\nEdited.`,
    })
  })

  it('keeps the dialog when the host refuses the confirm, and drops it when the conversation clears', () => {
    const postMessage = renderPanel()
    submitCommand('/handoff')
    deliver({ type: 'handoffReady', requestId: REQUEST_ID, brief: BRIEF })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.handoffConfirm }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'confirmHandoff',
      requestId: REQUEST_ID,
      brief: BRIEF,
    })
    // Refused: the edited brief is not lost, and Start can be pressed again.
    fireEvent.change(dialogText(), { target: { value: 'Edited brief.' } })
    deliver({ type: 'handoffCommandResult', requestId: REQUEST_ID, accepted: false })
    expect(dialogText().value).toBe('Edited brief.')
    // Accepted: the new conversation clears the dialog with the transcript.
    deliver({ type: 'handoffCommandResult', requestId: REQUEST_ID, accepted: true })
    deliver({ type: 'conversationCleared' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels the handoff without starting anything', () => {
    const postMessage = renderPanel()
    submitCommand('/handoff')
    deliver({ type: 'handoffReady', requestId: REQUEST_ID, brief: BRIEF })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.questionCancel }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cancelHandoff', requestId: REQUEST_ID })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'confirmHandoff' }),
    )
  })

  it('ignores a result for another request', () => {
    renderPanel()
    submitCommand('/handoff')
    deliver({ type: 'handoffReady', requestId: REQUEST_ID, brief: BRIEF })
    deliver({ type: 'handoffCommandResult', requestId: 'handoff:other:9', accepted: false })
    expect(dialogText().value).toBe(BRIEF)
  })
})
