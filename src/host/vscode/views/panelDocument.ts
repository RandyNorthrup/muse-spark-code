// What a webview panel tab shows, shared by the panels that mount a
// verified bundle of their own (Models & Agents, the judge setup wizard):
// the bundle's document with only its own folder readable, the fixed
// failure page when the bundle did not verify, and the one way a page
// opens a link the person clicked.
import * as vscode from 'vscode'
import { UI_TEXT } from '../../../shared/constants'
import { buildWebviewHtml, createNonce } from '../../html'
import type { UiTable } from '../../l10n'

/** The page's script and sheet as the webview reads them, below its verified folder. */
export interface PanelPageUris {
  readonly scriptUri: string
  readonly styleUri: string
}

/** The verified bundle's document: scripts on, only the bundle's own folder (`root`) readable. */
export function showPanelDocument(
  panel: vscode.WebviewPanel,
  root: vscode.Uri,
  page: PanelPageUris,
  l10n: UiTable,
): void {
  panel.webview.options = { enableScripts: true, localResourceRoots: [root] }
  panel.webview.html = buildWebviewHtml({
    ...page,
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
