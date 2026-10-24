// One shared constructor for auxiliary editor tabs (tasks, Devices). The
// tab owns its messages and lifetime; this only builds the secured panel
// beside the editor with the right document surface, so the two tabs cannot
// drift apart on options, roots or content security.
import * as vscode from 'vscode'
import {
  WEBVIEW_DIST_SEGMENTS,
  WEBVIEW_SCRIPT_FILE,
  WEBVIEW_STYLE_FILE,
} from '../../../shared/constants'
import { buildWebviewHtml, createNonce } from '../../html'
import type { WebviewHostContext } from './webviewSetup'

/** Both auxiliary tabs show the same secured document for their bundle root. */
export function showAuxWebviewContent(
  panel: vscode.WebviewPanel,
  bundleRoot: vscode.Uri,
  l10n: WebviewHostContext['l10n'],
  surface: 'tasks' | 'devices',
): void {
  panel.webview.options = {
    enableScripts: true,
    enableCommandUris: false,
    localResourceRoots: [bundleRoot],
  }
  panel.webview.html = buildWebviewHtml({
    scriptUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_SCRIPT_FILE))
      .toString(),
    styleUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(bundleRoot, WEBVIEW_STYLE_FILE))
      .toString(),
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    l10n,
    surface,
  })
}

export function createAuxWebviewPanel(
  context: Pick<WebviewHostContext, 'extensionUri' | 'l10n'>,
  viewType: string,
  title: string,
  surface: 'tasks' | 'devices',
): vscode.WebviewPanel {
  const bundleRoot = vscode.Uri.joinPath(context.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
  const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Beside, {})
  showAuxWebviewContent(panel, bundleRoot, context.l10n, surface)
  return panel
}
