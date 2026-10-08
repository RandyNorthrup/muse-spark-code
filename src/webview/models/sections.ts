// The Models & Agents panel's section registry (M95, PLAN.md D74):
// each section registers `{id, title, icon, Component, reducer}`, and the
// panel's navigation, deep links and narrow layout come from it. M95
// registers `providers` and `models`; M96 adds `roles` and `agents`
// beside them, each with its own Component and `reduceSection`.

import type { ComponentType } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type {
  ModelsPanelSection,
  ModelsPanelState,
  PanelToHostMessage,
} from '../../shared/modelsPanel'
import { CodeIcon, PlusIcon } from '../components/icons'
import { ModelsSection } from './ModelsSection'
import { ProvidersSection } from './ProvidersSection'
import type { PanelUiAction, PanelUiState, WizardLife } from './reducer'

export interface SectionProps {
  readonly panelState: ModelsPanelState
  readonly post: (message: PanelToHostMessage) => void
  /** Local navigation (a suggestion's Change walks to the Models table). */
  readonly navigate: (section: ModelsPanelSection) => void
  readonly dispatch: (action: PanelUiAction) => void
  readonly wizardOpen: boolean
  /** The open wizard's draft generation (pending work checks it before posting). */
  readonly wizardLife: WizardLife
  readonly importOpen: boolean
  readonly highlightedItem: string | undefined
}

export interface PanelSectionDef {
  readonly id: ModelsPanelSection
  /** Read at render, never at module load, so the installed table shows. */
  readonly getTitle: () => string
  readonly icon: ComponentType<object>
  readonly Component: ComponentType<SectionProps>
  /**
   * The section's own fold of a panel action. Every section sees every
   * action and handles only its own overlay kinds; the host-owned slices
   * close an overlay the host cleared (a gone wizard draft cannot stay
   * open, since the host owns the draft).
   */
  readonly reduceSection: (state: PanelUiState, action: PanelUiAction) => PanelUiState
}

function reduceProviders(state: PanelUiState, action: PanelUiAction): PanelUiState {
  switch (action.type) {
    case 'open-wizard': {
      // The pick step is local (no draft yet): it survives host states
      // until the host's draft arrives, and closes when that draft goes
      // (saved or cancelled) after it was seen.
      return { ...state, wizardOpen: true, wizardGeneration: state.wizardGeneration + 1 }
    }
    case 'close-wizard': {
      return { ...state, wizardOpen: false, wizardHasDraft: false }
    }
    case 'replace-wizard-draft': {
      return { ...state, wizardGeneration: state.wizardGeneration + 1 }
    }
    case 'toggle-import': {
      return { ...state, importOpen: !state.importOpen }
    }
    case 'host-state': {
      const hasDraft = action.state.drafts.wizard !== undefined
      return {
        ...state,
        wizardHasDraft: state.wizardHasDraft || hasDraft,
        wizardOpen: state.wizardOpen && (hasDraft || !state.wizardHasDraft),
        importOpen: state.importOpen && action.state.importPreview !== undefined,
      }
    }
    default: {
      return state
    }
  }
}

function reduceModels(state: PanelUiState, _action: PanelUiAction): PanelUiState {
  return state
}

export const MODEL_SECTIONS: readonly PanelSectionDef[] = [
  {
    id: 'providers',
    getTitle: () => UI_TEXT.providersSectionTitle,
    icon: PlusIcon,
    Component: ProvidersSection,
    reduceSection: reduceProviders,
  },
  {
    id: 'models',
    getTitle: () => UI_TEXT.modelsSectionTitle,
    icon: CodeIcon,
    Component: ModelsSection,
    reduceSection: reduceModels,
  },
]

/** The registered section, or undefined for a section this build has none of. */
export function sectionById(id: ModelsPanelSection): PanelSectionDef | undefined {
  return MODEL_SECTIONS.find((section) => section.id === id)
}
