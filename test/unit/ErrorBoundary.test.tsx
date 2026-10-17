// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'

function Bomb({ shouldThrow }: { readonly shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('render exploded')
  }
  return <p>fine</p>
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children while nothing throws', () => {
    render(
      <ErrorBoundary onReload={() => undefined} onError={() => undefined}>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error with a Reload button that asks the host for a fresh document', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // React and the boundary both report; the test asserts on the boundary's line.
    })
    const onReload = vi.fn()
    const onError = vi.fn()
    render(
      <ErrorBoundary onReload={onReload} onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The panel hit an error')
    expect(alert).toHaveTextContent('render exploded')
    expect(screen.queryByText('fine')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledOnce()
    // The error goes to the host's log too (M39).
    expect(onError).toHaveBeenCalledWith(new Error('render exploded'))
    expect(
      consoleError.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('render exploded'),
      ),
    ).toBe(true)
  })

  it('describes a non-Error throw by its string form', () => {
    expect(ErrorBoundary.getDerivedStateFromError('plain string')).toEqual({
      message: 'plain string',
    })
  })
})
