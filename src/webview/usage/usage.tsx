import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { parseUsageServiceToPageMessage } from '../../shared/usagePage'
import { hostBridgeFactory, type HostBridgeKind } from '../hostBridge'
import { installEmbeddedTable } from '../installTable'
import { httpHostBridge, type HttpUsagePort } from '../hostBridges/httpHostBridge'
import { jcefHostBridge } from '../hostBridges/jcefHostBridge'
import { swtHostBridge } from '../hostBridges/swtHostBridge'
import { webView2HostBridge, type WebView2UsagePort } from '../hostBridges/webView2HostBridge'
import type { NativeUsagePort } from '../hostBridges/usageBridge'
import { installUsageTable } from './installUsageTable'
import { UsageApp } from './UsageApp'
import './usage.css'

declare global {
  interface Window {
    /** Real transports installed by the companion/native host before this entry. */
    museUsageHostPorts?: {
      readonly http?: HttpUsagePort
      readonly jcef?: NativeUsagePort
      readonly webView2?: WebView2UsagePort
      readonly swt?: NativeUsagePort
    }
  }
}
class UsageBoundary extends Component<
  { readonly children: ReactNode },
  { readonly crashed: boolean }
> {
  static getDerivedStateFromError() {
    return { crashed: true }
  }
  override state = { crashed: false }
  override render() {
    return this.state.crashed ? <Unavailable code="readFailed" /> : this.props.children
  }
}
function Unavailable({
  code = 'unsupported',
}: {
  readonly code?: 'unsupported' | 'readFailed' | 'invalidMessage'
}) {
  return (
    <main className="usage-page">
      <h1>{USAGE_TEXT.title}</h1>
      <p role="alert">{USAGE_TEXT[code]}</p>
      <button
        type="button"
        onClick={() => {
          window.location.reload()
        }}
      >
        {USAGE_TEXT.retry}
      </button>
    </main>
  )
}
function bridgeKind(value: string | undefined): HostBridgeKind {
  switch (value) {
    case undefined:
    case 'vscode': {
      return 'vscode'
    }
    case 'http':
    case 'jcef':
    case 'webView2':
    case 'swt': {
      return value
    }
    default: {
      throw new TypeError('Unsupported usage host')
    }
  }
}
const element = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (element === null) throw new TypeError('Missing usage root')
const root = createRoot(element)
let isInvalidTable = installEmbeddedTable(document) !== undefined
const tableElement = document.querySelector('#muse-usage-l10n')
if (tableElement !== null) {
  try {
    const data: unknown = JSON.parse(tableElement.textContent)
    const parsed = parseUsageServiceToPageMessage(data)
    isInvalidTable ||=
      !parsed.ok ||
      parsed.message.type !== 'usage/table' ||
      installUsageTable(parsed.message) !== undefined
  } catch {
    isInvalidTable = true
  }
}
try {
  const { http, jcef, webView2, swt } = window.museUsageHostPorts ?? {}
  const create = hostBridgeFactory(window, {
    ...(http !== undefined && { http: () => httpHostBridge(http) }),
    ...(jcef !== undefined && { jcef: () => jcefHostBridge(jcef) }),
    ...(webView2 !== undefined && { webView2: () => webView2HostBridge(webView2) }),
    ...(swt !== undefined && { swt: () => swtHostBridge(swt) }),
  })
  const host = create(bridgeKind(document.body.dataset['hostBridge']))
  root.render(
    <UsageBoundary>
      {isInvalidTable ? <Unavailable code="invalidMessage" /> : <UsageApp host={host} />}
    </UsageBoundary>,
  )
} catch {
  root.render(<Unavailable />)
}
