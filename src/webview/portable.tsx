// Native/companion entry (M104 lane D), built independently of VS Code's
// chat graph. The host's theme arrives as MHP `theme` frames and paints
// through M114's loadThemeBridge before the panel mounts; raw paint lives
// only in the generated token files the theme entry carries.
import { createRoot } from 'react-dom/client'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID, PORTABLE_CHAT_MOUNTED_MARK } from '../shared/constants'
import { webviewToHostMessageSchema, type HostToWebviewMessage } from '../shared/protocol'
import type { HostToEstimatorMessage } from '../shared/estimatorProtocol'
import { panelThemePayloadSchema, panelToPanelPayloadSchema } from '../shared/hostApi/panel'
import { mountChat } from './chat'
import type { HostBridge, MessageSource } from './hostBridge'
import { bootImport, type PanelBridge } from './bridges/types'
import { showBridgeFailure } from './bridges/failure'
import { loadThemeBridge } from './bridges/theme/loadThemeBridge'
import { panelThemePort } from './bridges/theme/panelThemePort'
import { installEmbeddedTable } from './installTable'
import './styles.css'

declare global {
  interface Window {
    /** Owning native companion containers submit through the same sequenced bridge. */
    musePanel?: { postMessage(message: unknown): void }
  }
}

function markChatMounted(): void {
  performance.mark(PORTABLE_CHAT_MOUNTED_MARK)
}

async function mount(): Promise<void> {
  const { selectBridge } = await bootImport(() => import('./bridges/select'))
  const surface = document.body.dataset['surface']
  const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
  if (rootElement === null) {
    throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
  }
  const isTasks = surface === 'tasks'
  const tasks = isTasks
    ? await bootImport(() => import('../shared/tasksProtocol'), 'tasks')
    : undefined
  const host = await selectBridge(
    {
      outgoing: tasks?.tasksWebviewMessageSchema ?? webviewToHostMessageSchema,
      incoming: tasks?.tasksHostMessageSchema ?? panelToPanelPayloadSchema,
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
    const { connectCompanionUi } = await bootImport(
      () => import('./bridges/companionUi'),
      'companion',
    )
    await connectCompanionUi(host, reportBridgeFailure)
  }
  // The theme consumer mounts before the panel so the first paint already
  // carries the host's roles; a refused snapshot leaves the generated
  // palette in place and is reported, never painted half-way.
  const page = new AbortController()
  window.addEventListener(
    'pagehide',
    () => {
      page.abort()
    },
    { once: true },
  )
  await loadThemeBridge(
    document.documentElement,
    panelThemePort(host.messages, window.matchMedia('(prefers-color-scheme: dark)').matches),
    () => {
      reportBridgeFailure(new Error('MHP_PANEL_THEME_INVALID'))
    },
    page.signal,
  )
  if (isTasks) {
    const tableError = installEmbeddedTable(document)
    if (tableError !== undefined) throw tableError
    const { TasksApp } = await bootImport(() => import('./TasksApp'), 'tasks')
    createRoot(rootElement).render(
      <TasksApp
        messages={host.messages}
        postMessage={(message) => {
          host.post(message)
        }}
      />,
    )
  } else {
    mountChat(rootElement, portableChatBridge(host), reportBridgeFailure, markChatMounted)
  }
}

/**
The chat app's bridge over the MHP panel wire. The wire carries the shared
chat payloads only: the estimator's lazy channel (M117) and team-tree
actions are not MHP 1.5 panel payloads, so they are refused here, before
the wire codec. An estimator request is answered at once the way VS Code
answers when its estimator boundary is unavailable, so no run waits on a
reply that cannot come; anything else off the wire throws as the codec does.
Theme frames are the theme port's, never the chat store's.
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
  panel.messages.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (panelThemePayloadSchema.safeParse(event.data).success) return
    deliver(event.data)
  })
  const refuseEstimator = (requestId: string | undefined) => {
    const correlation = requestId === undefined ? {} : { requestId }
    const diagnostic = { estimateDiagnostic: 'estimate-unavailable' } as const
    const refusals: readonly (HostToEstimatorMessage | HostToWebviewMessage)[] = [
      { type: 'estimatorFailure', ...correlation, diagnostic },
      { type: 'estimatorStarted', ...correlation, diagnostic },
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

void mount().catch(() => {
  showBridgeFailure(document)
})
