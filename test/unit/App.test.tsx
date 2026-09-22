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

describe('App', () => {
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

  it('renders the shell from init and focuses the composer', () => {
    render(<App postMessage={vi.fn()} />)
    deliver(init)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
    const textarea = screen.getByLabelText('Message Muse')
    expect(textarea).toHaveAttribute('placeholder', init.composerPlaceholder)
    expect(document.activeElement).toBe(textarea)
    expect(screen.getByLabelText('Extension version')).toHaveTextContent('v9.9.9')
    expect(screen.getByText('Muse Spark')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Untitled' })).toBeInTheDocument()
  })

  it('reports composer focus changes to the host', () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)
    deliver(init)
    const textarea = screen.getByLabelText('Message Muse')
    fireEvent.blur(textarea)
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'inputFocusChanged', focused: false })
    fireEvent.focus(textarea)
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'inputFocusChanged', focused: true })
  })

  it('inserts host-provided text at the caret', () => {
    render(<App postMessage={vi.fn()} />)
    deliver(init)
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
    fireEvent.change(textarea, { target: { value: 'look at ' } })
    textarea.setSelectionRange(8, 8)
    deliver({ type: 'insertText', text: '@src/app.ts#5-10 ' })
    expect(textarea).toHaveValue('look at @src/app.ts#5-10 ')
  })

  it('shows the Focus view badge when the setting changes', () => {
    render(<App postMessage={vi.fn()} />)
    deliver(init)
    expect(screen.queryByText('Focus view')).toBeNull()
    deliver({ type: 'settingsChanged', settings: { ...testSettings, focusView: true } })
    expect(screen.getByText('Focus view')).toBeInTheDocument()
  })

  it('asks the host for a new tab from the header button', () => {
    const postMessage = vi.fn()
    render(<App postMessage={postMessage} />)
    deliver(init)
    fireEvent.click(screen.getByLabelText('New conversation'))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'openNewTab' })
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
