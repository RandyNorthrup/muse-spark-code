// @vitest-environment jsdom
import { useReducer, useState } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { panelRig } from './helpers/teamPanelRig'
import { teamOffers } from './helpers/teamPanelOffers'
import type { TeamPanelMessage } from '../../src/shared/teamPanel'
import { RoleEditor } from '../../src/webview/models/sections/roles/RoleEditor'
import { PoolEditor } from '../../src/webview/models/sections/roles/PoolEditor'
import {
  isPoolOfferMatch,
  offerDescription,
} from '../../src/webview/models/sections/roles/PoolEditor'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { installEmbeddedTable } from '../../src/webview/installTable'
import { WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
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

function sectionProps(
  slice: TeamPanelSlice,
  post: SectionProps['post'] = () => undefined,
): SectionProps {
  return {
    panelState: makeState({ roles: slice, agents: {} }),
    post,
    dispatch: () => undefined,
    navigate: () => undefined,
    wizardOpen: false,
    wizardLife: { generation: 0, isCurrent: () => false },
    importOpen: false,
    highlightedItem: undefined,
  }
}
async function pairSlice(overrides?: Parameters<typeof panelRig>[0]) {
  const rig = panelRig(overrides)
  await rig.read()
  await rig.controller.handle({ type: 'roles/template', template: 'pair' })
  return { rig, slice: await rig.read() }
}
async function importedFullSlice() {
  const rig = panelRig()
  const empty = await rig.read()
  await rig.controller.handle({ type: 'roles/template', template: 'full' })
  const templateSlice = await rig.read()
  // A real import arrives with the host's import notice.
  const imported: TeamPanelSlice = { ...templateSlice, notice: UI_TEXT.teamImportDraft }
  return { rig, empty, imported }
}
function engineeringRole(slice: TeamPanelSlice) {
  const role = slice.document.roles.find((item) => item.role === 'engineering')
  if (role === undefined) throw new Error('No engineering role')
  return role
}
function collectingPost(): {
  posted: TeamPanelMessage[]
  post: SectionProps['post']
} {
  const posted: TeamPanelMessage[] = []
  const post: SectionProps['post'] = (message) => {
    const parsed = teamPanelMessageSchema.safeParse(message)
    if (!parsed.success) throw new Error('Not a team message')
    posted.push(parsed.data)
  }
  return { posted, post }
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

function numericSettingOffers() {
  const offers = teamOffers()
  for (const offer of offers)
    offer.controls.push(
      { key: 'outputCap', kind: 'number', label: 'Output Cap', note: '', min: 1 },
      { key: 'temperature', kind: 'number', label: 'Temperature', note: '' },
    )
  return offers
}
async function roleEditorRig(overrides?: Parameters<typeof panelRig>[0]) {
  const { rig, slice } = await pairSlice(overrides)
  const { posted, post } = collectingPost()
  const role = engineeringRole(slice)
  const view = render(<RoleEditor role={role} slice={slice} post={post} />)
  return { rig, slice, posted, post, role, view }
}

type TemperatureRig = Pick<Awaited<ReturnType<typeof roleEditorRig>>, 'posted' | 'rig'>

async function changeTemperatureSetting(
  parts: TemperatureRig,
  value: string,
  effort: string,
  temperature: number,
): Promise<void> {
  const { posted, rig } = parts
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), {
    target: { value },
  })
  const last = posted.at(-1)
  expect(last).toMatchObject({
    fields: { settings: { effort, outputCap: 1024, temperature } },
  })
  if (last === undefined) throw new Error('No settings edit')
  await rig.controller.handle(last)
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
      await screen.findByRole('heading', { name: UI_TEXT.teamEditorRoles['code-review'] }),
    ).toBeDefined()
    view.rerender(<RolesSection {...props} highlightedItem="research" />)
    expect(screen.getByRole('heading', { name: UI_TEXT.teamEditorRoles.research })).toBeDefined()
  })
  it('drops a pending deferred state when its document closes', async () => {
    const reports: unknown[][] = []
    const view = render(
      <ModelsApp
        host={{
          post: () => undefined,
          messages: window,
          savedState: () => undefined,
          saveState: () => undefined,
        }}
        report={(source, error) => {
          reports.push([source, error])
        }}
      />,
    )
    window.dispatchEvent(new MessageEvent('message', { data: { state: { roles: {} } } }))
    // The deferred schema chunk cannot resolve before this synchronous
    // unmount: the queued receive awaits at least one microtask first.
    view.unmount()
    await browserSchemas.loadTeamPanelSchemas({ state: { roles: {} } })
    await Promise.resolve()
    expect(reports).toEqual([])
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
      expect(rig.reloadCalls).toHaveLength(1)
    })
    expect(rig.posted.map((message) => message.type)).toEqual(['roles/template', 'roles/save'])
    expect(screen.getByText(UI_TEXT.teamEditor.saved)).toBeDefined()
  })
  it('shows the stored template and keeps an imported draft out of the first-run guide', async () => {
    const { empty, imported } = await importedFullSlice()
    const { posted, post } = collectingPost()
    const props = sectionProps(empty, post)
    const view = render(<RolesSection {...props} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerImport }))
    view.rerender(<RolesSection {...sectionProps(imported, post)} />)
    expect(screen.getByRole('combobox', { name: UI_TEXT.teamSetupSteps.template })).toHaveValue(
      'full',
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.wizardContinue })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditor.save }))
    expect(posted.map((message) => message.type)).toEqual(['roles/import', 'roles/save'])
  })
  it('keeps guided setup when the import picker is cancelled', async () => {
    const rig = panelRig()
    const empty = await rig.read()
    const { posted, post } = collectingPost()
    const view = render(<RolesSection {...sectionProps(empty, post)} />)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providerImport }))
    expect(posted).toContainEqual({ type: 'roles/import' })
    // Cancelling the native picker delivers no new draft: the same empty
    // slice renders again and the guide stays.
    view.rerender(<RolesSection {...sectionProps(empty, post)} />)
    expect(screen.getByRole('button', { name: UI_TEXT.wizardContinue })).toBeDefined()
  })
  it('restores guided setup when the editor is cancelled back to empty', async () => {
    const { imported } = await importedFullSlice()
    const { posted, post } = collectingPost()
    render(<RolesSection {...sectionProps(imported, post)} />)
    expect(screen.queryByRole('button', { name: UI_TEXT.wizardContinue })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardCancel }))
    expect(posted).toContainEqual({ type: 'roles/reset' })
    expect(screen.getByRole('button', { name: UI_TEXT.wizardContinue })).toBeDefined()
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
  it('keeps rapid consecutive setting edits without dropping the first', async () => {
    // A delayed host reply: both edits post before the host answers, so
    // each message must build on the latest local draft. The posted
    // messages are applied to the genuine controller only afterwards.
    const offers = numericSettingOffers()
    const { rig, posted } = await roleEditorRig({ offers: () => Promise.resolve(offers) })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Output Cap' }), {
      target: { value: '1024' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), {
      target: { value: '0.5' },
    })
    const updates = posted.filter((message) => message.type === 'roles/updateEntry')
    expect(updates).toHaveLength(2)
    const [first, second] = updates
    if (first === undefined || second === undefined) throw new Error('Missing update')
    expect(second).toMatchObject({
      type: 'roles/updateEntry',
      role: 'engineering',
      fields: { settings: { outputCap: 1024, temperature: 0.5 } },
    })
    await rig.controller.handle(first)
    await rig.controller.handle(second)
    const after = await rig.read()
    expect(
      after.document.roles.find((item) => item.role === 'engineering')?.pool[0]?.settings,
    ).toMatchObject({ outputCap: 1024, temperature: 0.5 })
  })
  it('keeps rapid consecutive cap edits without restoring the stale measure', async () => {
    const { rig, slice } = await pairSlice()
    const { posted, post } = collectingPost()
    render(<PoolEditor role={engineeringRole(slice)} slice={slice} post={post} />)
    const block = document.querySelector('.team-editor-cap')
    if (block === null) throw new Error('No cap block')
    const selects = block.querySelectorAll('select')
    const measure = selects[0]
    const windowSelect = selects[1]
    const amount = block.querySelector('input[type="number"]')
    if (measure === undefined || windowSelect === undefined || amount === null)
      throw new Error('No cap controls')
    // Three consecutive edits: the third must still build on the first two.
    fireEvent.change(measure, { target: { value: 'outputTokens' } })
    fireEvent.change(amount, { target: { value: String(10_000) } })
    fireEvent.change(windowSelect, { target: { value: 'day' } })
    const caps = posted.filter((message) => message.type === 'roles/cap')
    expect(caps).toHaveLength(3)
    const [first, second, third] = caps
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('Missing cap edit')
    expect(second).toMatchObject({
      type: 'roles/cap',
      role: 'engineering',
      cap: { measure: 'outputTokens', window: 'task', amount: 10_000 },
    })
    expect(third).toMatchObject({
      type: 'roles/cap',
      role: 'engineering',
      cap: { measure: 'outputTokens', window: 'day', amount: 10_000 },
    })
    await rig.controller.handle(first)
    await rig.controller.handle(second)
    await rig.controller.handle(third)
    const after = await rig.read()
    expect(
      after.document.roles.find((item) => item.role === 'engineering')?.pool[0]?.caps[0],
    ).toEqual({ measure: 'outputTokens', window: 'day', amount: 10_000 })
  })
  it('keeps rapid consecutive tool ticks without restoring the first', async () => {
    const { rig, slice } = await pairSlice()
    const { posted, post } = collectingPost()
    render(<RoleEditor role={engineeringRole(slice)} slice={slice} post={post} />)
    const boxes = [...document.querySelectorAll('.team-editor-tool input[type="checkbox"]')]
    const [firstBox, secondBox] = boxes
    if (firstBox === undefined || secondBox === undefined) throw new Error('No tool checkboxes')
    fireEvent.click(firstBox)
    fireEvent.click(secondBox)
    const updates = posted.filter((message) => message.type === 'roles/updateRole')
    expect(updates).toHaveLength(2)
    const [first, second] = updates
    if (first === undefined || second === undefined) throw new Error('Missing role update')
    const allowed =
      slice.roleViews.find((view) => view.role === 'engineering')?.allowedTools.length ?? 0
    expect(second.fields.tools).toHaveLength(allowed - 2)
    await rig.controller.handle(first)
    await rig.controller.handle(second)
    const after = await rig.read()
    expect(after.document.roles.find((item) => item.role === 'engineering')?.tools).toHaveLength(
      allowed - 2,
    )
  })
  it('keeps pending settings through unrelated and partial host replies', async () => {
    const offers = numericSettingOffers()
    const { rig, posted, post, role, view } = await roleEditorRig({
      offers: () => Promise.resolve(offers),
    })
    const concurrent = screen.getAllByRole('spinbutton', { name: UI_TEXT.teamEditor.concurrent })[0]
    const primary = role.pool[0]
    if (concurrent === undefined || primary === undefined) throw new Error('No primary entry')
    fireEvent.change(concurrent, {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Output Cap' }), {
      target: { value: '1024' },
    })
    const concurrentReply = posted[0]
    if (concurrentReply === undefined) throw new Error('No concurrency edit')
    await rig.controller.handle(concurrentReply)
    const unrelated = structuredClone(await rig.read())
    view.rerender(<RoleEditor role={engineeringRole(unrelated)} slice={unrelated} post={post} />)
    // A separate settings field changes while Output Cap is still pending.
    await rig.controller.handle({
      type: 'roles/updateEntry',
      role: role.role,
      entryId: primary.id,
      fields: { settings: { effort: 'low' } },
    })
    const partial = structuredClone(await rig.read())
    view.rerender(<RoleEditor role={engineeringRole(partial)} slice={partial} post={post} />)
    await changeTemperatureSetting({ posted, rig }, '0.5', 'low', 0.5)
    expect(engineeringRole(await rig.read()).pool[0]?.settings).toEqual({
      effort: 'low',
      outputCap: 1024,
      temperature: 0.5,
    })
  })
  it('keeps pending cap measures through unrelated and other-entry replies', async () => {
    const { rig, posted, post, role, view } = await roleEditorRig()
    const concurrent = screen.getAllByRole('spinbutton', { name: UI_TEXT.teamEditor.concurrent })[0]
    if (concurrent === undefined) throw new Error('No concurrency control')
    fireEvent.change(concurrent, { target: { value: '1' } })
    const block = document.querySelector('.team-editor-cap')
    if (block === null) throw new Error('No cap')
    const measure = block.querySelector('select')
    const amount = block.querySelector('input')
    if (measure === null || amount === null) throw new Error('No cap controls')
    fireEvent.change(measure, { target: { value: 'outputTokens' } })
    const reply = posted[0]
    if (reply === undefined) throw new Error('No edit')
    await rig.controller.handle(reply)
    const unrelated = structuredClone(await rig.read())
    view.rerender(<RoleEditor role={engineeringRole(unrelated)} slice={unrelated} post={post} />)
    const fallback = role.pool.at(-1)
    if (fallback === undefined) throw new Error('No fallback')
    await rig.controller.handle({
      type: 'roles/cap',
      role: role.role,
      entryId: fallback.id,
      index: 0,
      cap: { measure: 'inputTokens', window: 'task', amount: 400_000 },
    })
    const primary = role.pool[0]
    if (primary === undefined) throw new Error('No primary')
    await rig.controller.handle({
      type: 'roles/cap',
      role: role.role,
      entryId: primary.id,
      index: 1,
      cap: { measure: 'tokens', window: 'day', amount: 2_000_000 },
    })
    const partial = structuredClone(await rig.read())
    view.rerender(<RoleEditor role={engineeringRole(partial)} slice={partial} post={post} />)
    expect(document.querySelectorAll('.team-editor-cap select')[4]).toHaveValue('inputTokens')
    expect(document.querySelectorAll('.team-editor-cap input')[1]).toHaveValue(2_000_000)
    fireEvent.change(amount, { target: { value: '10000' } })
    const last = posted.at(-1)
    expect(last).toMatchObject({ cap: { measure: 'outputTokens', window: 'task', amount: 10_000 } })
    if (last === undefined) throw new Error('No cap edit')
    await rig.controller.handle(last)
    expect(engineeringRole(await rig.read()).pool[0]?.caps[0]?.measure).toBe('outputTokens')
  })
  it('keeps pending tool ticks through unrelated host replies', async () => {
    const { rig, posted, post, view } = await roleEditorRig()
    fireEvent.change(screen.getByRole('textbox', { name: UI_TEXT.teamEditor.purpose }), {
      target: { value: 'Custom purpose' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.teamToolGroups.read }))
    const reply = posted[0]
    if (reply === undefined) throw new Error('No purpose edit')
    await rig.controller.handle(reply)
    const unrelated = structuredClone(await rig.read())
    view.rerender(<RoleEditor role={engineeringRole(unrelated)} slice={unrelated} post={post} />)
    expect(screen.getByRole('checkbox', { name: UI_TEXT.teamToolGroups.read })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: UI_TEXT.teamToolGroups.write }))
    const last = posted.at(-1)
    if (last?.type !== 'roles/updateRole') throw new Error('No tool edit')
    expect(last.fields.tools).not.toContain('read')
    expect(last.fields.tools).not.toContain('write')
    await rig.controller.handle(last)
    expect(engineeringRole(await rig.read()).tools).toEqual(last.fields.tools)
  })
  it('retains more than sixteen outstanding setting edits until their echoes arrive', async () => {
    const slice = await outputCapSlice()
    const { posted, post } = collectingPost()
    const view = render(<RoleEditor role={engineeringRole(slice)} slice={slice} post={post} />)
    for (let amount = 1001; amount <= 1017; amount++)
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Output Cap' }), {
        target: { value: String(amount) },
      })
    const echo = structuredClone(slice)
    const entry = engineeringRole(echo).pool[0]
    if (entry === undefined) throw new Error('No entry')
    entry.settings = { ...entry.settings, outputCap: 1001 }
    view.rerender(<RoleEditor role={engineeringRole(echo)} slice={echo} post={post} />)
    expect(screen.getByRole('spinbutton', { name: 'Output Cap' })).toHaveValue(1017)
    fireEvent.change(screen.getByRole('combobox', { name: 'Effort' }), { target: { value: 'low' } })
    expect(posted.at(-1)).toMatchObject({
      fields: { settings: { effort: 'low', outputCap: 1017 } },
    })
  })
  it('retires schema-reordered acknowledgements so a later Re-apply Level sticks', async () => {
    // RVCM962C P2: the strict controller schema rebuilds settings in schema
    // key order (effort, outputCap, temperature) while the local draft keeps
    // edit order (effort, temperature, outputCap). A reordered acknowledgement
    // must still retire exactly its own sends, or a later Re-apply Level is
    // mistaken for an old echo and the next edit undoes it.
    const offers = numericSettingOffers()
    const { rig, posted, post, role, view } = await roleEditorRig({
      offers: () => Promise.resolve(offers),
    })
    const primary = role.pool[0]
    if (primary === undefined) throw new Error('No primary entry')
    const answer = async () => {
      const last = posted.at(-1)
      if (last === undefined) throw new Error('No settings edit')
      await rig.controller.handle(last)
      const next = structuredClone(await rig.read())
      view.rerender(<RoleEditor role={engineeringRole(next)} slice={next} post={post} />)
    }
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), {
      target: { value: '0.5' },
    })
    await answer()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Output Cap' }), {
      target: { value: '1024' },
    })
    await answer()
    fireEvent.change(screen.getByRole('combobox', { name: 'Effort' }), { target: { value: 'low' } })
    await answer()
    await rig.controller.handle({ type: 'roles/reapply', role: role.role })
    const reapplied = structuredClone(await rig.read())
    view.rerender(<RoleEditor role={engineeringRole(reapplied)} slice={reapplied} post={post} />)
    // The level restores High: the editor shows it, not the retired Low.
    expect(screen.getByRole('combobox', { name: 'Effort' })).toHaveValue('high')
    await changeTemperatureSetting({ posted, rig }, '0.6', 'high', 0.6)
    expect(engineeringRole(await rig.read()).pool[0]?.settings).toEqual({
      effort: 'high',
      outputCap: 1024,
      temperature: 0.6,
    })
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
    fireEvent.change(search, { target: { value: ' Web Fetch ' } })
    expect(screen.getByRole('checkbox', { name: UI_TEXT.teamToolGroups.webFetch })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: UI_TEXT.teamToolGroups.read })).toBeNull()
    fireEvent.change(search, { target: { value: 'Code Intel' } })
    expect(screen.getByRole('checkbox', { name: UI_TEXT.teamToolGroups.codeIntel })).toBeChecked()
    expect(rig.posted).toEqual([])
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: UI_TEXT.teamToolGroups.read })).toBeChecked()
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
    const { posted, post } = collectingPost()
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
    expect(posted).toContainEqual({
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
        post={() => undefined}
        dispatch={() => undefined}
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
          post={() => undefined}
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
    const { posted, post } = collectingPost()
    const props = sectionProps(slice, post)
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
    expect(posted).toContainEqual({ type: 'agents/stopAll' })
  })
})

