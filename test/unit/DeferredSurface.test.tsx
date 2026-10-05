// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { lazy, type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { DeferredSurface } from '../../src/webview/components/DeferredSurface'

function pendingSurface() {
  const { promise, resolve } = Promise.withResolvers<{ default: () => ReactNode }>()
  return { Content: lazy(() => promise), promise, resolve }
}

describe('deferred Account & usage surface', () => {
  it('keeps loading modal focus and renders the content when its import completes', async () => {
    const { Content, promise, resolve } = pendingSurface()
    const close = vi.fn()
    render(
      <DeferredSurface onClose={close}>
        <Content />
      </DeferredSurface>,
    )
    expect(screen.getByRole('dialog', { name: UI_TEXT.loadingOutput })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
    expect(screen.getByRole('button', { name: UI_TEXT.usageClose })).toHaveFocus()
    await act(async () => {
      resolve({ default: () => <p>Loaded account fixture</p> })
      await promise
    })
    expect(screen.getByText('Loaded account fixture')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(close).not.toHaveBeenCalled()
  })

  it('does not reopen after Escape closes a pending import', async () => {
    const { Content, promise, resolve } = pendingSurface()
    const loaded = vi.fn(() => <p>Late account fixture</p>)
    function Harness() {
      const [isOpen, setIsOpen] = useState(true)
      return (
        <DeferredSurface
          onClose={() => {
            setIsOpen(false)
          }}
        >
          {isOpen ? <Content /> : null}
        </DeferredSurface>
      )
    }
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole('button', { name: UI_TEXT.usageClose }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      resolve({ default: loaded })
      await promise
    })
    expect(screen.queryByText('Late account fixture')).toBeNull()
    expect(loaded).not.toHaveBeenCalled()
  })
})
