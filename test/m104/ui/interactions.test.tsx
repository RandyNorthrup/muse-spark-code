// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../../src/shared/l10n/en'
import { setUiText } from '../../../src/shared/l10n/text'
import { selectedTranscriptQuote } from '../../../src/webview/selectionQuote'
import { RoleTrafficPage } from '../../../src/webview/presentation/RoleTrafficPage'
import { ManagerPage, type ManagerKind } from '../../../src/webview/fallbacks/ManagerPage'
import { Walkthrough } from '../../../src/webview/fallbacks/Walkthrough'
import { createFallbackUi } from '../../../src/webview/fallbacks/services'

afterEach(() => {
  setUiText(EN, 'en')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function rows() {
  const first = document.createElement('p')
  const last = document.createElement('p')
  first.dataset['entryId'] = 'first'
  first.dataset['role'] = 'tool'
  last.dataset['entryId'] = 'last'
  first.textContent = 'First passage'
  last.textContent = 'Other passage'
  document.body.append(first, last)
  const selection = window.getSelection()!
  const range = document.createRange()
  range.setStart(first.firstChild!, 0)
  range.setEnd(first.firstChild!, 5)
  selection.removeAllRanges()
  selection.addRange(range)
  return { first, last, selection, range }
}

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const ui = createFallbackUi(root, vi.fn())
  return ui
}

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    return await work
  } catch (error: unknown) {
    return error
  }
}

describe('quotes retain the selected row identity', () => {
  it('keeps text/role/id and gives keyboard context menus a row anchor', () => {
    const f = rows()
    vi.spyOn(f.first, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 100, 50))
    expect(selectedTranscriptQuote(f.selection, f.first, { x: 0, y: 0 })).toEqual({
      entryId: 'first',
      role: 'tool',
      text: 'First',
      origin: { x: 70, y: 55 },
    })
    expect(selectedTranscriptQuote(f.selection, document.body, { x: 3, y: 4 })?.origin).toEqual({
      x: 3,
      y: 4,
    })
  })
  // The join of M104's row checks with 0.17.1's menu fan (docs/certification/m104-join.md).
  it("fans from the row's own actions button when it has one, pointer or keyboard", () => {
    const f = rows()
    const button = document.createElement('button')
    button.className = 'row-actions-button'
    f.first.append(button)
    const other = document.createElement('button')
    other.className = 'row-actions-button'
    f.last.append(other)
    expect(selectedTranscriptQuote(f.selection, f.first, { x: 3, y: 4 })?.origin).toBe(button)
    expect(selectedTranscriptQuote(f.selection, f.first, { x: 0, y: 0 })?.origin).toBe(button)
    // The row checks still decide first: another row's click is no quote of this text.
    expect(selectedTranscriptQuote(f.selection, f.last, { x: 3, y: 4 })).toBeUndefined()
  })
  it('refuses cross-row selections, another row, detached rows and an empty selection', () => {
    const f = rows()
    expect(selectedTranscriptQuote(f.selection, f.last, { x: 1, y: 1 })).toBeUndefined()
    f.range.setEnd(f.last.firstChild!, 5)
    f.selection.removeAllRanges()
    f.selection.addRange(f.range)
    expect(selectedTranscriptQuote(f.selection, f.first, { x: 1, y: 1 })).toBeUndefined()
    f.range.setEnd(f.first.firstChild!, 5)
    f.selection.removeAllRanges()
    f.selection.addRange(f.range)
    f.first.remove()
    expect(selectedTranscriptQuote(f.selection, document.body, { x: 1, y: 1 })).toBeUndefined()
    expect(selectedTranscriptQuote(null, null, { x: 1, y: 1 })).toBeUndefined()
  })
})

