import * as vscode from 'vscode'
import {
  MAKER_PREVIEW_SCRIPT_FILE,
  MAKER_PREVIEW_STYLE_FILE,
  MAKER_PREVIEW_VIEW_TYPE,
  MAKER_PROTOCOL_VERSION,
  WEBVIEW_DIST_SEGMENTS,
  UI_TEXT,
} from '../../shared/constants'
import {
  makerHostMessageSchema,
  makerPreviewSchema,
  makerSurfaceMessageSchema,
  type MakerPreview,
} from '../../shared/makerProtocol'
import { buildWebviewHtml, createNonce } from '../html'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'

export interface MakerPreviewPanelDeps {
  readonly extensionUri: vscode.Uri
  readonly l10n: UiTable
  readonly log: Logger
  readonly stop: (machineId?: string) => Promise<void>
}

/** U's separate preview page. The page cannot submit an approval or an action. */
export class MakerPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private preview: MakerPreview | undefined
  private isReady = false
  private isDisposed = false
  constructor(private readonly deps: MakerPreviewPanelDeps) {}

  private async send(): Promise<void> {
    if (!this.isReady || this.panel === undefined || this.preview === undefined) return
    const message = makerHostMessageSchema.parse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerPreview',
      preview: this.preview,
    })
    await this.panel.webview.postMessage(message)
  }
  async open(raw: MakerPreview): Promise<void> {
    if (this.isDisposed) throw new Error(UI_TEXT.makerUnavailable)
    const preview = makerPreviewSchema.parse(raw)
    this.preview = preview
    if (this.panel !== undefined) {
      this.panel.title = preview.title
      this.panel.reveal(undefined, false)
      await this.send()
      return
    }
    const bundleRoot = vscode.Uri.joinPath(this.deps.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
    const panel = vscode.window.createWebviewPanel(
      MAKER_PREVIEW_VIEW_TYPE,
      preview.title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, enableCommandUris: false, localResourceRoots: [bundleRoot] },
    )
    this.panel = panel
    this.isReady = false
    panel.webview.html = buildWebviewHtml({
      scriptUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, MAKER_PREVIEW_SCRIPT_FILE))
        .toString(),
      styleUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, MAKER_PREVIEW_STYLE_FILE))
        .toString(),
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      l10n: this.deps.l10n,
    })
    const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = makerSurfaceMessageSchema.safeParse(raw)
      if (!message.success || this.panel !== panel) return
      if (message.data.type === 'makerStop') {
        // Independent of readiness, trust, the switch and any pending turn.
        void this.deps.stop(message.data.machineId).catch(() => {
          this.deps.log.error('Maker preview Stop failed')
        })
      } else if (message.data.type === 'makerReady') {
        this.isReady = true
        void this.send().catch(() => {
          this.deps.log.error('Maker preview update failed')
        })
      }
    })
    panel.onDidDispose(() => {
      subscription.dispose()
      if (this.panel !== panel) {
        return
      }

      this.panel = undefined
      this.isReady = false
    })
  }
  dispose(): void {
    this.isDisposed = true
    this.panel?.dispose()
    this.preview = undefined
  }
}
