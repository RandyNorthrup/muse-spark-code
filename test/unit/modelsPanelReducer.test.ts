// The panel's reducer: navigation, the wizard and import overlays, deep
// links, and the host clearing a draft or preview underneath an open one.

import { describe, expect, it } from 'vitest'
import { INITIAL_PANEL_UI, panelUiReducer } from '../../src/webview/models/reducer'
import { makeDraft, makeState } from './modelsPanelFixtures'

describe('panelUiReducer', () => {
  it('navigates between sections and clears the highlight', () => {
    const moved = panelUiReducer(INITIAL_PANEL_UI, { type: 'navigate', section: 'models' })
    expect(moved.section).toBe('models')
    expect(moved.highlighted).toBe(undefined)
    const back = panelUiReducer(
      { ...moved, highlighted: { section: 'models', itemId: 'ollama/qwen3:8b' } },
      { type: 'navigate', section: 'providers' },
    )
    expect(back.highlighted).toBe(undefined)
  })

  it('opens and closes the wizard', () => {
    const open = panelUiReducer(INITIAL_PANEL_UI, { type: 'open-wizard' })
    expect(open.wizardOpen).toBe(true)
    expect(panelUiReducer(open, { type: 'close-wizard' }).wizardOpen).toBe(false)
  })

  it('toggles the import pane', () => {
    expect(panelUiReducer(INITIAL_PANEL_UI, { type: 'toggle-import' }).importOpen).toBe(true)
    const open = { ...INITIAL_PANEL_UI, importOpen: true }
    expect(panelUiReducer(open, { type: 'toggle-import' }).importOpen).toBe(false)
  })

  it('closes the wizard when the host clears the draft, and keeps it otherwise', () => {
    const open = { ...INITIAL_PANEL_UI, wizardOpen: true }
    const closed = panelUiReducer(open, { type: 'host-state', state: makeState() })
    expect(closed.wizardOpen).toBe(false)
    const kept = panelUiReducer(
      { ...INITIAL_PANEL_UI, wizardOpen: true },
      {
        type: 'host-state',
        state: makeState({
          drafts: {
            edits: {},
            wizard: makeDraft({ step: 'configure', auth: 'none', blockers: [] }),
          },
        }),
      },
    )
    expect(kept.wizardOpen).toBe(true)
  })

  it('closes the import pane when the host clears the preview', () => {
    const open = { ...INITIAL_PANEL_UI, importOpen: true }
    expect(panelUiReducer(open, { type: 'host-state', state: makeState() }).importOpen).toBe(false)
  })

  it('follows a deep link and highlights its item', () => {
    const linked = panelUiReducer(INITIAL_PANEL_UI, {
      type: 'host-navigate',
      section: 'models',
      itemId: 'ollama/qwen3:8b',
    })
    expect(linked.section).toBe('models')
    expect(linked.highlighted).toEqual({ section: 'models', itemId: 'ollama/qwen3:8b' })
  })

  it('leaves unrelated state alone', () => {
    const open = { ...INITIAL_PANEL_UI, wizardOpen: true, section: 'models' as const }
    const same = panelUiReducer(open, { type: 'toggle-import' })
    expect(same.wizardOpen).toBe(true)
    expect(same.section).toBe('models')
  })
})
