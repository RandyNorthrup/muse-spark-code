// Fake editor ports, genuine portable controller and shared production UI.
import { useState } from 'react'
import * as z from 'zod/mini'
import { Usd } from '../../src/shared/usd'
import { createRoot } from 'react-dom/client'
import { createTeamPanelController } from '../../src/core/team/teamPanel'
import { ModelsPanel } from '../../src/webview/models/panel'
import { INITIAL_PANEL_UI, panelUiReducer } from '../../src/webview/models/reducer'
import { teamPanelMessageSchema } from '../../src/shared/teamPanel'
import { teamTreeSchema } from '../../src/shared/teamView'
import type { TeamPanelSlice } from '../../src/shared/teamPanel'
import type { PanelToHostMessage, ModelsPanelSection } from '../../src/shared/modelsPanel'
import { makeState } from '../unit/modelsPanelFixtures'
import { teamOffers } from '../unit/helpers/teamPanelOffers'
import { installEmbeddedTable } from '../../src/webview/installTable'
import { loadMoneyDisplay } from '../../src/webview/money'
import { UI_TEXT } from '../../src/shared/constants'
import { Modal } from '../../src/webview/components/Modal'
import '../../src/webview/models/models.css'
import './teamRoles.css'

async function mount() {
  const params = new URLSearchParams(location.search)
  const lang = params.get('lang') ?? 'en'
  if (lang !== 'en') {
    const response = await fetch(`../../l10n/ui.${lang}.json`)
    const table: unknown = await response.json()
    const element = document.createElement('script')
    element.id = 'muse-l10n'
    element.type = 'application/json'
    element.textContent = JSON.stringify({ locale: lang, table })
    document.head.append(element)
    const error = installEmbeddedTable(document)
    if (error !== undefined) throw error
  }
  document.documentElement.lang = lang
  const themeResponse = await fetch(`themes/${params.get('theme') ?? 'dark'}.json`)
  const rawTheme: unknown = await themeResponse.json()
  const theme = z
    .object({ variables: z.record(z.string(), z.string()), bodyClass: z.string() })
    .parse(rawTheme)
  for (const [name, value] of Object.entries(theme.variables))
    document.documentElement.style.setProperty(name, value)
  document.body.className = theme.bodyClass
  await loadMoneyDisplay()
  const scene = params.get('scene') ?? 'template'
  const state = new Map<string, unknown>()
  let seq = 0
  const controller = createTeamPanelController({
    isEnabled: () => true,
    isTrusted: () => true,
    state: {
      get: (key) => state.get(key),
      update: (key, value) => {
        state.set(key, value)
        return Promise.resolve()
      },
    },
    offers: () => Promise.resolve(teamOffers()),
    defaultRef: () => 'main/main',
    maxWorkers: () => 8,
    remainingDailyBudgetUsd: () => Usd.from(100).toAmount(),
    records: () => [],
    newId: () => `entry-${String(++seq)}`,
    reload: () => {
      document.body.dataset.saved = 'true'
    },
    confirmInPlace: () => Promise.resolve(false),
    confirmOrchestrator: () => Promise.resolve(),
    writeExport: () => Promise.resolve(),
    readImport: () => Promise.resolve(undefined),
  })
  await controller.read()
  if (scene !== 'empty')
    await controller.handle({
      type: 'roles/template',
      template: scene === 'suggestions' ? 'full' : 'pair',
    })
  let initial = await controller.read()
  if (initial === undefined) throw new Error('No team state')
  if (scene === 'validation') {
    const entry = initial.document.roles[0]?.pool[0]
    if (entry === undefined) throw new Error('No entry')
    await controller.handle({
      type: 'roles/cap',
      role: 'engineering',
      entryId: entry.id,
      index: 0,
      cap: { measure: 'tokens', window: 'task', amount: 0 },
    })
    initial = await controller.read()
    if (initial === undefined) throw new Error('No state')
  }
  const section: ModelsPanelSection = scene === 'agents' ? 'agents' : 'roles'
  function App({ initial }: { readonly initial: TeamPanelSlice }) {
    const [slice, setSlice] = useState(initial)
    const [ui, setUi] = useState({ ...INITIAL_PANEL_UI, section })
    const [isConfirmVisible, setConfirmVisible] = useState(scene === 'in-place')
    const post = (message: PanelToHostMessage) => {
      const parsed = teamPanelMessageSchema.safeParse(message)
      if (!parsed.success) throw new Error('Bad harness message')
      void controller
        .handle(parsed.data)
        .then(() => controller.read())
        .then((next) => {
          if (next !== undefined) setSlice(next)
        })
    }
    const tree = teamTreeSchema.parse({
      orchestrator: { model: 'main', backend: 'modelApi', slot: 'default' as const },
      roles: [
        {
          id: 'engineering',
          name: UI_TEXT.teamEditorRoles.engineering,
          mode: 'own-branch' as const,
          toolGroups: ['read', 'write'],
          queued: [],
          unmerged: [],
          interrupted: [],
          entries: [
            {
              id: 'entry-1',
              provider: 'main',
              model: 'main',
              payKind: 'key' as const,
              running: 1,
              concurrentMax: 4,
              state: 'ready' as const,
              warnings: [],
              caps: [],
              workers: [
                { taskId: 'task-1', brief: 'Build the fixture feature', status: 'running' },
              ],
            },
          ],
        },
      ],
    })
    return (
      <div data-team-ready>
        <h1>{UI_TEXT.modelsPanelTitle}</h1>
        <ModelsPanel
          panelState={makeState({ roles: slice, agents: scene === 'agents' ? { tree } : {} })}
          ui={ui}
          post={post}
          dispatch={(action) => {
            setUi((current) => panelUiReducer(current, action))
          }}
        />
        {isConfirmVisible ? (
          <Modal
            title={UI_TEXT.teamAccessModes.inPlace}
            titleId="in-place-confirm"
            onClose={() => {
              setConfirmVisible(false)
            }}
          >
            <p>{UI_TEXT.teamInPlaceConfirm}</p>
            <div className="team-editor-actions">
              <button
                type="button"
                onClick={() => {
                  setConfirmVisible(false)
                }}
              >
                {UI_TEXT.wizardContinue}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmVisible(false)
                }}
              >
                {UI_TEXT.wizardCancel}
              </button>
            </div>
          </Modal>
        ) : null}
      </div>
    )
  }
  const root = document.querySelector('#root')
  if (root === null) throw new Error('No root')
  createRoot(root).render(<App initial={initial} />)
}
void mount()
