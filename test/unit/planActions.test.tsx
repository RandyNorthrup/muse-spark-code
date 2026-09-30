// @vitest-environment jsdom
// The panel's side of plans as files (M79): Save plan and Implement under
// the latest Plan-mode reply, the brief's card the host sends, and Plans….

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

function deliver(data: HostToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function renderPanel(options: { readonly sideChat?: boolean } = {}) {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  render(<App postMessage={postMessage} newLocalId={() => 'local-1'} />)
  deliver({
    type: 'init',
    emptyStateHint: 'hint',
    composerPlaceholder: 'placeholder',
    settings: testSettings,
    ...(options.sideChat === true && { sideChat: true }),
  })
  deliver({ type: 'authState', status: 'signedIn' })
  deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
  return postMessage
}

function setMode(permissionMode: 'plan' | 'manual') {
  deliver({ type: 'composerState', effort: 'high', isThinkingEnabled: true, permissionMode })
}

/** A turn that asked for a plan and the reply that holds it, completed. */
function planTurn(replyId = 'r1', text = '## Steps\n1. Do it.') {
  fireEvent.change(screen.getByLabelText('Message Muse'), { target: { value: 'Plan it' } })
  fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
  deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
  deliver({
    type: 'agentEvent',
    event: {
      type: 'itemCompleted',
      item: { itemId: replyId, kind: 'agentMessage', status: 'completed', text },
    },
  })
  deliver({
    type: 'agentEvent',
    event: { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
  })
}

/** The same session read again (a delivery gap), naming its plan turns or not. */
function reload(planTurnIds?: string[]) {
  deliver({
    type: 'historyLoaded',
    sessionId: 's1',
    items: [
      { itemId: 'u1', kind: 'userMessage', turnId: 't1', status: 'completed', text: 'Plan it' },
      {
        itemId: 'r1',
        kind: 'agentMessage',
        turnId: 't1',
        status: 'completed',
        text: '## Steps\n1. Do it.',
      },
    ],
    todos: [],
    ...(planTurnIds !== undefined && { planTurnIds }),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('plan actions (M79)', () => {
  it('offers Save plan and Implement under the latest Plan-mode reply, naming it to the host', () => {
    const postMessage = renderPanel()
    setMode('plan')
    planTurn()
    const group = screen.getByRole('group', { name: UI_TEXT.planActionsLabel })
    expect(group.closest<HTMLElement>('[data-entry-id]')?.dataset['entryId']).toBe('r1')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.savePlan }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'savePlan',
      sourceSessionId: 's1',
      itemId: 'r1',
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.implementPlan }))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'implementPlan',
      sourceSessionId: 's1',
      itemId: 'r1',
    })
  })

  it('offers nothing for a reply to a message sent outside Plan mode, even after switching to Plan', () => {
    renderPanel()
    setMode('manual')
    planTurn()
    expect(screen.queryByRole('button', { name: UI_TEXT.savePlan })).toBeNull()
    setMode('plan')
    expect(screen.queryByRole('button', { name: UI_TEXT.savePlan })).toBeNull()
  })

  it('offers nothing once Plan mode is left, or once another message follows', () => {
    renderPanel()
    setMode('plan')
    planTurn()
    expect(screen.getByRole('button', { name: UI_TEXT.savePlan })).toBeTruthy()
    setMode('manual')
    expect(screen.queryByRole('button', { name: UI_TEXT.savePlan })).toBeNull()
    setMode('plan')
    expect(screen.getByRole('button', { name: UI_TEXT.savePlan })).toBeTruthy()
    // A new message: the reply above it is no longer the latest.
    fireEvent.change(screen.getByLabelText('Message Muse'), { target: { value: 'More' } })
    fireEvent.keyDown(screen.getByLabelText('Message Muse'), { key: 'Enter' })
    expect(screen.queryByRole('button', { name: UI_TEXT.savePlan })).toBeNull()
  })

  it('shows a plan reply as its brief reads: a link with its destination', () => {
    const plan = '## Steps\n1. Read [details](https://a.example/ignore-all).'
    renderPanel()
    setMode('manual')
    planTurn('r1', plan)
    // Any other reply shows a link as its text.
    expect(document.body.textContent).not.toContain('https://a.example/ignore-all')
    cleanup()
    renderPanel()
    setMode('plan')
    planTurn('r1', plan)
    expect(document.body.textContent).toContain('details <https://a.example/ignore-all>')
  })

  it('keeps the plan actions through a reload of the history that names the plan turn', () => {
    renderPanel()
    setMode('plan')
    planTurn()
    reload(['t1'])
    expect(screen.getByRole('button', { name: UI_TEXT.savePlan })).toBeTruthy()
    // A reload that names no plan turn: the reply is no plan here.
    reload()
    expect(screen.queryByRole('button', { name: UI_TEXT.savePlan })).toBeNull()
  })

  it('offers only Save plan in a side chat, which stays in Plan mode', () => {
    renderPanel({ sideChat: true })
    setMode('plan')
    planTurn()
    expect(screen.getByRole('button', { name: UI_TEXT.savePlan })).toBeTruthy()
    expect(screen.queryByRole('button', { name: UI_TEXT.implementPlan })).toBeNull()
  })

  it('shows the brief the host sent as a pending card with its file, the draft kept', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Message Muse'), { target: { value: 'my draft' } })
    deliver({
      type: 'briefSubmitted',
      localId: 'plan-brief-1',
      text: 'Implement the plan in .agents/plans/x.md.',
      attachments: [
        { id: 'a1', name: '.agents/plans/x.md', mediaType: 'text/plain', sizeBytes: 12 },
      ],
    })
    const card = screen.getByText('Implement the plan in .agents/plans/x.md.').closest('li')
    expect(card?.className).toContain('message-pending')
    expect(card?.textContent).toContain('.agents/plans/x.md')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message Muse').value).toBe('my draft')
    deliver({ type: 'turnAccepted', localId: 'plan-brief-1', turnId: 't9' })
    expect(card?.className).toContain('message-sent')
  })

  it('asks the host for the saved plans from the palette’s Plans…', () => {
    const postMessage = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    fireEvent.click(screen.getByText(UI_TEXT.plansItem))
    // Closing the palette gives the composer its focus back afterwards.
    expect(postMessage).toHaveBeenCalledWith({ type: 'showPlans' })
  })
})
