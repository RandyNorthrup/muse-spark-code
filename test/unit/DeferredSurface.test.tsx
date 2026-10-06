// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { lazy, useState, type ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { deferred, DeferredSurface } from '../../src/webview/components/DeferredSurface'
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

function ValueBody({ value }: { readonly value: string }) {
  return <p>{value}</p>
}
function LoadedBody() {
  return <p>Loaded</p>
}

it('loads on use, shows an honest failure, retries and receives current props', async () => {
  const name = 'Optional panel'

  const first = Promise.withResolvers<{ default: typeof ValueBody }>()
  const load = vi
    .fn<() => Promise<{ default: typeof ValueBody }>>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ default: ValueBody })
  const Surface = deferred(load)
  const onClose = vi.fn()
  const tree = (isOpen: boolean, value: string) =>
    isOpen ? <Surface value={value} onClose={onClose} /> : <p>Chat</p>
  const view = render(tree(false, name))
  expect(load).not.toHaveBeenCalled()
  view.rerender(tree(true, name))
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent(EN.loadingOutput)
  view.rerender(tree(true, `${name}: latest`))
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await act(async () => {
      first.reject(new Error('chunk fetch failed'))
      try {
        await first.promise
      } catch {
        /* React reports the rejection. */
      }
    })
    expect(screen.getByRole('alert')).toHaveTextContent(EN.surfaceLoadFailed)
    expect(screen.queryByText('chunk fetch failed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EN.surfaceLoadRetry }))
    expect(await screen.findByText(`${name}: latest`)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
    view.rerender(tree(false, name))
    view.rerender(tree(true, `${name}: reopened`))
    expect(screen.getByText(`${name}: reopened`)).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  } finally {
    errors.mockRestore()
  }
})

it('closing a pending modal prevents a late import from reopening it', async () => {
  const held = Promise.withResolvers<{ default: typeof LoadedBody }>()
  const Surface = deferred(() => held.promise, true)
  const view = render(
    <Surface
      onClose={() => {
        view.unmount()
      }}
    />,
  )
  expect(screen.getByRole('dialog')).toHaveAccessibleName(EN.loadingOutput)
  fireEvent.click(screen.getByRole('button', { name: EN.usageClose }))
  await act(async () => {
    held.resolve({ default: LoadedBody })
    await held.promise
  })
  expect(screen.queryByText('Loaded')).toBeNull()
})

it('keeps an attached menu’s opener focused and accepts Escape while loading', async () => {
  const held = Promise.withResolvers<{ default: typeof LoadedBody }>()
  const Surface = deferred(() => held.promise)
  const onClose = vi.fn()
  const view = render(<textarea aria-label="Prompt" />)
  const prompt = screen.getByLabelText('Prompt')
  prompt.focus()
  view.rerender(
    <>
      <textarea aria-label="Prompt" />
      <Surface keepFocus onClose={onClose} />
    </>,
  )
  expect(document.activeElement).toBe(prompt)
  fireEvent.keyDown(prompt, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  await act(async () => {
    held.resolve({ default: LoadedBody })
    await held.promise
  })
  expect(document.activeElement).toBe(prompt)
})
