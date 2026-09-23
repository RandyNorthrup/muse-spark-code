// Shared wiring for both webview surfaces (sidebar view and editor panel):
// options, HTML with a fresh CSP nonce, the inbound message handler, and the
// `ChatSurface` handle the rest of the host uses to talk back.

import * as vscode from 'vscode'
import {
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
  WEBVIEW_SCRIPT_FILE,
  WEBVIEW_STYLE_FILE,
} from '../../shared/constants'
import {
  type HostToWebviewMessage,
  parseWebviewToHostMessage,
  type SettingsSnapshot,
  type WebviewToHostMessage,
} from '../../shared/protocol'
import { buildWebviewHtml, createNonce } from '../html'
import type { Logger } from '../logger'

/** Messages about the conversation itself, routed to the surface's controller. */
export type ConversationMessage = Exclude<
  WebviewToHostMessage,
  { type: 'ready' } | { type: 'inputFocusChanged' }
>

export interface WebviewHostContext {
  readonly extensionUri: vscode.Uri
  readonly log: Logger
  readonly getSettings: () => SettingsSnapshot
  readonly onInputFocusChanged: (surface: ChatSurface, isFocused: boolean) => void
  /** The webview mounted and received `init`; push the conversation state. */
  readonly onSurfaceReady: (surface: ChatSurface) => void
  readonly onConversationMessage: (surface: ChatSurface, message: ConversationMessage) => void
}

/** One chat UI instance (the sidebar view or one editor panel). */
export interface ChatSurface extends vscode.Disposable {
  readonly id: string
  post(message: HostToWebviewMessage): void
  /** Bring the surface into view and give it keyboard focus. */
  reveal(): void
  /** The conversation needs the user (turn done, approval, question): mark it when hidden (M6). */
  markUnread(): void
  /** The conversation's name, shown on the tab or beside the view name (M6). */
  setTitle(title: string): void
  /** Rebuild the document with a fresh nonce (the error boundary's Reload, M11). */
  reload(): void
  /**
   * The session a panel held before the window reloaded (D15), handed out
   * once: the first `ready` resumes it, a later one (the boundary's Reload)
   * must not bring back a conversation the user has since cleared.
   */
  takeRestoredSessionId(): string | undefined
}

export interface SurfaceOptions {
  readonly id: string
  /** The session id a deserialized panel stored; undefined for a new surface. */
  readonly restoredSessionId: string | undefined
  readonly reveal: () => void
  readonly markUnread: () => void
  readonly setTitle: (title: string) => void
}

function buildInitMessage(context: WebviewHostContext): HostToWebviewMessage {
  return {
    type: 'init',
    emptyStateHint: UI_TEXT.emptyStateHint,
    composerPlaceholder: UI_TEXT.composerPlaceholder,
    settings: context.getSettings(),
  }
}

/**
 * Configures `webview` and starts handling its messages. Disposing the
 * returned surface stops the message handling; callers tie it to the owning
 * view's or panel's `onDidDispose`.
 */
export function configureWebview(
  webview: vscode.Webview,
  context: WebviewHostContext,
  options: SurfaceOptions,
): ChatSurface {
  const bundleRoot = vscode.Uri.joinPath(context.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
  webview.options = { enableScripts: true, localResourceRoots: [bundleRoot] }
  const applyHtml = () => {
    webview.html = buildWebviewHtml({
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_SCRIPT_FILE))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_STYLE_FILE))
        .toString(),
      cspSource: webview.cspSource,
      nonce: createNonce(),
    })
  }
  applyHtml()

  let restoredSessionId = options.restoredSessionId
  const surface: ChatSurface = {
    id: options.id,
    post(message) {
      void webview.postMessage(message)
    },
    reveal: options.reveal,
    markUnread: options.markUnread,
    setTitle: options.setTitle,
    reload: applyHtml,
    takeRestoredSessionId() {
      const sessionId = restoredSessionId
      restoredSessionId = undefined
      return sessionId
    },
    dispose() {
      subscription.dispose()
    },
  }

  const subscription = webview.onDidReceiveMessage((raw: unknown) => {
    const parsed = parseWebviewToHostMessage(raw)
    if (!parsed.ok) {
      context.log.warn(`Dropped malformed webview message: ${parsed.error}`)
      return
    }
    const { message } = parsed
    switch (message.type) {
      case 'ready': {
        surface.post(buildInitMessage(context))
        context.onSurfaceReady(surface)
        break
      }
      case 'inputFocusChanged': {
        context.onInputFocusChanged(surface, message.focused)
        break
      }
      default: {
        context.onConversationMessage(surface, message)
      }
    }
  })

  return surface
}
