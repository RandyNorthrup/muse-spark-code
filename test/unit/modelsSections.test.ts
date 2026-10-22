// The section registry: M95 registers providers and models, each with a
// title from the installed table, an icon, a Component and its own fold
// of the panel's actions (M96 adds roles and agents the same way).
// C-M109-1 P1 registers the vault beside them; RLTESTDRIVE 10 keeps the
// tab always present, with its state or its reason, instead of gating it
// on the host's binding.

import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { MODEL_SECTIONS, sectionById } from '../../src/webview/models/sections'
import { INITIAL_PANEL_UI } from '../../src/webview/models/reducer'
import { makeState } from './modelsPanelFixtures'

describe('MODEL_SECTIONS', () => {
  it('registers providers, models, the gated team sections and the always-present vault, each with a title, icon and Component', () => {
    expect(MODEL_SECTIONS.map((section) => section.id)).toEqual([
      'providers',
      'models',
      'roles',
      'agents',
      'vault',
    ])
    for (const section of MODEL_SECTIONS) {
      expect(section.getTitle().length).toBeGreaterThan(0)
      expect(typeof section.icon).toBe('function')
      expect(typeof section.Component).toBe('function')
      expect(typeof section.reduceSection).toBe('function')
    }
    expect(sectionById('providers')?.getTitle()).toBe(UI_TEXT.providersSectionTitle)
    expect(sectionById('models')?.getTitle()).toBe(UI_TEXT.modelsSectionTitle)
    expect(sectionById('vault')?.getTitle()).toBe(UI_TEXT.vault.title)
  })

  it('offers the vault always, bound or not', () => {
    const vault = sectionById('vault')
    if (vault === undefined) {
      throw new Error('vault section missing')
    }
    // No gate: the tab is present in every host state, and the section
    // shows the binding's state or the failure's reason.
    expect(vault.isOffered).toBe(undefined)
    expect(sectionById('providers')?.isOffered).toBe(undefined)
    expect(sectionById('models')?.isOffered).toBe(undefined)
    // The vault folds no overlay of its own.
    expect(vault.reduceSection(INITIAL_PANEL_UI, { type: 'open-wizard' })).toBe(INITIAL_PANEL_UI)
  })

  it('finds the gated team sections by their deep-link IDs', () => {
    expect(sectionById('roles')?.getTitle()).toBe(UI_TEXT.teamRolesTitle)
    expect(sectionById('agents')?.getTitle()).toBe(UI_TEXT.teamEditor.agents)
  })

  it('folds each section only over its own overlay actions', () => {
    const providers = sectionById('providers')
    const models = sectionById('models')
    if (providers === undefined || models === undefined) {
      throw new Error('sections missing')
    }
    // The models section ignores overlay actions (identity fold).
    expect(models.reduceSection(INITIAL_PANEL_UI, { type: 'open-wizard' })).toBe(INITIAL_PANEL_UI)
    // The providers section handles its own and ignores navigation.
    expect(providers.reduceSection(INITIAL_PANEL_UI, { type: 'open-wizard' }).wizardOpen).toBe(true)
    const navigated = providers.reduceSection(INITIAL_PANEL_UI, {
      type: 'navigate',
      section: 'models',
    })
    expect(navigated).toBe(INITIAL_PANEL_UI)
    // A host state with no draft or preview closes both overlays (once a
    // draft was seen; the local pick step survives until it arrives).
    const open = { ...INITIAL_PANEL_UI, wizardOpen: true, wizardHasDraft: true, importOpen: true }
    const closed = providers.reduceSection(open, { type: 'host-state', state: makeState() })
    expect(closed.wizardOpen).toBe(false)
    expect(closed.importOpen).toBe(false)
  })
})
