// The Models & Agents panel's reducer (M95, PLAN.md D74): navigation,
// the wizard and import overlays, and deep links come from the section
// registry; the host-owned slices arrive whole and replace what is shown.
// The webview never edits host state itself — it renders and asks.

import type { ModelsPanelSection, ModelsPanelState } from '../../shared/modelsPanel'
import { MODEL_SECTIONS } from './sections'

export interface PanelHighlight {
  readonly section: ModelsPanelSection
  readonly itemId: string | undefined
}

export interface PanelUiState {
  readonly section: ModelsPanelSection
  readonly wizardOpen: boolean
  /** The host has sent a wizard draft since the wizard opened. */
  readonly wizardHasDraft: boolean
  readonly importOpen: boolean
  readonly highlighted: PanelHighlight | undefined
}

export type PanelUiAction =
  | { readonly type: 'navigate'; readonly section: ModelsPanelSection }
  | { readonly type: 'open-wizard' }
  | { readonly type: 'close-wizard' }
  | { readonly type: 'toggle-import' }
  | { readonly type: 'host-state'; readonly state: ModelsPanelState }
  | {
      readonly type: 'host-navigate'
      readonly section: ModelsPanelSection
      readonly itemId: string | undefined
    }

export const INITIAL_PANEL_UI: PanelUiState = {
  section: 'providers',
  wizardOpen: false,
  wizardHasDraft: false,
  importOpen: false,
  highlighted: undefined,
}

function reduceNavigation(state: PanelUiState, action: PanelUiAction): PanelUiState {
  switch (action.type) {
    case 'navigate': {
      return { ...state, section: action.section, highlighted: undefined }
    }
    case 'host-navigate': {
      return {
        ...state,
        section: action.section,
        highlighted: { section: action.section, itemId: action.itemId },
      }
    }
    default: {
      return state
    }
  }
}

/**
 * One action through the panel. Navigation and the highlight are the
 * panel's; every section folds its own overlay actions (the registry's
 * `reduceSection`, so M96's sections bring their own). A host state that
 * cleared the wizard draft or the import preview closes that overlay:
 * the host owns the draft, so a gone draft cannot stay open.
 */
export function panelUiReducer(state: PanelUiState, action: PanelUiAction): PanelUiState {
  // A deep link names a registered section: the host's schema rejects any
  // other before this reducer ever sees it.
  let current = reduceNavigation(state, action)
  for (const section of MODEL_SECTIONS) {
    current = section.reduceSection(current, action)
  }
  return current
}