describe('M96 U1 pool catalogue filters', () => {
  it('shows the catalogue filter bar in the pool picker', async () => {
    const { slice } = await pairSlice()
    render(<RolesSection {...sectionProps(slice)} />)
    expect(document.querySelector('.team-editor .models-filter-bar')).not.toBeNull()
  })
  it.each([
    [{}, true],
    [{ toolCalling: true }, true],
    [{ vision: true }, true],
    [{ reasoning: true }, true],
    [{ contextMin: 1000 }, true],
    [{ contextMin: 200_000 }, false],
    [{ contextMax: 1000 }, false],
    [{ maxInputPerMillion: 0.5 }, false],
    [{ maxInputPerMillion: 5 }, true],
    [{ freeOrLocal: true }, false],
    [{ providerId: 'main' }, true],
    [{ providerId: 'reviewer' }, false],
    [{ search: 'reviewer' }, false],
    [{ family: 'main' }, true],
    [{ family: 'MAIN' }, true],
    [{ family: 'qwen3' }, false],
  ])('matches the main fixture offer %j as %j', (filter, expected) => {
    const [offer] = teamOffers()
    if (offer === undefined) throw new Error('No offer')
    expect(isPoolOfferMatch(offer, filter)).toBe(expected)
  })
  it('offers derived families and filters the picker while keeping Default', async () => {
    const offers = teamOffers()
    const [main, reviewer] = offers
    if (main === undefined || reviewer === undefined) throw new Error('No offers')
    main.agent.model = 'vendor/qwen3:8b'
    reviewer.agent.model = 'deepseek-flash'
    const { slice } = await pairSlice({
      offers: () => Promise.resolve(offers),
      defaultRef: () => main.ref,
    })
    render(<RolesSection {...sectionProps(slice)} />)
    const family = screen.getByRole('combobox', { name: UI_TEXT.modelFilterLabels.family })
    expect(family).toHaveTextContent('qwen3')
    expect(family).toHaveTextContent('deepseek')
    fireEvent.change(family, { target: { value: 'qwen3' } })
    fireEvent.focus(screen.getByRole('combobox', { name: UI_TEXT.teamAddEntry }))
    const picker = within(screen.getByRole('listbox'))
    expect(picker.getByRole('option', { name: /^main/ })).toBeDefined()
    expect(picker.queryByRole('option', { name: /reviewer/ })).toBeNull()
    expect(picker.getByRole('option', { name: /Default/ })).toBeDefined()
  })
  it.each(['maxInput', 'maxOutput', 'maxCached'] as const)(
    'saves a valid team with a fractional %s price filter',
    async (label) => {
      const { slice } = await pairSlice()
      const { posted, post } = collectingPost()
      render(<RolesSection {...sectionProps(slice, post)} />)
      const filter = screen.getByRole('spinbutton', { name: UI_TEXT.modelFilterLabels[label] })
      fireEvent.change(filter, { target: { value: '0.5' } })
      expect(filter).toBeValid()
      expect(document.querySelector('form')?.checkValidity()).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamEditor.save }))
      expect(posted).toContainEqual({ type: 'roles/save' })
    },
  )
  it('formats pool prices with the installed French currency rules', async () => {
    const script = document.createElement('script')
    script.type = 'application/json'
    script.id = WEBVIEW_L10N_ELEMENT_ID
    script.textContent = JSON.stringify({
      locale: 'fr',
      table: JSON.parse(readFileSync('l10n/ui.fr.json', 'utf8')),
    })
    document.body.append(script)
    expect(installEmbeddedTable(document)).toBeUndefined()
    try {
      const [offer] = teamOffers()
      if (offer === undefined) throw new Error('No offer')
      const money = await loadMoneyDisplay()
      const text = offerDescription({ ...offer, inputRate: 1234.5, outputRate: 0.25 }, money)
      const currency = new Intl.NumberFormat('fr', { style: 'currency', currency: 'USD' })
      expect(text).toContain(`${currency.format(1234.5)}/${currency.format(0.25)}`)
      expect(text).not.toContain('$1234.5')
    } finally {
      script.remove()
      setUiText(EN, 'en')
    }
  })
  it('keeps local and capable offers under their facets', () => {
    const [, reviewer] = teamOffers()
    if (reviewer === undefined) throw new Error('No reviewer offer')
    expect(isPoolOfferMatch(reviewer, { search: 'reviewer' })).toBe(true)
    const local = { ...reviewer, agent: { ...reviewer.agent, pays: 'local' as const } }
    expect(isPoolOfferMatch(local, { freeOrLocal: true })).toBe(true)
    const tooless = { ...reviewer, toolCalling: false }
    expect(isPoolOfferMatch(tooless, { toolCalling: true })).toBe(false)
    const windowless = { ...reviewer, contextWindow: undefined }
    expect(isPoolOfferMatch(windowless, { contextMin: 1000 })).toBe(false)
  })
  it('describes offers with context and price to compare', async () => {
    const [offer] = teamOffers()
    if (offer === undefined) throw new Error('No offer')
    expect(offerDescription(offer)).toContain('Tokens')
    expect(offerDescription(offer, await loadMoneyDisplay())).toContain('$1.00/$2.00')
  })
})

