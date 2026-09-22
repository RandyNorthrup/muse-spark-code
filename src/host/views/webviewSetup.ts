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
} from '../../shared/protocol'
import { buildWebviewHtml, createNonce } from '../html'
import type { Logger } from '../logger'

export interface WebviewHostContext {
  readonly extensionUri: vscode.Uri
  readonly extensionVersion: string
  readonly log: Logger
  readonly getSettings: () => SettingsSnapshot
  readonly onInputFocusChanged: (surface: ChatSurface, isFocused: boolean) => void
  readonly onOpenNewTab: () => void
}

/** One chat UI instance (the sidebar view or one editor panel). */
export interface ChatSurface extends vscode.Disposable {
  readonly id: string
  post(message: HostToWebviewMessage): void
  /** Bring the surface into view and give it keyboard focus. */
  reveal(): void
}

export interface SurfaceOptions {
  readonly id: string
  readonly reveal: () => void
}

function buildInitMessage(context: WebviewHostContext): HostToWebviewMessage {
  return {
    type: 'init',
    extensionVersion: context.extensionVersion,
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
  webview.html = buildWebviewHtml({
    scriptUri: webview
      .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_SCRIPT_FILE))
      .toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_STYLE_FILE)).toString(),
    cspSource: webview.cspSource,
    nonce: createNonce(),
  })

  const surface: ChatSurface = {
    id: options.id,
    post(message) {
      void webview.postMessage(message)
    },
    reveal: options.reveal,
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
    switch (parsed.message.type) {
      case 'ready': {
        surface.post(buildInitMessage(context))
        break
      }
      case 'inputFocusChanged': {
        context.onInputFocusChanged(surface, parsed.message.focused)
        break
      }
      case 'openNewTab': {
        context.onOpenNewTab()
        break
      }
    }
  })

  return surface
}
