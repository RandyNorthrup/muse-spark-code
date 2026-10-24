// Webview entry: mounts the React app and connects it to VS Code through the
// host bridge (hostBridge.ts, M61). The UI store lives here, outside the
// error boundary (M25): it starts from the conversation this panel saved in
// VS Code's webview state, keeps reducing host messages while the crash
// screen shows, and is saved again (throttled, and at once before a reload)
// so the crash screen's Reload comes back with the conversation. The display
// language's table goes in before anything reads the text (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { vsCodeHostBridge } from './hostBridge'
import { mountNodeSurface } from './node/nodeSurface'
import { installEmbeddedTable } from './installTable'
import { mountChat } from './chat'
import './portableTokens.css'
import './styles.css'

const TasksApp = lazy(async () => {
  const { TasksApp } = await import('./TasksApp')
  return { default: TasksApp }
})

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

// The node surface's own resolved URL: the workspace asset resolves against
// this module, as the package path, never the install folder URL.
const ownScriptUrl = import.meta.url

if (document.body.dataset['surface'] === 'node') {
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) throw tableError
  void mountNodeSurface(rootElement, ownScriptUrl)
} else if (document.body.dataset['surface'] === 'tasks') {
  mountTasks(rootElement)
} else {
  mountChat(rootElement, vsCodeHostBridge(window))
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
