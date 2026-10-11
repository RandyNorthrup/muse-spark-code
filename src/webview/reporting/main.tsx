// Separate page entry: the chat's startup and deferred chunks import none of this UI.
import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import { installEmbeddedTable } from '../installTable'
import { ReportApp, type ReportingBridge } from './ReportApp'
import './styles.css'

const tableError = installEmbeddedTable(document)
if (tableError !== undefined) throw tableError
const element = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (element === null) throw new Error('Reporting page root is missing')
const api = acquireVsCodeApi()
const bridge: ReportingBridge = {
  messages: window,
  post: (message) => {
    api.postMessage(message)
  },
}
createRoot(element).render(<ReportApp bridge={bridge} />)
