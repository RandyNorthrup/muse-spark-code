// @vitest-environment jsdom
// The Models panel's deferred sections paint no stand-in: while a section
// chunk loads, the content slot holds no `<section>` and no overlay, only
// the visually hidden loading announcement — and after load it holds the
// real section, which later host states never replace (RVMODELSPLIT2 P2:
// the old fallback painted an empty `<section>` whose 0 px box jumped to
// the content box on commit, and the harness `.models-panel section`
// waiter fired on that empty reserve before "Pick a provider" existed).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useReducer } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelsPanelState, PanelToHostMessage } from '../../src/shared/modelsPanel'

const chunk = { gate: Promise.withResolvers<undefined>() }

afterEach(cleanup)

beforeEach(() => {
  chunk.gate = Promise.withResolvers<undefined>()
  vi.resetModules()
  // Hold the providers chunk until the test releases it; everything else
  // loads for real.
  vi.doMock('../../src/webview/models/ProvidersSection', async (importOriginal) => {
    await chunk.gate.promise
    return await importOriginal()
  })
})

async function mountProviders() {
  const [{ ModelsPanel }, { INITIAL_PANEL_UI, panelUiReducer }, { UI_TEXT }, fixtures] =
    await Promise.all([
      import('../../src/webview/models/panel'),
      import('../../src/webview/models/reducer'),
      import('../../src/shared/constants'),
      import('./modelsPanelFixtures'),
    ])
  const state: ModelsPanelState = fixtures.makeState({
    providers: [fixtures.makeProvider()],
    models: [fixtures.makeRow()],
    totalModels: 1,
  })
  const post = vi.fn<(message: PanelToHostMessage) => void>()
  let refresh!: (next: ModelsPanelState) => void
  function Panel() {
    const [ui, dispatch] = useReducer(panelUiReducer, INITIAL_PANEL_UI)
    refresh = (next) => {
      dispatch({ type: 'host-state', state: next })
    }
    useEffect(() => {
      dispatch({ type: 'host-state', state })
    }, [])
    return <ModelsPanel panelState={state} ui={ui} post={post} dispatch={dispatch} />
  }
  const view = render(<Panel />)
  return {
    view,
    UI_TEXT,
    refresh: (next: ModelsPanelState) => {
      act(() => {
        refresh(next)
      })
    },
    state,
  }
}

async function releaseChunk(): Promise<void> {
  await act(async () => {
    chunk.gate.resolve(undefined)
    // Let the held section import settle before act closes.
    await chunk.gate.promise
  })
}

describe('deferred Models sections paint no stand-in before the chunk commits', () => {
  it('holds no section and no overlay while loading, then commits the real section', async () => {
    const { view, UI_TEXT } = await mountProviders()
    // While the chunk is in flight the slot holds no section — the harness
    // `.models-panel section` waiter cannot fire early — and no overlay.
    expect(view.container.querySelector(':scope .models-panel > section')).toBeNull()
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
    expect(view.container.querySelector(':scope .models-panel > section[aria-busy]')).toBeNull()
    // Loading is still announced for assistive tech and for the visual
    // capture's `[data-deferred-loading]` wait …
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(UI_TEXT.loadingOutput)
    const marker = view.container.querySelector('[data-deferred-loading]')
    expect(marker).not.toBeNull()
    expect(marker).toBe(status)
    // … but the marker claims no visible box: it is clipped absolute, and
    // nothing else in-flow stands in for the section (no placeholder box
    // beside the always-present navigation).
    expect(marker?.classList.contains('models-visually-hidden')).toBe(true)
    const inFlowStandIns = [...(marker?.parentElement?.children ?? [])].filter(
      (element) =>
        !element.classList.contains('models-nav') &&
        !element.classList.contains('models-visually-hidden'),
    )
    expect(inFlowStandIns).toEqual([])
    await releaseChunk()
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
    // After load the slot holds the real section with its final name, the
    // marker is gone, and there is still no overlay.
    const section = view.container.querySelector(':scope .models-panel > section')
    expect(section?.getAttribute('aria-label')).toBe(UI_TEXT.providersSectionTitle)
    expect(section?.getAttribute('aria-busy')).toBeNull()
    expect(view.container.querySelector('[data-deferred-loading]')).toBeNull()
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
    // The wizard opener the harness scenarios click is really there: the
    // scenario step that threw on the empty reserve now finds its button.
    const pick = screen.getByRole('button', { name: UI_TEXT.wizardPickProvider })
    act(() => {
      fireEvent.click(pick)
    })
    expect(view.container.querySelector(':scope .models-select input')).not.toBeNull()
  })

  it('keeps the committed section element across later host states', async () => {
    const { view, refresh, state } = await mountProviders()
    await releaseChunk()
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
    const section = view.container.querySelector(':scope .models-panel > section')
    expect(section).not.toBeNull()
    // A later host state (scan progress, usage refresh) must not unmount
    // and replace the section: the committed box is never swapped out.
    refresh({ ...state })
    expect(view.container.querySelector(':scope .models-panel > section')).toBe(section)
    expect(section?.isConnected).toBe(true)
    expect(view.container.querySelectorAll(':scope .models-panel > section')).toHaveLength(1)
  })
})
