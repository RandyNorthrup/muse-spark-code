// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../../src/shared/l10n/en'
import { setUiText } from '../../../src/shared/l10n/text'
import { PlanPage } from '../../../src/webview/presentation/PlanPage'
import { createPresentationUi } from '../../../src/webview/presentation/presentationUi'
import { DiffPage } from '../../../src/webview/fallbacks/DiffPage'
import type { PlanSummary } from '../../../src/core/plans/planStore'

afterEach(() => {
  setUiText(EN, 'en')
})
const plans: readonly PlanSummary[] = [
  { fileName: 'first.md', title: 'First plan', relativePath: String.raw`.agents\plans\first.md` },
  { fileName: 'next.md', title: 'Next plan', relativePath: '.agents/plans/next.md' },
]

describe('portable saved-plan page', () => {
  it('reads the exact file, focuses its preview, and sends identifiers to real actions', async () => {
    const onRead = vi.fn(() => Promise.resolve('<script>not executed</script>\n# Exact text'))
    const onOpen = vi.fn(() => Promise.resolve())
    const onImplement = vi.fn(() => Promise.resolve())
    render(<PlanPage plans={plans} onRead={onRead} onOpen={onOpen} onImplement={onImplement} />)
    expect(screen.getByText('.agents/plans/first.md')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'First plan' }))
    await waitFor(() => {
      expect(screen.getByLabelText('First plan', { selector: 'pre' })).toHaveFocus()
    })
    expect(document.querySelector('script')).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: EN.planOpen }))
      fireEvent.click(screen.getByRole('button', { name: EN.implementPlan }))
    })
    expect(onImplement).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledExactlyOnceWith('first.md')
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: EN.implementPlan })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: EN.implementPlan }))
    await waitFor(() => {
      expect(onImplement).toHaveBeenCalledExactlyOnceWith('first.md')
    })
  })

  it('keeps the newest selection when an older read finishes later', async () => {
    const old = Promise.withResolvers<string>()
    const onRead = vi.fn((name: string) =>
      name === 'first.md' ? old.promise : Promise.resolve('Latest body'),
    )
    render(<PlanPage plans={plans} onRead={onRead} onOpen={vi.fn()} onImplement={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'First plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next plan' }))
    expect(await screen.findByText('Latest body')).toBeVisible()
    await act(async () => {
      old.resolve('Stale body')
      await old.promise
    })
    expect(screen.queryByText('Stale body')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next plan' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('reports read/action errors and retires removed plans', async () => {
    const onRead = vi.fn(() => Promise.reject<string>(new Error('private path')))
    const onOpen = vi.fn(() => Promise.reject<undefined>(new Error('private path')))
    const props = { plans, onRead, onOpen, onImplement: vi.fn() }
    const result = render(<PlanPage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'First plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.fallbackActionFailed)
    onRead.mockImplementation(() => Promise.resolve('Body'))
    fireEvent.click(screen.getByRole('button', { name: 'First plan' }))
    await screen.findByText('Body')
    fireEvent.click(screen.getByRole('button', { name: EN.planOpen }))
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.fallbackActionFailed)
    result.rerender(<PlanPage {...props} plans={[]} />)
    expect(screen.queryByRole('button', { name: EN.implementPlan })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(EN.plansNone)
    expect(document.body.textContent).not.toContain('private path')
  })

  it('keeps a pending plan read mounted across a state publication', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const reading = Promise.withResolvers<string>()
    const onRead = vi.fn(() => reading.promise)
    const props = {
      plans,
      onRead,
      onOpen: vi.fn(() => Promise.resolve()),
      onImplement: vi.fn(() => Promise.resolve()),
    }
    const ui = createPresentationUi(element, { onReload: vi.fn(), onError: vi.fn() })
    try {
      await act(async () => {
        ui.showPlans(props)
        await Promise.resolve()
      })
      fireEvent.click(await screen.findByRole('button', { name: 'First plan' }))
      expect(onRead).toHaveBeenCalledExactlyOnceWith('first.md')
      // The post-action state publication arrives while the read is pending.
      act(() => {
        ui.showPlans({ ...props })
      })
      await act(async () => {
        reading.resolve('Exact saved text')
        await reading.promise
      })
      expect(await screen.findByText('Exact saved text')).toBeVisible()
      expect(screen.getByRole('button', { name: EN.planOpen })).toBeEnabled()
      expect(screen.getByRole('button', { name: EN.implementPlan })).toBeEnabled()
    } finally {
      act(() => {
        ui.dispose()
      })
      element.remove()
    }
  })

  it('loads the real lazy view through the carrier factory and disposes it', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const ui = createPresentationUi(element, { onReload: vi.fn(), onError: vi.fn() })
    await act(async () => {
      ui.showPlans({ plans: [], onRead: vi.fn(), onOpen: vi.fn(), onImplement: vi.fn() })
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { name: EN.plansTitle })).toBeVisible()
    act(() => {
      ui.dispose()
    })
    expect(element).toBeEmptyDOMElement()
    expect(() => {
      ui.showPlans({ plans: [], onRead: vi.fn(), onOpen: vi.fn(), onImplement: vi.fn() })
    }).toThrow('MHP_PRESENTATION_DISPOSED')
    element.remove()
  })

  it('shows a localized render failure and forwards only a fixed code to the owner', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      /* Expected React render error is asserted through the fixed-code owner callback. */
    })
    const element = document.createElement('div')
    document.body.append(element)
    const onError = vi.fn()
    const onReload = vi.fn()
    const ui = createPresentationUi(element, { onError, onReload })
    try {
      act(() => {
        ui.showRoles({
          rolesTitle: 'Roles',
          trafficTitle: 'Traffic',
          roles: [],
          traffic: [
            {
              id: 'invalid',
              sourceId: 'a',
              targetId: 'b',
              at: NaN,
              summary: 'private message',
            },
          ],
          onOpenRole: vi.fn(),
        })
      })
      expect(await screen.findByRole('alert')).toHaveTextContent(EN.crashDetail)
      expect(onError).toHaveBeenCalledExactlyOnceWith('MHP_PRESENTATION_RENDER_FAILED')
      expect(element.textContent).not.toContain('Invalid time value')
      fireEvent.click(screen.getByRole('button', { name: EN.crashReload }))
      expect(onReload).toHaveBeenCalledOnce()
      act(() => {
        ui.showManager({ kind: 'rules', entries: [], actions: [] })
      })
      await waitFor(() => {
        expect(onError).toHaveBeenCalledTimes(2)
      })
      expect(screen.getByRole('alert')).toHaveTextContent(EN.crashDetail)
      expect(element.textContent).not.toContain('MHP_MANAGER_TITLE_REQUIRED')
    } finally {
      act(() => {
        ui.dispose()
      })
      element.remove()
      consoleError.mockRestore()
    }
  })
})

