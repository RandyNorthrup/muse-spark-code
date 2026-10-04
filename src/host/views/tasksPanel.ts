// One live tasks tab for the conversation's surface. Moving its webview reloads
// the document; tasksReady always receives the last cached view, including ended.
import * as vscode from 'vscode'
import {
  TASKS_MOVE_TO_WINDOW_COMMAND,
  TASKS_PANEL_VIEW_TYPE,
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
  WEBVIEW_SCRIPT_FILE,
  WEBVIEW_STYLE_FILE,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type TasksHostMessage, tasksWebviewMessageSchema } from '../../shared/tasksProtocol'
import { buildWebviewHtml, createNonce } from '../html'
import { logRejection } from '../logger'
import type { TasksTabPort, TasksTabView } from './tasksTabPort'
import type { WebviewHostContext } from './webviewSetup'

export class TasksPanel implements TasksTabPort, vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private view: TasksTabView | undefined
  private isEnded = false
  private isReady = false
  private canMoveToWindow = false

  public constructor(
    private readonly context: Pick<WebviewHostContext, 'extensionUri' | 'l10n' | 'log'>,
    private readonly revealConversation: () => void,
  ) {}

  private send(): void {
    if (!this.isReady || this.panel === undefined || this.view === undefined) {
      return
    }
    const message: TasksHostMessage = {
      type: 'tasksState',
      ...this.view,
      items: [...this.view.items],
      ended: this.isEnded,
      canMoveToWindow: this.canMoveToWindow,
    }
    void this.panel.webview.postMessage(message)
  }

  public open(view: TasksTabView): void {
    this.view = view
    this.isEnded = false
    if (this.panel !== undefined) {
      this.panel.title = fill(UI_TEXT.tasksTabTitle, { conversation: view.conversation })
      this.panel.reveal(undefined, false)
      this.send()
      return
    }
    const bundleRoot = vscode.Uri.joinPath(this.context.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
    const panel = vscode.window.createWebviewPanel(
      TASKS_PANEL_VIEW_TYPE,
      fill(UI_TEXT.tasksTabTitle, { conversation: view.conversation }),
      vscode.ViewColumn.Beside,
      {},
    )
    this.panel = panel
    this.isReady = false
    this.canMoveToWindow = false
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
      surface: 'tasks',
    })
    const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const parsed = tasksWebviewMessageSchema.safeParse(raw)
      if (!parsed.success) {
        return
      }
      switch (parsed.data.type) {
        case 'tasksReady': {
          this.isReady = true
          this.send()
          break
        }
        case 'revealConversation': {
          if (!this.isEnded) {
            this.revealConversation()
          }
          break
        }
        case 'moveTasksToWindow': {
          if (this.canMoveToWindow) {
            panel.reveal(undefined, false)
            void vscode.commands
              .executeCommand(TASKS_MOVE_TO_WINDOW_COMMAND)
              .then(undefined, logRejection(this.context.log, 'move tasks window'))
          }
          break
        }
      }
    })
    panel.onDidDispose(() => {
      subscription.dispose()
      this.panel = undefined
      this.isReady = false
    })
    void vscode.commands.getCommands(true).then(
      (commands) => {
        if (this.panel !== panel) {
          return
        }
        this.canMoveToWindow = commands.includes(TASKS_MOVE_TO_WINDOW_COMMAND)
        this.send()
      },
      logRejection(this.context.log, 'tasks window commands'),
    )
  }

  public update(view: TasksTabView): void {
    if (this.isEnded) {
      return
    }
    this.view = view
    if (this.panel !== undefined) {
      this.panel.title = fill(UI_TEXT.tasksTabTitle, { conversation: view.conversation })
    }
    this.send()
  }

  public ended(): void {
    this.isEnded = true
    this.send()
  }

  public dispose(): void {
    this.panel?.dispose()
  }
}
