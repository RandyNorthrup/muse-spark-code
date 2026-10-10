// @vitest-environment jsdom
// The Models panel's deferred sections keep their own box across chunk
// load: while a section chunk loads, the content slot already holds the
// `<section>` with its final accessible name (marked busy, announcement
// visually hidden, no overlay), and after load it holds the same section
// (RVMODELSPLIT P2).
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

describe('deferred Models sections keep their own box across chunk load', () => {
  it('reserves the section element before load and commits the same section after', async () => {
    const { view, UI_TEXT } = await mountProviders()
    // Before load the slot already holds the section with its final
    // accessible name, marked busy — never the shared overlay placeholder.
    const reserve = view.container.querySelector(':scope .models-panel > section')
    expect(reserve?.getAttribute('aria-label')).toBe(UI_TEXT.providersSectionTitle)
    expect(reserve?.getAttribute('aria-busy')).toBe('true')
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
    // Loading is still announced for assistive tech …
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(UI_TEXT.loadingOutput)
    const marker = view.container.querySelector('[data-deferred-loading]')
    expect(marker).not.toBeNull()
    expect(marker).toBe(status)
    // … but the reserve occupies no visible box: its only in-flow child is
    // the clipped announcement (models.css: absolute, 1 px, clipped).
    expect(marker?.classList.contains('models-visually-hidden')).toBe(true)
    expect(reserve?.querySelector(':scope div.palette')).toBeNull()
    expect(
      [...(reserve?.querySelectorAll(':scope > *') ?? [])].filter(
        (element) => !element.classList.contains('models-visually-hidden'),
      ),
    ).toEqual([])
    await releaseChunk()
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
    // After load the slot holds the same section — same tag, same slot,
    // same accessible name — with the reserve's marker gone and no overlay.
    // (jsdom has no layout engine, so pixel equality of the box is measured
    // in a real browser; see the lead-run procedure in
    // docs/certification/models-split.md.)
    const section = view.container.querySelector(':scope .models-panel > section')
    expect(section?.tagName).toBe(reserve?.tagName)
    expect(section?.getAttribute('aria-label')).toBe(reserve?.getAttribute('aria-label'))
    expect(section?.getAttribute('aria-busy')).toBeNull()
    expect(view.container.querySelector('[data-deferred-loading]')).toBeNull()
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
  })
})
