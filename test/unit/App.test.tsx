// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/webview/App'

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
  })

  it('renders the empty-state hint, placeholder and version from init', () => {
    render(<App postMessage={vi.fn()} />)
    deliver(init)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(init.emptyStateHint)).toBeInTheDocument()
    expect(screen.getByLabelText('Message Muse')).toHaveAttribute(
      'placeholder',
      init.composerPlaceholder,
    )
    expect(screen.getByLabelText('Extension version')).toHaveTextContent('v9.9.9')
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