describe('manager, walkthrough and role/traffic actions', () => {
  const extraManagers: readonly { kind: ManagerKind; title: string }[] = [
    { kind: 'rules', title: 'Rules' },
    { kind: 'agents', title: 'Custom agents' },
  ]
  it.each(extraManagers)(
    'shows current $kind records with the supplied title and actual action',
    async ({ kind, title }) => {
      const run = vi.fn(() => Promise.resolve())
      render(
        <ManagerPage
          kind={kind}
          title={title}
          actions={[]}
          entries={[
            {
              id: 'actual',
              title: 'Record',
              detail: '.agents/context.json',
              actions: [{ id: 'open', title: EN.planOpen, run }],
            },
          ]}
        />,
      )
      expect(screen.getByRole('heading', { name: title })).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: EN.planOpen }))
      await waitFor(() => {
        expect(run).toHaveBeenCalledOnce()
      })
    },
  )
  it('serializes actions across the whole manager and reports errors without raw text', async () => {
    const held = Promise.withResolvers<undefined>()
    const top = { id: 'top', title: 'Refresh', run: vi.fn(() => held.promise) }
    const row = {
      id: 'row',
      title: 'Inspect',
      run: vi.fn(() => Promise.reject(new Error('private path'))),
    }
    render(
      <ManagerPage
        kind="mcp"
        title={EN.mcpTitleModelApi}
        actions={[top]}
        entries={[{ id: 'server', title: 'Server', detail: 'Actual record', actions: [row] }]}
      />,
    )
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    })
    expect(row.run).not.toHaveBeenCalled()
    await act(async () => {
      held.resolve(undefined)
      await held.promise
    })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.fallbackActionFailed)
    expect(document.body.textContent).not.toContain('private path')
  })
  it('routes the actual walkthrough action through the shared payload vocabulary', () => {
    const post = vi.fn()
    render(
      <Walkthrough
        steps={[
          {
            id: 'settings',
            title: EN.openSettings,
            description: EN.paletteTips.settings,
            actionTitle: EN.fallbackContinue,
            action: { type: 'hostAction', action: 'openSettings' },
          },
        ]}
        post={post}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: EN.fallbackContinue }))
    expect(post).toHaveBeenCalledExactlyOnceWith({ type: 'hostAction', action: 'openSettings' })
  })
  it('renders provider capabilities and unknown traffic/status identifiers without a model call', async () => {
    const onOpenRole = vi.fn(() => Promise.reject(new Error('private role path')))
    render(
      <RoleTrafficPage
        rolesTitle="Roles"
        trafficTitle="Traffic"
        onOpenRole={onOpenRole}
        roles={[
          {
            id: 'planner',
            name: 'Planner',
            providerId: 'non-meta-provider',
            modelId: 'local-model',
            status: 'future-status',
            capabilities: ['vision'],
          },
        ]}
        traffic={[
          {
            id: 'message',
            sourceId: 'planner',
            targetId: 'future-role',
            at: 1_769_000_000_000,
            summary: '<script>Text only</script>',
          },
        ]}
      />,
    )
    expect(screen.getByText('non-meta-provider / local-model')).toBeVisible()
    expect(screen.getByText('future-status')).toBeVisible()
    expect(screen.getByText('Planner / future-role')).toBeVisible()
    expect(document.querySelector('script')).toBeNull()
    act(() => {
      const planner = screen.getByRole('button', { name: 'Planner' })
      fireEvent.click(planner)
      fireEvent.click(planner)
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.fallbackActionFailed)
    expect(onOpenRole).toHaveBeenCalledExactlyOnceWith('planner')
  })
})

