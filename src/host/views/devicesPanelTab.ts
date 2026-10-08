// M100 phase 2 (lane W): the production Devices tab. One live tab for the
// Devices surface: opening it never loads the bundle, and the first host
// message does (through the shared lazy port). Unparsable webview traffic
// is logged and ignored; service refusals already carry their typed setup
// failure for the recovery UI.
import type * as vscode from 'vscode'
import { DEVICES_PANEL_VIEW_TYPE, UI_TEXT } from '../../shared/constants'
import type { DeviceHostMessage } from '../../shared/devicesPanel'
import { logRejection } from '../logger'
import { createAuxWebviewPanel } from './auxWebviewPanel'
import type { WebviewHostContext } from './webviewSetup'

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
    const panel = createAuxWebviewPanel(
      this.context,
      DEVICES_PANEL_VIEW_TYPE,
      UI_TEXT.devices.title,
      'devices',
    )
    this.panel = panel
    this.isReady = false
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
