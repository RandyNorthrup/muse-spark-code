// Shared wiring for both webview surfaces (sidebar view and editor panel):
// options, HTML with a fresh CSP nonce, the inbound message handler, and the
// `ChatSurface` handle (chatSurface.ts) the rest of the host uses to talk back.

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
} from '../../shared/protocol'
import { buildWebviewHtml, createNonce } from '../html'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'
import type { ChatSurface, ConversationMessage } from './chatSurface'
import { webviewErrorLog } from './webviewErrors'

export interface WebviewHostContext {
  readonly extensionUri: vscode.Uri
  /** The display language's table, installed at activation, for every webview's HTML (D33). */
  readonly l10n: UiTable
  readonly log: Logger
  readonly getSettings: () => SettingsSnapshot
  readonly onInputFocusChanged: (surface: ChatSurface, isFocused: boolean) => void
  /** The webview mounted and received `init`; push the conversation state. */
  readonly onSurfaceReady: (surface: ChatSurface) => void
  readonly onConversationMessage: (surface: ChatSurface, message: ConversationMessage) => void
}

export interface SurfaceOptions {
  readonly id: string
  /** The session id a deserialized panel stored; undefined for a new surface. */
  readonly restoredSessionId: string | undefined
  readonly reveal: () => void
  readonly markUnread: () => void
  readonly setTitle: (title: string) => void
  /** The document gained focus (M25): the surface the keybindings act on. */
  readonly onFocused: (surface: ChatSurface) => void
}

/**
 * Whether a message ends the restore a panel is owed (M25): a session is
 * live on the surface (its history went out, or a new one started), or the
 * conversation was cleared (from the panel or a keybinding).
 */
function isRestoreEnding(message: HostToWebviewMessage): boolean {
  return (
    message.type === 'historyLoaded' ||
    message.type === 'conversationCleared' ||
    (message.type === 'sessionInfo' && message.sessionId !== undefined)
  )
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
      l10n: context.l10n,
    })
  }
  applyHtml()

  let restoredSessionId = options.restoredSessionId
  const surface: ChatSurface = {
    id: options.id,
    post(message) {
      if (isRestoreEnding(message)) {
        restoredSessionId = undefined
      }
      void webview.postMessage(message)
    },
    reveal: options.reveal,
    markUnread: options.markUnread,
    setTitle: options.setTitle,
    reload: applyHtml,
    takeRestoredSessionId() {
      return restoredSessionId
    },
    dispose() {
      subscription.dispose()
    },
  }

  const logWebviewError = webviewErrorLog(context.log, Date.now)
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
      case 'surfaceFocused': {
        options.onFocused(surface)
        break
      }
      case 'webviewError': {
        logWebviewError(message)
        break
      }
      default: {
        context.onConversationMessage(surface, message)
      }
    }
  })

  return surface
}
