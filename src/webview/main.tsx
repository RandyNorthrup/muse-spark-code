// VS Code entry. Bridge selection is fixed here at build time; portable hosts
// load portable/main.js. Chat still mounts synchronously in the same task.
import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { mountChat } from './chat'
import { vsCodeHostBridge } from './hostBridge'
import { installEmbeddedTable } from './installTable'
import './tokens.css'
import './styles.css'

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

if (document.body.dataset['surface'] === 'tasks') {
  void mountTasks(rootElement)
} else {
  mountChat(rootElement, vsCodeHostBridge(window))
}

async function mountTasks(element: Element): Promise<void> {
  const api = acquireVsCodeApi()
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) throw tableError
  const { TasksApp } = await import('./TasksApp')
  createRoot(element).render(
    <TasksApp
      messages={window}
      postMessage={(message) => {
        api.postMessage(message)
      }}
    />,
  )
}
