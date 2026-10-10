// @vitest-environment jsdom
// The Models panel's deferred sections paint no placeholder the section
// later replaces: while a section chunk loads, the content slot holds only
// a visually hidden loading status (no in-flow box), and the loaded section
// then commits once, without an intermediate overlay (RVMODELSPLIT P2).
import { act, cleanup, render, screen } from '@testing-library/react'
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
  function Panel() {
    const [ui, dispatch] = useReducer(panelUiReducer, INITIAL_PANEL_UI)
    useEffect(() => {
      dispatch({ type: 'host-state', state })
    }, [])
    return <ModelsPanel panelState={state} ui={ui} post={post} dispatch={dispatch} />
  }
  const view = render(<Panel />)
  return { view, UI_TEXT }
}

async function releaseChunk(): Promise<void> {
  await act(async () => {
    chunk.gate.resolve(undefined)
    // Let the held section import settle before act closes.
    await chunk.gate.promise
  })
}

describe('deferred Models sections reserve no visible box', () => {
  it('announces loading without an overlay while the chunk loads, then commits the section once', async () => {
    const { view, UI_TEXT } = await mountProviders()
    // Loading is still announced for assistive tech …
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(UI_TEXT.loadingOutput)
    const marker = view.container.querySelector('[data-deferred-loading]')
    expect(marker).not.toBeNull()
    expect(marker).toBe(status)
    // … but it occupies no in-flow box: the clipped announcement
    // (models.css: absolute, 1 px, clipped) is the slot's only child
    // besides the nav, and the shared overlay placeholder never appears.
    expect(marker?.classList.contains('models-visually-hidden')).toBe(true)
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
    expect(view.container.querySelector(':scope .models-panel > section')).toBeNull()
    const visibleSiblings = [...view.container.querySelectorAll(':scope .models-panel > *')].filter(
      (element) =>
        element.tagName !== 'NAV' && !element.classList.contains('models-visually-hidden'),
    )
    expect(visibleSiblings).toEqual([])
    await releaseChunk()
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
    expect(view.container.querySelector('[data-deferred-loading]')).toBeNull()
    expect(
      view.container.querySelector(':scope .models-panel > section')?.getAttribute('aria-label'),
    ).toBe(UI_TEXT.providersSectionTitle)
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
  })
})
