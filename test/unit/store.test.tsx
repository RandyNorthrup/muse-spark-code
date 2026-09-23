// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodoItem } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import type { WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'
import { restoredUiState, type WebviewState } from '../../src/webview/state/snapshot'
import { createUiStore, listenToHost, persistStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

// M25 (PLAN.md D28): the UI state lives outside React, keeps reducing under
// the crash screen, and comes back after its Reload.

/** Set to make the next render of the task panel throw: any render bug. */
const bomb = { isArmed: false }

vi.mock('../../src/webview/components/TodoPanel', () => ({
  // A task called "boom" is a bug in the state itself: it throws on every render.
  TodoPanel: ({ items }: { readonly items: readonly TodoItem[] }) => {
    if (bomb.isArmed || items.some((item) => item.text === 'boom')) {
      throw new Error('render exploded')
    }
    return null
  },
}))

function deliver(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

const init = {
  type: 'init',
  emptyStateHint: 'hint',
  composerPlaceholder: 'placeholder',
  settings: testSettings,
}

/** What VS Code keeps between documents: `setState` serialises to JSON. */
function throughJson(state: WebviewState | undefined): unknown {
  // Not structuredClone: JSON drops the keys whose value is undefined, as VS Code's copy does.
  const text = JSON.stringify(state ?? {})
  return JSON.parse(text) as unknown
}

/** One webview document: its store, listener, persister and the rendered app. */
function openDocument(saved: unknown) {
  const store = createUiStore(restoredUiState(saved))
  const stop = listenToHost(store, window, () => 0)
  const states: WebviewState[] = []
  const persister = persistStore(store, (state) => {
    states.push(state)
  })
  const posted = vi.fn<(message: WebviewToHostMessage) => void>()
  const view = render(
    <ErrorBoundary
      onReload={() => {
        persister.flush(store.hasRendered())
      }}
    >
      <App store={store} postMessage={posted} />
    </ErrorBoundary>,
  )
  const close = () => {
    view.unmount()
    stop()
  }
  return { store, states, posted, close }
}

/** The host's answer to `ready` for a surface whose session s1 runs turn t1. */
function hostReady(sessionId: string | undefined, activeTurnId?: string) {
  deliver(init)
  deliver({
    type: 'surfaceState',
    ...(sessionId !== undefined && { sessionId }),
    ...(activeTurnId !== undefined && { activeTurnId }),
  })
  deliver({ type: 'authState', status: 'signedIn' })
  if (sessionId !== undefined) {
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId })
  }
}

function event(payload: unknown) {
  deliver({ type: 'agentEvent', event: payload })
}

describe('the UI store (M25)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reduces valid host messages with no app mounted, and stops when told', () => {
    const store = createUiStore(initialUiState)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // asserted below
    })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const stop = listenToHost(store, window, () => 5)
    deliver(init)
    expect(store.getState().phase).toBe('ready')
    expect(listener).toHaveBeenCalledOnce()
    deliver({ type: 'init', settings: 1 })
    expect(warn).toHaveBeenCalledOnce()
    // An action that changes nothing tells nobody.
    store.dispatch({
      type: 'hostMessage',
      message: { type: 'agentEvent', event: { type: 'skillsChanged' } },
      at: 0,
    })
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    stop()
    deliver({ type: 'focusInput' })
    expect(store.getState().focusRequests).toBe(1)
  })

  it('saves at most once per interval while the state changes, and at once on flush', () => {
    vi.useFakeTimers()
    const store = createUiStore(initialUiState)
    const save = vi.fn<(state: WebviewState) => void>()
    const persister = persistStore(store, save, 1000)
    store.dispatch({ type: 'draftChanged', draft: 'a' })
    store.dispatch({ type: 'draftChanged', draft: 'ab' })
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0].snapshot).toMatchObject({ draft: 'ab' })
    store.dispatch({ type: 'draftChanged', draft: 'abc' })
    persister.flush(false)
    expect(save).toHaveBeenLastCalledWith({})
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(2)
  })
})

describe('the crash screen and its Reload (M25)', () => {
  beforeEach(() => {
    bomb.isArmed = false
    vi.spyOn(console, 'error').mockImplementation(() => {
      // React and the boundary report the render error; the tests assert on the screen.
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps reducing under the crash screen and comes back with the transcript, the turn and the card', () => {
    const first = openDocument(undefined)
    hostReady('s1', 't1')
    event({ type: 'turnStarted', turnId: 't1' })
    event({
      type: 'itemStarted',
      item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress', text: 'Before' },
    })
    bomb.isArmed = true
    event({ type: 'todoChanged', items: [{ text: 'Write tests', status: 'pending' }] })
    expect(screen.getByText(UI_TEXT.crashTitle)).toBeInTheDocument()
    bomb.isArmed = false
    // The turn goes on while the crash screen shows.
    event({ type: 'textDelta', itemId: 'm1', field: 'text', delta: ' and after' })
    event({
      type: 'questionRequested',
      userInputId: 'u1',
      itemId: 'q1',
      questions: [
        {
          id: 'c',
          header: 'Colour',
          question: 'Which?',
          selection: { mode: 'single' },
          options: [{ label: 'Red' }],
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.crashReload }))
    first.close()

    const second = openDocument(throughJson(first.states.at(-1)))
    deliver(init)
    // Nothing is shown until the host says the conversation is still live.
    expect(screen.getByText(UI_TEXT.connecting)).toBeInTheDocument()
    deliver({ type: 'surfaceState', sessionId: 's1', activeTurnId: 't1' })
    deliver({ type: 'authState', status: 'signedIn' })
    expect(screen.getByText('Before and after')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Red' })).toBeInTheDocument()
    expect(screen.getByLabelText('Stop')).toBeInTheDocument()
    second.close()
  })

  it('drops a restored conversation whose session the host no longer holds', () => {
    const first = openDocument(undefined)
    hostReady('s1')
    event({
      type: 'itemCompleted',
      item: { itemId: 'm1', kind: 'agentMessage', status: 'completed', text: 'Old reply' },
    })
    bomb.isArmed = true
    event({ type: 'todoChanged', items: [] })
    bomb.isArmed = false
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.crashReload }))
    first.close()
    const second = openDocument(throughJson(first.states.at(-1)))
    hostReady(undefined)
    expect(screen.queryByText('Old reply')).toBeNull()
    expect(screen.getByText('hint')).toBeInTheDocument()
    second.close()
  })

  it('breaks the loop when the restored state itself crashes: the second Reload keeps only the session', () => {
    const first = openDocument(undefined)
    hostReady('s1')
    event({ type: 'todoChanged', items: [{ text: 'boom', status: 'pending' }] })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.crashReload }))
    first.close()
    const second = openDocument(throughJson(first.states.at(-1)))
    hostReady('s1')
    // The saved state crashes its first render too.
    expect(screen.getByText(UI_TEXT.crashTitle)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.crashReload }))
    expect(second.states.at(-1)).toEqual({ sessionId: 's1' })
    second.close()
    const third = openDocument(throughJson(second.states.at(-1)))
    hostReady('s1')
    expect(screen.queryByText(UI_TEXT.crashTitle)).toBeNull()
    third.close()
  })
})
