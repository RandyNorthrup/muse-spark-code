// Shared wiring for both webview surfaces (sidebar view and editor panel):
// options, HTML with a fresh CSP nonce, and the inbound message handler.

import * as vscode from 'vscode'
import {
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
  WEBVIEW_SCRIPT_FILE,
  WEBVIEW_STYLE_FILE,
} from '../../shared/constants'
import { type HostToWebviewMessage, parseWebviewToHostMessage } from '../../shared/protocol'
import { buildWebviewHtml, createNonce } from '../html'

export interface WebviewHostContext {
  readonly extensionUri: vscode.Uri
  readonly extensionVersion: string
  readonly log: vscode.LogOutputChannel
}

function buildInitMessage(context: WebviewHostContext): HostToWebviewMessage {
  return {
    type: 'init',
    extensionVersion: context.extensionVersion,
    emptyStateHint: UI_TEXT.emptyStateHint,
    composerPlaceholder: UI_TEXT.composerPlaceholder,
  }
}

/**
 * Configures `webview` and starts handling its messages. The returned
 * disposable stops the message handling; callers tie it to the owning view's
 * or panel's `onDidDispose`.
 */
export function configureWebview(
  webview: vscode.Webview,
  context: WebviewHostContext,
): vscode.Disposable {
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

  return webview.onDidReceiveMessage((raw: unknown) => {
    const parsed = parseWebviewToHostMessage(raw)
    if (!parsed.ok) {
      context.log.warn(`Dropped malformed webview message: ${parsed.error}`)
      return
    }
    // `ready` is the only inbound message type today; a `switch` on
    // `parsed.message.type` replaces this line when a second type lands.
    void webview.postMessage(buildInitMessage(context))
  })
}