describe('portable diff decisions', () => {
  const hunk = {
    id: 'hunk',
    uri: 'file:///workspace/source.ts',
    expectedVersion: 1,
    range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
    before: 'old',
    after: 'new',
  }
  it('sends one exact decision, blocks repeated dispatch and focuses the result', async () => {
    const held = Promise.withResolvers<undefined>()
    const onDecide = vi.fn(() => held.promise)
    render(<DiffPage title="Review" hunks={[hunk]} onDecide={onDecide} />)
    const accept = screen.getByRole('button', { name: EN.reviewAccept })
    act(() => {
      fireEvent.click(accept)
      fireEvent.click(accept)
    })
    expect(onDecide).toHaveBeenCalledExactlyOnceWith('hunk', 'accept')
    await act(async () => {
      held.resolve(undefined)
      await held.promise
    })
    expect(screen.getByRole('status')).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(EN.reviewAccepted)
    expect(screen.queryByRole('button', { name: EN.reviewAccept })).toBeNull()
  })

  it('retains an accepted decision across a same-version state publication', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const onDecide = vi.fn(() => Promise.resolve(undefined))
    const props = { title: 'Review', hunks: [hunk], onDecide }
    const ui = createPresentationUi(element, { onReload: vi.fn(), onError: vi.fn() })
    try {
      await act(async () => {
        ui.showDiff(props)
        await Promise.resolve()
      })
      fireEvent.click(await screen.findByRole('button', { name: EN.reviewAccept }))
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent(EN.reviewAccepted)
      })
      // The post-decision state publication retains the decided hunk.
      act(() => {
        ui.showDiff({ ...props, hunks: [{ ...hunk }] })
      })
      expect(screen.getByRole('status')).toHaveTextContent(EN.reviewAccepted)
      expect(screen.queryByRole('button', { name: EN.reviewAccept })).toBeNull()
    } finally {
      act(() => {
        ui.dispose()
      })
      element.remove()
    }
  })

  it('permits retry on failure and resets decisions on a new document version', async () => {
    const onDecide = vi.fn(() => Promise.reject<undefined>(new Error('private error')))
    const result = render(<DiffPage title="Review" hunks={[hunk]} onDecide={onDecide} />)
    fireEvent.click(screen.getByRole('button', { name: EN.reject }))
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.fallbackActionFailed)
    onDecide.mockImplementation(() => Promise.resolve(undefined))
    fireEvent.click(screen.getByRole('button', { name: EN.reject }))
    await screen.findByRole('status')
    result.rerender(
      <DiffPage title="Review" hunks={[{ ...hunk, expectedVersion: 2 }]} onDecide={onDecide} />,
    )
    expect(screen.getByRole('button', { name: EN.reviewAccept })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
