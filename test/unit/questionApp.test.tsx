// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'
import { questionFixture } from './helpers/questions/fixtures'
import { warmDeferredSurfaces } from './helpers/warmDeferredSurfaces'

beforeAll(warmDeferredSurfaces)

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

async function app(isRunning = false) {
  const store = createUiStore({
    ...initialUiState,
    phase: 'ready',
    sessionId: 'session-1',
    title: 'Choices',
    settings: testSettings,
    auth: { ...initialUiState.auth, status: 'signedIn' },
    activeTurnId: isRunning ? 'turn-1' : undefined,
  })
  const post = vi.fn<(message: WebviewToHostMessage) => void>()
  render(<App store={store} postMessage={post} />)
  const host = (message: HostToWebviewMessage) => {
    act(() => {
      store.dispatch({ type: 'hostMessage', message, at: 1000 })
    })
  }
  const record = questionFixture()
  host({
    type: 'agentEvent',
    event: {
      type: 'questionRequested',
      itemId: record.itemId,
      userInputId: record.userInputId,
      questions: record.questions,
    },
  })
  await dock().findByRole('radio', { name: 'Blue' })

  return { store, post, host, record }
}
function row() {
  return within(screen.getByRole('main'))
}
function dock() {
  return within(screen.getByRole('region', { name: 'Open question' }))
}
async function submitTwice() {
  await act(async () => {
    await import('../../src/webview/components/QuestionUi')
    fireEvent.click(dock().getByRole('button', { name: 'Submit' }))
    fireEvent.click(dock().getByRole('button', { name: 'Submit' }))
  })
}
function beginLateAnswer(h: Awaited<ReturnType<typeof app>>) {
  h.host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [h.record] } })
  fireEvent.change(dock().getByLabelText('Other: Colour'), { target: { value: 'Teal' } })
  fireEvent.click(dock().getByRole('button', { name: 'Submit' }))
}

