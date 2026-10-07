// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { lazy, useState, type ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { retrySurface } from '../../src/webview/surfaceRetry'

vi.mock('../../src/webview/surfaceRetry', () => ({ retrySurface: vi.fn() }))
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

it('loads on use, shows an honest failure and retries by reloading the document', async () => {
  const name = 'Optional panel'

  const first = Promise.withResolvers<{ default: typeof ValueBody }>()
  const load = vi
    .fn<() => Promise<{ default: typeof ValueBody }>>()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue({ default: ValueBody })
  const Surface = deferred(load)
  const onClose = vi.fn()
  const tree = (isOpen: boolean, value: string) =>
    isOpen ? <Surface className="review-comment" value={value} onClose={onClose} /> : <p>Chat</p>
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
    expect(screen.getByRole('alert').parentElement).toHaveClass('review-comment')
    expect(screen.queryByText('chunk fetch failed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EN.surfaceLoadRetry }))
    expect(retrySurface).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(EN.surfaceLoadFailed)
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

it('a successful lazy surface keeps current props and its cached module across opens', async () => {
  const held = Promise.withResolvers<{ default: typeof ValueBody }>()
  const load = vi.fn(() => held.promise)
  const Surface = deferred(load)
  const view = render(<Surface value="before" />)
  view.rerender(<Surface value="latest" />)
  await act(async () => {
    held.resolve({ default: ValueBody })
    await held.promise
  })
  expect(screen.getByText('latest')).toBeInTheDocument()
  view.rerender(<p>Chat</p>)
  view.rerender(<Surface value="reopened" />)
  expect(screen.getByText('reopened')).toBeInTheDocument()
  expect(load).toHaveBeenCalledOnce()
})

it.each(['pointer', 'focus', 'Escape', 'navigation'])(
  'cancels a cold menu open intent on %s before the import can take focus',
  async (dismissal) => {
    const held = Promise.withResolvers<{ default: typeof LoadedBody }>()
    const mounted = vi.fn()
    function LoadedMenu() {
      mounted()
      return <button autoFocus>Copy response</button>
    }
    const Surface = deferred(() => held.promise)
    const onClose = vi.fn()
    const view = render(
      <>
        <button>More actions</button>
        <textarea aria-label="Composer" />
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'More actions' })
    trigger.focus()
    view.rerender(
      <>
        <button>More actions</button>
        <textarea aria-label="Composer" />
        <Surface keepFocus onClose={onClose} />
      </>,
    )
    const composer = screen.getByRole('textbox', { name: 'Composer' })
    if (dismissal === 'navigation') {
      view.rerender(<textarea aria-label="Composer" />)
    } else if (dismissal === 'Escape') {
      fireEvent.keyDown(trigger, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledOnce()
      expect(document.activeElement).toBe(trigger)
    } else {
      if (dismissal === 'pointer') fireEvent.pointerDown(composer)
      act(() => {
        composer.focus()
      })
      expect(onClose).toHaveBeenCalledOnce()
    }
    await act(async () => {
      held.resolve({ default: LoadedMenu })
      await held.promise
    })
    expect(mounted).not.toHaveBeenCalled()
    expect(screen.queryByText('Copy response')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    if (dismissal === 'pointer' || dismissal === 'focus')
      expect(document.activeElement).toBe(composer)
  },
)

it('a failed nonmodal menu accepts Escape from Retry and returns focus to its trigger', async () => {
  const held = Promise.withResolvers<{ default: typeof LoadedBody }>()
  const Surface = deferred(() => held.promise)
  const onClose = vi.fn()
  const errors = vi.spyOn(console, 'error').mockImplementation(vi.fn())
  const view = render(<button>More actions</button>)
  const trigger = screen.getByRole('button', { name: 'More actions' })
  trigger.focus()
  view.rerender(
    <>
      <button>More actions</button>
      <Surface keepFocus onClose={onClose} />
    </>,
  )
  try {
    await act(async () => {
      held.reject(new Error('failed menu chunk'))
      try {
        await held.promise
      } catch {
        // React reports the failed import through the local boundary.
      }
    })
    const retry = screen.getByRole('button', { name: EN.surfaceLoadRetry })
    act(() => {
      retry.focus()
    })
    fireEvent.keyDown(retry, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  } finally {
    errors.mockRestore()
  }
})
