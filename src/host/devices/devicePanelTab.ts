// M100 phase 2 (lane W): the production Devices tab. One live tab for the
// Devices surface: opening it never loads the bundle, and the first host
// message does (through the shared lazy port). Unparsable webview traffic
// is logged and ignored; service refusals already carry their typed setup
// failure for the recovery UI.
import * as vscode from 'vscode'
import {
  DEVICES_PANEL_VIEW_TYPE,
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
  WEBVIEW_SCRIPT_FILE,
  WEBVIEW_STYLE_FILE,
} from '../../shared/constants'
import type { DeviceHostMessage } from '../../shared/devicesPanel'
import { buildWebviewHtml, createNonce } from '../html'
import { logRejection } from '../logger'
import type { WebviewHostContext } from '../views/webviewSetup'

/** The lazily loaded device service behind this tab; construction loads nothing. */
export interface DevicesPanelService {
  request(input: unknown, signal?: AbortSignal): Promise<DeviceHostMessage>
}

export class DevicesPanelTab implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private isReady = false

  public constructor(
    private readonly context: Pick<WebviewHostContext, 'extensionUri' | 'l10n' | 'log'>,
    private readonly service: () => Promise<DevicesPanelService>,
    private readonly onDisposed?: () => void,
  ) {}

  private send(message: DeviceHostMessage): void {
    if (!this.isReady || this.panel === undefined) return
    void this.panel.webview.postMessage(message)
  }

  public open(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(undefined, false)
      return
    }
    const bundleRoot = vscode.Uri.joinPath(this.context.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
    const panel = vscode.window.createWebviewPanel(
      DEVICES_PANEL_VIEW_TYPE,
      UI_TEXT.devices.title,
      vscode.ViewColumn.Beside,
      {},
    )
    this.panel = panel
    this.isReady = false
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
      l10n: this.context.l10n,
      surface: 'devices',
    })
    const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
      // Readiness only: the document announces itself with `devicesReady`
      // (replayed observations follow through the same reply). The service
      // still strictly parses every message before use.
      if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'devicesReady') {
        this.isReady = true
      }
      const deliver = async (): Promise<void> => {
        const service = await this.service()
        this.send(await service.request(raw))
      }
      void deliver().catch(logRejection(this.context.log, 'devices request'))
    })
    panel.onDidDispose(() => {
      subscription.dispose()
      this.panel = undefined
      this.isReady = false
      this.onDisposed?.()
    })
  }

  /** Host-side pushes (observations, grant prompts) reach the document. */
  public publish(message: DeviceHostMessage): void {
    this.send(message)
  }

  public dispose(): void {
    this.panel?.dispose()
  }
}