describe('browser copy and external-open service fallbacks', () => {
  it('refuses an unavailable clipboard and propagates a denied write', async () => {
    const ui = mount()
    vi.stubGlobal('navigator', {})
    await expect(ui.request('ui/clipboard', { text: 'Exact preview' })).rejects.toThrow(
      'MHP_UNSUPPORTED_CAPABILITY',
    )
    const writeText = vi.fn(() => Promise.reject(new Error('clipboard denied')))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(ui.request('ui/clipboard', { text: 'Exact preview' })).rejects.toThrow(
      'clipboard denied',
    )
    const nonError = Promise.withResolvers<never>()
    writeText.mockImplementation(() => nonError.promise)
    // A browser boundary may reject with an untyped value.
    Reflect.apply(nonError.reject, undefined, ['NON_ERROR_CLIPBOARD_FAILURE'])
    await expect(ui.request('ui/clipboard', { text: 'Exact preview' })).rejects.toThrow(
      'MHP_CLIPBOARD_FAILED',
    )
    act(() => {
      ui.dispose()
    })
  })

  it.each([
    { ending: 'abort', completion: 'resolve' },
    { ending: 'abort', completion: 'reject' },
    { ending: 'dispose', completion: 'resolve' },
    { ending: 'dispose', completion: 'reject' },
  ])(
    'settles a pending clipboard on $ending and drops late $completion',
    async ({ ending, completion }) => {
      const write = Promise.withResolvers<undefined>()
      const writeText = vi.fn(() => write.promise)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      const ui = mount()
      const signal = new AbortController()
      const result = failureOf(ui.request('ui/clipboard', { text: 'Exact preview' }, signal.signal))
      const outcomes: unknown[] = []
      void (async () => {
        outcomes.push(await result)
      })()
      if (ending === 'abort') signal.abort()
      else
        act(() => {
          ui.dispose()
        })
      await waitFor(() => {
        expect(outcomes[0]).toBeInstanceOf(Error)
      })
      expect(await result).toMatchObject({
        message: ending === 'abort' ? 'MHP_CANCELLED' : 'MHP_UI_DISPOSED',
      })
      await act(async () => {
        if (completion === 'resolve') write.resolve(undefined)
        else write.reject(new Error('LATE_CLIPBOARD_FAILURE'))
        await Promise.resolve()
      })
      expect(outcomes).toHaveLength(1)
      expect(writeText).toHaveBeenCalledExactlyOnceWith('Exact preview')
      if (ending === 'abort')
        act(() => {
          ui.dispose()
        })
      await expect(ui.request('ui/clipboard', { text: 'After disposal' })).rejects.toThrow(
        'MHP_UI_DISPOSED',
      )
      expect(writeText).toHaveBeenCalledOnce()
    },
  )

  it('cancels one pending clipboard request without cancelling another', async () => {
    const first = Promise.withResolvers<undefined>()
    const second = Promise.withResolvers<undefined>()
    const writeText = vi.fn((text: string) => (text === 'First' ? first.promise : second.promise))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const ui = mount()
    const signal = new AbortController()
    const cancelled = failureOf(ui.request('ui/clipboard', { text: 'First' }, signal.signal))
    const successful = ui.request('ui/clipboard', { text: 'Second' })
    signal.abort()
    second.resolve(undefined)
    await expect(successful).resolves.toBeNull()
    first.resolve(undefined)
    expect(await cancelled).toMatchObject({ message: 'MHP_CANCELLED' })
    act(() => {
      ui.dispose()
    })
  })

  it('copies exact text, and refuses malformed navigation before opening a prompt', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const ui = mount()
    await ui.request('ui/clipboard', { text: 'Exact preview' })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Exact preview')
    await expect(ui.request('ui/openExternal', { uri: 'javascript:alert(1)' })).rejects.toThrow()
    act(() => {
      ui.dispose()
    })
  })
  it('reports a blocked window and cancellation instead of successful navigation', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const ui = mount()
    const opening = ui.request('ui/openExternal', { uri: 'https://example.com/notes' })
    const result = failureOf(opening)
    fireEvent.click(await screen.findByRole('button', { name: EN.planOpen }))
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.fallbackActionFailed)
    fireEvent.click(screen.getByRole('button', { name: EN.usageClose }))
    expect(await result).toBeInstanceOf(Error)
    act(() => {
      ui.dispose()
    })
  })
  it('detaches the opened window before navigation and acknowledges only that action', async () => {
    // A real DOM Window with same-document navigation avoids network and popup emulation casts.
    const previousUri = window.location.href
    const previousOpener: unknown = Reflect.get(window, 'opener')
    Reflect.set(window, 'opener', { fixture: 'foreign opener' })
    const uri = new URL('#m104-external-open', previousUri).href
    const opened = vi.spyOn(window, 'open').mockReturnValue(window)
    const ui = mount()
    try {
      const opening = ui.request('ui/openExternal', { uri })
      fireEvent.click(await screen.findByRole('button', { name: EN.planOpen }))
      await expect(opening).resolves.toBeNull()
      expect(opened).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank')
      expect(window.opener).toBeNull()
      expect(window.location.href).toBe(uri)
    } finally {
      window.location.assign(previousUri)
      Reflect.set(window, 'opener', previousOpener)
      act(() => {
        ui.dispose()
      })
    }
  })
  it('waits for the user gesture and aborts queued requests', async () => {
    const popup = window
    const open = vi.spyOn(window, 'open').mockReturnValue(popup)
    const ui = mount()
    const opening = ui.request('ui/openExternal', { uri: 'https://example.com/notes' })
    const done = failureOf(opening)
    await screen.findByRole('button', { name: EN.planOpen })
    expect(open).not.toHaveBeenCalled()
    const signal = new AbortController()
    const cancelled = failureOf(
      ui.request('ui/openExternal', { uri: 'https://example.com/other' }, signal.signal),
    )
    signal.abort()
    expect(await cancelled).toBeInstanceOf(Error)
    act(() => {
      ui.dispose()
    })
    await done
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
