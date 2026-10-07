// The webview's one way to its host (M61, PLAN.md D60): posting to it, the
// state a reload comes back with, and where its messages arrive. VS Code's
// bridge wraps `acquireVsCodeApi()`, which a webview may call only once, and
// takes the host's messages as `message` events on the window. Another host
// (a JCEF or WebView2 panel) supplies a bridge of its own and the app does
// not change.

import type { PanelToHostMessage } from '../shared/modelsPanel'
import type { WebviewToHostMessage } from '../shared/protocol'
import type { WebviewState } from './state/snapshot'

/** Where the host's messages arrive: `message` events whose `data` is the message. */
export type MessageSource = Pick<Window, 'addEventListener' | 'removeEventListener'>

export interface HostBridge {
  /**
   * Posts to the host. The chat panel's messages and the Models & Agents
   * panel's (M95) share this bridge; each side validates what it receives.
   */
  post(message: WebviewToHostMessage | PanelToHostMessage): void
  /** The state saved before the document last went away, unvalidated (`restoredUiState` checks it). */
  savedState(): unknown
  saveState(state: WebviewState): void
  readonly messages: MessageSource
}

/** VS Code's bridge; `messages` is the window VS Code posts the host's messages to. */
export function vsCodeHostBridge(messages: MessageSource): HostBridge {
  const api = acquireVsCodeApi()
  return {
    post: (message) => {
      api.postMessage(message)
    },
    savedState: () => api.getState(),
    saveState: (state) => {
      api.setState(state)
    },
    messages,
  }
}
