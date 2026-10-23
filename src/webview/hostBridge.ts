import type { ModelAccountsRequest } from '../shared/modelAccountsProtocol'
// The webview's one way to its host (M61, PLAN.md D60): posting to it, the
// state a reload comes back with, and where its messages arrive. VS Code's
// bridge wraps `acquireVsCodeApi()`, which a webview may call only once, and
// takes the host's messages as `message` events on the window. Another host
// (a JCEF or WebView2 panel) supplies a bridge of its own and the app does
// not change.

import type { JudgeSetupPanelToHost } from '../shared/judgeSetupPanel'
import type { PanelToHostMessage } from '../shared/modelsPanel'
import type { VaultClientMessage } from '../shared/hostApi/vaultMessages'
import type { WebviewToHostMessage } from '../shared/protocol'
import type { UsagePageToServiceMessage } from '../shared/usagePage'
import type { WebviewState } from './state/snapshot'

/** Where the host's messages arrive: `message` events whose `data` is the message. */
export type MessageSource = Pick<Window, 'addEventListener' | 'removeEventListener'>

export interface HostBridge {
  /**
  Posts to the host. The chat panel's messages, the Models & Agents
  panel's (M95) and the setup wizard's (M125 lane W) share this bridge;
  each side validates what it receives. The panel's vault section
  (C-M109-1 P1) posts the vault's own messages over the same bridge;
  the host routes them to the vault binding.
  */
  post(
    message:
      | WebviewToHostMessage
      | PanelToHostMessage
      | UsagePageToServiceMessage
      | VaultClientMessage
      | ModelAccountsRequest
      | JudgeSetupPanelToHost,
  ): void
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

/** The host declares its surface; native transports are injected by the host. */
export type HostBridgeKind = 'vscode' | 'http' | 'jcef' | 'webView2' | 'swt'
export type HostBridgeFactory = (kind: HostBridgeKind) => HostBridge
export type NativeHostBridgeFactories = Partial<
  Record<Exclude<HostBridgeKind, 'vscode'>, () => HostBridge>
>

/** Picks a real transport and acquires each API at most once for this document. */
export function hostBridgeFactory(
  messages: MessageSource,
  factories: NativeHostBridgeFactories,
): HostBridgeFactory {
  const bridges = new Map<HostBridgeKind, HostBridge>()
  return (kind) => {
    const existing = bridges.get(kind)
    if (existing !== undefined) return existing
    const factory = kind === 'vscode' ? () => vsCodeHostBridge(messages) : factories[kind]
    if (factory === undefined) throw new TypeError(kind)
    const bridge = factory()
    bridges.set(kind, bridge)
    return bridge
  }
}
