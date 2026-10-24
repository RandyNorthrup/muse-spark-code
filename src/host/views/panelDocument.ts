// What a webview panel tab shows, shared by the panels that mount a
// verified bundle of their own (Models & Agents, the judge setup wizard):
// the bundle's document with only its own folder readable, the fixed
// failure page when the bundle did not verify, and the one way a page
// opens a link the person clicked.
import * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { buildWebviewHtml, createNonce } from '../html'
import type { UiTable } from '../l10n'

/** The bundle's two files below its verified folder. */
export interface PanelBundleFiles {
  readonly script: string
  readonly style: string
}

/** The verified bundle's document: scripts on, only the bundle's own folder readable. */
export function showPanelDocument(
  panel: vscode.WebviewPanel,
  dir: string,
  files: PanelBundleFiles,
  l10n: UiTable,
): void {
  const root = vscode.Uri.file(dir)
  panel.webview.options = { enableScripts: true, localResourceRoots: [root] }
  panel.webview.html = buildWebviewHtml({
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, files.script)).toString(),
    styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, files.style)).toString(),
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    l10n,
  })
}

/** No verified bundle: the fixed failure sentence, and nothing readable. */
export function showPanelFailure(panel: vscode.WebviewPanel, html: string): void {
  panel.webview.options = { enableScripts: true, localResourceRoots: [] }
  panel.webview.html = html
}

/** A link a page asked to open: http(s) only, never with credentials in it. */
export async function openPanelLink(link: string): Promise<void> {
  const url = new URL(link)
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(UI_TEXT.actionFailed)
  }
  await vscode.env.openExternal(vscode.Uri.parse(url.href))
}
