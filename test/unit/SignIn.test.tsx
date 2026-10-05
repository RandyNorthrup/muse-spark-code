// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SignIn, type SignInProps } from '../../src/webview/components/SignIn'

function renderSignIn(overrides: Partial<SignInProps> = {}) {
  const props: SignInProps = {
    status: 'signedOut',
    detail: undefined,
    onSignIn: vi.fn(),
    onInstall: vi.fn(),
    onCancelSignIn: vi.fn(),
    onRetry: vi.fn(),
    onOpenExternal: vi.fn(),
    ...overrides,
  }
  render(<SignIn {...props} />)
  return props
}

describe('SignIn', () => {
  it('shows the sign-in choices without a diagnostic when signed out cleanly', () => {
    const props = renderSignIn()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Check again')).toBeNull()
    fireEvent.click(screen.getByText('Sign in with your Meta account'))
    fireEvent.click(screen.getByText('Use a Model API key'))
    expect(vi.mocked(props.onSignIn).mock.calls).toEqual([['browser'], ['apiKey']])
  })

  it('shows a timed-out detail as plain text, not an alert', () => {
    renderSignIn({ detail: 'The sign-in did not complete in time. Try again.' })
    expect(screen.getByText('The sign-in did not complete in time. Try again.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a backend error as an alert with a retry button', () => {
    const props = renderSignIn({ status: 'error', detail: 'Muse Code stopped unexpectedly.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Muse Code stopped unexpectedly.')
    fireEvent.click(screen.getByText('Check again'))
    expect(props.onRetry).toHaveBeenCalledOnce()
  })

  it('shows install guidance when the CLI is missing, with and without a diagnostic', () => {
    const props = renderSignIn({ status: 'noCli' })
    expect(screen.getByRole('heading', { name: 'Muse Code is not installed' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open install instructions'))
    expect(props.onOpenExternal).toHaveBeenCalledWith('https://dev.meta.ai/products/muse-code/')
  })

  it('shows the waiting text while signing in, falling back to the default copy', () => {
    const props = renderSignIn({ status: 'signingIn' })
    expect(screen.getByText('Waiting for browser approval…')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancel sign-in'))
    expect(props.onCancelSignIn).toHaveBeenCalledOnce()
  })

  it('shows the exact installer command before starting it', () => {
    const props = renderSignIn({
      status: 'noCli',
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
    })
    fireEvent.click(screen.getByText('Install Muse Code'))
    expect(screen.getByRole('dialog', { name: 'Install Muse Code' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(screen.getByText('irm https://dev.meta.ai/install.ps1 | iex')).toBeInTheDocument()
    expect(props.onInstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('dialog', { name: 'Install Muse Code' })).toBeNull()
    expect(props.onInstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Install Muse Code'))
    fireEvent.click(screen.getByText('Run installer'))
    expect(props.onInstall).toHaveBeenCalledOnce()
  })

  it('shows the device code and cancel action in the panel', () => {
    const props = renderSignIn({
      status: 'signingIn',
      verificationUrl: 'https://auth.meta.com/oauth/device/?code=example',
      userCode: 'ABCD-EFGH',
    })
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Open sign-in page'))
    expect(props.onOpenExternal).toHaveBeenCalledWith(
      'https://auth.meta.com/oauth/device/?code=example',
    )
    fireEvent.click(screen.getByText('Cancel sign-in'))
    expect(props.onCancelSignIn).toHaveBeenCalledOnce()
  })

  it('offers only the paths the host lists, and the key path beside the install guidance', () => {
    const props = renderSignIn({ methods: ['apiKey'] })
    expect(screen.queryByText('Sign in with your Meta account')).toBeNull()
    fireEvent.click(screen.getByText('Use a Model API key'))
    expect(props.onSignIn).toHaveBeenCalledWith('apiKey')
  })

  it('shows the key path with the install guidance when the CLI is missing but a key would do', () => {
    const props = renderSignIn({ status: 'noCli', methods: ['apiKey'] })
    expect(
      screen.getByText(
        'The Muse Code CLI hosts conversations for this extension; without it you can still use a Meta Model API key.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Use a Model API key'))
    expect(props.onSignIn).toHaveBeenCalledWith('apiKey')
    renderSignIn({ status: 'noCli', methods: [] })
    expect(screen.queryAllByText('Use a Model API key')).toHaveLength(1)
  })

  it('ranks the own-model choice equally with the other two when no backend is set up', () => {
    const props = renderSignIn({ methods: ['browser', 'apiKey', 'byo'] })
    const browser = screen.getByText('Sign in with your Meta account')
    const key = screen.getByText('Use a Model API key')
    const own = screen.getByText('Start with your own model')
    expect(screen.getByText('Add a model provider with an API key and pick a model.'))
      .toBeInTheDocument()
    for (const button of [browser, key, own]) {
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveClass('button-primary')
    }
    fireEvent.click(own)
    expect(props.onSignIn).toHaveBeenCalledWith('byo')
  })

  it('keeps the ranking when the own-model choice is missing', () => {
    renderSignIn({ methods: ['browser', 'apiKey'] })
    expect(screen.getByText('Sign in with your Meta account')).toHaveClass('button-primary')
    expect(screen.getByText('Use a Model API key')).toHaveClass('button-secondary')
    expect(screen.queryByText('Start with your own model')).toBeNull()
  })

  it('offers the own-model choice beside the install guidance when the CLI is missing', () => {
    const props = renderSignIn({ status: 'noCli', methods: ['browser', 'apiKey', 'byo'] })
    fireEvent.click(screen.getByText('Start with your own model'))
    expect(props.onSignIn).toHaveBeenCalledWith('byo')
  })
})
