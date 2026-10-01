// @vitest-environment jsdom
// The panel's side of `/handoff` (M74): the command posts a request, the
// host's brief opens a dialog before anything starts, and Start sends the
// edited brief back while Cancel drops it.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

const REQUEST_ID = 'handoff:local-1:1'
const BRIEF = '## Goal\nShip it.\n\n## Todo list\n- [ ] Ship it'
/** The host's brief for REQUEST_ID, with no open items. */
const READY: Extract<HostToWebviewMessage, { type: 'handoffReady' }> = {
  type: 'handoffReady',
  requestId: REQUEST_ID,
  brief: BRIEF,
  todos: [],
}

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

function composerText() {
  return screen.getByLabelText<HTMLTextAreaElement>('Message Muse').value
}

/** The host's answer to the `/handoff` request REQUEST_ID: taken, unless refused. */
function admit(isAccepted = true) {
  deliver({ type: 'handoffCommandResult', requestId: REQUEST_ID, accepted: isAccepted })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/handoff (M74)', () => {
  it('posts the command with its goal, sending nothing, and clears the draft only once the host takes it', () => {
    const postMessage = renderPanel()
    submit('/handoff Ship it Friday')
    expect(postMessage).toHaveBeenCalledWith({
      type: 'requestHandoff',
      requestId: REQUEST_ID,
      goal: 'Ship it Friday',
    })
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
    // Not answered yet: the command stays, and a second Enter sends nothing.
    expect(composerText()).toBe('/handoff Ship it Friday')
    fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === 'requestHandoff'),
    ).toHaveLength(1)
    admit()
    expect(composerText()).toBe('')
  })

  it('keeps a refused handoff in the composer, its goal not lost, ready to send again', () => {
    const postMessage = renderPanel()
    submit('/handoff Ship it Friday')
    // Refused (Muse Code, a running reply, a side chat): the host said why.
    admit(false)
    expect(composerText()).toBe('/handoff Ship it Friday')
    fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'requestHandoff',
      requestId: 'handoff:local-1:2',
      goal: 'Ship it Friday',
    })
  })

  it('keeps a draft edited while the host answered, even when it takes the command', () => {
    renderPanel()
    submit('/handoff Ship it Friday')
    fireEvent.change(screen.getByLabelText('Message Muse'), { target: { value: 'Something else' } })
    admit()
    expect(composerText()).toBe('Something else')
  })

  it('posts the command without a goal', () => {
    const postMessage = renderPanel()
    submitCommand('/handoff')
    expect(postMessage).toHaveBeenCalledWith({ type: 'requestHandoff', requestId: REQUEST_ID })
  })

  it('shows the brief and the open items it seeds before anything starts; Start sends the edited brief back', () => {
    const postMessage = renderPanel()
    submit('/handoff Ship it')
    admit()
    expect(screen.queryByRole('dialog')).toBeNull()
    deliver({ ...READY, goal: 'Ship it', todos: ['Ship it', 'Tell the team'] })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(UI_TEXT.handoffDialogBody)
    expect(dialog).toHaveTextContent(fill(UI_TEXT.handoffRequestCardWithGoal, { goal: 'Ship it' }))
    expect(dialogText().value).toBe(BRIEF)
    // All the model wrote that the new conversation reads is on screen (D49).
    const items = within(screen.getByRole('list', { name: UI_TEXT.todoTitle })).getAllByRole(
      'listitem',
    )
    expect(items.map((item) => item.textContent)).toEqual(['Ship it', 'Tell the team'])
    // Behind the dialog the panel takes no input (M25), and an emptied
    // brief cannot be started.
    expect(screen.getByLabelText('Message Muse').closest('[inert]')).not.toBeNull()
    fireEvent.change(dialogText(), { target: { value: ' \n ' } })
    expect(screen.getByRole('button', { name: UI_TEXT.handoffConfirm })).toBeDisabled()
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
    admit()
    deliver(READY)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.handoffConfirm }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'confirmHandoff',
      requestId: REQUEST_ID,
      brief: BRIEF,
    })
    // Refused: the edited brief is not lost, and Start can be pressed again.
    fireEvent.change(dialogText(), { target: { value: 'Edited brief.' } })
    admit(false)
    expect(dialogText().value).toBe('Edited brief.')
    expect(screen.getByRole('button', { name: UI_TEXT.handoffConfirm })).toBeEnabled()
    // Accepted: the new conversation clears the dialog with the transcript.
    admit()
    deliver({ type: 'conversationCleared' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels the handoff without starting anything', () => {
    const postMessage = renderPanel()
    submitCommand('/handoff')
    admit()
    deliver(READY)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.questionCancel }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cancelHandoff', requestId: REQUEST_ID })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'confirmHandoff' }),
    )
  })

  it('ignores a result for another request', () => {
    const postMessage = renderPanel()
    submitCommand('/handoff')
    admit()
    deliver(READY)
    // Starting: a refusal for another request does not reopen Start.
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.handoffConfirm }))
    deliver({ type: 'handoffCommandResult', requestId: 'handoff:other:9', accepted: false })
    expect(screen.getByRole('button', { name: UI_TEXT.handoffConfirm })).toBeDisabled()
    expect(dialogText().value).toBe(BRIEF)
    expect(
      postMessage.mock.calls.filter(([message]) => message.type === 'confirmHandoff'),
    ).toHaveLength(1)
    // No open items: no list.
    expect(screen.queryByRole('list', { name: UI_TEXT.todoTitle })).toBeNull()
  })
})