describe('M96 U1 localized role labels', () => {
  it('renders report and tool labels from the installed table', async () => {
    const { slice } = await pairSlice()
    const role = engineeringRole(slice)
    const element = document.createElement('script')
    element.type = 'application/json'
    element.id = WEBVIEW_L10N_ELEMENT_ID
    element.textContent = JSON.stringify({
      locale: 'de',
      table: JSON.parse(readFileSync('l10n/ui.de.json', 'utf8')),
    })
    document.body.append(element)
    expect(installEmbeddedTable(document)).toBeUndefined()
    try {
      render(<RoleEditor role={role} slice={slice} post={() => undefined} />)
      expect(screen.getByRole('option', { name: 'Zusammenfassung' })).toBeDefined()
      expect(screen.getByRole('option', { name: 'Prüfung' })).toBeDefined()
      expect(screen.queryByRole('option', { name: 'summary' })).toBeNull()
      expect(screen.getByRole('checkbox', { name: 'Lesen' })).toBeDefined()
      expect(screen.queryByRole('checkbox', { name: 'read' })).toBeNull()
      fireEvent.change(screen.getByRole('searchbox', { name: UI_TEXT.teamEditor.toolSearch }), {
        target: { value: ' Lesen ' },
      })
      expect(screen.getByRole('checkbox', { name: 'Lesen' })).toBeChecked()
      expect(screen.queryByRole('checkbox', { name: UI_TEXT.teamToolGroups.write })).toBeNull()
    } finally {
      element.remove()
      setUiText(EN, 'en')
    }
  })
})

async function pairSliceWithOneOffer() {
  const rig = panelRig({ offers: () => Promise.resolve(teamOffers().slice(0, 1)) })
  await rig.read()
  await rig.controller.handle({ type: 'roles/template', template: 'pair' })
  return await rig.read()
}

describe('the second-model requirement (D217)', () => {
  it('says how to enable teams and disables Save with one usable model', async () => {
    const slice = await pairSliceWithOneOffer()
    render(<RolesSection {...sectionProps(slice)} />)
    expect(screen.getByText(UI_TEXT.teamNeedsSecondModel)).toBeDefined()
    const save = screen.getByRole('button', { name: UI_TEXT.teamEditor.save })
    expect(save).toBeDisabled()
  })

  it('shows no requirement once two models are offered', async () => {
    const { slice } = await pairSlice()
    render(<RolesSection {...sectionProps(slice)} />)
    expect(screen.queryByText(UI_TEXT.teamNeedsSecondModel)).toBeNull()
  })
})
