// The Models & Agents panel's section registry (M95, PLAN.md D74):
// each section registers `{id, title, icon, Component, reducer}`, and the
// panel's navigation, deep links and narrow layout come from it. M95
// registers `providers` and `models`; M96 adds `roles` and `agents`
// beside them, each with its own Component and `reduceSection`.

import type { ComponentType } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type { VaultClientMessage } from '../../shared/hostApi/vaultMessages'
import type {
  ModelsPanelSection,
  ModelsPanelState,
  PanelToHostMessage,
} from '../../shared/modelsPanel'
import { BoltIcon, CodeIcon, LockIcon, PlusIcon } from '../components/icons'

export async function loadTeamEnglish(): Promise<void> {
  // The hidden team English travels with its readers, never with the
  // panel's first paint. A dynamic import keeps this loader out of the
  // panel body; in source and tests the module installs nothing.
  const deferred = await import('../../shared/l10n/deferredEnglish')
  await deferred.loadDeferredEnglish()
}
import { deferred } from '../components/DeferredSurface'
import {
  DeferredJudgeSection,
  DeferredModelsSection,
  DeferredProvidersSection,
} from './DeferredSections'
import { VaultSectionMount } from './sections/vault/VaultSectionMount'
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
  /**
  The vault section's own channel (C-M109-1 P1): the host's latest vault
  envelope and the vault post port. The envelope stays undefined until
  the host's first answer (bound state or unbound reason); other sections
  never read them. The mount validates the envelope before use, inside
  the lazy surface.
  */
  readonly vaultRaw?: unknown
  readonly vaultPost?: ((message: VaultClientMessage) => void) | undefined
}

export interface PanelSectionDef {
  readonly id: ModelsPanelSection
  /** Read at render, never at module load, so the installed table shows. */
  readonly getTitle: () => string
  readonly icon: ComponentType<object>
  /**
  Whether the host offers this section in the given state. Absent means
  always offered; no section gates on it any more (RLTESTDRIVE 10 keeps
  the vault tab always present, with its state or its reason, instead of
  hiding it until the broker binds).
  */
  readonly isOffered?: ((panelState: ModelsPanelState | undefined) => boolean) | undefined
  readonly Component: ComponentType<SectionProps>
  /**
  The section's own fold of a panel action. Every section sees every
  action and handles only its own overlay kinds; the host-owned slices
  close an overlay the host cleared (a gone wizard draft cannot stay
  open, since the host owns the draft).
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

function reduceVault(state: PanelUiState, _action: PanelUiAction): PanelUiState {
  return state
}
const RolesSection = deferred(async () => {
  await loadTeamEnglish()
  const module = await import('./sections/roles/RolesSection')
  return { default: module.RolesSection }
})
const AgentsSection = deferred(async () => {
  await loadTeamEnglish()
  const module = await import('./sections/agents/AgentsSection')
  return { default: module.AgentsSection }
})

function reduceJudge(state: PanelUiState, _action: PanelUiAction): PanelUiState {
  return state
}

export const MODEL_SECTIONS: readonly PanelSectionDef[] = [
  {
    id: 'providers',
    getTitle: () => UI_TEXT.providersSectionTitle,
    icon: PlusIcon,
    Component: DeferredProvidersSection,
    reduceSection: reduceProviders,
  },
  {
    id: 'models',
    getTitle: () => UI_TEXT.modelsSectionTitle,
    icon: CodeIcon,
    Component: DeferredModelsSection,
    reduceSection: reduceModels,
  },
  {
    id: 'roles',
    getTitle: () => UI_TEXT.teamRolesTitle,
    icon: CodeIcon,
    Component: RolesSection,
    reduceSection: reduceModels,
  },
  {
    id: 'agents',
    getTitle: () => UI_TEXT.teamEditor.agents,
    icon: CodeIcon,
    Component: AgentsSection,
    reduceSection: reduceModels,
  },
  {
    id: 'vault',
    getTitle: () => UI_TEXT.vaultSectionTitle,
    icon: LockIcon,
    Component: VaultSectionMount,
    reduceSection: reduceVault,
  },
  {
    id: 'judge',
    getTitle: () => UI_TEXT.paidJudgeName,
    icon: BoltIcon,
    Component: DeferredJudgeSection,
    reduceSection: reduceJudge,
  },
]

/** The registered section, or undefined for a section this build has none of. */
export function sectionById(id: ModelsPanelSection): PanelSectionDef | undefined {
  return MODEL_SECTIONS.find((section) => section.id === id)
}
