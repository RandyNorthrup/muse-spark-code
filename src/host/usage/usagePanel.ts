import * as vscode from 'vscode'
import {
  SETTINGS_SECTION,
  UI_TEXT,
  VSCODE_COMMANDS,
  WEBVIEW_DIST_SEGMENTS,
} from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import { USAGE_TEXT, type UsageTable } from '../../shared/l10n/usageTable'
import {
  parseUsagePageToServiceMessage,
  parseUsageServiceToPageMessage,
  type UsageServiceToPageMessage,
} from '../../shared/usagePage'
import type { UsageAccess, UsagePageConnection } from '../../runtime/usage/usageAdapter'
import { buildWebviewHtml, createNonce } from '../html'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'

export interface UsagePanelDeps {
  readonly extensionUri: vscode.Uri
  readonly l10n: UiTable
  readonly usageTable: UsageTable
  readonly log: Logger
  readonly usage: UsageAccess
  readonly journalFolder: vscode.Uri
  readonly openModels: (provider: string, model?: string) => Promise<void>
}

/** One secured tab per window; each document connects to the shared service. */
export class UsagePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private connection: UsagePageConnection | undefined

  public constructor(private readonly deps: UsagePanelDeps) {}

  public open(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(undefined, false)
      return
    }
    const root = vscode.Uri.joinPath(this.deps.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
    const panel = vscode.window.createWebviewPanel(
      'museSpark.usagePanel',
      UI_TEXT.usagePageTitle,
      vscode.ViewColumn.One,
      {},
    )
    this.panel = panel
    panel.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [root],
    }
    // The usage entry reads this inert data block before rendering. Keeping it
    // in the document needs no fetch or change to buildWebviewHtml's policy.
    const usageTable = JSON.stringify({ type: 'usage/table', ...this.deps.usageTable })
      .replaceAll('<', String.raw`\u003c`)
      .replaceAll('\u{2028}', String.raw`\u2028`)
      .replaceAll('\u{2029}', String.raw`\u2029`)
    panel.webview.html = buildWebviewHtml({
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'usage.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'usage.css')).toString(),
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      l10n: this.deps.l10n,
    }).replace(
      '</body>',
      () => `<script type="application/json" id="muse-usage-l10n">${usageTable}</script>\n</body>`,
    )
    const post = (message: UsageServiceToPageMessage): void => {
      const parsed = parseUsageServiceToPageMessage(message)
      if (this.panel === panel && parsed.ok) void panel.webview.postMessage(parsed.message)
      else if (!parsed.ok) this.deps.log.warn('Invalid usage service message')
    }
    let connection: UsagePageConnection
    try {
      connection = this.deps.usage.connect({
        post,
        saveFile: async (content, format) => {
          const target = await vscode.window.showSaveDialog({
            saveLabel: USAGE_TEXT.export,
            filters: format === 'json' ? { JSON: ['json'] } : { CSV: ['csv'] },
          })
          if (target === undefined || this.panel !== panel) return false
          // The chooser owns the URI, including a remote file-system scheme.
          await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(content))
          return true
        },
        confirmDelete: async (records) =>
          (await vscode.window.showWarningMessage(
            USAGE_TEXT.deleteTitle,
            { modal: true, detail: plural(USAGE_TEXT.deleteConfirm, records) },
            USAGE_TEXT.deleteAction,
            USAGE_TEXT.cancel,
          )) === USAGE_TEXT.deleteAction && this.panel === panel,
        openSettings: async () => {
          await vscode.commands.executeCommand(
            VSCODE_COMMANDS.openSettings,
            `${SETTINGS_SECTION}.usageHistory`,
          )
        },
        revealFolder: async () => {
          await vscode.commands.executeCommand('revealFileInOS', this.deps.journalFolder)
        },
        openModels: this.deps.openModels,
        openExternal: async (input) => {
          const url = new URL(input)
          if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
            throw new Error(USAGE_TEXT.unsupported)
          await vscode.env.openExternal(vscode.Uri.parse(url.href))
        },
        setHistory: async (isEnabled) => {
          await this.deps.usage.setHistory?.(isEnabled)
          await vscode.workspace
            .getConfiguration(SETTINGS_SECTION)
            .update('usageHistory', isEnabled, vscode.ConfigurationTarget.Global)
        },
      })
    } catch (error: unknown) {
      this.panel = undefined
      panel.dispose()
      throw error
    }
    this.connection = connection
    let queue = Promise.resolve()
    const messages = panel.webview.onDidReceiveMessage((input: unknown) => {
      const parsed = parseUsagePageToServiceMessage(input)
      if (!parsed.ok) {
        post({ type: 'usage/error', code: 'invalidMessage' })
        return
      }
      const previous = queue
      queue = (async () => {
        await previous
        try {
          if (this.panel === panel) await connection.receive(parsed.message)
        } catch {
          this.deps.log.warn('Usage page action failed')
          post({ type: 'usage/error', code: 'readFailed' })
        }
      })()
    })
    panel.onDidDispose(() => {
      messages.dispose()
      connection.dispose()
      if (this.panel !== panel) {
        return
      }

      this.panel = undefined
      this.connection = undefined
    })
  }

  public dispose(): void {
    this.panel?.dispose()
    this.connection?.dispose()
  }
}
