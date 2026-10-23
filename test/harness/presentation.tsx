// Fixture-only compiled carrier. Actions record exact identifiers; no backend or key is loaded.
import { createRoot } from 'react-dom/client'
import { createPresentationUi } from '../../src/webview/presentation/presentationUi'
import { createFallbackUi } from '../../src/webview/fallbacks/services'
import { TasksApp } from '../../src/webview/TasksApp'
import { ReportDialog } from '../../src/webview/components/ReportDialog'
import { installEmbeddedTable } from '../../src/webview/installTable'
import { UI_TEXT } from '../../src/shared/l10n/text'
import '../../src/webview/tokens.css'
import '../../src/webview/styles.css'

const element = document.querySelector('#surface')
if (element === null) throw new Error('MISSING_FIXTURE_ROOT')
const refused = installEmbeddedTable(document)
if (refused !== undefined) throw refused
const events: unknown[] = []
const record = (event: unknown) => {
  events.push(event)
  document.querySelector('#events')!.textContent = JSON.stringify(events)
}
const mode = new URLSearchParams(location.search).get('mode')
switch (mode) {
  case 'tasks': {
    const messages = new EventTarget()
    createRoot(element).render(
      <TasksApp
        messages={messages}
        postMessage={(message) => {
          record(message)
          if (message.type === 'tasksReady')
            messages.dispatchEvent(
              new MessageEvent('message', {
                data: {
                  type: 'tasksState',
                  conversation: 'Fixture',
                  items: [{ text: 'Exact task', status: 'inProgress' }],
                  ended: false,
                  canMoveToWindow: true,
                },
              }),
            )
        }}
      />,
    )
    break
  }
  case 'report': {
    const root = createRoot(element)
    root.render(
      <ReportDialog
        description=""
        includeFacts
        includeEvents
        items={[]}
        draftText="Exact sealed preview"
        canUseVscodeReporter={false}
        recordingUnavailable={false}
        statusText={undefined}
        isUpdating={false}
        onDescriptionChange={(text) => {
          record(text)
        }}
        onToggleFacts={(value) => {
          record(value)
        }}
        onToggleEvents={(value) => {
          record(value)
        }}
        onRemoveItem={(item) => {
          record(item)
        }}
        onExport={(via) => {
          record(via)
        }}
        onClose={() => {
          root.unmount()
          document.querySelector<HTMLButtonElement>('#opener')?.focus()
        }}
      />,
    )
    break
  }
  case 'dialog': {
    const ui = createFallbackUi(element, record)
    document.querySelector('#opener')?.addEventListener('click', () => {
      void ui
        .request('ui/confirm', {
          title: 'Fixture',
          message: 'Exact consent',
          choices: [{ id: 'continue', title: UI_TEXT.fallbackContinue }],
        })
        .then(record)
        .catch(() => {
          record('cancelled')
        })
    })
    break
  }
  default: {
    const ui = createPresentationUi(element, {
      onReload: () => {
        location.reload()
      },
      onError: record,
    })
    switch (mode) {
      case 'diff': {
        ui.showDiff({
          title: 'Exact diff',
          hunks: [
            {
              id: 'hunk',
              uri: 'file:///workspace/a.ts',
              expectedVersion: 1,
              range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
              before: 'old',
              after: 'new',
            },
          ],
          onDecide: (id, decision) => {
            record({ id, decision })
            return Promise.resolve()
          },
        })
        break
      }
      case 'manager': {
        ui.showManager({
          kind: 'mcp',
          title: UI_TEXT.mcpTitleModelApi,
          entries: [
            {
              id: 'server',
              title: 'Fixture server',
              detail: 'Actual record',
              actions: [
                {
                  id: 'inspect',
                  title: UI_TEXT.planOpen,
                  run: () => {
                    record('server')
                    return Promise.resolve()
                  },
                },
              ],
            },
          ],
          actions: [],
        })
        break
      }
      case 'walkthrough': {
        ui.showWalkthrough({
          steps: [
            {
              id: 'settings',
              title: UI_TEXT.openSettings,
              description: UI_TEXT.paletteTips.settings,
              actionTitle: UI_TEXT.fallbackContinue,
              action: { type: 'hostAction', action: 'openSettings' },
            },
          ],
          post: record,
        })
        break
      }
      case 'roles': {
        ui.showRoles({
          rolesTitle: 'Roles fixture',
          trafficTitle: 'Traffic fixture',
          roles: [
            {
              id: 'role',
              name: 'Non-Meta role',
              providerId: 'local',
              modelId: 'fixture-model',
              status: 'running',
              capabilities: ['vision'],
            },
          ],
          traffic: [
            {
              id: 'traffic',
              sourceId: 'role',
              targetId: 'unknown-role',
              at: 1_769_000_000_000,
              summary: '<script>Text only</script>',
            },
          ],
          onOpenRole: (id) => {
            record(id)
            return Promise.resolve()
          },
        })
        break
      }
      default: {
        ui.showPlans({
          plans: [
            {
              fileName: 'plan.md',
              title: 'Exact plan',
              relativePath: String.raw`.agents\plans\plan.md`,
            },
          ],
          onRead: (id) => {
            record(id)
            return Promise.resolve('<script>Exact saved text</script>')
          },
          onOpen: (id) => {
            record({ open: id })
            return Promise.resolve()
          },
          onImplement: (id) => {
            record({ implement: id })
            return Promise.resolve()
          },
        })
      }
    }
  }
}
