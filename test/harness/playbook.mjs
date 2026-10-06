// Fake-only: U's shared scenes and postMessage transport, no production binding.
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { WEBVIEW_L10N_ELEMENT_ID } from '../../src/shared/constants'
import { installEmbeddedTable } from '../../src/webview/installTable'
import {
  DeferredPlaybookBadge,
  DeferredPlaybookNotes,
  DeferredPlaybookPanel,
} from '../../src/webview/playbook/DeferredPlaybook'
import {
  createPlaybookBridge,
  playbookRequestSchema,
  playbookResponseSchema,
} from '../../src/webview/playbook/bridge'
import { surfacePort, surfacePriorityNotes, surfaceSnapshot } from '../unit/playbookSurfaceFixtures'

const query = new globalThis.URLSearchParams(globalThis.location.search)
const locale = query.get('lang') ?? 'en'
const theme = query.get('theme') ?? 'light'
const scene = query.get('scene') ?? 'status'
const snapshot = surfaceSnapshot()
snapshot.records.unshift(
  ...surfacePriorityNotes()
    .filter((note) => note.code === 'checksPassed')
    .map((value) => ({ kind: 'note', value })),
)
snapshot.settings.rules.offload = {
  enabled: false,
  reason: 'Worker maintenance',
  actor: 'owner',
  at: 1_791_289_800_000,
}
const hostPort = surfacePort(snapshot)

async function mount() {
  const document = globalThis.document
  if (locale !== 'en') {
    const response = await fetch(`../../l10n/ui.${locale}.json`)
    const raw = await response.json()
    const element = document.createElement('script')
    element.id = WEBVIEW_L10N_ELEMENT_ID
    element.type = 'application/json'
    element.textContent = JSON.stringify({ locale, table: raw })
    document.head.append(element)
    const error = installEmbeddedTable(document)
    if (error !== undefined) throw error
  }
  const response = await fetch(`themes/${theme}.json`)
  const rawTheme = await response.json()
  const themeData = z
    .object({ variables: z.record(z.string(), z.string()), bodyClass: z.string() })
    .parse(rawTheme)
  for (const [name, value] of Object.entries(themeData.variables))
    document.documentElement.style.setProperty(name, value)
  document.body.className = themeData.bodyClass
  document.documentElement.lang = locale
  const port = createPlaybookBridge(
    globalThis,
    (message) => {
      const request = playbookRequestSchema.parse(message)
      const respond = async () => {
        const result =
          request.type === 'playbookRead'
            ? await hostPort.read()
            : await hostPort.change(request.change)
        globalThis.dispatchEvent(
          new globalThis.MessageEvent('message', {
            data: playbookResponseSchema.parse({
              type: 'playbookState',
              bridgeId: request.bridgeId,
              workspaceId: request.workspaceId,
              requestId: request.requestId,
              snapshot: result,
            }),
          }),
        )
      }
      void respond()
    },
    10_000,
    snapshot.settings.teamId,
  )
  globalThis.addEventListener(
    'pagehide',
    () => {
      port.dispose()
    },
    { once: true },
  )
  const root = document.querySelector('#root')
  if (root === null) throw new Error('missing root')
  const children =
    scene === 'notes'
      ? [
          createElement('h1', { key: 'title' }, UI_TEXT.playbookTitle),
          createElement(DeferredPlaybookNotes, {
            key: 'notes',
            notes: snapshot.records
              .filter((record) => record.kind === 'note')
              .map((record) => record.value),
          }),
          createElement(DeferredPlaybookBadge, { key: 'badges', records: snapshot.records }),
        ]
      : [createElement(DeferredPlaybookPanel, { key: 'panel', port })]
  createRoot(root).render(createElement('main', null, ...children))
}
void mount()
