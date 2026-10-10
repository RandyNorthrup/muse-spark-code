// @vitest-environment jsdom
import { useReducer, useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { panelRig } from './helpers/teamPanelRig'
import { makeState } from './modelsPanelFixtures'
import { UI_TEXT } from '../../src/shared/constants'
import type { TeamPanelSlice } from '../../src/shared/teamPanel'
import type { PanelToHostMessage } from '../../src/shared/modelsPanel'
import { teamPanelMessageSchema } from '../../src/shared/teamPanel'
import { ModelsApp, ModelsPanel } from '../../src/webview/models/panel'
import * as browserSchemas from '../../src/webview/models/teamPanelBrowser'
import { INITIAL_PANEL_UI, panelUiReducer } from '../../src/webview/models/reducer'
import { RolesSection } from '../../src/webview/models/sections/roles/RolesSection'
import { AgentsSection } from '../../src/webview/models/sections/agents/AgentsSection'
import type { SectionProps } from '../../src/webview/models/sections'
import { loadMoneyDisplay } from '../../src/webview/money'
import { teamTreeSchema } from '../../src/shared/teamView'

beforeAll(async () => {
  await loadMoneyDisplay()
})

function sectionProps(slice: TeamPanelSlice, post: SectionProps['post'] = vi.fn()): SectionProps {
  return {
    panelState: makeState({ roles: slice, agents: {} }),
    post,
    dispatch: vi.fn(),
    navigate: vi.fn(),
    wizardOpen: false,
    wizardLife: { generation: 0, isCurrent: () => false },
    importOpen: false,
    highlightedItem: undefined,
  }
}
async function sectionRig(template?: 'pair' | 'full') {
  const rig = panelRig()
  await rig.read()
  if (template !== undefined) await rig.controller.handle({ type: 'roles/template', template })
  const initial = await rig.read()
  const posted: PanelToHostMessage[] = []
  function App() {
    const [slice, setSlice] = useState(initial)
    const post = (message: PanelToHostMessage) => {
      posted.push(message)
      const parsed = teamPanelMessageSchema.safeParse(message)
      if (!parsed.success) throw new Error('Not a team message')
      void rig.controller
        .handle(parsed.data)
        .then(() => rig.read())
        .then(setSlice)
    }
    return <RolesSection {...sectionProps(slice, post)} />
  }
  render(<App />)
  return { ...rig, posted }
}

async function outputCapSlice() {
  const rig = panelRig()
  await rig.read()
  await rig.controller.handle({ type: 'roles/template', template: 'pair' })
  const slice = await rig.read()
  const offer = slice.offers[0]
  if (offer === undefined) throw new Error('No offer')
  offer.controls.push({ key: 'outputCap', kind: 'number', label: 'Output Cap', note: '', min: 1 })
  return slice
}

describe('M96 U1 Roles UI', () => {
  it.each(['solo', 'custom'] as const)(
    'keeps saved %s out of first-run setup',
    async (template) => {
      const rig = panelRig()
      await rig.read()
      await rig.controller.handle({ type: 'roles/template', template })
      await rig.controller.handle({ type: 'roles/save' })
      const slice = await rig.read()
      render(<RolesSection {...sectionProps(slice)} />)
      expect(screen.getByRole('combobox', { name: UI_TEXT.teamSetupSteps.template })).toHaveValue(
        template,
      )
      expect(screen.queryByRole('button', { name: UI_TEXT.wizardContinue })).toBeNull()
    },
  )
  it('keeps local role selection usable and honors a subsequent host deep link', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'full' })
    const slice = await rig.read()
    const props = sectionProps(slice)
    const view = render(<RolesSection {...props} highlightedItem="engineering" />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditorRoles['code-review'] }))
    expect(
      screen.getByRole('heading', { name: UI_TEXT.teamEditorRoles['code-review'] }),
    ).toBeDefined()
    view.rerender(<RolesSection {...props} highlightedItem="research" />)
    expect(screen.getByRole('heading', { name: UI_TEXT.teamEditorRoles.research })).toBeDefined()
  })
  it('shows a retry after a deferred validator load fails', async () => {
    const loader = vi
      .spyOn(browserSchemas, 'loadTeamPanelSchemas')
      .mockRejectedValue(new Error('chunk unavailable'))
    try {
      render(
        <ModelsApp
          host={{
            post: vi.fn(),
            messages: window,
            savedState: () => undefined,
            saveState: vi.fn(),
          }}
          report={vi.fn()}
        />,
      )
      window.dispatchEvent(new MessageEvent('message', { data: { state: { roles: {} } } }))
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
      })
      expect(screen.getByRole('button', { name: UI_TEXT.surfaceLoadRetry })).toBeDefined()
    } finally {
      loader.mockRestore()
    }
  })
  it('drops a pending deferred state when its document closes', async () => {
    const pending = Promise.withResolvers<undefined>()
    const loader = vi.spyOn(browserSchemas, 'loadTeamPanelSchemas').mockReturnValue(pending.promise)
    const report = vi.fn()
    try {
      const view = render(
        <ModelsApp
          host={{
            post: vi.fn(),
            messages: window,
            savedState: () => undefined,
            saveState: vi.fn(),
          }}
          report={report}
        />,
      )
      window.dispatchEvent(new MessageEvent('message', { data: { state: { roles: {} } } }))
      await waitFor(() => {
        expect(loader).toHaveBeenCalled()
      })
      view.unmount()
      pending.resolve(undefined)
      await pending.promise
      await Promise.resolve()
      expect(report).not.toHaveBeenCalled()
    } finally {
      loader.mockRestore()
    }
  })
  it('saves the first Pair in four clicks with found agents', async () => {
    const rig = await sectionRig()
    for (const nextStep of [
      UI_TEXT.teamSetupSteps.agents,
      UI_TEXT.teamSetupSteps.pools,
      UI_TEXT.teamSetupSteps.limits,
    ]) {
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardContinue }))
      await waitFor(() => {
        expect(screen.getAllByText(nextStep).length).toBeGreaterThan(0)
      })
    }
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditor.save }))
    await waitFor(() => {
      expect(rig.reload).toHaveBeenCalledOnce()
    })
    expect(rig.posted.map((message) => message.type)).toEqual(['roles/template', 'roles/save'])
    expect(screen.getByText(UI_TEXT.teamEditor.saved)).toBeDefined()
  })
  it('shows the stored template and keeps an imported draft out of the first-run guide', async () => {
    const rig = panelRig()
    const empty = await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'full' })
    const imported = await rig.read()
    const post = vi.fn<SectionProps['post']>()
    const props = sectionProps(empty, post)
    const view = render(<RolesSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerImport }))
    view.rerender(<RolesSection {...sectionProps(imported, post)} />)
    expect(screen.getByRole('combobox', { name: UI_TEXT.teamSetupSteps.template })).toHaveValue(
      'full',
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.wizardContinue })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditor.save }))
    expect(post.mock.calls.map(([message]) => message.type)).toEqual(['roles/import', 'roles/save'])
  })
  it('posts Alt+Up reordering and exposes only supported settings', async () => {
    const rig = await sectionRig('pair')
    const defaultButton = screen.getByRole('button', { name: 'Default (main/main)' })
    fireEvent.keyDown(defaultButton, { key: 'ArrowUp', altKey: true })
    await waitFor(() => {
      expect(
        rig.posted.some((message) => message.type === 'roles/moveEntry' && message.to === 0),
      ).toBe(true)
    })
    expect(screen.getAllByRole('combobox', { name: 'Effort' }).length).toBe(1)
    expect(screen.queryByRole('checkbox', { name: 'Verbosity' })).toBeNull()
    expect(screen.getByText(/Moved .* position 1/)).toBeDefined()
  })
  it('keeps generated charter read-only and edits the user purpose', async () => {
    const rig = await sectionRig('pair')
    const purpose = screen.getByRole('textbox', { name: UI_TEXT.teamEditor.purpose })
    fireEvent.change(purpose, { target: { value: 'Build the requested feature' } })
    await waitFor(() => {
      expect(rig.posted).toContainEqual({
        type: 'roles/updateRole',
        role: 'engineering',
        fields: { purpose: 'Build the requested feature' },
      })
    })
    expect(screen.queryByRole('textbox', { name: UI_TEXT.teamCharterEnforced })).toBeNull()
    expect(screen.getByText(UI_TEXT.teamCharterEnforced)).toBeDefined()
  })
  it('filters the allowed tools without changing the selected tool set', async () => {
    const rig = await sectionRig('pair')
    const search = screen.getByRole('searchbox', { name: UI_TEXT.teamEditor.toolSearch })
    fireEvent.change(search, { target: { value: 'web' } })
    expect(screen.getByRole('checkbox', { name: 'webFetch' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'read' })).toBeNull()
    expect(rig.posted).toEqual([])
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: 'read' })).toBeChecked()
  })
  it('disables saving a host-reported validation failure', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const slice = await rig.read()
    const broken: TeamPanelSlice = { ...slice, issues: [UI_TEXT.teamCapTaskAboveDay] }
    render(<RolesSection {...sectionProps(broken)} />)
    expect(screen.getByRole('button', { name: UI_TEXT.teamEditor.save })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.teamCapTaskAboveDay)
  })
  it('refuses fractional running limits and integer model controls in the form', async () => {
    const slice = await outputCapSlice()
    render(<RolesSection {...sectionProps(slice)} />)
    const limit = screen.getAllByRole('spinbutton', { name: UI_TEXT.teamEditor.concurrent })[0]
    if (limit === undefined) throw new Error('No limit')
    fireEvent.change(limit, { target: { value: '1.5' } })
    expect(limit).toBeInvalid()
    const output = screen.getByRole('spinbutton', { name: 'Output Cap' })
    fireEvent.change(output, { target: { value: '1.5' } })
    expect(output).toBeInvalid()
  })
  it('shows inherited numeric settings as Default and can reset an explicit value', async () => {
    const slice = await outputCapSlice()
    const post = vi.fn<SectionProps['post']>()
    const view = render(<RolesSection {...sectionProps(slice, post)} />)
    const output = screen.getByRole('spinbutton', { name: 'Output Cap' })
    expect(output).toHaveDisplayValue('')
    expect(output).toHaveAttribute('placeholder', UI_TEXT.teamDefaultEntry)
    expect(output).not.toBeRequired()
    const role = slice.document.roles[0]
    const entry = role?.pool[0]
    if (entry === undefined) throw new Error('No entry')
    entry.settings = { ...entry.settings, outputCap: 512 }
    view.rerender(<RolesSection {...sectionProps(slice, post)} />)
    expect(output).toHaveValue(512)
    fireEvent.click(
      screen.getByRole('button', { name: `${UI_TEXT.teamResetToDefault} (outputCap)` }),
    )
    expect(post).toHaveBeenCalledWith({
      type: 'roles/updateEntry',
      role: 'engineering',
      entryId: entry.id,
      fields: { settings: { effort: 'high' } },
    })
  })
  it('hides both team sections and ignores their deep links when the gate is off', () => {
    render(
      <ModelsPanel
        panelState={makeState()}
        ui={{ ...INITIAL_PANEL_UI, section: 'roles' }}
        post={vi.fn()}
        dispatch={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.teamRolesTitle })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.teamEditor.agents })).toBeNull()
    expect(screen.getByRole('button', { name: UI_TEXT.providersSectionTitle })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
  it('navigates through the registry and opens a deep-linked role', async () => {
    const rig = panelRig()
    await rig.read()
    await rig.controller.handle({ type: 'roles/template', template: 'pair' })
    const slice = await rig.read()
    function App() {
      const [ui, dispatch] = useReducer(panelUiReducer, {
        ...INITIAL_PANEL_UI,
        section: 'roles',
        highlighted: { section: 'roles', itemId: 'code-review' },
      })
      return (
        <ModelsPanel
          panelState={makeState({ roles: slice, agents: {} })}
          ui={ui}
          post={vi.fn()}
          dispatch={dispatch}
        />
      )
    }
    render(<App />)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: UI_TEXT.teamEditorRoles['code-review'] }),
      ).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditor.agents }))
    await waitFor(() => {
      expect(screen.getByText(UI_TEXT.teamEditor.empty)).toBeDefined()
    })
  })
  it('shows an honest empty Agent map while no team is running', async () => {
    const rig = panelRig()
    const slice = await rig.read()
    render(<AgentsSection {...sectionProps(slice)} />)
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.teamEditor.empty)
  })
  it('gives the Agents section its title-case labels and routes its actions', async () => {
    const rig = panelRig()
    const slice = await rig.read()
    const props = sectionProps(slice)
    render(
      <AgentsSection
        {...props}
        panelState={makeState({
          roles: slice,
          agents: {
            tree: teamTreeSchema.parse({
              orchestrator: { model: 'main', backend: 'modelApi', slot: 'default' },
              roles: [],
            }),
          },
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditor.stopAll }))
    expect(props.post).toHaveBeenCalledWith({ type: 'agents/stopAll' })
  })
})
