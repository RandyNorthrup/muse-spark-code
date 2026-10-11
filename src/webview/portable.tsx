// Native/companion entry, built independently of VS Code's chat graph.
import { createRoot } from 'react-dom/client'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import {
  hostToWebviewMessageSchema,
  webviewToHostMessageSchema,
  type HostToWebviewMessage,
} from '../shared/protocol'
import { mountChat } from './chat'
import type { HostBridge, MessageSource } from './hostBridge'
import type { PanelBridge } from './bridges/types'
import { showBridgeFailure } from './bridges/failure'
import { installEmbeddedTable } from './installTable'
import './portableTokens.css'
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
    mountChat(rootElement, portableChatBridge(host), reportBridgeFailure)
  }
}

/**
 * The chat app's bridge over the MHP panel wire. The wire carries the shared
 * chat payloads only: the estimator's lazy channel (M117) and team-tree
 * actions are not MHP 1.5 panel payloads, so they are refused here, before
 * the wire codec. An estimator request is answered at once the way VS Code
 * answers when its estimator boundary is unavailable, so no run waits on a
 * reply that cannot come; anything else off the wire throws as the codec does.
 */
function portableChatBridge(panel: PanelBridge): HostBridge {
  const target = new EventTarget()
  const messages: MessageSource = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  const deliver = (data: unknown) => {
    target.dispatchEvent(new MessageEvent('message', { data }))
  }
  panel.messages.addEventListener('message', (event) => {
    deliver(event.data)
  })
  const refuseEstimator = (requestId: string | undefined) => {
    const correlation = requestId === undefined ? {} : { requestId }
    const refusals: readonly HostToWebviewMessage[] = [
      { type: 'estimatorFailure', ...correlation, reason: UI_TEXT.estimateUnavailable },
      { type: 'estimatorStarted', ...correlation, error: UI_TEXT.estimateUnavailable },
      { type: 'notice', level: 'warning', text: UI_TEXT.estimateUnavailable },
    ]
    // After the posting handler returns, as a host reply would arrive.
    queueMicrotask(() => {
      for (const refusal of refusals) deliver(refusal)
    })
  }
  return {
    post: (message) => {
      if (message.type === 'estimateRun' || message.type === 'estimateSpinUp') {
        refuseEstimator(message.requestId)
        return
      }
      panel.post(webviewToHostMessageSchema.parse(message))
    },
    savedState: () => panel.savedState(),
    saveState: (state) => {
      panel.saveState(state)
    },
    messages,
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
