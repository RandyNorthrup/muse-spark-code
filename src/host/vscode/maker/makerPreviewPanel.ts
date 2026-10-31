import { createHash } from 'node:crypto'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import {
  MAKER_PREVIEW_SCRIPT_FILE,
  MAKER_PREVIEW_STYLE_FILE,
  MAKER_PREVIEW_VIEW_TYPE,
  MAKER_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../../shared/constants'
import {
  makerHostMessageSchema,
  makerApprovalRequestSchema,
  makerPreviewSchema,
  makerSurfaceMessageSchema,
  type MakerPreview,
  type ApprovalRequest,
} from '../../../shared/makerProtocol'
import { failureForLog } from '../../../core/backends/musecode/logText'
import { buildWebviewHtml, createNonce } from '../../html'
import type { UiTable } from '../../l10n'
import type { Logger } from '../../logger'
import { MakerApprovalReceipt } from '../../maker/makerApprovalReceipt'
import { webviewBundleErrorHtml } from '../../views/webviewBundle'
import { resolveWebviewBundleDir, WebviewBundleError } from '../../views/webviewBundleRoot'

export interface MakerPreviewPanelDeps {
  readonly extensionUri: vscode.Uri
  /** Where the packed webview archive is extracted (VSIXWEB), as the other panels do. */
  readonly globalStoragePath: string
  readonly l10n: UiTable
  readonly log: Logger
  readonly stop: (machineId?: string) => Promise<void>
}

/** Host-owned native-preview handshake; this does not extend MakerHost's wire. */
const approvalPreviewMessage = z.strictObject({
  v: z.literal(MAKER_PROTOCOL_VERSION),
  type: z.literal('makerApprovalPreview'),
  request: makerApprovalRequestSchema,
})
const renderedMessage = z.strictObject({
  v: z.literal(MAKER_PROTOCOL_VERSION),
  type: z.literal('makerPreviewRendered'),
  id: z.uuid(),
  digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
})
export type MakerApprovalPreview = MakerApprovalReceipt

/** U's separate preview page. The page cannot submit an approval or an action. */
export class MakerPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private readonly approvals = new Map<string, vscode.WebviewPanel>()
  private readonly approvalIds = new Set<string>()
  private preview: MakerPreview | undefined
  private isReady = false
  private isDisposed = false
  constructor(private readonly deps: MakerPreviewPanelDeps) {}

  private createPanel(title: string): vscode.WebviewPanel {
    let bundleRoot: vscode.Uri
    try {
      bundleRoot = vscode.Uri.file(
        resolveWebviewBundleDir({
          extensionPath: this.deps.extensionUri.fsPath,
          globalStoragePath: this.deps.globalStoragePath,
        }),
      )
    } catch (error: unknown) {
      if (!(error instanceof WebviewBundleError)) throw error
      this.deps.log.error(`Maker preview webview bundle failed: ${failureForLog(error)}`)
      const failed = vscode.window.createWebviewPanel(
        MAKER_PREVIEW_VIEW_TYPE,
        title,
        vscode.ViewColumn.Beside,
        { enableScripts: false, enableCommandUris: false, localResourceRoots: [] },
      )
      failed.webview.html = webviewBundleErrorHtml(
        UI_TEXT.webviewBundleUnavailable,
        this.deps.l10n.locale,
      )
      return failed
    }
    const panel = vscode.window.createWebviewPanel(
      MAKER_PREVIEW_VIEW_TYPE,
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, enableCommandUris: false, localResourceRoots: [bundleRoot] },
    )
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
    return panel
  }

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
    const panel = this.createPanel(preview.title)
    this.panel = panel
    this.isReady = false
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

  async openApproval(
    raw: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<MakerApprovalPreview | undefined> {
    const request = makerApprovalRequestSchema.parse(raw)
    if (this.isDisposed || signal.aborted || this.approvalIds.has(request.id)) return undefined
    const payload = request.kind === 'serial' ? request.payload.value : request.payload
    const digest = createHash('sha256')
      .update(
        request.kind === 'serial' && request.payload.encoding === 'hex'
          ? Buffer.from(payload, 'hex')
          : payload,
      )
      .digest('hex')
    if (digest !== request.digest) return undefined
    const message = approvalPreviewMessage.parse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerApprovalPreview',
      request,
    })
    const panel = this.createPanel(UI_TEXT.makerPayloadLabel)
    this.approvalIds.add(request.id)
    this.approvals.set(request.id, panel)
    const receipt = new MakerApprovalReceipt(request.id, digest, () => {
      panel.dispose()
    })
    let isReady = false
    let isDelivered = false
    return await new Promise<MakerApprovalPreview | undefined>((resolve) => {
      const dispose = () => {
        receipt.dispose()
      }
      const complete = () => {
        if (isDelivered && receipt.canSend(request.id, digest)) resolve(receipt)
      }
      const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
        if (receipt.signal.aborted) return
        const acknowledgement = renderedMessage.safeParse(raw)
        if (acknowledgement.success) {
          if (isReady) receipt.rendered(acknowledgement.data.id, acknowledgement.data.digest)
          else receipt.revoke()
          complete()
          return
        }
        const incoming = makerSurfaceMessageSchema.safeParse(raw)
        if (!incoming.success) {
          receipt.revoke()
          return
        }
        if (incoming.data.type === 'makerStop') {
          receipt.revoke()
          void this.deps.stop(incoming.data.machineId).catch(() => {
            this.deps.log.error('Maker preview Stop failed')
          })
        } else if (incoming.data.type === 'makerReady') {
          if (isReady) {
            dispose()
            return
          }
          isReady = true
          void Promise.resolve(panel.webview.postMessage(message))
            .then((accepted) => {
              if (accepted) {
                isDelivered = true
                complete()
              } else dispose()
            })
            .catch(() => {
              this.deps.log.error('Maker preview update failed')
              dispose()
            })
        }
      })
      panel.onDidDispose(() => {
        subscription.dispose()
        signal.removeEventListener('abort', dispose)
        this.approvals.delete(request.id)
        receipt.revoke()
        resolve(undefined)
      })
      receipt.signal.addEventListener(
        'abort',
        () => {
          panel.dispose()
          resolve(undefined)
          void Promise.resolve(
            vscode.window.showWarningMessage(UI_TEXT.makerPreviewWithdrawn),
          ).catch(() => {
            this.deps.log.error('Maker notice failed')
          })
        },
        { once: true },
      )
      signal.addEventListener('abort', dispose, { once: true })
      if (signal.aborted) dispose()
    })
  }
  dispose(): void {
    this.isDisposed = true
    this.panel?.dispose()
    for (const panel of this.approvals.values()) panel.dispose()
    this.preview = undefined
  }
}
