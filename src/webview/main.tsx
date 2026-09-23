// Webview entry: mounts the React app and bridges postMessage to the host.

import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

const vscode = acquireVsCodeApi()
const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

createRoot(rootElement).render(
  <ErrorBoundary
    onReload={() => {
      vscode.postMessage({ type: 'hostAction', action: 'reload' })
    }}
  >
    <App
      postMessage={(message) => {
        vscode.postMessage(message)
      }}
      persistState={(state) => {
        vscode.setState(state)
      }}
    />
  </ErrorBoundary>,
)
