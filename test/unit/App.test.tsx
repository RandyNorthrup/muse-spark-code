// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/webview/App'
import { testSettings } from './helpers/fakes'

function deliver(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function silenceConsoleWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {
    // The tests assert on the call, not on the output.
  })
}

const init = {
  type: 'init',
  extensionVersion: '9.9.9',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
  settings: testSettings,
}

function renderReady(status: 'signedIn' | 'signedOut' = 'signedIn') {
  const postMessage = vi.fn()
  render(<App postMessage={postMessage} newLocalId={() => 'local-1'} />)
  deliver(init)
  deliver({ type: 'authState', status })
  return postMessage
}

describe('App shell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('announces ready to the host on mount', () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledWith({ type: 'ready' })
  })

  it('shows a connecting status until init arrives', () => {
    render(<App postMessage={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the extension host')
    expect(screen.queryByLabelText('Message Muse')).toBeNull()
  })

  it('renders the empty state once signed in and focuses the composer', () => {
    renderReady()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
    const textarea = screen.getByLabelText('Message Muse')
    expect(textarea).toHaveAttribute('placeholder', init.composerPlaceholder)
    expect(document.activeElement).toBe(textarea)
    expect(screen.getByLabelText('Extension version')).toHaveTextContent('v9.9.9')
    expect(screen.getByLabelText('Model')).toHaveTextContent('Starting Muse Code')
  })

  it('reports composer focus changes and new-tab clicks to the host', () => {
    const postMessage = renderReady()
    fireEvent.blur(screen.getByLabelText('Message Muse'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'inputFocusChanged', focused: false })
    fireEvent.click(screen.getByLabelText('New conversation'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'openNewTab' })
  })

  it('inserts host-provided text at the caret', () => {
    renderReady()
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
    fireEvent.change(textarea, { target: { value: 'look at ' } })
    textarea.setSelectionRange(8, 8)
    deliver({ type: 'insertText', text: '@src/app.ts#5-10 ' })
    expect(textarea).toHaveValue('look at @src/app.ts#5-10 ')
  })

  it('shows the Focus view badge when the setting changes', () => {
    renderReady()
    expect(screen.queryByText('Focus view')).toBeNull()
    deliver({ type: 'settingsChanged', settings: { ...testSettings, focusView: true } })
    expect(screen.getByText('Focus view')).toBeInTheDocument()
  })

  it('ignores malformed host messages', () => {
    const warn = silenceConsoleWarn()
    render(<App postMessage={vi.fn()} />)
    deliver({ type: 'init', extensionVersion: 1 })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('stops listening after unmount', () => {
    const { unmount } = render(<App postMessage={vi.fn()} />)
    unmount()
    const warn = silenceConsoleWarn()
    deliver({ type: 'bogus' })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('App sign-in gate', () => {
  it('offers both sign-in paths when signed out and forwards the choice', () => {
    const postMessage = renderReady('signedOut')
    expect(screen.getByRole('heading', { name: 'Sign in to Muse Spark' })).toBeInTheDocument()
    expect(screen.getByLabelText('Model')).toHaveTextContent('Not signed in')
    fireEvent.click(screen.getByText('Sign in with your Meta account'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'signIn', method: 'browser' })
    fireEvent.click(screen.getByText('Use a Model API key'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'signIn', method: 'apiKey' })
  })

  it('shows install instructions when the CLI is missing', () => {
    const postMessage = renderReady()
    deliver({ type: 'authState', status: 'noCli', detail: 'Searched: C:/nowhere' })
    expect(screen.getByRole('heading', { name: 'Muse Code is not installed' })).toBeInTheDocument()
    expect(screen.getByText('Searched: C:/nowhere')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open install instructions'))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'openExternal',
      url: 'https://dev.meta.ai/products/muse-code/',
    })
    fireEvent.click(screen.getByText('Check again'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'retryBackend' })
  })

  it('shows the waiting state while the browser sign-in runs', () => {
    renderReady('signedOut')
    deliver({ type: 'authState', status: 'signingIn', detail: 'Waiting for the browser…' })
    expect(screen.getByText('Waiting for the browser…')).toBeInTheDocument()
    expect(screen.queryByText('Sign in with your Meta account')).toBeNull()
  })
})

describe('App conversation', () => {
  it('sends the draft, echoes it, and streams the reply', () => {
    const postMessage = renderReady()
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
    fireEvent.change(textarea, { target: { value: 'hello muse' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'sendMessage',
      localId: 'local-1',
      text: 'hello muse',
    })
    expect(textarea).toHaveValue('')
    expect(screen.getByText('hello muse')).toBeInTheDocument()

    deliver({ type: 'turnAccepted', localId: 'local-1', turnId: 't1' })
    expect(screen.getByLabelText('Stop')).toBeInTheDocument()
    deliver({
      type: 'agentEvent',
      event: { type: 'itemStarted', itemId: 'm1', kind: 'agentMessage' },
    })
    deliver({
      type: 'agentEvent',
      event: { type: 'textDelta', itemId: 'm1', field: 'text', delta: 'hi there' },
    })
    expect(screen.getByText('hi there')).toBeInTheDocument()
    deliver({
      type: 'agentEvent',
      event: { type: 'turnCompleted', turnId: 't1', terminal: 'completed' },
    })
    expect(screen.getByLabelText('Send')).toBeInTheDocument()
  })

  it('stops the running turn from the Stop button', () => {
    const postMessage = renderReady()
    deliver({ type: 'agentEvent', event: { type: 'turnStarted', turnId: 't1' } })
    fireEvent.click(screen.getByLabelText('Stop'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'cancelTurn' })
  })

  it('shows the send failure reason on the echoed message', () => {
    renderReady()
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    deliver({ type: 'sendFailed', localId: 'local-1', reason: 'Open a folder first' })
    expect(screen.getByRole('alert')).toHaveTextContent('Open a folder first')
  })

  it('labels the model pill with the session model and context window', () => {
    renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', contextLimit: 1_007_997 })
    expect(screen.getByLabelText('Model')).toHaveTextContent('muse-spark-1.3 (1M)')
    deliver({ type: 'sessionInfo', modelId: 'small', contextLimit: 128_000 })
    expect(screen.getByLabelText('Model')).toHaveTextContent('small (128K)')
  })
})
