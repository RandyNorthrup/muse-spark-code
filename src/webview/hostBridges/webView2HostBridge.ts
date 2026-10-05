import type { HostBridge, MessageSource } from '../hostBridge'
import type { WebviewState } from '../state/snapshot'
import { checkedUsageRequest } from './usageBridge'

export interface WebView2UsagePort {
  /** Bound chrome.webview.postMessage, supplied by the native document host. */
  readonly postMessage: (message: unknown) => void
  readonly messages: MessageSource
  readonly savedState: () => unknown
  readonly saveState: (state: WebviewState) => void
}

export function webView2HostBridge(port: WebView2UsagePort): HostBridge {
  return {
    post: (message) => {
      port.postMessage(checkedUsageRequest(message))
    },
    savedState: () => port.savedState(),
    saveState: (state) => {
      port.saveState(state)
    },
    messages: port.messages,
  }
}