describe('M112 App commands and shared question delivery', () => {
  it('renders one interactive waiting question in the dock and a compact transcript marker', async () => {
    await app()
    expect(screen.getAllByRole('radio', { name: 'Blue' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Submit' })).toHaveLength(1)
    const marker = row().getByRole('button', { name: 'Answer Open question Colour' })
    expect(marker).toBeEnabled()
    expect(marker.closest('li')).toHaveClass('tool-question-open')
    expect(screen.getByRole('main').querySelector('input, textarea, [role="tab"]')).toBeNull()
    fireEvent.click(marker)
    expect(dock().getByRole('radio', { name: 'Blue' })).toHaveFocus()
  })
  it('reopens a deferred card from the labelled marker and sends its late answer once', async () => {
    const { host, record, post } = await app()
    const composer = screen.getByRole('textbox', { name: UI_TEXT.composerLabel })
    fireEvent.change(composer, { target: { value: 'Continue independent work' } })
    act(() => {
      composer.focus()
    })
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    expect(dock().queryByRole('radio')).toBeNull()
    const marker = row().getByRole('button', { name: 'Answer Open question Colour' })
    act(() => {
      marker.focus()
    })
    expect(marker).toHaveFocus()
    fireEvent.click(marker)
    expect(dock().getByRole('radio', { name: 'Blue' })).toHaveFocus()
    expect(row().queryByRole('radio')).toBeNull()
    fireEvent.click(dock().getByRole('button', { name: 'Collapse question' }))
    fireEvent.click(marker)
    expect(dock().getByRole('radio', { name: 'Blue' })).toHaveFocus()
    fireEvent.click(dock().getByRole('radio', { name: 'Blue' }))
    await submitTwice()
    expect(post.mock.calls.filter(([message]) => message.type === 'answerOpenQuestion')).toEqual([
      [
        {
          type: 'answerOpenQuestion',
          sessionId: 'session-1',
          userInputId: 'q-1',
          reply: { answers: [{ questionId: 'colour', selectedLabel: 'Blue' }] },
        },
      ],
    ])
  })

  it('pins the only MCP form and focuses its first control from a compact marker', async () => {
    const { host } = await app()
    host({
      type: 'agentEvent',
      event: {
        type: 'elicitationRequested',
        itemId: 'form-row',
        elicitationId: 'form-1',
        server: 'Profile',
        message: 'Your nickname?',
        fields: [{ name: 'nickname', type: 'string', required: true }],
      },
    })
    const marker = await row().findByRole('button', { name: 'Answer Open question Profile' })
    expect(row().queryByRole('form')).toBeNull()
    expect(screen.getByRole('main').querySelector('input, textarea')).toBeNull()
    fireEvent.click(marker)
    expect(dock().getByLabelText('nickname')).toHaveFocus()
    expect(screen.getAllByRole('form')).toHaveLength(1)
    host({
      type: 'agentEvent',
      event: { type: 'elicitationSettled', elicitationId: 'form-1', action: 'cancel' },
    })
    expect(row().getByText('The request from Profile is no longer waiting.')).toBeVisible()
    expect(screen.queryByRole('form')).toBeNull()
  })
  it('drops an action after the same session is reattached to a new surface generation', async () => {
    const h = await app()
    const { host, record, post } = h
    beginLateAnswer(h)
    host({ type: 'conversationCleared' })
    host({
      type: 'historyLoaded',
      sessionId: 'session-1',
      name: 'Reattached',
      items: [],
      todos: [],
    })
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
    })
    expect(post.mock.calls.some(([message]) => message.type === 'answerOpenQuestion')).toBe(false)
  })
  it('drops a lazy question action after its owning surface changes sessions', async () => {
    const h = await app()
    const { host, post } = h
    beginLateAnswer(h)
    host({
      type: 'historyLoaded',
      sessionId: 'session-2',
      name: 'Another session',
      items: [],
      todos: [],
    })
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
    })
    expect(
      post.mock.calls.some(
        ([message]) => message.type === 'answerOpenQuestion' || message.type === 'answerQuestion',
      ),
    ).toBe(false)
  })
  it('selects a new waiting request before its registry snapshot arrives', async () => {
    const { host, record } = await app()
    host({
      type: 'openQuestions',
      snapshot: { sessionId: 'session-1', questions: [{ ...record, state: 'waiting' }] },
    })
    const composer = screen.getByRole('textbox', { name: UI_TEXT.composerLabel })
    fireEvent.change(composer, { target: { value: 'Keep working' } })
    act(() => {
      composer.focus()
    })
    host({
      type: 'agentEvent',
      event: {
        type: 'questionRequested',
        itemId: 'item-2',
        userInputId: 'q-2',
        questions: [{ ...record.questions[0]!, header: 'Newest' }],
      },
    })
    expect(dock().getByRole('group', { name: 'Newest' })).toBeVisible()
    expect(composer).toHaveFocus()
  })

  it('removes stale open controls and counts when an authoritative snapshot retires the question', async () => {
    const { host, record, post } = await app()
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    fireEvent.click(screen.getByRole('button', { name: '1 open question' }))
    fireEvent.change(dock().getByLabelText('Other: Colour'), { target: { value: 'Teal' } })
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [] } })
    expect(row().getByText('No longer open')).toBeVisible()
    expect(screen.queryByRole('button', { name: '1 open question' })).toBeNull()
    expect(row().queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(document.title).toBe('Choices')
    expect(post.mock.calls.some(([message]) => message.type === 'answerOpenQuestion')).toBe(false)
  })

  it('shows the newest waiting question ahead of a past reminder while the composer is typing', async () => {
    const { host, record } = await app()
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    const composer = screen.getByRole('textbox', { name: UI_TEXT.composerLabel })
    fireEvent.change(composer, { target: { value: 'Keep working' } })
    act(() => {
      composer.focus()
    })
    const reminded = { ...record, reminders: 1 }
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [reminded] } })
    const newest = questionFixture({
      userInputId: 'q-2',
      itemId: 'item-2',
      state: 'waiting',
      askedAt: 2000,
      questions: [{ ...record.questions[0]!, header: 'Newest' }],
    })
    host({
      type: 'agentEvent',
      event: {
        type: 'questionRequested',
        itemId: newest.itemId,
        userInputId: newest.userInputId,
        questions: newest.questions,
      },
    })
    host({
      type: 'openQuestions',
      snapshot: { sessionId: 'session-1', questions: [reminded, newest] },
    })
    expect(dock().getByRole('group', { name: 'Newest' })).toBeVisible()
    expect(dock().queryByRole('group', { name: 'Colour' })).toBeNull()
    expect(composer).toHaveFocus()
  })

  it.each([false, true])(
    'routes one late answer from the pinned card in an idle/running session (%s)',
    async (isRunning) => {
      const { host, record, post } = await app(isRunning)
      fireEvent.change(dock().getByLabelText('Other: Colour'), { target: { value: 'Teal' } })
      host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
      await submitTwice()
      const answers = post.mock.calls.filter(([message]) => message.type === 'answerOpenQuestion')
      expect(answers).toEqual([
        [
          {
            type: 'answerOpenQuestion',
            sessionId: 'session-1',
            userInputId: 'q-1',
            reply: { answers: [{ questionId: 'colour', freeText: 'Teal' }] },
          },
        ],
      ])
      expect(post.mock.calls.some(([message]) => message.type === 'answerQuestion')).toBe(false)
      host({
        type: 'openQuestions',
        snapshot: { sessionId: 'session-1', questions: [{ ...record, state: 'answeredLater' }] },
      })
      expect(row().getByText('Answered later')).toBeVisible()
      expect(screen.queryByRole('button', { name: '1 open question' })).toBeNull()
      expect(document.title).toBe('Choices')
      expect(screen.getByText(UI_TEXT.announceLateAnswerSent)).toBeInTheDocument()
    },
  )

  it('delivers an explanation after deferral and retains uncertainty without offering another send', async () => {
    const { host, record, post } = await app()
    fireEvent.click(dock().getByRole('button', { name: 'Explain instead' }))
    fireEvent.change(dock().getByLabelText('Your explanation'), {
      target: { value: ' Neither choice ' },
    })
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
      fireEvent.click(dock().getByRole('button', { name: 'Send explanation' }))
    })
    expect(post).toHaveBeenCalledWith({
      type: 'answerOpenQuestion',
      sessionId: 'session-1',
      userInputId: 'q-1',
      reply: { explanation: 'Neither choice' },
    })
    host({ type: 'notice', level: 'error', text: UI_TEXT.questionAnswerUncertain })
    expect(dock().getByRole('button', { name: 'Send explanation' })).toBeDisabled()
    host({ type: 'notice', level: 'error', text: UI_TEXT.questionAnswerFailed })
    expect(dock().getByRole('button', { name: 'Send explanation' })).toBeEnabled()
    await act(async () => {
      await import('../../src/webview/components/QuestionUi')
      fireEvent.click(dock().getByRole('button', { name: 'Send explanation' }))
    })
    expect(
      post.mock.calls.filter(([message]) => message.type === 'answerOpenQuestion'),
    ).toHaveLength(2)
  })

  it('handles host navigation without echo, expands/focuses the dock and updates document title', async () => {
    const { host, record, post } = await app()
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    expect(document.title).toBe('Choices · 1 open')
    post.mockClear()
    host({ type: 'jumpToOpenQuestion', sessionId: 'session-1', direction: 'next' })
    expect(dock().getByRole('radio', { name: 'Blue' })).toHaveFocus()
    expect(dock().getByRole('button', { name: 'Submit' })).toBeVisible()
    expect(post.mock.calls.some(([message]) => message.type === 'jumpToOpenQuestion')).toBe(false)
    fireEvent.click(dock().getByRole('button', { name: 'Collapse question' }))
    expect(row().queryByRole('button', { name: 'Submit' })).toBeNull()
    host({ type: 'jumpToOpenQuestion', sessionId: 'session-1', direction: 'next' })
    expect(dock().getByRole('button', { name: 'Submit' })).toBeVisible()
  })

  it('expands an automatic reminder in the dock without stealing a typing composer or jumping the row', async () => {
    const { host, record } = await app()
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    const composer = screen.getByRole('textbox', { name: UI_TEXT.composerLabel })
    fireEvent.change(composer, { target: { value: 'Keep working while I type' } })
    act(() => {
      composer.focus()
    })
    host({
      type: 'openQuestions',
      snapshot: { sessionId: 'session-1', questions: [{ ...record, reminders: 1 }] },
    })
    expect(composer).toHaveFocus()
    expect(dock().getByRole('button', { name: 'Submit' })).toBeVisible()
    expect(row().queryByRole('button', { name: 'Submit' })).toBeNull()
  })

  it('offers Dismiss only for open questions and sends the session-scoped command once', async () => {
    const { host, record, post } = await app()
    expect(row().queryByRole('button', { name: 'More actions' })).toBeNull()
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    fireEvent.click(row().getByRole('button', { name: 'Answer Open question Colour' }))
    fireEvent.click(dock().getByRole('button', { name: 'More actions' }))
    const dismissItem = await screen.findByRole('menuitem', { name: 'Dismiss' })
    fireEvent.click(dismissItem)
    // App dispatches through a lazy command module; wait for its observable
    // result rather than assuming a second import settles its callback too.
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith({
        type: 'dismissOpenQuestion',
        sessionId: 'session-1',
        userInputId: 'q-1',
      })
    })
    fireEvent.click(screen.getByRole('button', { name: '1 open question' }))
    fireEvent.click(dock().getByRole('button', { name: 'More actions' }))
    const dismiss = await screen.findByRole('menuitem', { name: 'Dismiss' })
    expect(dismiss).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(dismiss)
    expect(
      post.mock.calls.filter(([message]) => message.type === 'dismissOpenQuestion'),
    ).toHaveLength(1)
    host({
      type: 'openQuestions',
      snapshot: { sessionId: 'session-1', questions: [{ ...record, state: 'dismissed' }] },
    })
    expect(row().getByText('Dismissed')).toBeVisible()
  })

  it('keeps an open row to one header line with an accent and preserves future settlement words', async () => {
    const { host, record } = await app()
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    const card = row().getByRole('group', { name: 'Colour' })
    expect(card.closest('li')).toHaveClass('tool-question-open')
    expect(card.closest('li')?.querySelector('.tool-header')).toHaveAttribute('hidden')
    host({
      type: 'agentEvent',
      event: {
        type: 'questionSettled',
        userInputId: record.userInputId,
        outcome: 'future-outcome',
        answers: [],
        clarification: 'Additional details',
      },
    })
    expect(row().getByText('future-outcome: Additional details')).toBeVisible()
  })

  it('shows a rowless resumed question with a dock navigation target', async () => {
    const { host, record } = await app()
    host({ type: 'historyLoaded', sessionId: 'session-1', name: 'Choices', items: [], todos: [] })
    host({ type: 'openQuestions', snapshot: { sessionId: 'session-1', questions: [record] } })
    fireEvent.click(screen.getByRole('button', { name: '1 open question' }))
    expect(dock().getByRole('button', { name: 'Submit' })).toBeVisible()
    expect(row().queryByRole('group', { name: 'Colour' })).toBeNull()
    host({ type: 'jumpToOpenQuestion', sessionId: 'session-1', direction: 'next' })
    expect(dock().getByRole('radio', { name: 'Blue' })).toHaveFocus()
  })
})
