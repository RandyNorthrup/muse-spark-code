// Native/companion entry, built independently of VS Code's chat graph.
import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { hostToWebviewMessageSchema, webviewToHostMessageSchema } from '../shared/protocol'
import { mountChat } from './chat'
import type { PanelBridge } from './bridges/types'
import { showBridgeFailure } from './bridges/failure'
import { installEmbeddedTable } from './installTable'
import './tokens.css'
import './styles.css'

declare global {
  interface Window {
    /** Owning native companion containers submit through the same sequenced bridge. */
    musePanel?: { postMessage(message: unknown): void }
  }
}

async function mount(): Promise<void> {
  const { selectBridge } = await import('./bridges/select')
  const surface = document.body.dataset['surface']
  const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
  if (rootElement === null) {
    throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
  }
  const isTasks = surface === 'tasks'
  const tasks = isTasks ? await import('../shared/tasksProtocol') : undefined
  const host = await selectBridge(
    {
      outgoing: tasks?.tasksWebviewMessageSchema ?? webviewToHostMessageSchema,
      incoming: tasks?.tasksHostMessageSchema ?? hostToWebviewMessageSchema,
    },
    reportBridgeFailure,
  )
  disposeOnPagehide(host)
  if (!isTasks)
    Object.assign(window, {
      musePanel: {
        postMessage: (message: unknown) => {
          host.post(webviewToHostMessageSchema.parse(message))
        },
      },
    })
  if (document.body.dataset['bridge'] === 'companion') {
    const { connectCompanionUi } = await import('./bridges/companionUi')
    await connectCompanionUi(host, reportBridgeFailure)
  }
  if (isTasks) {
    const tableError = installEmbeddedTable(document)
    if (tableError !== undefined) throw tableError
    const { TasksApp } = await import('./TasksApp')
    createRoot(rootElement).render(
      <TasksApp
        messages={host.messages}
        postMessage={(message) => {
          host.post(message)
        }}
      />,
    )
  } else {
    mountChat(rootElement, host, reportBridgeFailure)
  }
}

function disposeOnPagehide(host: PanelBridge): void {
  window.addEventListener(
    'pagehide',
    () => {
      host.dispose()
    },
    { once: true },
  )
}

function reportBridgeFailure(_error: unknown): void {
  showBridgeFailure(document)
}

void mount().catch(reportBridgeFailure)
