// VS Code's webview entry: mounts each surface and connects the chat to
// VS Code through the host bridge (hostBridge.ts, M61; the mount itself is
// chat.tsx, shared with the portable entry, M104 lane D). The display
// language's table goes in before anything reads the text (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { UnavailableSurface } from './components/DeferredSurface'
import { webviewErrorReport } from './errorReport'
import { vsCodeHostBridge } from './hostBridge'
import { mountNodeSurface } from './bridges/nodeSurface'
import { mountChat } from './chat'
import { installEmbeddedTable } from './installTable'
import './styles.css'

// The Devices document (its webview state, the QR chunks, the bridge) lives in
// the lazy Devices chunk: no surface's startup carries any of it.
const DevicesSurface = lazy(async () => {
  try {
    const { DevicesSurface } = await import('./models/sections/agents/DevicesApp')
    return { default: DevicesSurface }
  } catch (error: unknown) {
    vsCodeHostBridge(window).post(webviewErrorReport('promise', error))
    return { default: DevicesUnavailable }
  }
})

const TasksApp = lazy(async () => {
  const { TasksApp } = await import('./TasksApp')
  return { default: TasksApp }
})

// This module's own resolved URL (M93): the report's frames name only
// locations inside main.js, as the package path, never the URL (which holds
// the install folder). Frames in its hashed chunks are left out.
const ownScriptUrl = import.meta.url

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

switch (document.body.dataset['surface']) {
  case 'devices': {
    mountDevices(rootElement)
    break
  }
  case 'node': {
    const tableError = installEmbeddedTable(document)
    if (tableError !== undefined) throw tableError
    void mountNodeSurface(rootElement, ownScriptUrl)
    break
  }
  case 'tasks': {
    mountTasks(rootElement)
    break
  }
  default: {
    mountChat(rootElement, vsCodeHostBridge(window))
  }
}

function DevicesUnavailable() {
  return (
    <main className="body">
      <UnavailableSurface isModal={false} failed className="gate" />
    </main>
  )
}

function mountDevices(element: Element): void {
  const api = acquireVsCodeApi()
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) throw tableError
  createRoot(element).render(
    <Suspense
      fallback={
        <main>
          <p role="status">{UI_TEXT.loadingOutput}</p>
        </main>
      }
    >
      <DevicesSurface api={api} />
    </Suspense>,
  )
}

function mountTasks(element: Element): void {
  const api = acquireVsCodeApi()
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) {
    throw tableError
  }
  createRoot(element).render(
    <Suspense
      fallback={
        <main className="todo-surface">
          <header className="todo-tab-header">
            <h1>{UI_TEXT.todoTitle}</h1>
          </header>
          <p role="status">{UI_TEXT.loadingOutput}</p>
        </main>
      }
    >
      <TasksApp
        messages={window}
        postMessage={(message) => {
          api.postMessage(message)
        }}
      />
    </Suspense>,
  )
}
