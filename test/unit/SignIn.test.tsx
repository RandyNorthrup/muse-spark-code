// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SignIn, type SignInProps } from '../../src/webview/components/SignIn'

function renderSignIn(overrides: Partial<SignInProps> = {}) {
  const props: SignInProps = {
    status: 'signedOut',
    detail: undefined,
    onSignIn: vi.fn(),
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
    renderSignIn({ status: 'signingIn' })
    expect(screen.getByText('Waiting for the browser sign-in to finish…')).toBeInTheDocument()
  })
})
