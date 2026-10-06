// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { lazy, useState, type ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { DeferredSurface } from '../../src/webview/components/DeferredSurface'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'

function heldSurface(isModal = true) {
  const pending = Promise.withResolvers<{ default: ComponentType<{ value: string }> }>()
  const Page = lazy(() => pending.promise)
  const mounted = vi.fn()
  function Loaded({ value }: { readonly value: string }) {
    mounted()
    return <button>{value}</button>
  }
  function Harness() {
    const [open, setOpen] = useState(true)
    const [value, setValue] = useState('before')
    return (
      <>
        <button
          onClick={() => {
            setValue('after')
          }}
        >
          Change
        </button>
        {open ? (
          <DeferredSurface
            isModal={isModal}
            onClose={() => {
              setOpen(false)
            }}
          >
            <Page value={value} />
          </DeferredSurface>
        ) : null}
      </>
    )
  }
  return { pending, Loaded, Harness, mounted }
}

describe('deferred surfaces', () => {
  it.each([true, false])(
    'announces loading and closes on Escape before a late import (%s)',
    async (isModal) => {
      const held = heldSurface(isModal)
      render(<held.Harness />)
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: UI_TEXT.usageClose }))
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      await act(async () => {
        held.pending.resolve({ default: held.Loaded })
        await held.pending.promise
      })
      expect(held.mounted).not.toHaveBeenCalled()
      expect(screen.queryByRole('status')).toBeNull()
      expect(screen.queryByText('before')).toBeNull()
    },
  )

  it('keeps controls unavailable while loading and renders the latest state', async () => {
    const held = heldSurface()
    render(<held.Harness />)
    expect(held.mounted).not.toHaveBeenCalled()
    expect(screen.queryByText('before')).toBeNull()
    fireEvent.click(screen.getByText('Change'))
    await act(async () => {
      held.pending.resolve({ default: held.Loaded })
      await held.pending.promise
    })
    expect(screen.getByRole('button', { name: 'after' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reports a missing chunk through the existing reload boundary', async () => {
    const held = heldSurface()
    const onError = vi.fn()
    const reload = vi.fn()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    try {
      render(
        <ErrorBoundary onError={onError} onReload={reload}>
          <held.Harness />
        </ErrorBoundary>,
      )
      const failure = new Error('missing deferred chunk')
      await act(async () => {
        held.pending.reject(failure)
        try {
          await held.pending.promise
        } catch {
          // React reports this rejected load through the boundary.
        }
      })
      expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.crashTitle)
      expect(onError).toHaveBeenCalledWith(failure)
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.crashReload }))
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      errorLog.mockRestore()
    }
  })
})
